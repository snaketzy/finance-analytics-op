import { shiftMonth } from './unitEconomics';

/* ------------------------------------------------------------------ */
/* 输入：全变量经营测算的物理量                                          */
/* ------------------------------------------------------------------ */

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
  /** F 亚太一区 ¥/TB */
  cdnTier1PerTbCny: number | null;
  /** G 亚太二区 ¥/TB */
  cdnTier2PerTbCny: number | null;
  /** α 亚太一区流量占比 0-1 */
  tier1Share: number | null;
  /** H 月观看人数 人 */
  viewers: number | null;
  /** I 人均月观看部数 */
  titlesPerViewer: number | null;
  /** J 单片流量下限 GB */
  perTitleGbLow: number | null;
  /** K 单片流量上限 GB */
  perTitleGbHigh: number | null;
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

export type EconScenarioKey = 'pessimistic' | 'neutral' | 'optimistic';
export const ECON_SCENARIOS: EconScenarioKey[] = ['pessimistic', 'neutral', 'optimistic'];

/** 三档情景的口径：悲观取单片流量上限、乐观取下限。 */
export const ECON_SCENARIO_LABEL: Record<
  EconScenarioKey,
  { cn: string; en: string; stroke: string; note: string }
> = {
  pessimistic: { cn: '悲观', en: 'Pessimistic', stroke: '#fb7185', note: '单片流量取 K 上限' },
  neutral: { cn: '中性', en: 'Neutral', stroke: '#38bdf8', note: '单片流量取 (J+K)/2' },
  optimistic: { cn: '乐观', en: 'Optimistic', stroke: '#34d399', note: '单片流量取 J 下限' },
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const num = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));

