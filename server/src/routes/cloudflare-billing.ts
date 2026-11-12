import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { pool, type Row } from '../db';
import { env } from '../env';
import { fail, ok } from '../http';
import { resolveRate } from '../lib/fx';
import { putInvoice, invoiceKey, r2Enabled } from '../lib/r2';

type CfUsageRecord = {
  BilledCost?: number;
  ContractedCost?: number;
  BillingCurrency?: string;
  ChargePeriodStart?: string;
  ChargePeriodEnd?: string;
  ChargeDescription?: string;
  ConsumedQuantity?: number;
  ConsumedUnit?: string;
  ServiceName?: string;
  ServiceFamilyName?: string;
  ZoneName?: string;
};

type CfEnvelope<T> = {
  success?: boolean;
  errors?: { message?: string; code?: number }[];
  result?: T;
};

type UsagePreviewItem = {
  sourceKey: string;
  family: string;
  serviceName: string;
  zoneName: string | null;
  currency: string;
  amountSrc: number;
  quantity: number;
  unit: string;
  chargeCount: number;
  from: string;
  to: string;
  imported: boolean;
};

function apiError(message: string, statusCode = 502) {
  return Object.assign(new Error(message), { statusCode });
}

function validPeriod(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function monthShift(period: string, offset: number): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function anchorDate(period: string, anchorDay: number): string {
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(Math.min(anchorDay, lastDay)).padStart(2, '0')}`;
}

function round(value: number, digits = 2): number {
  const multiplier = 10 ** digits;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

async function cfGet<T>(url: string): Promise<T> {
  const { accountId, billingApiToken } = env.cloudflare;
  if (!accountId || !billingApiToken) {
    throw apiError('未配置 Cloudflare Billing Read Token', 400);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${billingApiToken}` },
    });
  } catch (error) {
    throw apiError(`调用 Cloudflare 账单 API 失败：${(error as Error).message}`);
  }

  const payload = (await response.json().catch(() => ({}))) as CfEnvelope<T>;
  if (!response.ok || payload.success === false) {
    const detail = payload.errors?.map((error) => error.message).filter(Boolean).join('; ');
    throw apiError(`Cloudflare 账单 API 返回错误：${detail || `HTTP ${response.status}`}`);
  }
  return payload.result as T;
}

