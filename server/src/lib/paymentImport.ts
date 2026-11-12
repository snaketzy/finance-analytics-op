import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { pool, type Row } from '../db';
import { resolveRate } from './fx';
import { round4, sourceBrand, type ChannelTxn, type PaymentPreviewItem, type PaymentSource } from './channel';

function apiError(message: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 为渠道交易附加「是否已导入」标记（按 source + source_key 幂等判断）。 */
export async function markImported(
  source: PaymentSource,
  txns: ChannelTxn[]
): Promise<PaymentPreviewItem[]> {
  if (!txns.length) return [];
  const [rows] = await pool.query<Row[]>(
    `SELECT source_key FROM payment_imports
      WHERE source = ? AND source_key IN (${txns.map(() => '?').join(',')})`,
    [source, ...txns.map((txn) => txn.sourceKey)]
  );
  const imported = new Set(rows.map((row) => String(row.source_key)));
  return txns.map((txn) => ({ ...txn, imported: imported.has(txn.sourceKey) }));
}

/** 按「渠道 + 币种」查找或创建平台资金账户（用于回填 account_id 对账）。 */
export async function ensureChannelAccount(
  conn: PoolConnection,
  source: PaymentSource,
  currency: string
): Promise<number> {
  const brand = sourceBrand(source);
  const nameEn = `${brand.en} Balance (${currency})`;
  const [existing] = await conn.query<Row[]>('SELECT id FROM accounts WHERE type = ? AND name_en = ? LIMIT 1', [
    'platform',
    nameEn,
  ]);
  if (existing.length) return Number(existing[0].id);

  const [result] = await conn.query<ResultSetHeader>(
    `INSERT INTO accounts (name_cn, name_en, type, currency, opening_balance_cny, sort_order)
     VALUES (?,?,?,?,0,?)`,
    [`${brand.cn} 余额 (${currency})`, nameEn, 'platform', currency, 90]
  );
  return Number(result.insertId);
}

export type ImportInput = {
  source: PaymentSource;
  sourceKey: string;
  period: string;
  sourceName: string;
  reference: string | null;
  counterparty: string | null;
  projectId: number;
  categoryId: number;
  /** 手续费科目；为空或手续费为 0 时不生成手续费流水。 */
  feeCategoryId: number | null;
  /** 指定的资金账户；为空则自动按渠道 + 币种建账户。 */
  accountId: number | null;
  txnDate: string;
  currency: string;
  gross: number;
  fee: number;
  raw: unknown;
};

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
    throw apiError('项目或科目不存在，或科目收支类型与流水方向不匹配');
  }
}

/**
 * 幂等写入一笔渠道交易的收入与手续费流水：
 * - 已存在 (source, source_key) 则跳过；
 * - 毛额 > 0 记一笔收入；手续费科目已指定且手续费 > 0 时再记一笔支出。
 */
export async function insertPaymentImport(
  conn: PoolConnection,
  input: ImportInput
): Promise<{ status: 'imported' | 'skipped'; incomeTxnId: number | null; feeTxnId: number | null }> {
  const [existing] = await conn.query<Row[]>(
    'SELECT id FROM payment_imports WHERE source = ? AND source_key = ? LIMIT 1',
    [input.source, input.sourceKey]
  );
  if (existing.length) return { status: 'skipped', incomeTxnId: null, feeTxnId: null };

  await ensureMapping(conn, input.projectId, input.categoryId, 'income');
  const chargeFee = input.fee > 0 && input.feeCategoryId !== null;
  if (chargeFee) {
    await ensureMapping(conn, input.projectId, input.feeCategoryId as number, 'expense');
  }

  const accountId =
    input.accountId ?? (await ensureChannelAccount(conn, input.source, input.currency));
  const fxRate = input.currency === 'CNY' ? 1 : await resolveRate(input.txnDate);
  const gross = round4(input.gross);
  const fee = round4(input.fee);
  const net = round4(gross - fee);
  const grossCny = round2(gross * fxRate);
  const feeCny = round2(fee * fxRate);
  const brand = sourceBrand(input.source);
  let incomeTxnId: number | null = null;
  let feeTxnId: number | null = null;

  if (gross >= 0.005 && grossCny > 0) {
    const [income] = await conn.query<ResultSetHeader>(
      `INSERT INTO transactions
         (project_id, account_id, category_id, direction, txn_date, amount_cny, fx_rate,
          src_currency, src_amount, counterparty, ref_type, ref_id, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.projectId,
        accountId,
        input.categoryId,
        'income',
        input.txnDate,
        grossCny,
        fxRate,
        input.currency,
        round2(gross),
        input.counterparty ?? brand.en,
        input.source,
        input.sourceKey,
        input.sourceName.slice(0, 255),
      ]
    );
    incomeTxnId = Number(income.insertId);
  }

  if (chargeFee && fee >= 0.005 && feeCny > 0) {
    const [feeTxn] = await conn.query<ResultSetHeader>(
      `INSERT INTO transactions
         (project_id, account_id, category_id, direction, txn_date, amount_cny, fx_rate,
          src_currency, src_amount, counterparty, ref_type, ref_id, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.projectId,
        accountId,
        input.feeCategoryId,
        'expense',
        input.txnDate,
        feeCny,
        fxRate,
        input.currency,
        round2(fee),
        brand.en,
        `${input.source}-fee`,
        input.sourceKey,
        `${brand.en} 支付手续费 · ${input.period}`.slice(0, 255),
      ]
    );
    feeTxnId = Number(feeTxn.insertId);
  }

  await conn.query(
    `INSERT INTO payment_imports
       (source, source_key, billing_period, source_name, reference, counterparty,
        project_id, category_id, fee_category_id, account_id, txn_date, currency,
        gross_src, fee_src, net_src, fx_rate, gross_cny, fee_cny, net_cny,
        txn_id, fee_txn_id, raw)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.source,
      input.sourceKey,
      input.period,
      input.sourceName.slice(0, 255),
      input.reference ?? null,
      input.counterparty ?? null,
      input.projectId,
      input.categoryId,
      chargeFee ? input.feeCategoryId : null,
      accountId,
      input.txnDate,
      input.currency,
      gross,
      fee,
      net,
      fxRate,
      grossCny,
      feeCny,
      round2(net * fxRate),
      incomeTxnId,
      feeTxnId,
      JSON.stringify(input.raw),
    ]
  );

  return { status: 'imported', incomeTxnId, feeTxnId };
}
