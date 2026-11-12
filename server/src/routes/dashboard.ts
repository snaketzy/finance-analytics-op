import type { FastifyInstance } from 'fastify';
import { pool, type Row } from '../db';
import { ok } from '../http';

export default async function (app: FastifyInstance) {
  // 总览：合计 + 按领域 + 按月趋势
  app.get('/summary', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q.projectId) { where.push('t.project_id = ?'); params.push(Number(q.projectId)); }
    if (q.from) { where.push('t.txn_date >= ?'); params.push(q.from); }
    if (q.to) { where.push('t.txn_date <= ?'); params.push(q.to); }
    const whereSql = where.join(' AND ');

    const [tot] = await pool.query<Row[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN t.direction='income'  THEN t.amount_cny ELSE 0 END), 0) AS revenueCny,
         COALESCE(SUM(CASE WHEN t.direction='expense' THEN t.amount_cny ELSE 0 END), 0) AS expenseCny,
         COALESCE(SUM(CASE WHEN t.direction='income'  THEN t.amount_usd ELSE 0 END), 0) AS revenueUsd,
         COALESCE(SUM(CASE WHEN t.direction='expense' THEN t.amount_usd ELSE 0 END), 0) AS expenseUsd,
         COUNT(*) AS txnCount
       FROM transactions t
      WHERE ${whereSql}`,
      params
    );

    const [byDomain] = await pool.query<Row[]>(
      `SELECT c.domain AS domain,
              COALESCE(SUM(CASE WHEN t.direction='income'  THEN t.amount_cny ELSE 0 END), 0) AS incomeCny,
              COALESCE(SUM(CASE WHEN t.direction='expense' THEN t.amount_cny ELSE 0 END), 0) AS expenseCny,
              COALESCE(SUM(CASE WHEN t.direction='income'  THEN t.amount_usd ELSE 0 END), 0) AS incomeUsd,
              COALESCE(SUM(CASE WHEN t.direction='expense' THEN t.amount_usd ELSE 0 END), 0) AS expenseUsd
         FROM transactions t
         JOIN categories c ON c.id = t.category_id
        WHERE ${whereSql}
        GROUP BY c.domain
        ORDER BY (incomeCny + expenseCny) DESC`,
      params
    );

    const [monthly] = await pool.query<Row[]>(
      `SELECT DATE_FORMAT(t.txn_date, '%Y-%m') AS ym,
              COALESCE(SUM(CASE WHEN t.direction='income'  THEN t.amount_cny ELSE 0 END), 0) AS incomeCny,
              COALESCE(SUM(CASE WHEN t.direction='expense' THEN t.amount_cny ELSE 0 END), 0) AS expenseCny,
              COALESCE(SUM(CASE WHEN t.direction='income'  THEN t.amount_usd ELSE 0 END), 0) AS incomeUsd,
              COALESCE(SUM(CASE WHEN t.direction='expense' THEN t.amount_usd ELSE 0 END), 0) AS expenseUsd
         FROM transactions t
        WHERE ${whereSql}
        GROUP BY ym
        ORDER BY ym`,
      params
    );

    const [topCats] = await pool.query<Row[]>(
      `SELECT c.id AS categoryId, c.name_cn AS nameCn, c.name_en AS nameEn, c.type AS type, c.domain AS domain,
              COALESCE(SUM(t.amount_cny), 0) AS amountCny,
              COALESCE(SUM(t.amount_usd), 0) AS amountUsd
         FROM transactions t
         JOIN categories c ON c.id = t.category_id
        WHERE ${whereSql}
        GROUP BY c.id, c.name_cn, c.name_en, c.type, c.domain
        ORDER BY amountCny DESC
        LIMIT 10`,
      params
    );

    const [fx] = await pool.query<Row[]>(
      'SELECT rate_date AS rateDate, rate FROM fx_rates ORDER BY rate_date DESC LIMIT 1'
    );

    const t = tot[0] ?? {};
    const revenueCny = Number(t.revenueCny ?? 0);
    const expenseCny = Number(t.expenseCny ?? 0);
    const revenueUsd = Number(t.revenueUsd ?? 0);
    const expenseUsd = Number(t.expenseUsd ?? 0);

    return ok({
      fxRate: fx[0]?.rate ?? null,
      fxRateDate: fx[0]?.rateDate ?? null,
      revenueCny, expenseCny, revenueUsd, expenseUsd,
      netCny: revenueCny - expenseCny,
      netUsd: revenueUsd - expenseUsd,
      txnCount: Number(t.txnCount ?? 0),
      byDomain,
      monthly,
      topCategories: topCats,
    });
  });
}
