import { pool, type Row } from '../db';

/** 情景档位：中性 / 乐观 / 悲观。 */
export type ScenarioKey = 'neutral' | 'optimistic' | 'pessimistic';
export const SCENARIOS: ScenarioKey[] = ['neutral', 'optimistic', 'pessimistic'];

/** 单位经济计算所需的最小参数集（NULL = 按实际收支反推）。 */
export type MetricInput = {
  mau: number | null;
  payingRatio: number | null;
  arppuCny: number | null;
  monthlyChurn: number | null;
  monthlyGrowth: number | null;
  fixedCostCny: number | null;
  unitVarCostCny: number | null;
};

/** 完整模型参数（含推演范围与预留字段）。 */
export type ModelInputs = MetricInput & {
  horizonMonths: number;
  lookbackMonths: number;
  /** 预留：数据来源标识（manual / 未来外部系统）。 */
  source?: string;
  /** 预留：外部系统原始字段。 */
  extra?: unknown;
};

/** 从 transactions 反推的实际经营基线（月均口径）。 */
export type Actuals = {
  months: number;
  revenueCny: number;
  fixedCostCny: number;
  variableCostCny: number;
  totalCostCny: number;
  netCny: number;
  trend: { ym: string; revenueCny: number; costCny: number; netCny: number }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** 预警阈值（可由 product_model_inputs.thresholds 覆盖）。 */
export type Thresholds = {
  cloudRatioHigh: number;
  peopleRatioHigh: number;
  marketingRatioHigh: number;
  costRatioHigh: number;
  safetyMarginLow: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  cloudRatioHigh: 0.3,
  peopleRatioHigh: 0.4,
  marketingRatioHigh: 0.25,
  costRatioHigh: 1,
  safetyMarginLow: 0.3,
};

/** 'YYYY-MM' 上下偏移 n 个月。 */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** 载入某项目近 lookbackMonths 个月的实际收入/固定成本/变动成本（变动 = is_cogs=1）。 */
export async function loadActuals(projectId: number, lookbackMonths: number): Promise<Actuals> {
  const [rows] = await pool.query<Row[]>(
    `SELECT DATE_FORMAT(t.txn_date, '%Y-%m') AS ym,
            COALESCE(SUM(CASE WHEN t.direction='income'  THEN t.amount_cny ELSE 0 END), 0) AS revenueCny,
            COALESCE(SUM(CASE WHEN t.direction='expense' AND c.is_cogs=1 THEN t.amount_cny ELSE 0 END), 0) AS variableCny,
            COALESCE(SUM(CASE WHEN t.direction='expense' AND c.is_cogs=0 THEN t.amount_cny ELSE 0 END), 0) AS fixedCny
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
      WHERE t.project_id = ?
      GROUP BY ym
      ORDER BY ym DESC
      LIMIT ?`,
    [projectId, lookbackMonths]
  );

  const byMonth = rows.map((r) => ({
    ym: String(r.ym),
    revenueCny: Number(r.revenueCny),
    fixedCny: Number(r.fixedCny),
    variableCny: Number(r.variableCny),
  }));
  const months = byMonth.length || 1;
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

/** 载入近 lookbackMonths 个月的支出按领域（domain）拆分，用于成本结构建议。 */
export async function loadCostBreakdown(
  projectId: number,
  lookbackMonths: number
): Promise<{ domain: string; cny: number; isCogs: boolean; share: number }[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT c.domain AS domain, MAX(c.is_cogs) AS isCogs, SUM(t.amount_cny) AS cny
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
      WHERE t.project_id = ? AND t.direction = 'expense'
        AND t.txn_date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL ? MONTH)
      GROUP BY c.domain
      ORDER BY cny DESC`,
    [projectId, lookbackMonths]
  );
  const total = rows.reduce((s, r) => s + Number(r.cny), 0) || 1;
  return rows.map((r) => ({
    domain: String(r.domain),
    cny: r2(Number(r.cny) / Math.max(1, lookbackMonths)),
    isCogs: Number(r.isCogs) === 1,
    share: r4(Number(r.cny) / total),
  }));
}

/** 补齐后的生效参数（含从实际值反推的字段与来源标记）。 */
export type ResolvedInputs = {
  mau: number | null;
  payingRatio: number | null;
  arppuCny: number | null;
  monthlyChurn: number;
  monthlyGrowth: number;
  fixedCostCny: number;
  unitVarCostCny: number;
  derived: { arppu: boolean; fixedCost: boolean; unitVarCost: boolean };
};

export type ModelMetrics = {
  ready: boolean;
  inputs: ResolvedInputs;
  payingUsers: number | null;
  revenueCny: number | null;
  fixedCostCny: number;
  variableCostCny: number | null;
  totalCostCny: number | null;
  netCny: number | null;
  /** 月边际贡献 = 收入 − 变动成本。 */
  contributionCny: number | null;
  contributionRate: number | null;
  /** 单位活跃用户变动成本。 */
  unitVarCostCny: number;
  /** 单位活跃用户边际贡献 = ARPPU×付费率 − 单位变动成本。 */
  unitContributionCny: number | null;
  breakEvenMau: number | null;
  breakEvenPayingUsers: number | null;
  safetyMargin: number | null;
  negativeUnitEconomics: boolean;
};

/** 按生效参数计算月度的单位经济与盈亏平衡指标。 */
export function computeMetrics(actuals: Actuals, raw: MetricInput): ModelMetrics {
  const mau = raw.mau && raw.mau > 0 ? raw.mau : null;
  const ratio = raw.payingRatio != null && raw.payingRatio > 0 ? raw.payingRatio : null;

  const fixedCostCny = raw.fixedCostCny != null ? raw.fixedCostCny : actuals.fixedCostCny;
  const unitVarCostCny =
    raw.unitVarCostCny != null
      ? raw.unitVarCostCny
      : mau
        ? r2(actuals.variableCostCny / mau)
        : actuals.variableCostCny;

  let arppuCny = raw.arppuCny != null && raw.arppuCny > 0 ? raw.arppuCny : null;
  let arppuDerived = false;
  if (arppuCny === null && mau && ratio && actuals.revenueCny > 0) {
    arppuCny = r2(actuals.revenueCny / (mau * ratio));
    arppuDerived = true;
  }

  const inputs: ResolvedInputs = {
    mau,
    payingRatio: ratio,
    arppuCny,
    monthlyChurn: raw.monthlyChurn ?? 0,
    monthlyGrowth: raw.monthlyGrowth ?? 0,
    fixedCostCny,
    unitVarCostCny,
    derived: {
      arppu: arppuDerived,
      fixedCost: raw.fixedCostCny == null,
      unitVarCost: raw.unitVarCostCny == null,
    },
  };

  const ready = !!(mau && ratio && arppuCny);
  if (!ready) {
    return {
      ready: false,
      inputs,
      payingUsers: mau && ratio ? r2(mau * ratio) : null,
      revenueCny: null,
      fixedCostCny,
      variableCostCny: null,
      totalCostCny: null,
      netCny: null,
      contributionCny: null,
      contributionRate: null,
      unitVarCostCny,
      unitContributionCny: null,
      breakEvenMau: null,
      breakEvenPayingUsers: null,
      safetyMargin: null,
      negativeUnitEconomics: false,
    };
  }

  const payingUsers = r2(mau! * ratio!);
  const revenueCny = r2(arppuCny! * payingUsers);
  const variableCostCny = r2(unitVarCostCny * mau!);
  const totalCostCny = r2(fixedCostCny + variableCostCny);
  const contributionCny = r2(revenueCny - variableCostCny);
  const unitContributionCny = r4(arppuCny! * ratio! - unitVarCostCny);
  const negativeUnitEconomics = unitContributionCny <= 0;
  const breakEvenMau = negativeUnitEconomics ? null : r2(fixedCostCny / unitContributionCny);
  const breakEvenPayingUsers = breakEvenMau != null ? r2(breakEvenMau * ratio!) : null;
  const safetyMargin = breakEvenMau != null ? r4((mau! - breakEvenMau) / mau!) : null;

  return {
    ready: true,
    inputs,
    payingUsers,
    revenueCny,
    fixedCostCny,
    variableCostCny,
    totalCostCny,
    netCny: r2(revenueCny - totalCostCny),
    contributionCny,
    contributionRate: revenueCny > 0 ? r4(contributionCny / revenueCny) : null,
    unitVarCostCny,
    unitContributionCny,
    breakEvenMau,
    breakEvenPayingUsers,
    safetyMargin,
    negativeUnitEconomics,
  };
}

export type ProjectionPoint = {
  /** 相对当前的月序号：0 = 当前月。 */
  monthIndex: number;
  ym: string;
  mau: number;
  payingUsers: number;
  revenueCny: number;
  variableCostCny: number;
  fixedCostCny: number;
  costCny: number;
  netCny: number;
  cumNetCny: number;
};

export type Projection = {
  points: ProjectionPoint[];
  /** 月度净利首次转正的月序号（0 = 当前已达成；null = 期限内未达成）。 */
  breakEvenMonth: number | null;
  /** 累计净现金流首次转正的月序号。 */
  paybackMonth: number | null;
  endNetCny: number | null;
  endCumNetCny: number | null;
};

/** 按 MAU 净增长率向前推演，输出盈利周期（月度转正 / 累计转正）。 */
export function project(m: ModelMetrics, fromYm: string, horizonMonths = 24): Projection {
  if (!m.ready) {
    return { points: [], breakEvenMonth: null, paybackMonth: null, endNetCny: null, endCumNetCny: null };
  }
  const horizon = Math.max(1, Math.min(60, horizonMonths));
  const { mau, payingRatio, arppuCny, monthlyGrowth, fixedCostCny, unitVarCostCny } = m.inputs;

  const points: ProjectionPoint[] = [];
  let cum = 0;
  let breakEvenMonth: number | null = null;
  let paybackMonth: number | null = null;

  for (let i = 0; i <= horizon; i++) {
    const mauI = r2(mau! * Math.pow(1 + monthlyGrowth, i));
    const paying = r2(mauI * payingRatio!);
    const revenue = r2(arppuCny! * paying);
    const variable = r2(unitVarCostCny * mauI);
    const cost = r2(fixedCostCny + variable);
    const net = r2(revenue - cost);
    cum = r2(cum + net);
    if (breakEvenMonth === null && net >= 0) breakEvenMonth = i;
    if (paybackMonth === null && cum >= 0) paybackMonth = i;
    points.push({
      monthIndex: i,
      ym: shiftMonth(fromYm, i),
      mau: mauI,
      payingUsers: paying,
      revenueCny: revenue,
      variableCostCny: variable,
      fixedCostCny,
      costCny: cost,
      netCny: net,
      cumNetCny: cum,
    });
  }
  return {
    points,
    breakEvenMonth,
    paybackMonth,
    endNetCny: points[points.length - 1]?.netCny ?? null,
    endCumNetCny: cum,
  };
}

export type Prerequisite = {
  key: 'arppu' | 'payingRatio' | 'unitVarCost' | 'fixedCost';
  labelCn: string;
  labelEn: string;
  currentValue: number;
  requiredValue: number;
  unit: 'cny' | 'ratio';
  feasible: boolean;
  satisfied: boolean;
};

/** 反解「达到盈亏平衡所需」的各前提要素临界值（其余变量保持当前值）。 */
export function prerequisites(m: ModelMetrics): Prerequisite[] {
  if (!m.ready) return [];
  const { mau, payingRatio, arppuCny, fixedCostCny, unitVarCostCny } = m.inputs;
  const fixedPerMau = fixedCostCny / mau!;

  const items: Prerequisite[] = [
    {
      key: 'arppu',
      labelCn: '每付费用户月均收入 ARPPU',
      labelEn: 'ARPPU',
      currentValue: arppuCny!,
      requiredValue: r2((unitVarCostCny + fixedPerMau) / payingRatio!),
      unit: 'cny',
      feasible: true,
      satisfied: false,
    },
    {
      key: 'payingRatio',
      labelCn: '付费转化率',
      labelEn: 'Paying Ratio',
      currentValue: payingRatio!,
      requiredValue: r4((unitVarCostCny + fixedPerMau) / arppuCny!),
      unit: 'ratio',
      feasible: true,
      satisfied: false,
    },
    {
      key: 'unitVarCost',
      labelCn: '单位活跃用户变动成本',
      labelEn: 'Variable Cost / MAU',
      currentValue: unitVarCostCny,
      requiredValue: r2(arppuCny! * payingRatio! - fixedPerMau),
      unit: 'cny',
      feasible: true,
      satisfied: false,
    },
    {
      key: 'fixedCost',
      labelCn: '月固定成本',
      labelEn: 'Fixed Cost / Month',
      currentValue: fixedCostCny,
      requiredValue: r2(mau! * (arppuCny! * payingRatio! - unitVarCostCny)),
      unit: 'cny',
      feasible: true,
      satisfied: false,
    },
  ];
  for (const it of items) {
    it.feasible = it.requiredValue > 0 && (it.unit === 'ratio' ? it.requiredValue <= 1 : true);
    const lowerIsBetter = it.key === 'unitVarCost' || it.key === 'fixedCost';
    it.satisfied = lowerIsBetter
      ? it.currentValue <= it.requiredValue
      : it.currentValue >= it.requiredValue;
  }
  return items;
}

export type SensitivityRow = {
  key: string;
  labelCn: string;
  labelEn: string;
  baseValue: number;
  lowValue: number;
  highValue: number;
  breakEvenLow: number | null;
  breakEvenHigh: number | null;
  /** 该变量 ±20% 对盈亏平衡 MAU 的影响幅度（越大越敏感）。 */
  impact: number;
};

/** 敏感度：单变量 ±20% 对盈亏平衡 MAU 的影响（基于生效值，不再次反推）。 */
export function sensitivity(actuals: Actuals, raw: MetricInput, delta = 0.2): SensitivityRow[] {
  const base = computeMetrics(actuals, raw);
  if (!base.ready || base.breakEvenMau == null) return [];

  const frozen: MetricInput = {
    mau: base.inputs.mau,
    payingRatio: base.inputs.payingRatio,
    arppuCny: base.inputs.arppuCny,
    monthlyChurn: base.inputs.monthlyChurn,
    monthlyGrowth: base.inputs.monthlyGrowth,
    fixedCostCny: base.inputs.fixedCostCny,
    unitVarCostCny: base.inputs.unitVarCostCny,
  };

  const vars: { key: keyof MetricInput; labelCn: string; labelEn: string }[] = [
    { key: 'arppuCny', labelCn: 'ARPPU', labelEn: 'ARPPU' },
    { key: 'payingRatio', labelCn: '付费转化率', labelEn: 'Paying Ratio' },
    { key: 'unitVarCostCny', labelCn: '单位变动成本', labelEn: 'Var Cost / MAU' },
    { key: 'fixedCostCny', labelCn: '固定成本', labelEn: 'Fixed Cost' },
  ];

  const rows: SensitivityRow[] = [];
  for (const v of vars) {
    const cur = frozen[v.key] as number;
    if (cur == null || cur <= 0) continue;
    const lowValue = cur * (1 - delta);
    const highValue = cur * (1 + delta);
    const lo = computeMetrics(actuals, { ...frozen, [v.key]: lowValue });
    const hi = computeMetrics(actuals, { ...frozen, [v.key]: highValue });
    const beLo = lo.negativeUnitEconomics ? null : lo.breakEvenMau;
    const beHi = hi.negativeUnitEconomics ? null : hi.breakEvenMau;
    const candidates = [beLo, beHi, base.breakEvenMau].filter((x): x is number => x != null);
    const impact = candidates.length ? r2(Math.max(...candidates) - Math.min(...candidates)) : 0;
    rows.push({
      key: String(v.key),
      labelCn: v.labelCn,
      labelEn: v.labelEn,
      baseValue: cur,
      lowValue,
      highValue,
      breakEvenLow: beLo,
      breakEvenHigh: beHi,
      impact,
    });
  }
  return rows.sort((a, b) => b.impact - a.impact);
}

export type Suggestion = {
  key: string;
  severity: 'high' | 'medium' | 'low';
  titleCn: string;
  titleEn: string;
  detailCn: string;
  detailEn: string;
  domain?: string;
};

/** 成本费用控制建议（规则引擎，基于实际结构与模型结论）。 */
export function suggestions(
  actuals: Actuals,
  m: ModelMetrics,
  breakdown: { domain: string; cny: number; isCogs: boolean; share: number }[],
  th: Thresholds,
  declining: boolean
): Suggestion[] {
  const out: Suggestion[] = [];
  const rev = actuals.revenueCny;
  const costRatio = rev > 0 ? actuals.totalCostCny / rev : null;

  if (declining) {
    out.push({
      key: 'revenue-declining',
      severity: 'high',
      titleCn: '营收连续下滑',
      titleEn: 'Revenue Declining',
      detailCn: '近月收入出现连续环比下滑，需优先排查付费转化与留存，避免固定成本在低营收下摊薄不足。',
      detailEn: 'Consecutive MoM revenue declines; review conversion and retention before fixed costs overrun.',
    });
  }

  if (costRatio != null && costRatio > th.costRatioHigh) {
    out.push({
      key: 'cost-over-revenue',
      severity: 'high',
      titleCn: '成本已超过收入',
      titleEn: 'Cost Exceeds Revenue',
      detailCn: `月均总成本为收入的 ${Math.round(costRatio * 100)}%，处于净亏损状态。建议先冻结非刚性固定成本，再压缩变动成本。`,
      detailEn: `Monthly cost is ${Math.round(costRatio * 100)}% of revenue; freeze discretionary fixed costs, then trim variable costs.`,
    });
  }

  const cloudShare = breakdown
    .filter((b) => b.domain === 'infra' || b.domain === 'compute')
    .reduce((s, b) => s + b.share, 0);
  if (rev > 0 && cloudShare > th.cloudRatioHigh) {
    out.push({
      key: 'cloud-cost-high',
      severity: cloudShare > th.cloudRatioHigh * 1.5 ? 'high' : 'medium',
      titleCn: '云与算力成本占比偏高',
      titleEn: 'Cloud / Compute Cost High',
      detailCn: `基础设施+算力约占成本 ${Math.round(cloudShare * 100)}%。可从 CDN 回源策略、存储分层（R2 Infrequent Access）、转码档位与 P2P 分流入手降本。`,
      detailEn: `Infra + compute ≈ ${Math.round(cloudShare * 100)}% of cost; optimize CDN origin, storage tiering, transcoding ladder and P2P offload.`,
      domain: 'infra',
    });
  }

  const people = breakdown.find((b) => b.domain === 'people');
  if (rev > 0 && people && people.share > th.peopleRatioHigh) {
    out.push({
      key: 'people-cost-high',
      severity: 'medium',
      titleCn: '人力成本占比偏高',
      titleEn: 'People Cost High',
      detailCn: `人力约占成本 ${Math.round(people.share * 100)}%，建议评估外包或自动化替代以降低刚性支出。`,
      detailEn: `People ≈ ${Math.round(people.share * 100)}% of cost; consider outsourcing or automation to cut fixed spend.`,
      domain: 'people',
    });
  }

  const marketing = breakdown.find((b) => b.domain === 'marketing');
  if (rev > 0 && marketing && marketing.share > th.marketingRatioHigh) {
    out.push({
      key: 'marketing-cost-high',
      severity: 'medium',
      titleCn: '市场投放占比较高',
      titleEn: 'Marketing Spend High',
      detailCn: `市场费用约占成本 ${Math.round(marketing.share * 100)}%，需核算 CAC 回收期，避免为增长买单却拉低单位经济。`,
      detailEn: `Marketing ≈ ${Math.round(marketing.share * 100)}% of cost; check CAC payback before scaling spend.`,
      domain: 'marketing',
    });
  }

  if (m.ready && m.negativeUnitEconomics) {
    out.push({
      key: 'negative-unit-economics',
      severity: 'high',
      titleCn: '单位经济为负（越做越亏）',
      titleEn: 'Negative Unit Economics',
      detailCn: '每新增一个活跃用户的边际贡献为负，规模扩张会放大亏损。必须先提升 ARPPU / 付费率，或降低单位变动成本。',
      detailEn: 'Contribution per active user is negative; scaling enlarges losses. Raise ARPPU/conversion or cut variable cost first.',
    });
  } else if (m.ready && m.safetyMargin != null && m.safetyMargin < th.safetyMarginLow) {
    out.push({
      key: 'thin-safety-margin',
      severity: 'medium',
      titleCn: '安全边际偏薄',
      titleEn: 'Thin Safety Margin',
      detailCn: `当前 MAU 距盈亏平衡仅 ${Math.round(m.safetyMargin * 100)}%，营收小幅波动即可能转亏，建议预留成本缓冲。`,
      detailEn: `Only ${Math.round(m.safetyMargin * 100)}% above break-even MAU; a small revenue dip flips to loss.`,
    });
  }

  if (out.length === 0) {
    out.push({
      key: 'healthy',
      severity: 'low',
      titleCn: '成本结构健康',
      titleEn: 'Healthy Cost Structure',
      detailCn: '各项成本占比与安全边际均在阈值内，保持当前结构并持续监控云成本与获客效率即可。',
      detailEn: 'Cost structure and safety margin are within thresholds; keep monitoring cloud cost and acquisition efficiency.',
    });
  }
  return out;
}

export type HealthFlag = {
  key: string;
  severity: 'high' | 'medium' | 'low';
  labelCn: string;
  labelEn: string;
};

/** 产品健康预警：无盈利能力 / 营收下降 / 未达盈亏 / 成本率超标。 */
export function healthFlags(
  actuals: Actuals,
  m: ModelMetrics,
  th: Thresholds,
  declining: boolean
): HealthFlag[] {
  const flags: HealthFlag[] = [];
  if (m.ready && m.negativeUnitEconomics) {
    flags.push({ key: 'negative-unit-economics', severity: 'high', labelCn: '单位经济为负', labelEn: 'Negative Unit Economics' });
  }
  if (declining) {
    flags.push({ key: 'revenue-declining', severity: 'high', labelCn: '营收下降', labelEn: 'Revenue Declining' });
  }
  if (m.ready && !m.negativeUnitEconomics && m.netCny != null && m.netCny < 0) {
    flags.push({ key: 'below-break-even', severity: 'medium', labelCn: '未达盈亏平衡', labelEn: 'Below Break-even' });
  }
  if (actuals.revenueCny > 0 && actuals.totalCostCny / actuals.revenueCny > th.costRatioHigh) {
    flags.push({ key: 'cost-ratio-high', severity: 'high', labelCn: '成本率超标', labelEn: 'High Cost Ratio' });
  } else if (m.ready && m.safetyMargin != null && m.safetyMargin < th.safetyMarginLow) {
    flags.push({ key: 'thin-safety-margin', severity: 'medium', labelCn: '安全边际偏低', labelEn: 'Thin Safety Margin' });
  }
  return flags;
}

/** 营收下降判定：最新月环比跌幅 >= 20%，或近月连续 >= 2 次环比下滑。 */
export function isRevenueDeclining(trend: Actuals['trend']): boolean {
  if (trend.length < 3) return false;
  const vals = trend.map((t) => t.revenueCny);
  const n = vals.length;
  const last = vals[n - 1];
  const prev = vals[n - 2];
  if (prev > 0 && (prev - last) / prev >= 0.2) return true;
  let streak = 0;
  for (let i = n - 1; i > 0; i--) {
    if (vals[i] < vals[i - 1]) streak++;
    else break;
  }
  return streak >= 2;
}
