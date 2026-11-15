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

function sumBasicSubs(vars: ThkcosVars) {
  return num(vars.basicMonthlySubs) + num(vars.basicQuarterlySubs) + num(vars.basicYearlySubs);
}

function sumAllSubs(vars: ThkcosVars) {
  return (
    num(vars.basicMonthlySubs) +
    num(vars.basicQuarterlySubs) +
    num(vars.basicYearlySubs) +
    num(vars.premiumMonthlySubs) +
    num(vars.premiumQuarterlySubs) +
    num(vars.premiumYearlySubs)
  );
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

function scaleBasicMix(targetSubscribers: number, vars: ThkcosVars): [number, number, number] {
  const target = Math.max(0, Math.round(targetSubscribers));
  const base = [num(vars.basicMonthlySubs), num(vars.basicQuarterlySubs), num(vars.basicYearlySubs)];
  const total = base[0] + base[1] + base[2];
  const weights = total > 0 ? base.map((item) => item / total) : [1, 0, 0];
  const raw = weights.map((w) => w * target);
  const floor = raw.map((item) => Math.floor(item));
  let rest = target - floor.reduce((sum, item) => sum + item, 0);
  const rank = raw
    .map((item, index) => ({ index, frac: item - floor[index] }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < rank.length && rest > 0; i += 1) {
    floor[rank[i].index] += 1;
    rest -= 1;
  }
  return [floor[0] ?? 0, floor[1] ?? 0, floor[2] ?? 0];
}

function buildScenarioVars(
  base: ThkcosVars,
  basicSubscribers: number,
  libraryTitles: number,
  subtab: FitSubtabKey
): ThkcosVars {
  const config = FIT_SUBTABS.find((item) => item.key === subtab) ?? FIT_SUBTABS[0];
  const [basicMonthlySubs, basicQuarterlySubs, basicYearlySubs] = scaleBasicMix(basicSubscribers, base);
  const viewers = Math.max(0, Math.round(basicSubscribers));
  return {
    ...base,
    trafficMode: config.trafficMode,
    cdnPricingMode: config.cdnPricingMode,
    cdnPackagePrice: config.cdnPackagePrice,
    libraryTitles: Math.max(0, Math.round(libraryTitles)),
    basicViewers: viewers,
    premiumViewers: 0,
    basicMonthlySubs,
    basicQuarterlySubs,
    basicYearlySubs,
    premiumMonthlySubs: 0,
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
  const spanX = xMax || 1;
  const x = (value: number) => padL + (value / spanX) * innerW;
  const y = (value: number) => padT + ((maxV - value) / (maxV - minV || 1)) * innerH;
  const ticks = [0, 1, 2, 3, 4].map((i) => minV + ((maxV - minV) * i) / 4);

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
  const [basicSubscribers, setBasicSubscribers] = useState(0);
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
  const baseSubscriberSeed = useMemo(() => (baseVars ? sumAllSubs(baseVars) : 0), [baseVars]);
  const baseLibrarySeed = useMemo(() => (baseVars ? num(baseVars.libraryTitles) : 0), [baseVars]);

  useEffect(() => {
    if (!baseVars || initRef.current === productId) return;
    initRef.current = productId;
    setBasicSubscribers(baseSubscriberSeed);
    setLibraryTitles(baseLibrarySeed);
  }, [baseLibrarySeed, baseSubscriberSeed, baseVars, productId]);

  const subscriberMax = useMemo(
    () => niceMax(Math.max(baseSubscriberSeed, basicSubscribers, 50) * 2),
    [baseSubscriberSeed, basicSubscribers]
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

      const subscriberSamples = buildSamples(subscriberMax, basicSubscribers);
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
              metrics: await callSimulation(buildScenarioVars(baseVars, basicSubscribers, count, subtab)),
            }))
          ),
          callSimulation(buildScenarioVars(baseVars, basicSubscribers, libraryTitles, subtab)),
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
  }, [baseVars, basicSubscribers, libraryTitles, productId, simulate, subscriberMax, subtab, titleMax]);

  const currentBasicMix = useMemo(() => {
    if (!baseVars) return '月卡 100%';
    const total = sumBasicSubs(baseVars);
    const month = total > 0 ? (num(baseVars.basicMonthlySubs) / total) * 100 : 100;
    const quarter = total > 0 ? (num(baseVars.basicQuarterlySubs) / total) * 100 : 0;
    const year = total > 0 ? (num(baseVars.basicYearlySubs) / total) * 100 : 0;
    return `月卡 ${month.toFixed(0)}% · 季卡 ${quarter.toFixed(0)}% · 年卡 ${year.toFixed(0)}%`;
  }, [baseVars]);

  if (isLoading) return <Empty text="加载拟合曲线…" />;
  if (!baseVars) return <Empty text="暂无 THKCOS 参数，无法生成拟合曲线" />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-[11px] leading-relaxed text-slate-400">
        基于当前产品最近保存的 <span className="text-slate-200">cf&THKCOS 全变量参数</span> 做中性口径拟合。此页固定其余变量，只调整
        <span className="text-slate-200">「基础订阅用户数」</span> 与 <span className="text-slate-200">「片库影片数」</span>；
        默认假设全部订阅用户均为基础会员，且 <span className="text-slate-200">基础用户观看人数 = 基础会员订阅人数</span>。
        当前子场景固定为 <span className="text-slate-200">{activeSubtab.cn}</span>，基础会员订阅结构按当前基础会员配比缩放：
        <span className="text-slate-200">{currentBasicMix}</span>。
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
                <div className="mb-2 text-[11px] text-slate-500">盈亏平衡基础订阅人数</div>
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
                  titleCn="拟合曲线 · X 轴 = 基础订阅用户数"
                  xMax={subscriberMax}
                  xTick={(v) => `${formatInt(v)} 人`}
                  points={subscriberCurve}
                  marker={{ x: basicSubscribers, label: `当前 ${formatInt(basicSubscribers)} 人` }}
                  summary={
                    <>
                      在当前片库规模 <span className="text-slate-200">{formatInt(libraryTitles)} 部</span> 下，收入随基础订阅用户数增长，
                      成本同时叠加流量支出。此图中高级会员收入与观看流量均按 0 处理。
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
                      在当前基础订阅用户数 <span className="text-slate-200">{formatInt(basicSubscribers)} 人</span> 下，片库规模主要通过
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
              <Field label="基础订阅用户数" hint="All subscribers are basic">
                <div className="space-y-2">
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={String(basicSubscribers)}
                      onChange={(e) => setBasicSubscribers(Math.max(0, Number(e.target.value) || 0))}
                      className="pr-12"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">人</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={subscriberMax}
                    step="1"
                    value={basicSubscribers}
                    onChange={(e) => setBasicSubscribers(Number(e.target.value))}
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
