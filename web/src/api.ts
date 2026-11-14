import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';

/* ------------------------------------------------------------------ */
/* 响应信封与类型                                                       */
/* ------------------------------------------------------------------ */

export type Envelope<T> = { code: number; message: string; data: T };

export type ProjectStatus = 'active' | 'paused' | 'archived';

export type Project = {
  id: number;
  code: string;
  nameCn: string;
  nameEn: string;
  status: string;
  launchDate: string | null;
  sortOrder?: number;
  /** 绑定的 GitHub 仓库地址（可选，语义对应实际代码仓库）。 */
  repoUrl: string | null;
  /** 每提交折算工时系数（用于估算项目投入工时）。 */
  hoursPerCommit: number;
  note: string | null;
  /** 列表接口附带：成员产品数。 */
  productCount?: number;
  /** 列表接口附带：最近一次仓库快照。 */
  latestSnapshot?: ProjectSnapshot | null;
};

export type ProjectInput = {
  code: string;
  nameCn: string;
  nameEn: string;
  status?: ProjectStatus;
  launchDate?: string | null;
  sortOrder?: number;
  repoUrl?: string | null;
  hoursPerCommit?: number;
  note?: string | null;
};

/** GitHub 仓库统计快照（项目投入工时维度）。 */
export type ProjectSnapshot = {
  id: number;
  projectId: number;
  repoFullName: string;
  defaultBranch: string | null;
  language: string | null;
  stars: number;
  totalCommits: number;
  contributors: number;
  activeWeeks: number;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
  hoursPerCommit: number;
  /** 估算工时 = 提交数 × 系数（估算口径，非真实工时）。 */
  estimatedHours: number;
  capturedAt: string;
};

/** 项目引用统计（删除前校验：任一非零即禁止删除）。 */
export type ProjectReferenceCounts = {
  transactions: number;
  budgets: number;
  usages: number;
  cloudflareImports: number;
  paymentImports: number;
  products: number;
};

export type ProjectDetail = {
  project: Project;
  references: ProjectReferenceCounts;
  productShares: ProjectShareRow[];
  snapshots: ProjectSnapshot[];
};

/** 引用类型（与后端「引用统计」下钻一致）。 */
export type ProjectRefKey =
  | 'transactions'
  | 'budgets'
  | 'usages'
  | 'cloudflareImports'
  | 'paymentImports'
  | 'products';

/** 引用明细行（字段随类型不同，按列配置渲染）。 */
export type ProjectRefItem = Record<string, unknown>;

export type ProjectRefList = {
  key: ProjectRefKey;
  items: ProjectRefItem[];
  /** 是否因超过上限（300 条）被截断。 */
  truncated: boolean;
};

export type CategoryType = 'income' | 'expense';

export type Category = {
  id: number;
  parentId: number | null;
  nameCn: string;
  nameEn: string;
  /** 科目说明（口径/用途），可为空。 */
  note: string | null;
  type: CategoryType;
  domain: string;
  isRecurring: boolean | number;
  isCogs: boolean | number;
  sortOrder: number;
};

/** 科目新增/编辑入参。不传 parentId 即创建顶层「领域」节点。 */
export type CategoryInput = {
  parentId?: number | null;
  nameCn: string;
  nameEn: string;
  /** 科目说明（空串会被后端归一化为 NULL）。 */
  note?: string | null;
  type: CategoryType;
  /** 顶层节点的领域 key；子科目领域由后端跟随父级，无需传。 */
  domain?: string;
  isRecurring?: boolean | number;
  isCogs?: boolean | number;
  sortOrder?: number;
};

export type Account = {
  id: number;
  nameCn: string;
  nameEn: string;
  type: string;
  currency: string;
  openingBalanceCny: number;
  sortOrder: number;
  status: number;
};

export type AccountInput = {
  nameCn: string;
  nameEn: string;
  type: string;
  currency: string;
  openingBalanceCny: number;
  sortOrder?: number;
  status?: number;
};

/* ---------------------------- 供应商 / 交易对手 ---------------------------- */

/** 供应商角色：供应商 / 客户 / 两者兼具。 */
export type SupplierKind = 'vendor' | 'customer' | 'both';
/** 地域：国内 / 海外。 */
export type SupplierRegion = 'cn' | 'global';

export type Supplier = {
  id: number;
  nameCn: string;
  nameEn: string;
  kind: SupplierKind;
  region: SupplierRegion;
  website: string | null;
  contact: string | null;
  note: string | null;
  sortOrder: number;
  status: number;
  /** 关联的科目 id 列表（多对多）。 */
  categoryIds: number[];
};

export type SupplierInput = {
  nameCn: string;
  nameEn: string;
  kind: SupplierKind;
  region: SupplierRegion;
  website?: string | null;
  contact?: string | null;
  note?: string | null;
  sortOrder?: number;
  status?: number;
  categoryIds?: number[];
};

export type SupplierQuery = {
  q?: string;
  categoryId?: number;
  role?: 'vendor' | 'customer';
  kind?: SupplierKind;
  region?: SupplierRegion;
  all?: boolean;
  limit?: number;
};

export type SupplierList = { items: Supplier[] };


export type FxLatest = {
  rateDate: string;
  rate: number;
  baseCcy: string;
  quoteCcy: string;
  source: string;
} | null;

export type FxRate = {
  rateDate: string;
  rate: number;
  source: string;
};

/** 线上数据源的最新汇率（只读预览）。 */
export type FxRemote = {
  provider: string;
  base: string;
  quote: string;
  date: string;
  rate: number;
};

/** 线上同步结果。 */
export type FxSyncResult = {
  provider: string;
  from: string;
  to: string;
  fetched: number;
  upserted: number;
  latest: { date: string; rate: number } | null;
};

export type Direction = 'income' | 'expense';

export type Transaction = {
  id: number;
  projectId: number;
  projectNameCn: string;
  projectNameEn: string;
  categoryId: number;
  categoryNameCn: string;
  categoryNameEn: string;
  domain: string;
  direction: Direction;
  txnDate: string;
  amountCny: number;
  amountUsd: number;
  fxRate: number;
  counterparty: string | null;
  note: string | null;
  createdAt: string;
  /** 凭证附件数量（账单 PDF 等）。 */
  attachmentCount: number;
};

/** 凭证附件（R2 私有桶中的账单原件）。 */
export type Attachment = {
  id: number;
  fileName: string;
  objectKey: string;
  sizeBytes: number | null;
  createdAt: string;
  /** 预签名下载 URL（未配置 R2 或签名失败时为 null）。 */
  downloadUrl: string | null;
};

export type TransactionList = {
  items: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  incomeCny: number;
  expenseCny: number;
  incomeUsd: number;
  expenseUsd: number;
};

export type DomainRow = {
  domain: string;
  incomeCny: number;
  expenseCny: number;
  incomeUsd: number;
  expenseUsd: number;
};

export type MonthlyRow = {
  ym: string;
  incomeCny: number;
  expenseCny: number;
  incomeUsd: number;
  expenseUsd: number;
};

export type TopCategory = {
  categoryId: number;
  nameCn: string;
  nameEn: string;
  type: CategoryType;
  domain: string;
  amountCny: number;
  amountUsd: number;
};

export type DashboardSummary = {
  fxRate: number | null;
  fxRateDate: string | null;
  revenueCny: number;
  expenseCny: number;
  revenueUsd: number;
  expenseUsd: number;
  netCny: number;
  netUsd: number;
  txnCount: number;
  byDomain: DomainRow[];
  monthly: MonthlyRow[];
  topCategories: TopCategory[];
};

