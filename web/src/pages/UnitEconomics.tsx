import { useEffect, useMemo, useRef, useState } from 'react';
import {
  extractErrorMessage,
  useGetUnitEconomicsDetailQuery,
  useGetUnitEconomicsOverviewQuery,
  useSaveUnitEconomicsInputsMutation,
  useSimulateUnitEconomicsMutation,
  type HealthFlag,
  type ModelInputs,
  type Prerequisite,
  type ScenarioKey,
  type SensitivityRow,
  type UEMetrics,
  type UESimulateResult,
  type UESuggestion,
} from '../api';
import { Card, CardHeader, Empty, PageHeader } from '../components/Card';
import EconModelTab from '../components/EconModelTab';
import ThkcosModelTab from '../components/ThkcosModelTab';
import PlatformPricingTab from '../components/PlatformPricingTab';
import VideoTrafficTab from '../components/VideoTrafficTab';
import { Button, Field, Input, Select } from '../components/Field';
import { Money } from '../components/Money';
import { domainLabel } from '../lib/domains';
import { formatCny, formatInt, formatRate } from '../lib/format';

/* ------------------------------------------------------------------ */
/* 情景元数据与本地可编辑状态                                            */
/* ------------------------------------------------------------------ */

const SCENARIOS: { key: ScenarioKey; cn: string; en: string; accent: string; stroke: string }[] = [
  { key: 'neutral', cn: '中性', en: 'Neutral', accent: 'text-sky-400', stroke: '#38bdf8' },
  { key: 'optimistic', cn: '乐观', en: 'Optimistic', accent: 'text-emerald-400', stroke: '#34d399' },
  { key: 'pessimistic', cn: '悲观', en: 'Pessimistic', accent: 'text-rose-400', stroke: '#fb7185' },
];

const PRODUCT_KIND_LABEL: Record<string, { cn: string; en: string }> = {
  frontend: { cn: '前台', en: 'Frontend' },
  backend: { cn: '后台', en: 'Backend' },
  platform: { cn: '平台', en: 'Platform' },
  other: { cn: '其他', en: 'Other' },
};

/** 编辑态：百分比按人类习惯录入（5 = 5%），提交时再折算为 0-1。 */
type Editable = {
  mau: string;
  payingRatioPct: string;
  arppuCny: string;
  churnPct: string;
  growthPct: string;
  fixedCostCny: string;
  unitVarCostCny: string;
  horizonMonths: string;
};

const numToStr = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const pctToStr = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : String(Math.round(v * 10000) / 100);

function toEditable(inp: ModelInputs): Editable {
  return {
    mau: numToStr(inp.mau),
    payingRatioPct: pctToStr(inp.payingRatio),
    arppuCny: numToStr(inp.arppuCny),
    churnPct: pctToStr(inp.monthlyChurn),
    growthPct: pctToStr(inp.monthlyGrowth),
    fixedCostCny: numToStr(inp.fixedCostCny),
    unitVarCostCny: numToStr(inp.unitVarCostCny),
    horizonMonths: String(inp.horizonMonths ?? 24),
  };
}

const parseNum = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const parsePct = (s: string): number | null => {
  const n = parseNum(s);
  return n === null ? null : n / 100;
};

function toPayload(e: Editable): Partial<ModelInputs> {
  return {
    mau: parseNum(e.mau),
    payingRatio: parsePct(e.payingRatioPct),
    arppuCny: parseNum(e.arppuCny),
    monthlyChurn: parsePct(e.churnPct),
    monthlyGrowth: parsePct(e.growthPct),
    fixedCostCny: parseNum(e.fixedCostCny),
    unitVarCostCny: parseNum(e.unitVarCostCny),
    horizonMonths: parseNum(e.horizonMonths) ?? 24,
  };
}

const emptyEditable = (): Record<ScenarioKey, Editable> => ({
  neutral: toEditable({ mau: null, payingRatio: null, arppuCny: null, monthlyChurn: 0.05, monthlyGrowth: 0.03, fixedCostCny: null, unitVarCostCny: null, horizonMonths: 24, lookbackMonths: 3 }),
  optimistic: toEditable({ mau: null, payingRatio: null, arppuCny: null, monthlyChurn: 0.03, monthlyGrowth: 0.06, fixedCostCny: null, unitVarCostCny: null, horizonMonths: 24, lookbackMonths: 3 }),
  pessimistic: toEditable({ mau: null, payingRatio: null, arppuCny: null, monthlyChurn: 0.08, monthlyGrowth: 0, fixedCostCny: null, unitVarCostCny: null, horizonMonths: 24, lookbackMonths: 3 }),
});