async function readUsageMonth(period: string): Promise<UsagePreviewItem[]> {
  const { accountId } = env.cloudflare;
  const info = await cfGet<{
    covered?: boolean;
    subscriptions?: { start_timestamp?: string; billing_cycle_anchor_timestamp?: string }[];
  }>(`https://api.cloudflare.com/client/v4/accounts/${accountId}/billable-usage/info`);

  if (!info?.covered) {
    throw apiError('此 Cloudflare 账户暂不支持 Billable Usage API', 400);
  }
  const subscription = info.subscriptions?.find((item) => item.billing_cycle_anchor_timestamp);
  if (!subscription?.billing_cycle_anchor_timestamp) {
    throw apiError('Cloudflare 未返回账单周期锚点，无法安全读取账单周期', 502);
  }

  const anchorDay = new Date(subscription.billing_cycle_anchor_timestamp).getUTCDate();
  const previousAnchor = anchorDate(monthShift(period, -1), anchorDay);
  const currentAnchor = anchorDate(period, anchorDay);
  const nextAnchor = anchorDate(monthShift(period, 1), anchorDay);
  const windows: [string, string][] = [
    [previousAnchor, currentAnchor],
    [currentAnchor, nextAnchor],
  ];

  const records = await Promise.all(
    windows.map(async ([from, to]) => {
      const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/billable-usage`);
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      return (await cfGet<CfUsageRecord[]>(url.toString())) ?? [];
    })
  );

  const unique = new Map<string, CfUsageRecord>();
  for (const record of records.flat()) {
    const day = String(record.ChargePeriodStart ?? '').slice(0, 10);
    if (!day.startsWith(`${period}-`)) continue;
    const identity = [
      day,
      record.ServiceFamilyName ?? '',
      record.ServiceName ?? '',
      record.ZoneName ?? '',
      record.BillingCurrency ?? '',
      record.ConsumedUnit ?? '',
    ].join('|');
    unique.set(identity, record);
  }

  const groups = new Map<
    string,
    UsagePreviewItem & { amountSum: number; quantitySum: number; firstDay: string; lastDay: string }
  >();
  for (const [identity, record] of unique) {
    const family = record.ServiceFamilyName ?? 'Cloudflare';
    // R2 is already recorded by the existing R2 meter; importing it here would duplicate cost.
    if (family.toLowerCase() === 'r2') continue;

    const serviceName = record.ServiceName ?? record.ChargeDescription ?? family;
    const zoneName = record.ZoneName ?? null;
    const currency = (record.BillingCurrency ?? 'USD').toUpperCase();
    const amount = Number(record.BilledCost ?? record.ContractedCost ?? 0);
    const quantity = Number(record.ConsumedQuantity ?? 0);
    const day = String(record.ChargePeriodStart ?? '').slice(0, 10);
    const groupIdentity = [family, serviceName, zoneName ?? '', currency].join('|');
    const current = groups.get(groupIdentity);
    if (current) {
      current.amountSum += amount;
      current.quantitySum += quantity;
      current.chargeCount += 1;
      current.firstDay = day < current.firstDay ? day : current.firstDay;
      current.lastDay = day > current.lastDay ? day : current.lastDay;
    } else {
      groups.set(groupIdentity, {
        sourceKey: `usage:${createHash('sha256').update(groupIdentity + `|${period}`).digest('hex')}`,
        family,
        serviceName,
        zoneName,
        currency,
        amountSrc: 0,
        quantity: 0,
        unit: record.ConsumedUnit ?? '',
        chargeCount: 0,
        from: day,
        to: day,
        imported: false,
        amountSum: amount,
        quantitySum: quantity,
        firstDay: day,
        lastDay: day,
      });
      groups.get(groupIdentity)!.chargeCount = 1;
    }
    void identity;
  }

  const items = [...groups.values()].map((item) => ({
    sourceKey: item.sourceKey,
    family: item.family,
    serviceName: item.serviceName,
    zoneName: item.zoneName,
    currency: item.currency,
    amountSrc: round(item.amountSum, 4),
    quantity: round(item.quantitySum, 4),
    unit: item.unit,
    chargeCount: item.chargeCount,
    from: item.firstDay,
    to: item.lastDay,
    imported: false,
  }));

  if (items.length) {
    const [existing] = await pool.query<Row[]>(
      `SELECT source_key FROM cloudflare_cost_imports WHERE source_key IN (${items.map(() => '?').join(',')})`,
      items.map((item) => item.sourceKey)
    );
    const imported = new Set(existing.map((row) => String(row.source_key)));
    for (const item of items) item.imported = imported.has(item.sourceKey);
  }

  return items.sort((a, b) => a.family.localeCompare(b.family) || a.serviceName.localeCompare(b.serviceName));
}

function transactionDate(period: string): string {
  return `${monthShift(period, 1)}-01`;
}

async function ensureMapping(
  conn: PoolConnection,
  projectId: number,
  categoryId: number,
  direction: 'income' | 'expense'
) {
  const [projects] = await conn.query<Row[]>('SELECT id FROM projects WHERE id = ?', [projectId]);
  const [categories] = await conn.query<Row[]>('SELECT id FROM categories WHERE id = ? AND type = ?', [
    categoryId,
    direction,
  ]);
  if (!projects.length || !categories.length) {
    throw apiError('项目或科目不存在，或科目收支类型与账单方向不匹配', 400);
  }
}

async function insertImportTransaction(
  conn: PoolConnection,
  input: {
    sourceKey: string;
    sourceType: 'usage' | 'invoice';
    period: string;
    sourceName: string;
    invoiceNo?: string | null;
    documentHash?: string | null;
    projectId: number;
    categoryId: number;
    direction: 'income' | 'expense';
    txnDate: string;
    currency: string;
    amountSrc: number;
    raw: unknown;
    /** 账单 PDF 的 R2 对象 key（可选，仅发票导入时）。 */
    objectKey?: string | null;
    /** 附件文件名（可选）。 */
    fileName?: string | null;
    /** 附件字节数（可选）。 */
    fileSize?: number | null;
  }
): Promise<{ status: 'imported' | 'skipped'; transactionId: number | null }> {
  const [existing] = await conn.query<Row[]>(
    'SELECT id FROM cloudflare_cost_imports WHERE source_key = ? LIMIT 1',
    [input.sourceKey]
  );
  if (existing.length) return { status: 'skipped', transactionId: null };

  await ensureMapping(conn, input.projectId, input.categoryId, input.direction);
  const fxRate = input.currency === 'CNY' ? 1 : await resolveRate(input.txnDate);
  const absoluteSourceAmount = Math.abs(input.amountSrc);
  const amountCny = round(absoluteSourceAmount * fxRate);
  let transactionId: number | null = null;

  if (absoluteSourceAmount >= 0.005 && amountCny > 0) {
    const [transaction] = await conn.query<ResultSetHeader>(
      `INSERT INTO transactions
         (project_id, category_id, direction, txn_date, amount_cny, fx_rate,
          src_currency, src_amount, counterparty, ref_type, ref_id, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.projectId,
        input.categoryId,
        input.direction,
        input.txnDate,
        amountCny,
        fxRate,
        input.currency,
        round(absoluteSourceAmount, 2),
        'Cloudflare',
        'cloudflare',
        input.sourceKey,
        input.sourceName.slice(0, 255),
      ]
    );
    transactionId = Number(transaction.insertId);
  }

  await conn.query(
    `INSERT INTO cloudflare_cost_imports
       (source_key, source_type, billing_period, source_name, invoice_no, document_hash,
        project_id, category_id, direction, txn_date, currency, amount_src, fx_rate,
        amount_cny, txn_id, raw)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.sourceKey,
      input.sourceType,
      input.period,
      input.sourceName.slice(0, 255),
      input.invoiceNo ?? null,
      input.documentHash ?? null,
      input.projectId,
      input.categoryId,
      input.direction,
      input.txnDate,
      input.currency,
      round(absoluteSourceAmount, 4),
      fxRate,
      amountCny,
      transactionId,
      JSON.stringify(input.raw),
    ]
  );

  // 账单原件留存：写入附件（同一 PDF 可关联多条流水）
  if (transactionId && input.objectKey) {
    await conn.query(
      `INSERT INTO attachments (txn_id, file_name, url, size_bytes)
       VALUES (?,?,?,?)`,
      [transactionId, input.fileName ?? 'invoice.pdf', input.objectKey, input.fileSize ?? null]
    );
  }
  return { status: 'imported', transactionId };
}

/** 发票费用行的产品类别，用于建议科目。 */
export type InvoiceLineKind = 'domain' | 'r2' | 'stream' | 'images' | 'other';

type InvoiceLine = {
  /** 前端行标识（稳定，不随 PDF 版式变化）。 */
  lineKey: string;
  description: string;
  kind: InvoiceLineKind;
  domain: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  currency: string;
  /** 建议科目 id（可被用户在界面覆盖）。 */
  suggestedCategoryId: number | null;
  /** 该明细对应的流水是否已入账（幂等命中）。 */
  imported: boolean;
};

const CATEGORY_BY_KIND: Record<InvoiceLineKind, number | null> = {
  domain: 20106,
  r2: 20101,
  stream: 20201,
  images: 20102,
  other: null,
};

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const pdfText = (filePath: string) =>
  new Promise<string>((resolve, reject) => {
    execFile('pdftotext', ['-layout', filePath, '-'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

function toNumber(token: string): number {
  return Number(token.replace(/[$,]/g, ''));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 行级内容指纹：同一发票号 + 同一描述 + 金额 + 币种，永远得到同一个 source_key，
 * 因此「同一张发票重复上传」或「发票重新导出后 PDF 字节变化」都能被判为重复。
 */
export function invoiceLineFingerprint(
  invoiceNo: string,
  description: string,
  amount: number,
  currency: string
): string {
  return createHash('sha256')
    .update(`${invoiceNo}|${normalizeText(description)}|${amount.toFixed(4)}|${currency}`)
    .digest('hex');
}

/** 发票明细的记账幂等键：同一发票号 + 同一描述 + 金额 + 币种恒等。 */
function invoiceLineSourceKey(invoiceNo: string, description: string, amount: number, currency: string): string {
  return `invoice:${invoiceLineFingerprint(invoiceNo, description, amount, currency)}`;
}

function classify(description: string, domain: string | null): InvoiceLineKind {
  if (domain || /registrar|domain registration/i.test(description)) return 'domain';
  if (/\br2\b/i.test(description)) return 'r2';
  if (/stream/i.test(description)) return 'stream';
  if (/image/i.test(description)) return 'images';
  return 'other';
}

function parseInvoiceHeader(text: string) {
  const invoiceNumber =
    text.match(/\binvoice\s*(?:number|no\.?|#)\s*[:#]?\s*([a-z0-9-]{4,})/i)?.[1] ?? '';
  const currency = (text.match(/\b(USD|CNY|EUR|HKD|SGD)\b/i)?.[1] ?? 'USD').toUpperCase();
  const totalRaw = text.match(/^\s*Total\s+\$\s?([\d,]+\.\d+)/im)?.[1];
  const total = totalRaw ? toNumber(totalRaw) : null;

  const named = text.match(/date of issue\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  const numeric = text.match(/date of issue\s+(\d{4})[-/](\d{1,2})[-/](\d{1,2})/i);
  let invoiceDate: string | null = null;
  if (named && MONTHS[named[1].toLowerCase()]) {
    invoiceDate = `${named[3]}-${String(MONTHS[named[1].toLowerCase()]).padStart(2, '0')}-${String(Number(named[2])).padStart(2, '0')}`;
  } else if (numeric) {
    invoiceDate = `${numeric[1]}-${String(Number(numeric[2])).padStart(2, '0')}-${String(Number(numeric[3])).padStart(2, '0')}`;
  } else {
    const anyDate = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (anyDate) {
      invoiceDate = `${anyDate[1]}-${String(Number(anyDate[2])).padStart(2, '0')}-${String(Number(anyDate[3])).padStart(2, '0')}`;
    }
  }
  return { invoiceNumber, invoiceDate, currency, total };
}

/**
 * 解析 Cloudflare 发票正文的全部费用行（域名注册 / R2 用量 / 订阅等）。
 * 采用 `pdftotext -layout` 的列对齐特征：金额取行内最后一个 $ 数字。
 */
function parseInvoiceLines(text: string, currency: string): InvoiceLine[] {
  const money = /\$\s?\d[\d,]*(?:\.\d+)?/g;
  const tailRe = /(?:\s+\$?\d[\d,]*(?:\.\d+)?)+$/;
  const noise = /\b(subtotal|total|amount due|balance|payment|tax|vat|due)\b/i;
  const registrar = /registrar registration fee\s*[-–]\s*([a-z0-9.-]+\.[a-z]{2,})/i;

  const seen = new Map<string, number>();
  const lines: InvoiceLine[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || noise.test(line) || /^page \d+ of \d+/i.test(line)) continue;

    const matches = [...line.matchAll(money)];
    if (!matches.length) continue;
    const amount = toNumber(matches[matches.length - 1][0]);
    if (!Number.isFinite(amount)) continue;

    const tailMatch = line.match(tailRe)?.[0] ?? '';
    let tail = tailMatch;
    let groups = tail.trim().split(/\s+/).filter(Boolean);
    // 数量区若以 4 位年份开头（如 "...after 25 Oct 2026   1   $2.10"），
    // 该年份属于描述而非数量列，需保留在描述中。
    if (groups.length >= 3 && /^(19|20)\d{2}$/.test(groups[0])) {
      groups = groups.slice(1);
      tail = tail.replace(/^\s+\d{4}/, '');
    }
    const description = line.slice(0, line.length - tail.length).trim();
    if (description.length < 3) continue;
    if (/^first\b|^per\b/i.test(description)) continue;

    const quantity = groups.length >= 2 ? toNumber(groups[0]) : null;
    const unitPrice = groups.length >= 3 ? toNumber(groups[groups.length - 2]) : null;

    const domain = description.match(registrar)?.[1]?.toLowerCase() ?? null;
    const kind = classify(description, domain);

    const baseKey = createHash('sha256')
      .update(`${normalizeText(description)}|${amount.toFixed(4)}|${currency}`)
      .digest('hex')
      .slice(0, 24);
    const occurrence = (seen.get(baseKey) ?? 0) + 1;
    seen.set(baseKey, occurrence);

    lines.push({
      lineKey: occurrence === 1 ? baseKey : `${baseKey}#${occurrence}`,
      description: description.slice(0, 240),
      kind,
      domain,
      quantity,
      unitPrice,
      amount,
      currency,
      suggestedCategoryId: CATEGORY_BY_KIND[kind],
      imported: false,
    });
  }
  return lines;
}

