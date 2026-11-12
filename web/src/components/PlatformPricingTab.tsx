import { useMemo, useState } from 'react';
import { Card, CardHeader } from './Card';

/* ------------------------------------------------------------------ */
/* 数据：国内外主流在线影视平台收费档位                                  */
/* 采集时间 2026-11，仅作定价参考，最终以各平台官方页面为准。             */
/* ------------------------------------------------------------------ */

type Region = 'cn' | 'intl';
type Currency = 'CNY' | 'USD';

type PriceRow = {
  region: Region;
  platformCn: string;
  platformEn: string;
  tier: string;
  price: string;
  monthly: number;
  currency: Currency;
  note: string;
};

const ROWS: PriceRow[] = [
  /* ---------------- 国内 ---------------- */
  {
    region: 'cn',
    platformCn: '爱奇艺',
    platformEn: 'iQIYI',
    tier: '黄金VIP',
    price: '¥25 / 月（连续包月）· 单月 ¥30',
    monthly: 25,
    currency: 'CNY',
    note: '手机 / 平板 / 电脑 · 年卡约 ¥258',
  },
  {
    region: 'cn',
    platformCn: '爱奇艺',
    platformEn: 'iQIYI',
    tier: '白金VIP',
    price: '¥35 / 月',
    monthly: 35,
    currency: 'CNY',
    note: '增加电视端（奇异果 TV）· 年卡约 ¥348',
  },
  {
    region: 'cn',
    platformCn: '爱奇艺',
    platformEn: 'iQIYI',
    tier: '星钻VIP',
    price: '¥40 / 月',
    monthly: 40,
    currency: 'CNY',
    note: '全终端 + 体育 / 动漫 / VR · 年卡约 ¥428',
  },
  {
    region: 'cn',
    platformCn: '腾讯视频',
    platformEn: 'Tencent Video',
    tier: '腾讯视频VIP',
    price: '¥25 / 月（连续包月）· 单月 ¥30',
    monthly: 25,
    currency: 'CNY',
    note: '2026-04 起由 ¥20 上调 · 连续包年 ¥238',
  },
  {
    region: 'cn',
    platformCn: '腾讯视频',
    platformEn: 'Tencent Video',
    tier: '超级影视 SVIP',
    price: '¥35 / 月（连续包月）· 单月 ¥50',
    monthly: 35,
    currency: 'CNY',
    note: '含 TV 端（极光 TV）· 连续包年 ¥348',
  },
  {
    region: 'cn',
    platformCn: '优酷',
    platformEn: 'Youku',
    tier: '优酷VIP',
    price: '首月 ¥12，次月起 ¥25 / 月',
    monthly: 25,
    currency: 'CNY',
    note: '手机 / 平板 / 电脑 · 年卡原价 ¥258',
  },
  {
    region: 'cn',
    platformCn: '优酷',
    platformEn: 'Youku',
    tier: '酷喵VIP',
    price: '¥208 / 年',
    monthly: 17.33,
    currency: 'CNY',
    note: '含电视端 · 折合月均 ≈ ¥17.3',
  },
  {
    region: 'cn',
    platformCn: '芒果TV',
    platformEn: 'MGTV',
    tier: '芒果VIP',
    price: '¥15 / 月（连续包月）',
    monthly: 15,
    currency: 'CNY',
    note: '不含电视端 · 连续包年 ¥178',
  },
  {
    region: 'cn',
    platformCn: '芒果TV',
    platformEn: 'MGTV',
    tier: '全屏影视会员',
    price: '¥25 / 月（连续包月）· 单月 ¥35',
    monthly: 25,
    currency: 'CNY',
    note: '含电视端 · 连续包年 ¥330',
  },
  {
    region: 'cn',
    platformCn: '哔哩哔哩',
    platformEn: 'bilibili',
    tier: '大会员',
    price: '月度 ¥25 · 季度 ¥68 · 年度 ¥168',
    monthly: 25,
    currency: 'CNY',
    note: '连续包年 ¥148 · 番剧 / 画质 / 装扮',
  },
  {
    region: 'cn',
    platformCn: '哔哩哔哩',
    platformEn: 'bilibili',
    tier: '超级大会员',
    price: '月度 ¥35 · 季度 ¥98 · 年度 ¥188',
    monthly: 35,
    currency: 'CNY',
    note: '含更多权益',
  },

  /* ---------------- 海外（美区定价） ---------------- */
  {
    region: 'intl',
    platformCn: 'Netflix',
    platformEn: 'Netflix',
    tier: 'Standard with Ads',
    price: '$8.99 / 月',
    monthly: 8.99,
    currency: 'USD',
    note: '含广告 · 1080p · 2 台设备',
  },
  {
    region: 'intl',
    platformCn: 'Netflix',
    platformEn: 'Netflix',
    tier: 'Standard',
    price: '$19.99 / 月',
    monthly: 19.99,
    currency: 'USD',
    note: '无广告 · 1080p · 可加 1 位额外成员',
  },
  {
    region: 'intl',
    platformCn: 'Netflix',
    platformEn: 'Netflix',
    tier: 'Premium',
    price: '$26.99 / 月',
    monthly: 26.99,
    currency: 'USD',
    note: '4K + HDR · 可加 2 位额外成员',
  },
  {
    region: 'intl',
    platformCn: 'Disney+',
    platformEn: 'Disney+',
    tier: 'Basic / Standard（含广告）',
    price: '$11.99 / 月',
    monthly: 11.99,
    currency: 'USD',
    note: '最高 4K UHD & HDR',
  },
  {
    region: 'intl',
    platformCn: 'Disney+',
    platformEn: 'Disney+',
    tier: 'Premium（无广告）',
    price: '$18.99 / 月',
    monthly: 18.99,
    currency: 'USD',
    note: 'Dolby Atmos · 4 台并发',
  },
  {
    region: 'intl',
    platformCn: 'HBO Max',
    platformEn: 'HBO Max (Max)',
    tier: 'Basic With Ads',
    price: '$10.99 / 月 · $109.99 / 年',
    monthly: 10.99,
    currency: 'USD',
    note: '1080p · 2 台设备',
  },
  {
    region: 'intl',
    platformCn: 'HBO Max',
    platformEn: 'HBO Max (Max)',
    tier: 'Standard',
    price: '$18.49 / 月 · $184.99 / 年',
    monthly: 18.49,
    currency: 'USD',
    note: '无广告 · 2 台设备 · 30 下载',
  },
  {
    region: 'intl',
    platformCn: 'HBO Max',
    platformEn: 'HBO Max (Max)',
    tier: 'Premium',
    price: '$22.99 / 月 · $229.99 / 年',
    monthly: 22.99,
    currency: 'USD',
    note: '4K + 杜比 · 4 台设备',
  },
  {
    region: 'intl',
    platformCn: 'Amazon Prime Video',
    platformEn: 'Amazon Prime Video',
    tier: 'Prime Video（影视独立订阅）',
    price: '$8.99 / 月',
    monthly: 8.99,
    currency: 'USD',
    note: '含广告 · 仅影视，无购物权益',
  },
  {
    region: 'intl',
    platformCn: 'Amazon Prime Video',
    platformEn: 'Amazon Prime Video',
    tier: 'Prime（综合会员）',
    price: '$14.99 / 月 · $139 / 年',
    monthly: 14.99,
    currency: 'USD',
    note: '影视 + 配送等综合权益',
  },
  {
    region: 'intl',
    platformCn: 'Amazon Prime Video',
    platformEn: 'Amazon Prime Video',
    tier: 'Ultra 加购（无广告 + 4K）',
    price: '+$4.99 / 月',
    monthly: 4.99,
    currency: 'USD',
    note: '在 Prime 基础上升级',
  },
  {
    region: 'intl',
    platformCn: 'Apple TV+',
    platformEn: 'Apple TV',
    tier: '单一档位',
    price: '$14.99 / 月 · $119 / 年',
    monthly: 14.99,
    currency: 'USD',
    note: '无广告 · 4K · 家庭共享 6 人',
  },
  {
    region: 'intl',
    platformCn: 'Paramount+',
    platformEn: 'Paramount+',
    tier: 'Essential（含广告）',
    price: '$8.99 / 月 · $89.99 / 年',
    monthly: 8.99,
    currency: 'USD',
    note: '3 台设备 · 不含本地 CBS',
  },
  {
    region: 'intl',
    platformCn: 'Paramount+',
    platformEn: 'Paramount+',
    tier: 'Premium（无广告）',
    price: '$13.99 / 月',
    monthly: 13.99,
    currency: 'USD',
    note: '含 SHOWTIME · 本地 CBS · 下载',
  },
  {
    region: 'intl',
    platformCn: 'YouTube Premium',
    platformEn: 'YouTube Premium',
    tier: 'Individual 个人版',
    price: '$15.99 / 月 · $159.99 / 年',
    monthly: 15.99,
    currency: 'USD',
    note: '无广告 · 后台播放 · 含音乐',
  },
];

