import type { FastifyInstance } from 'fastify';
import { pool, type Row } from '../db';
import { ok, fail } from '../http';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 'YYYY-MM' 上加减自然月。 */
function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

type GroupBy = 'domain' | 'category' | 'project' | 'account' | 'month';

const GROUP_SQL: Record<GroupBy, string> = {
  domain: `c.domain AS \`key\`, NULL AS nameCn, NULL AS nameEn, c.domain AS domain`,
  category: `CAST(c.id AS CHAR) AS \`key\`, c.name_cn AS nameCn, c.name_en AS nameEn, c.domain AS domain`,
  project: `CAST(p.id AS CHAR) AS \`key\`, p.name_cn AS nameCn, p.name_en AS nameEn, NULL AS domain`,
  account: `COALESCE(CAST(a.id AS CHAR), 'none') AS \`key\`,
            COALESCE(a.name_cn, '未指定账户') AS nameCn,
            COALESCE(a.name_en, 'Unassigned') AS nameEn, NULL AS domain`,
  month: `DATE_FORMAT(t.txn_date, '%Y-%m') AS \`key\`, NULL AS nameCn, NULL AS nameEn, NULL AS domain`,
};

const GROUP_BY_COL: Record<GroupBy, string> = {
  domain: 'c.domain',
  category: 'c.id, c.name_cn, c.name_en, c.domain',
  project: 'p.id, p.name_cn, p.name_en',
  account: 'a.id, a.name_cn, a.name_en',
  month: "DATE_FORMAT(t.txn_date, '%Y-%m')",
};

const GROUP_JOINS: Record<GroupBy, string> = {
  domain: 'JOIN categories c ON c.id = t.category_id',
  category: 'JOIN categories c ON c.id = t.category_id',
  project: 'JOIN projects p ON p.id = t.project_id',
  account: 'LEFT JOIN accounts a ON a.id = t.account_id',
  month: '',
};

