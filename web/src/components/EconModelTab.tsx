import { useEffect, useMemo, useRef, useState } from 'react';
import {
  extractErrorMessage,
  useGetUnitEconomicsEconVarsQuery,
  useGetUnitEconomicsEconVarsSnapshotsQuery,
  useLazyGetUnitEconomicsEconVarsSnapshotQuery,
  useDeleteUnitEconomicsEconVarsSnapshotMutation,
  useSaveUnitEconomicsEconVarsMutation,
  useSimulateUnitEconomicsEconVarsMutation,
  type EconMetrics,
  type EconPayload,
  type EconScenarioKey,
  type EconSensitivityRow,
  type CdnTier,
  type CdnPackage,
  type CdnPricingMode,
  type CdnPackagePrice,
  type EconVars,
} from '../api';
import { Card, CardHeader, Empty } from './Card';
import { Button, Field, Input, Select } from './Field';
import { Money } from './Money';
import { formatCny, formatInt, formatRate } from '../lib/format';

/* ------------------------------------------------------------------ */
/* 情景元数据                                                          */
/* ------------------------------------------------------------------ */

const SCEN: { key: EconScenarioKey; cn: string; en: string; stroke: string; accent: string }[] = [
  { key: 'neutral', cn: '中性', en: 'Neutral', stroke: '#38bdf8', accent: 'text-sky-400' },
  { key: 'optimistic', cn: '乐观', en: 'Optimistic', stroke: '#34d399', accent: 'text-emerald-400' },
  { key: 'pessimistic', cn: '悲观', en: 'Pessimistic', stroke: '#fb7185', accent: 'text-rose-400' },
];

/* ------------------------------------------------------------------ */
/* 编辑态：所有输入以字符串承载，百分比按人类习惯录入（5 = 5%）            */
/* ------------------------------------------------------------------ */

type Draft = {
  vultrMonthlyCny: string;
  domainAnnualCny: string;
  sslAnnualCny: string;
  r2StoragePerGbCny: string;
  r2ClassAMonthlyCny: string;
  libraryTitles: string;
  avgTitleGb: string;
  /** 单档兜底价（历史快照沿用；UI 改为编辑阶梯后不再直接输入） */
  cdnTier1PerTbCny: string;
  cdnTier2PerTbCny: string;
  /** 固定 5 档单价（字符串，与 CDN_TIER_BOUNDS 一一对应） */
  cdnTier1Prices: string[];
  cdnTier2Prices: string[];
  /** CDN 计价模式与资源包价格档 */
  cdnPricingMode: CdnPricingMode;
  cdnPackagePrice: CdnPackagePrice;
  /** 资源包 6 档价格（字符串，与 CDN_PACKAGE_BOUNDS 一一对应） */
  cdnTier1ListPrices: string[];
  cdnTier1RenewPrices: string[];
  cdnTier2ListPrices: string[];
  cdnTier2RenewPrices: string[];
  tier1SharePct: string;
  regularViewers: string;
  heavyViewers: string;
  regularMinutesPerViewer: string;
  heavyMinutesPerViewer: string;
  regularPerMinMbLow: string;
  heavyPerMinMbLow: string;
  regularPerMinMbHigh: string;
  heavyPerMinMbHigh: string;
  monthlySubs: string;
  monthlyPriceCny: string;
  quarterlySubs: string;
  quarterlyPriceCny: string;
  yearlySubs: string;
  yearlyPriceCny: string;
  viewerGrowthPct: string;
  subscriberGrowthPct: string;
  horizonMonths: string;
};

const numStr = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const pctStr = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : String(Math.round(v * 10000) / 100);
const parseNum = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const parsePct = (s: string): number | null => {
  const n = parseNum(s);
  return n === null ? null : n / 100;
};

/* ------------------------------------------------------------------ */
/* CDN 阶梯：固定 5 档，仅单价可调（腾讯云「月度阶梯累进」口径）            */
/* ------------------------------------------------------------------ */

/** 档位边界（upToTb = null 表示无上限的末档）。 */
const CDN_TIER_BOUNDS: { upToTb: number | null; label: string }[] = [
  { upToTb: 2, label: '0–2 TB' },
  { upToTb: 10, label: '2–10 TB' },
  { upToTb: 50, label: '10–50 TB' },
  { upToTb: 100, label: '50–100 TB' },
  { upToTb: null, label: '≥100 TB' },
];

/** 腾讯云 CDN 流量刊例价（¥/TB）：境外亚太一区 / 亚太二区。 */
const TENCENT_LIST_PRICE = {
  tier1: ['460', '410', '370', '330', '310'],
  tier2: ['550', '510', '470', '410', '350'],
};

/** 阶梯数组 → 5 个字符串单价（不足处补空）。 */
function tiersToPrices(tiers: CdnTier[] | null | undefined): string[] {
  return CDN_TIER_BOUNDS.map((_, i) => numStr(tiers?.[i]?.pricePerTbCny));
}

/** 5 个字符串单价 → 阶梯数组（全空视为「未启用阶梯」，回落单档价）。 */
function pricesToTiers(prices: string[]): CdnTier[] | null {
  const parsed = prices.map((p) => parseNum(p));
  if (parsed.every((p) => p === null)) return null;
  return CDN_TIER_BOUNDS.map((b, i) => ({ upToTb: b.upToTb, pricePerTbCny: parsed[i] ?? 0 }));
}

/* ------------------------------------------------------------------ */
/* CDN 资源包：固定 6 档容量，可编辑「刊例价 / 续订价」两套价格             */
/* ------------------------------------------------------------------ */

/** 资源包档位容量（GB，与腾讯云「预付费流量包」一致）。 */
const CDN_PACKAGE_BOUNDS: { sizeGb: number; label: string }[] = [
  { sizeGb: 100, label: '100 GB' },
  { sizeGb: 500, label: '500 GB' },
  { sizeGb: 1000, label: '1 TB' },
  { sizeGb: 5000, label: '5 TB' },
  { sizeGb: 10000, label: '10 TB' },
  { sizeGb: 50000, label: '50 TB' },
];

