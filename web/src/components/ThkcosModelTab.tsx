import { useEffect, useMemo, useRef, useState } from 'react';
import {
  extractErrorMessage,
  useGetUnitEconomicsThkcosVarsQuery,
  useGetUnitEconomicsThkcosVarsSnapshotsQuery,
  useLazyGetUnitEconomicsThkcosVarsSnapshotQuery,
  useDeleteUnitEconomicsThkcosVarsSnapshotMutation,
  useSaveUnitEconomicsThkcosVarsMutation,
  useSimulateUnitEconomicsThkcosVarsMutation,
  type ThkcosMetrics,
  type ThkcosPayload,
  type ThkcosScenarioKey,
  type ThkcosSensitivityRow,
  type ThkcosTrafficMode,
  type CdnTier,
  type CdnPackage,
  type CdnPricingMode,
  type CdnPackagePrice,
  type ThkcosVars,
} from '../api';
import { Card, CardHeader, Empty } from './Card';
import { Button, Field, Input, Select } from './Field';
import { Modal } from './Modal';
import { Money } from './Money';
import { formatCny, formatInt, formatRate } from '../lib/format';

/* ------------------------------------------------------------------ */
/* 情景元数据                                                          */
/* ------------------------------------------------------------------ */

const SCEN: { key: ThkcosScenarioKey; cn: string; en: string; stroke: string; accent: string }[] = [
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
  cosStoragePerGbCny: string;
  libraryTitles: string;
  avgTitleGb: string;
  syncGbPerMonth: string;
  syncPerGbCny: string;
  trafficMode: ThkcosTrafficMode;
  basicViewers: string;
  premiumViewers: string;
  basicMinutesPerViewer: string;
  premiumMinutesPerViewer: string;
  basicPerMinMbLow: string;
  premiumPerMinMbLow: string;
  basicPerMinMbHigh: string;
  premiumPerMinMbHigh: string;
  cacheHitRatioPct: string;
  /** 直连 COS 外网下行按量单价 ¥/GB（沿用现有阶梯字段存储）。 */
  cosDownPerGbCny: string;
  eoOveragePrices: string[];
  /** 经 EO：COS 回源单价 ¥/GB（沿用现有字段存储）。 */
  cosOriginPerGbCny: string;
  /** 计费口径：tiered = 按量（直连按官方单价 / 经 EO 按超量阶梯），package = 预付费流量包 */
  cdnPricingMode: CdnPricingMode;
  /** 资源包价格档：renew = 续订价，list = 刊例价 */
  cdnPackagePrice: CdnPackagePrice;
  /** COS 资源包 8 档价格（字符串，与 COS_PACKAGE_BOUNDS 一一对应） */
  cosDownListPrices: string[];
  cosDownRenewPrices: string[];
  /** EO 资源包 11 档价格（字符串，与 EO_PACKAGE_BOUNDS 一一对应） */
  eoListPrices: string[];
  eoRenewPrices: string[];
  /** EO 套餐月费 ¥/月 */
  eoPlanMonthlyCny: string;
  /** EO 套餐内含流量 GB/月 */
  eoPlanIncludedGb: string;
  /** EO 流量包地区抵扣系数（亚太1区 = 2.49） */
  eoDeductionRatio: string;
  basicMonthlySubs: string;
  basicMonthlyPriceCny: string;
  basicQuarterlySubs: string;
  basicQuarterlyPriceCny: string;
  basicYearlySubs: string;
  basicYearlyPriceCny: string;
  premiumMonthlySubs: string;
  premiumMonthlyPriceCny: string;
  premiumQuarterlySubs: string;
  premiumQuarterlyPriceCny: string;
  premiumYearlySubs: string;
  premiumYearlyPriceCny: string;
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
/* 流量计价：COS 直连按量单价；EO 超量固定 7 档，仅单价可调                */
/* ------------------------------------------------------------------ */

const EO_OVERAGE_TIER_BOUNDS: { upToTb: number | null; label: string }[] = [
  { upToTb: 2, label: '0–2 TB' },
  { upToTb: 10, label: '2–10 TB' },
  { upToTb: 50, label: '10–50 TB' },
  { upToTb: 100, label: '50–100 TB' },
  { upToTb: 500, label: '100–500 TB' },
  { upToTb: 1000, label: '500–1000 TB' },
  { upToTb: null, label: '≥1000 TB' },
];

/** 阶梯数组 → 指定档位的字符串单价（不足处补空）。 */
function tiersToPrices(tiers: CdnTier[] | null | undefined, bounds: { upToTb: number | null; label: string }[]): string[] {
  return bounds.map((_, i) => numStr(tiers?.[i]?.pricePerTbCny));
}

/** 指定档位的字符串单价 → 阶梯数组（全空视为「未配置」，返回 null）。 */
function pricesToTiers(prices: string[], bounds: { upToTb: number | null; label: string }[]): CdnTier[] | null {
  const parsed = prices.map((p) => parseNum(p));
  if (parsed.every((p) => p === null)) return null;
  return bounds.map((b, i) => ({ upToTb: b.upToTb, pricePerTbCny: parsed[i] ?? 0 }));
}

/** 单档单价：沿用现有阶梯字段，仅取首档并折算为 ¥/GB。 */
function singleTierToPerGb(tiers: CdnTier[] | null | undefined): string {
  const first = tiers?.[0]?.pricePerTbCny;
  return first == null ? '' : numStr(first / 1000);
}

/** 单档单价：存储为单档等效 ¥/TB，兼容现有字段结构。 */
function perGbToSingleTier(price: string): CdnTier[] | null {
  const parsed = parseNum(price);
  return parsed == null ? null : [{ upToTb: null, pricePerTbCny: parsed * 1000 }];
}

/** COS 回源单价：沿用现有阶梯字段，仅取首档并折算为 ¥/GB。 */
function originTiersToPerGb(tiers: CdnTier[] | null | undefined): string {
  const first = tiers?.[0]?.pricePerTbCny;
  return first == null ? '' : numStr(first / 1000);
}

/** COS 回源单价：存储为单档等效 ¥/TB，兼容现有字段结构。 */
function originPerGbToTiers(price: string): CdnTier[] | null {
  const parsed = parseNum(price);
  return parsed == null ? null : [{ upToTb: null, pricePerTbCny: parsed * 1000 }];
}

/* ------------------------------------------------------------------ */
/* 流量资源包：COS 预置 8 档至 1PB；EO 预置 11 档至 50PB，可编辑「刊例价 / 续订价」 */
/* ------------------------------------------------------------------ */

/** COS 资源包档位容量（GB；前 6 档与腾讯云一致，额外补 200TB / 1PB 两档便于大盘测算）。 */
const COS_PACKAGE_BOUNDS: { sizeGb: number; label: string }[] = [
  { sizeGb: 100, label: '100 GB' },
  { sizeGb: 500, label: '500 GB' },
  { sizeGb: 1000, label: '1 TB' },
  { sizeGb: 5000, label: '5 TB' },
  { sizeGb: 10000, label: '10 TB' },
  { sizeGb: 50000, label: '50 TB' },
  { sizeGb: 200000, label: '200 TB' },
  { sizeGb: 1000000, label: '1 PB' },
];

/** EO 全球流量包档位容量（GB；在 COS 基础上继续扩展 5PB / 10PB / 50PB）。 */
const EO_PACKAGE_BOUNDS: { sizeGb: number; label: string }[] = [
  ...COS_PACKAGE_BOUNDS,
  { sizeGb: 5000000, label: '5 PB' },
  { sizeGb: 10000000, label: '10 PB' },
  { sizeGb: 50000000, label: '50 PB' },
];

/** 资源包数组 → 指定档位的字符串价格（按 list / renew 取值，不足处补空）。 */
function packagesToPrices(
  pkgs: CdnPackage[] | null | undefined,
  bounds: { sizeGb: number; label: string }[],
  key: 'listCny' | 'renewCny'
): string[] {
  return bounds.map((_, i) => numStr(pkgs?.[i]?.[key]));
}

/** 两套字符串价格 → 资源包数组（两套全空视为「未配置」，返回 null）。 */
function pricesToPackages(
  bounds: { sizeGb: number; label: string }[],
  list: string[],
  renew: string[]
): CdnPackage[] | null {
  const l = list.map((p) => parseNum(p));
  const r = renew.map((p) => parseNum(p));
  if (l.every((p) => p === null) && r.every((p) => p === null)) return null;
  return bounds.map((b, i) => ({ sizeGb: b.sizeGb, listCny: l[i] ?? 0, renewCny: r[i] ?? 0 }));
}

function toDraft(v: ThkcosVars): Draft {
  return {
    vultrMonthlyCny: numStr(v.vultrMonthlyCny),
    domainAnnualCny: numStr(v.domainAnnualCny),
    sslAnnualCny: numStr(v.sslAnnualCny),
    r2StoragePerGbCny: numStr(v.r2StoragePerGbCny),
    cosStoragePerGbCny: numStr(v.cosStoragePerGbCny),
    libraryTitles: numStr(v.libraryTitles),
    avgTitleGb: numStr(v.avgTitleGb),
    syncGbPerMonth: numStr(v.syncGbPerMonth),
    syncPerGbCny: numStr(v.syncPerGbCny),
    trafficMode: v.trafficMode ?? 'direct',
    basicViewers: numStr(v.basicViewers),
    premiumViewers: numStr(v.premiumViewers),
    basicMinutesPerViewer: numStr(v.basicMinutesPerViewer),
    premiumMinutesPerViewer: numStr(v.premiumMinutesPerViewer),
    basicPerMinMbLow: numStr(v.basicPerMinMbLow),
    premiumPerMinMbLow: numStr(v.premiumPerMinMbLow),
    basicPerMinMbHigh: numStr(v.basicPerMinMbHigh),
    premiumPerMinMbHigh: numStr(v.premiumPerMinMbHigh),
    cacheHitRatioPct: pctStr(v.cacheHitRatio),
    cosDownPerGbCny: singleTierToPerGb(v.cosDownTiers),
    eoOveragePrices: tiersToPrices(v.eoOverageTiers, EO_OVERAGE_TIER_BOUNDS),
    cosOriginPerGbCny: originTiersToPerGb(v.cosOriginTiers),
    cdnPricingMode: v.cdnPricingMode ?? 'tiered',
    cdnPackagePrice: v.cdnPackagePrice ?? 'renew',
    cosDownListPrices: packagesToPrices(v.cosDownPackages, COS_PACKAGE_BOUNDS, 'listCny'),
    cosDownRenewPrices: packagesToPrices(v.cosDownPackages, COS_PACKAGE_BOUNDS, 'renewCny'),
    eoListPrices: packagesToPrices(v.eoPackages, EO_PACKAGE_BOUNDS, 'listCny'),
    eoRenewPrices: packagesToPrices(v.eoPackages, EO_PACKAGE_BOUNDS, 'renewCny'),
    eoPlanMonthlyCny: numStr(v.eoPlanMonthlyCny),
    eoPlanIncludedGb: numStr(v.eoPlanIncludedGb),
    eoDeductionRatio: numStr(v.eoDeductionRatio),
    basicMonthlySubs: numStr(v.basicMonthlySubs),
    basicMonthlyPriceCny: numStr(v.basicMonthlyPriceCny),
    basicQuarterlySubs: numStr(v.basicQuarterlySubs),
    basicQuarterlyPriceCny: numStr(v.basicQuarterlyPriceCny),
    basicYearlySubs: numStr(v.basicYearlySubs),
    basicYearlyPriceCny: numStr(v.basicYearlyPriceCny),
    premiumMonthlySubs: numStr(v.premiumMonthlySubs),
    premiumMonthlyPriceCny: numStr(v.premiumMonthlyPriceCny),
    premiumQuarterlySubs: numStr(v.premiumQuarterlySubs),
    premiumQuarterlyPriceCny: numStr(v.premiumQuarterlyPriceCny),
    premiumYearlySubs: numStr(v.premiumYearlySubs),
    premiumYearlyPriceCny: numStr(v.premiumYearlyPriceCny),
    viewerGrowthPct: pctStr(v.viewerGrowth),
    subscriberGrowthPct: pctStr(v.subscriberGrowth),
    horizonMonths: String(v.horizonMonths ?? 24),
  };
}

/** 全量转回变量（发送完整字段，避免后端按 null 覆盖其它字段）。 */
function draftToVars(d: Draft): ThkcosVars {
  return {
    vultrMonthlyCny: parseNum(d.vultrMonthlyCny),
    domainAnnualCny: parseNum(d.domainAnnualCny),
    sslAnnualCny: parseNum(d.sslAnnualCny),
    r2StoragePerGbCny: parseNum(d.r2StoragePerGbCny),
    cosStoragePerGbCny: parseNum(d.cosStoragePerGbCny),
    libraryTitles: parseNum(d.libraryTitles),
    avgTitleGb: parseNum(d.avgTitleGb),
    syncGbPerMonth: parseNum(d.syncGbPerMonth),
    syncPerGbCny: parseNum(d.syncPerGbCny),
    trafficMode: d.trafficMode,
    basicViewers: parseNum(d.basicViewers),
    premiumViewers: parseNum(d.premiumViewers),
    basicMinutesPerViewer: parseNum(d.basicMinutesPerViewer),
    premiumMinutesPerViewer: parseNum(d.premiumMinutesPerViewer),
    basicPerMinMbLow: parseNum(d.basicPerMinMbLow),
    premiumPerMinMbLow: parseNum(d.premiumPerMinMbLow),
    basicPerMinMbHigh: parseNum(d.basicPerMinMbHigh),
    premiumPerMinMbHigh: parseNum(d.premiumPerMinMbHigh),
    cacheHitRatio: parsePct(d.cacheHitRatioPct),
    cosDownTiers: perGbToSingleTier(d.cosDownPerGbCny),
    eoOverageTiers: pricesToTiers(d.eoOveragePrices, EO_OVERAGE_TIER_BOUNDS),
    cosOriginTiers: originPerGbToTiers(d.cosOriginPerGbCny),
    cdnPricingMode: d.cdnPricingMode,
    cdnPackagePrice: d.cdnPackagePrice,
    cosDownPackages: pricesToPackages(COS_PACKAGE_BOUNDS, d.cosDownListPrices, d.cosDownRenewPrices),
    eoPackages: pricesToPackages(EO_PACKAGE_BOUNDS, d.eoListPrices, d.eoRenewPrices),
    eoPlanMonthlyCny: parseNum(d.eoPlanMonthlyCny),
    eoPlanIncludedGb: parseNum(d.eoPlanIncludedGb),
    eoDeductionRatio: parseNum(d.eoDeductionRatio),
    basicMonthlySubs: parseNum(d.basicMonthlySubs),
    basicMonthlyPriceCny: parseNum(d.basicMonthlyPriceCny),
    basicQuarterlySubs: parseNum(d.basicQuarterlySubs),
    basicQuarterlyPriceCny: parseNum(d.basicQuarterlyPriceCny),
    basicYearlySubs: parseNum(d.basicYearlySubs),
    basicYearlyPriceCny: parseNum(d.basicYearlyPriceCny),
    premiumMonthlySubs: parseNum(d.premiumMonthlySubs),
    premiumMonthlyPriceCny: parseNum(d.premiumMonthlyPriceCny),
    premiumQuarterlySubs: parseNum(d.premiumQuarterlySubs),
    premiumQuarterlyPriceCny: parseNum(d.premiumQuarterlyPriceCny),
    premiumYearlySubs: parseNum(d.premiumYearlySubs),
    premiumYearlyPriceCny: parseNum(d.premiumYearlyPriceCny),
    viewerGrowth: parsePct(d.viewerGrowthPct),
    subscriberGrowth: parsePct(d.subscriberGrowthPct),
    horizonMonths: parseNum(d.horizonMonths) ?? 24,
  };
}

const EMPTY_VARS: ThkcosVars = {
  vultrMonthlyCny: null,
  domainAnnualCny: null,
  sslAnnualCny: null,
  r2StoragePerGbCny: null,
  cosStoragePerGbCny: null,
  libraryTitles: null,
  avgTitleGb: null,
  syncGbPerMonth: null,
  syncPerGbCny: null,
  trafficMode: 'direct',
  basicViewers: null,
  premiumViewers: null,
  basicMinutesPerViewer: null,
  premiumMinutesPerViewer: null,
  basicPerMinMbLow: null,
  premiumPerMinMbLow: null,
  basicPerMinMbHigh: null,
  premiumPerMinMbHigh: null,
  cacheHitRatio: null,
  cosDownTiers: null,
  eoOverageTiers: null,
  cosOriginTiers: null,
  cdnPricingMode: 'tiered',
  cdnPackagePrice: 'renew',
  cosDownPackages: null,
  eoPackages: null,
  eoPlanMonthlyCny: null,
  eoPlanIncludedGb: null,
  eoDeductionRatio: null,
  basicMonthlySubs: null,
  basicMonthlyPriceCny: null,
  basicQuarterlySubs: null,
  basicQuarterlyPriceCny: null,
  basicYearlySubs: null,
  basicYearlyPriceCny: null,
  premiumMonthlySubs: null,
  premiumMonthlyPriceCny: null,
  premiumQuarterlySubs: null,
  premiumQuarterlyPriceCny: null,
  premiumYearlySubs: null,
  premiumYearlyPriceCny: null,
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
    cn: '双副本存储（R2 + 香港 COS）',
    en: 'Dual Storage',
    fields: [
      { key: 'r2StoragePerGbCny', label: 'B · R2 存储单价', hint: 'R2 ¥/GB·月', unit: '¥/GB', step: '0.0001', placeholder: '如 0.0107' },
      { key: 'cosStoragePerGbCny', label: 'C · COS 存储单价', hint: 'COS ¥/GB·月', unit: '¥/GB', step: '0.0001', placeholder: '如 0.118' },
      { key: 'libraryTitles', label: 'D · 片库影片数', hint: 'Library', unit: '部', placeholder: '如 2000' },
      { key: 'avgTitleGb', label: 'E · 单片体积', hint: 'GB / Title', unit: 'GB', step: '0.1', placeholder: '如 6' },
    ],
  },
  {
    cn: '增量同步（R2 → 香港 COS）',
    en: 'Incremental Sync',
    fields: [
      { key: 'syncGbPerMonth', label: 'F · 每月增量同步量', hint: 'R2 → COS', unit: 'GB/月', step: '0.1', placeholder: '如 120' },
      { key: 'syncPerGbCny', label: 'G · 同步入口单价', hint: 'COS 流入 ¥/GB', unit: '¥/GB', step: '0.0001', placeholder: '如 0' },
    ],
  },
  {
    cn: 'COS 流量（直连 / 经 CDN）',
    en: 'COS Traffic',
    fields: [
      { key: 'basicViewers', label: 'H1 · 基础会员月观看人数', hint: 'Regular Viewers', unit: '人', placeholder: '如 4000' },
      { key: 'basicMinutesPerViewer', label: 'I1 · 基础会员人均月观影', hint: 'Min / Viewer', unit: '分钟', step: '1', placeholder: '如 480' },
      { key: 'basicPerMinMbLow', label: 'J1 · 基础会员每分钟流量下限', hint: '乐观取下限', unit: 'MB', step: '0.1', placeholder: '如 10' },
      { key: 'basicPerMinMbHigh', label: 'K1 · 基础会员每分钟流量上限', hint: '悲观取上限', unit: 'MB', step: '0.1', placeholder: '如 20' },
      { key: 'premiumViewers', label: 'H2 · 高级会员月观看人数', hint: 'Heavy Viewers', unit: '人', placeholder: '如 1000' },
      { key: 'premiumMinutesPerViewer', label: 'I2 · 高级会员人均月观影', hint: 'Min / Viewer', unit: '分钟', step: '1', placeholder: '如 1800' },
      { key: 'premiumPerMinMbLow', label: 'J2 · 高级会员每分钟流量下限', hint: '乐观取下限', unit: 'MB', step: '0.1', placeholder: '如 14' },
      { key: 'premiumPerMinMbHigh', label: 'K2 · 高级会员每分钟流量上限', hint: '悲观取上限', unit: 'MB', step: '0.1', placeholder: '如 25' },
    ],
  },
  {
    cn: '订阅收入 · 基础会员（月度确认口径）',
    en: 'Basic Subscription',
    fields: [
      { key: 'basicMonthlySubs', label: 'L1 · 月卡人数', hint: 'Basic · Monthly', unit: '人', placeholder: '如 800' },
      { key: 'basicMonthlyPriceCny', label: 'M1 · 月卡单价', hint: 'Basic · ¥/月', unit: '¥', placeholder: '如 30' },
      { key: 'basicQuarterlySubs', label: 'L2 · 季卡人数', hint: '实收 ×3', unit: '人', placeholder: '如 300' },
      { key: 'basicQuarterlyPriceCny', label: 'M2 · 季卡单价', hint: '¥/月 × 3', unit: '¥', placeholder: '如 25', mult: 3 },
      { key: 'basicYearlySubs', label: 'L3 · 年卡人数', hint: '实收 ×12', unit: '人', placeholder: '如 200' },
      { key: 'basicYearlyPriceCny', label: 'M3 · 年卡单价', hint: '¥/月 × 12', unit: '¥', placeholder: '如 20', mult: 12 },
    ],
  },
  {
    cn: '订阅收入 · 高级会员（月度确认口径）',
    en: 'Premium Subscription',
    fields: [
      { key: 'premiumMonthlySubs', label: 'L4 · 月卡人数', hint: 'Premium · Monthly', unit: '人', placeholder: '如 300' },
      { key: 'premiumMonthlyPriceCny', label: 'M4 · 月卡单价', hint: 'Premium · ¥/月', unit: '¥', placeholder: '如 68' },
      { key: 'premiumQuarterlySubs', label: 'L5 · 季卡人数', hint: '实收 ×3', unit: '人', placeholder: '如 120' },
      { key: 'premiumQuarterlyPriceCny', label: 'M5 · 季卡单价', hint: '¥/月 × 3', unit: '¥', placeholder: '如 58', mult: 3 },
      { key: 'premiumYearlySubs', label: 'L6 · 年卡人数', hint: '实收 ×12', unit: '人', placeholder: '如 80' },
      { key: 'premiumYearlyPriceCny', label: 'M6 · 年卡单价', hint: '¥/月 × 12', unit: '¥', placeholder: '如 48', mult: 12 },
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

/** 每分钟流量区间 MB/min（未填一侧时以另一侧兜底，保证 low ≤ high）。 */
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

function ThkcosLineChart({
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
/* 只读派生值 / KPI 卡                                                 */
/* ------------------------------------------------------------------ */

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

export default function ThkcosModelTab({ productId, fxRate }: { productId: number; fxRate: number | null }) {
  const { data, isLoading } = useGetUnitEconomicsThkcosVarsQuery(productId);
  const { data: history } = useGetUnitEconomicsThkcosVarsSnapshotsQuery(productId);
  const [simulate] = useSimulateUnitEconomicsThkcosVarsMutation();
  const [save, { isLoading: saving }] = useSaveUnitEconomicsThkcosVarsMutation();
  const [loadSnapshot] = useLazyGetUnitEconomicsThkcosVarsSnapshotQuery();
  const [deleteSnapshot] = useDeleteUnitEconomicsThkcosVarsSnapshotMutation();

  const [draft, setDraft] = useState<Draft>(() => toDraft(EMPTY_VARS));
  const [sim, setSim] = useState<ThkcosPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: number; when: string } | null>(null);

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
  const neutral: ThkcosMetrics | undefined = model?.results.neutral;
  const reference = model?.reference;

  const set = (key: keyof Draft, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }) as Draft);

  /** 修改 EO 超量某一档的单价。 */
  const setTierPrice = (key: 'eoOveragePrices', index: number, value: string) =>
    setDraft((d) => ({ ...d, [key]: d[key].map((p, i) => (i === index ? value : p)) }));

  /** 修改资源包某一档的价格（list = 刊例价 / renew = 续订价）。 */
  const setPackagePrice = (
    key: 'cosDownListPrices' | 'cosDownRenewPrices' | 'eoListPrices' | 'eoRenewPrices',
    index: number,
    value: string,
  ) => setDraft((d) => ({ ...d, [key]: d[key].map((p, i) => (i === index ? value : p)) }));

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

  /** 打开删除确认弹窗。 */
  function handleDeleteSnapshot(snapshotId: number) {
    const when = fmtSavedAt(history?.snapshots.find((s) => s.id === snapshotId)?.savedAt ?? null);
    setPendingDelete({ id: snapshotId, when });
  }

  /** 确认删除某一历史版本快照。 */
  async function confirmDelete() {
    if (!pendingDelete) return;
    const snapshotId = pendingDelete.id;
    setPendingDelete(null);
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

  if (isLoading && !model) return <Empty text="加载 cf&THKCOS 全变量测算…" />;
  if (!model || !neutral) return <Empty text="暂无变量数据" />;

  const isCdn = draft.trafficMode === 'cdn';

  // 消耗流量区间：普通 + 重度两组各自 人数 × 人均分钟 × 每分钟MB（上限取 K、下限取 J），求和后 ÷ 1024 → GB ÷ 1000 → TB
  const basicMb = mbRange(vars.basicPerMinMbLow, vars.basicPerMinMbHigh);
  const premiumMb = mbRange(vars.premiumPerMinMbLow, vars.premiumPerMinMbHigh);
  const basicBase = (vars.basicViewers ?? 0) * (vars.basicMinutesPerViewer ?? 0);
  const premiumBase = (vars.premiumViewers ?? 0) * (vars.premiumMinutesPerViewer ?? 0);
  const trafficLowTb = (basicBase * basicMb.low + premiumBase * premiumMb.low) / (1024 * 1000);
  const trafficHighTb = (basicBase * basicMb.high + premiumBase * premiumMb.high) / (1024 * 1000);

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
  const sensRows: ThkcosSensitivityRow[] = model.sensitivity.neutral ?? [];
  const sensMax = Math.max(...sensRows.map((r) => r.impact), 1);

  /** 当前模式下的阶梯编辑器行。 */
  const tierRows: {
    key: 'eoOveragePrices';
    label: string;
    hint: string;
    bounds: { upToTb: number | null; label: string }[];
  }[] = isCdn
    ? [{ key: 'eoOveragePrices', label: 'EO 超量阶梯', hint: 'Overage Tiered', bounds: EO_OVERAGE_TIER_BOUNDS }]
    : [];

  const isPackage = draft.cdnPricingMode === 'package';
  const topControlCount = 2 + (isCdn ? 1 : 0) + (isPackage ? 1 : 0);

  /** 当前模式下的资源包编辑器行（回源始终按单价计费，不参与资源包）。 */
  const packageRows: {
    listKey: 'cosDownListPrices' | 'eoListPrices';
    renewKey: 'cosDownRenewPrices' | 'eoRenewPrices';
    label: string;
    hint: string;
    bounds: { sizeGb: number; label: string }[];
  }[] = isCdn
    ? [{ listKey: 'eoListPrices', renewKey: 'eoRenewPrices', label: 'EO 全球流量包', hint: 'Global Package', bounds: EO_PACKAGE_BOUNDS }]
    : [{ listKey: 'cosDownListPrices', renewKey: 'cosDownRenewPrices', label: 'COS 外网下行资源包', hint: 'COS Egress', bounds: COS_PACKAGE_BOUNDS }];

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
              : `当前 ${formatInt((vars.basicViewers ?? 0) + (vars.premiumViewers ?? 0))} 人 · 安全边际 ${
                  neutral.safetyMargin == null ? '—' : `${formatRate(neutral.safetyMargin * 100, 0)}%`
                }`}
          </div>
        </Kpi>
        <Kpi en="Break-even Library" cn="盈亏平衡片库规模" accent="text-amber-400">
          <div className="text-xl font-semibold tabular-nums text-amber-400">
            {neutral.breakEvenTitles != null ? `${formatInt(neutral.breakEvenTitles)} 部` : '—'}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">双副本存储合计 ¥ {formatCny(neutral.storageMonthlyCny)}/月</div>
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
          cn="cf & THK COS 全变量输入（即时联动测算，不落库；点击保存后新增一版快照并记录保存日期）"
          right={
            <span className="text-[11px] text-slate-500">
              {error ? (
                <span className="text-rose-400">{error}</span>
              ) : savedAt ? (
                <span className={isHistorical ? 'text-amber-400' : 'text-emerald-400'}>
                  {isHistorical ? '历史版本' : '已保存'} {fmtSavedAt(savedAt)}
                </span>
              ) : (
                'A~G 成本维度 · L/M 收入维度'
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
                {g.en === 'COS Traffic' ? (
                  <>
                    <div className="col-span-full space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                      <div
                        className="grid gap-3 md:[grid-template-columns:var(--top-control-columns)]"
                        style={{ ['--top-control-columns' as string]: `repeat(${topControlCount}, minmax(0, 1fr))` }}
                      >
                        <Field label="流量链路" hint="Traffic Path">
                          <Select value={draft.trafficMode} onChange={(e) => set('trafficMode', e.target.value)}>
                            <option value="direct">直连 COS · 外网下行</option>
                            <option value="cdn">经 EO · 边缘下行 + 回源</option>
                          </Select>
                        </Field>
                        {isCdn ? (
                          <Field label="EO 缓存命中率 %" hint="回源 = 全量 ×(1−λ)">
                            <div className="relative">
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                step="1"
                                value={draft.cacheHitRatioPct}
                                onChange={(e) => set('cacheHitRatioPct', e.target.value)}
                                placeholder="如 90"
                                className="pr-10"
                              />
                              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-slate-500">
                                %
                              </span>
                            </div>
                          </Field>
                        ) : null}
                        <Field label="计价模式" hint="Pricing Mode">
                          <Select value={draft.cdnPricingMode} onChange={(e) => set('cdnPricingMode', e.target.value)}>
                            <option value="tiered">{isCdn ? '按量 · 阶梯累进' : '按量 · 官方单价'}</option>
                            <option value="package">预付费 · 流量包</option>
                          </Select>
                        </Field>
                        {isPackage ? (
                          <Field label="资源包价格档" hint="Package Price">
                            <Select value={draft.cdnPackagePrice} onChange={(e) => set('cdnPackagePrice', e.target.value)}>
                              <option value="renew">连续包月 · 续订价</option>
                              <option value="list">单次购买 · 刊例价</option>
                            </Select>
                          </Field>
                        ) : null}
                      </div>

                      {isCdn ? (
                        <div className="grid grid-cols-3 gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                          <Field label="EO 套餐月费" hint="Plan ¥/月">
                            <div className="relative">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={draft.eoPlanMonthlyCny}
                                onChange={(e) => set('eoPlanMonthlyCny', e.target.value)}
                                placeholder="如 29.9"
                                className="pr-10"
                              />
                              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-slate-500">
                                ¥/月
                              </span>
                            </div>
                          </Field>
                          <Field label="套餐内含流量" hint="Included / mo">
                            <div className="relative">
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                value={draft.eoPlanIncludedGb}
                                onChange={(e) => set('eoPlanIncludedGb', e.target.value)}
                                placeholder="如 50"
                                className="pr-10"
                              />
                              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-slate-500">
                                GB
                              </span>
                            </div>
                          </Field>
                          <Field
                            label="地区抵扣系数"
                            hint="Deduction Ratio"
                          >
                            <div className="relative">
                              <Input
                                type="number"
                                min="1"
                                step="0.01"
                                value={draft.eoDeductionRatio}
                                onChange={(e) => set('eoDeductionRatio', e.target.value)}
                                placeholder="亚太1区 2.49"
                                className="pr-10"
                              />
                              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-slate-500">
                                ×
                              </span>
                            </div>
                          </Field>
                          <div className="col-span-3 text-[10px] leading-relaxed text-slate-500">
                            EO 套餐内含流量先抵扣；超出部分按所选口径计费。流量包为全球通用，可在 100GB / 500GB /
                            1TB / 5TB / 10TB / 50TB / 200TB / 1PB / 5PB / 10PB / 50PB 档位中组合购买，并按地区抵扣系数
                            换算（亚太1区 = 2.49，即 1GB 流量包只抵 1/2.49 GB 流量）。回源始终按 COS 回源单价计费。
                          </div>
                        </div>
                      ) : null}

                      {isCdn ? (
                        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-400">
                              COS 回源单价（官方口径按 GB 单价计费；仅对未命中流量生效）
                            </span>
                          </div>
                          <Field label="COS 回源单价" hint="Origin ¥/GB">
                            <div className="relative">
                              <Input
                                type="number"
                                min="0"
                                step="0.0001"
                                value={draft.cosOriginPerGbCny}
                                onChange={(e) => set('cosOriginPerGbCny', e.target.value)}
                                placeholder="如 0.15"
                                className="pr-12"
                              />
                              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-slate-500">
                                ¥/GB
                              </span>
                            </div>
                          </Field>
                        </div>
                      ) : null}

                      {!isCdn && !isPackage ? (
                        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-400">
                              COS 外网下行按量单价（官方口径按 GB 单价计费）
                            </span>
                          </div>
                          <Field label="COS 外网下行单价" hint="COS Egress ¥/GB">
                            <div className="relative">
                              <Input
                                type="number"
                                min="0"
                                step="0.0001"
                                value={draft.cosDownPerGbCny}
                                onChange={(e) => set('cosDownPerGbCny', e.target.value)}
                                placeholder="如 0.68"
                                className="pr-12"
                              />
                              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-slate-500">
                                ¥/GB
                              </span>
                            </div>
                          </Field>
                        </div>
                      ) : null}

                      {isPackage ? (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-400">
                              {isCdn
                                ? 'EO 全球流量包（预付费：在 100GB 到 50PB 档位中按月覆盖超出套餐流量的最省整包组合，上为刊例价 / 下为续订价）；COS 回源仍按单价计费'
                                : 'COS 外网下行资源包（预付费：在 100GB 到 1PB 档位中按月覆盖流量的最省整包组合，上为刊例价 / 下为续订价）'}
                            </span>
                          </div>
                          {packageRows.map((row) => (
                            <div key={row.listKey}>
                              <div className="mb-1 flex items-baseline gap-2">
                                <span className="text-[11px] font-medium text-slate-300">{row.label}</span>
                                <span className="text-[10px] text-slate-600">{row.hint}</span>
                              </div>
                              <div className="grid grid-cols-6 gap-2">
                                {row.bounds.map((b, i) => (
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
                      ) : (
                        <>
                          {isCdn ? (
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] text-slate-400">
                                EO 超量阶梯（月度阶梯累进：每档仅对落入该档区间的流量计价，再求和）；COS 回源按单价计费
                              </span>
                            </div>
                          ) : null}
                          {tierRows.map((row) => (
                            <div key={row.key}>
                              <div className="mb-1 flex items-baseline gap-2">
                                <span className="text-[11px] font-medium text-slate-300">{row.label}</span>
                                <span className="text-[10px] text-slate-600">{row.hint}</span>
                              </div>
                              <div
                                className="grid gap-2"
                                style={{ gridTemplateColumns: `repeat(${row.bounds.length}, minmax(0, 1fr))` }}
                              >
                                {row.bounds.map((b, i) => (
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
          <ThkcosLineChart
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
                    单人流量成本：<span className="text-slate-200">¥ {formatCny(m.trafficPerViewerCny)}</span>
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
          <ThkcosLineChart
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
                      c.group === 'traffic'
                        ? 'bg-amber-500/80'
                        : c.group === 'sync'
                          ? 'bg-violet-500/80'
                          : c.group === 'storage'
                            ? 'bg-sky-500/80'
                            : 'bg-slate-500/80'
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
            <div className="mt-1 flex flex-wrap gap-4 border-t border-slate-800 pt-2 text-[11px] text-slate-500">
              <span>基座固定 ¥ {formatCny(neutral.baseFixedCny)}</span>
              <span>存储（双副本）¥ {formatCny(neutral.storageMonthlyCny)}</span>
              <span>增量同步 ¥ {formatCny(neutral.syncMonthlyCny)}</span>
              <span>
                流量 {neutral.trafficTb} TB · 综合单价 ¥ {formatCny(neutral.blendedPerTbCny)}/TB
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

      {/* 删除历史版本确认弹窗 */}
      <Modal
        open={pendingDelete != null}
        title="确认删除历史版本"
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              确认删除
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          确认删除历史版本「<span className="font-medium text-slate-100">{pendingDelete?.when}</span>」的测算假设？
        </p>
        <p className="mt-2 text-xs text-rose-400/90">删除后不可恢复。</p>
      </Modal>
    </div>
  );
}
