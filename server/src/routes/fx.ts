import type { FastifyInstance } from 'fastify';
import { pool, type Row } from '../db';
import { ok } from '../http';
import { FX_PROVIDER, fetchRemoteLatest, syncFxRates } from '../lib/fxSource';

export default async function (app: FastifyInstance) {
  // 线上数据源最新汇率（只读预览，不落库）
  app.get('/remote', async () => {
    const r = await fetchRemoteLatest();
    return ok({ provider: FX_PROVIDER, base: 'USD', quote: 'CNY', ...r });
  });

  // 从线上同步：默认区间 = 库内最新日期 ~ 今天；冲突以线上为准覆盖
  app.post('/sync', async (req) => {
    const b = (req.body ?? {}) as { from?: string; to?: string };
    return ok(await syncFxRates({ from: b.from, to: b.to }));
  });

  app.get('/latest', async () => {
    const [rows] = await pool.query<Row[]>(
      `SELECT rate_date AS rateDate, rate, base_ccy AS baseCcy, quote_ccy AS quoteCcy, source
         FROM fx_rates
        ORDER BY rate_date DESC
        LIMIT 1`
    );
    return ok(rows[0] ?? null);
  });

  app.get('/', async (req) => {
    const q = req.query as { from?: string; to?: string };
    const params: unknown[] = [];
    const where: string[] = ['1=1'];
    if (q.from) { where.push('rate_date >= ?'); params.push(q.from); }
    if (q.to) { where.push('rate_date <= ?'); params.push(q.to); }
    const [rows] = await pool.query<Row[]>(
      `SELECT rate_date AS rateDate, rate, source
         FROM fx_rates
        WHERE ${where.join(' AND ')}
        ORDER BY rate_date DESC
        LIMIT 400`,
      params
    );
    return ok(rows);
  });

  // 手动录入 / 覆盖某日汇率（1 USD = ? CNY）
  app.post('/', async (req, reply) => {
    const b = req.body as { rateDate?: string; rate?: number };
    if (!b.rateDate || !b.rate || Number(b.rate) <= 0) {
      reply.code(400);
      return { code: 400, message: '需提供 rateDate 与正数 rate', data: null };
    }
    await pool.query(
      `INSERT INTO fx_rates (rate_date, base_ccy, quote_ccy, rate, source)
       VALUES (?, 'CNY', 'USD', ?, 'manual')
       ON DUPLICATE KEY UPDATE rate = VALUES(rate), source = 'manual'`,
      [b.rateDate, b.rate]
    );
    reply.code(201);
    return ok({ rateDate: b.rateDate, rate: Number(b.rate) });
  });

  // 删除某日汇率（仅用于清理手动录入的占位数据）
  app.delete('/:rateDate', async (req, reply) => {
    const { rateDate } = req.params as { rateDate: string };
    const [res] = await pool.query<import('mysql2').ResultSetHeader>(
      'DELETE FROM fx_rates WHERE rate_date = ?',
      [rateDate]
    );
    if (res.affectedRows === 0) {
      reply.code(404);
      return { code: 404, message: `无 ${rateDate} 的汇率记录`, data: null };
    }
    return ok({ rateDate, deleted: res.affectedRows });
  });
}
