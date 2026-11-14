import type { FastifyInstance } from 'fastify';
import type { ResultSetHeader } from 'mysql2';
import { pool, type Row } from '../db';
import { ok, fail } from '../http';
import { latestRate } from '../lib/fx';
import { loadProductActuals, loadProductCostBreakdown } from '../lib/allocation';
import {
  buildThkcosModel,
  type ThkcosVars,
  type CdnTier,
  type CdnPackage,
  type CdnPricingMode,
  type CdnPackagePrice,
  type ThkcosTrafficMode,
} from '../lib/thkcosModel';

const currentYm = () => new Date().toISOString().slice(0, 7);

const toNum = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ------------------------------------------------------------------ */
/* cf & THKCOS 全变量测算（Vultr / 域名 / SSL / 双副本存储 / 增量同步 /     */
/*                       COS 直连或经 CDN 流量 / 订阅收入）               */
/* ------------------------------------------------------------------ */

const THKCOS_KEYS: (keyof ThkcosVars)[] = [
  'vultrMonthlyCny',
  'domainAnnualCny',
  'sslAnnualCny',
  'r2StoragePerGbCny',
  'cosStoragePerGbCny',
  'libraryTitles',
  'avgTitleGb',
  'syncGbPerMonth',
  'syncPerGbCny',
  'trafficMode',
  'basicViewers',
  'premiumViewers',
  'basicMinutesPerViewer',
  'premiumMinutesPerViewer',
  'basicPerMinMbLow',
  'premiumPerMinMbLow',
  'basicPerMinMbHigh',
  'premiumPerMinMbHigh',
  'cacheHitRatio',
  'cosDownTiers',
  'eoOverageTiers',
  'cosOriginTiers',
  'cdnPricingMode',
  'cdnPackagePrice',
  'cosDownPackages',
  'eoPackages',
  'eoPlanMonthlyCny',
  'eoPlanIncludedGb',
  'eoDeductionRatio',
  'basicMonthlySubs',
  'basicMonthlyPriceCny',
  'basicQuarterlySubs',
  'basicQuarterlyPriceCny',
  'basicYearlySubs',
  'basicYearlyPriceCny',
  'premiumMonthlySubs',
  'premiumMonthlyPriceCny',
  'premiumQuarterlySubs',
  'premiumQuarterlyPriceCny',
  'premiumYearlySubs',
  'premiumYearlyPriceCny',
  'viewerGrowth',
  'subscriberGrowth',
  'horizonMonths',
];

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** 解析流量阶梯（兼容 JSON 字符串 / 已解析数组），无效时返回 null。 */
function parseTiers(v: unknown): CdnTier[] | null {
  let arr: unknown = v;
  if (typeof v === 'string') {
    if (!v.trim()) return null;
    try {
      arr = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  const clean = arr
    .map((x) => {
      if (!x || typeof x !== 'object') return null;
      const o = x as Record<string, unknown>;
      const price = toNum(o.pricePerTbCny);
      return price == null ? null : { upToTb: toNum(o.upToTb), pricePerTbCny: price };
    })
    .filter((x): x is CdnTier => x !== null);
  return clean.length ? clean : null;
}

/** 解析流量计价模式（非法值返回 null，由计算层回落 direct）。 */
const parseTrafficMode = (v: unknown): ThkcosTrafficMode | null =>
  v === 'cdn' || v === 'direct' ? v : null;

/** 解析计费口径（非法值返回 null，由计算层回落 tiered）。 */
const parsePricingMode = (v: unknown): CdnPricingMode | null =>
  v === 'package' || v === 'tiered' ? v : null;

/** 解析资源包价格档（非法值返回 null，由计算层回落 renew）。 */
const parsePackagePrice = (v: unknown): CdnPackagePrice | null =>
  v === 'list' || v === 'renew' ? v : null;

/** 解析资源包（兼容 JSON 字符串 / 已解析数组），无效时返回 null。 */
function parsePackages(v: unknown): CdnPackage[] | null {
  let arr: unknown = v;
  if (typeof v === 'string') {
    if (!v.trim()) return null;
    try {
      arr = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  const clean = arr
    .map((x) => {
      if (!x || typeof x !== 'object') return null;
      const o = x as Record<string, unknown>;
      const sizeGb = toNum(o.sizeGb);
      return sizeGb == null || sizeGb <= 0 ? null : { sizeGb, listCny: toNum(o.listCny) ?? 0, renewCny: toNum(o.renewCny) ?? 0 };
    })
    .filter((x): x is CdnPackage => x !== null);
  return clean.length ? clean : null;
}

/** 从任意来源（数据库行 / 请求体）读取全变量，缺省字段按 null。 */
function pickThkcosVars(r: Record<string, unknown>): ThkcosVars {
  const g = (k: string) => toNum(r[k]);
  return {
    vultrMonthlyCny: g('vultrMonthlyCny'),
    domainAnnualCny: g('domainAnnualCny'),
    sslAnnualCny: g('sslAnnualCny'),
    r2StoragePerGbCny: g('r2StoragePerGbCny'),
    cosStoragePerGbCny: g('cosStoragePerGbCny'),
    libraryTitles: g('libraryTitles'),
    avgTitleGb: g('avgTitleGb'),
    syncGbPerMonth: g('syncGbPerMonth'),
    syncPerGbCny: g('syncPerGbCny'),
    trafficMode: parseTrafficMode(r.trafficMode),
    basicViewers: g('basicViewers'),
    premiumViewers: g('premiumViewers'),
    basicMinutesPerViewer: g('basicMinutesPerViewer'),
    premiumMinutesPerViewer: g('premiumMinutesPerViewer'),
    basicPerMinMbLow: g('basicPerMinMbLow'),
    premiumPerMinMbLow: g('premiumPerMinMbLow'),
    basicPerMinMbHigh: g('basicPerMinMbHigh'),
    premiumPerMinMbHigh: g('premiumPerMinMbHigh'),
    cacheHitRatio: g('cacheHitRatio'),
    cosDownTiers: parseTiers(r.cosDownTiers),
    eoOverageTiers: parseTiers(r.eoOverageTiers),
    cosOriginTiers: parseTiers(r.cosOriginTiers),
    cdnPricingMode: parsePricingMode(r.cdnPricingMode),
    cdnPackagePrice: parsePackagePrice(r.cdnPackagePrice),
    cosDownPackages: parsePackages(r.cosDownPackages),
    eoPackages: parsePackages(r.eoPackages),
    eoPlanMonthlyCny: g('eoPlanMonthlyCny'),
    eoPlanIncludedGb: g('eoPlanIncludedGb'),
    eoDeductionRatio: g('eoDeductionRatio'),
    basicMonthlySubs: g('basicMonthlySubs'),
    basicMonthlyPriceCny: g('basicMonthlyPriceCny'),
    basicQuarterlySubs: g('basicQuarterlySubs'),
    basicQuarterlyPriceCny: g('basicQuarterlyPriceCny'),
    basicYearlySubs: g('basicYearlySubs'),
    basicYearlyPriceCny: g('basicYearlyPriceCny'),
    premiumMonthlySubs: g('premiumMonthlySubs'),
    premiumMonthlyPriceCny: g('premiumMonthlyPriceCny'),
    premiumQuarterlySubs: g('premiumQuarterlySubs'),
    premiumQuarterlyPriceCny: g('premiumQuarterlyPriceCny'),
    premiumYearlySubs: g('premiumYearlySubs'),
    premiumYearlyPriceCny: g('premiumYearlyPriceCny'),
    viewerGrowth: g('viewerGrowth'),
    subscriberGrowth: g('subscriberGrowth'),
    horizonMonths: g('horizonMonths') ?? 24,
  };
}

/** 从请求体读取全变量（缺省字段按 null，horizonMonths 缺省 24）。 */
function bodyThkcosVars(b: Record<string, unknown>): ThkcosVars {
  return pickThkcosVars(b);
}

/** 一条 THKCOS 全变量快照：含名称、保存日期（savedAt）与主键，供历史版本回溯。 */
type ThkcosSnapshotRow = { id: number; snapshotName: string | null; savedAt: string; vars: ThkcosVars };

/**
 * 读取 THKCOS 全变量快照。默认取「最新一版」（按保存时间倒序）；
 * 传入 snapshotId 时精确取该历史版本。
 */
async function loadThkcosVars(productId: number, snapshotId?: number): Promise<ThkcosSnapshotRow | null> {
  const cols = `${THKCOS_KEYS.map((k) => `${toSnake(k)} AS ${k}`).join(', ')}, id, snapshot_name AS snapshotName, saved_at AS savedAt`;
  const [rows] = snapshotId
    ? await pool.query<Row[]>(
        `SELECT ${cols} FROM product_thkcos_variables WHERE product_id = ? AND id = ? LIMIT 1`,
        [productId, snapshotId]
      )
    : await pool.query<Row[]>(
        `SELECT ${cols} FROM product_thkcos_variables
          WHERE product_id = ? ORDER BY saved_at DESC, id DESC LIMIT 1`,
        [productId]
      );
  const r = rows[0];
  return r
    ? {
        id: Number(r.id),
        snapshotName: (r.snapshotName as string | null) ?? null,
        savedAt: String(r.savedAt),
        vars: pickThkcosVars(r),
      }
    : null;
}

/** 实际经营基线：作为变量输入的参考值（不参与计算）。 */
async function loadThkcosReference(productId: number) {
  const [actuals, breakdown] = await Promise.all([
    loadProductActuals(productId, 3),
    loadProductCostBreakdown(productId, 3),
  ]);
  const byDomain = (d: string) => breakdown.find((b) => b.domain === d)?.cny ?? 0;
  return {
    months: actuals.months,
    monthlyRevenueCny: actuals.revenueCny,
    monthlyCostCny: actuals.totalCostCny,
    monthlyFixedCostCny: actuals.fixedCostCny,
    monthlyVariableCostCny: actuals.variableCostCny,
    domainBreakdown: breakdown,
    /** 参考：算力域月均（可作为 Vultr 月租起点）。 */
    suggestedVultrCny: byDomain('compute'),
    /** 参考：基础设施域月均（含存储与流量）。 */
    suggestedInfraCny: byDomain('infra'),
  };
}

const emptyThkcosVars = (vultrMonthlyCny: number | null): ThkcosVars => ({
  vultrMonthlyCny,
  domainAnnualCny: null,
  sslAnnualCny: null,
  r2StoragePerGbCny: null,
  cosStoragePerGbCny: null,
  libraryTitles: null,
  avgTitleGb: null,
  syncGbPerMonth: null,
  syncPerGbCny: null,
  trafficMode: null,
  basicViewers: null,
  premiumViewers: null,
  basicMinutesPerViewer: null,
  premiumMinutesPerViewer: null,
  basicPerMinMbLow: null,
  premiumPerMinMbLow: null,
  basicPerMinMbHigh: null,
  premiumPerMinMbHigh: null,
  cacheHitRatio: null,
  cosDownTiers: null,
  eoOverageTiers: null,
  cosOriginTiers: null,
  cdnPricingMode: null,
  cdnPackagePrice: null,
  cosDownPackages: null,
  eoPackages: null,
  eoPlanMonthlyCny: null,
  eoPlanIncludedGb: null,
  eoDeductionRatio: null,
  basicMonthlySubs: null,
  basicMonthlyPriceCny: null,
  basicQuarterlySubs: null,
  basicQuarterlyPriceCny: null,
  basicYearlySubs: null,
  basicYearlyPriceCny: null,
  premiumMonthlySubs: null,
  premiumMonthlyPriceCny: null,
  premiumQuarterlySubs: null,
  premiumQuarterlyPriceCny: null,
  premiumYearlySubs: null,
  premiumYearlyPriceCny: null,
  viewerGrowth: null,
  subscriberGrowth: null,
  horizonMonths: 24,
});

/**
 * 读取（或按实际流水初始化）变量 → 算出三档情景模型。
 * - override 传入时：以已存版本为底，叠加草稿（用于实时模拟，不落库）
 * - snapshotId 传入时：以指定历史版本为底（用于回溯查看）
 * 返回值附带该版本的主键与保存日期。
 */
async function buildThkcosPayload(productId: number, override?: Partial<ThkcosVars>, snapshotId?: number) {
  const reference = await loadThkcosReference(productId);
  const stored = await loadThkcosVars(productId, snapshotId);
  const vars: ThkcosVars =
    override !== undefined
      ? { ...(stored?.vars ?? emptyThkcosVars(null)), ...override }
      : stored?.vars ?? emptyThkcosVars(reference.suggestedVultrCny > 0 ? reference.suggestedVultrCny : null);
  return {
    productId,
    stored: stored !== null,
    snapshotId: stored?.id ?? null,
    snapshotName: stored?.snapshotName ?? null,
    savedAt: stored?.savedAt ?? null,
    reference,
    ...buildThkcosModel(vars, currentYm()),
  };
}

export default async function (app: FastifyInstance) {
  /* ---------------------------------------------------------------- */
  /* cf & THKCOS 全变量测算：读取 / 保存 / 实时模拟 / 历史版本              */
  /* ---------------------------------------------------------------- */

  /** 读取全变量测算（无记录时按实际流水初始化 Vultr 月租）。 */
  app.get('/:productId/thkcos-vars', async (req, reply) => {
    const productId = Number((req.params as { productId: string }).productId);
    const [prodRows] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prodRows.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const rate = await latestRate();
    return ok({ fxRate: rate, ...(await buildThkcosPayload(productId)) });
  });

  /** 实时模拟：不落库，按提交的全变量重新测算（用于输入即时联动）。 */
  app.post('/:productId/thkcos-vars/simulate', async (req, reply) => {
    const productId = Number((req.params as { productId: string }).productId);
    const [prodRows] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prodRows.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const body = (req.body ?? {}) as { vars?: Record<string, unknown> };
    const rate = await latestRate();
    return ok({ fxRate: rate, ...(await buildThkcosPayload(productId, bodyThkcosVars(body.vars ?? {}))) });
  });

  /** 保存全变量：每次保存新增一条带保存日期的历史快照（不覆盖旧版本）。 */
  app.put('/:productId/thkcos-vars', async (req, reply) => {
    const productId = Number((req.params as { productId: string }).productId);
    const [prodRows] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prodRows.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const vars = bodyThkcosVars((req.body ?? {}) as Record<string, unknown>);
    const cols = THKCOS_KEYS.map((k) => toSnake(k));
    const placeholders = THKCOS_KEYS.map(() => '?').join(', ');
    // 阶梯为 JSON 列，落库前需序列化（null 原样传）
    const values = THKCOS_KEYS.map((k) => {
      const val = vars[k];
      return Array.isArray(val) ? JSON.stringify(val) : val;
    });

    await pool.query<ResultSetHeader>(
      `INSERT INTO product_thkcos_variables (product_id, ${cols.join(', ')}, saved_at)
       VALUES (?, ${placeholders}, NOW())`,
      [productId, ...values]
    );

    const rate = await latestRate();
    return ok({ fxRate: rate, ...(await buildThkcosPayload(productId)) });
  });

  /** 全变量历史快照列表（按保存日期倒序，含关键结论便于速览对比）。 */
  app.get('/:productId/thkcos-vars/snapshots', async (req, reply) => {
    const productId = Number((req.params as { productId: string }).productId);
    const [prodRows] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prodRows.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const [rows] = await pool.query<Row[]>(
      `SELECT ${THKCOS_KEYS.map((k) => `${toSnake(k)} AS ${k}`).join(', ')}, id, snapshot_name AS snapshotName, saved_at AS savedAt
         FROM product_thkcos_variables
        WHERE product_id = ? ORDER BY saved_at DESC, id DESC LIMIT 100`,
      [productId]
    );
    const snapshots = rows.map((r) => {
      const vars = pickThkcosVars(r);
      const neutral = buildThkcosModel(vars, currentYm()).results.neutral;
      return {
        id: Number(r.id),
        snapshotName: (r.snapshotName as string | null) ?? null,
        savedAt: String(r.savedAt),
        revenueCny: neutral.revenueCny,
        costCny: neutral.totalCostCny,
        netCny: neutral.netCny,
        viewers: (vars.basicViewers ?? 0) + (vars.premiumViewers ?? 0),
        subscribers:
          (vars.basicMonthlySubs ?? 0) +
          (vars.basicQuarterlySubs ?? 0) +
          (vars.basicYearlySubs ?? 0) +
          (vars.premiumMonthlySubs ?? 0) +
          (vars.premiumQuarterlySubs ?? 0) +
          (vars.premiumYearlySubs ?? 0),
      };
    });
    const rate = await latestRate();
    return ok({ fxRate: rate, snapshots });
  });

  /** 读取指定历史版本快照的完整测算（用于回溯查看某次保存的假设）。 */
  app.get('/:productId/thkcos-vars/snapshots/:snapshotId', async (req, reply) => {
    const { productId: pid, snapshotId: sid } = req.params as { productId: string; snapshotId: string };
    const productId = Number(pid);
    const snapshotId = Number(sid);
    const [prodRows] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prodRows.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const rate = await latestRate();
    const payload = await buildThkcosPayload(productId, undefined, snapshotId);
    if (!payload.stored) {
      reply.code(404);
      return fail(404, '该历史版本不存在');
    }
    return ok({ fxRate: rate, ...payload });
  });

  /** 删除指定历史版本快照。 */
  app.delete('/:productId/thkcos-vars/snapshots/:snapshotId', async (req, reply) => {
    const { productId: pid, snapshotId: sid } = req.params as { productId: string; snapshotId: string };
    const productId = Number(pid);
    const snapshotId = Number(sid);
    const [res] = await pool.query<ResultSetHeader>(
      'DELETE FROM product_thkcos_variables WHERE product_id = ? AND id = ?',
      [productId, snapshotId]
    );
    if (!res.affectedRows) {
      reply.code(404);
      return fail(404, '该历史版本不存在');
    }
    return ok({ deleted: res.affectedRows });
  });

  /** 重命名指定 THKCOS 历史版本快照（留空则恢复默认日期显示）。 */
  app.patch('/:productId/thkcos-vars/snapshots/:snapshotId', async (req, reply) => {
    const { productId: pid, snapshotId: sid } = req.params as { productId: string; snapshotId: string };
    const productId = Number(pid);
    const snapshotId = Number(sid);
    const body = (req.body ?? {}) as { snapshotName?: unknown };
    const snapshotName = typeof body.snapshotName === 'string' ? body.snapshotName.trim() : '';
    if (snapshotName.length > 80) {
      reply.code(400);
      return fail(400, '快照名称不能超过 80 个字符');
    }
    const [res] = await pool.query<ResultSetHeader>(
      'UPDATE product_thkcos_variables SET snapshot_name = ? WHERE product_id = ? AND id = ?',
      [snapshotName || null, productId, snapshotId]
    );
    if (!res.affectedRows) {
      reply.code(404);
      return fail(404, '该历史版本不存在');
    }
    return ok({ snapshotId, snapshotName: snapshotName || null });
  });
}
