import { shiftMonth } from './unitEconomics';
import {
  type CdnTier,
  type CdnPackage,
  type CdnPricingMode,
  type CdnPackagePrice,
  progressiveCost,
  packageCost,
  GB_PER_TB,
  MB_PER_GB,
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
  /** H1 基础会员月观看人数 人 */
  basicViewers: number | null;
  /** H2 高级会员月观看人数 人 */
  premiumViewers: number | null;
  /** I1 基础会员人均月观影分钟数 分钟 */
  basicMinutesPerViewer: number | null;
  /** I2 高级会员人均月观影分钟数 分钟 */
  premiumMinutesPerViewer: number | null;
  /** J1 基础会员每分钟流量下限 MB */
  basicPerMinMbLow: number | null;
  /** J2 高级会员每分钟流量下限 MB */
  premiumPerMinMbLow: number | null;
  /** K1 基础会员每分钟流量上限 MB */
  basicPerMinMbHigh: number | null;
  /** K2 高级会员每分钟流量上限 MB */
  premiumPerMinMbHigh: number | null;
  /** λ CDN 缓存命中率 0-1（仅 cdn 模式，回源流量 = 未命中部分） */
  cacheHitRatio: number | null;
  /** 直连：COS 外网下行按量单价（沿用现有阶梯字段存储，取首档折算为 ¥/GB） */
  cosDownTiers: CdnTier[] | null;
  /** 经 EO：套餐外超量阶梯（固定 7 档，¥/TB） */
  eoOverageTiers: CdnTier[] | null;
  /** 经 EO：COS 回源单价（沿用现有字段存储，取首档折算为 ¥/GB） */
  cosOriginTiers: CdnTier[] | null;
  /** 计费口径：tiered = 按量（直连按官方单价 / 经 EO 按超量阶梯），package = 预付费流量包（空 = tiered） */
  cdnPricingMode: CdnPricingMode | null;
  /** 资源包价格档（空 = renew） */
  cdnPackagePrice: CdnPackagePrice | null;
  /** 直连：COS 外网下行资源包（预置 8 档，最大放宽至 1PB） */
  cosDownPackages: CdnPackage[] | null;
  /** 经 EO：全球流量包（预置 11 档，按地区抵扣系数换算，最大放宽至 50PB） */
  eoPackages: CdnPackage[] | null;
  /** EO 套餐月费 ¥/月（如个人版 29.9） */
  eoPlanMonthlyCny: number | null;
  /** EO 套餐内含流量 GB/月（如个人版 50） */
  eoPlanIncludedGb: number | null;
  /** EO 流量包地区抵扣系数（亚太1区 = 2.49，即 1GB 流量包只抵 1/2.49 GB 流量） */
  eoDeductionRatio: number | null;
  /** L1 基础会员 · 月卡订阅人数 */
  basicMonthlySubs: number | null;
  /** M1 基础会员 · 月卡 ¥/月 */
  basicMonthlyPriceCny: number | null;
  /** L2 基础会员 · 季卡订阅人数（实收 ×3） */
  basicQuarterlySubs: number | null;
  /** M2 基础会员 · 季卡 ¥/月（实收 = ×3） */
  basicQuarterlyPriceCny: number | null;
  /** L3 基础会员 · 年卡订阅人数（实收 ×12） */
  basicYearlySubs: number | null;
  /** M3 基础会员 · 年卡 ¥/月（实收 = ×12） */
  basicYearlyPriceCny: number | null;
  /** L4 高级会员 · 月卡订阅人数 */
  premiumMonthlySubs: number | null;
  /** M4 高级会员 · 月卡 ¥/月 */
  premiumMonthlyPriceCny: number | null;
  /** L5 高级会员 · 季卡订阅人数（实收 ×3） */
  premiumQuarterlySubs: number | null;
  /** M5 高级会员 · 季卡 ¥/月（实收 = ×3） */
  premiumQuarterlyPriceCny: number | null;
  /** L6 高级会员 · 年卡订阅人数（实收 ×12） */
  premiumYearlySubs: number | null;
  /** M6 高级会员 · 年卡 ¥/月（实收 = ×12） */
  premiumYearlyPriceCny: number | null;
  /** 观看人数月净增长率 0-1 */
  viewerGrowth: number | null;
  /** 订阅人数月净增长率 0-1 */
  subscriberGrowth: number | null;
  /** 推演月数 */
  horizonMonths: number;
};

export type ThkcosScenarioKey = 'pessimistic' | 'neutral' | 'optimistic';
export const THKCOS_SCENARIOS: ThkcosScenarioKey[] = ['pessimistic', 'neutral', 'optimistic'];

