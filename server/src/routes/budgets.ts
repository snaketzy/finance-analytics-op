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
    const [year, month] = months[months.length - 1].split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const last = `${months[months.length - 1]}-${String(lastDay).padStart(2, '0')}`;
    if (first < min) min = first;
    if (last > max) max = last;
  }
  return { min, max };
}

function normalizeBudgetInput(body: Record<string, any>) {
  const projectId = Number(body.projectId);
  const period = String(body.period ?? '');
  const periodType = String(body.periodType ?? inferPeriodType(period));
  const amountCny = Number(body.amountCny);
  const categoryId =
    body.categoryId === undefined || body.categoryId === null || body.categoryId === '' ? null : Number(body.categoryId);
  return { projectId, categoryId, period, periodType, amountCny };
}

function normalizeName(value: unknown) {
  return String(value ?? '').trim();
}

async function loadCategoryChildren() {
  const childOf = new Map<number, number[]>();
  const [cats] = await pool.query<Row[]>('SELECT id, parent_id AS parentId FROM categories');
  for (const c of cats) {
    if (c.parentId === null) continue;
    const list = childOf.get(c.parentId) ?? [];
    list.push(Number(c.id));
    childOf.set(Number(c.parentId), list);
  }
  return childOf;
}

async function loadSupplierLookup() {
  const nameToIds = new Map<string, number[]>();
  const [rows] = await pool.query<Row[]>('SELECT id, name_cn AS nameCn, name_en AS nameEn FROM suppliers');
  for (const row of rows) {
    const id = Number(row.id);
    const names = Array.from(new Set([normalizeName(row.nameCn), normalizeName(row.nameEn)].filter(Boolean)));
    for (const name of names) {
      const ids = nameToIds.get(name) ?? [];
      if (!ids.includes(id)) ids.push(id);
      nameToIds.set(name, ids);
    }
  }
  return { nameToIds };
}

type BudgetScope = {
  projectId: number;
  categoryId: number | null;
  period: string;
  periodType: string;
};

async function ensureBudgetRefs(projectId: number, categoryId: number | null) {
  const [projects] = await pool.query<Row[]>('SELECT id FROM projects WHERE id = ? LIMIT 1', [projectId]);
  if (!projects.length) throw Object.assign(new Error('项目不存在'), { statusCode: 400 });

  if (categoryId !== null) {
    const [categories] = await pool.query<Row[]>(
      'SELECT id FROM categories WHERE id = ? AND type = ? LIMIT 1',
      [categoryId, 'expense']
    );
    if (!categories.length) throw Object.assign(new Error('预算对象不存在，或不是支出科目'), { statusCode: 400 });
  }
}

type ActualMaps = {
  byCat: Map<string, number>;
  byProject: Map<string, number>;
  byCatSuppliers: Map<string, Set<string>>;
  byProjectSuppliers: Map<string, Set<string>>;
};

async function buildActualMaps(
  periods: { period: string; periodType: string }[],
  supplierNameToIds: Map<string, number[]>
): Promise<ActualMaps> {
  const byCat = new Map<string, number>();
  const byProject = new Map<string, number>();
  const byCatSuppliers = new Map<string, Set<string>>();
  const byProjectSuppliers = new Map<string, Set<string>>();
  if (!periods.length) {
    return { byCat, byProject, byCatSuppliers, byProjectSuppliers };
  }

  const { min, max } = dateBounds(periods);
  const [acts] = await pool.query<Row[]>(
    `SELECT project_id AS projectId, category_id AS categoryId,
            DATE_FORMAT(txn_date, '%Y-%m') AS ym,
            TRIM(COALESCE(counterparty, '')) AS counterparty,
            SUM(amount_cny) AS cny
       FROM transactions
      WHERE direction = 'expense' AND txn_date BETWEEN ? AND ?
      GROUP BY project_id, category_id, ym, TRIM(COALESCE(counterparty, ''))`,
    [min, max]
  );
  for (const a of acts) {
    const projectId = Number(a.projectId);
    const categoryId = Number(a.categoryId);
    const ym = String(a.ym);
    const cny = Number(a.cny);
    const counterparty = normalizeName(a.counterparty);

    const catKey = `${projectId}|${categoryId}|${ym}`;
    const projectKey = `${projectId}|${ym}`;
    byCat.set(catKey, round2((byCat.get(catKey) ?? 0) + cny));
    byProject.set(projectKey, round2((byProject.get(projectKey) ?? 0) + cny));

    if (!counterparty) continue;
    const catSuppliers = byCatSuppliers.get(catKey) ?? new Set<string>();
    catSuppliers.add(counterparty);
    byCatSuppliers.set(catKey, catSuppliers);
    const projectSuppliers = byProjectSuppliers.get(projectKey) ?? new Set<string>();
    projectSuppliers.add(counterparty);
    byProjectSuppliers.set(projectKey, projectSuppliers);
  }
  return { byCat, byProject, byCatSuppliers, byProjectSuppliers };
}

