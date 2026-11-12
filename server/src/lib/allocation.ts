import { pool, type Row } from '../db';
import type { Actuals } from './unitEconomics';

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 近 months 个自然月（含当月）的起始日，返回 YYYY-MM-01。
 * 月均分母固定取 months，空缺月份按 0 计入，保证跨产品可比。
 */
function windowStartISO(months: number): string {
  const now = new Date();
  const total = now.getFullYear() * 12 + now.getMonth() - (Math.max(1, months) - 1);
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

/** 产品 ←→ 项目的单条分摊记录（时间版本化）。 */
export type Allocation = {
  id: number;
  productId: number;
  projectId: number;
  ratio: number;
  effectiveFrom: string;
  effectiveTo: string | null;
};

/** 产品组成项目的下钻明细（原始 + 分摊后）。 */
export type Composition = {
  projectId: number;
  code: string;
  nameCn: string;
  nameEn: string;
  ratio: number;
  effectiveFrom: string;
  rawRevenueCny: number;
  rawCostCny: number;
  allocRevenueCny: number;
  allocCostCny: number;
};

/** 项目视角：某项目在各引用产品间的收支比重（为「项目入口」预留）。 */
export type ProjectShare = {
  productId: number;
  code: string;
  nameCn: string;
  nameEn: string;
  ratio: number;
  allocRevenueCny: number;
  allocCostCny: number;
  revenueShare: number;
  costShare: number;
};

const ALLOC_COLS = `id, product_id AS productId, project_id AS projectId,
  ratio, effective_from AS effectiveFrom, effective_to AS effectiveTo`;

function mapAlloc(r: Row): Allocation {
  return {
    id: Number(r.id),
    productId: Number(r.productId),
    projectId: Number(r.projectId),
    ratio: Number(r.ratio),
    effectiveFrom: String(r.effectiveFrom),
    effectiveTo: r.effectiveTo ? String(r.effectiveTo) : null,
  };
}

/** 某产品当前生效的项目分摊（effective_to IS NULL）。 */
export async function loadActiveAllocations(productId: number): Promise<Allocation[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${ALLOC_COLS} FROM product_projects
      WHERE product_id = ? AND effective_to IS NULL ORDER BY id`,
    [productId]
  );
  return rows.map(mapAlloc);
}

/** 某产品全部分摊记录（含历史版本）。 */
export async function loadAllocations(productId: number): Promise<Allocation[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${ALLOC_COLS} FROM product_projects
      WHERE product_id = ? ORDER BY project_id, effective_from`,
    [productId]
  );
  return rows.map(mapAlloc);
}

