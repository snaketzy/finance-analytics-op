import type { FastifyInstance } from 'fastify';
import type { ResultSetHeader } from 'mysql2';
import { pool, type Row } from '../db';
import { ok, fail } from '../http';
import { latestRate } from '../lib/fx';
import { loadProductActuals, loadProductCostBreakdown, loadProductCompositions } from '../lib/allocation';
import { buildEconModel, type EconVars, type CdnTier, type CdnPackage, type CdnPricingMode, type CdnPackagePrice } from '../lib/econModel';
import {
  SCENARIOS,
  DEFAULT_THRESHOLDS,
  computeMetrics,
  project,
  prerequisites,
  sensitivity,
  suggestions,
  healthFlags,
  isRevenueDeclining,
  type ScenarioKey,
  type ModelInputs,
  type Thresholds,
  type Actuals,
} from '../lib/unitEconomics';

const r2 = (n: number) => Math.round(n * 100) / 100;
const currentYm = () => new Date().toISOString().slice(0, 7);

/** 各情景在用户尚未录入时的初始假设（仅增长率/流失率差异化，MAU/付费率留空待填）。 */
const SCENARIO_DEFAULTS: Record<ScenarioKey, { churn: number; growth: number }> = {
  neutral: { churn: 0.05, growth: 0.03 },
  optimistic: { churn: 0.03, growth: 0.06 },
  pessimistic: { churn: 0.08, growth: 0 },
};

function baseInputs(scenario: ScenarioKey): ModelInputs {
  const d = SCENARIO_DEFAULTS[scenario];
  return {
    mau: null,
    payingRatio: null,
    arppuCny: null,
    monthlyChurn: d.churn,
    monthlyGrowth: d.growth,
    fixedCostCny: null,
    unitVarCostCny: null,
    horizonMonths: 24,
    lookbackMonths: 3,
    source: 'manual',
  };
}

const toNum = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 读取某产品三档情景的模型假设（缺失时用默认值补齐）。 */
async function loadInputs(productId: number): Promise<Record<ScenarioKey, ModelInputs>> {
  const [rows] = await pool.query<Row[]>(
    `SELECT scenario, mau, paying_ratio AS payingRatio, arppu_cny AS arppuCny,
            monthly_churn AS monthlyChurn, monthly_growth AS monthlyGrowth,
            fixed_cost_cny AS fixedCostCny, unit_var_cost_cny AS unitVarCostCny,
            horizon_months AS horizonMonths, lookback_months AS lookbackMonths,
            source, extra
       FROM product_model_inputs WHERE product_id = ?`,
    [productId]
  );
  const map = {} as Record<ScenarioKey, ModelInputs>;
  for (const s of SCENARIOS) map[s] = baseInputs(s);
  for (const r of rows) {
    const s = String(r.scenario) as ScenarioKey;
    if (!SCENARIOS.includes(s)) continue;
    map[s] = {
      mau: toNum(r.mau),
      payingRatio: toNum(r.payingRatio),
      arppuCny: toNum(r.arppuCny),
      monthlyChurn: toNum(r.monthlyChurn) ?? SCENARIO_DEFAULTS[s].churn,
      monthlyGrowth: toNum(r.monthlyGrowth) ?? SCENARIO_DEFAULTS[s].growth,
      fixedCostCny: toNum(r.fixedCostCny),
      unitVarCostCny: toNum(r.unitVarCostCny),
      horizonMonths: toNum(r.horizonMonths) ?? 24,
      lookbackMonths: toNum(r.lookbackMonths) ?? 3,
      source: r.source ?? 'manual',
      extra: r.extra ?? undefined,
    };
  }
  return map;
}

/** 读取阈值（取中性情景的 thresholds 覆盖，缺省用默认值）。 */
async function loadThresholds(productId: number): Promise<Thresholds> {
  const [rows] = await pool.query<Row[]>(
    `SELECT thresholds FROM product_model_inputs WHERE product_id = ? AND scenario = 'neutral' LIMIT 1`,
    [productId]
  );
  const t = rows[0]?.thresholds;
  if (t && typeof t === 'object') return { ...DEFAULT_THRESHOLDS, ...(t as Partial<Thresholds>) };
  return DEFAULT_THRESHOLDS;
}

