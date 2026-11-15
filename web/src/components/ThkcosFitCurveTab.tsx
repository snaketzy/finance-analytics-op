import { useEffect, useMemo, useRef, useState } from 'react';
import {
  extractErrorMessage,
  useGetUnitEconomicsThkcosVarsQuery,
  useSimulateUnitEconomicsThkcosVarsMutation,
  type ThkcosMetrics,
  type ThkcosVars,
} from '../api';
import { Card, CardHeader, Empty } from './Card';
import { Field, Input } from './Field';
import { Money } from './Money';
import { formatCny, formatInt } from '../lib/format';

type CurvePoint = {
  x: number;
  revenueCny: number;
  totalCostCny: number;
  netCny: number;
};

type CurveSeries = {
  key: string;
  label: string;
  stroke: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
};

const FIT_SUBTABS = [
  {
    key: 'basic_eo_origin_tiered',
    en: 'Basic User · EO · Origin · Tiered',
    cn: '基础用户.EO.回源.阶梯',
    trafficMode: 'cdn' as const,
    cdnPricingMode: 'tiered' as const,
    cdnPackagePrice: null,
    pricingLabel: '按量 · 阶梯累进',
    packagePriceLabel: '不适用',
  },
  {
    key: 'basic_eo_package',
    en: 'Basic User · EO · Package',
    cn: '基础用户.EO.回源.预付',
    trafficMode: 'cdn' as const,
    cdnPricingMode: 'package' as const,
    cdnPackagePrice: 'list' as const,
    pricingLabel: '预付费 · 流量包',
    packagePriceLabel: '单次购买 · 刊例价',
  },
  {
    key: 'basic_cos_direct_tiered',
    en: 'Basic User · COS Direct · Metered',
    cn: '基础用户.COS直连.按量',
    trafficMode: 'direct' as const,
    cdnPricingMode: 'tiered' as const,
    cdnPackagePrice: null,
    pricingLabel: '按量 · 官方单价',
    packagePriceLabel: '不适用',
  },
  {
    key: 'basic_cos_direct_package',
    en: 'Basic User · COS Direct · Package',
    cn: '基础用户.COS直连.预付',
    trafficMode: 'direct' as const,
    cdnPricingMode: 'package' as const,
    cdnPackagePrice: 'list' as const,
    pricingLabel: '预付费 · 流量包',
    packagePriceLabel: '单次购买 · 刊例价',
  },
] as const;

type FitSubtabKey = (typeof FIT_SUBTABS)[number]['key'];

const SAMPLE_COUNT = 16;

const num = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));

function basicContinuousMonthlySubsOf(vars: ThkcosVars) {
  return num(vars.basicContinuousMonthlySubs);
}

function niceMax(value: number) {
  if (value <= 100) return 100;
  if (value <= 1000) return Math.ceil(value / 100) * 100;
  if (value <= 10000) return Math.ceil(value / 500) * 500;
  return Math.ceil(value / 1000) * 1000;
}

function buildSamples(max: number, current: number) {
  const points = new Set<number>([0, Math.max(0, Math.round(current)), Math.max(0, Math.round(max))]);
  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    points.add(Math.max(0, Math.round((max * i) / SAMPLE_COUNT)));
  }
  return Array.from(points).sort((a, b) => a - b);
}

function buildScenarioVars(
  base: ThkcosVars,
  continuousMonthlyUsers: number,
  libraryTitles: number,
  subtab: FitSubtabKey
): ThkcosVars {
  const config = FIT_SUBTABS.find((item) => item.key === subtab) ?? FIT_SUBTABS[0];
  const viewers = Math.max(0, Math.round(continuousMonthlyUsers));
  return {
    ...base,
    trafficMode: config.trafficMode,
    cdnPricingMode: config.cdnPricingMode,
    cdnPackagePrice: config.cdnPackagePrice,
    libraryTitles: Math.max(0, Math.round(libraryTitles)),
    experienceCardSubs: 0,
    vipCardSubs: 0,
    basicViewers: viewers,
    premiumViewers: 0,
    basicMonthlySubs: 0,
    basicContinuousMonthlySubs: viewers,
    basicQuarterlySubs: 0,
    basicYearlySubs: 0,
    premiumMonthlySubs: 0,
    premiumContinuousMonthlySubs: 0,
    premiumQuarterlySubs: 0,
    premiumYearlySubs: 0,
  };
}

