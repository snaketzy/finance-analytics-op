import { shiftMonth } from './unitEconomics';
import {
  type CdnTier,
  type CdnPackage,
  type CdnPricingMode,
  type CdnPackagePrice,
  progressiveCost,
  packageCost,
  GB_PER_TB,
} from './econModel';

export type { CdnTier, CdnPackage, CdnPricingMode, CdnPackagePrice };

/* ------------------------------------------------------------------ */
/* 输入：cf & THKCOS 全变量经营测算的物理量                              */
/* ------------------------------------------------------------------ */

/** 流量计价模式：direct = 直连 COS 外网下行，cdn = 经 CDN（边缘下行 + COS 回源）。 */
export type ThkcosTrafficMode = 'direct' | 'cdn';

/** cf & THKCOS 全变量测算输入（NULL = 未填，计算时按 0 处理）。 */
export type ThkcosVars = {
  /** A 云主机月租 ¥/月 */
  vultrMonthlyCny: number | null;
  /** 域名年费 ¥/年 */
  domainAnnualCny: number | null;
  /** SSL 证书年费 ¥/年 */
  sslAnnualCny: number | null;
  /** B R2 每 GB 月存储单价 ¥/GB */
  r2StoragePerGbCny: number | null;
  /** C 腾讯云 COS 每 GB 月存储单价 ¥/GB */
  cosStoragePerGbCny: number | null;
  /** D 片库影片数 部 */
  libraryTitles: number | null;
  /** E 单片平均体积 GB */
  avgTitleGb: number | null;
  /** F 每月增量同步数据量 GB/月（R2 → COS） */
  syncGbPerMonth: number | null;
  /** G 同步入口流量单价 ¥/GB */
  syncPerGbCny: number | null;
  /** 流量计价模式（空 = direct） */
  trafficMode: ThkcosTrafficMode | null;
  /** H 月观看人数 人 */
  viewers: number | null;
  /** I 人均月观看部数 */
  titlesPerViewer: number | null;
  /** J 单片流量下限 GB */
  perTitleGbLow: number | null;
  /** K 单片流量上限 GB */
  perTitleGbHigh: number | null;
  /** λ CDN 缓存命中率 0-1（仅 cdn 模式，回源流量 = 未命中部分） */
  cacheHitRatio: number | null;
  /** 直连：COS 外网下行阶梯（固定 5 档） */
  cosDownTiers: CdnTier[] | null;
  /** 经 EO：套餐外超量阶梯（固定 5 档，¥/TB） */
  eoOverageTiers: CdnTier[] | null;
  /** 经 EO：COS 回源阶梯（固定 5 档） */
  cosOriginTiers: CdnTier[] | null;
  /** 计费口径：tiered = 超量阶梯累进，package = 预付费流量包（空 = tiered） */
  cdnPricingMode: CdnPricingMode | null;
  /** 资源包价格档（空 = renew） */
  cdnPackagePrice: CdnPackagePrice | null;
  /** 直连：COS 外网下行资源包（固定 6 档） */
  cosDownPackages: CdnPackage[] | null;
  /** 经 EO：全球流量包（固定 6 档，按地区抵扣系数换算） */
  eoPackages: CdnPackage[] | null;
  /** EO 套餐月费 ¥/月（如个人版 29.9） */
  eoPlanMonthlyCny: number | null;
  /** EO 套餐内含流量 GB/月（如个人版 50） */
  eoPlanIncludedGb: number | null;
  /** EO 流量包地区抵扣系数（亚太1区 = 2.49，即 1GB 流量包只抵 1/2.49 GB 流量） */
  eoDeductionRatio: number | null;
  /** L1 月卡订阅人数 */
  monthlySubs: number | null;
  /** M1 月卡 ¥/月 */
  monthlyPriceCny: number | null;
  /** L2 季卡订阅人数 */
  quarterlySubs: number | null;
  /** M2 季卡 ¥/月（实收 = ×3） */
  quarterlyPriceCny: number | null;
  /** L3 年卡订阅人数 */
  yearlySubs: number | null;
  /** M3 年卡 ¥/月（实收 = ×12） */
  yearlyPriceCny: number | null;
  /** 观看人数月净增长率 0-1 */
  viewerGrowth: number | null;
  /** 订阅人数月净增长率 0-1 */
  subscriberGrowth: number | null;
  /** 推演月数 */
  horizonMonths: number;
};

export type ThkcosScenarioKey = 'pessimistic' | 'neutral' | 'optimistic';
export const THKCOS_SCENARIOS: ThkcosScenarioKey[] = ['pessimistic', 'neutral', 'optimistic'];

/** 三档情景的口径：悲观取单片流量上限、乐观取下限。 */
export const THKCOS_SCENARIO_LABEL: Record<
  ThkcosScenarioKey,
  { cn: string; en: string; stroke: string; note: string }