export type TransactionQuery = {
  projectId?: number;
  categoryId?: number;
  domain?: string;
  direction?: Direction;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

export type DashboardQuery = {
  projectId?: number;
  from?: string;
  to?: string;
};

export type TransactionInput = {
  projectId: number;
  categoryId: number;
  accountId?: number;
  direction: Direction;
  txnDate: string;
  amountCny: number;
  fxRate?: number;
  counterparty?: string;
  note?: string;
};

/* ---------------------------- P2 · 周期成本 ---------------------------- */

export type Cycle = 'monthly' | 'quarterly' | 'yearly';
export type CostNature = 'fixed' | 'variable';
/** 计费模式：固定金额 / 用量计费（单价 × 计量）/ 服务商账单直读（metered）。 */
export type PricingMode = 'fixed' | 'usage' | 'metered';
/** 用量计量源：r2 = Cloudflare R2 存储（可带存储类，如 r2:Standard / r2:InfrequentAccess）；vultr = Vultr 账单。 */
export type MeterSource = 'r2' | 'r2:Standard' | 'r2:InfrequentAccess' | 'vultr';

export type RecurringCost = {
  id: number;
  projectId: number;
  projectNameCn: string;
  projectNameEn: string;
  categoryId: number;
  categoryNameCn: string;
  categoryNameEn: string;
  domain: string;
  supplierId: number | null;
  supplierNameCn: string | null;
  supplierNameEn: string | null;
  nameCn: string;
  nameEn: string;
  amountCny: number;
  cycle: Cycle;
  costNature: CostNature;
  pricingMode: PricingMode;
  unitPrice: number | null;
  unitPriceCcy: string;
  unitLabel: string | null;
  meterSource: MeterSource | null;
  startDate: string;
  endDate: string | null;
  autoGenerate: number;
  lastGenDate: string | null;
  lastUsagePeriod: string | null;
  lastUsageAmountSrc: number | null;
  lastUsageAmountCcy: string | null;
  lastUsageAmountCny: number | null;
  status: number;
  monthlyCny: number;
  monthlyUsd: number | null;
  nextDueDate: string | null;
};

export type RecurringSummary = {
  count: number;
  activeCount: number;
  monthlyTotalCny: number;
  monthlyTotalUsd: number | null;
  fixedMonthlyCny: number;
  variableMonthlyCny: number;
};

export type RecurringList = {
  items: RecurringCost[];
  fxRate: number | null;
  summary: RecurringSummary;
};

export type RecurringQuery = { projectId?: number; status?: string; q?: string };

export type RecurringInput = {
  projectId: number;
  categoryId: number;
  supplierId?: number | null;
  nameCn: string;
  nameEn: string;
  amountCny: number;
  cycle: Cycle;
  costNature?: CostNature;
  pricingMode?: PricingMode;
  unitPrice?: number | null;
  unitPriceCcy?: string;
  unitLabel?: string | null;
  meterSource?: MeterSource | null;
  startDate: string;
  endDate?: string | null;
  autoGenerate?: number;
  status?: number;
};

/** 用量预览结果（不落库）。 */
export type UsagePreview = {
  period: string;
  quantity: number;
  unitLabel: string;
  unitPrice: number | null;
  unitPriceCcy: string;
  source: string;
  amountSrc: number | null;
};

/** 用量计费结果（已落库）。 */
export type UsageBillResult = {
  id: number;
  period: string;
  quantity: number;
  unitLabel: string;
  unitPrice: number;
  unitPriceCcy: string;
  amountSrc: number;
  fxRate: number;
  amountCny: number;
  source: string;
  billedOn: string;
  txnId: number | null;
  skipped: boolean;
};

/** 计量记录（用量 / 账单计费的落库明细，含项目 / 科目归属）。 */
export type UsageRecordLine = {
  id: number;
  recurringId: number | null;
  recurringNameCn: string | null;
  recurringNameEn: string | null;
  pricingMode: PricingMode | null;
  period: string;
  quantity: number;
  unitLabel: string | null;
  unitPrice: number | null;
  unitPriceCcy: string;
  amountSrc: number;
  fxRate: number;
  amountCny: number;
  source: string;
  billedOn: string;
  txnId: number | null;
  projectId: number;
  projectNameCn: string | null;
  projectNameEn: string | null;
  categoryId: number;
  categoryNameCn: string | null;
  categoryNameEn: string | null;
};

export type UsageRecordQuery = { period?: string; projectId?: number; recurringId?: number };

export type AmortizationRow = {
  ym: string;
  amountCny: number;
  amountUsd: number | null;
  byDomain: { domain: string; cny: number; usd: number | null }[];
};

export type AmortizationPlan = {
  fxRate: number | null;
  startMonth: string;
  months: number;
  rows: AmortizationRow[];
};

export type GenerateResult = { id: number; until: string; generated: number; lastGenDate: string | null };

/* ------------------------------ P2 · 预算 ------------------------------ */

export type BudgetPeriodType = 'monthly' | 'yearly' | 'once';

export type Budget = {
  id: number;
  projectId: number;
  projectNameCn: string;
  projectNameEn: string;
  categoryId: number | null;
  categoryNameCn: string | null;
  categoryNameEn: string | null;
  domain: string | null;
  period: string;
  periodType: BudgetPeriodType;
  amountCny: number;
  budgetUsd: number | null;
  actualCny: number;
  actualUsd: number | null;
  varianceCny: number;
  varianceUsd: number | null;
  usageRate: number | null;
  overBudget: boolean;
};

export type BudgetSummary = {
  count: number;
  totalBudgetCny: number;
  totalBudgetUsd: number | null;
  totalActualCny: number;
  totalActualUsd: number | null;
  usageRate: number | null;
  overCount: number;
};

export type BudgetList = { items: Budget[]; fxRate: number | null; summary: BudgetSummary };
export type BudgetQuery = { projectId?: number; period?: string; periodType?: string; overOnly?: string };
export type BudgetInput = {
  projectId: number;
  categoryId?: number | null;
  period: string;
  periodType?: BudgetPeriodType;
  amountCny: number;
};

/* --------------------------- P2 · 成本收入分析 --------------------------- */

export type AnalyticsGroupBy = 'domain' | 'category' | 'project' | 'account' | 'month';

export type AnalyticsBreakdown = {
  key: string;
  nameCn: string | null;
  nameEn: string | null;
  domain: string | null;
  cny: number;
  usd: number;
  txnCount: number;
  share: number;
};

export type AnalyticsMonthly = {
  ym: string;
  cny: number;
  usd: number;
  txnCount: number;
  cumCny: number;
  cumUsd: number;
};

export type AnalyticsComparisonRow = {
  ym: string;
  cny: number;
  usd: number;
  deltaCny?: number;
  deltaPct?: number | null;
};

export type AnalyticsResult = {
  direction: Direction;
  groupBy: AnalyticsGroupBy;
  total: {
    cny: number;
    usd: number;
    txnCount: number;
    revenueCny: number | null;
    revenueUsd: number | null;
    costRatio: number | null;
  };
  breakdown: AnalyticsBreakdown[];
  monthly: AnalyticsMonthly[];
  comparison: {
    current: AnalyticsComparisonRow;
    mom: AnalyticsComparisonRow;
    yoy: AnalyticsComparisonRow;
  };
};

export type AnalyticsQuery = {
  groupBy?: AnalyticsGroupBy;
  projectId?: number;
  domain?: string;
  from?: string;
  to?: string;
};

/* --------------------------- P4 · 产品与项目分摊 --------------------------- */

export type ProductKind = 'frontend' | 'backend' | 'platform' | 'other';
export type ProductStatus = 'active' | 'paused' | 'archived';

export type Product = {
  id: number;
  code: string;
  nameCn: string;
  nameEn: string;
  kind: ProductKind;
  status: ProductStatus;
  launchDate: string | null;
  sortOrder: number;
  note: string | null;
};

export type ProductInput = {
  code: string;
  nameCn: string;
  nameEn: string;
  kind?: ProductKind;
  status?: ProductStatus;
  launchDate?: string | null;
  sortOrder?: number;
  note?: string | null;
};

/** 产品列表行：含成员项目数与近 3 个月分摊后月均收支。 */
export type ProductListRow = Product & { projectCount: number; actuals: UEActuals };
export type ProductList = { items: ProductListRow[] };

/** 分摊记录（时间版本化，本身不含项目元数据）。 */
export type AllocationRecord = {
  id: number;
  productId: number;
  projectId: number;
  ratio: number;
  effectiveFrom: string;
  effectiveTo: string | null;
};

/** 产品当前生效的分摊（附项目元数据 + 该项目各产品合计校验）。 */
export type ProductAllocation = AllocationRecord & {
  project: { id: number; code: string; nameCn: string; nameEn: string; status: string } | null;
  /** 该项目当前各产品分摊合计（应恒为 1）。 */
  projectRatioSum: number;
};

/** 产品组成项目下钻：原始收支 + 分摊后收支（近 3 个月合计）。 */
export type ProductComposition = {
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

export type ProductDetail = {
  product: Product;
  allocations: ProductAllocation[];
  history: AllocationRecord[];
  compositions: ProductComposition[];
  actuals: UEActuals;
};

/** 项目视角：某项目在各引用产品间的分摊与收支比重。 */
export type ProjectShareRow = {
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

export type ProjectShares = {
  project: { id: number; code: string; nameCn: string; nameEn: string };
  lookback: number;
  shares: ProjectShareRow[];
};

export type UpdateAllocationsInput = {
  projectId: number;
  effectiveFrom?: string;
  items: { productId: number; ratio: number }[];
};

export type AddProductProjectInput = { id: number; projectId: number; effectiveFrom?: string };
export type RemoveProductProjectInput = { id: number; projectId: number; effectiveTo?: string };

/* --------------------------- P4 · 产品盈利模型 --------------------------- */

export type ScenarioKey = 'neutral' | 'optimistic' | 'pessimistic';

/** 用户可调模型参数（null = 按实际收支反推）。 */
export type ModelInputs = {
  mau: number | null;
  payingRatio: number | null;
  arppuCny: number | null;
  monthlyChurn: number | null;
  monthlyGrowth: number | null;
  fixedCostCny: number | null;
  unitVarCostCny: number | null;
  horizonMonths: number;
  lookbackMonths: number;
  /** 预留：数据来源标识（manual / 未来外部系统）。 */
  source?: string;
};

/** 从真实流水反推的实际经营基线（月均口径）。 */
export type UEActuals = {
  months: number;
  revenueCny: number;
  fixedCostCny: number;
  variableCostCny: number;
  totalCostCny: number;
  netCny: number;
  trend: { ym: string; revenueCny: number; costCny: number; netCny: number }[];
};

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

export type UEMetrics = {
  ready: boolean;
  inputs: ResolvedInputs;
  payingUsers: number | null;
  revenueCny: number | null;
  fixedCostCny: number;
  variableCostCny: number | null;
  totalCostCny: number | null;
  netCny: number | null;
  contributionCny: number | null;
  contributionRate: number | null;
  unitVarCostCny: number;
  unitContributionCny: number | null;
  breakEvenMau: number | null;
  breakEvenPayingUsers: number | null;
  safetyMargin: number | null;
  negativeUnitEconomics: boolean;
};

export type ProjectionPoint = {
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
  breakEvenMonth: number | null;
  paybackMonth: number | null;
  endNetCny: number | null;
  endCumNetCny: number | null;
};

export type ScenarioModel = {
  inputs: ModelInputs;
  metrics: UEMetrics;
  projection: Projection;
};

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

export type SensitivityRow = {
  key: string;
  labelCn: string;
  labelEn: string;
  baseValue: number;
  lowValue: number;
  highValue: number;
  breakEvenLow: number | null;
  breakEvenHigh: number | null;
  impact: number;
};

export type UESuggestion = {
  key: string;
  severity: 'high' | 'medium' | 'low';
  titleCn: string;
  titleEn: string;
  detailCn: string;
  detailEn: string;
  domain?: string;
};

export type HealthFlag = {
  key: string;
  severity: 'high' | 'medium' | 'low';
  labelCn: string;
  labelEn: string;
};

export type UEOverviewRow = {
  productId: number;
  code: string;
  nameCn: string;
  nameEn: string;
  kind: ProductKind;
  status: string;
  actuals: UEActuals;
  metrics: UEMetrics;
  flags: HealthFlag[];
  topSuggestion: UESuggestion | null;
};

export type UEOverview = {
  fxRate: number | null;
  products: UEOverviewRow[];
  summary: {
    count: number;
    alertCount: number;
    totalMonthlyRevenueCny: number;
    totalMonthlyCostCny: number;
  };
};

export type UEDetail = {
  fxRate: number | null;
  product: {
    id: number;
    code: string;
    nameCn: string;
    nameEn: string;
    kind: ProductKind;
    status: string;
    launchDate: string | null;
  };
  actuals: UEActuals;
  costBreakdown: { domain: string; cny: number; isCogs: boolean; share: number }[];
  compositions: ProductComposition[];
  thresholds: {
    cloudRatioHigh: number;
    peopleRatioHigh: number;
    marketingRatioHigh: number;
    costRatioHigh: number;
    safetyMarginLow: number;
  };
  declining: boolean;
  inputs: Record<ScenarioKey, ModelInputs>;
  models: Record<ScenarioKey, ScenarioModel>;
  prerequisites: Prerequisite[];
  sensitivity: SensitivityRow[];
  suggestions: UESuggestion[];
  flags: HealthFlag[];
};

export type UESimulateResult = {
  declining: boolean;
  inputs: Record<ScenarioKey, ModelInputs>;
  models: Record<ScenarioKey, ScenarioModel>;
  prerequisites: Prerequisite[];
  sensitivity: SensitivityRow[];
  suggestions: UESuggestion[];
  flags: HealthFlag[];
};

export type UESimulateInput = {
  productId: number;
  scenarios: Partial<Record<ScenarioKey, Partial<ModelInputs>>>;
};

export type UESaveInputsInput = {
  productId: number;
  scenario: ScenarioKey;
  body: Partial<ModelInputs> & { scenario?: ScenarioKey };
};

/* ------------------------- 全变量测算（econ-vars） ------------------------- */

/** 全变量测算情景：悲观取每分钟流量上限 K、乐观取下限 J。 */
export type EconScenarioKey = 'pessimistic' | 'neutral' | 'optimistic';

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
  /** B R2 每 GB 月存储单价 */
  r2StoragePerGbCny: number | null;
  /** C 每月 Class A 操作费 */
  r2ClassAMonthlyCny: number | null;
  /** D 片库影片数 */
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

export type EconCostItem = {
  key: string;
  labelCn: string;
  labelEn: string;
  cny: number;
  group: 'fixed' | 'storage' | 'cdn';
  share: number;
};

export type EconMetrics = {
  scenario: EconScenarioKey;
  /** 本情景采用的每分钟流量 MB。 */
  mbPerMin: number;
  domainMonthlyCny: number;
  sslMonthlyCny: number;
  storageMonthlyCny: number;
  baseFixedCny: number;
  trafficGb: number;
  trafficTb: number;
  blendedPerTbCny: number;
  cdnCny: number;
  totalCostCny: number;
  revenueCny: number;
  netCny: number;
  netMargin: number | null;
  cdnPerViewerCny: number;
  /** 每分钟流量的 CDN 成本。 */
  cdnPerMinCny: number;
  perViewerRevenueCny: number | null;
  perViewerCostCny: number | null;
  breakEvenViewers: number | null;
  breakEvenTitles: number | null;
  safetyMargin: number | null;
  negativeUnitEconomics: boolean;
  costs: EconCostItem[];
};

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
  currentViewers: number;
  breakEvenViewers: number | null;
};

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

export type EconSensitivityRow = {
  key: string;
  labelCn: string;
  labelEn: string;
  baseValue: number;
  impact: number;
};

export type EconModel = {
  vars: EconVars;
  results: Record<EconScenarioKey, EconMetrics>;
  curves: Record<EconScenarioKey, EconCurve>;
  projections: Record<EconScenarioKey, EconProjection>;
  sensitivity: Record<EconScenarioKey, EconSensitivityRow[]>;
  warnings: string[];
};

/** 实际经营基线（作为变量输入的参考值，不参与计算）。 */
export type EconReference = {
  months: number;
  monthlyRevenueCny: number;
  monthlyCostCny: number;
  monthlyFixedCostCny: number;
  monthlyVariableCostCny: number;
  domainBreakdown: { domain: string; cny: number; isCogs: boolean; share: number }[];
  suggestedVultrCny: number;
  suggestedInfraCny: number;
};

export type EconPayload = EconModel & {
  fxRate: number | null;
  productId: number;
  stored: boolean;
  /** 当前载入的快照主键（未保存时为 null）。 */
  snapshotId: number | null;
  /** 当前载入的快照保存日期（未保存时为 null）。 */
  savedAt: string | null;
  reference: EconReference;
};

/** 全变量历史快照（含保存日期与关键结论，用于速览对比）。 */
export type EconSnapshot = {
  id: number;
  savedAt: string;
  revenueCny: number;
  costCny: number;
  netCny: number;
  viewers: number | null;
  subscribers: number | null;
};

export type EconSnapshotList = {
  fxRate: number | null;
  snapshots: EconSnapshot[];
};

/* ------------------- cf & THKCOS 全变量测算（thkcos-vars） ------------------- */

/** 流量计价模式：direct = 直连 COS 外网下行，cdn = 经 CDN（边缘下行 + COS 回源）。 */
export type ThkcosTrafficMode = 'direct' | 'cdn';

/** 情景键：悲观取每分钟流量上限 K、乐观取下限 J。 */
export type ThkcosScenarioKey = 'pessimistic' | 'neutral' | 'optimistic';

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
  /** λ CDN 缓存命中率 0-1（仅 cdn 模式） */
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
  /** EO 套餐月费 ¥/月 */
  eoPlanMonthlyCny: number | null;
  /** EO 套餐内含流量 GB/月 */
  eoPlanIncludedGb: number | null;
  /** EO 流量包地区抵扣系数（亚太1区 = 2.49） */
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

export type ThkcosCostItem = {
  key: string;
  labelCn: string;
  labelEn: string;
  cny: number;
  group: 'fixed' | 'storage' | 'sync' | 'traffic';
  share: number;
};

export type ThkcosMetrics = {
  scenario: ThkcosScenarioKey;
  /** 本情景采用的每分钟流量 MB。 */
  mbPerMin: number;
  domainMonthlyCny: number;
  sslMonthlyCny: number;
  r2StorageMonthlyCny: number;
  cosStorageMonthlyCny: number;
  storageMonthlyCny: number;
  syncMonthlyCny: number;
  baseFixedCny: number;
  trafficGb: number;
  trafficTb: number;
  blendedPerTbCny: number;
  trafficCny: number;
  totalCostCny: number;
  revenueCny: number;
  netCny: number;
  netMargin: number | null;
  trafficPerViewerCny: number;
  /** 每分钟流量的流量成本。 */
  trafficPerMinCny: number;
  perViewerRevenueCny: number | null;
  perViewerCostCny: number | null;
  breakEvenViewers: number | null;
  breakEvenTitles: number | null;
  safetyMargin: number | null;
  negativeUnitEconomics: boolean;
  costs: ThkcosCostItem[];
};

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
  currentViewers: number;
  breakEvenViewers: number | null;
};

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

export type ThkcosSensitivityRow = {
  key: string;
  labelCn: string;
  labelEn: string;
  baseValue: number;
  impact: number;
};

export type ThkcosModel = {
  vars: ThkcosVars;
  results: Record<ThkcosScenarioKey, ThkcosMetrics>;
  curves: Record<ThkcosScenarioKey, ThkcosCurve>;
  projections: Record<ThkcosScenarioKey, ThkcosProjection>;
  sensitivity: Record<ThkcosScenarioKey, ThkcosSensitivityRow[]>;
  warnings: string[];
};

export type ThkcosPayload = ThkcosModel & {
  fxRate: number | null;
  productId: number;
  stored: boolean;
  snapshotId: number | null;
  savedAt: string | null;
  reference: EconReference;
};

/** THKCOS 全变量历史快照（含保存日期与关键结论，用于速览对比）。 */
export type ThkcosSnapshot = {
  id: number;
  savedAt: string;
  revenueCny: number;
  costCny: number;
  netCny: number;
  viewers: number | null;
  subscribers: number | null;
};

export type ThkcosSnapshotList = {
  fxRate: number | null;
  snapshots: ThkcosSnapshot[];
};

export type CloudflareUsageItem = {
  sourceKey: string;
  family: string;
  serviceName: string;
  zoneName: string | null;
  currency: string;
  amountSrc: number;
  quantity: number;
  unit: string;
  chargeCount: number;
  from: string;
  to: string;
  imported: boolean;
};

export type CloudflareUsagePreview = {
  period: string;
  excludedFamilies: string[];
  items: CloudflareUsageItem[];
};

export type CloudflareImportResult = {
  imported: number;
  skipped: number;
  transactionCount: number;
};

/** 发票费用行的产品类别（用于建议科目）。 */
export type CloudflareInvoiceLineKind = 'domain' | 'r2' | 'stream' | 'images' | 'other';

export type CloudflareInvoiceLine = {
  lineKey: string;
  description: string;
  kind: CloudflareInvoiceLineKind;
  domain: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  currency: string;
  suggestedCategoryId: number | null;
  /** 该明细对应的流水是否已入账（幂等命中）。 */
  imported: boolean;
};

export type CloudflareInvoiceParse = {
  documentHash: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  currency: string;
  total: number | null;
  items: CloudflareInvoiceLine[];
  candidateCount: number;
  parseWarning?: string;
  /** 账单原件在 R2 中的对象 key（未配置 R2 时为 null）。 */
  objectKey?: string | null;
  /** 账单原件字节数。 */
  fileSize?: number;
  /** 账单留存 R2 的告警（未配置或上传失败）。 */
  uploadWarning?: string;
};

export type CloudflareInvoiceImportInput = {
  documentHash: string;
  invoiceNumber: string;
  invoiceDate: string;
  items: {
    description: string;
    amount: number;
    currency: string;
    projectId: number;
    categoryId: number;
  }[];
  /** 账单原件对象 key（用于将 PDF 关联到生成的流水）。 */
  objectKey?: string | null;
  fileName?: string;
  fileSize?: number;
};

/** 已导入账单（Cloudflare 用量 / 发票），可调整最终归属。 */
export type CloudflareBillLine = {
  id: number;
  sourceKey: string;
  sourceType: 'usage' | 'invoice';
  billingPeriod: string;
  sourceName: string;
  invoiceNo: string | null;
  documentHash: string | null;
  projectId: number;
  categoryId: number;
  direction: 'income' | 'expense';
  txnDate: string;
  currency: string;
  amountSrc: number;
  fxRate: number;
  amountCny: number;
  txnId: number | null;
  createdAt: string;
  projectNameCn: string | null;
  projectNameEn: string | null;
  categoryNameCn: string | null;
  categoryNameEn: string | null;
  /** 关联的账单原件附件数（0/1）。 */
  attachmentCount: number;
};

/* ------------------------- 支付渠道收入同步 ------------------------- */

export type PaymentSource = 'stripe' | 'paypal';

export type PaymentSourceStatus = { source: PaymentSource; enabled: boolean };

export type PaymentPreviewItem = {
  sourceKey: string;
  occurredAt: string;
  currency: string;
  /** 毛额（收入）。 */
  gross: number;
  /** 平台手续费（支出）。 */
  fee: number;
  reference: string | null;
  description: string;
  counterparty: string;
  imported: boolean;
};

export type PaymentPreview = {
  source: PaymentSource;
  period: string;
  /** 被排除的非正金额交易数（退款等）。 */
  skipped: number;
  items: PaymentPreviewItem[];
};

export type PaymentImportResult = {
  imported: number;
  skipped: number;
  incomeCount: number;
  feeCount: number;
};

export type PaymentImportInput = {
  period: string;
  types?: string;
  items: {
    sourceKey: string;
    projectId: number;
    categoryId: number;
    feeCategoryId?: number | null;
    accountId?: number | null;
  }[];
};

/* ------------------------------------------------------------------ */
/* 视频流量测算（全局共用）                                             */
/* ------------------------------------------------------------------ */

export type VideoTrafficRow = {
  /** 编码：HEVC / H264（仅 HEVC 有 4K 档）。 */
  codec: string;
  /** 分辨率档位：4K / 1080P / 720P / 480P / 360P */
  resolution: string;
  sizeGb: number | null;
  durationMin: number | null;
  /** 每分钟流量 GB/min（= 体积 / 时长，服务端折算）。 */
  perMinGb: number | null;
};

export type VideoTrafficList = {
  items: VideoTrafficRow[];
  updatedAt: string | null;
};

/* ------------------------------------------------------------------ */
/* 全局工具：解包 {code, message, data} 信封                            */
/* ------------------------------------------------------------------ */

/** 解包信封：code === 0 时返回 data；否则抛出携带后端 message 的错误。 */
export function unwrapEnvelope<T>(res: Envelope<T>): T {
  if (!res || typeof res.code !== 'number') {
    throw new Error('响应格式错误：缺少 code 字段');
  }
  if (res.code !== 0) {
    throw new Error(res.message || `请求失败（code=${res.code}）`);
  }
  return res.data;
}

/** 从 RTK Query / 原生异常中提取可展示的错误信息。 */
export function extractErrorMessage(e: unknown): string {
  const anyE = e as { data?: { message?: string }; error?: string; message?: string };
  return anyE?.data?.message ?? anyE?.error ?? anyE?.message ?? '操作失败，请稍后重试';
}

const rawBaseQuery = fetchBaseQuery({ baseUrl: '/api' });

const baseQueryWithEnvelope: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, apiInstance, extraOptions) => {
  const result = await rawBaseQuery(args, apiInstance, extraOptions);
  if (result.error) return { error: result.error };
  try {
    return { data: unwrapEnvelope(result.data as Envelope<unknown>) };
  } catch (e) {
    return {
      error: { status: 'CUSTOM_ERROR', error: (e as Error).message } as FetchBaseQueryError,
    };
  }
};