function cnyTick(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 10000) return `${(v / 10000).toFixed(1)}万`;
  if (abs >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(0);
}

function FitLineChart({
  series,
  xMax,
  xTick,
  xStartLabel,
  xEndLabel,
  marker,
  height = 240,
}: {
  series: CurveSeries[];
  xMax: number;
  xTick: (v: number) => string;
  xStartLabel?: string;
  xEndLabel?: string;
  marker?: { x: number; label: string } | null;
  height?: number;
}) {
  const width = 720;
  const padL = 62;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const ys = series.flatMap((item) => item.points.map((point) => point.y));
  const maxV = Math.max(0, ...ys);
  const minV = Math.min(0, ...ys);
  const basePoints = series[0]?.points ?? [];
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const spanX = xMax || 1;
  const x = (value: number) => padL + (value / spanX) * innerW;
  const y = (value: number) => padT + ((maxV - value) / (maxV - minV || 1)) * innerH;
  const ticks = [0, 1, 2, 3, 4].map((i) => minV + ((maxV - minV) * i) / 4);
  const hoverPoint = hoverIndex == null ? null : basePoints[hoverIndex] ?? null;

  const handleHover = (clientX: number, bounds: DOMRect) => {
    if (!basePoints.length) return;
    const ratio = bounds.width > 0 ? (clientX - bounds.left) / bounds.width : 0;
    const pointerX = padL + Math.min(1, Math.max(0, ratio)) * innerW;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < basePoints.length; index += 1) {
      const distance = Math.abs(x(basePoints[index].x) - pointerX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    setHoverIndex(nearestIndex);
  };

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-60 w-full min-w-[600px]">
        {ticks.map((tick, index) => (
          <g key={index}>
            <line x1={padL} y1={y(tick)} x2={width - padR} y2={y(tick)} stroke="#1e293b" strokeWidth={1} />
            <text x={padL - 6} y={y(tick) + 3} textAnchor="end" className="fill-slate-500" fontSize="10">
              {cnyTick(tick)}
            </text>
          </g>
        ))}
        <line x1={padL} y1={y(0)} x2={width - padR} y2={y(0)} stroke="#475569" strokeDasharray="4 4" />

        {marker ? (
          <g>
            <line x1={x(marker.x)} y1={padT} x2={x(marker.x)} y2={height - padB} stroke="#94a3b8" strokeDasharray="3 3" />
            <text x={x(marker.x) + 4} y={padT + 10} className="fill-slate-400" fontSize="10">
              {marker.label}
            </text>
          </g>
        ) : null}

        {series.map((item) => {
          const d = item.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.x)} ${y(point.y)}`).join(' ');
          return (
            <path
              key={item.key}
              d={d}
              fill="none"
              stroke={item.stroke}
              strokeWidth={2}
              strokeDasharray={item.dashed ? '5 4' : undefined}
            />
          );
        })}

        {hoverPoint ? (
          <g>
            <line x1={x(hoverPoint.x)} y1={padT} x2={x(hoverPoint.x)} y2={height - padB} stroke="#64748b" strokeDasharray="3 3" />
            {series.map((item) => {
              const point = item.points[hoverIndex ?? 0];
              return (
                <g key={`${item.key}-hover`}>
                  <circle cx={x(point.x)} cy={y(point.y)} r={4} fill={item.stroke} />
                  <circle cx={x(point.x)} cy={y(point.y)} r={6} fill="none" stroke={item.stroke} strokeOpacity={0.35} />
                </g>
              );
            })}
            <g transform={`translate(${Math.min(width - 176, x(hoverPoint.x) + 12)} ${padT + 8})`}>
              <rect width="164" height={28 + series.length * 18} rx="8" fill="#020617" fillOpacity="0.92" stroke="#1e293b" />
              <text x="10" y="16" className="fill-slate-300" fontSize="10">
                {xTick(hoverPoint.x)}
              </text>
              {series.map((item, index) => {
                const point = item.points[hoverIndex ?? 0];
                return (
                  <g key={`${item.key}-value`} transform={`translate(10 ${32 + index * 18})`}>
                    <circle cx="4" cy="-3" r="3" fill={item.stroke} />
                    <text x="12" y="0" className="fill-slate-400" fontSize="10">
                      {item.label}
                    </text>
                    <text x="144" y="0" textAnchor="end" className="fill-slate-200" fontSize="10">
                      ¥ {formatCny(point.y)}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        ) : null}

        <rect
          x={padL}
          y={padT}
          width={innerW}
          height={innerH}
          fill="transparent"
          onMouseMove={(e) => handleHover(e.clientX, e.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setHoverIndex(null)}
        />

        <text x={padL} y={height - 6} className="fill-slate-500" fontSize="10">
          {xStartLabel ?? xTick(0)}
        </text>
        <text x={width - padR} y={height - 6} textAnchor="end" className="fill-slate-500" fontSize="10">
          {xEndLabel ?? xTick(xMax)}
        </text>
      </svg>
    </div>
  );
}

function CurveCard({
  titleEn,
  titleCn,
  xMax,
  xTick,
  points,
  marker,
  summary,
}: {
  titleEn: string;
  titleCn: string;
  xMax: number;
  xTick: (v: number) => string;
  points: CurvePoint[];
  marker: { x: number; label: string };
  summary: React.ReactNode;
}) {
  const series: CurveSeries[] = [
    { key: 'revenue', label: '月收入', stroke: '#34d399', points: points.map((item) => ({ x: item.x, y: item.revenueCny })) },
    { key: 'cost', label: '月总成本', stroke: '#fb7185', points: points.map((item) => ({ x: item.x, y: item.totalCostCny })) },
    { key: 'net', label: '月净利', stroke: '#38bdf8', points: points.map((item) => ({ x: item.x, y: item.netCny })), dashed: true },
  ];

  return (
    <Card>
      <CardHeader
        en={titleEn}
        cn={titleCn}
        right={
          <div className="flex flex-wrap gap-3">
            {series.map((item) => (
              <span key={item.key} className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                <span
                  className="inline-block h-0 w-4 border-t-2"
                  style={{ borderColor: item.stroke, borderStyle: item.dashed ? 'dashed' : 'solid' }}
                />
                {item.label}
              </span>
            ))}
          </div>
        }
      />
      <div className="p-4">
        <FitLineChart
          series={series}
          xMax={xMax}
          xTick={xTick}
          xStartLabel={xTick(0)}
          xEndLabel={xTick(xMax)}
          marker={marker}
        />
        <div className="mt-3 text-[11px] text-slate-400">{summary}</div>
      </div>
    </Card>
  );
}

export default function ThkcosFitCurveTab({ productId, fxRate }: { productId: number; fxRate: number | null }) {
  const { data, isLoading } = useGetUnitEconomicsThkcosVarsQuery(productId);
  const [simulate] = useSimulateUnitEconomicsThkcosVarsMutation();

  const [subtab, setSubtab] = useState<FitSubtabKey>('basic_eo_origin_tiered');
  const [continuousMonthlyUsers, setContinuousMonthlyUsers] = useState(0);
  const [libraryTitles, setLibraryTitles] = useState(0);
  const [subscriberCurve, setSubscriberCurve] = useState<CurvePoint[]>([]);
  const [titleCurve, setTitleCurve] = useState<CurvePoint[]>([]);
  const [currentMetrics, setCurrentMetrics] = useState<ThkcosMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const initRef = useRef<number | null>(null);
  const requestRef = useRef(0);

  const baseVars = data?.vars ?? null;
  const activeSubtab = useMemo(() => FIT_SUBTABS.find((item) => item.key === subtab) ?? FIT_SUBTABS[0], [subtab]);
  const baseSubscriberSeed = useMemo(() => (baseVars ? basicContinuousMonthlySubsOf(baseVars) : 0), [baseVars]);
  const baseLibrarySeed = useMemo(() => (baseVars ? num(baseVars.libraryTitles) : 0), [baseVars]);

  useEffect(() => {
    if (!baseVars || initRef.current === productId) return;
    initRef.current = productId;
    setContinuousMonthlyUsers(baseSubscriberSeed);
    setLibraryTitles(baseLibrarySeed);
  }, [baseLibrarySeed, baseSubscriberSeed, baseVars, productId]);

  const subscriberMax = useMemo(
    () => niceMax(Math.max(baseSubscriberSeed, continuousMonthlyUsers, 50) * 2),
    [baseSubscriberSeed, continuousMonthlyUsers]
  );
  const titleMax = useMemo(() => niceMax(Math.max(baseLibrarySeed, libraryTitles, 50) * 2), [baseLibrarySeed, libraryTitles]);

  useEffect(() => {
    if (!baseVars) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const timer = setTimeout(async () => {
      setPending(true);
      setError(null);

      const callSimulation = async (vars: ThkcosVars) => {
        const res = await simulate({ productId, vars }).unwrap();
        return res.results.neutral;
      };

      const subscriberSamples = buildSamples(subscriberMax, continuousMonthlyUsers);
      const titleSamples = buildSamples(titleMax, libraryTitles);

      try {
        const [subscriberMetrics, titleMetrics, current] = await Promise.all([
          Promise.all(
            subscriberSamples.map(async (count) => ({
              x: count,
              metrics: await callSimulation(buildScenarioVars(baseVars, count, libraryTitles, subtab)),
            }))
          ),
          Promise.all(
            titleSamples.map(async (count) => ({
              x: count,
              metrics: await callSimulation(buildScenarioVars(baseVars, continuousMonthlyUsers, count, subtab)),
            }))
          ),
          callSimulation(buildScenarioVars(baseVars, continuousMonthlyUsers, libraryTitles, subtab)),
        ]);

        if (requestRef.current !== requestId) return;

        setSubscriberCurve(
          subscriberMetrics.map(({ x, metrics }) => ({
            x,
            revenueCny: metrics.revenueCny,
            totalCostCny: metrics.totalCostCny,
            netCny: metrics.netCny,
          }))
        );
        setTitleCurve(
          titleMetrics.map(({ x, metrics }) => ({
            x,
            revenueCny: metrics.revenueCny,
            totalCostCny: metrics.totalCostCny,
            netCny: metrics.netCny,
          }))
        );
        setCurrentMetrics(current);
      } catch (e) {
        if (requestRef.current !== requestId) return;
        setError(extractErrorMessage(e));
      } finally {
        if (requestRef.current === requestId) setPending(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [baseVars, continuousMonthlyUsers, libraryTitles, productId, simulate, subscriberMax, subtab, titleMax]);

  if (isLoading) return <Empty text="加载拟合曲线…" />;
  if (!baseVars) return <Empty text="暂无 THKCOS 参数，无法生成拟合曲线" />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-[11px] leading-relaxed text-slate-400">
        基于当前产品最近保存的 <span className="text-slate-200">cf&THKCOS 全变量参数</span> 做中性口径拟合。此页固定其余变量，只调整
        <span className="text-slate-200">「基础会员连续包月用户数」</span> 与 <span className="text-slate-200">「片库影片数」</span>；
        拟合中仅计算 <span className="text-slate-200">基础会员连续包月</span>，并固定
        <span className="text-slate-200">基础用户观看人数 = 基础会员连续包月用户数</span>。
        <span className="text-slate-200">体验卡 / 普通月卡 / VIP / 季卡 / 年卡 / 高级会员</span> 在此页均按 0 处理。
        当前子场景固定为 <span className="text-slate-200">{activeSubtab.cn}</span>。
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-300">{error}</div>
      ) : null}

      <div className="border-b border-slate-800">
        <div className="flex flex-wrap gap-1">
          {FIT_SUBTABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSubtab(item.key)}
              className={`-mb-px border-b-2 px-4 py-2 text-xs font-medium transition ${
                subtab === item.key
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.cn}
            </button>
          ))}
        </div>
      </div>

      {FIT_SUBTABS.some((item) => item.key === subtab) ? (
        <>
          {currentMetrics ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Card className="p-4">
                <div className="text-sm font-semibold text-emerald-400">Monthly Revenue</div>
                <div className="mb-2 text-[11px] text-slate-500">月收入</div>
                <Money cny={currentMetrics.revenueCny} usd={fxRate ? currentMetrics.revenueCny / fxRate : null} size="lg" mainClass="text-emerald-400" />
              </Card>
              <Card className="p-4">
                <div className="text-sm font-semibold text-rose-400">Monthly Cost</div>
                <div className="mb-2 text-[11px] text-slate-500">月总成本</div>
                <Money cny={currentMetrics.totalCostCny} usd={fxRate ? currentMetrics.totalCostCny / fxRate : null} size="lg" mainClass="text-rose-400" />
              </Card>
              <Card className="p-4">
                <div className={`text-sm font-semibold ${currentMetrics.netCny >= 0 ? 'text-emerald-400' : 'text-sky-400'}`}>Monthly Net</div>
                <div className="mb-2 text-[11px] text-slate-500">月净利</div>
                <Money
                  cny={currentMetrics.netCny}
                  usd={fxRate ? currentMetrics.netCny / fxRate : null}
                  size="lg"
                  mainClass={currentMetrics.netCny >= 0 ? 'text-emerald-400' : 'text-sky-400'}
                />
              </Card>
              <Card className="p-4">
                <div className="text-sm font-semibold text-sky-400">Break-even Subs</div>
                <div className="mb-2 text-[11px] text-slate-500">盈亏平衡基础会员连续包月用户数</div>
                <div className="text-xl font-semibold tabular-nums text-sky-400">
                  {currentMetrics.negativeUnitEconomics
                    ? '不可达'
                    : currentMetrics.breakEvenViewers != null
                      ? `${formatInt(currentMetrics.breakEvenViewers)} 人`
                      : '—'}
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-sm font-semibold text-amber-400">Break-even Library</div>
                <div className="mb-2 text-[11px] text-slate-500">盈亏平衡片库规模</div>
                <div className="text-xl font-semibold tabular-nums text-amber-400">
                  {currentMetrics.breakEvenTitles != null ? `${formatInt(currentMetrics.breakEvenTitles)} 部` : '—'}
                </div>
              </Card>
            </div>
          ) : null}

          {subscriberCurve.length > 0 || titleCurve.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {subscriberCurve.length > 0 ? (
                <CurveCard
                  titleEn="Subscriber Fit Curve"
                  titleCn="拟合曲线 · X 轴 = 基础会员连续包月用户数"
                  xMax={subscriberMax}
                  xTick={(v) => `${formatInt(v)} 人`}
                  points={subscriberCurve}
                  marker={{ x: continuousMonthlyUsers, label: `当前 ${formatInt(continuousMonthlyUsers)} 人` }}
                  summary={
                    <>
                      在当前片库规模 <span className="text-slate-200">{formatInt(libraryTitles)} 部</span> 下，收入随基础会员连续包月用户数增长，
                      成本同时叠加流量支出。此图中体验卡、普通月卡、VIP、季卡、年卡与高级会员收入及流量均按 0 处理。
                    </>
                  }
                />
              ) : null}

              {titleCurve.length > 0 ? (
                <CurveCard
                  titleEn="Library Fit Curve"
                  titleCn="拟合曲线 · X 轴 = 片库影片数"
                  xMax={titleMax}
                  xTick={(v) => `${formatInt(v)} 部`}
                  points={titleCurve}
                  marker={{ x: libraryTitles, label: `当前 ${formatInt(libraryTitles)} 部` }}
                  summary={
                    <>
                      在当前基础会员连续包月用户数 <span className="text-slate-200">{formatInt(continuousMonthlyUsers)} 人</span> 下，片库规模主要通过
                      R2 + COS 双副本存储成本影响总成本，收入保持不变，因此净利会随片库规模呈近线性变化。
                    </>
                  }
                />
              ) : null}
            </div>
          ) : null}

          <Card>
            <CardHeader
              en="Controls"
              cn="影响因子"
              right={<span className="text-[11px] text-slate-500">{pending ? '正在重算曲线…' : '拖动滑杆即时刷新'}</span>}
            />
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <Field label="基础会员连续包月用户数" hint="Basic continuous monthly only">
                <div className="space-y-2">
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={String(continuousMonthlyUsers)}
                      onChange={(e) => setContinuousMonthlyUsers(Math.max(0, Number(e.target.value) || 0))}
                      className="pr-12"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">人</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={subscriberMax}
                    step="1"
                    value={continuousMonthlyUsers}
                    onChange={(e) => setContinuousMonthlyUsers(Number(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>0</span>
                    <span>{formatInt(subscriberMax)} 人</span>
                  </div>
                </div>
              </Field>

              <Field label="片库影片数" hint="Library titles">
                <div className="space-y-2">
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={String(libraryTitles)}
                      onChange={(e) => setLibraryTitles(Math.max(0, Number(e.target.value) || 0))}
                      className="pr-12"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">部</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={titleMax}
                    step="1"
                    value={libraryTitles}
                    onChange={(e) => setLibraryTitles(Number(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>0</span>
                    <span>{formatInt(titleMax)} 部</span>
                  </div>
                </div>
              </Field>
            </div>
          </Card>

          {currentMetrics ? (
            <Card>
              <CardHeader en="Current Assumptions" cn="当前采用口径" />
              <div className="grid gap-3 p-4 text-[11px] text-slate-400 md:grid-cols-3">
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                  <div className="mb-1 text-slate-200">流量链路</div>
                  <div>{activeSubtab.trafficMode === 'cdn' ? '经 EO · 边缘下行 + 回源' : 'COS 直连外网下行'}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                  <div className="mb-1 text-slate-200">计价模式</div>
                  <div>{activeSubtab.pricingLabel}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                  <div className="mb-1 text-slate-200">EO 缓存命中率</div>
                  <div>{activeSubtab.trafficMode === 'cdn' ? `${((num(baseVars.cacheHitRatio) || 0) * 100).toFixed(0)}%` : '不适用'}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                  <div className="mb-1 text-slate-200">资源包价格档</div>
                  <div>{activeSubtab.packagePriceLabel}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                  <div className="mb-1 text-slate-200">当前基础用户流量成本</div>
                  <div>¥ {formatCny(currentMetrics.trafficPerViewerCny)} / 人</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                  <div className="mb-1 text-slate-200">当前综合流量单价</div>
                  <div>¥ {formatCny(currentMetrics.blendedPerTbCny)} / TB</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                  <div className="mb-1 text-slate-200">当前总流量</div>
                  <div>{formatInt(currentMetrics.trafficTb)} TB / 月</div>
                </div>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
