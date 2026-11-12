import type { FastifyInstance } from 'fastify';
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { pool, type Row } from '../db';
import { ok, fail } from '../http';
import { latestRate, resolveRate } from '../lib/fx';
import { readUsage } from '../lib/meters';

const CYCLE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** 在 ISO 日期上加减自然月，日号溢出时回退到当月最后一天。 */
function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

function currentMonth(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 7);
}

function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 摊销：把周期金额折算为「每月等额」，保证不同计费周期的成本可比。 */
function monthlyAmount(amount: number, cycle: string): number {
  return round2(amount / (CYCLE_MONTHS[cycle] ?? 1));
}

const BASE_SELECT = `
  SELECT r.id,
         r.project_id  AS projectId,  p.name_cn AS projectNameCn, p.name_en AS projectNameEn,
         r.category_id AS categoryId, c.name_cn AS categoryNameCn, c.name_en AS categoryNameEn,
         c.domain      AS domain,
         r.supplier_id AS supplierId, s.name_cn AS supplierNameCn, s.name_en AS supplierNameEn,
         r.name_cn     AS nameCn,     r.name_en AS nameEn,
         r.amount_cny  AS amountCny,  r.cycle   AS cycle, r.cost_nature AS costNature,
         r.pricing_mode   AS pricingMode,
         r.unit_price     AS unitPrice,
         r.unit_price_ccy AS unitPriceCcy,
         r.unit_label     AS unitLabel,
         r.meter_source   AS meterSource,
         r.start_date  AS startDate,  r.end_date AS endDate,
         r.auto_generate AS autoGenerate,
         r.last_gen_date AS lastGenDate,
         r.status      AS status,
         (SELECT MAX(u.period) FROM usage_records u WHERE u.recurring_id = r.id) AS lastUsagePeriod,
         (SELECT u.amount_src FROM usage_records u WHERE u.recurring_id = r.id ORDER BY u.period DESC LIMIT 1) AS lastUsageAmountSrc,
         (SELECT u.unit_price_ccy FROM usage_records u WHERE u.recurring_id = r.id ORDER BY u.period DESC LIMIT 1) AS lastUsageAmountCcy,
         (SELECT u.amount_cny FROM usage_records u WHERE u.recurring_id = r.id ORDER BY u.period DESC LIMIT 1) AS lastUsageAmountCny
    FROM recurring_costs r
    JOIN projects   p ON p.id = r.project_id
    JOIN categories c ON c.id = r.category_id
    LEFT JOIN suppliers s ON s.id = r.supplier_id
`;

/** 计量记录（用量 / 账单计费）的公共投影，供列表与单条复用。 */
const USAGE_SELECT = `
  SELECT u.id, u.recurring_id AS recurringId, u.period,
         u.quantity, u.unit_label AS unitLabel, u.unit_price AS unitPrice,
         u.unit_price_ccy AS unitPriceCcy, u.amount_src AS amountSrc,
         u.fx_rate AS fxRate, u.amount_cny AS amountCny, u.source,
         u.billed_on AS billedOn, u.txn_id AS txnId,
         u.project_id  AS projectId,  p.name_cn AS projectNameCn, p.name_en AS projectNameEn,
         u.category_id AS categoryId, c.name_cn AS categoryNameCn, c.name_en AS categoryNameEn,
         r.name_cn AS recurringNameCn, r.name_en AS recurringNameEn,
         r.pricing_mode AS pricingMode
    FROM usage_records u
    LEFT JOIN recurring_costs r ON r.id = u.recurring_id
    LEFT JOIN projects   p ON p.id = u.project_id
    LEFT JOIN categories c ON c.id = u.category_id
`;