/** 统一的模型计算：给定实际基线 + 三档参数，输出各情景指标与推演。 */
function computeAll(actuals: Actuals, inputsMap: Record<ScenarioKey, ModelInputs>) {
  const models = {} as Record<
    ScenarioKey,
    { inputs: ModelInputs; metrics: ReturnType<typeof computeMetrics>; projection: ReturnType<typeof project> }
  >;
  for (const s of SCENARIOS) {
    const metrics = computeMetrics(actuals, inputsMap[s]);
    models[s] = { inputs: inputsMap[s], metrics, projection: project(metrics, currentYm(), inputsMap[s].horizonMonths) };
  }
  return models;
}

/** 单个产品的完整模型详情（收入/成本按项目分摊比例汇总）。 */
async function buildDetail(productId: number) {
  const [prodRows] = await pool.query<Row[]>(
    'SELECT id, code, name_cn AS nameCn, name_en AS nameEn, kind, status, launch_date AS launchDate FROM products WHERE id = ?',
    [productId]
  );
  if (!prodRows.length) return null;
  const product = prodRows[0];

  const inputsMap = await loadInputs(productId);
  const lookback = inputsMap.neutral.lookbackMonths || 3;
  const [actuals, breakdown, thresholds, compositions] = await Promise.all([
    loadProductActuals(productId, lookback),
    loadProductCostBreakdown(productId, lookback),
    loadThresholds(productId),
    loadProductCompositions(productId, lookback),
  ]);

  const declining = isRevenueDeclining(actuals.trend);
  const models = computeAll(actuals, inputsMap);
  const neutral = models.neutral.metrics;

  return {
    product,
    actuals,
    costBreakdown: breakdown,
    compositions,
    thresholds,
    declining,
    inputs: inputsMap,
    models,
    prerequisites: prerequisites(neutral),
    sensitivity: sensitivity(actuals, inputsMap.neutral),
    suggestions: suggestions(actuals, neutral, breakdown, thresholds, declining),
    flags: healthFlags(actuals, neutral, thresholds, declining),
  };
}

/** 产品总览行：分摊后实际基线 + 中性情景指标 + 预警。 */
async function buildOverviewRow(product: Row) {
  const productId = Number(product.id);
  const inputsMap = await loadInputs(productId);
  const lookback = Math.max(3, inputsMap.neutral.lookbackMonths || 3);
  const [actuals, thresholds] = await Promise.all([
    loadProductActuals(productId, lookback),
    loadThresholds(productId),
  ]);
  const declining = isRevenueDeclining(actuals.trend);
  const neutral = computeMetrics(actuals, inputsMap.neutral);
  return {
    productId,
    code: product.code,
    nameCn: product.nameCn,
    nameEn: product.nameEn,
    kind: product.kind,
    status: product.status,
    actuals,
    metrics: neutral,
    flags: healthFlags(actuals, neutral, thresholds, declining),
    topSuggestion: suggestions(actuals, neutral, [], thresholds, declining)[0] ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* 全变量测算（Vultr / 域名 / SSL / R2 存储 / CDN 流量 / 订阅收入）          */
/* ------------------------------------------------------------------ */

const ECON_KEYS: (keyof EconVars)[] = [
  'vultrMonthlyCny',
  'domainAnnualCny',
  'sslAnnualCny',
  'r2StoragePerGbCny',
  'r2ClassAMonthlyCny',
  'libraryTitles',
  'avgTitleGb',
  'cdnTier1PerTbCny',
  'cdnTier2PerTbCny',
  'cdnTier1Tiers',
  'cdnTier2Tiers',
  'cdnPricingMode',
  'cdnPackagePrice',
  'cdnTier1Packages',
  'cdnTier2Packages',
  'tier1Share',
  'basicViewers',
  'premiumViewers',
  'basicMinutesPerViewer',
  'premiumMinutesPerViewer',
  'basicPerMinMbLow',
  'premiumPerMinMbLow',
  'basicPerMinMbHigh',
  'premiumPerMinMbHigh',
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

/** 解析 CDN 阶梯（兼容 JSON 字符串 / 已解析数组），无效时返回 null。 */
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

/** 解析 CDN 资源包（兼容 JSON 字符串 / 已解析数组），无效时返回 null。 */
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
      if (sizeGb == null || sizeGb <= 0) return null;
      return { sizeGb, listCny: toNum(o.listCny) ?? 0, renewCny: toNum(o.renewCny) ?? 0 };
    })
    .filter((x): x is CdnPackage => x !== null);
  return clean.length ? clean : null;
}