/** 已导入账单的公共投影（列表与单条复用）。 */
const IMPORT_SELECT = `SELECT i.id, i.source_key AS sourceKey, i.source_type AS sourceType,
    i.billing_period AS billingPeriod, i.source_name AS sourceName,
    i.invoice_no AS invoiceNo, i.document_hash AS documentHash,
    i.project_id AS projectId, i.category_id AS categoryId,
    i.direction, i.txn_date AS txnDate, i.currency,
    i.amount_src AS amountSrc, i.fx_rate AS fxRate, i.amount_cny AS amountCny,
    i.txn_id AS txnId, i.created_at AS createdAt,
    p.name_cn AS projectNameCn, p.name_en AS projectNameEn,
    c.name_cn AS categoryNameCn, c.name_en AS categoryNameEn,
    (SELECT COUNT(*) FROM attachments a WHERE a.txn_id = i.txn_id) AS attachmentCount
  FROM cloudflare_cost_imports i
  LEFT JOIN projects p ON p.id = i.project_id
  LEFT JOIN categories c ON c.id = i.category_id`;

export default async function cloudflareBillingRoutes(app: FastifyInstance) {
  app.get('/usage/preview', async (req, reply) => {
    const period = (req.query as { period?: string }).period;
    if (!validPeriod(period)) {
      reply.code(400);
      return fail(400, 'period 必须为 YYYY-MM');
    }
    return ok({
      period,
      excludedFamilies: ['R2'],
      items: await readUsageMonth(period),
    });
  });

  app.post('/usage/import', async (req, reply) => {
    const body = req.body as {
      period?: string;
      items?: { sourceKey?: string; projectId?: number; categoryId?: number }[];
    };
    if (!validPeriod(body?.period) || !Array.isArray(body.items) || !body.items.length) {
      reply.code(400);
      return fail(400, '请提供计费月份和至少一条待导入产品');
    }

    const currentMonth = new Date().toISOString().slice(0, 7);
    if (body.period >= currentMonth) {
      reply.code(400);
      return fail(400, '只能导入已结束月份的账单；当前月份仍在累计中');
    }

    const preview = await readUsageMonth(body.period);
    const byKey = new Map(preview.map((item) => [item.sourceKey, item]));
    const conn = await pool.getConnection();
    let imported = 0;
    let skipped = 0;
    let transactionCount = 0;
    try {
      await conn.beginTransaction();
      for (const requested of body.items) {
        const item = byKey.get(String(requested.sourceKey ?? ''));
        const projectId = Number(requested.projectId);
        const categoryId = Number(requested.categoryId);
        if (!item || !Number.isInteger(projectId) || !Number.isInteger(categoryId)) {
          throw apiError('产品映射无效，请重新预览账单后再导入', 400);
        }
        const result = await insertImportTransaction(conn, {
          sourceKey: item.sourceKey,
          sourceType: 'usage',
          period: body.period,
          sourceName: `Cloudflare · ${item.serviceName} · ${body.period}`,
          projectId,
          categoryId,
          direction: item.amountSrc < 0 ? 'income' : 'expense',
          txnDate: transactionDate(body.period),
          currency: item.currency,
          amountSrc: item.amountSrc,
          raw: item,
        });
        if (result.status === 'imported') {
          imported += 1;
          if (Math.abs(item.amountSrc) >= 0.005) transactionCount += 1;
        } else {
          skipped += 1;
        }
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    return ok({ imported, skipped, transactionCount });
  });

  app.post('/invoices/parse', async (req, reply) => {
    const pdf = req.body;
    if (!Buffer.isBuffer(pdf) || pdf.length < 5 || pdf.subarray(0, 5).toString() !== '%PDF-') {
      reply.code(400);
      return fail(400, '上传文件不是有效的 PDF');
    }
    if (pdf.length > 10 * 1024 * 1024) {
      reply.code(413);
      return fail(413, 'PDF 大小不能超过 10 MB');
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cloudflare-invoice-'));
    const filePath = path.join(tempDir, 'invoice.pdf');
    try {
      await writeFile(filePath, pdf);
      let text = '';
      let parseWarning: string | undefined;
      try {
        text = await pdfText(filePath);
      } catch {
        parseWarning = 'PDF 文本未能自动提取；仍可手工填写发票编号与费用明细。';
      }
      const header = parseInvoiceHeader(text);
      const items = parseInvoiceLines(text, header.currency);
      const documentHash = createHash('sha256').update(pdf).digest('hex');

      // 幂等预检：标记出该发票中已经入账的费用行，界面据此默认不再重复勾选。
      if (header.invoiceNumber) {
        const keys = items.map((item) =>
          invoiceLineSourceKey(header.invoiceNumber, item.description, item.amount, item.currency)
        );
        if (keys.length) {
          const [existing] = await pool.query<Row[]>(
            `SELECT source_key FROM cloudflare_cost_imports WHERE source_key IN (${keys.map(() => '?').join(',')})`,
            keys
          );
          const importedKeys = new Set(existing.map((row) => String(row.source_key)));
          items.forEach((item, index) => {
            item.imported = importedKeys.has(keys[index]);
          });
        }
      }

      // 账单原件留存（私有桶）：未配置 R2 时跳过，不阻断解析。
      let objectKey: string | null = null;
      let uploadWarning: string | undefined;
      if (r2Enabled()) {
        try {
          const period = (header.invoiceDate ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
          objectKey = invoiceKey(period, header.invoiceNumber, documentHash);
          await putInvoice(objectKey, pdf);
        } catch (e) {
          uploadWarning = `账单上传 R2 失败：${(e as Error).message}`;
        }
      } else {
        uploadWarning =
          '未配置 R2，账单未留存（.env 需设置 R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY）。';
      }

      return ok({
        documentHash,
        invoiceNumber: header.invoiceNumber,
        invoiceDate: header.invoiceDate,
        currency: header.currency,
        total: header.total,
        items,
        candidateCount: items.length,
        parseWarning,
        objectKey,
        fileSize: pdf.length,
        uploadWarning,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  app.post('/invoices/import', async (req, reply) => {
    const body = req.body as {
      documentHash?: string;
      invoiceNumber?: string;
      invoiceDate?: string;
      /** 账单原件的 R2 对象 key（来自 /invoices/parse，可选）。 */
      objectKey?: string;
      fileName?: string;
      fileSize?: number;
      items?: {
        description?: string;
        amount?: number;
        currency?: string;
        projectId?: number;
        categoryId?: number;
      }[];
    };
    const invoiceDate = body.invoiceDate;
    if (!/^[a-f0-9]{64}$/i.test(body?.documentHash ?? '') || !body.invoiceNumber?.trim()) {
      reply.code(400);
      return fail(400, '请提供有效的发票文件及发票编号');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate ?? '')) {
      reply.code(400);
      return fail(400, '发票日期必须为 YYYY-MM-DD');
    }
    if (!Array.isArray(body.items) || !body.items.length) {
      reply.code(400);
      return fail(400, '请至少确认一条发票费用明细');
    }

    const invoiceNo = body.invoiceNumber.trim();
    const conn = await pool.getConnection();
    let imported = 0;
    let skipped = 0;
    let transactionCount = 0;
    try {
      await conn.beginTransaction();
      for (const item of body.items) {
        const amount = Number(item.amount);
        const projectId = Number(item.projectId);
        const categoryId = Number(item.categoryId);
        const currency = String(item.currency ?? 'USD').toUpperCase();
        const description = String(item.description ?? '').trim();
        if (
          !description ||
          !Number.isFinite(amount) ||
          amount < 0.005 ||
          !['USD', 'CNY'].includes(currency) ||
          !Number.isInteger(projectId) ||
          !Number.isInteger(categoryId)
        ) {
          throw apiError('发票明细描述、金额、币种、项目或科目无效', 400);
        }

        // 幂等键由「发票号 + 描述 + 金额 + 币种」推导，与解析阶段完全一致，重复上传自动跳过。
        const sourceKey = invoiceLineSourceKey(invoiceNo, description, amount, currency);
        const result = await insertImportTransaction(conn, {
          sourceKey,
          sourceType: 'invoice',
          period: invoiceDate!.slice(0, 7),
          sourceName: `Cloudflare invoice ${invoiceNo} · ${description}`,
          invoiceNo: invoiceNo.slice(0, 128),
          documentHash: body.documentHash,
          projectId,
          categoryId,
          direction: 'expense',
          txnDate: invoiceDate!,
          currency,
          amountSrc: amount,
          raw: { description, amount, currency },
          objectKey: body.objectKey ?? null,
          fileName: body.fileName ?? `cloudflare-invoice-${invoiceNo}.pdf`,
          fileSize: body.fileSize ?? null,
        });
        if (result.status === 'imported') {
          imported += 1;
          transactionCount += 1;
        } else {
          skipped += 1;
        }
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    return ok({ imported, skipped, transactionCount });
  });

  /* ------------------------------ 账单列表 ------------------------------ */

  // 已导入账单列表（含项目 / 科目归属，用于核对与调整最终归属）
  app.get('/imports', async (req, reply) => {
    const q = req.query as { period?: string; sourceType?: string };
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.period) {
      if (!validPeriod(q.period)) {
        reply.code(400);
        return fail(400, 'period 必须为 YYYY-MM');
      }
      where.push('i.billing_period = ?');
      params.push(q.period);
    }
    if (q.sourceType === 'usage' || q.sourceType === 'invoice') {
      where.push('i.source_type = ?');
      params.push(q.sourceType);
    }
    const [rows] = await pool.query<Row[]>(
      `${IMPORT_SELECT}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY i.txn_date DESC, i.id DESC
        LIMIT 500`,
      params
    );
    return ok({ items: rows });
  });

  // 调整账单最终归属（项目 / 科目），并同步更新已生成的流水
  app.patch('/imports/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { projectId?: number; categoryId?: number };
    const projectId = Number(body?.projectId);
    const categoryId = Number(body?.categoryId);
    if (!Number.isInteger(id) || !Number.isInteger(projectId) || !Number.isInteger(categoryId)) {
      reply.code(400);
      return fail(400, '请提供有效的项目与科目');
    }

    const [rows] = await pool.query<Row[]>(
      'SELECT id, txn_id AS txnId, direction FROM cloudflare_cost_imports WHERE id = ?',
      [id]
    );
    if (!rows.length) {
      reply.code(404);
      return fail(404, '账单记录不存在');
    }
    const direction = rows[0].direction as 'income' | 'expense';
    const txnId = rows[0].txnId ? Number(rows[0].txnId) : null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await ensureMapping(conn, projectId, categoryId, direction);
      await conn.query(
        'UPDATE cloudflare_cost_imports SET project_id = ?, category_id = ? WHERE id = ?',
        [projectId, categoryId, id]
      );
      // transactions 为权威台账口径，归属调整需同步落库
      if (txnId) {
        await conn.query('UPDATE transactions SET project_id = ?, category_id = ? WHERE id = ?', [
          projectId,
          categoryId,
          txnId,
        ]);
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    const [updated] = await pool.query<Row[]>(`${IMPORT_SELECT} WHERE i.id = ?`, [id]);
    return ok({ item: updated[0] });
  });
}