/** 校验项目存在且科目为支出类型（计量记录恒为支出）。 */
async function ensureExpenseMapping(conn: PoolConnection, projectId: number, categoryId: number) {
  const [projects] = await conn.query<Row[]>('SELECT id FROM projects WHERE id = ?', [projectId]);
  const [categories] = await conn.query<Row[]>(
    'SELECT id FROM categories WHERE id = ? AND type = ?',
    [categoryId, 'expense']
  );
  if (!projects.length || !categories.length) {
    throw Object.assign(new Error('项目或科目不存在，或科目收支类型不匹配'), { statusCode: 400 });
  }
}

/** 取 ISO 日期所在的计费期（YYYY-MM）。 */
function periodOf(iso: string): string {
  return String(iso).slice(0, 7);
}

/** 计费期的下个自然月 1 号（= 默认计费日）。 */
function billingDayOf(period: string): string {
  return `${addMonths(`${period}-01`, 1).slice(0, 7)}-01`;
}

/** 默认计费期：上一个自然月（本期账单在次月计费日产生）。 */
function prevPeriod(): string {
  return addMonths(`${currentMonth()}-01`, -1).slice(0, 7);
}

/** 计算「下次到期日」：已停止 / 已过期返回 null。 */
function nextDueDate(t: Row): string | null {
  if (!t.status || !t.autoGenerate) return null;
  const end = t.endDate ? String(t.endDate).slice(0, 10) : null;

  // 用量 / 账单计费：按自然月计费，下一计费日 = 已计费期的次月 1 号；尚无记录则回落到起始日。
  if (t.pricingMode === 'usage' || t.pricingMode === 'metered') {
    const next = t.lastUsagePeriod
      ? billingDayOf(String(t.lastUsagePeriod))
      : String(t.startDate).slice(0, 10);
    if (end && next > end) return null;
    return next;
  }

  const step = CYCLE_MONTHS[t.cycle] ?? 1;
  const next = t.lastGenDate ? addMonths(String(t.lastGenDate).slice(0, 10), step) : String(t.startDate).slice(0, 10);
  if (end && next > end) return null;
  return next;
}

/** 幂等生成：从 last_gen_date 的下一期开始，逐期补记流水，直到 until。 */
async function generateFor(t: Row, until: string): Promise<{ generated: number; lastGenDate: string | null }> {
  const step = CYCLE_MONTHS[t.cycle] ?? 1;
  const end = t.endDate ? String(t.endDate).slice(0, 10) : null;
  const limit = end && end < until ? end : until;
  let cursor = t.lastGenDate
    ? addMonths(String(t.lastGenDate).slice(0, 10), step)
    : String(t.startDate).slice(0, 10);

  let generated = 0;
  let last = t.lastGenDate ? String(t.lastGenDate).slice(0, 10) : null;
  let guard = 0;

  while (cursor <= limit && guard++ < 240) {
    const [dup] = await pool.query<Row[]>(
      'SELECT id FROM transactions WHERE recurring_id = ? AND txn_date = ? LIMIT 1',
      [t.id, cursor]
    );
    if (!dup.length) {
      const rate = await resolveRate(cursor);
      await pool.query<ResultSetHeader>(
        `INSERT INTO transactions
           (project_id, category_id, direction, txn_date, amount_cny, fx_rate,
            is_recurring, recurring_id, counterparty, note)
         VALUES (?, ?, 'expense', ?, ?, ?, 1, ?, ?, ?)`,
        [
          t.projectId, t.categoryId, cursor, t.amountCny, rate, t.id,
          t.supplierNameCn ?? t.nameCn, `周期成本自动生成 · ${t.nameEn}`,
        ]
      );
      generated += 1;
    }
    last = cursor;
    cursor = addMonths(cursor, step);
  }

  if (generated > 0 && last) {
    await pool.query('UPDATE recurring_costs SET last_gen_date = ? WHERE id = ?', [last, t.id]);
  }
  return { generated, lastGenDate: last };
}