function actualOfBudget(
  b: BudgetScope,
  childOf: Map<number, number[]>,
  maps: Pick<ActualMaps, 'byCat' | 'byProject'>
) {
  const months = monthsOf(String(b.period), String(b.periodType));
  let total = 0;
  if (b.categoryId === null) {
    for (const ym of months) total += maps.byProject.get(`${b.projectId}|${ym}`) ?? 0;
  } else {
    const ids = [Number(b.categoryId), ...(childOf.get(Number(b.categoryId)) ?? [])];
    for (const ym of months) {
      for (const id of ids) total += maps.byCat.get(`${b.projectId}|${id}|${ym}`) ?? 0;
    }
  }
  return round2(total);
}

function suppliersOfBudget(
  b: BudgetScope,
  childOf: Map<number, number[]>,
  byCatSuppliers: Map<string, Set<string>>,
  byProjectSuppliers: Map<string, Set<string>>
) {
  const months = monthsOf(String(b.period), String(b.periodType));
  const names = new Set<string>();
  if (b.categoryId === null) {
    for (const ym of months) {
      for (const supplier of byProjectSuppliers.get(`${b.projectId}|${ym}`) ?? []) names.add(supplier);
    }
  } else {
    const ids = [Number(b.categoryId), ...(childOf.get(Number(b.categoryId)) ?? [])];
    for (const ym of months) {
      for (const id of ids) {
        for (const supplier of byCatSuppliers.get(`${b.projectId}|${id}|${ym}`) ?? []) names.add(supplier);
      }
    }
  }
  return Array.from(names).sort((a, b2) => a.localeCompare(b2, 'zh-Hans-CN'));
}