> = {
  pessimistic: { cn: '悲观', en: 'Pessimistic', stroke: '#fb7185', note: '单片流量取 K 上限' },
  neutral: { cn: '中性', en: 'Neutral', stroke: '#38bdf8', note: '单片流量取 (J+K)/2' },
  optimistic: { cn: '乐观', en: 'Optimistic', stroke: '#34d399', note: '单片流量取 J 下限' },
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const num = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));

/** 归一化阶梯数组：过滤无效档位，空数组视为「未配置」。 */
function normalizeTiers(t: CdnTier[] | null | undefined): CdnTier[] | null {
  if (!Array.isArray(t)) return null;
  const clean = t
    .filter((x) => x && Number.isFinite(Number(x.pricePerTbCny)))
    .map((x) => ({
      upToTb: x.upToTb == null || !Number.isFinite(Number(x.upToTb)) ? null : Number(x.upToTb),
      pricePerTbCny: Number(x.pricePerTbCny),
    }));
  return clean.length ? clean : null;
}

/** 归一化资源包数组：过滤无效档位并按容量升序，空数组视为「未配置」。 */
function normalizePackages(p: CdnPackage[] | null | undefined): CdnPackage[] | null {
  if (!Array.isArray(p)) return null;
  const clean = p
    .filter((x) => x && Number(x.sizeGb) > 0)
    .map((x) => ({
      sizeGb: Number(x.sizeGb),
      listCny: num(x.listCny),
      renewCny: num(x.renewCny),
    }))
    .sort((a, b) => a.sizeGb - b.sizeGb);
  return clean.length ? clean : null;
}

/** 全部字段按 0 补齐后的数值版本（阶梯/资源包数组与枚举原样保留）。 */
type Numeric = {
  [K in Exclude<
    keyof ThkcosVars,
    | 'cosDownTiers'
    | 'eoOverageTiers'
    | 'cosOriginTiers'
    | 'cosDownPackages'
    | 'eoPackages'
    | 'trafficMode'
    | 'cdnPricingMode'
    | 'cdnPackagePrice'
  >]: number;
} & {
  cosDownTiers: CdnTier[] | null;
  eoOverageTiers: CdnTier[] | null;
  cosOriginTiers: CdnTier[] | null;
  cosDownPackages: CdnPackage[] | null;
  eoPackages: CdnPackage[] | null;
  trafficMode: ThkcosTrafficMode;
  cdnPricingMode: CdnPricingMode;
  cdnPackagePrice: CdnPackagePrice;
};

function resolve(vars: ThkcosVars): Numeric {
  return {
    vultrMonthlyCny: num(vars.vultrMonthlyCny),
    domainAnnualCny: num(vars.domainAnnualCny),
    sslAnnualCny: num(vars.sslAnnualCny),
    r2StoragePerGbCny: num(vars.r2StoragePerGbCny),
    cosStoragePerGbCny: num(vars.cosStoragePerGbCny),
    libraryTitles: num(vars.libraryTitles),
    avgTitleGb: num(vars.avgTitleGb),
    syncGbPerMonth: num(vars.syncGbPerMonth),
    syncPerGbCny: num(vars.syncPerGbCny),
    trafficMode: vars.trafficMode === 'cdn' ? 'cdn' : 'direct',
    viewers: num(vars.viewers),
    titlesPerViewer: num(vars.titlesPerViewer),
    perTitleGbLow: num(vars.perTitleGbLow),
    perTitleGbHigh: num(vars.perTitleGbHigh),
    cacheHitRatio: vars.cacheHitRatio == null ? 0 : Math.min(1, Math.max(0, num(vars.cacheHitRatio))),
    cosDownTiers: normalizeTiers(vars.cosDownTiers),
    eoOverageTiers: normalizeTiers(vars.eoOverageTiers),
    cosOriginTiers: normalizeTiers(vars.cosOriginTiers),
    cdnPricingMode: vars.cdnPricingMode === 'package' ? 'package' : 'tiered',
    cdnPackagePrice: vars.cdnPackagePrice === 'list' ? 'list' : 'renew',
    cosDownPackages: normalizePackages(vars.cosDownPackages),
    eoPackages: normalizePackages(vars.eoPackages),
    eoPlanMonthlyCny: num(vars.eoPlanMonthlyCny),
    eoPlanIncludedGb: num(vars.eoPlanIncludedGb),
    eoDeductionRatio: Math.max(0, num(vars.eoDeductionRatio)),
    monthlySubs: num(vars.monthlySubs),
    monthlyPriceCny: num(vars.monthlyPriceCny),
    quarterlySubs: num(vars.quarterlySubs),
    quarterlyPriceCny: num(vars.quarterlyPriceCny),
    yearlySubs: num(vars.yearlySubs),
    yearlyPriceCny: num(vars.yearlyPriceCny),
    viewerGrowth: num(vars.viewerGrowth),
    subscriberGrowth: num(vars.subscriberGrowth),
    horizonMonths: Math.max(1, Math.min(60, num(vars.horizonMonths) || 24)),
  };
}

