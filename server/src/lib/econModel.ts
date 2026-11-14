import { shiftMonth } from './unitEconomics';

/* ------------------------------------------------------------------ */
/* 输入：全变量经营测算的物理量                                          */
/* ------------------------------------------------------------------ */

/**
 * CDN 流量阶梯档位（腾讯云「月度阶梯累进」口径）。
 * upToTb = 该档流量上限（TB），null 表示无上限（末档）；
 * pricePerTbCny = 落入该档区间的流量单价 ¥/TB。
 */
export type CdnTier = {
  upToTb: number | null;
  pricePerTbCny: number;
};

/** CDN 计价模式：tiered = 按量阶梯累进，package = 预付费流量包。 */
export type CdnPricingMode = 'tiered' | 'package';
/** 资源包价格档：renew = 连续包月自动续订价，list = 单次购买刊例价。 */
export type CdnPackagePrice = 'list' | 'renew';

/**
 * CDN 预付费流量包单档（固定 6 档：100GB / 500GB / 1TB / 5TB / 10TB / 50TB）。
 * sizeGb 为包容量，listCny / renewCny 为两种价格档下的整包价格 ¥。
 */
export type CdnPackage = {
  sizeGb: number;
  listCny: number;
  renewCny: number;
};

/** 全变量测算输入（NULL = 未填，计算时按 0 处理）。 */
export type EconVars = {
  /** A 云主机月租 ¥/月 */
  vultrMonthlyCny: number | null;
  /** 域名年费 ¥/年 */
  domainAnnualCny: number | null;
  /** SSL 证书年费 ¥/年 */
  sslAnnualCny: number | null;
  /** B R2 每 GB 月存储单价 ¥/GB */
  r2StoragePerGbCny: number | null;
  /** C 每月 Class A 操作费 ¥/月 */
  r2ClassAMonthlyCny: number | null;
  /** D 片库影片数 部 */
  libraryTitles: number | null;
  /** E 单片平均体积 GB */
  avgTitleGb: number | null;
  /** F 亚太一区 ¥/TB（阶梯缺失时的单档兜底价） */
  cdnTier1PerTbCny: number | null;
  /** G 亚太二区 ¥/TB（阶梯缺失时的单档兜底价） */
  cdnTier2PerTbCny: number | null;
  /** F 亚太一区阶梯单价（固定 5 档，空 = 按 F 单档计） */
  cdnTier1Tiers: CdnTier[] | null;
  /** G 亚太二区阶梯单价（固定 5 档，空 = 按 G 单档计） */
  cdnTier2Tiers: CdnTier[] | null;
  /** CDN 计价模式（空 = tiered） */
  cdnPricingMode: CdnPricingMode | null;
  /** 资源包价格档（空 = renew） */
  cdnPackagePrice: CdnPackagePrice | null;
  /** F 亚太一区资源包（固定 6 档） */
  cdnTier1Packages: CdnPackage[] | null;
  /** G 亚太二区资源包（固定 6 档） */
  cdnTier2Packages: CdnPackage[] | null;
  /** α 亚太一区流量占比 0-1 */
  tier1Share: number | null;
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

export type EconScenarioKey = 'pessimistic' | 'neutral' | 'optimistic';
export const ECON_SCENARIOS: EconScenarioKey[] = ['pessimistic', 'neutral', 'optimistic'];

/** 三档情景的口径：悲观取每分钟流量上限、乐观取下限。 */
export const ECON_SCENARIO_LABEL: Record<
  EconScenarioKey,
  { cn: string; en: string; stroke: string; note: string }
> = {
  pessimistic: { cn: '悲观', en: 'Pessimistic', stroke: '#fb7185', note: '每分钟流量取 K 上限' },
  neutral: { cn: '中性', en: 'Neutral', stroke: '#38bdf8', note: '每分钟流量取 (J+K)/2' },
  optimistic: { cn: '乐观', en: 'Optimistic', stroke: '#34d399', note: '每分钟流量取 J 下限' },
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const num = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));

/** 全部字段按 0 补齐后的数值版本（阶梯 / 资源包数组与枚举原样保留）。 */
type Numeric = {
  [K in Exclude<
    keyof EconVars,
    'cdnTier1Tiers' | 'cdnTier2Tiers' | 'cdnTier1Packages' | 'cdnTier2Packages' | 'cdnPricingMode' | 'cdnPackagePrice'
  >]: number;
} & {
  cdnTier1Tiers: CdnTier[] | null;
  cdnTier2Tiers: CdnTier[] | null;
  cdnTier1Packages: CdnPackage[] | null;
  cdnTier2Packages: CdnPackage[] | null;
  cdnPricingMode: CdnPricingMode;
  cdnPackagePrice: CdnPackagePrice;
};

