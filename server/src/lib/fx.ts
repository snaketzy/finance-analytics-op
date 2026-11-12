import { pool, type Row } from '../db';

/** 取指定日期（或之前）最近的汇率；无日期则取最新。缺数据直接报错。 */
export async function resolveRate(date?: string): Promise<number> {
  if (date) {
    const [r] = await pool.query<Row[]>(
      'SELECT rate FROM fx_rates WHERE rate_date <= ? ORDER BY rate_date DESC LIMIT 1',
      [date]
    );
    if (r.length) return r[0].rate;
  }
  const [r2] = await pool.query<Row[]>('SELECT rate FROM fx_rates ORDER BY rate_date DESC LIMIT 1');
  if (r2.length) return r2[0].rate;
  throw Object.assign(new Error('缺少汇率数据，请先在「汇率」中录入'), { statusCode: 400 });
}

/** 取最新汇率，无数据时返回 null（供只读汇总接口使用）。 */
export async function latestRate(): Promise<number | null> {
  const [rows] = await pool.query<Row[]>('SELECT rate FROM fx_rates ORDER BY rate_date DESC LIMIT 1');
  return rows.length ? Number(rows[0].rate) : null;
}