/** 单片流量区间（未填一侧时以另一侧兜底）。 */
function gbRange(v: Numeric): { low: number; high: number } {
  const j = v.perTitleGbLow > 0 ? v.perTitleGbLow : v.perTitleGbHigh;
  const k = v.perTitleGbHigh > 0 ? v.perTitleGbHigh : v.perTitleGbLow;
  return j <= k ? { low: j, high: k } : { low: k, high: j };
}

/** 某情景下的单片流量取值。 */
function gbForScenario(v: Numeric, scenario: ThkcosScenarioKey): number {
  const { low, high } = gbRange(v);
  if (scenario === 'optimistic') return low;
  if (scenario === 'pessimistic') return high;
  return (low + high) / 2;
}

/** 阶梯数组的首档单价（无流量时作为等效均价的兜底展示）。 */
function firstTierPrice(t: CdnTier[] | null): number {
  return t && t.length ? t[0].pricePerTbCny : 0;
}

/** 资源包首档折算的等效单价 ¥/TB（无流量时作为等效均价的兜底展示）。 */
function firstPackageUnit(p: CdnPackage[] | null, priceKey: CdnPackagePrice): number {
  if (!p || !p.length) return 0;
  const f = p[0];
  const price = priceKey === 'list' ? f.listCny : f.renewCny;
  return f.sizeGb > 0 ? (price / f.sizeGb) * GB_PER_TB : 0;
}

/* ------------------------------------------------------------------ */
/* 输出：单月稳态指标                                                    */
/* ------------------------------------------------------------------ */

export type ThkcosCostItem = {
  key: string;
  labelCn: string;
  labelEn: string;
  cny: number;
  group: 'fixed' | 'storage' | 'sync' | 'traffic';
  /** 占总成本比例 0-1。 */
  share: number;
};

export type ThkcosMetrics = {
  scenario: ThkcosScenarioKey;
  /** 本情景采用的单片流量（GB）。 */
  gbPerTitle: number;
  domainMonthlyCny: number;
  sslMonthlyCny: number;
  r2StorageMonthlyCny: number;
  cosStorageMonthlyCny: number;
  storageMonthlyCny: number;
  syncMonthlyCny: number;
  /** 基座固定成本 = Vultr + 域名 + SSL + 双副本存储 + 增量同步。 */
  baseFixedCny: number;
  trafficGb: number;
  trafficTb: number;
  /** 综合流量单价 ¥/TB = 流量费用 ÷ 总流量。 */
  blendedPerTbCny: number;
  trafficCny: number;
  totalCostCny: number;
  revenueCny: number;
  netCny: number;
  netMargin: number | null;
  /** 每观看人次的流量边际成本。 */
  trafficPerViewerCny: number;
  /** 每部影片的流量成本。 */
  trafficPerTitleCny: number;
  perViewerRevenueCny: number | null;
  perViewerCostCny: number | null;
  /** 盈亏平衡观看人数；null = 结构上不可达或与人数无关。 */
  breakEvenViewers: number | null;
  /** 盈亏平衡片库影片数；null = 不可达或与片库无关。 */
  breakEvenTitles: number | null;
  /** 安全边际 = (H − H*) / H。 */
  safetyMargin: number | null;
  /** 单位经济为负：每观看人次的收入抵不上其流量成本。 */
  negativeUnitEconomics: boolean;
  costs: ThkcosCostItem[];
};

/**
 * 单月稳态测算：
 *   存储 = D·E·(B + C)（R2 主副本 + COS 镜像副本，同容量）
 *   同步 = F·G
 *   基座固定 = A + 域名/12 + SSL/12 + 存储 + 同步 + EO 套餐月费（仅经 EO 模式）
 *   流量TB = H·I·单片GB / 1000
 *   direct：流量费用 = 累进(流量TB, COS 外网下行阶梯) 或 流量包
 *   cdn(EO)：
 *     套餐内含流量先抵扣 → 超出部分走「全球流量包 × 地区抵扣系数」或「超量阶梯累进」
 *     回源量 = 全量 × (1 − 缓存命中率)，始终按 COS 回源阶梯累进
 *   收入 = L1·M1 + L2·M2 + L3·M3（季卡/年卡按月度确认口径折算）
 */