/* ------------------------------------------------------------------ */
/* 展示辅助                                                            */
/* ------------------------------------------------------------------ */

const REGION_META: Record<Region, { cn: string; en: string }> = {
  cn: { cn: '国内平台', en: 'China' },
  intl: { cn: '海外平台', en: 'International' },
};

const fmtMoney = (v: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

type Filter = 'all' | Region;

export default function PlatformPricingTab({ fxRate }: { fxRate: number | null }) {
  const [filter, setFilter] = useState<Filter>('all');

  const groups = useMemo(() => {
    const list = ROWS.filter((r) => filter === 'all' || r.region === filter);
    const map = new Map<string, { cn: string; en: string; region: Region; rows: PriceRow[] }>();
    for (const r of list) {
      const key = `${r.region}:${r.platformEn}`;
      let g = map.get(key);
      if (!g) {
        g = { cn: r.platformCn, en: r.platformEn, region: r.region, rows: [] };
        map.set(key, g);
      }
      g.rows.push(r);
    }
    return [...map.values()];
  }, [filter]);

  const sections: Region[] = filter === 'all' ? ['cn', 'intl'] : [filter];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
        <div className="text-[11px] leading-relaxed text-slate-500">
          数据采集于 <span className="text-slate-300">2026-11</span>，为公开档位参考价，仅作定价对标之用，最终以各平台官方页面为准。
          {fxRate ? <span className="ml-1">美元档位按汇率 1 USD ≈ ¥{fmtMoney(fxRate)} 折算人民币月均。</span> : null}
        </div>
        <div className="flex gap-1">
          {(
            [
              { key: 'all', label: '全部' },
              { key: 'cn', label: '国内' },
              { key: 'intl', label: '海外' },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                filter === item.key
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {sections.map((region) => {
        const regionGroups = groups.filter((g) => g.region === region);
        if (regionGroups.length === 0) return null;
        return (
          <Card key={region}>
            <CardHeader
              en={`${REGION_META[region].en} Platforms`}
              cn={`${REGION_META[region].cn} · 收费档位（${regionGroups.length} 家）`}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 text-left font-medium">平台 Platform</th>
                    <th className="px-4 py-2 text-left font-medium">档位 Tier</th>
                    <th className="px-4 py-2 text-left font-medium">官方价 Price</th>
                    <th className="px-4 py-2 text-right font-medium">折合月均 Monthly</th>
                    <th className="px-4 py-2 text-left font-medium">备注 Note</th>
                  </tr>
                </thead>
                <tbody>
                  {regionGroups.map((g) =>
                    g.rows.map((r, i) => (
                      <tr
                        key={`${g.en}-${r.tier}`}
                        className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30"
                      >
                        <td className="px-4 py-2.5 align-top">
                          {i === 0 ? (
                            <div className="leading-tight">
                              <div className="text-slate-200">{r.platformEn}</div>
                              <div className="text-[11px] text-slate-500">{r.platformCn}</div>
                            </div>
                          ) : (
                            <span className="text-slate-600">〃</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 align-top text-slate-300">{r.tier}</td>
                        <td className="px-4 py-2.5 align-top tabular-nums text-slate-300">{r.price}</td>
                        <td className="px-4 py-2.5 align-top text-right tabular-nums">
                          <div className="text-slate-100">
                            {r.currency === 'CNY' ? '¥' : '$'}
                            {fmtMoney(r.monthly)}
                          </div>
                          {r.currency === 'USD' && fxRate ? (
                            <div className="text-[11px] text-slate-500">≈ ¥{fmtMoney(r.monthly * fxRate)}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5 align-top text-[11px] text-slate-500">{r.note}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