/** 全部字段按 0 补齐后的数值版本。 */
type Numeric = { [K in keyof EconVars]: number };

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
    tier1Share: vars.tier1Share == null ? 1 : Math.min(1, Math.max(0, num(vars.tier1Share))),
    viewers: num(vars.viewers),
    titlesPerViewer: num(vars.titlesPerViewer),
    perTitleGbLow: num(vars.perTitleGbLow),
    perTitleGbHigh: num(vars.perTitleGbHigh),
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
function gbForScenario(v: Numeric, scenario: EconScenarioKey): number {
  const { low, high } = gbRange(v);
  if (scenario === 'optimistic') return low;
  if (scenario === 'pessimistic') return high;
  return (low + high) / 2;
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
  /** 本情景采用的单片流量（GB）。 */
  gbPerTitle: number;
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
  /** 每部影片的流量成本。 */
  cdnPerTitleCny: number;
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
 *   流量TB = H·I·单片GB / 1024；CDN = 流量TB · (α·F + (1−α)·G)
 *   收入 = L1·M1 + L2·M2 + L3·M3（季卡/年卡按月度确认口径折算）
 */
export function computeEcon(vars: EconVars, scenario: EconScenarioKey): EconMetrics {
  const v = resolve(vars);
  const gbPerTitle = gbForScenario(v, scenario);

  const domainMonthlyCny = v.domainAnnualCny / 12;
  const sslMonthlyCny = v.sslAnnualCny / 12;
  const storageMonthlyCny = v.libraryTitles * v.avgTitleGb * v.r2StoragePerGbCny;
  const baseFixedCny =
    v.vultrMonthlyCny + domainMonthlyCny + sslMonthlyCny + v.r2ClassAMonthlyCny + storageMonthlyCny;

  const trafficGb = v.viewers * v.titlesPerViewer * gbPerTitle;
  const trafficTb = trafficGb / 1024;
  const blendedPerTbCny = v.tier1Share * v.cdnTier1PerTbCny + (1 - v.tier1Share) * v.cdnTier2PerTbCny;
  const cdnCny = trafficTb * blendedPerTbCny;

  const totalCostCny = baseFixedCny + cdnCny;
  const revenueCny = v.monthlySubs * v.monthlyPriceCny + v.quarterlySubs * v.quarterlyPriceCny + v.yearlySubs * v.yearlyPriceCny;
  const netCny = revenueCny - totalCostCny;

  const cdnPerTitleCny = (gbPerTitle / 1024) * blendedPerTbCny;
  const cdnPerViewerCny = v.titlesPerViewer * cdnPerTitleCny;

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

  const perViewerRevenueCny = v.viewers > 0 ? revenueCny / v.viewers : null;
  const perViewerCostCny = v.viewers > 0 ? totalCostCny / v.viewers : null;
  const safetyMargin =
    breakEvenViewers != null && v.viewers > 0 ? r4((v.viewers - breakEvenViewers) / v.viewers) : null;

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
    gbPerTitle: r2(gbPerTitle),
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
    cdnPerTitleCny: r4(cdnPerTitleCny),
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
  const span = Math.max(
    m.breakEvenViewers != null ? m.breakEvenViewers * 1.8 : 0,
    v.viewers * 1.5,
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
    currentViewers: r2(v.viewers),
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
  const subs = v.monthlySubs + v.quarterlySubs + v.yearlySubs;

  const points: EconProjectionPoint[] = [];
  let cum = 0;
  let breakEvenMonth: number | null = null;
  let paybackMonth: number | null = null;

  for (let i = 0; i <= v.horizonMonths; i++) {
    const viewers = v.viewers * Math.pow(1 + v.viewerGrowth, i);
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
  { key: 'perTitleGb', labelCn: '单片流量 J~K', labelEn: 'GB / Title', fields: ['perTitleGbLow', 'perTitleGbHigh'] },
  { key: 'titlesPerViewer', labelCn: '人均月观影部数', labelEn: 'Titles / Viewer', fields: ['titlesPerViewer'] },
  { key: 'cdnTier1', labelCn: '亚太一区单价 F', labelEn: 'APAC-1 ¥/TB', fields: ['cdnTier1PerTbCny'] },
  { key: 'cdnTier2', labelCn: '亚太二区单价 G', labelEn: 'APAC-2 ¥/TB', fields: ['cdnTier2PerTbCny'] },
  { key: 'tier1Share', labelCn: '亚太一区占比 α', labelEn: 'APAC-1 Share', fields: ['tier1Share'] },
  { key: 'subs', labelCn: '订阅人数 L1/L2/L3', labelEn: 'Subscribers', fields: ['monthlySubs', 'quarterlySubs', 'yearlySubs'] },
  { key: 'monthlyPrice', labelCn: '月卡单价 M1', labelEn: 'Monthly Price', fields: ['monthlyPriceCny'] },
  { key: 'quarterlyPrice', labelCn: '季卡单价 M2', labelEn: 'Quarterly Price', fields: ['quarterlyPriceCny'] },
  { key: 'yearlyPrice', labelCn: '年卡单价 M3', labelEn: 'Yearly Price', fields: ['yearlyPriceCny'] },
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
  for (const target of PERTURB_TARGETS) {
    const present = target.fields.filter((f) => num(vars[f]) > 0);
    if (present.length === 0) continue;
    const baseValue = num(vars[present[0]]);

    const shifted = (factor: number): number | null => {
      const next: EconVars = { ...vars };
      for (const f of present) {
        const cur = num(vars[f]);
        next[f] = f === 'tier1Share' ? Math.min(1, Math.max(0, cur * factor)) : cur * factor;
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
  if (v.monthlySubs + v.quarterlySubs + v.yearlySubs === 0) out.push('未填订阅人数，月收入为 0。');
  if (v.monthlyPriceCny + v.quarterlyPriceCny + v.yearlyPriceCny === 0) out.push('未填订阅单价，月收入为 0。');
  if (v.libraryTitles === 0 || v.avgTitleGb === 0 || v.r2StoragePerGbCny === 0) {
    out.push('片库数量、单片体积或存储单价为空，R2 存储成本按 0 计。');
  }
  if (v.viewers === 0 || v.titlesPerViewer === 0) out.push('观看人数或人均观影部数为空，CDN 流量成本按 0 计。');
  if (v.perTitleGbLow > 0 && v.perTitleGbHigh > 0 && v.perTitleGbLow > v.perTitleGbHigh) {
    out.push('单片流量下限 J 大于上限 K，已自动交换后计算。');
  }
  if (v.cdnTier1PerTbCny > 0 && v.cdnTier2PerTbCny > 0 && v.tier1Share === 1) {
    out.push('亚太一区占比 α = 100%，亚太二区单价未参与加权。');
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