export function computeThkcos(vars: ThkcosVars, scenario: ThkcosScenarioKey): ThkcosMetrics {
  const v = resolve(vars);
  const gbPerTitle = gbForScenario(v, scenario);

  const domainMonthlyCny = v.domainAnnualCny / 12;
  const sslMonthlyCny = v.sslAnnualCny / 12;
  const r2StorageMonthlyCny = v.libraryTitles * v.avgTitleGb * v.r2StoragePerGbCny;
  const cosStorageMonthlyCny = v.libraryTitles * v.avgTitleGb * v.cosStoragePerGbCny;
  const storageMonthlyCny = r2StorageMonthlyCny + cosStorageMonthlyCny;
  const syncMonthlyCny = v.syncGbPerMonth * v.syncPerGbCny;
  // EO 套餐月费（仅经 EO 模式）：固定订阅费，归入基座固定成本
  const eoPlanCny = v.trafficMode === 'cdn' ? v.eoPlanMonthlyCny : 0;
  const baseFixedCny = v.vultrMonthlyCny + domainMonthlyCny + sslMonthlyCny + storageMonthlyCny + syncMonthlyCny + eoPlanCny;

  const trafficGb = v.viewers * v.titlesPerViewer * gbPerTitle;
  const trafficTb = trafficGb / GB_PER_TB;
  const isPackage = v.cdnPricingMode === 'package';

  // 经 EO：先抵扣套餐内含流量，超出部分才计费
  const planIncludedTb = v.eoPlanIncludedGb / GB_PER_TB;
  const trafficAfterPlan = Math.max(0, trafficTb - planIncludedTb);

  const edgeCny =
    v.trafficMode === 'cdn'
      ? isPackage
        ? packageCost(trafficAfterPlan * Math.max(1, v.eoDeductionRatio), v.eoPackages, v.cdnPackagePrice)
        : progressiveCost(trafficAfterPlan, v.eoOverageTiers, 0)
      : isPackage
        ? packageCost(trafficTb, v.cosDownPackages, v.cdnPackagePrice)
        : progressiveCost(trafficTb, v.cosDownTiers, 0);
  // 经 EO：回源量 = 全量 × (1 − 缓存命中率)，始终按阶梯累进
  const originCny = v.trafficMode === 'cdn' ? progressiveCost(trafficTb * (1 - v.cacheHitRatio), v.cosOriginTiers, 0) : 0;
  const trafficCny = edgeCny + originCny;
  const blendedPerTbCny =
    trafficTb > 0
      ? trafficCny / trafficTb
      : v.trafficMode === 'cdn'
        ? (isPackage
            ? firstPackageUnit(v.eoPackages, v.cdnPackagePrice) / Math.max(1, v.eoDeductionRatio)
            : firstTierPrice(v.eoOverageTiers)) +
          (1 - v.cacheHitRatio) * firstTierPrice(v.cosOriginTiers)
        : isPackage
          ? firstPackageUnit(v.cosDownPackages, v.cdnPackagePrice)
          : firstTierPrice(v.cosDownTiers);

  const totalCostCny = baseFixedCny + trafficCny;
  const revenueCny = v.monthlySubs * v.monthlyPriceCny + v.quarterlySubs * v.quarterlyPriceCny + v.yearlySubs * v.yearlyPriceCny;
  const netCny = revenueCny - totalCostCny;

  const trafficPerTitleCny = (gbPerTitle / GB_PER_TB) * blendedPerTbCny;
  const trafficPerViewerCny = v.titlesPerViewer * trafficPerTitleCny;

  // 收入不随观看人数变化，故固定成本已高于收入时，增加人数只会放大亏损。
  const breakEvenViewersRaw =
    trafficPerViewerCny > 0 && revenueCny - baseFixedCny > 0 ? (revenueCny - baseFixedCny) / trafficPerViewerCny : null;
  const breakEvenViewers = breakEvenViewersRaw != null && breakEvenViewersRaw > 0 ? r2(breakEvenViewersRaw) : null;

  const storagePerTitleCny = v.avgTitleGb * (v.r2StoragePerGbCny + v.cosStoragePerGbCny);
  const breakEvenTitlesRaw =
    storagePerTitleCny > 0 && revenueCny - (baseFixedCny - storageMonthlyCny) - trafficCny > 0
      ? (revenueCny - (baseFixedCny - storageMonthlyCny) - trafficCny) / storagePerTitleCny
      : null;
  const breakEvenTitles = breakEvenTitlesRaw != null && breakEvenTitlesRaw > 0 ? r2(breakEvenTitlesRaw) : null;

  const perViewerRevenueCny = v.viewers > 0 ? revenueCny / v.viewers : null;
  const perViewerCostCny = v.viewers > 0 ? totalCostCny / v.viewers : null;
  const safetyMargin =
    breakEvenViewers != null && v.viewers > 0 ? r4((v.viewers - breakEvenViewers) / v.viewers) : null;

  const rawCosts: Omit<ThkcosCostItem, 'share'>[] = [
    { key: 'vultr', labelCn: 'Vultr 云主机', labelEn: 'Vultr Host', cny: v.vultrMonthlyCny, group: 'fixed' },
    { key: 'domain', labelCn: '域名', labelEn: 'Domain', cny: r2(domainMonthlyCny), group: 'fixed' },
    { key: 'ssl', labelCn: 'SSL 证书', labelEn: 'SSL Cert', cny: r2(sslMonthlyCny), group: 'fixed' },
    { key: 'r2Storage', labelCn: 'R2 存储', labelEn: 'R2 Storage', cny: r2(r2StorageMonthlyCny), group: 'storage' },
    { key: 'cosStorage', labelCn: 'COS 存储', labelEn: 'COS Storage', cny: r2(cosStorageMonthlyCny), group: 'storage' },
    { key: 'sync', labelCn: '增量同步', labelEn: 'R2→COS Sync', cny: r2(syncMonthlyCny), group: 'sync' },
    ...(eoPlanCny > 0
      ? [{ key: 'eoPlan', labelCn: 'EO 套餐月费', labelEn: 'EdgeOne Plan', cny: r2(eoPlanCny), group: 'fixed' as const }]
      : []),
    {
      key: 'traffic',
      labelCn: v.trafficMode === 'cdn' ? 'EO 流量（边缘 + 回源）' : 'COS 外网下行',
      labelEn: v.trafficMode === 'cdn' ? 'EdgeOne Traffic' : 'COS Egress',
      cny: r2(trafficCny),
      group: 'traffic',
    },
  ];
  const costTotal = rawCosts.reduce((s, c) => s + c.cny, 0);
  const costs = rawCosts.map((c) => ({ ...c, share: costTotal > 0 ? r4(c.cny / costTotal) : 0 }));

  return {
    scenario,
    gbPerTitle: r2(gbPerTitle),
    domainMonthlyCny: r2(domainMonthlyCny),
    sslMonthlyCny: r2(sslMonthlyCny),
    r2StorageMonthlyCny: r2(r2StorageMonthlyCny),
    cosStorageMonthlyCny: r2(cosStorageMonthlyCny),
    storageMonthlyCny: r2(storageMonthlyCny),
    syncMonthlyCny: r2(syncMonthlyCny),
    baseFixedCny: r2(baseFixedCny),
    trafficGb: r2(trafficGb),
    trafficTb: r4(trafficTb),
    blendedPerTbCny: r2(blendedPerTbCny),
    trafficCny: r2(trafficCny),
    totalCostCny: r2(totalCostCny),
    revenueCny: r2(revenueCny),
    netCny: r2(netCny),
    netMargin: revenueCny > 0 ? r4(netCny / revenueCny) : null,
    trafficPerViewerCny: r4(trafficPerViewerCny),
    trafficPerTitleCny: r4(trafficPerTitleCny),
    perViewerRevenueCny: perViewerRevenueCny == null ? null : r2(perViewerRevenueCny),
    perViewerCostCny: perViewerCostCny == null ? null : r2(perViewerCostCny),
    breakEvenViewers,
    breakEvenTitles,
    safetyMargin,
    negativeUnitEconomics: perViewerRevenueCny != null && perViewerRevenueCny < trafficPerViewerCny,
    costs,
  };
}