/** 腾讯云 CDN 计费进制：1TB = 1000GB（非 1024）。 */
export const GB_PER_TB = 1000;
/** MB → GB 换算：1GB = 1024MB（与「视频流量测算」口径一致）。 */
export const MB_PER_GB = 1024;

/** 归一化阶梯数组：过滤无效档位，空数组视为「未启用阶梯」。 */
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

/**
 * 月度阶梯累进计价：每档只对落入该档区间的流量计价，再求和。
 * tiers 为空时退化为「单档全量计价」（单价 fallbackPerTb，等价于旧行为）。
 */
export function progressiveCost(tb: number, tiers: CdnTier[] | null, fallbackPerTb: number): number {
  if (!(tb > 0)) return 0;
  if (!tiers || tiers.length === 0) return tb * fallbackPerTb;
  let cost = 0;
  let prev = 0;
  for (const t of tiers) {
    if (prev >= tb) break;
    const upper = t.upToTb == null ? tb : Math.min(tb, t.upToTb);
    const seg = upper - prev;
    if (seg > 0) {
      cost += seg * t.pricePerTbCny;
      prev = upper;
    }
  }
  if (prev < tb) cost += (tb - prev) * tiers[tiers.length - 1].pricePerTbCny;
  return cost;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    [x, y] = [y, x % y];
  }
  return x;
}

/**
 * 资源包（预付费流量包）最优覆盖计价：用最省的一组整包覆盖当月流量（容量可溢出）。
 * 以各档容量的最大公约数为 DP 步长（固定 6 档时步长 = 100GB），
 * 求「覆盖至少 n·步长」的最小整包总价；允许跨档组合与超量购买。
 * packages 为空视为「未配置资源包」，按 0 计。
 */
export function packageCost(tb: number, packages: CdnPackage[] | null, priceKey: CdnPackagePrice): number {
  if (!(tb > 0) || !packages || packages.length === 0) return 0;
  const items = packages
    .map((p) => ({
      sizeGb: Number(p.sizeGb),
      price: priceKey === 'list' ? Number(p.listCny) : Number(p.renewCny),
    }))
    .filter((i) => i.sizeGb > 0 && i.price > 0);
  if (items.length === 0) return 0;

  const step = items.reduce((g, i) => gcd(g, i.sizeGb), 0) || 1;
  const units = Math.max(1, Math.ceil((tb * GB_PER_TB) / step));
  const sizes = items.map((i) => Math.max(1, Math.round(i.sizeGb / step)));
  const prices = items.map((i) => i.price);

  // dp[n] = 覆盖至少 n 个步长容量的最小整包成本（n ≤ 0 时为 0）
  const dp = new Float64Array(units + 1);
  for (let n = 1; n <= units; n++) {
    let best = Infinity;
    for (let k = 0; k < sizes.length; k++) {
      const c = prices[k] + (n - sizes[k] > 0 ? dp[n - sizes[k]] : 0);
      if (c < best) best = c;
    }
    dp[n] = best;
  }
  return dp[units];
}