/** 三档情景的口径：悲观取每分钟流量上限、乐观取下限。 */
export const THKCOS_SCENARIO_LABEL: Record<
  ThkcosScenarioKey,
  { cn: string; en: string; stroke: string; note: string }
> = {
  pessimistic: { cn: '悲观', en: 'Pessimistic', stroke: '#fb7185', note: '每分钟流量取 K 上限' },
  neutral: { cn: '中性', en: 'Neutral', stroke: '#38bdf8', note: '每分钟流量取 (J+K)/2' },
  optimistic: { cn: '乐观', en: 'Optimistic', stroke: '#34d399', note: '每分钟流量取 J 下限' },
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
    basicViewers: num(vars.basicViewers),
    premiumViewers: num(vars.premiumViewers),
    basicMinutesPerViewer: num(vars.basicMinutesPerViewer),
    premiumMinutesPerViewer: num(vars.premiumMinutesPerViewer),
    basicPerMinMbLow: num(vars.basicPerMinMbLow),
    premiumPerMinMbLow: num(vars.premiumPerMinMbLow),
    basicPerMinMbHigh: num(vars.basicPerMinMbHigh),
    premiumPerMinMbHigh: num(vars.premiumPerMinMbHigh),
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
    basicMonthlySubs: num(vars.basicMonthlySubs),
    basicMonthlyPriceCny: num(vars.basicMonthlyPriceCny),
    basicQuarterlySubs: num(vars.basicQuarterlySubs),
    basicQuarterlyPriceCny: num(vars.basicQuarterlyPriceCny),
    basicYearlySubs: num(vars.basicYearlySubs),
    basicYearlyPriceCny: num(vars.basicYearlyPriceCny),
    premiumMonthlySubs: num(vars.premiumMonthlySubs),
    premiumMonthlyPriceCny: num(vars.premiumMonthlyPriceCny),
    premiumQuarterlySubs: num(vars.premiumQuarterlySubs),
    premiumQuarterlyPriceCny: num(vars.premiumQuarterlyPriceCny),
    premiumYearlySubs: num(vars.premiumYearlySubs),
    premiumYearlyPriceCny: num(vars.premiumYearlyPriceCny),
    viewerGrowth: num(vars.viewerGrowth),
    subscriberGrowth: num(vars.subscriberGrowth),
    horizonMonths: Math.max(1, Math.min(60, num(vars.horizonMonths) || 24)),
  };
}

/** 某组的每分钟流量区间（未填一侧时以另一侧兜底）。 */
function mbRangeOf(low: number, high: number): { low: number; high: number } {
  const j = low > 0 ? low : high;
  const k = high > 0 ? high : low;
  return j <= k ? { low: j, high: k } : { low: k, high: j };
}