/* ------------------------------------------------------------------ */
/* 盈亏曲线（X 轴 = 观看人数）                                            */
/* ------------------------------------------------------------------ */

export type ThkcosCurvePoint = {
  viewers: number;
  revenueCny: number;
  totalCostCny: number;
  fixedCny: number;
  netCny: number;
};

export type ThkcosCurve = {
  scenario: ThkcosScenarioKey;
  points: ThkcosCurvePoint[];
  maxViewers: number;
  /** 当前观看人数（曲线上的现状标记）。 */
  currentViewers: number;
  breakEvenViewers: number | null;
};

/** 以观看人数为横轴扫描收入/成本/净利（成本对人数线性，收入恒定）。 */
export function thkcosCurve(vars: ThkcosVars, scenario: ThkcosScenarioKey, samples = 24): ThkcosCurve {
  const v = resolve(vars);
  const m = computeThkcos(vars, scenario);
  const span = Math.max(
    m.breakEvenViewers != null ? m.breakEvenViewers * 1.8 : 0,
    v.viewers * 1.5,
    100
  );
  const maxViewers = Math.ceil(span / 50) * 50;
  const points: ThkcosCurvePoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const viewers = (maxViewers * i) / samples;
    const totalCostCny = m.baseFixedCny + viewers * m.trafficPerViewerCny;
    points.push({
      viewers: r2(viewers),
      revenueCny: m.revenueCny,
      totalCostCny: r2(totalCostCny),
      fixedCny: m.baseFixedCny,
      netCny: r2(m.revenueCny - totalCostCny),
    });
  }
  return {
    scenario,
    points,
    maxViewers,
    currentViewers: r2(v.viewers),
    breakEvenViewers: m.breakEvenViewers,
  };
}