/** 腾讯云 CDN 流量包价格（¥/包）：单次购买刊例价 / 连续包月自动续订价。 */
const TENCENT_PACKAGE_PRICE = {
  tier1: {
    list: ['46', '230', '460', '2150', '4200', '19000'],
    renew: ['42.80', '209.00', '413.30', '1995.00', '3895.00', '17575.00'],
  },
  tier2: {
    list: ['55', '275', '550', '2630', '5180', '23980'],
    renew: ['51.30', '228.00', '446.50', '2042.50', '3990.00', '19475.00'],
  },
};

/** 资源包数组 → 6 个字符串价格（按 list / renew 取值，不足处补空）。 */
function packagesToPrices(pkgs: CdnPackage[] | null | undefined, key: 'listCny' | 'renewCny'): string[] {
  return CDN_PACKAGE_BOUNDS.map((_, i) => numStr(pkgs?.[i]?.[key]));
}

/** 两套字符串价格 → 资源包数组（两套全空视为「未配置」，返回 null）。 */
function pricesToPackages(list: string[], renew: string[]): CdnPackage[] | null {
  const l = list.map((p) => parseNum(p));
  const r = renew.map((p) => parseNum(p));
  if (l.every((p) => p === null) && r.every((p) => p === null)) return null;
  return CDN_PACKAGE_BOUNDS.map((b, i) => ({ sizeGb: b.sizeGb, listCny: l[i] ?? 0, renewCny: r[i] ?? 0 }));
}

function toDraft(v: EconVars): Draft {
  return {
    vultrMonthlyCny: numStr(v.vultrMonthlyCny),
    domainAnnualCny: numStr(v.domainAnnualCny),
    sslAnnualCny: numStr(v.sslAnnualCny),
    r2StoragePerGbCny: numStr(v.r2StoragePerGbCny),
    r2ClassAMonthlyCny: numStr(v.r2ClassAMonthlyCny),
    libraryTitles: numStr(v.libraryTitles),
    avgTitleGb: numStr(v.avgTitleGb),
    cdnTier1PerTbCny: numStr(v.cdnTier1PerTbCny),
    cdnTier2PerTbCny: numStr(v.cdnTier2PerTbCny),
    cdnTier1Prices: tiersToPrices(v.cdnTier1Tiers),
    cdnTier2Prices: tiersToPrices(v.cdnTier2Tiers),
    cdnPricingMode: v.cdnPricingMode ?? 'tiered',
    cdnPackagePrice: v.cdnPackagePrice ?? 'renew',
    cdnTier1ListPrices: packagesToPrices(v.cdnTier1Packages, 'listCny'),
    cdnTier1RenewPrices: packagesToPrices(v.cdnTier1Packages, 'renewCny'),
    cdnTier2ListPrices: packagesToPrices(v.cdnTier2Packages, 'listCny'),
    cdnTier2RenewPrices: packagesToPrices(v.cdnTier2Packages, 'renewCny'),
    tier1SharePct: pctStr(v.tier1Share),
    regularViewers: numStr(v.regularViewers),
    heavyViewers: numStr(v.heavyViewers),
    regularMinutesPerViewer: numStr(v.regularMinutesPerViewer),
    heavyMinutesPerViewer: numStr(v.heavyMinutesPerViewer),
    regularPerMinMbLow: numStr(v.regularPerMinMbLow),
    heavyPerMinMbLow: numStr(v.heavyPerMinMbLow),
    regularPerMinMbHigh: numStr(v.regularPerMinMbHigh),
    heavyPerMinMbHigh: numStr(v.heavyPerMinMbHigh),
    monthlySubs: numStr(v.monthlySubs),
    monthlyPriceCny: numStr(v.monthlyPriceCny),
    quarterlySubs: numStr(v.quarterlySubs),
    quarterlyPriceCny: numStr(v.quarterlyPriceCny),
    yearlySubs: numStr(v.yearlySubs),
    yearlyPriceCny: numStr(v.yearlyPriceCny),
    viewerGrowthPct: pctStr(v.viewerGrowth),
    subscriberGrowthPct: pctStr(v.subscriberGrowth),
    horizonMonths: String(v.horizonMonths ?? 24),
  };
}

/** 全量转回变量（发送完整字段，避免后端按 null 覆盖其它字段）。 */
function draftToVars(d: Draft): EconVars {
  const tier1 = pricesToTiers(d.cdnTier1Prices);
  const tier2 = pricesToTiers(d.cdnTier2Prices);
  const pkg1 = pricesToPackages(d.cdnTier1ListPrices, d.cdnTier1RenewPrices);
  const pkg2 = pricesToPackages(d.cdnTier2ListPrices, d.cdnTier2RenewPrices);
  return {
    vultrMonthlyCny: parseNum(d.vultrMonthlyCny),
    domainAnnualCny: parseNum(d.domainAnnualCny),
    sslAnnualCny: parseNum(d.sslAnnualCny),
    r2StoragePerGbCny: parseNum(d.r2StoragePerGbCny),
    r2ClassAMonthlyCny: parseNum(d.r2ClassAMonthlyCny),
    libraryTitles: parseNum(d.libraryTitles),
    avgTitleGb: parseNum(d.avgTitleGb),
    // 有阶梯时以首档价作为「单档兜底价」，保证无阶梯的历史口径仍可复现
    cdnTier1PerTbCny: tier1 ? tier1[0].pricePerTbCny : parseNum(d.cdnTier1PerTbCny),
    cdnTier2PerTbCny: tier2 ? tier2[0].pricePerTbCny : parseNum(d.cdnTier2PerTbCny),
    cdnTier1Tiers: tier1,
    cdnTier2Tiers: tier2,
    cdnPricingMode: d.cdnPricingMode,
    cdnPackagePrice: d.cdnPackagePrice,
    cdnTier1Packages: pkg1,
    cdnTier2Packages: pkg2,
    tier1Share: parsePct(d.tier1SharePct),
    regularViewers: parseNum(d.regularViewers),
    heavyViewers: parseNum(d.heavyViewers),
    regularMinutesPerViewer: parseNum(d.regularMinutesPerViewer),
    heavyMinutesPerViewer: parseNum(d.heavyMinutesPerViewer),
    regularPerMinMbLow: parseNum(d.regularPerMinMbLow),
    heavyPerMinMbLow: parseNum(d.heavyPerMinMbLow),
    regularPerMinMbHigh: parseNum(d.regularPerMinMbHigh),
    heavyPerMinMbHigh: parseNum(d.heavyPerMinMbHigh),
    monthlySubs: parseNum(d.monthlySubs),
    monthlyPriceCny: parseNum(d.monthlyPriceCny),
    quarterlySubs: parseNum(d.quarterlySubs),
    quarterlyPriceCny: parseNum(d.quarterlyPriceCny),
    yearlySubs: parseNum(d.yearlySubs),
    yearlyPriceCny: parseNum(d.yearlyPriceCny),
    viewerGrowth: parsePct(d.viewerGrowthPct),
    subscriberGrowth: parsePct(d.subscriberGrowthPct),
    horizonMonths: parseNum(d.horizonMonths) ?? 24,
  };
}