/* ------------------------------------------------------------------ */
/* RTK Query API slice                                                 */
/* ------------------------------------------------------------------ */

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithEnvelope,
  tagTypes: ['Transaction', 'Project', 'Category', 'Supplier', 'Account', 'Fx', 'Recurring', 'Budget', 'Analytics', 'Product', 'UnitEconomics'],
  endpoints: (builder) => ({
    getProjects: builder.query<Project[], { status?: ProjectStatus } | void>({
      query: (arg) => ({ url: '/projects', params: arg?.status ? { status: arg.status } : {} }),
      // 后端返回 { items }，此处解包为数组以保持既有调用方（多页下拉）兼容。
      transformResponse: (res: { items: Project[] }) => res.items,
      providesTags: ['Project'],
    }),

    getProjectDetail: builder.query<ProjectDetail, number>({
      query: (id) => `/projects/${id}`,
      providesTags: ['Project'],
    }),

    createProject: builder.mutation<Project, ProjectInput>({
      query: (body) => ({ url: '/projects', method: 'POST', body }),
      invalidatesTags: ['Project'],
    }),

    updateProject: builder.mutation<Project, { id: number; body: Partial<ProjectInput> }>({
      query: ({ id, body }) => ({ url: `/projects/${id}`, method: 'PUT', body }),
      invalidatesTags: ['Project'],
    }),

    deleteProject: builder.mutation<{ id: number }, number>({
      query: (id) => ({ url: `/projects/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Project'],
    }),

    /** 同步 GitHub 仓库统计并落库一条快照。 */
    syncProjectRepo: builder.mutation<{ snapshot: ProjectSnapshot; syncedAt: string }, number>({
      query: (id) => ({ url: `/projects/${id}/sync-repo`, method: 'POST' }),
      invalidatesTags: ['Project'],
    }),

    /** 引用明细：按引用类型下钻查看该项目的关联记录。 */
    getProjectRefItems: builder.query<ProjectRefList, { id: number; key: ProjectRefKey }>({
      query: ({ id, key }) => `/projects/${id}/references/${key}`,
      providesTags: ['Project'],
    }),

    getCategories: builder.query<Category[], { type?: CategoryType }>({
      query: (arg) => ({ url: '/categories', params: arg?.type ? { type: arg.type } : {} }),
      providesTags: ['Category'],
    }),

    createCategory: builder.mutation<Category, CategoryInput>({
      query: (body) => ({ url: '/categories', method: 'POST', body }),
      invalidatesTags: ['Category'],
    }),

    updateCategory: builder.mutation<Category, { id: number; body: Partial<CategoryInput> }>({
      query: ({ id, body }) => ({ url: `/categories/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Category'],
    }),

    deleteCategory: builder.mutation<{ id: number }, number>({
      query: (id) => ({ url: `/categories/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Category'],
    }),

    getSuppliers: builder.query<SupplierList, SupplierQuery | void>({
      query: (arg) => ({ url: '/suppliers', params: arg ?? {} }),
      providesTags: ['Supplier'],
    }),

    createSupplier: builder.mutation<Supplier, SupplierInput>({
      query: (body) => ({ url: '/suppliers', method: 'POST', body }),
      invalidatesTags: ['Supplier'],
    }),

    updateSupplier: builder.mutation<Supplier, { id: number; body: Partial<SupplierInput> }>({
      query: ({ id, body }) => ({ url: `/suppliers/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Supplier'],
    }),

    deleteSupplier: builder.mutation<{ id: number }, number>({
      query: (id) => ({ url: `/suppliers/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Supplier'],
    }),

    getAccounts: builder.query<Account[], { all?: boolean } | void>({
      query: (arg) => ({ url: '/accounts', params: arg?.all ? { all: 1 } : {} }),
      providesTags: ['Account'],
    }),

    createAccount: builder.mutation<Account, AccountInput>({
      query: (body) => ({ url: '/accounts', method: 'POST', body }),
      invalidatesTags: ['Account'],
    }),

    updateAccount: builder.mutation<Account, { id: number; body: Partial<AccountInput> }>({
      query: ({ id, body }) => ({ url: `/accounts/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Account'],
    }),

    deleteAccount: builder.mutation<{ id: number }, number>({
      query: (id) => ({ url: `/accounts/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Account'],
    }),

    getFxLatest: builder.query<FxLatest, void>({
      query: () => '/fx/latest',
      providesTags: ['Fx'],
    }),

    getFxList: builder.query<FxRate[], { from?: string; to?: string }>({
      query: (arg) => ({ url: '/fx', params: arg ?? {} }),
      providesTags: ['Fx'],
    }),

    createFx: builder.mutation<{ rateDate: string; rate: number }, { rateDate: string; rate: number }>({
      query: (body) => ({ url: '/fx', method: 'POST', body }),
      invalidatesTags: ['Fx'],
    }),

    deleteFx: builder.mutation<{ rateDate: string }, string>({
      query: (rateDate) => ({ url: `/fx/${rateDate}`, method: 'DELETE' }),
      invalidatesTags: ['Fx'],
    }),

    getFxRemote: builder.query<FxRemote, void>({
      query: () => '/fx/remote',
      providesTags: ['Fx'],
    }),

    syncFx: builder.mutation<FxSyncResult, { from?: string; to?: string }>({
      query: (body) => ({ url: '/fx/sync', method: 'POST', body: body ?? {} }),
      invalidatesTags: ['Fx'],
    }),

    getTransactions: builder.query<TransactionList, TransactionQuery>({
      query: (arg) => ({ url: '/transactions', params: arg }),
      providesTags: ['Transaction'],
    }),

    createTransaction: builder.mutation<Transaction, TransactionInput>({
      query: (body) => ({ url: '/transactions', method: 'POST', body }),
      invalidatesTags: ['Transaction'],
    }),

    updateTransaction: builder.mutation<Transaction, { id: number; body: Partial<TransactionInput> }>({
      query: ({ id, body }) => ({ url: `/transactions/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Transaction'],
    }),

    deleteTransaction: builder.mutation<{ id: number }, number>({
      query: (id) => ({ url: `/transactions/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Transaction'],
    }),

    /** 流水的凭证附件列表（含实时预签名下载 URL）。 */
    getTransactionAttachments: builder.query<{ items: Attachment[] }, number>({
      query: (txnId) => `/transactions/${txnId}/attachments`,
      providesTags: ['Transaction'],
    }),

    /** 手动补传凭证：向指定流水上传 PDF（原始二进制 + Content-Type: application/pdf）。 */
    uploadTransactionAttachment: builder.mutation<
      { id: number; fileName: string; objectKey: string; sizeBytes: number },
      { txnId: number; file: File }
    >({
      query: ({ txnId, file }) => ({
        url: `/transactions/${txnId}/attachments`,
        method: 'POST',
        params: { fileName: file.name },
        body: file,
        headers: { 'Content-Type': 'application/pdf' },
      }),
      invalidatesTags: ['Transaction'],
    }),

    getDashboardSummary: builder.query<DashboardSummary, DashboardQuery>({
      query: (arg) => ({ url: '/dashboard/summary', params: arg }),
      providesTags: ['Transaction'],
    }),

    /* ---------------------------- 周期成本 ---------------------------- */

    getRecurringCosts: builder.query<RecurringList, RecurringQuery>({
      query: (arg) => ({ url: '/recurring-costs', params: arg ?? {} }),
      providesTags: ['Recurring'],
    }),

    getAmortization: builder.query<
      AmortizationPlan,
      { months?: number; projectId?: number; startMonth?: string }
    >({
      query: (arg) => ({ url: '/recurring-costs/amortization', params: arg ?? {} }),
      providesTags: ['Recurring'],
    }),

    createRecurringCost: builder.mutation<RecurringCost, RecurringInput>({
      query: (body) => ({ url: '/recurring-costs', method: 'POST', body }),
      invalidatesTags: ['Recurring'],
    }),

    updateRecurringCost: builder.mutation<RecurringCost, { id: number; body: Partial<RecurringInput> }>({
      query: ({ id, body }) => ({ url: `/recurring-costs/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Recurring'],
    }),

    deleteRecurringCost: builder.mutation<{ id: number }, number>({
      query: (id) => ({ url: `/recurring-costs/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Recurring'],
    }),

    generateRecurring: builder.mutation<GenerateResult, { id: number; until?: string }>({
      query: ({ id, until }) => ({
        url: `/recurring-costs/${id}/generate`,
        method: 'POST',
        body: { until },
      }),
      invalidatesTags: ['Recurring', 'Transaction'],
    }),

    generateAllRecurring: builder.mutation<
      {
        until: string;
        period: string;
        totalGenerated: number;
        details: GenerateResult[];
        errors: { id: number; nameCn: string; message: string }[];
      },
      { until?: string; period?: string }
    >({
      query: (body) => ({ url: '/recurring-costs/generate-all', method: 'POST', body }),
      invalidatesTags: ['Recurring', 'Transaction'],
    }),

    /** 预览用量（不落库）：period 缺省为上一自然月。 */
    previewUsage: builder.mutation<UsagePreview, { id: number; period?: string; quantity?: number }>({
      query: ({ id, ...body }) => ({
        url: `/recurring-costs/${id}/meter/preview`,
        method: 'POST',
        body,
      }),
    }),

    /** 用量计费：写计量记录 + 流水（幂等）。 */
    billRecurring: builder.mutation<
      UsageBillResult,
      { id: number; period?: string; quantity?: number; billedOn?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `/recurring-costs/${id}/bill`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Recurring', 'Transaction'],
    }),

    /** 计量记录列表（含项目 / 科目归属）。 */
    getUsageRecords: builder.query<{ items: UsageRecordLine[] }, UsageRecordQuery | void>({
      query: (arg) => ({ url: '/recurring-costs/usage-records', params: arg ?? {} }),
      providesTags: ['Recurring'],
    }),

    /** 调整计量记录的最终归属（项目 / 科目），同步更新流水。 */
    updateUsageRecord: builder.mutation<
      { item: UsageRecordLine },
      { id: number; projectId: number; categoryId: number }
    >({
      query: ({ id, ...body }) => ({
        url: `/recurring-costs/usage-records/${id}`,
        method: 'PATCH',
        body,
      }),
      // 归属变更会影响项目「引用统计」计数，故一并失效 Project 标签。
      invalidatesTags: ['Recurring', 'Transaction', 'Analytics', 'Project'],
    }),

    /* ------------------------------ 预算 ------------------------------ */

    getBudgets: builder.query<BudgetList, BudgetQuery>({
      query: (arg) => ({ url: '/budgets', params: arg ?? {} }),
      providesTags: ['Budget'],
    }),

    createBudget: builder.mutation<
      { id: number; projectId: number; categoryId: number | null; period: string; amountCny: number },
      BudgetInput
    >({
      query: (body) => ({ url: '/budgets', method: 'POST', body }),
      invalidatesTags: ['Budget'],
    }),

    deleteBudget: builder.mutation<{ id: number }, number>({
      query: (id) => ({ url: `/budgets/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Budget'],
    }),

    /* --------------------------- 成本收入分析 --------------------------- */

    getCostAnalytics: builder.query<AnalyticsResult, AnalyticsQuery>({
      query: (arg) => ({ url: '/analytics/cost', params: arg ?? {} }),
      providesTags: ['Analytics'],
    }),

    getRevenueAnalytics: builder.query<AnalyticsResult, AnalyticsQuery>({
      query: (arg) => ({ url: '/analytics/revenue', params: arg ?? {} }),
      providesTags: ['Analytics'],
    }),

    previewCloudflareUsage: builder.mutation<CloudflareUsagePreview, { period: string }>({
      query: ({ period }) => ({ url: '/cloudflare-billing/usage/preview', params: { period } }),
    }),

    importCloudflareUsage: builder.mutation<
      CloudflareImportResult,
      { period: string; items: { sourceKey: string; projectId: number; categoryId: number }[] }
    >({
      query: (body) => ({ url: '/cloudflare-billing/usage/import', method: 'POST', body }),
      invalidatesTags: ['Transaction', 'Analytics'],
    }),

    parseCloudflareInvoice: builder.mutation<CloudflareInvoiceParse, File>({
      query: (file) => ({
        url: '/cloudflare-billing/invoices/parse',
        method: 'POST',
        body: file,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    }),

    importCloudflareInvoice: builder.mutation<CloudflareImportResult, CloudflareInvoiceImportInput>({
      query: (body) => ({ url: '/cloudflare-billing/invoices/import', method: 'POST', body }),
      invalidatesTags: ['Transaction', 'Analytics'],
    }),

    /** 已导入账单列表（含项目 / 科目归属）。 */
    getCloudflareBills: builder.query<
      { items: CloudflareBillLine[] },
      { period?: string; sourceType?: 'usage' | 'invoice' } | void
    >({
      query: (arg) => ({ url: '/cloudflare-billing/imports', params: arg ?? {} }),
      providesTags: ['Transaction'],
    }),

    /** 调整账单最终归属（项目 / 科目），同步更新流水。 */
    updateCloudflareBill: builder.mutation<
      { item: CloudflareBillLine },
      { id: number; projectId: number; categoryId: number }
    >({
      query: ({ id, ...body }) => ({ url: `/cloudflare-billing/imports/${id}`, method: 'PATCH', body }),
      // 归属变更会影响项目「引用统计」计数，故一并失效 Project 标签。
      invalidatesTags: ['Transaction', 'Analytics', 'Project'],
    }),

    /* --------------------------- 支付渠道收入同步 --------------------------- */

    getPaymentSources: builder.query<PaymentSourceStatus[], void>({
      query: () => '/payments/sources',
    }),

    previewPayments: builder.query<
      PaymentPreview,
      { source: PaymentSource; period: string; types?: string }
    >({
      query: ({ source, period, types }) => ({
        url: `/payments/${source}/preview`,
        params: types ? { period, types } : { period },
      }),
    }),

    importPayments: builder.mutation<PaymentImportResult, { source: PaymentSource } & PaymentImportInput>({
      query: ({ source, ...body }) => ({ url: `/payments/${source}/import`, method: 'POST', body }),
      invalidatesTags: ['Transaction', 'Analytics', 'Account'],
    }),

    /* --------------------------- 产品与项目分摊 --------------------------- */

    getProducts: builder.query<ProductList, { status?: ProductStatus } | void>({
      query: (arg) => ({ url: '/products', params: arg?.status ? { status: arg.status } : {} }),
      providesTags: ['Product'],
    }),

    getProductDetail: builder.query<ProductDetail, number>({
      query: (id) => `/products/${id}`,
      providesTags: ['Product'],
    }),

    createProduct: builder.mutation<Product, ProductInput>({
      query: (body) => ({ url: '/products', method: 'POST', body }),
      invalidatesTags: ['Product'],
    }),

    updateProduct: builder.mutation<Product, { id: number; body: Partial<ProductInput> }>({
      query: ({ id, body }) => ({ url: `/products/${id}`, method: 'PUT', body }),
      invalidatesTags: ['Product'],
    }),

    deleteProduct: builder.mutation<{ id: number }, number>({
      query: (id) => ({ url: `/products/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Product'],
    }),

    /** 给产品新增成员项目（该项目在全部引用产品间默认均摊）。 */
    addProductProject: builder.mutation<
      { productId: number; projectId: number; effectiveFrom: string },
      AddProductProjectInput
    >({
      query: ({ id, ...body }) => ({ url: `/products/${id}/projects`, method: 'POST', body }),
      invalidatesTags: ['Product'],
    }),

    /** 从产品移除成员项目（该项目在剩余产品间重新均摊）。 */
    removeProductProject: builder.mutation<
      { productId: number; projectId: number; effectiveTo: string },
      RemoveProductProjectInput
    >({
      query: ({ id, projectId, effectiveTo }) => ({
        url: `/products/${id}/projects/${projectId}`,
        method: 'DELETE',
        body: { effectiveTo },
      }),
      invalidatesTags: ['Product'],
    }),

    /** 调整某项目在各产品间的分摊比例（合计必须 = 100%，版本化生效）。 */
    updateProjectAllocations: builder.mutation<
      { projectId: number; effectiveFrom: string; items: { productId: number; ratio: number }[] },
      UpdateAllocationsInput
    >({
      query: ({ projectId, ...body }) => ({
        url: `/products/projects/${projectId}/allocations`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['Product'],
    }),

    /** 项目视角：某项目在各引用产品间的收支比重。 */
    getProjectShares: builder.query<ProjectShares, { projectId: number; lookback?: number }>({
      query: ({ projectId, lookback }) => ({
        url: `/products/projects/${projectId}/shares`,
        params: lookback ? { lookback } : {},
      }),
      providesTags: ['Product'],
    }),

    /* --------------------------- 产品盈利模型 --------------------------- */

    getUnitEconomicsOverview: builder.query<UEOverview, void>({
      query: () => '/unit-economics',
      providesTags: ['UnitEconomics'],
    }),

    getUnitEconomicsDetail: builder.query<UEDetail, number>({
      query: (productId) => `/unit-economics/${productId}`,
      providesTags: ['UnitEconomics'],
    }),

    /** 实时模拟：不落库，返回三档情景的最新模型结果。 */
    simulateUnitEconomics: builder.mutation<UESimulateResult, UESimulateInput>({
      query: ({ productId, scenarios }) => ({
        url: `/unit-economics/${productId}/simulate`,
        method: 'POST',
        body: { scenarios },
      }),
    }),

    /** 保存某档情景的模型假设。 */
    saveUnitEconomicsInputs: builder.mutation<UEDetail, UESaveInputsInput>({
      query: ({ productId, scenario, body }) => ({
        url: `/unit-economics/${productId}/inputs`,
        method: 'PUT',
        body: { scenario, ...body },
      }),
      invalidatesTags: ['UnitEconomics'],
    }),

    /* ------------------------- 全变量测算（econ-vars） ------------------------- */

    /** 读取全变量测算（无记录时按实际流水初始化 Vultr 月租）。 */
    getUnitEconomicsEconVars: builder.query<EconPayload, number>({
      query: (productId) => `/unit-economics/${productId}/econ-vars`,
      providesTags: ['UnitEconomics'],
    }),

    /** 全变量实时模拟：不落库，按提交变量重算（用于输入即时联动）。 */
    simulateUnitEconomicsEconVars: builder.mutation<EconPayload, { productId: number; vars: Partial<EconVars> }>({
      query: ({ productId, vars }) => ({
        url: `/unit-economics/${productId}/econ-vars/simulate`,
        method: 'POST',
        body: { vars },
      }),
    }),

    /** 保存全变量（按次新增一条带保存日期的历史快照）。 */
    saveUnitEconomicsEconVars: builder.mutation<EconPayload, { productId: number; vars: Partial<EconVars> }>({
      query: ({ productId, vars }) => ({
        url: `/unit-economics/${productId}/econ-vars`,
        method: 'PUT',
        body: vars,
      }),
      invalidatesTags: ['UnitEconomics'],
    }),

    /** 全变量历史快照列表（按保存日期倒序）。 */
    getUnitEconomicsEconVarsSnapshots: builder.query<EconSnapshotList, number>({
      query: (productId) => `/unit-economics/${productId}/econ-vars/snapshots`,
      providesTags: ['UnitEconomics'],
    }),

    /** 读取指定历史版本快照的完整测算（用于回溯查看）。 */
    getUnitEconomicsEconVarsSnapshot: builder.query<EconPayload, { productId: number; snapshotId: number }>({
      query: ({ productId, snapshotId }) => `/unit-economics/${productId}/econ-vars/snapshots/${snapshotId}`,
      providesTags: ['UnitEconomics'],
    }),

    /** 删除指定历史版本快照。 */
    deleteUnitEconomicsEconVarsSnapshot: builder.mutation<{ deleted: number }, { productId: number; snapshotId: number }>({
      query: ({ productId, snapshotId }) => ({
        url: `/unit-economics/${productId}/econ-vars/snapshots/${snapshotId}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['UnitEconomics'],
    }),

    /* ------------------- cf & THKCOS 全变量测算（thkcos-vars） ------------------- */

    /** 读取 THKCOS 全变量测算（无记录时按实际流水初始化 Vultr 月租）。 */
    getUnitEconomicsThkcosVars: builder.query<ThkcosPayload, number>({
      query: (productId) => `/unit-economics/${productId}/thkcos-vars`,
      providesTags: ['UnitEconomics'],
    }),

    /** THKCOS 全变量实时模拟：不落库，按提交变量重算（用于输入即时联动）。 */
    simulateUnitEconomicsThkcosVars: builder.mutation<ThkcosPayload, { productId: number; vars: Partial<ThkcosVars> }>({
      query: ({ productId, vars }) => ({
        url: `/unit-economics/${productId}/thkcos-vars/simulate`,
        method: 'POST',
        body: { vars },
      }),
    }),

    /** 保存 THKCOS 全变量（按次新增一条带保存日期的历史快照）。 */
    saveUnitEconomicsThkcosVars: builder.mutation<ThkcosPayload, { productId: number; vars: Partial<ThkcosVars> }>({
      query: ({ productId, vars }) => ({
        url: `/unit-economics/${productId}/thkcos-vars`,
        method: 'PUT',
        body: vars,
      }),
      invalidatesTags: ['UnitEconomics'],
    }),

    /** THKCOS 全变量历史快照列表（按保存日期倒序）。 */
    getUnitEconomicsThkcosVarsSnapshots: builder.query<ThkcosSnapshotList, number>({
      query: (productId) => `/unit-economics/${productId}/thkcos-vars/snapshots`,
      providesTags: ['UnitEconomics'],
    }),

    /** 读取指定历史版本快照的完整测算（用于回溯查看）。 */
    getUnitEconomicsThkcosVarsSnapshot: builder.query<ThkcosPayload, { productId: number; snapshotId: number }>({
      query: ({ productId, snapshotId }) => `/unit-economics/${productId}/thkcos-vars/snapshots/${snapshotId}`,
      providesTags: ['UnitEconomics'],
    }),

    /** 删除指定历史版本快照。 */
    deleteUnitEconomicsThkcosVarsSnapshot: builder.mutation<{ deleted: number }, { productId: number; snapshotId: number }>({
      query: ({ productId, snapshotId }) => ({
        url: `/unit-economics/${productId}/thkcos-vars/snapshots/${snapshotId}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['UnitEconomics'],
    }),

    /* ------------------- 视频流量测算（video-traffic，全局共用） ------------------- */

    /** 读取 5 档分辨率流量测算。 */
    getVideoTraffic: builder.query<VideoTrafficList, void>({
      query: () => '/video-traffic',
      providesTags: ['UnitEconomics'],
    }),

    /** 保存各编码 × 分辨率流量测算（按 codec + resolution upsert）。 */
    saveVideoTraffic: builder.mutation<
      VideoTrafficList,
      { items: { codec: string; resolution: string; sizeGb: number | null; durationMin: number | null }[] }
    >({
      query: (body) => ({ url: '/video-traffic', method: 'PUT', body }),
      invalidatesTags: ['UnitEconomics'],
    }),
  }),
});

export const {
  useGetProjectsQuery,
  useGetProjectDetailQuery,
  useCreateProjectMutation,
  useUpdateProjectMutation,
  useDeleteProjectMutation,
  useSyncProjectRepoMutation,
  useGetProjectRefItemsQuery,
  useGetCategoriesQuery,
  useCreateCategoryMutation,
  useUpdateCategoryMutation,
  useDeleteCategoryMutation,
  useGetSuppliersQuery,
  useLazyGetSuppliersQuery,
  useCreateSupplierMutation,
  useUpdateSupplierMutation,
  useDeleteSupplierMutation,
  useGetAccountsQuery,
  useCreateAccountMutation,
  useUpdateAccountMutation,
  useDeleteAccountMutation,
  useGetFxLatestQuery,
  useGetFxListQuery,
  useCreateFxMutation,
  useDeleteFxMutation,
  useGetFxRemoteQuery,
  useSyncFxMutation,
  useGetTransactionsQuery,
  useCreateTransactionMutation,
  useUpdateTransactionMutation,
  useDeleteTransactionMutation,
  useGetTransactionAttachmentsQuery,
  useLazyGetTransactionAttachmentsQuery,
  useUploadTransactionAttachmentMutation,
  useGetDashboardSummaryQuery,
  useGetRecurringCostsQuery,
  useGetAmortizationQuery,
  useCreateRecurringCostMutation,
  useUpdateRecurringCostMutation,
  useDeleteRecurringCostMutation,
  useGenerateRecurringMutation,
  useGenerateAllRecurringMutation,
  usePreviewUsageMutation,
  useBillRecurringMutation,
  useGetUsageRecordsQuery,
  useUpdateUsageRecordMutation,
  useGetBudgetsQuery,
  useCreateBudgetMutation,
  useDeleteBudgetMutation,
  useGetCostAnalyticsQuery,
  useGetRevenueAnalyticsQuery,
  usePreviewCloudflareUsageMutation,
  useImportCloudflareUsageMutation,
  useParseCloudflareInvoiceMutation,
  useImportCloudflareInvoiceMutation,
  useGetCloudflareBillsQuery,
  useUpdateCloudflareBillMutation,
  useGetPaymentSourcesQuery,
  usePreviewPaymentsQuery,
  useLazyPreviewPaymentsQuery,
  useImportPaymentsMutation,
  useGetProductsQuery,
  useGetProductDetailQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
  useAddProductProjectMutation,
  useRemoveProductProjectMutation,
  useUpdateProjectAllocationsMutation,
  useGetProjectSharesQuery,
  useLazyGetProjectSharesQuery,
  useGetUnitEconomicsOverviewQuery,
  useGetUnitEconomicsDetailQuery,
  useSimulateUnitEconomicsMutation,
  useSaveUnitEconomicsInputsMutation,
  useGetUnitEconomicsEconVarsQuery,
  useSimulateUnitEconomicsEconVarsMutation,
  useSaveUnitEconomicsEconVarsMutation,
  useGetUnitEconomicsEconVarsSnapshotsQuery,
  useLazyGetUnitEconomicsEconVarsSnapshotQuery,
  useDeleteUnitEconomicsEconVarsSnapshotMutation,
  useGetUnitEconomicsThkcosVarsQuery,
  useSimulateUnitEconomicsThkcosVarsMutation,
  useSaveUnitEconomicsThkcosVarsMutation,
  useGetUnitEconomicsThkcosVarsSnapshotsQuery,
  useLazyGetUnitEconomicsThkcosVarsSnapshotQuery,
  useDeleteUnitEconomicsThkcosVarsSnapshotMutation,
  useGetVideoTrafficQuery,
  useSaveVideoTrafficMutation,
} = api;