/* ------------------------------------------------------------------ */
/* 盈利周期推演（X 轴 = 月序）                                            */
/* ------------------------------------------------------------------ */

export type ThkcosProjectionPoint = {
  monthIndex: number;
  ym: string;
  viewers: number;
  subscribers: number;
  revenueCny: number;
  totalCostCny: number;
  netCny: number;
  cumNetCny: number;
};

export type ThkcosProjection = {
  scenario: ThkcosScenarioKey;
  points: ThkcosProjectionPoint[];
  breakEvenMonth: number | null;
  paybackMonth: number | null;
  endNetCny: number | null;
  endCumNetCny: number | null;
};

/** 按观看人数/订阅人数各自的月净增长率向前推演。 */
export function projectThkcos(vars: ThkcosVars, scenario: ThkcosScenarioKey, fromYm: string): ThkcosProjection {
  const v = resolve(vars);
  const m = computeThkcos(vars, scenario);
  const subs = v.monthlySubs + v.quarterlySubs + v.yearlySubs;

  const points: ThkcosProjectionPoint[] = [];
  let cum = 0;
  let breakEvenMonth: number | null = null;
  let paybackMonth: number | null = null;

  for (let i = 0; i <= v.horizonMonths; i++) {
    const viewers = v.viewers * Math.pow(1 + v.viewerGrowth, i);
    const subsI = subs * Math.pow(1 + v.subscriberGrowth, i);
    const revenueCny = v.subscriberGrowth === 0 ? m.revenueCny : m.revenueCny * Math.pow(1 + v.subscriberGrowth, i);
    const totalCostCny = m.baseFixedCny + viewers * m.trafficPerViewerCny;
    const netCny = revenueCny - totalCostCny;
    cum += netCny;
    if (breakEvenMonth === null && netCny >= 0) breakEvenMonth = i;
    if (paybackMonth === null && cum >= 0) paybackMonth = i;
    points.push({
      monthIndex: i,
      ym: shiftMonth(fromYm, i),
      viewers: r2(viewers),
      subscribers: r2(subsI),
      revenueCny: r2(revenueCny),
      totalCostCny: r2(totalCostCny),
      netCny: r2(netCny),
      cumNetCny: r2(cum),
    });
  }

  return {
    scenario,
    points,
    breakEvenMonth,
    paybackMonth,
    endNetCny: points[points.length - 1]?.netCny ?? null,
    endCumNetCny: r2(cum),
  };
}

/* ------------------------------------------------------------------ */
/* 敏感度：单变量 ±delta 对盈亏平衡观看人数的影响                          */
/* ------------------------------------------------------------------ */

export type ThkcosSensitivityRow = {
  key: string;
  labelCn: string;
  labelEn: string;
  baseValue: number;
  /** 单变量 ±delta 引起的盈亏平衡观看人数最大变动量。 */
  impact: number;
};

type PerturbTarget = { key: string; labelCn: string; labelEn: string; fields: (keyof ThkcosVars)[] };

const TIER_FIELDS: (keyof ThkcosVars)[] = ['cosDownTiers', 'eoOverageTiers', 'cosOriginTiers'];
const PACKAGE_FIELDS: (keyof ThkcosVars)[] = ['cosDownPackages', 'eoPackages'];