/** 某项目当前生效的全部产品分摊（校验合计 = 1 与项目视角）。 */
export async function loadProjectActiveAllocations(projectId: number): Promise<Allocation[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${ALLOC_COLS} FROM product_projects
      WHERE project_id = ? AND effective_to IS NULL ORDER BY id`,
    [projectId]
  );
  return rows.map(mapAlloc);
}

/** 某项目当前生效分摊比例合计。 */
export async function activeRatioSum(projectId: number): Promise<number> {
  const [rows] = await pool.query<Row[]>(
    `SELECT COALESCE(SUM(ratio), 0) AS s FROM product_projects
      WHERE project_id = ? AND effective_to IS NULL`,
    [projectId]
  );
  return Number(rows[0]?.s ?? 0);
}

/**
 * 以 effectiveFrom 为新版本起点，重设某项目的全部产品分摊：
 *   删除起点 >= effectiveFrom 的版本 → 关闭此前仍生效的版本 → 写入新版本。
 * 历史月份因此始终按「当时生效」的比例复算。
 */
export async function applyAllocationVersion(
  projectId: number,
  items: { productId: number; ratio: number }[],
  effectiveFrom: string
): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM product_projects WHERE project_id = ? AND effective_from >= ?', [
      projectId,
      effectiveFrom,
    ]);
    await conn.query(
      `UPDATE product_projects SET effective_to = DATE_SUB(?, INTERVAL 1 DAY)
        WHERE project_id = ? AND effective_to IS NULL AND effective_from < ?`,
      [effectiveFrom, projectId, effectiveFrom]
    );
    for (const it of items) {
      await conn.query(
        `INSERT INTO product_projects (product_id, project_id, ratio, effective_from) VALUES (?,?,?,?)`,
        [it.productId, projectId, it.ratio, effectiveFrom]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** 按分摊比例汇总某产品的实际收入/成本（近 lookbackMonths 个自然月，月均口径）。 */
export async function loadProductActuals(productId: number, lookbackMonths: number): Promise<Actuals> {
  const [rows] = await pool.query<Row[]>(
    `SELECT DATE_FORMAT(t.txn_date, '%Y-%m') AS ym,
            COALESCE(SUM(CASE WHEN t.direction='income'  THEN t.amount_cny * pp.ratio ELSE 0 END), 0) AS revenueCny,
            COALESCE(SUM(CASE WHEN t.direction='expense' AND c.is_cogs=1 THEN t.amount_cny * pp.ratio ELSE 0 END), 0) AS variableCny,
            COALESCE(SUM(CASE WHEN t.direction='expense' AND c.is_cogs=0 THEN t.amount_cny * pp.ratio ELSE 0 END), 0) AS fixedCny
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       JOIN product_projects pp
         ON pp.project_id = t.project_id
        AND pp.product_id = ?
        AND pp.effective_from <= t.txn_date
        AND (pp.effective_to IS NULL OR t.txn_date <= pp.effective_to)
      WHERE t.txn_date >= ?
      GROUP BY ym
      ORDER BY ym DESC`,
    [productId, windowStartISO(lookbackMonths)]
  );

  const byMonth = rows.map((r) => ({
    ym: String(r.ym),
    revenueCny: Number(r.revenueCny),
    fixedCny: Number(r.fixedCny),
    variableCny: Number(r.variableCny),
  }));
  const months = Math.max(1, lookbackMonths);
  const trend = byMonth
    .map((r) => ({
      ym: r.ym,
      revenueCny: r.revenueCny,
      costCny: r2(r.fixedCny + r.variableCny),
      netCny: r2(r.revenueCny - r.fixedCny - r.variableCny),
    }))
    .reverse();

  const sum = (f: (m: (typeof byMonth)[number]) => number) => byMonth.reduce((s, m) => s + f(m), 0);
  return {
    months,
    revenueCny: r2(sum((m) => m.revenueCny) / months),
    fixedCostCny: r2(sum((m) => m.fixedCny) / months),
    variableCostCny: r2(sum((m) => m.variableCny) / months),
    totalCostCny: r2(sum((m) => m.fixedCny + m.variableCny) / months),
    netCny: r2(sum((m) => m.revenueCny - m.fixedCny - m.variableCny) / months),
    trend,
  };
}

/** 按分摊比例汇总某产品的支出领域结构（近 lookbackMonths 个自然月，月均口径）。 */
export async function loadProductCostBreakdown(
  productId: number,
  lookbackMonths: number
): Promise<{ domain: string; cny: number; isCogs: boolean; share: number }[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT c.domain AS domain, MAX(c.is_cogs) AS isCogs, SUM(t.amount_cny * pp.ratio) AS cny
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       JOIN product_projects pp
         ON pp.project_id = t.project_id
        AND pp.product_id = ?
        AND pp.effective_from <= t.txn_date
        AND (pp.effective_to IS NULL OR t.txn_date <= pp.effective_to)
      WHERE t.direction = 'expense'
        AND t.txn_date >= ?
      GROUP BY c.domain
      ORDER BY cny DESC`,
    [productId, windowStartISO(lookbackMonths)]
  );
  const months = Math.max(1, lookbackMonths);
  const total = rows.reduce((s, r) => s + Number(r.cny), 0) || 1;
  return rows.map((r) => ({
    domain: String(r.domain),
    cny: r2(Number(r.cny) / months),
    isCogs: Number(r.isCogs) === 1,
    share: Number(r.cny) / total,
  }));
}