const EMPTY_VARS: EconVars = {
  vultrMonthlyCny: null,
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
  cdnPricingMode: 'tiered',
  cdnPackagePrice: 'renew',
  cdnTier1Packages: null,
  cdnTier2Packages: null,
  tier1Share: null,
  regularViewers: null,
  heavyViewers: null,
  regularMinutesPerViewer: null,
  heavyMinutesPerViewer: null,
  regularPerMinMbLow: null,
  heavyPerMinMbLow: null,
  regularPerMinMbHigh: null,
  heavyPerMinMbHigh: null,
  monthlySubs: null,
  monthlyPriceCny: null,
  quarterlySubs: null,
  quarterlyPriceCny: null,
  yearlySubs: null,
  yearlyPriceCny: null,
  viewerGrowth: null,
  subscriberGrowth: null,
  horizonMonths: 24,
};

/* ------------------------------------------------------------------ */
/* 输入分组定义                                                        */
/* ------------------------------------------------------------------ */

type FieldDef = {
  key: keyof Draft;
  label: string;
  hint?: string;
  unit?: string;
  step?: string;
  placeholder?: string;
  /** 整卡实收倍数（季卡 ×3 / 年卡 ×12）：在输入框内 ¥ 左侧显示「单价 × 倍数」的实收金额。 */
  mult?: number;
};

const GROUPS: { cn: string; en: string; fields: FieldDef[] }[] = [
  {
    cn: '基础设施（固定成本）',
    en: 'Infrastructure',
    fields: [
      { key: 'vultrMonthlyCny', label: 'A · Vultr 月租', hint: 'Cloud Host', unit: '¥/月', placeholder: '如 240' },
      { key: 'domainAnnualCny', label: '域名年费', hint: 'Domain', unit: '¥/年', placeholder: '如 70' },
      { key: 'sslAnnualCny', label: 'SSL 证书年费', hint: 'SSL Cert', unit: '¥/年', placeholder: '如 0' },
    ],
  },
  {
    cn: 'R2 对象存储',
    en: 'R2 Storage',
    fields: [
      { key: 'r2StoragePerGbCny', label: 'B · 每 GB 存储单价', hint: 'R2 ¥/GB·月', unit: '¥/GB', step: '0.0001', placeholder: '如 0.0107' },
      { key: 'r2ClassAMonthlyCny', label: 'C · Class A 操作费', hint: '每月', unit: '¥/月', placeholder: '如 5' },
      { key: 'libraryTitles', label: 'D · 片库影片数', hint: 'Library', unit: '部', placeholder: '如 2000' },
      { key: 'avgTitleGb', label: 'E · 单片体积', hint: 'GB / Title', unit: 'GB', step: '0.1', placeholder: '如 6' },
    ],
  },
  {
    cn: 'CDN 流量（腾讯云香港）',
    en: 'CDN Traffic',
    fields: [
      { key: 'tier1SharePct', label: 'α · 亚太一区占比', hint: '余下走二区', unit: '%', step: '0.1', placeholder: '如 80' },
      { key: 'regularViewers', label: 'H1 · 普通用户月观看人数', hint: 'Regular Viewers', unit: '人', placeholder: '如 4000' },
      { key: 'regularMinutesPerViewer', label: 'I1 · 普通用户人均月观影', hint: 'Min / Viewer', unit: '分钟', step: '1', placeholder: '如 480' },
      { key: 'regularPerMinMbLow', label: 'J1 · 普通用户每分钟流量下限', hint: '乐观取下限', unit: 'MB', step: '0.1', placeholder: '如 10' },
      { key: 'regularPerMinMbHigh', label: 'K1 · 普通用户每分钟流量上限', hint: '悲观取上限', unit: 'MB', step: '0.1', placeholder: '如 20' },
      { key: 'heavyViewers', label: 'H2 · 重度用户月观看人数', hint: 'Heavy Viewers', unit: '人', placeholder: '如 1000' },
      { key: 'heavyMinutesPerViewer', label: 'I2 · 重度用户人均月观影', hint: 'Min / Viewer', unit: '分钟', step: '1', placeholder: '如 1800' },
      { key: 'heavyPerMinMbLow', label: 'J2 · 重度用户每分钟流量下限', hint: '乐观取下限', unit: 'MB', step: '0.1', placeholder: '如 14' },
      { key: 'heavyPerMinMbHigh', label: 'K2 · 重度用户每分钟流量上限', hint: '悲观取上限', unit: 'MB', step: '0.1', placeholder: '如 25' },
    ],
  },
  {
    cn: '订阅收入（月度确认口径）',
    en: 'Subscription Revenue',
    fields: [
      { key: 'monthlySubs', label: 'L1 · 月卡订阅人数', hint: 'Monthly', unit: '人', placeholder: '如 800' },
      { key: 'monthlyPriceCny', label: 'M1 · 月卡单价', hint: '¥/月', unit: '¥', placeholder: '如 30' },
      { key: 'quarterlySubs', label: 'L2 · 季卡订阅人数', hint: '实收 ×3', unit: '人', placeholder: '如 300' },
      { key: 'quarterlyPriceCny', label: 'M2 · 季卡单价', hint: '¥/月 × 3', unit: '¥', placeholder: '如 25', mult: 3 },
      { key: 'yearlySubs', label: 'L3 · 年卡订阅人数', hint: '实收 ×12', unit: '人', placeholder: '如 200' },
      { key: 'yearlyPriceCny', label: 'M3 · 年卡单价', hint: '¥/月 × 12', unit: '¥', placeholder: '如 20', mult: 12 },
    ],
  },
  {
    cn: '推演参数',
    en: 'Projection',
    fields: [
      { key: 'viewerGrowthPct', label: '观看人数月增长', hint: 'Net Growth', unit: '%', step: '0.1', placeholder: '如 3' },
      { key: 'subscriberGrowthPct', label: '订阅人数月增长', hint: 'Net Growth', unit: '%', step: '0.1', placeholder: '如 2' },
    ],
  },
];