const PERTURB_TARGETS: PerturbTarget[] = [
  { key: 'perTitleGb', labelCn: '单片流量 J~K', labelEn: 'GB / Title', fields: ['perTitleGbLow', 'perTitleGbHigh'] },
  { key: 'titlesPerViewer', labelCn: '人均月观影部数', labelEn: 'Titles / Viewer', fields: ['titlesPerViewer'] },
  { key: 'cosDown', labelCn: 'COS 外网下行单价', labelEn: 'COS Egress ¥/TB', fields: ['cosDownTiers'] },
  { key: 'eoOverage', labelCn: 'EO 超量阶梯单价', labelEn: 'EO Overage ¥/TB', fields: ['eoOverageTiers'] },
  { key: 'cosOrigin', labelCn: 'COS 回源单价', labelEn: 'COS Origin ¥/TB', fields: ['cosOriginTiers'] },
  { key: 'cosDownPkg', labelCn: 'COS 外网下行资源包', labelEn: 'COS Package', fields: ['cosDownPackages'] },
  { key: 'eoPkg', labelCn: 'EO 全球流量包', labelEn: 'EO Package', fields: ['eoPackages'] },
  { key: 'eoPlan', labelCn: 'EO 套餐月费', labelEn: 'EO Plan ¥/mo', fields: ['eoPlanMonthlyCny'] },
  { key: 'eoRatio', labelCn: 'EO 抵扣系数', labelEn: 'EO Deduction Ratio', fields: ['eoDeductionRatio'] },
  { key: 'cacheHit', labelCn: 'EO 缓存命中率 λ', labelEn: 'Cache Hit', fields: ['cacheHitRatio'] },
  { key: 'syncGb', labelCn: '增量同步数据量 F', labelEn: 'Sync GB/mo', fields: ['syncGbPerMonth'] },
  { key: 'syncUnit', labelCn: '同步单价 G', labelEn: 'Sync ¥/GB', fields: ['syncPerGbCny'] },
  { key: 'subs', labelCn: '订阅人数 L1/L2/L3', labelEn: 'Subscribers', fields: ['monthlySubs', 'quarterlySubs', 'yearlySubs'] },
  { key: 'monthlyPrice', labelCn: '月卡单价 M1', labelEn: 'Monthly Price', fields: ['monthlyPriceCny'] },
  { key: 'quarterlyPrice', labelCn: '季卡单价 M2', labelEn: 'Quarterly Price', fields: ['quarterlyPriceCny'] },
  { key: 'yearlyPrice', labelCn: '年卡单价 M3', labelEn: 'Yearly Price', fields: ['yearlyPriceCny'] },
  { key: 'vultr', labelCn: 'Vultr 月租 A', labelEn: 'Vultr Host', fields: ['vultrMonthlyCny'] },
  { key: 'domain', labelCn: '域名年费', labelEn: 'Domain', fields: ['domainAnnualCny'] },
  { key: 'ssl', labelCn: 'SSL 证书年费', labelEn: 'SSL Cert', fields: ['sslAnnualCny'] },
  { key: 'r2StorageUnit', labelCn: 'R2 存储单价 B', labelEn: 'R2 ¥/GB', fields: ['r2StoragePerGbCny'] },
  { key: 'cosStorageUnit', labelCn: 'COS 存储单价 C', labelEn: 'COS ¥/GB', fields: ['cosStoragePerGbCny'] },
  { key: 'libraryTitles', labelCn: '片库影片数 D', labelEn: 'Library Titles', fields: ['libraryTitles'] },
  { key: 'avgTitleGb', labelCn: '单片体积 E', labelEn: 'GB / Title (E)', fields: ['avgTitleGb'] },
];

/** 敏感度：对每个可用变量做 ±delta 微扰，比较盈亏平衡观看人数的变动幅度。 */
export function thkcosSensitivity(vars: ThkcosVars, scenario: ThkcosScenarioKey, delta = 0.2): ThkcosSensitivityRow[] {
  const base = computeThkcos(vars, scenario).breakEvenViewers;
  if (base == null) return [];

  const rows: ThkcosSensitivityRow[] = [];
  /** 取某字段的「代表值」：阶梯数组取首档单价、资源包取首档折算单价，便于同口径判定与展示。 */
  const fieldPrice = (f: keyof ThkcosVars): number => {
    const val = vars[f];
    if (!Array.isArray(val)) return num(val as number | null);
    if (!val.length) return 0;
    const first = val[0] as Record<string, unknown>;
    if ('pricePerTbCny' in first) return num(first.pricePerTbCny as number);
    const sizeGb = num(first.sizeGb as number);
    return sizeGb > 0 ? (num(first.listCny as number) / sizeGb) * GB_PER_TB : 0;
  };

  for (const target of PERTURB_TARGETS) {
    const present = target.fields.filter((f) => fieldPrice(f) > 0);
    if (present.length === 0) continue;
    const baseValue = fieldPrice(present[0]);

    const shifted = (factor: number): number | null => {
      const next: ThkcosVars = { ...vars };
      const put = (key: keyof ThkcosVars, value: unknown) => {
        (next as unknown as Record<string, unknown>)[key] = value;
      };
      for (const f of present) {
        if (TIER_FIELDS.includes(f)) {
          const arr = vars[f] as CdnTier[] | null;
          put(f, arr ? arr.map((t) => ({ ...t, pricePerTbCny: t.pricePerTbCny * factor })) : arr);
        } else if (PACKAGE_FIELDS.includes(f)) {
          const arr = vars[f] as CdnPackage[] | null;
          put(f, arr ? arr.map((p) => ({ ...p, listCny: p.listCny * factor, renewCny: p.renewCny * factor })) : arr);
        } else if (f === 'cacheHitRatio') {
          put(f, Math.min(1, Math.max(0, num(vars[f] as number | null) * factor)));
        } else {
          put(f, num(vars[f] as number | null) * factor);
        }
      }
      return computeThkcos(next, scenario).breakEvenViewers;
    };

    const lo = shifted(1 - delta);
    const hi = shifted(1 + delta);
    const candidates = [lo, hi, base].filter((x): x is number => x != null);
    const impact = candidates.length ? r2(Math.max(...candidates) - Math.min(...candidates)) : 0;
    if (impact <= 0) continue;
    rows.push({
      key: target.key,
      labelCn: target.labelCn,
      labelEn: target.labelEn,
      baseValue: r2(baseValue),
      impact,
    });
  }
  return rows.sort((a, b) => b.impact - a.impact);
}