/** 某产品的组成项目明细：原始收支 + 分摊后收支（近 lookbackMonths 个自然月合计）。 */
export async function loadProductCompositions(
  productId: number,
  lookbackMonths: number
): Promise<Composition[]> {
  const active = await loadActiveAllocations(productId);
  if (active.length === 0) return [];

  const [projRows] = await pool.query<Row[]>(
    `SELECT id, code, name_cn AS nameCn, name_en AS nameEn FROM projects WHERE id IN (?)`,
    [active.map((a) => a.projectId)]
  );
  const meta = new Map(projRows.map((r) => [Number(r.id), r]));

  const [rows] = await pool.query<Row[]>(
    `SELECT t.project_id AS projectId,
            COALESCE(SUM(CASE WHEN t.direction='income'  THEN t.amount_cny ELSE 0 END), 0) AS rawRevenueCny,
            COALESCE(SUM(CASE WHEN t.direction='expense' THEN t.amount_cny ELSE 0 END), 0) AS rawCostCny,
            COALESCE(SUM(CASE WHEN t.direction='income'  THEN t.amount_cny * pp.ratio ELSE 0 END), 0) AS allocRevenueCny,
            COALESCE(SUM(CASE WHEN t.direction='expense' THEN t.amount_cny * pp.ratio ELSE 0 END), 0) AS allocCostCny
       FROM transactions t
       JOIN product_projects pp
         ON pp.project_id = t.project_id
        AND pp.product_id = ?
        AND pp.effective_from <= t.txn_date
        AND (pp.effective_to IS NULL OR t.txn_date <= pp.effective_to)
      WHERE t.txn_date >= ?
      GROUP BY t.project_id`,
    [productId, windowStartISO(lookbackMonths)]
  );
  const byProject = new Map(rows.map((r) => [Number(r.projectId), r]));

  return active.map((a) => {
    const m = meta.get(a.projectId);
    const r = byProject.get(a.projectId);
    return {
      projectId: a.projectId,
      code: m ? String(m.code) : '',
      nameCn: m ? String(m.nameCn) : '',
      nameEn: m ? String(m.nameEn) : '',
      ratio: a.ratio,
      effectiveFrom: a.effectiveFrom,
      rawRevenueCny: r2(Number(r?.rawRevenueCny ?? 0)),
      rawCostCny: r2(Number(r?.rawCostCny ?? 0)),
      allocRevenueCny: r2(Number(r?.allocRevenueCny ?? 0)),
      allocCostCny: r2(Number(r?.allocCostCny ?? 0)),
    };
  });
}

/** 项目视角：某项目近 lookbackMonths 个月在各引用产品间的分摊与比重。 */
export async function loadProjectShares(
  projectId: number,
  lookbackMonths: number
): Promise<ProjectShare[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT pr.id AS productId, pr.code, pr.name_cn AS nameCn, pr.name_en AS nameEn,
            pp.ratio AS ratio,
            COALESCE(SUM(CASE WHEN t.direction='income'  THEN t.amount_cny * pp.ratio ELSE 0 END), 0) AS allocRevenueCny,
            COALESCE(SUM(CASE WHEN t.direction='expense' THEN t.amount_cny * pp.ratio ELSE 0 END), 0) AS allocCostCny
       FROM product_projects pp
       JOIN products pr ON pr.id = pp.product_id
       LEFT JOIN transactions t
         ON t.project_id = pp.project_id
        AND pp.effective_from <= t.txn_date
        AND (pp.effective_to IS NULL OR t.txn_date <= pp.effective_to)
        AND t.txn_date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL ? MONTH)
      WHERE pp.project_id = ? AND pp.effective_to IS NULL
      GROUP BY pr.id, pr.code, pr.name_cn, pr.name_en, pp.ratio
      ORDER BY allocCostCny DESC`,
    [lookbackMonths, projectId]
  );
  const totalRev = rows.reduce((s, r) => s + Number(r.allocRevenueCny), 0) || 1;
  const totalCost = rows.reduce((s, r) => s + Number(r.allocCostCny), 0) || 1;
  return rows.map((r) => ({
    productId: Number(r.productId),
    code: String(r.code),
    nameCn: String(r.nameCn),
    nameEn: String(r.nameEn),
    ratio: Number(r.ratio),
    allocRevenueCny: r2(Number(r.allocRevenueCny)),
    allocCostCny: r2(Number(r.allocCostCny)),
    revenueShare: Number(r.allocRevenueCny) / totalRev,
    costShare: Number(r.allocCostCny) / totalCost,
  }));
}
