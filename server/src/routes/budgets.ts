import type { FastifyInstance } from 'fastify';
import type { ResultSetHeader } from 'mysql2';
import { pool, type Row } from '../db';
import { ok, fail } from '../http';
import { latestRate } from '../lib/fx';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 按 period 推断周期类型：2026-11 → monthly，2026 → yearly。 */
function inferPeriodType(period: string): 'monthly' | 'yearly' {
  return /^\d{4}-\d{2}$/.test(period) ? 'monthly' : 'yearly';
}

/** 预算 period 覆盖的月份集合：'2026-11' → ['2026-11']；'2026' → 12 个月。 */
function monthsOf(period: string, periodType: string): string[] {
  if (periodType === 'yearly') {
    return Array.from({ length: 12 }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`);
  }
  return [period];
}

function dateBounds(periods: { period: string; periodType: string }[]): { min: string; max: string } {
  let min = '9999-12-31';
  let max = '0000-01-01';
  for (const p of periods) {
    const months = monthsOf(p.period, p.periodType);
    const first = `${months[0]}-01`;
    const last = `${months[months.length - 1]}-31`;
    if (first < min) min = first;
    if (last > max) max = last;
  }
  return { min, max };
}

export default async function (app: FastifyInstance) {
  // 列表 + 预实对比（预算 vs 实际支出），含超预算预警标记
  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = ['1=1'];
    const params: unknown[] = [];

    if (q.projectId) { where.push('b.project_id = ?'); params.push(Number(q.projectId)); }
    if (q.period) { where.push('b.period = ?'); params.push(q.period); }
    if (q.periodType) { where.push('b.period_type = ?'); params.push(q.periodType); }

    const [budgets] = await pool.query<Row[]>(
      `SELECT b.id,
              b.project_id  AS projectId,  p.name_cn AS projectNameCn, p.name_en AS projectNameEn,
              b.category_id AS categoryId, c.name_cn AS categoryNameCn, c.name_en AS categoryNameEn,
              c.domain      AS domain,
              b.period AS period, b.period_type AS periodType, b.amount_cny AS amountCny
         FROM budgets b
         JOIN projects p ON p.id = b.project_id
         LEFT JOIN categories c ON c.id = b.category_id
        WHERE ${where.join(' AND ')}
        ORDER BY b.period DESC, b.project_id, b.category_id IS NOT NULL, b.id`,
      params
    );

    // 实际支出：按 (项目, 科目, 月份) 聚合，仅取预算覆盖的日期区间
    const childOf = new Map<number, number[]>();
    const [cats] = await pool.query<Row[]>('SELECT id, parent_id AS parentId FROM categories');
    for (const c of cats) {
      if (c.parentId === null) continue;
      const list = childOf.get(c.parentId) ?? [];
      list.push(c.id);
      childOf.set(c.parentId, list);
    }

    const byCat = new Map<string, number>();
    const byProject = new Map<string, number>();
    if (budgets.length) {
      const { min, max } = dateBounds(budgets as { period: string; periodType: string }[]);
      const [acts] = await pool.query<Row[]>(
        `SELECT project_id AS projectId, category_id AS categoryId,
                DATE_FORMAT(txn_date, '%Y-%m') AS ym, SUM(amount_cny) AS cny
           FROM transactions
          WHERE direction = 'expense' AND txn_date BETWEEN ? AND ?
          GROUP BY project_id, category_id, ym`,
        [min, max]
      );
      for (const a of acts) {
        const cny = Number(a.cny);
        byCat.set(`${a.projectId}|${a.categoryId}|${a.ym}`, cny);
        byProject.set(`${a.projectId}|${a.ym}`, round2((byProject.get(`${a.projectId}|${a.ym}`) ?? 0) + cny));
      }
    }

    /** 汇总某预算的实际支出。 */
    function actualOf(b: Row): number {
      const months = monthsOf(String(b.period), String(b.periodType));
      let total = 0;
      if (b.categoryId === null) {
        for (const ym of months) total += byProject.get(`${b.projectId}|${ym}`) ?? 0;
      } else {
        const ids = [Number(b.categoryId), ...(childOf.get(Number(b.categoryId)) ?? [])];
        for (const ym of months) {
          for (const id of ids) total += byCat.get(`${b.projectId}|${id}|${ym}`) ?? 0;
        }
      }
      return round2(total);
    }

    const rate = await latestRate();
    const items = budgets.map((b) => {
      const budgetCny = Number(b.amountCny);
      const actualCny = actualOf(b);
      const varianceCny = round2(budgetCny - actualCny);
      return {
        ...b,
        budgetUsd: rate ? round2(budgetCny / rate) : null,
        actualCny,
        actualUsd: rate ? round2(actualCny / rate) : null,
        varianceCny,
        varianceUsd: rate ? round2(varianceCny / rate) : null,
        // 用量：>100% 即超预算
        usageRate: budgetCny > 0 ? round2((actualCny / budgetCny) * 100) : null,
        overBudget: budgetCny > 0 && actualCny > budgetCny,
      };
    });

    const filtered = q.overOnly === '1' ? items.filter((i) => i.overBudget) : items;
    const totalBudget = round2(filtered.reduce((s, i) => s + Number(i.amountCny), 0));
    const totalActual = round2(filtered.reduce((s, i) => s + i.actualCny, 0));

    return ok({
      items: filtered,
      fxRate: rate,
      summary: {
        count: filtered.length,
        totalBudgetCny: totalBudget,
        totalBudgetUsd: rate ? round2(totalBudget / rate) : null,
        totalActualCny: totalActual,
        totalActualUsd: rate ? round2(totalActual / rate) : null,
        usageRate: totalBudget > 0 ? round2((totalActual / totalBudget) * 100) : null,
        overCount: filtered.filter((i) => i.overBudget).length,
      },
    });
  });

  // 新增 / 覆盖预算（同项目 + 同科目 + 同周期唯一）
  app.post('/', async (req, reply) => {
    const b = req.body as Record<string, any>;
    if (!b.projectId || !b.period || b.amountCny === undefined || b.amountCny === '') {
      reply.code(400);
      return fail(400, '缺少字段：projectId, period, amountCny');
    }
    const period = String(b.period);
    const periodType = b.periodType ?? inferPeriodType(period);
    const categoryId = b.categoryId === undefined || b.categoryId === null || b.categoryId === '' ? null : Number(b.categoryId);

    if (categoryId === null) {
      // MySQL 唯一索引不约束 NULL，项目总预算需手动判重后写入
      const [exist] = await pool.query<Row[]>(
        'SELECT id FROM budgets WHERE project_id = ? AND category_id IS NULL AND period = ? LIMIT 1',
        [Number(b.projectId), period]
      );
      if (exist.length) {
        await pool.query('UPDATE budgets SET amount_cny = ?, period_type = ? WHERE id = ?', [
          Number(b.amountCny), periodType, exist[0].id,
        ]);
        reply.code(200);
        return ok({ id: exist[0].id as number, projectId: Number(b.projectId), categoryId: null, period, periodType, amountCny: Number(b.amountCny) });
      }
    }

    await pool.query<ResultSetHeader>(
      `INSERT INTO budgets (project_id, category_id, period, period_type, amount_cny)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE amount_cny = VALUES(amount_cny), period_type = VALUES(period_type)`,
      [Number(b.projectId), categoryId, period, periodType, Number(b.amountCny)]
    );
    const [rows] = await pool.query<Row[]>(
      'SELECT id FROM budgets WHERE project_id = ? AND period = ? AND category_id <=> ? LIMIT 1',
      [Number(b.projectId), period, categoryId]
    );
    reply.code(201);
    return ok({ id: rows[0]?.id ?? null, projectId: Number(b.projectId), categoryId, period, periodType, amountCny: Number(b.amountCny) });
  });

  // 删除预算
  app.delete('/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    await pool.query('DELETE FROM budgets WHERE id = ?', [id]);
    return ok({ id });
  });
}