function resolve(vars: EconVars): Numeric {
  return {
    vultrMonthlyCny: num(vars.vultrMonthlyCny),
    domainAnnualCny: num(vars.domainAnnualCny),
    sslAnnualCny: num(vars.sslAnnualCny),
    r2StoragePerGbCny: num(vars.r2StoragePerGbCny),
    r2ClassAMonthlyCny: num(vars.r2ClassAMonthlyCny),
    libraryTitles: num(vars.libraryTitles),
    avgTitleGb: num(vars.avgTitleGb),
    cdnTier1PerTbCny: num(vars.cdnTier1PerTbCny),
    cdnTier2PerTbCny: num(vars.cdnTier2PerTbCny),
    cdnTier1Tiers: normalizeTiers(vars.cdnTier1Tiers),
    cdnTier2Tiers: normalizeTiers(vars.cdnTier2Tiers),
    cdnPricingMode: vars.cdnPricingMode === 'package' ? 'package' : 'tiered',
    cdnPackagePrice: vars.cdnPackagePrice === 'list' ? 'list' : 'renew',
    cdnTier1Packages: normalizePackages(vars.cdnTier1Packages),
    cdnTier2Packages: normalizePackages(vars.cdnTier2Packages),
    tier1Share: vars.tier1Share == null ? 1 : Math.min(1, Math.max(0, num(vars.tier1Share))),
    basicViewers: num(vars.basicViewers),
    premiumViewers: num(vars.premiumViewers),
    basicMinutesPerViewer: num(vars.basicMinutesPerViewer),
    premiumMinutesPerViewer: num(vars.premiumMinutesPerViewer),
    basicPerMinMbLow: num(vars.basicPerMinMbLow),
    premiumPerMinMbLow: num(vars.premiumPerMinMbLow),
    basicPerMinMbHigh: num(vars.basicPerMinMbHigh),
    premiumPerMinMbHigh: num(vars.premiumPerMinMbHigh),
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
function mbForGroup(low: number, high: number, scenario: EconScenarioKey): number {
  const { low: lo, high: hi } = mbRangeOf(low, high);
  if (scenario === 'optimistic') return lo;
  if (scenario === 'pessimistic') return hi;
  return (lo + hi) / 2;
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

export type EconCostItem = {
  key: string;
  labelCn: string;
  labelEn: string;
  cny: number;
  group: 'fixed' | 'storage' | 'cdn';
  /** 占总成本比例 0-1。 */
  share: number;
};

export type EconMetrics = {
  scenario: EconScenarioKey;
  /** 本情景采用的每分钟流量（MB）。 */
  mbPerMin: number;
  domainMonthlyCny: number;
  sslMonthlyCny: number;
  storageMonthlyCny: number;
  /** 基座固定成本 = Vultr + 域名 + SSL + Class A + 存储。 */
  baseFixedCny: number;
  trafficGb: number;
  trafficTb: number;
  /** 综合 CDN 单价 ¥/TB = α·F + (1−α)·G。 */
  blendedPerTbCny: number;
  cdnCny: number;
  totalCostCny: number;
  revenueCny: number;
  netCny: number;
  netMargin: number | null;
  /** 每观看人次的 CDN 边际成本。 */
  cdnPerViewerCny: number;
  /** 每分钟流量的 CDN 成本。 */
  cdnPerMinCny: number;
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
  costs: EconCostItem[];
};

/**
 * 单月稳态测算：
 *   存储 = D·E·B；基座固定 = A + 域名/12 + SSL/12 + C + 存储
 *   流量TB = H·I·每分钟MB / (1024×1000)，按 α 拆分为一区 / 二区流量
 *   CDN：tiered 模式 = 累进(一区流量, 一区阶梯) + 累进(二区流量, 二区阶梯)
 *        （阶梯缺失时按 F / G 单档全量计价）
 *        package 模式 = 资源包最优覆盖(一区流量) + 资源包最优覆盖(二区流量)
 *   收入 = 基础/高级 × 月/季/年 六档合计（季卡/年卡按月度确认口径折算）
 */
export function computeEcon(vars: EconVars, scenario: EconScenarioKey): EconMetrics {
  const v = resolve(vars);
  const basicMb = mbForGroup(v.basicPerMinMbLow, v.basicPerMinMbHigh, scenario);
  const premiumMb = mbForGroup(v.premiumPerMinMbLow, v.premiumPerMinMbHigh, scenario);

  const domainMonthlyCny = v.domainAnnualCny / 12;
  const sslMonthlyCny = v.sslAnnualCny / 12;
  const storageMonthlyCny = v.libraryTitles * v.avgTitleGb * v.r2StoragePerGbCny;
  const baseFixedCny =
    v.vultrMonthlyCny + domainMonthlyCny + sslMonthlyCny + v.r2ClassAMonthlyCny + storageMonthlyCny;

  // 基础 + 高级两组各自：人数 × 人均分钟 × 每分钟 MB，求和得总 MB → GB → TB
  const totalViewers = v.basicViewers + v.premiumViewers;
  const totalMinutes =
    v.basicViewers * v.basicMinutesPerViewer + v.premiumViewers * v.premiumMinutesPerViewer;
  const trafficMb =
    v.basicViewers * v.basicMinutesPerViewer * basicMb +
    v.premiumViewers * v.premiumMinutesPerViewer * premiumMb;
  const mbPerMin = totalMinutes > 0 ? trafficMb / totalMinutes : 0;
  const trafficGb = trafficMb / MB_PER_GB;
  const trafficTb = trafficGb / GB_PER_TB;
  const tier1Tb = trafficTb * v.tier1Share;
  const tier2Tb = trafficTb * (1 - v.tier1Share);
  const cdnCny =
    v.cdnPricingMode === 'package'
      ? packageCost(tier1Tb, v.cdnTier1Packages, v.cdnPackagePrice) +
        packageCost(tier2Tb, v.cdnTier2Packages, v.cdnPackagePrice)
      : progressiveCost(tier1Tb, v.cdnTier1Tiers, v.cdnTier1PerTbCny) +
        progressiveCost(tier2Tb, v.cdnTier2Tiers, v.cdnTier2PerTbCny);
  // 等效均价 = CDN 费用 ÷ 总流量（供曲线/边际成本沿用；无流量时回退加权档位价）
  const blendedPerTbCny =
    trafficTb > 0
      ? cdnCny / trafficTb
      : v.tier1Share * v.cdnTier1PerTbCny + (1 - v.tier1Share) * v.cdnTier2PerTbCny;

  const totalCostCny = baseFixedCny + cdnCny;
  const revenueCny = subsRevenue(v);
  const netCny = revenueCny - totalCostCny;

  // 按总分钟 / 总人数摊薄（两组口径加权平均）
  const cdnPerMinCny = totalMinutes > 0 ? cdnCny / totalMinutes : 0;
  const cdnPerViewerCny = totalViewers > 0 ? cdnCny / totalViewers : 0;

  // 收入不随观看人数变化，故固定成本已高于收入时，增加人数只会放大亏损。
  const breakEvenViewersRaw =
    cdnPerViewerCny > 0 && revenueCny - baseFixedCny > 0 ? (revenueCny - baseFixedCny) / cdnPerViewerCny : null;
  const breakEvenViewers = breakEvenViewersRaw != null && breakEvenViewersRaw > 0 ? r2(breakEvenViewersRaw) : null;

  const storagePerTitleCny = v.avgTitleGb * v.r2StoragePerGbCny;
  const breakEvenTitlesRaw =
    storagePerTitleCny > 0 && revenueCny - (baseFixedCny - storageMonthlyCny) - cdnCny > 0
      ? (revenueCny - (baseFixedCny - storageMonthlyCny) - cdnCny) / storagePerTitleCny
      : null;
  const breakEvenTitles = breakEvenTitlesRaw != null && breakEvenTitlesRaw > 0 ? r2(breakEvenTitlesRaw) : null;

  const perViewerRevenueCny = totalViewers > 0 ? revenueCny / totalViewers : null;
  const perViewerCostCny = totalViewers > 0 ? totalCostCny / totalViewers : null;
  const safetyMargin =
    breakEvenViewers != null && totalViewers > 0 ? r4((totalViewers - breakEvenViewers) / totalViewers) : null;

  const rawCosts: Omit<EconCostItem, 'share'>[] = [
    { key: 'vultr', labelCn: 'Vultr 云主机', labelEn: 'Vultr Host', cny: v.vultrMonthlyCny, group: 'fixed' },
    { key: 'domain', labelCn: '域名', labelEn: 'Domain', cny: r2(domainMonthlyCny), group: 'fixed' },
    { key: 'ssl', labelCn: 'SSL 证书', labelEn: 'SSL Cert', cny: r2(sslMonthlyCny), group: 'fixed' },
    { key: 'classA', labelCn: 'R2 Class A 操作', labelEn: 'R2 Class A', cny: v.r2ClassAMonthlyCny, group: 'fixed' },
    { key: 'storage', labelCn: 'R2 存储', labelEn: 'R2 Storage', cny: r2(storageMonthlyCny), group: 'storage' },
    { key: 'cdn', labelCn: 'CDN 流量', labelEn: 'CDN Traffic', cny: r2(cdnCny), group: 'cdn' },
  ];
  const costTotal = rawCosts.reduce((s, c) => s + c.cny, 0);
  const costs = rawCosts.map((c) => ({ ...c, share: costTotal > 0 ? r4(c.cny / costTotal) : 0 }));

  return {
    scenario,
    mbPerMin: r2(mbPerMin),
    domainMonthlyCny: r2(domainMonthlyCny),
    sslMonthlyCny: r2(sslMonthlyCny),
    storageMonthlyCny: r2(storageMonthlyCny),
    baseFixedCny: r2(baseFixedCny),
    trafficGb: r2(trafficGb),
    trafficTb: r4(trafficTb),
    blendedPerTbCny: r2(blendedPerTbCny),
    cdnCny: r2(cdnCny),
    totalCostCny: r2(totalCostCny),
    revenueCny: r2(revenueCny),
    netCny: r2(netCny),
    netMargin: revenueCny > 0 ? r4(netCny / revenueCny) : null,
    cdnPerViewerCny: r4(cdnPerViewerCny),
    cdnPerMinCny: r4(cdnPerMinCny),
    perViewerRevenueCny: perViewerRevenueCny == null ? null : r2(perViewerRevenueCny),
    perViewerCostCny: perViewerCostCny == null ? null : r2(perViewerCostCny),
    breakEvenViewers,
    breakEvenTitles,
    safetyMargin,
    negativeUnitEconomics: perViewerRevenueCny != null && perViewerRevenueCny < cdnPerViewerCny,
    costs,
  };
}

/* ------------------------------------------------------------------ */
/* 盈亏曲线（X 轴 = 观看人数）                                            */
/* ------------------------------------------------------------------ */

export type EconCurvePoint = {
  viewers: number;
  revenueCny: number;
  totalCostCny: number;
  fixedCny: number;
  netCny: number;
};

export type EconCurve = {
  scenario: EconScenarioKey;
  points: EconCurvePoint[];
  maxViewers: number;
  /** 当前观看人数（曲线上的现状标记）。 */
  currentViewers: number;
  breakEvenViewers: number | null;
};

/** 以观看人数为横轴扫描收入/成本/净利（成本对人数线性，收入恒定）。 */
export function econCurve(vars: EconVars, scenario: EconScenarioKey, samples = 24): EconCurve {
  const v = resolve(vars);
  const m = computeEcon(vars, scenario);
  const totalViewers = v.basicViewers + v.premiumViewers;
  const span = Math.max(
    m.breakEvenViewers != null ? m.breakEvenViewers * 1.8 : 0,
    totalViewers * 1.5,
    100
  );
  const maxViewers = Math.ceil(span / 50) * 50;
  const points: EconCurvePoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const viewers = (maxViewers * i) / samples;
    const totalCostCny = m.baseFixedCny + viewers * m.cdnPerViewerCny;
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

export type EconProjectionPoint = {
  monthIndex: number;
  ym: string;
  viewers: number;
  subscribers: number;
  revenueCny: number;
  totalCostCny: number;
  netCny: number;
  cumNetCny: number;
};

export type EconProjection = {
  scenario: EconScenarioKey;
  points: EconProjectionPoint[];
  breakEvenMonth: number | null;
  paybackMonth: number | null;
  endNetCny: number | null;
  endCumNetCny: number | null;
};

/** 按观看人数/订阅人数各自的月净增长率向前推演。 */
export function projectEcon(vars: EconVars, scenario: EconScenarioKey, fromYm: string): EconProjection {
  const v = resolve(vars);
  const m = computeEcon(vars, scenario);
  const subs = subsCount(v);
  const totalViewers = v.basicViewers + v.premiumViewers;

  const points: EconProjectionPoint[] = [];
  let cum = 0;
  let breakEvenMonth: number | null = null;
  let paybackMonth: number | null = null;

  for (let i = 0; i <= v.horizonMonths; i++) {
    const viewers = totalViewers * Math.pow(1 + v.viewerGrowth, i);
    const subsI = subs * Math.pow(1 + v.subscriberGrowth, i);
    const revenueCny = v.subscriberGrowth === 0 ? m.revenueCny : m.revenueCny * Math.pow(1 + v.subscriberGrowth, i);
    const totalCostCny = m.baseFixedCny + viewers * m.cdnPerViewerCny;
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

export type EconSensitivityRow = {
  key: string;
  labelCn: string;
  labelEn: string;
  baseValue: number;
  /** 单变量 ±delta 引起的盈亏平衡观看人数最大变动量。 */
  impact: number;
};

type PerturbTarget = { key: string; labelCn: string; labelEn: string; fields: (keyof EconVars)[] };

const PERTURB_TARGETS: PerturbTarget[] = [
  { key: 'basicPerMinMb', labelCn: '基础会员每分钟流量 J1~K1', labelEn: 'Basic MB/Min', fields: ['basicPerMinMbLow', 'basicPerMinMbHigh'] },
  { key: 'premiumPerMinMb', labelCn: '高级会员每分钟流量 J2~K2', labelEn: 'Premium MB/Min', fields: ['premiumPerMinMbLow', 'premiumPerMinMbHigh'] },
  { key: 'basicMinutes', labelCn: '基础会员人均月观影分钟数', labelEn: 'Basic Min/Viewer', fields: ['basicMinutesPerViewer'] },
  { key: 'premiumMinutes', labelCn: '高级会员人均月观影分钟数', labelEn: 'Premium Min/Viewer', fields: ['premiumMinutesPerViewer'] },
  { key: 'basicViewers', labelCn: '基础会员人数 H1', labelEn: 'Basic Viewers', fields: ['basicViewers'] },
  { key: 'premiumViewers', labelCn: '高级会员人数 H2', labelEn: 'Premium Viewers', fields: ['premiumViewers'] },
  { key: 'cdnTier1', labelCn: '亚太一区单价 F', labelEn: 'APAC-1 ¥/TB', fields: ['cdnTier1PerTbCny', 'cdnTier1Tiers', 'cdnTier1Packages'] },
  { key: 'cdnTier2', labelCn: '亚太二区单价 G', labelEn: 'APAC-2 ¥/TB', fields: ['cdnTier2PerTbCny', 'cdnTier2Tiers', 'cdnTier2Packages'] },
  { key: 'tier1Share', labelCn: '亚太一区占比 α', labelEn: 'APAC-1 Share', fields: ['tier1Share'] },
  { key: 'basicSubs', labelCn: '基础会员人数 L1/L2/L3', labelEn: 'Basic Subs', fields: ['basicMonthlySubs', 'basicQuarterlySubs', 'basicYearlySubs'] },
  { key: 'premiumSubs', labelCn: '高级会员人数 L4/L5/L6', labelEn: 'Premium Subs', fields: ['premiumMonthlySubs', 'premiumQuarterlySubs', 'premiumYearlySubs'] },
  { key: 'basicPrice', labelCn: '基础会员单价 M1/M2/M3', labelEn: 'Basic Price', fields: ['basicMonthlyPriceCny', 'basicQuarterlyPriceCny', 'basicYearlyPriceCny'] },
  { key: 'premiumPrice', labelCn: '高级会员单价 M4/M5/M6', labelEn: 'Premium Price', fields: ['premiumMonthlyPriceCny', 'premiumQuarterlyPriceCny', 'premiumYearlyPriceCny'] },
  { key: 'vultr', labelCn: 'Vultr 月租 A', labelEn: 'Vultr Host', fields: ['vultrMonthlyCny'] },
  { key: 'domain', labelCn: '域名年费', labelEn: 'Domain', fields: ['domainAnnualCny'] },
  { key: 'ssl', labelCn: 'SSL 证书年费', labelEn: 'SSL Cert', fields: ['sslAnnualCny'] },
  { key: 'classA', labelCn: 'Class A 操作费 C', labelEn: 'R2 Class A', fields: ['r2ClassAMonthlyCny'] },
  { key: 'storageUnit', labelCn: 'R2 存储单价 B', labelEn: 'R2 ¥/GB', fields: ['r2StoragePerGbCny'] },
  { key: 'libraryTitles', labelCn: '片库影片数 D', labelEn: 'Library Titles', fields: ['libraryTitles'] },
  { key: 'avgTitleGb', labelCn: '单片体积 E', labelEn: 'GB / Title (E)', fields: ['avgTitleGb'] },
];

/** 敏感度：对每个可用变量做 ±delta 微扰，比较盈亏平衡观看人数的变动幅度。 */
export function econSensitivity(vars: EconVars, scenario: EconScenarioKey, delta = 0.2): EconSensitivityRow[] {
  const base = computeEcon(vars, scenario).breakEvenViewers;
  if (base == null) return [];

  const rows: EconSensitivityRow[] = [];
  /** 取某字段的「代表值」：阶梯数组取首档单价、资源包取首档价格，便于同口径判定与展示。 */
  const fieldPrice = (f: keyof EconVars): number => {
    const val = vars[f];
    if (!Array.isArray(val)) return num(val as number | null);
    if (!val.length) return 0;
    const first = val[0] as Record<string, unknown>;
    return num((first.pricePerTbCny ?? first.listCny ?? first.renewCny) as number);
  };

  for (const target of PERTURB_TARGETS) {
    const present = target.fields.filter((f) => fieldPrice(f) > 0);
    if (present.length === 0) continue;
    const baseValue = fieldPrice(present[0]);

    const shifted = (factor: number): number | null => {
      const next: EconVars = { ...vars };
      const put = (key: keyof EconVars, value: unknown) => {
        (next as unknown as Record<string, unknown>)[key] = value;
      };
      for (const f of present) {
        if (f === 'cdnTier1Tiers' || f === 'cdnTier2Tiers') {
          const arr = vars[f] as CdnTier[] | null;
          put(f, arr ? arr.map((t) => ({ ...t, pricePerTbCny: t.pricePerTbCny * factor })) : arr);
        } else if (f === 'cdnTier1Packages' || f === 'cdnTier2Packages') {
          const arr = vars[f] as CdnPackage[] | null;
          put(f, arr ? arr.map((p) => ({ ...p, listCny: p.listCny * factor, renewCny: p.renewCny * factor })) : arr);
        } else if (f === 'tier1Share') {
          put(f, Math.min(1, Math.max(0, num(vars[f] as number | null) * factor)));
        } else {
          put(f, num(vars[f] as number | null) * factor);
        }
      }
      return computeEcon(next, scenario).breakEvenViewers;
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

export type EconModel = {
  vars: EconVars;
  results: Record<EconScenarioKey, EconMetrics>;
  curves: Record<EconScenarioKey, EconCurve>;
  projections: Record<EconScenarioKey, EconProjection>;
  sensitivity: Record<EconScenarioKey, EconSensitivityRow[]>;
  warnings: string[];
};

/** 输入校验提示（不阻断计算，仅提示口径风险）。 */
export function econWarnings(vars: EconVars): string[] {
  const v = resolve(vars);
  const out: string[] = [];
  const subs = subsCount(v);
  const totalViewers = v.basicViewers + v.premiumViewers;
  if (subs === 0) out.push('未填订阅人数，月收入为 0。');
  if (
    v.basicMonthlyPriceCny + v.basicQuarterlyPriceCny + v.basicYearlyPriceCny +
    v.premiumMonthlyPriceCny + v.premiumQuarterlyPriceCny + v.premiumYearlyPriceCny === 0
  ) out.push('未填订阅单价，月收入为 0。');
  if (v.libraryTitles === 0 || v.avgTitleGb === 0 || v.r2StoragePerGbCny === 0) {
    out.push('片库数量、单片体积或存储单价为空，R2 存储成本按 0 计。');
  }
  if (totalViewers === 0) out.push('基础/高级会员人数为空，CDN 流量成本按 0 计。');
  if (totalViewers > 0 && (v.basicMinutesPerViewer + v.premiumMinutesPerViewer === 0)) {
    out.push('人均观影分钟数为空，CDN 流量成本按 0 计。');
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
  if (v.tier1Share === 1 && (v.cdnTier2PerTbCny > 0 || (v.cdnTier2Tiers?.length ?? 0) > 0)) {
    out.push('亚太一区占比 α = 100%，亚太二区单价未参与计费。');
  }
  if (v.cdnPricingMode === 'package') {
    out.push('CDN 按「资源包」口径计费（整包阶梯函数），盈亏曲线与盈亏平衡人数按等效均价线性近似。');
    if (!v.cdnTier1Packages && !v.cdnTier2Packages) {
      out.push('已选资源包口径但未配置任何资源包价格，CDN 流量成本按 0 计。');
    }
  }
  if (v.domainAnnualCny + v.sslAnnualCny === 0) out.push('域名与 SSL 证书年费为空，未计入基座固定成本。');
  return out;
}

/** 一次算完三档情景（含曲线、推演与敏感度）。 */
export function buildEconModel(vars: EconVars, fromYm: string): EconModel {
  const results = {} as Record<EconScenarioKey, EconMetrics>;
  const curves = {} as Record<EconScenarioKey, EconCurve>;
  const projections = {} as Record<EconScenarioKey, EconProjection>;
  const sensitivity = {} as Record<EconScenarioKey, EconSensitivityRow[]>;
  for (const s of ECON_SCENARIOS) {
    results[s] = computeEcon(vars, s);
    curves[s] = econCurve(vars, s);
    projections[s] = projectEcon(vars, s, fromYm);
    sensitivity[s] = econSensitivity(vars, s);
  }
  return { vars, results, curves, projections, sensitivity, warnings: econWarnings(vars) };
}