/** 某组在某情景下的每分钟流量取值（MB）。 */
function mbForGroup(low: number, high: number, scenario: ThkcosScenarioKey): number {
  const { low: lo, high: hi } = mbRangeOf(low, high);
  if (scenario === 'optimistic') return lo;
  if (scenario === 'pessimistic') return hi;
  return (lo + hi) / 2;
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

/** 订阅收入（月度确认口径）：基础/高级 × 月/季/年 六档合计。 */
function subsRevenue(v: Numeric): number {
  return (
    v.basicMonthlySubs * v.basicMonthlyPriceCny +
    v.basicQuarterlySubs * v.basicQuarterlyPriceCny +
    v.basicYearlySubs * v.basicYearlyPriceCny +
    v.premiumMonthlySubs * v.premiumMonthlyPriceCny +
    v.premiumQuarterlySubs * v.premiumQuarterlyPriceCny +
    v.premiumYearlySubs * v.premiumYearlyPriceCny
  );
}

/** 订阅人数合计（基础 + 高级 × 月/季/年）。 */
function subsCount(v: Numeric): number {
  return (
    v.basicMonthlySubs +
    v.basicQuarterlySubs +
    v.basicYearlySubs +
    v.premiumMonthlySubs +
    v.premiumQuarterlySubs +
    v.premiumYearlySubs
  );
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
  /** 本情景采用的每分钟流量（MB）。 */
  mbPerMin: number;
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
  /** 每分钟流量的流量成本。 */
  trafficPerMinCny: number;
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
 *   流量TB = H·I·每分钟MB / (1024×1000)
 *   direct：流量费用 = 流量GB × COS 外网下行单价（¥/GB） 或 流量包
 *   cdn(EO)：
 *     套餐内含流量先抵扣 → 超出部分走「全球流量包 × 地区抵扣系数」或「超量阶梯累进」
 *     回源量 = 全量 × (1 − 缓存命中率)，按 COS 回源单价（¥/GB）计费
 *   收入 = 基础/高级 × 月/季/年 六档合计（季卡/年卡按月度确认口径折算）
 */
export function computeThkcos(vars: ThkcosVars, scenario: ThkcosScenarioKey): ThkcosMetrics {
  const v = resolve(vars);
  const basicMb = mbForGroup(v.basicPerMinMbLow, v.basicPerMinMbHigh, scenario);
  const premiumMb = mbForGroup(v.premiumPerMinMbLow, v.premiumPerMinMbHigh, scenario);

  const domainMonthlyCny = v.domainAnnualCny / 12;
  const sslMonthlyCny = v.sslAnnualCny / 12;
  const r2StorageMonthlyCny = v.libraryTitles * v.avgTitleGb * v.r2StoragePerGbCny;
  const cosStorageMonthlyCny = v.libraryTitles * v.avgTitleGb * v.cosStoragePerGbCny;
  const storageMonthlyCny = r2StorageMonthlyCny + cosStorageMonthlyCny;
  const syncMonthlyCny = v.syncGbPerMonth * v.syncPerGbCny;
  // EO 套餐月费（仅经 EO 模式）：固定订阅费，归入基座固定成本
  const eoPlanCny = v.trafficMode === 'cdn' ? v.eoPlanMonthlyCny : 0;
  const baseFixedCny = v.vultrMonthlyCny + domainMonthlyCny + sslMonthlyCny + storageMonthlyCny + syncMonthlyCny + eoPlanCny;

  // 普通 + 重度两组各自：人数 × 人均分钟 × 每分钟 MB，求和得总 MB → GB → TB
  const totalViewers = v.basicViewers + v.premiumViewers;
  const totalMinutes =
    v.basicViewers * v.basicMinutesPerViewer + v.premiumViewers * v.premiumMinutesPerViewer;
  const trafficMb =
    v.basicViewers * v.basicMinutesPerViewer * basicMb +
    v.premiumViewers * v.premiumMinutesPerViewer * premiumMb;
  const mbPerMin = totalMinutes > 0 ? trafficMb / totalMinutes : 0;
  const trafficGb = trafficMb / MB_PER_GB;
  const trafficTb = trafficGb / GB_PER_TB;
  const isPackage = v.cdnPricingMode === 'package';

  // 经 EO：先抵扣套餐内含流量，超出部分才计费
  const planIncludedTb = v.eoPlanIncludedGb / GB_PER_TB;
  const trafficAfterPlan = Math.max(0, trafficTb - planIncludedTb);

  const directUnitPerGbCny = firstTierPrice(v.cosDownTiers) / GB_PER_TB;
  const edgeCny =
    v.trafficMode === 'cdn'
      ? isPackage
        ? packageCost(trafficAfterPlan * Math.max(1, v.eoDeductionRatio), v.eoPackages, v.cdnPackagePrice)
        : progressiveCost(trafficAfterPlan, v.eoOverageTiers, 0)
      : isPackage
        ? packageCost(trafficTb, v.cosDownPackages, v.cdnPackagePrice)
        : trafficGb * directUnitPerGbCny;
  // 经 EO：回源量 = 全量 × (1 − 缓存命中率)，按 COS 回源单价（¥/GB）计费
  const originUnitPerGbCny = firstTierPrice(v.cosOriginTiers) / GB_PER_TB;
  const originCny = v.trafficMode === 'cdn' ? trafficGb * (1 - v.cacheHitRatio) * originUnitPerGbCny : 0;
  const trafficCny = edgeCny + originCny;
  const blendedPerTbCny =
    trafficTb > 0
      ? trafficCny / trafficTb
      : v.trafficMode === 'cdn'
        ? (isPackage
            ? firstPackageUnit(v.eoPackages, v.cdnPackagePrice) / Math.max(1, v.eoDeductionRatio)
            : firstTierPrice(v.eoOverageTiers)) +
          (1 - v.cacheHitRatio) * originUnitPerGbCny * GB_PER_TB
        : isPackage
          ? firstPackageUnit(v.cosDownPackages, v.cdnPackagePrice)
          : directUnitPerGbCny * GB_PER_TB;

  const totalCostCny = baseFixedCny + trafficCny;
  const revenueCny = subsRevenue(v);
  const netCny = revenueCny - totalCostCny;

  // 按总分钟 / 总人数摊薄（两组口径加权平均）
  const trafficPerMinCny = totalMinutes > 0 ? trafficCny / totalMinutes : 0;
  const trafficPerViewerCny = totalViewers > 0 ? trafficCny / totalViewers : 0;

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

  const perViewerRevenueCny = totalViewers > 0 ? revenueCny / totalViewers : null;
  const perViewerCostCny = totalViewers > 0 ? totalCostCny / totalViewers : null;
  const safetyMargin =
    breakEvenViewers != null && totalViewers > 0 ? r4((totalViewers - breakEvenViewers) / totalViewers) : null;

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
    mbPerMin: r2(mbPerMin),
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
    trafficPerMinCny: r4(trafficPerMinCny),
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
  const totalViewers = v.basicViewers + v.premiumViewers;
  const span = Math.max(
    m.breakEvenViewers != null ? m.breakEvenViewers * 1.8 : 0,
    totalViewers * 1.5,
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
    currentViewers: r2(totalViewers),
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
  const subs = subsCount(v);
  const totalViewers = v.basicViewers + v.premiumViewers;

  const points: ThkcosProjectionPoint[] = [];
  let cum = 0;
  let breakEvenMonth: number | null = null;
  let paybackMonth: number | null = null;

  for (let i = 0; i <= v.horizonMonths; i++) {
    const viewers = totalViewers * Math.pow(1 + v.viewerGrowth, i);
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
  { key: 'basicPerMinMb', labelCn: '基础会员每分钟流量 J1~K1', labelEn: 'Basic MB/Min', fields: ['basicPerMinMbLow', 'basicPerMinMbHigh'] },
  { key: 'premiumPerMinMb', labelCn: '高级会员每分钟流量 J2~K2', labelEn: 'Premium MB/Min', fields: ['premiumPerMinMbLow', 'premiumPerMinMbHigh'] },
  { key: 'basicMinutes', labelCn: '基础会员人均月观影分钟数', labelEn: 'Basic Min/Viewer', fields: ['basicMinutesPerViewer'] },
  { key: 'premiumMinutes', labelCn: '高级会员人均月观影分钟数', labelEn: 'Premium Min/Viewer', fields: ['premiumMinutesPerViewer'] },
  { key: 'basicViewers', labelCn: '基础会员人数 H1', labelEn: 'Basic Viewers', fields: ['basicViewers'] },
  { key: 'premiumViewers', labelCn: '高级会员人数 H2', labelEn: 'Premium Viewers', fields: ['premiumViewers'] },
  { key: 'cosDown', labelCn: 'COS 外网下行单价', labelEn: 'COS Egress ¥/GB', fields: ['cosDownTiers'] },
  { key: 'eoOverage', labelCn: 'EO 超量阶梯单价', labelEn: 'EO Overage ¥/TB', fields: ['eoOverageTiers'] },
  { key: 'cosOrigin', labelCn: 'COS 回源单价', labelEn: 'COS Origin ¥/GB', fields: ['cosOriginTiers'] },
  { key: 'cosDownPkg', labelCn: 'COS 外网下行资源包', labelEn: 'COS Package', fields: ['cosDownPackages'] },
  { key: 'eoPkg', labelCn: 'EO 全球流量包', labelEn: 'EO Package', fields: ['eoPackages'] },
  { key: 'eoPlan', labelCn: 'EO 套餐月费', labelEn: 'EO Plan ¥/mo', fields: ['eoPlanMonthlyCny'] },
  { key: 'eoRatio', labelCn: 'EO 抵扣系数', labelEn: 'EO Deduction Ratio', fields: ['eoDeductionRatio'] },
  { key: 'cacheHit', labelCn: 'EO 缓存命中率 λ', labelEn: 'Cache Hit', fields: ['cacheHitRatio'] },
  { key: 'syncGb', labelCn: '增量同步数据量 F', labelEn: 'Sync GB/mo', fields: ['syncGbPerMonth'] },
  { key: 'syncUnit', labelCn: '同步单价 G', labelEn: 'Sync ¥/GB', fields: ['syncPerGbCny'] },
  { key: 'basicSubs', labelCn: '基础会员人数 L1/L2/L3', labelEn: 'Basic Subs', fields: ['basicMonthlySubs', 'basicQuarterlySubs', 'basicYearlySubs'] },
  { key: 'premiumSubs', labelCn: '高级会员人数 L4/L5/L6', labelEn: 'Premium Subs', fields: ['premiumMonthlySubs', 'premiumQuarterlySubs', 'premiumYearlySubs'] },
  { key: 'basicPrice', labelCn: '基础会员单价 M1/M2/M3', labelEn: 'Basic Price', fields: ['basicMonthlyPriceCny', 'basicQuarterlyPriceCny', 'basicYearlyPriceCny'] },
  { key: 'premiumPrice', labelCn: '高级会员单价 M4/M5/M6', labelEn: 'Premium Price', fields: ['premiumMonthlyPriceCny', 'premiumQuarterlyPriceCny', 'premiumYearlyPriceCny'] },
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
    if ('pricePerTbCny' in first) {
      const price = num(first.pricePerTbCny as number);
      return f === 'cosOriginTiers' || f === 'cosDownTiers' ? price / GB_PER_TB : price;
    }
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
  const subs = subsCount(v);
  const totalViewers = v.basicViewers + v.premiumViewers;
  if (subs === 0) out.push('未填订阅人数，月收入为 0。');
  const priceSum =
    v.basicMonthlyPriceCny + v.basicQuarterlyPriceCny + v.basicYearlyPriceCny +
    v.premiumMonthlyPriceCny + v.premiumQuarterlyPriceCny + v.premiumYearlyPriceCny;
  if (priceSum === 0) out.push('未填订阅单价，月收入为 0。');
  if (v.libraryTitles === 0 || v.avgTitleGb === 0 || (v.r2StoragePerGbCny === 0 && v.cosStoragePerGbCny === 0)) {
    out.push('片库数量、单片体积或存储单价为空，存储成本按 0 计。');
  }
  if (v.syncGbPerMonth === 0 || v.syncPerGbCny === 0) out.push('增量同步数据量或同步单价为空，同步成本按 0 计。');
  if (totalViewers === 0) out.push('基础/高级会员人数为空，流量成本按 0 计。');
  if (totalViewers > 0 && (v.basicMinutesPerViewer + v.premiumMinutesPerViewer === 0)) {
    out.push('人均观影分钟数为空，流量成本按 0 计。');
  }
  if (v.basicPerMinMbLow > 0 && v.basicPerMinMbHigh > 0 && v.basicPerMinMbLow > v.basicPerMinMbHigh) {
    out.push('基础会员每分钟流量下限 J1 大于上限 K1，已自动交换后计算。');
  }
  if (v.premiumPerMinMbLow > 0 && v.premiumPerMinMbHigh > 0 && v.premiumPerMinMbLow > v.premiumPerMinMbHigh) {
    out.push('高级会员每分钟流量下限 J2 大于上限 K2，已自动交换后计算。');
  }
  if (totalViewers > subs && subs > 0) {
    out.push(`基础+高级会员人数（${totalViewers}）超过订阅总人数（${subs}），请核对。`);
  }
  const isPackage = v.cdnPricingMode === 'package';
  const modeCn = isPackage ? '资源包' : v.trafficMode === 'cdn' ? '阶梯累进' : '按量单价';
  if (v.trafficMode === 'cdn') {
    out.push(
      isPackage
        ? '按「经 EO · 全球流量包」口径计费：套餐内含流量先抵扣，超出部分按地区抵扣系数（如亚太1区 2.49）换算后取最省整包覆盖；回源 = 全量 × (1 − 缓存命中率) 按 COS 回源单价计费。'
        : '按「经 EO · 超量阶梯」口径计费：套餐内含流量先抵扣，超出部分按月度阶梯累进；回源 = 全量 × (1 − 缓存命中率) 按 COS 回源单价计费。'
    );
    const edgeMissing = isPackage ? !v.eoPackages : !v.eoOverageTiers;
    if (v.eoPlanMonthlyCny === 0 || v.eoPlanIncludedGb === 0) {
      out.push('经 EO 口径下未配置套餐月费或套餐内含流量，将按 0 计。');
    }
    if (v.eoDeductionRatio === 0) {
      out.push('未配置 EO 流量包地区抵扣系数，默认按 1（1:1）计算。');
    }
    if (edgeMissing || !v.cosOriginTiers) {
      out.push('经 EO 口径下超量阶梯/流量包或 COS 回源单价未配置，对应流量成本按 0 计。');
    }
  } else {
    const egressMissing = isPackage ? !v.cosDownPackages : !v.cosDownTiers;
    if (egressMissing) {
      out.push(`按「直连 COS · ${modeCn}」口径计费，但未配置 COS 外网下行${isPackage ? '资源包' : '单价'}，流量成本按 0 计。`);
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