async function findBudgetId(projectId: number, categoryId: number | null, period: string) {
  const [rows] = await pool.query<Row[]>(
    'SELECT id FROM budgets WHERE project_id = ? AND period = ? AND category_id <=> ? LIMIT 1',
    [projectId, period, categoryId]
  );
  return rows[0]?.id ? Number(rows[0].id) : null;
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
              b.project_id AS projectId, p.name_cn AS projectNameCn, p.name_en AS projectNameEn,
              b.category_id AS categoryId, c.name_cn AS categoryNameCn, c.name_en AS categoryNameEn,
              c.domain AS domain,
              b.supplier_id AS supplierId, s.name_cn AS supplierNameCn, s.name_en AS supplierNameEn,
              b.period AS period, b.period_type AS periodType, b.amount_cny AS amountCny
         FROM budgets b
         JOIN projects p ON p.id = b.project_id
         LEFT JOIN categories c ON c.id = b.category_id
         LEFT JOIN suppliers s ON s.id = b.supplier_id
        WHERE ${where.join(' AND ')}
        ORDER BY b.period DESC, b.project_id, b.category_id IS NOT NULL, b.id`,
      params
    );

    const projectIds = Array.from(new Set(budgets.map((b) => Number(b.projectId)).filter(Number.isFinite)));
    const projectProducts = new Map<number, { productId: number; nameCn: string; nameEn: string; ratio: number }[]>();
    if (projectIds.length) {
      const [productRows] = await pool.query<Row[]>(
        `SELECT pp.project_id AS projectId, pp.product_id AS productId, pp.ratio,
                pr.name_cn AS nameCn, pr.name_en AS nameEn
           FROM product_projects pp
           JOIN products pr ON pr.id = pp.product_id
          WHERE pp.project_id IN (?) AND pp.effective_to IS NULL
          ORDER BY pp.project_id, pp.ratio DESC, pp.product_id`,
        [projectIds]
      );
      for (const row of productRows) {
        const list = projectProducts.get(Number(row.projectId)) ?? [];
        list.push({
          productId: Number(row.productId),
          nameCn: String(row.nameCn),
          nameEn: String(row.nameEn),
          ratio: Number(row.ratio),
        });
        projectProducts.set(Number(row.projectId), list);
      }
    }

    const childOf = await loadCategoryChildren();
    const { nameToIds } = await loadSupplierLookup();
    const maps = await buildActualMaps(budgets as { period: string; periodType: string }[], nameToIds);

    const rate = await latestRate();
    const items = budgets.map((b) => {
      const scope: BudgetScope = {
        projectId: Number(b.projectId),
        categoryId: b.categoryId === null ? null : Number(b.categoryId),
        period: String(b.period),
        periodType: String(b.periodType),
      };
      const budgetCny = Number(b.amountCny);
      const actualCny = actualOfBudget(scope, childOf, maps);
      const suppliers = suppliersOfBudget(scope, childOf, maps.byCatSuppliers, maps.byProjectSuppliers);
      const varianceCny = round2(budgetCny - actualCny);
      return {
        ...b,
        products: projectProducts.get(Number(b.projectId)) ?? [],
        suppliers,
        amountCny: budgetCny,
        budgetUsd: rate ? round2(budgetCny / rate) : null,
        actualCny,
        actualUsd: rate ? round2(actualCny / rate) : null,
        varianceCny,
        varianceUsd: rate ? round2(varianceCny / rate) : null,
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

  // 新增 / 覆盖预算（同项目 + 同科目 + 同供应商 + 同周期唯一）
  app.post('/', async (req, reply) => {
    const b = req.body as Record<string, any>;
    if (!b.projectId || !b.period || b.amountCny === undefined || b.amountCny === '') {
      reply.code(400);
      return fail(400, '缺少字段：projectId, period, amountCny');
    }
    const { projectId, categoryId, period, periodType, amountCny } = normalizeBudgetInput(b);

    try {
      await ensureBudgetRefs(projectId, categoryId);
    } catch (error) {
      reply.code((error as { statusCode?: number }).statusCode ?? 400);
      return fail((error as { statusCode?: number }).statusCode ?? 400, (error as Error).message);
    }

    const existId = await findBudgetId(projectId, categoryId, period);
    if (existId) {
      await pool.query(
        'UPDATE budgets SET amount_cny = ?, period_type = ?, supplier_id = NULL WHERE id = ?',
        [amountCny, periodType, existId]
      );
      reply.code(200);
      return ok({ id: existId, projectId, categoryId, period, periodType, amountCny });
    }

    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO budgets (project_id, category_id, supplier_id, period, period_type, amount_cny)
       VALUES (?,?,?,?,?,?)`,
      [projectId, categoryId, null, period, periodType, amountCny]
    );
    reply.code(201);
    return ok({ id: res.insertId, projectId, categoryId, period, periodType, amountCny });
  });

  // 更新预算
  app.patch('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as Record<string, any>;
    if (!b.projectId || !b.period || b.amountCny === undefined || b.amountCny === '') {
      reply.code(400);
      return fail(400, '缺少字段：projectId, period, amountCny');
    }

    const { projectId, categoryId, period, periodType, amountCny } = normalizeBudgetInput(b);
    const [currentRows] = await pool.query<Row[]>('SELECT id FROM budgets WHERE id = ? LIMIT 1', [id]);
    if (!currentRows.length) {
      reply.code(404);
      return fail(404, '预算不存在');
    }

    try {
      await ensureBudgetRefs(projectId, categoryId);
    } catch (error) {
      reply.code((error as { statusCode?: number }).statusCode ?? 400);
      return fail((error as { statusCode?: number }).statusCode ?? 400, (error as Error).message);
    }

    const [conflictRows] = await pool.query<Row[]>(
      'SELECT id FROM budgets WHERE project_id = ? AND period = ? AND category_id <=> ? AND id <> ? LIMIT 1',
      [projectId, period, categoryId, id]
    );
    if (conflictRows.length) {
      reply.code(409);
      return fail(409, '该项目、预算对象和周期下已存在预算记录');
    }

    const [res] = await pool.query<ResultSetHeader>(
      `UPDATE budgets
          SET project_id = ?, category_id = ?, supplier_id = NULL, period = ?, period_type = ?, amount_cny = ?
        WHERE id = ?`,
      [projectId, categoryId, period, periodType, amountCny, id]
    );
    if (!res.affectedRows) {
      reply.code(404);
      return fail(404, '预算不存在');
    }
    return ok({ id, projectId, categoryId, period, periodType, amountCny });
  });

  // 删除预算
  app.delete('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [rows] = await pool.query<Row[]>(
      `SELECT id, project_id AS projectId, category_id AS categoryId, supplier_id AS supplierId,
              period, period_type AS periodType
         FROM budgets WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      reply.code(404);
      return fail(404, '预算不存在');
    }
    const childOf = await loadCategoryChildren();
    const { nameToIds } = await loadSupplierLookup();
    const maps = await buildActualMaps([{ period: String(rows[0].period), periodType: String(rows[0].periodType) }], nameToIds);
    const actualCny = actualOfBudget(
      {
        projectId: Number(rows[0].projectId),
        categoryId: rows[0].categoryId === null ? null : Number(rows[0].categoryId),
        period: String(rows[0].period),
        periodType: String(rows[0].periodType),
      },
      childOf,
      maps
    );
    if (actualCny > 0) {
      reply.code(409);
      return fail(409, `该预算项已有实际支出（¥${actualCny}），不允许删除`);
    }
    await pool.query('DELETE FROM budgets WHERE id = ?', [id]);
    return ok({ id });
  });
}