/* ------------------------------------------------------------------ */
/* 小工具组件                                                          */
/* ------------------------------------------------------------------ */

const SEV_STYLE: Record<string, string> = {
  high: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  low: 'border-slate-600/50 bg-slate-700/20 text-slate-300',
};

function FlagBadge({ flag }: { flag: HealthFlag }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${SEV_STYLE[flag.severity]}`}>
      {flag.labelCn} · {flag.labelEn}
    </span>
  );
}

function ScenarioPill({ s }: { s: (typeof SCENARIOS)[number] }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.accent}`}>
      <span className="h-2 w-2 rounded-full" style={{ background: s.stroke }} />
      {s.en} {s.cn}
    </span>
  );
}

/** 三档情景累计净现金流折线（纯 SVG，无第三方依赖）。 */
function CumulativeChart({
  series,
  width = 720,
  height = 220,
}: {
  series: { key: ScenarioKey; ym: string; cum: number }[][];
  width?: number;
  height?: number;
}) {
  const flat = series.flat();
  if (flat.length === 0) return <Empty text="录入 MAU 与付费率后显示盈利周期推演" />;

  const n = Math.max(...series.map((s) => s.length));
  const values = flat.map((p) => p.cum);
  const maxV = Math.max(0, ...values);
  const minV = Math.min(0, ...values);
  const pad = 34;
  const innerW = width - pad * 2;
  const innerH = height - 24;
  const x = (i: number) => pad + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const y = (v: number) => 8 + ((maxV - v) / (maxV - minV || 1)) * innerH;
  const zeroY = y(0);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full min-w-[560px]">
        {/* 零轴 */}
        <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="#334155" strokeDasharray="4 4" />
        <text x={pad - 6} y={zeroY + 3} textAnchor="end" className="fill-slate-500" fontSize="10">
          0
        </text>
        {series.map((pts, idx) => {
          const meta = SCENARIOS.find((s) => s.key === pts[0]?.key) ?? SCENARIOS[0];
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.cum)}`).join(' ');
          return <path key={idx} d={d} fill="none" stroke={meta.stroke} strokeWidth={2} />;
        })}
        {series[0]?.length ? (
          <>
            <text x={pad} y={height - 4} className="fill-slate-500" fontSize="10">
              {series[0][0].ym}
            </text>
            <text x={width - pad} y={height - 4} textAnchor="end" className="fill-slate-500" fontSize="10">
              {series[0][series[0].length - 1].ym}
            </text>
          </>
        ) : null}
      </svg>
    </div>
  );
}

/** 敏感度龙卷风：单变量 ±20% 对盈亏平衡 MAU 的影响幅度。 */
function Tornado({ rows }: { rows: SensitivityRow[] }) {
  if (rows.length === 0) return <Empty text="暂无可计算的敏感度（需先达成可平衡的单位经济）" />;
  const max = Math.max(...rows.map((r) => r.impact), 1);
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <div className="w-32 shrink-0 text-right text-xs text-slate-400">
            {r.labelEn}
            <div className="text-[10px] text-slate-600">{r.labelCn}</div>
          </div>
          <div className="relative h-6 flex-1">
            <div className="absolute inset-y-0 left-1/2 w-px bg-slate-700" />
            <div
              className="absolute inset-y-1.5 rounded bg-amber-500/70"
              style={{ width: `${(r.impact / max) * 50}%`, left: '50%' }}
              title={`±20% → 平衡 MAU 波动 ${formatInt(r.impact)}`}
            />
          </div>
          <div className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-300">
            ±{formatInt(r.impact)}
          </div>
        </div>
      ))}
      <p className="pt-1 text-[11px] text-slate-600">
        条形越长代表该变量对盈亏平衡 MAU 越敏感（其余变量保持不变）。优先调节最敏感项。
      </p>
    </div>
  );
}

function KpiCard({
  en,
  cn,
  children,
  accent = 'text-slate-100',
  badge,
}: {
  en: string;
  cn: string;
  children: React.ReactNode;
  accent?: string;
  /** 数值口径角标（如「实际」= 未录模型参数时回落到实际经营基线）。 */
  badge?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className={`flex items-center gap-1.5 text-sm font-semibold ${accent}`}>
        {en}
        {badge}
      </div>
      <div className="mb-2 text-[11px] text-slate-500">{cn}</div>
      {children}
    </Card>
  );
}

/** 「实际」角标：模型参数未录入时，KPI 显示的是实际流水基线而非预测值。 */
function ActualBadge() {
  return (
    <span className="rounded border border-slate-600/60 bg-slate-700/30 px-1 py-0.5 text-[10px] font-normal text-slate-300">
      实际
    </span>
  );
}

function formatPct(v: number | null | undefined, digits = 1) {
  if (v === null || v === undefined) return '—';
  return `${formatRate(v * 100, digits)}%`;
}

/* ------------------------------------------------------------------ */
/* 主页面                                                              */
/* ------------------------------------------------------------------ */

export default function UnitEconomics() {
  const { data: overview } = useGetUnitEconomicsOverviewQuery();
  const printRef = useRef<HTMLDivElement | null>(null);
  const [productId, setProductId] = useState<number | null>(null);

  useEffect(() => {
    if (productId === null && overview?.products?.length) setProductId(overview.products[0].productId);
  }, [overview, productId]);

  const { data: detail, isLoading } = useGetUnitEconomicsDetailQuery(productId ?? 0, {
    skip: productId === null,
  });

  const [simulate] = useSimulateUnitEconomicsMutation();
  const [saveInputs, { isLoading: saving }] = useSaveUnitEconomicsInputsMutation();

  const [tab, setTab] = useState<'overview' | 'econ' | 'thkcos' | 'pricing' | 'video'>('overview');
  const [editable, setEditable] = useState<Record<ScenarioKey, Editable>>(emptyEditable);
  const [active, setActive] = useState<ScenarioKey>('neutral');
  const [sim, setSim] = useState<UESimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // 详情加载 / 切换项目时，重置编辑态与模拟结果
  useEffect(() => {
    if (!detail) return;
    const next = emptyEditable();
    for (const s of SCENARIOS) next[s.key] = toEditable(detail.inputs[s.key]);
    setEditable(next);
    setSim(null);
    setError(null);
    setSavedAt(null);
  }, [detail]);

  // 输入变化 → 防抖实时模拟（不落库）
  useEffect(() => {
    if (!detail || productId === null) return;
    const payload = {
      neutral: toPayload(editable.neutral),
      optimistic: toPayload(editable.optimistic),
      pessimistic: toPayload(editable.pessimistic),
    };
    const t = setTimeout(() => {
      simulate({ productId, scenarios: payload })
        .unwrap()
        .then(setSim)
        .catch(() => undefined);
    }, 350);
    return () => clearTimeout(t);
  }, [editable, detail, productId, simulate]);

  const models = sim?.models ?? detail?.models;
  const prerequisites: Prerequisite[] = sim?.prerequisites ?? detail?.prerequisites ?? [];
  const sensitivityRows = sim?.sensitivity ?? detail?.sensitivity ?? [];
  const suggestions: UESuggestion[] = sim?.suggestions ?? detail?.suggestions ?? [];
  const flags: HealthFlag[] = sim?.flags ?? detail?.flags ?? [];
  const neutral: UEMetrics | undefined = models?.neutral.metrics;

  /** 模型未就绪（未录 MAU / 付费率 / ARPPU）时，成本与净利回落显示实际经营基线。 */
  const actualFallback = neutral?.ready !== true;
  const kpiCostCny = actualFallback ? detail?.actuals.totalCostCny ?? null : neutral?.totalCostCny ?? null;
  const kpiNetCny = actualFallback ? detail?.actuals.netCny ?? null : neutral?.netCny ?? null;

  const products = overview?.products ?? [];
  const alertProducts = useMemo(
    () => products.filter((p) => p.flags.some((f) => f.severity === 'high')),
    [products]
  );

  const chartSeries = useMemo(() => {
    if (!models) return [];
    return SCENARIOS.map((s) =>
      (models[s.key].projection.points ?? []).map((p) => ({ key: s.key, ym: p.ym, cum: p.cumNetCny }))
    ).filter((arr) => arr.length > 0);
  }, [models]);

  async function handleSave(scenario: ScenarioKey) {
    if (productId === null) return;
    setError(null);
    try {
      await saveInputs({ productId, scenario, body: toPayload(editable[scenario]) }).unwrap();
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  function handlePrint() {
    if (!printRef.current) return;
    const printFrame = document.createElement('iframe');
    printFrame.setAttribute('aria-hidden', 'true');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    document.body.appendChild(printFrame);

    const copiedStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((node) => node.outerHTML)
      .join('');

    const frameDoc = printFrame.contentDocument;
    const frameWindow = printFrame.contentWindow;
    if (!frameDoc || !frameWindow) {
      document.body.removeChild(printFrame);
      return;
    }

    frameDoc.open();
    frameDoc.write(`
      <!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Unit Economics</title>
          ${copiedStyles}
          <style>
            html, body {
              background: #fff !important;
              color: #0f172a !important;
            }
            body {
              margin: 0;
              padding: 24px;
            }
            .print\\:hidden {
              display: none !important;
            }
            .h-full,
            .overflow-y-auto,
            .overflow-x-auto {
              height: auto !important;
              max-height: none !important;
              overflow: visible !important;
            }
          </style>
        </head>
        <body>
          <div>${printRef.current.innerHTML}</div>
        </body>
      </html>
    `);
    frameDoc.close();

    const runPrint = () => {
      if (frameDoc.readyState !== 'complete') {
        window.setTimeout(runPrint, 50);
        return;
      }
      frameWindow.focus();
      frameWindow.print();
      window.setTimeout(() => {
        document.body.removeChild(printFrame);
      }, 1000);
    };

    window.setTimeout(runPrint, 150);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div ref={printRef} className="px-4 py-6 md:px-12">
        <PageHeader
          en="Unit Economics"
          cn="产品盈利模型 · 盈亏平衡 / 盈利周期 / 成本控制"
          titleExtra={
            <Button type="button" variant="primary" size="sm" className="print:hidden" onClick={handlePrint}>
              打印
            </Button>
          }
        >
          <div className="text-right text-[11px] leading-tight text-slate-500">
            <div>
              在营产品 <span className="text-slate-300">{overview?.summary.count ?? 0}</span> · 高危预警{' '}
              <span className={alertProducts.length ? 'text-rose-400' : 'text-slate-300'}>
                {overview?.summary.alertCount ?? 0}
              </span>
            </div>
            <div>数据口径：近 3 个月实际流水按项目分摊比例归集 + 手工假设</div>
          </div>
        </PageHeader>

        {/* 产品 rail：每个产品一张卡，含健康预警 */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((p) => {
            const selected = p.productId === productId;
            const m = p.metrics;
            return (
              <button
                key={p.productId}
                onClick={() => setProductId(p.productId)}
                className={`rounded-xl border p-4 text-left transition ${
                  selected
                    ? 'border-emerald-500/60 bg-emerald-500/[0.06]'
                    : 'border-slate-800 bg-slate-900 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="leading-tight">
                    <div className="text-sm font-semibold text-slate-100">{p.nameEn}</div>
                    <div className="text-[11px] text-slate-500">{p.nameCn}</div>
                  </div>
                  {p.flags.length === 0 ? (
                    <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                      健康 · Healthy
                    </span>
                  ) : (
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${SEV_STYLE[p.flags[0].severity]}`}>
                      {p.flags.length} 项预警
                    </span>
                  )}
                </div>
                <div className="mt-2 text-[10px] text-slate-600">{PRODUCT_KIND_LABEL[p.kind]?.cn ?? p.kind}</div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <span className="text-slate-500">月收入 Rev</span>
                  <span className="text-right tabular-nums text-emerald-400">¥ {formatCny(p.actuals.revenueCny)}</span>
                  <span className="text-slate-500">月成本 Cost</span>
                  <span className="text-right tabular-nums text-rose-400">¥ {formatCny(p.actuals.totalCostCny)}</span>
                  <span className="text-slate-500">月净利 Net</span>
                  <span
                    className={`text-right tabular-nums ${p.actuals.netCny >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                  >
                    ¥ {formatCny(p.actuals.netCny)}
                  </span>
                </div>
                {m.ready && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-slate-400">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5">
                      平衡 MAU {m.breakEvenMau != null ? formatInt(m.breakEvenMau) : '不可达'}
                    </span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5">安全边际 {formatPct(m.safetyMargin, 0)}</span>
                  </div>
                )}
                {p.flags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.flags.map((f) => (
                      <FlagBadge key={f.key} flag={f} />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
          {products.length === 0 && <Empty text="暂无在营产品，请先在「产品维护」中创建" />}
        </div>

        {isLoading && !detail ? (
          <Empty text="加载中…" />
        ) : !detail || !neutral ? (
          <Empty text="请选择一个产品" />
        ) : (
          <>
            {/* Tab 切换：模型概览 / 全变量测算 / 平台资费 */}
            <div className="mb-4 flex gap-1 border-b border-slate-800">
              {(
                [
                  { key: 'overview', en: 'Model Overview', cn: '模型概览' },
                  { key: 'econ', en: 'All Variables', cn: 'cf&cdn全变量测算' },
                  { key: 'thkcos', en: 'All Variables (COS)', cn: 'cf&THKCOS全变量测算' },
                  { key: 'pricing', en: 'Platform Pricing', cn: '平台资费' },
                  { key: 'video', en: 'Video Traffic', cn: '视频流量测算' },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={`-mb-px border-b-2 px-4 py-2 text-xs font-medium transition ${
                    tab === item.key
                      ? 'border-emerald-500 text-emerald-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.en} · {item.cn}
                </button>
              ))}
            </div>

            {tab === 'econ' ? (
              <EconModelTab productId={detail.product.id} fxRate={detail.fxRate} />
            ) : tab === 'thkcos' ? (
              <ThkcosModelTab productId={detail.product.id} fxRate={detail.fxRate} />
            ) : tab === 'pricing' ? (
              <PlatformPricingTab fxRate={detail.fxRate} />
            ) : tab === 'video' ? (
              <VideoTrafficTab />
            ) : (
              <>
            {/* 当前产品 KPI */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="leading-tight">
                <div className="text-base font-semibold text-slate-100">
                  {detail.product.nameEn} <span className="text-slate-500">· {detail.product.nameCn}</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  基准口径：近 {detail.actuals.months} 个月分摊后流水均值
                  {detail.declining ? <span className="ml-2 text-rose-400">营收下滑中</span> : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {flags.length === 0 ? (
                  <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
                    无预警
                  </span>
                ) : (
                  flags.map((f) => <FlagBadge key={f.key} flag={f} />)
                )}
              </div>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
              <KpiCard en="Monthly Revenue" cn="月收入" accent="text-emerald-400">
                <Money cny={neutral.revenueCny} usd={detail.fxRate ? (neutral.revenueCny ?? 0) / detail.fxRate : null} size="lg" mainClass="text-emerald-400" />
              </KpiCard>
              <KpiCard
                en="Monthly Cost"
                cn="月总成本（固定+变动）"
                accent="text-rose-400"
                badge={actualFallback ? <ActualBadge /> : null}
              >
                <Money cny={kpiCostCny} usd={detail.fxRate ? (kpiCostCny ?? 0) / detail.fxRate : null} size="lg" mainClass="text-rose-400" />
              </KpiCard>
              <KpiCard
                en="Monthly Net"
                cn={actualFallback ? '月净利（实际）' : '月净利（预测）'}
                accent={kpiNetCny != null && kpiNetCny >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                badge={actualFallback ? <ActualBadge /> : null}
              >
                <Money
                  cny={kpiNetCny}
                  usd={detail.fxRate && kpiNetCny != null ? kpiNetCny / detail.fxRate : null}
                  size="lg"
                  mainClass={kpiNetCny != null && kpiNetCny >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                />
              </KpiCard>
              <KpiCard en="Contribution Margin" cn="边际贡献率">
                <div className="text-xl font-semibold tabular-nums text-slate-100">{formatPct(neutral.contributionRate)}</div>
              </KpiCard>
              <KpiCard en="Break-even MAU" cn="盈亏平衡 MAU" accent={neutral.negativeUnitEconomics ? 'text-rose-400' : 'text-sky-400'}>
                {neutral.negativeUnitEconomics ? (
                  <div className="text-lg font-semibold text-rose-400">单位经济为负</div>
                ) : (
                  <div className="text-xl font-semibold tabular-nums text-sky-400">
                    {neutral.breakEvenMau != null ? formatInt(neutral.breakEvenMau) : '—'}
                  </div>
                )}
                <div className="mt-0.5 text-[11px] text-slate-500">
                  安全边际 {formatPct(neutral.safetyMargin, 0)} · 当前 MAU{' '}
                  {neutral.inputs.mau != null ? formatInt(neutral.inputs.mau) : '待填'}
                </div>
              </KpiCard>
              <KpiCard en="Profitability" cn="预计达成盈利" accent="text-amber-400">
                <div className="text-sm font-semibold text-amber-400">
                  {models?.neutral.projection.breakEvenMonth == null
                    ? '期限内未达成'
                    : models.neutral.projection.breakEvenMonth === 0
                      ? '当前已盈亏平衡'
                      : `${models.neutral.projection.breakEvenMonth} 个月后`}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  累计转正{' '}
                  {models?.neutral.projection.paybackMonth == null
                    ? '—'
                    : models.neutral.projection.paybackMonth === 0
                      ? '已转正'
                      : `${models.neutral.projection.paybackMonth} 个月`}
                </div>
              </KpiCard>
            </div>

            {/* 三档情景对比 + 参数输入 */}
            <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader en="Scenario Comparison" cn="三档情景对比（中性 / 乐观 / 悲观）" />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-2 font-medium">指标 Metric</th>
                        {SCENARIOS.map((s) => (
                          <th key={s.key} className={`px-4 py-2 text-right font-medium ${s.accent}`}>
                            {s.en}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="text-slate-200">
                      {[
                        { label: '月收入 Rev', get: (m: UEMetrics) => (m.ready ? `¥ ${formatCny(m.revenueCny)}` : '—') },
                        { label: '月净利 Net', get: (m: UEMetrics) => (m.ready ? `¥ ${formatCny(m.netCny)}` : '—') },
                        { label: '边际贡献率', get: (m: UEMetrics) => formatPct(m.contributionRate) },
                        {
                          label: '盈亏平衡 MAU',
                          get: (m: UEMetrics) =>
                            m.negativeUnitEconomics ? '不可达' : m.breakEvenMau != null ? formatInt(m.breakEvenMau) : '—',
                        },
                        { label: '安全边际', get: (m: UEMetrics) => formatPct(m.safetyMargin, 0) },
                        {
                          label: '预计达盈亏',
                          get: (_m: UEMetrics, be: number | null) =>
                            be == null ? '期限内未达成' : be === 0 ? '已达成' : `${be} 个月`,
                        },
                      ].map((row) => (
                        <tr key={row.label} className="border-t border-slate-800/70">
                          <td className="px-4 py-2 text-xs text-slate-400">{row.label}</td>
                          {SCENARIOS.map((s) => {
                            const mod = models?.[s.key];
                            return (
                              <td key={s.key} className="px-4 py-2 text-right text-xs tabular-nums">
                                {mod ? row.get(mod.metrics, mod.projection.breakEvenMonth) : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card>
                <CardHeader
                  en="Model Assumptions"
                  cn="模型假设参数（手工输入 / 外部系统可写入）"
                  right={
                    <div className="flex gap-1">
                      {SCENARIOS.map((s) => (
                        <button
                          key={s.key}
                          onClick={() => setActive(s.key)}
                          className={`rounded px-2 py-1 text-xs transition ${
                            active === s.key ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'
                          }`}
                        >
                          {s.cn}
                        </button>
                      ))}
                    </div>
                  }
                />
                <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
                  <Field label="MAU" hint="月活跃用户">
                    <Input
                      type="number"
                      min="0"
                      value={editable[active].mau}
                      onChange={(e) => setEditable({ ...editable, [active]: { ...editable[active], mau: e.target.value } })}
                      placeholder="如 120000"
                    />
                  </Field>
                  <Field label="付费率 %" hint="Paying Ratio">
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={editable[active].payingRatioPct}
                      onChange={(e) =>
                        setEditable({ ...editable, [active]: { ...editable[active], payingRatioPct: e.target.value } })
                      }
                      placeholder="如 5"
                    />
                  </Field>
                  <Field label="ARPPU ¥" hint="留空=实际反推">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editable[active].arppuCny}
                      onChange={(e) =>
                        setEditable({ ...editable, [active]: { ...editable[active], arppuCny: e.target.value } })
                      }
                      placeholder="如 35"
                    />
                  </Field>
                  <Field label="月流失率 %" hint="Churn">
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={editable[active].churnPct}
                      onChange={(e) =>
                        setEditable({ ...editable, [active]: { ...editable[active], churnPct: e.target.value } })
                      }
                    />
                  </Field>
                  <Field label="MAU 月增长 %" hint="净增长">
                    <Input
                      type="number"
                      step="0.1"
                      value={editable[active].growthPct}
                      onChange={(e) =>
                        setEditable({ ...editable, [active]: { ...editable[active], growthPct: e.target.value } })
                      }
                    />
                  </Field>
                  <Field label="推演月数" hint="Horizon">
                    <Select
                      value={editable[active].horizonMonths}
                      onChange={(e) =>
                        setEditable({ ...editable, [active]: { ...editable[active], horizonMonths: e.target.value } })
                      }
                    >
                      <option value="12">12 个月</option>
                      <option value="24">24 个月</option>
                      <option value="36">36 个月</option>
                    </Select>
                  </Field>
                  <Field label="月固定成本 ¥" hint="留空=实际">
                    <Input
                      type="number"
                      min="0"
                      value={editable[active].fixedCostCny}
                      onChange={(e) =>
                        setEditable({ ...editable, [active]: { ...editable[active], fixedCostCny: e.target.value } })
                      }
                      placeholder={formatCny(detail.actuals.fixedCostCny)}
                    />
                  </Field>
                  <Field label="单位变动成本 ¥" hint="每 MAU / 留空=实际">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editable[active].unitVarCostCny}
                      onChange={(e) =>
                        setEditable({ ...editable, [active]: { ...editable[active], unitVarCostCny: e.target.value } })
                      }
                      placeholder="自动"
                    />
                  </Field>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-800 px-4 py-3">
                  <div className="text-[11px] text-slate-500">
                    {error ? (
                      <span className="text-rose-400">{error}</span>
                    ) : savedAt ? (
                      <span className="text-emerald-400">已保存 {savedAt}</span>
                    ) : (
                      '输入即时联动（不落库），点击保存后持久化'
                    )}
                  </div>
                  <Button size="sm" disabled={saving} onClick={() => handleSave(active)}>
                    {saving ? '保存中…' : `保存「${SCENARIOS.find((s) => s.key === active)?.cn}」假设`}
                  </Button>
                </div>
              </Card>
            </div>

            {/* 盈利周期推演 + 敏感度 */}
            <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Card className="xl:col-span-2">
                <CardHeader
                  en="Profitability Horizon"
                  cn="盈利周期推演 · 累计净现金流"
                  right={
                    <div className="flex flex-wrap gap-3">
                      {SCENARIOS.map((s) => (
                        <ScenarioPill key={s.key} s={s} />
                      ))}
                    </div>
                  }
                />
                <div className="p-4">
                  <CumulativeChart series={chartSeries} />
                  <div className="mt-3 grid grid-cols-3 gap-3 text-[11px]">
                    {SCENARIOS.map((s) => {
                      const p = models?.[s.key].projection;
                      return (
                        <div key={s.key} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                          <div className={`mb-1 text-xs font-medium ${s.accent}`}>{s.en} {s.cn}</div>
                          <div className="text-slate-400">
                            月度转正：
                            <span className="text-slate-200">
                              {p?.breakEvenMonth == null ? '未达成' : p.breakEvenMonth === 0 ? '已达成' : `${p.breakEvenMonth} 月`}
                            </span>
                          </div>
                          <div className="text-slate-400">
                            累计转正：
                            <span className="text-slate-200">
                              {p?.paybackMonth == null ? '未达成' : p.paybackMonth === 0 ? '已转正' : `${p.paybackMonth} 月`}
                            </span>
                          </div>
                          <div className="text-slate-400">
                            {s.key === 'neutral' ? '期末累计：' : '第 N 月末累计：'}
                            <span className={p && p.endCumNetCny != null && p.endCumNetCny >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                              ¥ {formatCny(p?.endCumNetCny)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>

              <Card>
                <CardHeader en="Sensitivity" cn="敏感度（中性情景 ±20%）" />
                <div className="p-4">
                  <Tornado rows={sensitivityRows} />
                </div>
              </Card>
            </div>

            {/* 前提要素 + 成本控制建议 */}
            <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader en="Break-even Prerequisites" cn="达成盈亏平衡的前提要素（中性情景）" />
                <div className="p-4">
                  {prerequisites.length === 0 ? (
                    <Empty text="录入 MAU 与付费率后显示前提要素" />
                  ) : (
                    <ul className="space-y-2.5">
                      {prerequisites.map((p) => (
                        <li key={p.key} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-slate-300">
                              {p.labelEn} <span className="text-slate-500">· {p.labelCn}</span>
                            </span>
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[10px] ${
                                p.satisfied
                                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                  : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                              }`}
                            >
                              {p.satisfied ? '已满足' : '待改善'}
                            </span>
                          </div>
                          <div className="mt-1 text-xs tabular-nums text-slate-400">
                            当前{' '}
                            <span className="text-slate-200">
                              {p.unit === 'ratio' ? formatPct(p.currentValue, 2) : `¥ ${formatCny(p.currentValue)}`}
                            </span>
                            <span className="mx-2 text-slate-600">→ 需</span>
                            {p.unit === 'ratio' ? '≥ ' : p.key === 'unitVarCost' || p.key === 'fixedCost' ? '≤ ' : '≥ '}
                            <span className="text-slate-100">
                              {p.unit === 'ratio' ? formatPct(p.requiredValue, 2) : `¥ ${formatCny(p.requiredValue)}`}
                            </span>
                            {!p.feasible && <span className="ml-2 text-rose-400">（不可达）</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader en="Cost Control Advice" cn="成本费用控制建议（中性情景）" />
                <ul className="divide-y divide-slate-800/70">
                  {suggestions.map((s) => (
                    <li key={s.key} className="flex gap-3 px-4 py-3">
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                          s.severity === 'high' ? 'bg-rose-500' : s.severity === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-200">
                          {s.titleEn} <span className="text-slate-500">· {s.titleCn}</span>
                          {s.domain && (
                            <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                              {domainLabel(s.domain, 'expense').cn}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{s.detailCn}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            {/* 组成项目下钻 */}
            <Card className="mb-6">
              <CardHeader
                en="Composition Drill-down"
                cn={`组成项目下钻（近 ${detail.actuals.months} 个月合计，按分摊比例归集）`}
                right={
                  <span className="text-[11px] text-slate-500">{detail.compositions.length} 个组成项目</span>
                }
              />
              {detail.compositions.length === 0 ? (
                <Empty text="该产品尚未关联任何项目，请先在「产品维护」中配置" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="border-b border-slate-800 px-5 py-2.5 font-medium">项目 Project</th>
                        <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">分摊比例</th>
                        <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">原始收入</th>
                        <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">原始成本</th>
                        <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">分摊后收入</th>
                        <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">分摊后成本</th>
                        <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">分摊后净利</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.compositions.map((c) => {
                        const net = c.allocRevenueCny - c.allocCostCny;
                        return (
                          <tr key={c.projectId} className="border-b border-slate-800/60">
                            <td className="px-5 py-2.5">
                              <div className="leading-tight">
                                <div className="text-slate-200">{c.nameEn}</div>
                                <div className="text-[11px] text-slate-500">{c.nameCn}</div>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">{formatPct(c.ratio, 2)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                              ¥ {formatCny(c.rawRevenueCny)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                              ¥ {formatCny(c.rawCostCny)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400">
                              ¥ {formatCny(c.allocRevenueCny)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-rose-400">
                              ¥ {formatCny(c.allocCostCny)}
                            </td>
                            <td
                              className={`px-4 py-2.5 text-right tabular-nums ${
                                net >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              ¥ {formatCny(net)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-700 text-xs">
                        <td className="px-5 py-2.5 text-slate-400" colSpan={4}>
                          合计 Total
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400">
                          ¥ {formatCny(detail.compositions.reduce((s, c) => s + c.allocRevenueCny, 0))}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-rose-400">
                          ¥ {formatCny(detail.compositions.reduce((s, c) => s + c.allocCostCny, 0))}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-200">
                          ¥ {formatCny(detail.compositions.reduce((s, c) => s + c.allocRevenueCny - c.allocCostCny, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>

            {/* 实际成本结构 */}
            <Card>
              <CardHeader en="Actual Cost Structure" cn={`实际成本结构（近 ${detail.actuals.months} 个月月均）`} />
              <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
                <div className="space-y-2">
                  {detail.costBreakdown.length === 0 ? (
                    <Empty text="暂无实际成本数据" />
                  ) : (
                    detail.costBreakdown.map((b) => (
                      <div key={b.domain} className="flex items-center gap-3">
                        <span className="w-28 shrink-0 text-xs text-slate-400">
                          {domainLabel(b.domain, 'expense').en}
                          <span className="ml-1 text-[10px] text-slate-600">
                            {b.isCogs ? '变动' : '固定'}
                          </span>
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={`h-full rounded-full ${b.isCogs ? 'bg-rose-500/80' : 'bg-sky-500/80'}`}
                            style={{ width: `${Math.min(100, b.share * 100)}%` }}
                          />
                        </div>
                        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-300">
                          ¥ {formatCny(b.cny)}
                        </span>
                        <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-slate-500">
                          {formatPct(b.share, 0)}
                        </span>
                      </div>
                    ))
                  )}
                  <div className="mt-2 flex gap-4 pt-2 text-[11px] text-slate-500">
                    <span>
                      变动成本(COGS) ¥ {formatCny(detail.actuals.variableCostCny)}
                    </span>
                    <span>
                      固定成本 ¥ {formatCny(detail.actuals.fixedCostCny)}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
                    实际收入 / 成本月度趋势 Actual Monthly
                  </div>
                  <div className="flex h-40 items-stretch gap-2 overflow-x-auto">
                    {detail.actuals.trend.length === 0 ? (
                      <Empty text="暂无流水" />
                    ) : (
                      (() => {
                        const max = Math.max(
                          1,
                          ...detail.actuals.trend.map((t) => Math.max(t.revenueCny, t.costCny))
                        );
                        return detail.actuals.trend.map((t) => (
                          <div key={t.ym} className="flex h-full min-w-[40px] flex-1 flex-col items-center gap-1">
                            <div className="flex w-full flex-1 items-end justify-center gap-1">
                              <div
                                title={`${t.ym} 收入 ¥${formatCny(t.revenueCny)}`}
                                className="w-2.5 rounded-t bg-emerald-500/80"
                                style={{ height: `${(t.revenueCny / max) * 100}%` }}
                              />
                              <div
                                title={`${t.ym} 成本 ¥${formatCny(t.costCny)}`}
                                className="w-2.5 rounded-t bg-rose-500/80"
                                style={{ height: `${(t.costCny / max) * 100}%` }}
                              />
                            </div>
                            <span className="whitespace-nowrap text-[10px] text-slate-500">{t.ym}</span>
                          </div>
                        ));
                      })()
                    )}
                  </div>
                </div>
              </div>
            </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