export type UsageBillResult = {
  id: number;
  period: string;
  quantity: number;
  unitLabel: string;
  unitPrice: number;
  unitPriceCcy: string;
  amountSrc: number;
  fxRate: number;
  amountCny: number;
  source: string;
  billedOn: string;
  txnId: number | null;
  skipped: boolean;
};

/** 计费：按计费期取用量/账单金额（API 拉取或手工录入）→ 单价×用量（metered 直读金额）→ 汇率折算 → 写计量记录 + 流水（幂等）。 */
async function billUsage(
  t: Row,
  period: string,
  quantityInput?: number,
  billedOnInput?: string
): Promise<UsageBillResult> {
  const [dup] = await pool.query<Row[]>(
    'SELECT * FROM usage_records WHERE recurring_id = ? AND period = ? LIMIT 1',
    [t.id, period]
  );
  if (dup.length) {
    const d = dup[0];
    return {
      id: t.id as number, period, quantity: Number(d.quantity), unitLabel: d.unit_label,
      unitPrice: Number(d.unit_price), unitPriceCcy: d.unit_price_ccy,
      amountSrc: Number(d.amount_src), fxRate: Number(d.fx_rate), amountCny: Number(d.amount_cny),
      source: d.source, billedOn: String(d.billed_on).slice(0, 10),
      txnId: d.txn_id ?? null, skipped: true,
    };
  }

  const isMetered = t.pricingMode === 'metered';
  const unitPriceCcy = (t.unitPriceCcy as string) ?? 'USD';

  let quantity = quantityInput;
  let unitLabel = (t.unitLabel as string) ?? 'unit';
  let unitPrice = Number(t.unitPrice);
  let source = 'manual';
  let raw: unknown = null;
  const fromApi = quantity === undefined || quantity === null || Number.isNaN(quantity);

  if (isMetered) {
    // 服务商直读账单金额：quantity 即金额，单价恒为 1。
    unitPrice = 1;
    if (fromApi) {
      if (!t.meterSource) {
        throw Object.assign(new Error('该周期成本未配置计量源，请手工录入账单金额'), { statusCode: 400 });
      }
      const reading = await readUsage(String(t.meterSource), period);
      quantity = reading.quantity;
      unitLabel = reading.unit;
      source = reading.source;
      raw = reading.raw;
    }
  } else {
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw Object.assign(new Error('该周期成本缺少有效单价（unit_price）'), { statusCode: 400 });
    }
    if (fromApi) {
      if (!t.meterSource) {
        throw Object.assign(new Error('该周期成本未配置计量源，请手工录入本期用量'), { statusCode: 400 });
      }
      const reading = await readUsage(String(t.meterSource), period);
      quantity = reading.quantity;
      source = reading.source;
      raw = reading.raw;
    }
  }

  const amountSrc = round2(Number(quantity) * unitPrice);
  const billedOn = billedOnInput ?? billingDayOf(period);
  const fxRate = await resolveRate(billedOn);
  const amountCny = round2(amountSrc * fxRate);

  const note = isMetered
    ? `账单计费 · ${t.nameEn} · ${period} · ${amountSrc}${unitPriceCcy}（服务商直读）`
    : `用量计费 · ${t.nameEn} · ${period} · ${quantity}${unitLabel} @ ${unitPrice}${unitPriceCcy}`;
  const [txn] = await pool.query<ResultSetHeader>(
    `INSERT INTO transactions
       (project_id, category_id, direction, txn_date, amount_cny, fx_rate,
        src_currency, src_amount, is_recurring, recurring_id, counterparty, note)
     VALUES (?, ?, 'expense', ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      t.projectId, t.categoryId, billedOn, amountCny, fxRate,
      unitPriceCcy, amountSrc, t.id, t.supplierNameCn ?? t.nameCn, note,
    ]
  );

  await pool.query<ResultSetHeader>(
    `INSERT INTO usage_records
       (recurring_id, project_id, category_id, period, quantity, unit_label, unit_price,
        unit_price_ccy, amount_src, fx_rate, amount_cny, source, billed_on, txn_id, raw)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      t.id, t.projectId, t.categoryId, period, quantity, unitLabel, unitPrice,
      unitPriceCcy, amountSrc, fxRate, amountCny, source, billedOn, txn.insertId,
      raw ? JSON.stringify(raw) : null,
    ]
  );

  return {
    id: t.id as number, period, quantity: Number(quantity), unitLabel, unitPrice, unitPriceCcy,
    amountSrc, fxRate, amountCny, source, billedOn, txnId: txn.insertId, skipped: false,
  };
}