/** 解析 CDN 计价模式（非法值返回 null，由计算层回落 tiered）。 */
const parsePricingMode = (v: unknown): CdnPricingMode | null =>
  v === 'package' || v === 'tiered' ? v : null;

/** 解析资源包价格档（非法值返回 null，由计算层回落 renew）。 */
const parsePackagePrice = (v: unknown): CdnPackagePrice | null =>
  v === 'list' || v === 'renew' ? v : null;

/** 从任意来源（数据库行 / 请求体）读取全变量，缺省字段按 null。 */
function pickEconVars(r: Record<string, unknown>): EconVars {
  const g = (k: string) => toNum(r[k]);
  return {
    vultrMonthlyCny: g('vultrMonthlyCny'),
    domainAnnualCny: g('domainAnnualCny'),
    sslAnnualCny: g('sslAnnualCny'),
    r2StoragePerGbCny: g('r2StoragePerGbCny'),
    r2ClassAMonthlyCny: g('r2ClassAMonthlyCny'),
    libraryTitles: g('libraryTitles'),
    avgTitleGb: g('avgTitleGb'),
    cdnTier1PerTbCny: g('cdnTier1PerTbCny'),
    cdnTier2PerTbCny: g('cdnTier2PerTbCny'),
    cdnTier1Tiers: parseTiers(r.cdnTier1Tiers),
    cdnTier2Tiers: parseTiers(r.cdnTier2Tiers),
    cdnPricingMode: parsePricingMode(r.cdnPricingMode),
    cdnPackagePrice: parsePackagePrice(r.cdnPackagePrice),
    cdnTier1Packages: parsePackages(r.cdnTier1Packages),
    cdnTier2Packages: parsePackages(r.cdnTier2Packages),
    tier1Share: g('tier1Share'),
    basicViewers: g('basicViewers'),
    premiumViewers: g('premiumViewers'),
    basicMinutesPerViewer: g('basicMinutesPerViewer'),
    premiumMinutesPerViewer: g('premiumMinutesPerViewer'),
    basicPerMinMbLow: g('basicPerMinMbLow'),
    premiumPerMinMbLow: g('premiumPerMinMbLow'),
    basicPerMinMbHigh: g('basicPerMinMbHigh'),
    premiumPerMinMbHigh: g('premiumPerMinMbHigh'),
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
function bodyEconVars(b: Record<string, unknown>): EconVars {
  return pickEconVars(b);
}

/** 一条全变量快照：含保存日期（savedAt）与主键，供历史版本回溯。 */
type EconSnapshotRow = { id: number; savedAt: string; vars: EconVars };

/**
 * 读取全变量快照。默认取「最新一版」（按保存时间倒序）；
 * 传入 snapshotId 时精确取该历史版本。
 */
async function loadEconVars(productId: number, snapshotId?: number): Promise<EconSnapshotRow | null> {
  const cols = `${ECON_KEYS.map((k) => `${toSnake(k)} AS ${k}`).join(', ')}, id, saved_at AS savedAt`;
  const [rows] = snapshotId
    ? await pool.query<Row[]>(
        `SELECT ${cols} FROM product_econ_variables WHERE product_id = ? AND id = ? LIMIT 1`,
        [productId, snapshotId]
      )
    : await pool.query<Row[]>(
        `SELECT ${cols} FROM product_econ_variables
          WHERE product_id = ? ORDER BY saved_at DESC, id DESC LIMIT 1`,
        [productId]
      );
  const r = rows[0];
  return r ? { id: Number(r.id), savedAt: String(r.savedAt), vars: pickEconVars(r) } : null;
}

/** 实际经营基线：作为变量输入的参考值（不参与计算）。 */
async function loadEconReference(productId: number) {
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
    /** 参考：基础设施域月均（含 R2 存储与 CDN 流量）。 */
    suggestedInfraCny: byDomain('infra'),
  };
}

const emptyEconVars = (vultrMonthlyCny: number | null): EconVars => ({
  vultrMonthlyCny,
  domainAnnualCny: null,
  sslAnnualCny: null,
  r2StoragePerGbCny: null,
  r2ClassAMonthlyCny: null,
  libraryTitles: null,
  avgTitleGb: null,
  cdnTier1PerTbCny: null,
  cdnTier2PerTbCny: null,
  cdnTier1Tiers: null,
  cdnTier2Tiers: null,
  cdnPricingMode: null,
  cdnPackagePrice: null,
  cdnTier1Packages: null,
  cdnTier2Packages: null,
  tier1Share: null,
  basicViewers: null,
  premiumViewers: null,
  basicMinutesPerViewer: null,
  premiumMinutesPerViewer: null,
  basicPerMinMbLow: null,
  premiumPerMinMbLow: null,
  basicPerMinMbHigh: null,
  premiumPerMinMbHigh: null,
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
async function buildEconPayload(productId: number, override?: Partial<EconVars>, snapshotId?: number) {
  const reference = await loadEconReference(productId);
  const stored = await loadEconVars(productId, snapshotId);
  const vars: EconVars =
    override !== undefined
      ? { ...(stored?.vars ?? emptyEconVars(null)), ...override }
      : stored?.vars ?? emptyEconVars(reference.suggestedVultrCny > 0 ? reference.suggestedVultrCny : null);
  return {
    productId,
    stored: stored !== null,
    snapshotId: stored?.id ?? null,
    savedAt: stored?.savedAt ?? null,
    reference,
    ...buildEconModel(vars, currentYm()),
  };
}

export default async function (app: FastifyInstance) {
  // 总览：所有（默认 active）产品的模型概览 + 健康预警
  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where = q.status ? 'WHERE status = ?' : "WHERE status = 'active'";
    const params = q.status ? [q.status] : [];
    const [products] = await pool.query<Row[]>(
      `SELECT id, code, name_cn AS nameCn, name_en AS nameEn, kind, status
         FROM products ${where} ORDER BY sort_order, id`,
      params
    );
    const rows = await Promise.all(products.map((p) => buildOverviewRow(p)));
    const rate = await latestRate();
    return ok({
      fxRate: rate,
      products: rows,
      summary: {
        count: rows.length,
        alertCount: rows.filter((r) => r.flags.some((f) => f.severity === 'high')).length,
        totalMonthlyRevenueCny: r2(rows.reduce((s, r) => s + r.actuals.revenueCny, 0)),
        totalMonthlyCostCny: r2(rows.reduce((s, r) => s + r.actuals.totalCostCny, 0)),
      },
    });
  });

  // 单产品完整模型
  app.get('/:productId', async (req, reply) => {
    const productId = Number((req.params as { productId: string }).productId);
    const detail = await buildDetail(productId);
    if (!detail) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const rate = await latestRate();
    return ok({ fxRate: rate, ...detail });
  });

  // 实时模拟：不落库，按提交的三档参数重新计算（用于输入框即时联动）
  app.post('/:productId/simulate', async (req, reply) => {
    const productId = Number((req.params as { productId: string }).productId);
    const body = (req.body ?? {}) as { scenarios?: Partial<Record<ScenarioKey, Partial<ModelInputs>>> };
    const [prodRows] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prodRows.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const stored = await loadInputs(productId);
    const merged = {} as Record<ScenarioKey, ModelInputs>;
    for (const s of SCENARIOS) {
      merged[s] = { ...stored[s], ...(body.scenarios?.[s] ?? {}) };
    }
    const lookback = merged.neutral.lookbackMonths || 3;
    const [actuals, breakdown, thresholds] = await Promise.all([
      loadProductActuals(productId, lookback),
      loadProductCostBreakdown(productId, lookback),
      loadThresholds(productId),
    ]);
    const declining = isRevenueDeclining(actuals.trend);
    const models = computeAll(actuals, merged);
    const neutral = models.neutral.metrics;
    return ok({
      declining,
      inputs: merged,
      models,
      prerequisites: prerequisites(neutral),
      sensitivity: sensitivity(actuals, merged.neutral),
      suggestions: suggestions(actuals, neutral, breakdown, thresholds, declining),
      flags: healthFlags(actuals, neutral, thresholds, declining),
    });
  });

  // 保存某档情景的模型假设（幂等 upsert）
  app.put('/:productId/inputs', async (req, reply) => {
    const productId = Number((req.params as { productId: string }).productId);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const scenario = String(b.scenario ?? 'neutral') as ScenarioKey;
    if (!SCENARIOS.includes(scenario)) {
      reply.code(400);
      return fail(400, 'scenario 必须为 neutral / optimistic / pessimistic');
    }
    const [prodRows] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prodRows.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }

    await pool.query<ResultSetHeader>(
      `INSERT INTO product_model_inputs
         (product_id, scenario, mau, paying_ratio, arppu_cny, monthly_churn, monthly_growth,
          fixed_cost_cny, unit_var_cost_cny, horizon_months, lookback_months, source, extra)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         mau = VALUES(mau), paying_ratio = VALUES(paying_ratio), arppu_cny = VALUES(arppu_cny),
         monthly_churn = VALUES(monthly_churn), monthly_growth = VALUES(monthly_growth),
         fixed_cost_cny = VALUES(fixed_cost_cny), unit_var_cost_cny = VALUES(unit_var_cost_cny),
         horizon_months = VALUES(horizon_months), lookback_months = VALUES(lookback_months),
         source = VALUES(source), extra = VALUES(extra)`,
      [
        productId,
        scenario,
        toNum(b.mau),
        toNum(b.payingRatio),
        toNum(b.arppuCny),
        toNum(b.monthlyChurn),
        toNum(b.monthlyGrowth),
        toNum(b.fixedCostCny),
        toNum(b.unitVarCostCny),
        toNum(b.horizonMonths) ?? 24,
        toNum(b.lookbackMonths) ?? 3,
        (b.source as string) ?? 'manual',
        b.extra !== undefined ? JSON.stringify(b.extra) : null,
      ]
    );

    const detail = await buildDetail(productId);
    return ok(detail);
  });

  /* ---------------------------------------------------------------- */
  /* 全变量测算：读取 / 保存 / 实时模拟                                   */
  /* ---------------------------------------------------------------- */

  /** 读取全变量测算（无记录时按实际流水初始化 Vultr 月租）。 */
  app.get('/:productId/econ-vars', async (req, reply) => {
    const productId = Number((req.params as { productId: string }).productId);
    const [prodRows] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prodRows.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const rate = await latestRate();
    return ok({ fxRate: rate, ...(await buildEconPayload(productId)) });
  });

  /** 实时模拟：不落库，按提交的全变量重新测算（用于输入即时联动）。 */
  app.post('/:productId/econ-vars/simulate', async (req, reply) => {
    const productId = Number((req.params as { productId: string }).productId);
    const [prodRows] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prodRows.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const body = (req.body ?? {}) as { vars?: Record<string, unknown> };
    const rate = await latestRate();
    return ok({ fxRate: rate, ...(await buildEconPayload(productId, bodyEconVars(body.vars ?? {}))) });
  });

  /** 保存全变量：每次保存新增一条带保存日期的历史快照（不覆盖旧版本）。 */
  app.put('/:productId/econ-vars', async (req, reply) => {
    const productId = Number((req.params as { productId: string }).productId);
    const [prodRows] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prodRows.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const vars = bodyEconVars((req.body ?? {}) as Record<string, unknown>);
    const cols = ECON_KEYS.map((k) => toSnake(k));
    const placeholders = ECON_KEYS.map(() => '?').join(', ');
    // 阶梯为 JSON 列，落库前需序列化（null 原样传）
    const values = ECON_KEYS.map((k) => {
      const val = vars[k];
      return Array.isArray(val) ? JSON.stringify(val) : val;
    });

    await pool.query<ResultSetHeader>(
      `INSERT INTO product_econ_variables (product_id, ${cols.join(', ')}, saved_at)
       VALUES (?, ${placeholders}, NOW())`,
      [productId, ...values]
    );

    const rate = await latestRate();
    return ok({ fxRate: rate, ...(await buildEconPayload(productId)) });
  });

  /** 全变量历史快照列表（按保存日期倒序，含关键结论便于速览对比）。 */
  app.get('/:productId/econ-vars/snapshots', async (req, reply) => {
    const productId = Number((req.params as { productId: string }).productId);
    const [prodRows] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prodRows.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const [rows] = await pool.query<Row[]>(
      `SELECT ${ECON_KEYS.map((k) => `${toSnake(k)} AS ${k}`).join(', ')}, id, saved_at AS savedAt
         FROM product_econ_variables
        WHERE product_id = ? ORDER BY saved_at DESC, id DESC LIMIT 100`,
      [productId]
    );
    const snapshots = rows.map((r) => {
      const vars = pickEconVars(r);
      const neutral = buildEconModel(vars, currentYm()).results.neutral;
      return {
        id: Number(r.id),
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
  app.get('/:productId/econ-vars/snapshots/:snapshotId', async (req, reply) => {
    const { productId: pid, snapshotId: sid } = req.params as { productId: string; snapshotId: string };
    const productId = Number(pid);
    const snapshotId = Number(sid);
    const [prodRows] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prodRows.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const rate = await latestRate();
    const payload = await buildEconPayload(productId, undefined, snapshotId);
    if (!payload.stored) {
      reply.code(404);
      return fail(404, '该历史版本不存在');
    }
    return ok({ fxRate: rate, ...payload });
  });

  /** 删除指定历史版本快照。 */
  app.delete('/:productId/econ-vars/snapshots/:snapshotId', async (req, reply) => {
    const { productId: pid, snapshotId: sid } = req.params as { productId: string; snapshotId: string };
    const productId = Number(pid);
    const snapshotId = Number(sid);
    const [res] = await pool.query<ResultSetHeader>(
      'DELETE FROM product_econ_variables WHERE product_id = ? AND id = ?',
      [productId, snapshotId]
    );
    if (!res.affectedRows) {
      reply.code(404);
      return fail(404, '该历史版本不存在');
    }
    return ok({ deleted: res.affectedRows });
  });

  // 预留：外部会员 / 埋点系统推送付费用户结构与行为模式，写入模型假设
  // 契约：{ scenario?, source?, mau?, payingRatio?, arppuCny?, monthlyChurn?, monthlyGrowth?, extra? }
  // 未来各外部系统只需按此结构 POST，即可驱动模型，无需改动计算逻辑。
  app.post('/:productId/inputs/import', async (req, reply) => {
    const productId = Number((req.params as { productId: string }).productId);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const [prodRows] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prodRows.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const scenario = String(b.scenario ?? 'neutral') as ScenarioKey;
    if (!SCENARIOS.includes(scenario)) {
      reply.code(400);
      return fail(400, 'scenario 必须为 neutral / optimistic / pessimistic');
    }
    const source = (b.source as string) ?? 'external';

    // 仅更新推送中显式出现的字段，未推送的保持原值
    const fields: string[] = ['source = ?', 'extra = ?'];
    const params: unknown[] = [source, b.extra !== undefined ? JSON.stringify(b.extra) : null];
    const colMap: Record<string, string> = {
      mau: 'mau',
      payingRatio: 'paying_ratio',
      arppuCny: 'arppu_cny',
      monthlyChurn: 'monthly_churn',
      monthlyGrowth: 'monthly_growth',
    };
    for (const [key, col] of Object.entries(colMap)) {
      if (b[key] !== undefined) {
        fields.push(`${col} = ?`);
        params.push(toNum(b[key]));
      }
    }

    const [exist] = await pool.query<Row[]>(
      'SELECT id FROM product_model_inputs WHERE product_id = ? AND scenario = ? LIMIT 1',
      [productId, scenario]
    );
    if (exist.length) {
      await pool.query(`UPDATE product_model_inputs SET ${fields.join(', ')} WHERE id = ?`, [
        ...params,
        exist[0].id,
      ]);
    } else {
      await pool.query<ResultSetHeader>(
        `INSERT INTO product_model_inputs (product_id, scenario, mau, paying_ratio, arppu_cny, monthly_churn, monthly_growth, source, extra)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          productId,
          scenario,
          toNum(b.mau),
          toNum(b.payingRatio),
          toNum(b.arppuCny),
          toNum(b.monthlyChurn),
          toNum(b.monthlyGrowth),
          source,
          b.extra !== undefined ? JSON.stringify(b.extra) : null,
        ]
      );
    }
    reply.code(201);
    const detail = await buildDetail(productId);
    return ok(detail);
  });
}