/** 整数/小数统一两位千分位（用于流量等物理量展示）。 */
const fmtQty = (v: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

/** 统一展示保存日期（后端返回本地时间字符串 YYYY-MM-DD HH:MM:SS）。 */
const fmtSavedAt = (v: string | null) => (v ? v.slice(0, 16) : '—');

/** 每分钟流量区间（未填一侧时以另一侧兜底，保证 low ≤ high）。 */
function mbRange(low: number | null, high: number | null): { low: number; high: number } {
  const j = low != null && low > 0 ? low : high ?? 0;
  const k = high != null && high > 0 ? high : low ?? 0;
  return j <= k ? { low: j, high: k } : { low: k, high: j };
}

/* ------------------------------------------------------------------ */
/* 折线图（纯 SVG，无第三方依赖）                                        */
/* ------------------------------------------------------------------ */

type LineSeries = {
  key: string;
  label: string;
  stroke: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
};

function cnyTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 10000) return `${(v / 10000).toFixed(1)}万`;
  if (a >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(0);
}

function EconLineChart({
  series,
  xMax,
  xMin = 0,
  xTick,
  xStartLabel,
  xEndLabel,
  marker,
  formatY = cnyTick,
  height = 240,
}: {
  series: LineSeries[];
  xMax: number;
  xMin?: number;
  xTick: (v: number) => string;
  xStartLabel?: string;
  xEndLabel?: string;
  marker?: { x: number; label: string } | null;
  formatY?: (v: number) => string;
  height?: number;
}) {
  const width = 720;
  const padL = 62;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  const maxV = Math.max(0, ...ys);
  const minV = Math.min(0, ...ys);
  const spanX = xMax - xMin || 1;
  const x = (v: number) => padL + ((v - xMin) / spanX) * innerW;
  const y = (v: number) => padT + ((maxV - v) / (maxV - minV || 1)) * innerH;
  const zeroY = y(0);

  const ticks = [0, 1, 2, 3, 4].map((i) => minV + ((maxV - minV) * i) / 4);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-60 w-full min-w-[600px]">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={y(t)} x2={width - padR} y2={y(t)} stroke="#1e293b" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-500" fontSize="10">
              {formatY(t)}
            </text>
          </g>
        ))}
        {/* 零轴 */}
        <line x1={padL} y1={zeroY} x2={width - padR} y2={zeroY} stroke="#475569" strokeDasharray="4 4" />

        {marker ? (
          <g>
            <line x1={x(marker.x)} y1={padT} x2={x(marker.x)} y2={height - padB} stroke="#94a3b8" strokeDasharray="3 3" />
            <text x={x(marker.x) + 4} y={padT + 10} className="fill-slate-400" fontSize="10">
              {marker.label}
            </text>
          </g>
        ) : null}

        {series.map((s) => {
          const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.x)} ${y(p.y)}`).join(' ');
          return (
            <path
              key={s.key}
              d={d}
              fill="none"
              stroke={s.stroke}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '5 4' : undefined}
            />
          );
        })}

        <text x={padL} y={height - 6} className="fill-slate-500" fontSize="10">
          {xStartLabel ?? xTick(xMin)}
        </text>
        <text x={width - padR} y={height - 6} textAnchor="end" className="fill-slate-500" fontSize="10">
          {xEndLabel ?? xTick(xMax)}
        </text>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KPI 卡                                                              */
/* ------------------------------------------------------------------ */

/** 只读派生值展示（不可编辑，样式对齐 Input）。 */
function ReadOnlyStat({
  label,
  hint,
  value,
  unit,
}: {
  label: string;
  hint?: string;
  value: string;
  unit?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200">
        <span className="tabular-nums">{value}</span>
        {unit ? <span className="shrink-0 text-[10px] text-slate-500">{unit}</span> : null}
      </div>
    </Field>
  );
}

function Kpi({
  en,
  cn,
  accent = 'text-slate-100',
  children,
}: {
  en: string;
  cn: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className={`text-sm font-semibold ${accent}`}>{en}</div>
      <div className="mb-2 text-[11px] text-slate-500">{cn}</div>
      {children}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 主组件                                                              */
/* ------------------------------------------------------------------ */

export default function EconModelTab({ productId, fxRate }: { productId: number; fxRate: number | null }) {
  const { data, isLoading } = useGetUnitEconomicsEconVarsQuery(productId);
  const { data: history } = useGetUnitEconomicsEconVarsSnapshotsQuery(productId);
  const [simulate] = useSimulateUnitEconomicsEconVarsMutation();
  const [save, { isLoading: saving }] = useSaveUnitEconomicsEconVarsMutation();
  const [loadSnapshot] = useLazyGetUnitEconomicsEconVarsSnapshotQuery();
  const [deleteSnapshot] = useDeleteUnitEconomicsEconVarsSnapshotMutation();

  const [draft, setDraft] = useState<Draft>(() => toDraft(EMPTY_VARS));
  const [sim, setSim] = useState<EconPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<number | null>(null);

  const initedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!data || initedRef.current === productId) return;
    initedRef.current = productId;
    setDraft(toDraft(data.vars));
    setSim(null);
    setError(null);
    setSavedAt(data.savedAt);
    setLoadedId(data.snapshotId);
  }, [data, productId]);

  const vars = useMemo(() => draftToVars(draft), [draft]);

  // 输入变化 → 防抖实时模拟（不落库）；待已保存变量载入后再触发，避免空值闪烁
  useEffect(() => {
    if (initedRef.current !== productId) return;
    const t = setTimeout(() => {
      simulate({ productId, vars })
        .unwrap()
        .then(setSim)
        .catch(() => undefined);
    }, 320);
    return () => clearTimeout(t);
  }, [vars, productId, simulate]);

  const model = sim ?? data;
  const neutral: EconMetrics | undefined = model?.results.neutral;
  const reference = model?.reference;

  const set = (key: keyof Draft, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }) as Draft);

  /** 修改某一档的单价。 */
  const setTierPrice = (key: 'cdnTier1Prices' | 'cdnTier2Prices', index: number, value: string) =>
    setDraft((d) => ({ ...d, [key]: d[key].map((p, i) => (i === index ? value : p)) }));

  /** 修改资源包某一档的价格（list = 刊例价 / renew = 续订价）。 */
  const setPackagePrice = (
    key: 'cdnTier1ListPrices' | 'cdnTier1RenewPrices' | 'cdnTier2ListPrices' | 'cdnTier2RenewPrices',
    index: number,
    value: string
  ) => setDraft((d) => ({ ...d, [key]: d[key].map((p, i) => (i === index ? value : p)) }));

  /** 一键填入腾讯云 CDN 流量刊例价（亚太一区 / 亚太二区）。 */
  const applyTencentList = () =>
    setDraft((d) => ({ ...d, cdnTier1Prices: [...TENCENT_LIST_PRICE.tier1], cdnTier2Prices: [...TENCENT_LIST_PRICE.tier2] }));

  /** 一键填入腾讯云 CDN 流量包价格（刊例价 + 续订价，亚太一区 / 亚太二区）。 */
  const applyTencentPackages = () =>
    setDraft((d) => ({
      ...d,
      cdnTier1ListPrices: [...TENCENT_PACKAGE_PRICE.tier1.list],
      cdnTier1RenewPrices: [...TENCENT_PACKAGE_PRICE.tier1.renew],
      cdnTier2ListPrices: [...TENCENT_PACKAGE_PRICE.tier2.list],
      cdnTier2RenewPrices: [...TENCENT_PACKAGE_PRICE.tier2.renew],
    }));

  async function handleSave() {
    setError(null);
    try {
      const res = await save({ productId, vars }).unwrap();
      setSim(res);
      setSavedAt(res.savedAt);
      setLoadedId(res.snapshotId);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  /** 载入某一历史版本快照（回溯查看当时的假设与结论）。 */
  async function handleLoadSnapshot(snapshotId: number) {
    setError(null);
    try {
      const res = await loadSnapshot({ productId, snapshotId }).unwrap();
      setDraft(toDraft(res.vars));
      setSim(res);
      setSavedAt(res.savedAt);
      setLoadedId(res.snapshotId);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  /** 删除某一历史版本快照（当前选中版本不提供删除入口）。 */
  async function handleDeleteSnapshot(snapshotId: number) {
    const when = fmtSavedAt(history?.snapshots.find((s) => s.id === snapshotId)?.savedAt ?? null);
    if (!window.confirm(`确认删除历史版本「${when}」的测算假设？删除后不可恢复。`)) return;
    setError(null);
    try {
      await deleteSnapshot({ productId, snapshotId }).unwrap();
      if (loadedId === snapshotId) {
        setLoadedId(null);
        setSavedAt(null);
      }
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  const latestId = history?.snapshots[0]?.id ?? null;
  const isHistorical = loadedId != null && loadedId !== latestId;

  if (isLoading && !model) return <Empty text="加载全变量测算…" />;
  if (!model || !neutral) return <Empty text="暂无变量数据" />;

  // CDN 消耗流量区间：普通 + 重度两组各自 人数 × 人均分钟 × 每分钟MB（上限取 K、下限取 J），求和后 ÷ (1024×1000) 换算 TB
  const regMb = mbRange(vars.regularPerMinMbLow, vars.regularPerMinMbHigh);
  const hvMb = mbRange(vars.heavyPerMinMbLow, vars.heavyPerMinMbHigh);
  const regBase = (vars.regularViewers ?? 0) * (vars.regularMinutesPerViewer ?? 0);
  const hvBase = (vars.heavyViewers ?? 0) * (vars.heavyMinutesPerViewer ?? 0);
  const trafficLowTb = (regBase * regMb.low + hvBase * hvMb.low) / (1024 * 1000);
  const trafficHighTb = (regBase * regMb.high + hvBase * hvMb.high) / (1024 * 1000);

  const curves = SCEN.map((s) => model.curves[s.key]);
  const sharedMaxX = Math.max(...curves.map((c) => c.maxViewers), 1);

  const revenueSeries: LineSeries = {
    key: 'revenue',
    label: '月收入 Revenue',
    stroke: '#64748b',
    dashed: true,
    points: [
      { x: 0, y: neutral.revenueCny },
      { x: sharedMaxX, y: neutral.revenueCny },
    ],
  };
  const costSeries: LineSeries[] = SCEN.map((s) => ({
    key: `cost-${s.key}`,
    label: `${s.en} 成本`,
    stroke: s.stroke,
    points: model.curves[s.key].points.map((p) => ({ x: p.viewers, y: p.totalCostCny })),
  }));

  const cumSeries: LineSeries[] = SCEN.map((s) => ({
    key: `cum-${s.key}`,
    label: `${s.en} 累计`,
    stroke: s.stroke,
    points: model.projections[s.key].points.map((p) => ({ x: p.monthIndex, y: p.cumNetCny })),
  }));
  const horizon = model.projections.neutral.points.length - 1;

  const costTotal = neutral.costs.reduce((s, c) => s + c.cny, 0);
  const sensRows: EconSensitivityRow[] = model.sensitivity.neutral ?? [];
  const sensMax = Math.max(...sensRows.map((r) => r.impact), 1);

  return (
    <div className="space-y-4">
      {/* 参考基线 + 操作 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
        <div className="text-[11px] leading-relaxed text-slate-500">
          参考基线（近 {reference?.months ?? 3} 个月实际流水月均）：收入{' '}
          <span className="text-slate-300">¥ {formatCny(reference?.monthlyRevenueCny)}</span> · 成本{' '}
          <span className="text-slate-300">¥ {formatCny(reference?.monthlyCostCny)}</span> · 算力域月均{' '}
          <span className="text-slate-300">¥ {formatCny(reference?.suggestedVultrCny)}</span>
          {model.stored ? '' : ' · 尚未保存过全变量，当前为初始值'}
        </div>
        <div className="flex items-center gap-2">
          {savedAt ? (
            <span className={`text-[11px] tabular-nums ${isHistorical ? 'text-amber-400' : 'text-emerald-400'}`}>
              {isHistorical ? '历史版本' : '保存日期'} {fmtSavedAt(savedAt)}
            </span>
          ) : (
            <span className="text-[11px] text-slate-500">尚未保存</span>
          )}
          <Button size="sm" disabled={saving} onClick={handleSave}>
            {saving ? '保存中…' : '保存全变量'}
          </Button>
        </div>
      </div>

      {/* 历史版本快照（按保存日期倒序） */}
      {history && history.snapshots.length > 0 ? (
        <Card>
          <CardHeader
            en="Saved Versions"
            cn={`历史版本快照 · 共 ${history.snapshots.length} 版（点击载入对应日期的假设）`}
          />
          <div className="flex flex-wrap gap-2 p-4">
            {history.snapshots.map((s) => {
              const active = loadedId === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => handleLoadSnapshot(s.id)}
                  className={`cursor-pointer rounded-lg border px-3 py-2 text-left transition ${
                    active ? 'border-sky-500/70 bg-sky-500/10' : 'border-slate-800 bg-slate-900/60 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 text-[11px] font-medium tabular-nums text-slate-200">
                    <span>{fmtSavedAt(s.savedAt)}</span>
                    {active ? (
                      <span className="text-sky-400">· 当前</span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSnapshot(s.id);
                        }}
                        className="rounded px-1 text-rose-400 transition hover:bg-rose-500/10 hover:text-rose-300"
                      >
                        删除
                      </button>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    月净利{' '}
                    <span className={s.netCny >= 0 ? 'text-emerald-400' : 'text-rose-400'}>¥ {formatCny(s.netCny)}</span>
                    {' · '}观看 {formatInt(s.viewers ?? 0)} 人
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi en="Monthly Revenue" cn="月收入（中性）" accent="text-emerald-400">
          <Money
            cny={neutral.revenueCny}
            usd={fxRate ? neutral.revenueCny / fxRate : null}
            size="lg"
            mainClass="text-emerald-400"
          />
        </Kpi>
        <Kpi en="Monthly Cost" cn="月总成本（中性）" accent="text-rose-400">
          <Money cny={neutral.totalCostCny} usd={fxRate ? neutral.totalCostCny / fxRate : null} size="lg" mainClass="text-rose-400" />
        </Kpi>
        <Kpi
          en="Monthly Net"
          cn="月净利（中性）"
          accent={neutral.netCny >= 0 ? 'text-emerald-400' : 'text-rose-400'}
        >
          <Money
            cny={neutral.netCny}
            usd={fxRate ? neutral.netCny / fxRate : null}
            size="lg"
            mainClass={neutral.netCny >= 0 ? 'text-emerald-400' : 'text-rose-400'}
          />
          <div className="mt-0.5 text-[11px] text-slate-500">
            净利率 {neutral.netMargin == null ? '—' : `${formatRate(neutral.netMargin * 100, 1)}%`}
          </div>
        </Kpi>
        <Kpi en="Break-even Viewers" cn="盈亏平衡观看人数" accent="text-sky-400">
          <div className="text-xl font-semibold tabular-nums text-sky-400">
            {neutral.negativeUnitEconomics ? '不可达' : neutral.breakEvenViewers != null ? formatInt(neutral.breakEvenViewers) : '—'}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {neutral.negativeUnitEconomics
              ? '单位经济为负：人均收入 < 流量成本'
              : `当前 ${formatInt((vars.regularViewers ?? 0) + (vars.heavyViewers ?? 0))} 人 · 安全边际 ${
                  neutral.safetyMargin == null ? '—' : `${formatRate(neutral.safetyMargin * 100, 0)}%`
                }`}
          </div>
        </Kpi>
        <Kpi en="Break-even Library" cn="盈亏平衡片库规模" accent="text-amber-400">
          <div className="text-xl font-semibold tabular-nums text-amber-400">
            {neutral.breakEvenTitles != null ? `${formatInt(neutral.breakEvenTitles)} 部` : '—'}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">R2 存储单价 {formatCny(neutral.costs.find((c) => c.key === 'storage')?.cny)} ¥/月</div>
        </Kpi>
        <Kpi en="Payback" cn="盈利周期（中性）" accent="text-amber-400">
          <div className="text-sm font-semibold text-amber-400">
            {model.projections.neutral.breakEvenMonth == null
              ? '期限内未达成'
              : model.projections.neutral.breakEvenMonth === 0
                ? '当前已盈亏平衡'
                : `${model.projections.neutral.breakEvenMonth} 个月转正`}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            累计转正{' '}
            {model.projections.neutral.paybackMonth == null
              ? '—'
              : model.projections.neutral.paybackMonth === 0
                ? '已转正'
                : `${model.projections.neutral.paybackMonth} 个月`}
          </div>
        </Kpi>
      </div>

      {/* 变量输入面板 */}
      <Card>
        <CardHeader
          en="All Variables"
          cn="全变量输入（即时联动测算，不落库；点击保存后新增一版快照并记录保存日期）"
          right={
            <span className="text-[11px] text-slate-500">
              {error ? (
                <span className="text-rose-400">{error}</span>
              ) : savedAt ? (
                <span className={isHistorical ? 'text-amber-400' : 'text-emerald-400'}>
                  {isHistorical ? '历史版本' : '已保存'} {fmtSavedAt(savedAt)}
                </span>
              ) : (
                'A~K 成本维度 · L/M 收入维度'
              )}
            </span>
          }
        />
        <div className="space-y-5 p-4">
          {GROUPS.map((g) => (
            <div key={g.en}>
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-xs font-semibold text-slate-200">{g.cn}</span>
                <span className="text-[10px] uppercase tracking-wide text-slate-600">{g.en}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {g.fields.map((f) => {
                  const raw = draft[f.key];
                  const unitPrice = f.mult && typeof raw === 'string' ? parseNum(raw) : null;
                  const actualCny = unitPrice != null ? unitPrice * (f.mult as number) : null;
                  return (
                    <Field key={f.key} label={f.label} hint={f.hint}>
                      <div className="relative">
                        <Input
                          type="number"
                          min="0"
                          step={f.step ?? '1'}
                          value={draft[f.key]}
                          onChange={(e) => set(f.key, e.target.value)}
                          placeholder={f.placeholder}
                          className={f.mult ? 'pr-20' : 'pr-12'}
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 text-[10px]">
                          {actualCny != null ? (
                            <span className="font-medium tabular-nums text-emerald-400">
                              {formatCny(actualCny)}
                            </span>
                          ) : null}
                          {f.unit ? <span className="text-slate-500">{f.unit}</span> : null}
                        </span>
                      </div>
                    </Field>
                  );
                })}
                {g.en === 'CDN Traffic' ? (
                  <>
                    <div className="col-span-full space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="计价模式" hint="Pricing Mode">
                          <Select value={draft.cdnPricingMode} onChange={(e) => set('cdnPricingMode', e.target.value)}>
                            <option value="tiered">按量 · 阶梯累进</option>
                            <option value="package">预付费 · 流量包</option>
                          </Select>
                        </Field>
                        <Field label="价格档" hint={draft.cdnPricingMode === 'package' ? 'Package Price' : '仅资源包模式生效'}>
                          <Select
                            value={draft.cdnPackagePrice}
                            onChange={(e) => set('cdnPackagePrice', e.target.value)}
                            disabled={draft.cdnPricingMode !== 'package'}
                          >
                            <option value="renew">连续包月 · 续订价</option>
                            <option value="list">单次购买 · 刊例价</option>
                          </Select>
                        </Field>
                      </div>

                      {draft.cdnPricingMode === 'tiered' ? (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-400">
                              F / G · 阶梯单价（月度阶梯累进：每档仅对落入该档区间的流量计价，再求和）
                            </span>
                            <Button size="sm" variant="ghost" onClick={applyTencentList}>
                              填入腾讯云刊例价
                            </Button>
                          </div>
                          {(
                            [
                              { key: 'cdnTier1Prices' as const, label: 'F · 亚太一区', hint: 'APAC-1' },
                              { key: 'cdnTier2Prices' as const, label: 'G · 亚太二区', hint: 'APAC-2' },
                            ]
                          ).map((row) => (
                            <div key={row.key}>
                              <div className="mb-1 flex items-baseline gap-2">
                                <span className="text-[11px] font-medium text-slate-300">{row.label}</span>
                                <span className="text-[10px] text-slate-600">{row.hint}</span>
                              </div>
                              <div className="grid grid-cols-5 gap-2">
                                {CDN_TIER_BOUNDS.map((b, i) => (
                                  <div key={i}>
                                    <div className="mb-1 text-center text-[10px] text-slate-500">{b.label}</div>
                                    <div className="relative">
                                      <Input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={draft[row.key][i] ?? ''}
                                        onChange={(e) => setTierPrice(row.key, i, e.target.value)}
                                        placeholder="未填"
                                        className="pr-10"
                                      />
                                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">
                                        ¥/TB
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-400">
                              F / G · 流量包价格（预付费资源包：按月覆盖流量的最省整包组合，上为刊例价 / 下为续订价）
                            </span>
                            <Button size="sm" variant="ghost" onClick={applyTencentPackages}>
                              填入腾讯云资源包价
                            </Button>
                          </div>
                          {(
                            [
                              { listKey: 'cdnTier1ListPrices' as const, renewKey: 'cdnTier1RenewPrices' as const, label: 'F · 亚太一区', hint: 'APAC-1' },
                              { listKey: 'cdnTier2ListPrices' as const, renewKey: 'cdnTier2RenewPrices' as const, label: 'G · 亚太二区', hint: 'APAC-2' },
                            ]
                          ).map((row) => (
                            <div key={row.listKey}>
                              <div className="mb-1 flex items-baseline gap-2">
                                <span className="text-[11px] font-medium text-slate-300">{row.label}</span>
                                <span className="text-[10px] text-slate-600">{row.hint}</span>
                              </div>
                              <div className="grid grid-cols-6 gap-2">
                                {CDN_PACKAGE_BOUNDS.map((b, i) => (
                                  <div key={i}>
                                    <div className="mb-1 text-center text-[10px] text-slate-500">{b.label}</div>
                                    <div className="space-y-1">
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={draft[row.listKey][i] ?? ''}
                                        onChange={(e) => setPackagePrice(row.listKey, i, e.target.value)}
                                        placeholder="刊例价"
                                      />
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={draft[row.renewKey][i] ?? ''}
                                        onChange={(e) => setPackagePrice(row.renewKey, i, e.target.value)}
                                        placeholder="续订价"
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                    <ReadOnlyStat label="消耗流量下限" hint="H × I × J" value={fmtQty(trafficLowTb)} unit="TB" />
                    <ReadOnlyStat label="消耗流量上限" hint="H × I × K" value={fmtQty(trafficHighTb)} unit="TB" />
                  </>
                ) : null}
                {g.en === 'Projection' ? (
                  <Field label="推演月数" hint="Horizon">
                    <Select value={draft.horizonMonths} onChange={(e) => set('horizonMonths', e.target.value)}>
                      <option value="12">12 个月</option>
                      <option value="24">24 个月</option>
                      <option value="36">36 个月</option>
                      <option value="48">48 个月</option>
                    </Select>
                  </Field>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 盈亏曲线（X = 观看人数） */}
      <Card>
        <CardHeader
          en="Break-even Curve"
          cn="盈亏曲线 · X 轴 = 月观看人数（收入恒定，成本随人数线性上升）"
          right={
            <div className="flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                <span className="inline-block h-0 w-4 border-t-2 border-dashed border-slate-500" />
                月收入
              </span>
              {SCEN.map((s) => (
                <span key={s.key} className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.accent}`}>
                  <span className="h-2 w-2 rounded-full" style={{ background: s.stroke }} />
                  {s.en} 成本
                </span>
              ))}
            </div>
          }
        />
        <div className="p-4">
          <EconLineChart
            series={[revenueSeries, ...costSeries]}
            xMax={sharedMaxX}
            xTick={(v) => formatInt(v)}
            xStartLabel="0 人"
            xEndLabel={`${formatInt(sharedMaxX)} 人`}
            marker={
              model.curves.neutral.currentViewers > 0
                ? { x: model.curves.neutral.currentViewers, label: `现状 ${formatInt(model.curves.neutral.currentViewers)} 人` }
                : null
            }
          />
          <div className="mt-3 grid grid-cols-3 gap-3 text-[11px]">
            {SCEN.map((s) => {
              const m = model.results[s.key];
              return (
                <div key={s.key} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                  <div className={`mb-1 text-xs font-medium ${s.accent}`}>
                    {s.en} {s.cn}
                  </div>
                  <div className="text-slate-400">
                    每分钟流量：<span className="text-slate-200">{m.mbPerMin} MB</span>
                  </div>
                  <div className="text-slate-400">
                    平衡人数：
                    <span className="text-slate-200">
                      {m.negativeUnitEconomics ? '不可达' : m.breakEvenViewers != null ? `${formatInt(m.breakEvenViewers)} 人` : '—'}
                    </span>
                  </div>
                  <div className="text-slate-400">
                    单人流量成本：<span className="text-slate-200">¥ {formatCny(m.cdnPerViewerCny)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* 盈利周期推演（X = 月序） */}
      <Card>
        <CardHeader
          en="Cash Flow Projection"
          cn={`盈利周期推演 · X 轴 = 月序（累计净现金流，推演 ${horizon} 个月）`}
          right={
            <div className="flex flex-wrap gap-3">
              {SCEN.map((s) => (
                <span key={s.key} className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.accent}`}>
                  <span className="h-2 w-2 rounded-full" style={{ background: s.stroke }} />
                  {s.en} {s.cn}
                </span>
              ))}
            </div>
          }
        />
        <div className="p-4">
          <EconLineChart
            series={cumSeries}
            xMax={Math.max(horizon, 1)}
            xTick={(v) => `第 ${formatInt(v)} 月`}
            xStartLabel={model.projections.neutral.points[0]?.ym ?? '0 月'}
            xEndLabel={model.projections.neutral.points[horizon]?.ym ?? `${horizon} 月`}
          />
          <div className="mt-3 grid grid-cols-3 gap-3 text-[11px]">
            {SCEN.map((s) => {
              const p = model.projections[s.key];
              return (
                <div key={s.key} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                  <div className={`mb-1 text-xs font-medium ${s.accent}`}>
                    {s.en} {s.cn}
                  </div>
                  <div className="text-slate-400">
                    月度转正：<span className="text-slate-200">{p.breakEvenMonth == null ? '未达成' : p.breakEvenMonth === 0 ? '已达成' : `${p.breakEvenMonth} 月`}</span>
                  </div>
                  <div className="text-slate-400">
                    累计转正：<span className="text-slate-200">{p.paybackMonth == null ? '未达成' : p.paybackMonth === 0 ? '已转正' : `${p.paybackMonth} 月`}</span>
                  </div>
                  <div className="text-slate-400">
                    期末累计：
                    <span className={p.endCumNetCny != null && p.endCumNetCny >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      ¥ {formatCny(p.endCumNetCny)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* 成本构成 + 敏感度 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader en="Cost Composition" cn="月成本构成（中性情景）" right={<span className="text-[11px] text-slate-500">合计 ¥ {formatCny(costTotal)}</span>} />
          <div className="space-y-2.5 p-4">
            {neutral.costs.map((c) => (
              <div key={c.key} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-xs text-slate-400">
                  {c.labelEn}
                  <span className="ml-1 text-[10px] text-slate-600">{c.labelCn}</span>
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full ${
                      c.group === 'cdn' ? 'bg-amber-500/80' : c.group === 'storage' ? 'bg-sky-500/80' : 'bg-slate-500/80'
                    }`}
                    style={{ width: `${Math.min(100, c.share * 100)}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-300">¥ {formatCny(c.cny)}</span>
                <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-slate-500">
                  {formatRate(c.share * 100, 0)}%
                </span>
              </div>
            ))}
            <div className="mt-1 flex gap-4 border-t border-slate-800 pt-2 text-[11px] text-slate-500">
              <span>固定基座 ¥ {formatCny(neutral.baseFixedCny)}</span>
              <span>
                CDN 流量 {neutral.trafficTb} TB · 综合单价 ¥ {formatCny(neutral.blendedPerTbCny)}/TB
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader en="Sensitivity" cn="敏感度（中性情景 ±20%，观察盈亏平衡观看人数的波动）" />
          <div className="p-4">
            {sensRows.length === 0 ? (
              <Empty text="暂无可计算的敏感度（需先达成可平衡的单位经济）" />
            ) : (
              <div className="space-y-3">
                {sensRows.slice(0, 12).map((r) => (
                  <div key={r.key} className="flex items-center gap-3">
                    <div className="w-32 shrink-0 text-right text-xs text-slate-400">
                      {r.labelEn}
                      <div className="text-[10px] text-slate-600">{r.labelCn}</div>
                    </div>
                    <div className="relative h-6 flex-1">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-700" />
                      <div
                        className="absolute inset-y-1.5 rounded bg-amber-500/70"
                        style={{ width: `${(r.impact / sensMax) * 50}%`, left: '50%' }}
                        title={`±20% → 平衡人数波动 ${formatInt(r.impact)}`}
                      />
                    </div>
                    <div className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-300">±{formatInt(r.impact)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* 口径提示 */}
      {model.warnings.length > 0 ? (
        <Card>
          <CardHeader en="Data Warnings" cn="口径提示（不影响计算，仅提示风险）" />
          <ul className="space-y-1.5 p-4">
            {model.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-amber-300/90">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                {w}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