export default async function (app: FastifyInstance) {
  // 列表：模板 + 摊销月额 + 下次到期
  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = ['1=1'];
    const params: unknown[] = [];

    if (q.projectId) { where.push('r.project_id = ?'); params.push(Number(q.projectId)); }
    if (q.status && q.status !== 'all') { where.push('r.status = ?'); params.push(Number(q.status)); }
    if (q.q) { where.push('(r.name_cn LIKE ? OR r.name_en LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }

    const [rows] = await pool.query<Row[]>(
      `${BASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.project_id, c.domain, r.id`,
      params
    );

    const rate = await latestRate();
    const items = rows.map((r) => {
      const m = monthlyAmount(Number(r.amountCny), r.cycle);
      return {
        ...r,
        monthlyCny: m,
        monthlyUsd: rate ? round2(m / rate) : null,
        nextDueDate: nextDueDate(r),
      };
    });

    const active = items.filter((i) => i.status && i.autoGenerate);
    const sum = (arr: typeof items) => round2(arr.reduce((s, i) => s + i.monthlyCny, 0));

    return ok({
      items,
      fxRate: rate,
      summary: {
        count: items.length,
        activeCount: active.length,
        monthlyTotalCny: sum(active),
        monthlyTotalUsd: rate ? round2(sum(active) / rate) : null,
        fixedMonthlyCny: sum(active.filter((i) => i.costNature === 'fixed')),
        variableMonthlyCny: sum(active.filter((i) => i.costNature === 'variable')),
      },
    });
  });

  // 摊销计划：未来 N 个月每月应摊金额（含按领域拆分）
  app.get('/amortization', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const months = Math.min(36, Math.max(1, Number(q.months) || 12));
    const startMonth = q.startMonth && /^\d{4}-\d{2}$/.test(q.startMonth) ? q.startMonth : currentMonth();

    const where: string[] = ['r.status = 1'];
    const params: unknown[] = [];
    if (q.projectId) { where.push('r.project_id = ?'); params.push(Number(q.projectId)); }

    const [rows] = await pool.query<Row[]>(
      `${BASE_SELECT} WHERE ${where.join(' AND ')}`,
      params
    );

    const rate = await latestRate();
    const buckets: { ym: string; amountCny: number; byDomain: Map<string, number> }[] = [];
    let ym = startMonth;
    for (let i = 0; i < months; i++) {
      const monthEnd = `${ym}-31`;
      let total = 0;
      const byDomain = new Map<string, number>();
      for (const r of rows) {
        const start = String(r.startDate).slice(0, 10);
        const end = r.endDate ? String(r.endDate).slice(0, 10) : null;
        if (start > monthEnd) continue;
        if (end && end < `${ym}-01`) continue;
        const m = monthlyAmount(Number(r.amountCny), r.cycle);
        total += m;
        byDomain.set(r.domain, round2((byDomain.get(r.domain) ?? 0) + m));
      }
      buckets.push({ ym, amountCny: round2(total), byDomain });
      ym = addMonths(`${ym}-01`, 1).slice(0, 7);
    }

    return ok({
      fxRate: rate,
      startMonth,
      months,
      rows: buckets.map((b) => ({
        ym: b.ym,
        amountCny: b.amountCny,
        amountUsd: rate ? round2(b.amountCny / rate) : null,
        byDomain: [...b.byDomain].map(([domain, cny]) => ({
          domain,
          cny,
          usd: rate ? round2(cny / rate) : null,
        })),
      })),
    });
  });

  // 新增模板
  app.post('/', async (req, reply) => {
    const b = req.body as Record<string, any>;
    const pricingMode =
      b.pricingMode === 'usage' || b.pricingMode === 'metered' ? b.pricingMode : 'fixed';
    const missing = ['projectId', 'categoryId', 'nameCn', 'nameEn', 'cycle', 'startDate'].filter(
      (k) => b[k] === undefined || b[k] === null || b[k] === ''
    );
    // 固定金额模式必须有金额；用量模式必须有单价；metered 模式金额由服务商账单直读。
    if (pricingMode === 'fixed') {
      if (b.amountCny === undefined || b.amountCny === null || b.amountCny === '') missing.push('amountCny');
    } else if (pricingMode === 'usage') {
      if (!Number(b.unitPrice) || Number(b.unitPrice) <= 0) missing.push('unitPrice');
    }
    if (missing.length) {
      reply.code(400);
      return fail(400, `缺少字段：${missing.join(', ')}`);
    }
    if (!CYCLE_MONTHS[b.cycle]) {
      reply.code(400);
      return fail(400, 'cycle 必须为 monthly / quarterly / yearly');
    }

    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO recurring_costs
         (project_id, category_id, supplier_id, name_cn, name_en, amount_cny, cycle, cost_nature,
          pricing_mode, unit_price, unit_price_ccy, unit_label, meter_source,
          start_date, end_date, auto_generate, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        Number(b.projectId), Number(b.categoryId), b.supplierId ? Number(b.supplierId) : null,
        b.nameCn, b.nameEn,
        pricingMode === 'fixed' ? Number(b.amountCny) : 0,
        b.cycle, b.costNature ?? (pricingMode === 'fixed' ? 'fixed' : 'variable'),
        pricingMode,
        pricingMode === 'usage' ? Number(b.unitPrice) : null,
        b.unitPriceCcy ?? 'USD', pricingMode === 'usage' ? (b.unitLabel ?? null) : null, b.meterSource ?? null,
        b.startDate, b.endDate ?? null,
        b.autoGenerate === undefined ? 1 : Number(b.autoGenerate),
        b.status === undefined ? 1 : Number(b.status),
      ]
    );
    const [rows] = await pool.query<Row[]>(`${BASE_SELECT} WHERE r.id = ?`, [res.insertId]);
    reply.code(201);
    return ok({
      ...rows[0],
      monthlyCny: monthlyAmount(Number(rows[0].amountCny), rows[0].cycle),
      nextDueDate: nextDueDate(rows[0]),
    });
  });

  // 更新模板
  app.patch('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as Record<string, any>;
    const map: Record<string, string> = {
      projectId: 'project_id', categoryId: 'category_id', supplierId: 'supplier_id',
      nameCn: 'name_cn', nameEn: 'name_en',
      amountCny: 'amount_cny', cycle: 'cycle', costNature: 'cost_nature',
      pricingMode: 'pricing_mode', unitPrice: 'unit_price', unitPriceCcy: 'unit_price_ccy',
      unitLabel: 'unit_label', meterSource: 'meter_source',
      startDate: 'start_date', endDate: 'end_date', autoGenerate: 'auto_generate', status: 'status',
    };
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of Object.entries(map)) {
      if (b[k] !== undefined) { fields.push(`${col} = ?`); params.push(b[k]); }
    }
    if (!fields.length) {
      reply.code(400);
      return fail(400, '没有可更新的字段');
    }
    params.push(id);
    await pool.query(`UPDATE recurring_costs SET ${fields.join(', ')} WHERE id = ?`, params);
    const [rows] = await pool.query<Row[]>(`${BASE_SELECT} WHERE r.id = ?`, [id]);
    if (!rows.length) { reply.code(404); return fail(404, '周期成本不存在'); }
    return ok({
      ...rows[0],
      monthlyCny: monthlyAmount(Number(rows[0].amountCny), rows[0].cycle),
      nextDueDate: nextDueDate(rows[0]),
    });
  });

  // 删除模板（已生成的流水保留，仅解除关联；计量记录随模板一并清除）
  app.delete('/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    await pool.query('UPDATE transactions SET recurring_id = NULL WHERE recurring_id = ?', [id]);
    await pool.query('DELETE FROM usage_records WHERE recurring_id = ?', [id]);
    await pool.query('DELETE FROM recurring_costs WHERE id = ?', [id]);
    return ok({ id });
  });

  // 生成单条模板的到期流水（幂等）
  app.post('/:id/generate', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = (req.body ?? {}) as { until?: string };
    const until = b.until ?? todayISO();

    const [rows] = await pool.query<Row[]>(`${BASE_SELECT} WHERE r.id = ?`, [id]);
    if (!rows.length) { reply.code(404); return fail(404, '周期成本不存在'); }

    const result = await generateFor(rows[0], until);
    return ok({ id, until, ...result });
  });

  // 预览用量（不落库）：优先取传入的 quantity，否则走计量源
  app.post('/:id/meter/preview', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = (req.body ?? {}) as { period?: string; quantity?: number };
    const period = b.period && /^\d{4}-\d{2}$/.test(b.period) ? b.period : prevPeriod();

    const [rows] = await pool.query<Row[]>(`${BASE_SELECT} WHERE r.id = ?`, [id]);
    if (!rows.length) { reply.code(404); return fail(404, '周期成本不存在'); }
    const t = rows[0];

    const isMetered = t.pricingMode === 'metered';
    const unitPriceCcy = (t.unitPriceCcy as string) ?? 'USD';
    const unitPrice = isMetered
      ? 1
      : t.unitPrice === null || t.unitPrice === undefined ? null : Number(t.unitPrice);
    const unitLabel = isMetered ? unitPriceCcy : ((t.unitLabel as string) ?? 'unit');

    const finish = (quantity: number, source: string, label?: string) => {
      const amountSrc = unitPrice ? round2(quantity * unitPrice) : null;
      return ok({ period, quantity, unitLabel: label ?? unitLabel, unitPrice, unitPriceCcy, source, amountSrc });
    };

    if (b.quantity !== undefined && b.quantity !== null) {
      return finish(Number(b.quantity), 'manual');
    }
    if (!t.meterSource) {
      reply.code(400);
      return fail(
        400,
        isMetered ? '该周期成本未配置计量源，请手工录入账单金额' : '该周期成本未配置计量源，请手工录入用量'
      );
    }
    const reading = await readUsage(String(t.meterSource), period);
    return finish(reading.quantity, reading.source, isMetered ? reading.unit : undefined);
  });

  // 计费：取用量 → 单价折算 → 写计量记录 + 流水（幂等，同期重复调用直接返回既存记录）
  app.post('/:id/bill', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = (req.body ?? {}) as { period?: string; quantity?: number; billedOn?: string };
    const period = b.period && /^\d{4}-\d{2}$/.test(b.period) ? b.period : prevPeriod();
    const quantity =
      b.quantity === undefined || b.quantity === null || b.quantity === ('' as unknown)
        ? undefined
        : Number(b.quantity);

    const [rows] = await pool.query<Row[]>(`${BASE_SELECT} WHERE r.id = ?`, [id]);
    if (!rows.length) { reply.code(404); return fail(404, '周期成本不存在'); }
    const t = rows[0];
    if (t.pricingMode !== 'usage' && t.pricingMode !== 'metered') {
      reply.code(400);
      return fail(400, '该周期成本不是用量/账单计费模式');
    }

    const result = await billUsage(t, period, quantity, b.billedOn);
    reply.code(result.skipped ? 200 : 201);
    return ok(result);
  });

  // 一键生成全部启用模板的到期流水 + 用量计费（幂等）
  app.post('/generate-all', async (req) => {
    const b = (req.body ?? {}) as { until?: string; period?: string };
    const until = b.until ?? todayISO();
    const period = b.period && /^\d{4}-\d{2}$/.test(b.period) ? b.period : prevPeriod();

    const [rows] = await pool.query<Row[]>(
      `${BASE_SELECT} WHERE r.status = 1 AND r.auto_generate = 1 ORDER BY r.id`
    );

    const details: { id: number; nameCn: string; generated: number; lastGenDate: string | null }[] = [];
    const errors: { id: number; nameCn: string; message: string }[] = [];
    let total = 0;

    for (const r of rows) {
      if (r.pricingMode === 'usage' || r.pricingMode === 'metered') {
        // 用量 / 账单计费：仅对起始期早于目标期的模板计费。
        if (periodOf(String(r.startDate)) > period) continue;
        try {
          const res = await billUsage(r, period);
          if (!res.skipped) {
            details.push({ id: r.id as number, nameCn: r.nameCn as string, generated: 1, lastGenDate: res.billedOn });
            total += 1;
          }
        } catch (e) {
          errors.push({ id: r.id as number, nameCn: r.nameCn as string, message: (e as Error).message });
        }
      } else {
        const res = await generateFor(r, until);
        if (res.generated > 0) {
          details.push({ id: r.id as number, nameCn: r.nameCn as string, ...res });
          total += res.generated;
        }
      }
    }
    return ok({ until, period, totalGenerated: total, details, errors });
  });

  // 计量记录列表：展示全部已计费期次，用于核对与调整最终归属
  app.get('/usage-records', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q.period) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(q.period)) { reply.code(400); return fail(400, 'period 必须为 YYYY-MM'); }
      where.push('u.period = ?');
      params.push(q.period);
    }
    if (q.projectId) { where.push('u.project_id = ?'); params.push(Number(q.projectId)); }
    if (q.recurringId) { where.push('u.recurring_id = ?'); params.push(Number(q.recurringId)); }

    const [rows] = await pool.query<Row[]>(
      `${USAGE_SELECT} WHERE ${where.join(' AND ')}
       ORDER BY u.period DESC, u.id DESC LIMIT 500`,
      params
    );
    return ok({ items: rows });
  });

  // 调整计量记录的最终归属（项目 / 科目），并同步更新已生成的流水
  app.patch('/usage-records/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { projectId?: number; categoryId?: number };
    const projectId = Number(body?.projectId);
    const categoryId = Number(body?.categoryId);
    if (!Number.isInteger(id) || !Number.isInteger(projectId) || !Number.isInteger(categoryId)) {
      reply.code(400);
      return fail(400, '请提供有效的项目与科目');
    }

    const [rows] = await pool.query<Row[]>(
      'SELECT id, txn_id AS txnId FROM usage_records WHERE id = ?',
      [id]
    );
    if (!rows.length) { reply.code(404); return fail(404, '用量记录不存在'); }
    const txnId = rows[0].txnId ? Number(rows[0].txnId) : null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await ensureExpenseMapping(conn, projectId, categoryId);
      await conn.query(
        'UPDATE usage_records SET project_id = ?, category_id = ? WHERE id = ?',
        [projectId, categoryId, id]
      );
      // transactions 为权威台账口径，归属调整需同步落库
      if (txnId) {
        await conn.query('UPDATE transactions SET project_id = ?, category_id = ? WHERE id = ?', [
          projectId, categoryId, txnId,
        ]);
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    const [updated] = await pool.query<Row[]>(`${USAGE_SELECT} WHERE u.id = ?`, [id]);
    return ok({ item: updated[0] });
  });
}