/** 成本 / 收入共用的一套多维分析。 */
async function analyze(
  direction: 'income' | 'expense',
  groupBy: GroupBy,
  q: Record<string, string | undefined>
) {
  const where: string[] = ['t.direction = ?'];
  const params: unknown[] = [direction];
  if (q.projectId) { where.push('t.project_id = ?'); params.push(Number(q.projectId)); }
  if (q.domain) { where.push('c.domain = ?'); params.push(q.domain); }
  if (q.from) { where.push('t.txn_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('t.txn_date <= ?'); params.push(q.to); }
  const whereSql = where.join(' AND ');

  // 1) 合计
  const [tot] = await pool.query<Row[]>(
    `SELECT COALESCE(SUM(t.amount_cny), 0) AS cny, COALESCE(SUM(t.amount_usd), 0) AS usd,
            COUNT(*) AS txnCount
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
      WHERE ${whereSql}`,
    params
  );
  const totalCny = Number(tot[0]?.cny ?? 0);
  const totalUsd = Number(tot[0]?.usd ?? 0);

  // 2) 多维拆分（categories 始终以别名 c 连接，供 domain 过滤与分组复用）
  const extraJoin = GROUP_JOINS[groupBy].includes('categories') ? '' : GROUP_JOINS[groupBy];
  const [breakdown] = await pool.query<Row[]>(
    `SELECT ${GROUP_SQL[groupBy]},
            COALESCE(SUM(t.amount_cny), 0) AS cny,
            COALESCE(SUM(t.amount_usd), 0) AS usd,
            COUNT(*) AS txnCount
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       ${extraJoin}
      WHERE ${whereSql}
      GROUP BY ${GROUP_BY_COL[groupBy]}
      ORDER BY cny DESC`,
    params
  );

  // 3) 月度趋势（无论 groupBy 为何，都给出时间序列）
  const [monthly] = await pool.query<Row[]>(
    `SELECT DATE_FORMAT(t.txn_date, '%Y-%m') AS ym,
            COALESCE(SUM(t.amount_cny), 0) AS cny,
            COALESCE(SUM(t.amount_usd), 0) AS usd,
            COUNT(*) AS txnCount
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
      WHERE ${whereSql}
      GROUP BY ym
      ORDER BY ym`,
    params
  );

  let cumCny = 0;
  let cumUsd = 0;
  const monthlyRows = monthly.map((m) => {
    cumCny = round2(cumCny + Number(m.cny));
    cumUsd = round2(cumUsd + Number(m.usd));
    return {
      ym: m.ym as string,
      cny: Number(m.cny),
      usd: Number(m.usd),
      txnCount: Number(m.txnCount),
      cumCny,
      cumUsd,
    };
  });

  // 4) 环比 / 同比：以区间内最后一个月为「本期」
  const lastYm =
    monthlyRows.length > 0 ? monthlyRows[monthlyRows.length - 1].ym : new Date().toISOString().slice(0, 7);
  const prevYm = shiftMonth(lastYm, -1);
  const yoyYm = shiftMonth(lastYm, -12);

  const cmpWhere: string[] = ['t.direction = ?'];
  const cmpParams: unknown[] = [direction];
  if (q.projectId) { cmpWhere.push('t.project_id = ?'); cmpParams.push(Number(q.projectId)); }
  if (q.from) { cmpWhere.push('t.txn_date >= ?'); cmpParams.push(q.from); }
  if (q.to) { cmpWhere.push('t.txn_date <= ?'); cmpParams.push(q.to); }
  const [cmp] = await pool.query<Row[]>(
    `SELECT DATE_FORMAT(t.txn_date, '%Y-%m') AS ym,
            COALESCE(SUM(t.amount_cny), 0) AS cny,
            COALESCE(SUM(t.amount_usd), 0) AS usd
       FROM transactions t
      WHERE ${cmpWhere.join(' AND ')} AND DATE_FORMAT(t.txn_date, '%Y-%m') IN (?, ?, ?)
      GROUP BY ym`,
    [...cmpParams, lastYm, prevYm, yoyYm]
  );
  const pick = (ym: string) => {
    const r = cmp.find((c) => c.ym === ym);
    return { ym, cny: Number(r?.cny ?? 0), usd: Number(r?.usd ?? 0) };
  };
  const cur = monthlyRows.length > 0 ? { ym: lastYm, cny: monthlyRows[monthlyRows.length - 1].cny, usd: monthlyRows[monthlyRows.length - 1].usd } : pick(lastYm);
  const prev = pick(prevYm);
  const yoy = pick(yoyYm);
  const pct = (a: number, b: number) => (b > 0 ? round2(((a - b) / b) * 100) : null);

  // 5) 成本的收入对照（仅用于成本分析口径）
  let revenueCny: number | null = null;
  let revenueUsd: number | null = null;
  if (direction === 'expense') {
    const revWhere: string[] = ["t.direction = 'income'"];
    const revParams: unknown[] = [];
    if (q.projectId) { revWhere.push('t.project_id = ?'); revParams.push(Number(q.projectId)); }
    if (q.from) { revWhere.push('t.txn_date >= ?'); revParams.push(q.from); }
    if (q.to) { revWhere.push('t.txn_date <= ?'); revParams.push(q.to); }
    const [rev] = await pool.query<Row[]>(
      `SELECT COALESCE(SUM(t.amount_cny), 0) AS cny, COALESCE(SUM(t.amount_usd), 0) AS usd
         FROM transactions t WHERE ${revWhere.join(' AND ')}`,
      revParams
    );
    revenueCny = Number(rev[0]?.cny ?? 0);
    revenueUsd = Number(rev[0]?.usd ?? 0);
  }

  return {
    direction,
    groupBy,
    total: {
      cny: round2(totalCny),
      usd: round2(totalUsd),
      txnCount: Number(tot[0]?.txnCount ?? 0),
      revenueCny,
      revenueUsd,
      costRatio: revenueCny && revenueCny > 0 ? round2((totalCny / revenueCny) * 100) : null,
    },
    breakdown: breakdown.map((b) => ({
      key: String(b.key),
      nameCn: b.nameCn,
      nameEn: b.nameEn,
      domain: b.domain,
      cny: Number(b.cny),
      usd: Number(b.usd),
      txnCount: Number(b.txnCount),
      share: totalCny > 0 ? round2((Number(b.cny) / totalCny) * 100) : 0,
    })),
    monthly: monthlyRows,
    comparison: {
      current: cur,
      mom: { ...prev, deltaCny: round2(cur.cny - prev.cny), deltaPct: pct(cur.cny, prev.cny) },
      yoy: { ...yoy, deltaCny: round2(cur.cny - yoy.cny), deltaPct: pct(cur.cny, yoy.cny) },
    },
  };
}

const VALID: GroupBy[] = ['domain', 'category', 'project', 'account', 'month'];

export default async function (app: FastifyInstance) {
  app.get('/cost', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const groupBy = (q.groupBy ?? 'domain') as GroupBy;
    if (!VALID.includes(groupBy)) {
      reply.code(400);
      return fail(400, `groupBy 必须为 ${VALID.join(' / ')}`);
    }
    return ok(await analyze('expense', groupBy, q));
  });

  app.get('/revenue', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const groupBy = (q.groupBy ?? 'project') as GroupBy;
    if (!VALID.includes(groupBy)) {
      reply.code(400);
      return fail(400, `groupBy 必须为 ${VALID.join(' / ')}`);
    }
    return ok(await analyze('income', groupBy, q));
  });
}