/* ------------------------------------------------------------------ */
/* 汇总：一次算完三档情景                                                 */
/* ------------------------------------------------------------------ */

export type ThkcosModel = {
  vars: ThkcosVars;
  results: Record<ThkcosScenarioKey, ThkcosMetrics>;
  curves: Record<ThkcosScenarioKey, ThkcosCurve>;
  projections: Record<ThkcosScenarioKey, ThkcosProjection>;
  sensitivity: Record<ThkcosScenarioKey, ThkcosSensitivityRow[]>;
  warnings: string[];
};

/** 输入校验提示（不阻断计算，仅提示口径风险）。 */
export function thkcosWarnings(vars: ThkcosVars): string[] {
  const v = resolve(vars);
  const out: string[] = [];
  if (v.monthlySubs + v.quarterlySubs + v.yearlySubs === 0) out.push('未填订阅人数，月收入为 0。');
  if (v.monthlyPriceCny + v.quarterlyPriceCny + v.yearlyPriceCny === 0) out.push('未填订阅单价，月收入为 0。');
  if (v.libraryTitles === 0 || v.avgTitleGb === 0 || (v.r2StoragePerGbCny === 0 && v.cosStoragePerGbCny === 0)) {
    out.push('片库数量、单片体积或存储单价为空，存储成本按 0 计。');
  }
  if (v.syncGbPerMonth === 0 || v.syncPerGbCny === 0) out.push('增量同步数据量或同步单价为空，同步成本按 0 计。');
  if (v.viewers === 0 || v.titlesPerViewer === 0) out.push('观看人数或人均观影部数为空，流量成本按 0 计。');
  if (v.perTitleGbLow > 0 && v.perTitleGbHigh > 0 && v.perTitleGbLow > v.perTitleGbHigh) {
    out.push('单片流量下限 J 大于上限 K，已自动交换后计算。');
  }
  const isPackage = v.cdnPricingMode === 'package';
  const modeCn = isPackage ? '资源包' : '阶梯累进';
  if (v.trafficMode === 'cdn') {
    out.push(
      isPackage
        ? '按「经 EO · 全球流量包」口径计费：套餐内含流量先抵扣，超出部分按地区抵扣系数（如亚太1区 2.49）换算后取最省整包覆盖；回源 = 全量 × (1 − 缓存命中率) 仍按 COS 回源阶梯累进。'
        : '按「经 EO · 超量阶梯」口径计费：套餐内含流量先抵扣，超出部分按月度阶梯累进；回源 = 全量 × (1 − 缓存命中率)。'
    );
    const edgeMissing = isPackage ? !v.eoPackages : !v.eoOverageTiers;
    if (v.eoPlanMonthlyCny === 0 || v.eoPlanIncludedGb === 0) {
      out.push('经 EO 口径下未配置套餐月费或套餐内含流量，将按 0 计。');
    }
    if (v.eoDeductionRatio === 0) {
      out.push('未配置 EO 流量包地区抵扣系数，默认按 1（1:1）计算。');
    }
    if (edgeMissing || !v.cosOriginTiers) {
      out.push('经 EO 口径下超量阶梯/流量包或 COS 回源阶梯未配置，对应流量成本按 0 计。');
    }
  } else {
    const egressMissing = isPackage ? !v.cosDownPackages : !v.cosDownTiers;
    if (egressMissing) {
      out.push(`按「直连 COS · ${modeCn}」口径计费，但未配置 COS 外网下行${isPackage ? '资源包' : '阶梯'}，流量成本按 0 计。`);
    }
  }
  if (v.domainAnnualCny + v.sslAnnualCny === 0) out.push('域名与 SSL 证书年费为空，未计入基座固定成本。');
  return out;
}

/** 一次算完三档情景（含曲线、推演与敏感度）。 */
export function buildThkcosModel(vars: ThkcosVars, fromYm: string): ThkcosModel {
  const results = {} as Record<ThkcosScenarioKey, ThkcosMetrics>;
  const curves = {} as Record<ThkcosScenarioKey, ThkcosCurve>;
  const projections = {} as Record<ThkcosScenarioKey, ThkcosProjection>;
  const sensitivity = {} as Record<ThkcosScenarioKey, ThkcosSensitivityRow[]>;
  for (const s of THKCOS_SCENARIOS) {
    results[s] = computeThkcos(vars, s);
    curves[s] = thkcosCurve(vars, s);
    projections[s] = projectThkcos(vars, s, fromYm);
    sensitivity[s] = thkcosSensitivity(vars, s);
  }
  return { vars, results, curves, projections, sensitivity, warnings: thkcosWarnings(vars) };
}
