import { useState } from 'react';
import {
  useGetCostAnalyticsQuery,
  useGetProjectsQuery,
  useGetRevenueAnalyticsQuery,
  type AnalyticsBreakdown,
  type AnalyticsGroupBy,
  type Direction,
} from '../api';
import { Card, CardHeader, Empty, PageHeader } from '../components/Card';
import { DateInput, Field, Select } from '../components/Field';
import { Money } from '../components/Money';
import { EXPENSE_DOMAINS, INCOME_DOMAINS, domainLabel } from '../lib/domains';
import { formatCny, formatInt, formatRate } from '../lib/format';

const GROUP_LABEL: Record<AnalyticsGroupBy, { cn: string; en: string }> = {
  domain: { cn: '领域', en: 'Domain' },
  category: { cn: '科目', en: 'Category' },
  project: { cn: '项目', en: 'Project' },
  account: { cn: '账户', en: 'Account' },
  month: { cn: '月份', en: 'Month' },
};

const GROUPS: AnalyticsGroupBy[] = ['domain', 'category', 'project', 'account', 'month'];

function rowLabel(b: AnalyticsBreakdown, direction: Direction): { cn: string; en: string } {
  if (b.nameCn || b.nameEn) {
    return { cn: b.nameCn ?? b.key, en: b.nameEn ?? '' };
  }
  if (b.domain) return domainLabel(b.domain, direction);
  return { cn: b.key, en: '' };
}

function DeltaCell({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return <span className="text-xs text-slate-600">—</span>;
  const up = pct > 0;
  return (
    <span className={`text-sm font-semibold tabular-nums ${up ? 'text-rose-400' : pct < 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
      {up ? '▲' : pct < 0 ? '▼' : '•'} {formatRate(Math.abs(pct), 1)}%
    </span>
  );
}

export function AnalyticsView({ direction }: { direction: Direction }) {
  const isCost = direction === 'expense';
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>(isCost ? 'domain' : 'project');
  const [projectId, setProjectId] = useState('');
  const [domain, setDomain] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: projects = [] } = useGetProjectsQuery();

  const args = {
    groupBy,
    ...(projectId ? { projectId: Number(projectId) } : {}),
    ...(domain ? { domain } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const costQuery = useGetCostAnalyticsQuery(args, { skip: !isCost });
  const revenueQuery = useGetRevenueAnalyticsQuery(args, { skip: isCost });
  const { data, isLoading, isError } = isCost ? costQuery : revenueQuery;

  const domainMap = isCost ? EXPENSE_DOMAINS : INCOME_DOMAINS;
  const maxMonthly = Math.max(1, ...(data?.monthly ?? []).map((m) => m.cny));
  const total = data?.total;

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 md:px-12">
        <PageHeader
          en={isCost ? 'Cost Analytics' : 'Revenue Analytics'}
          cn={
            isCost
              ? '成本分析 · 按领域 / 科目 / 项目 / 账户 / 月份多维下钻'
              : '收入分析 · 交易层多维下钻与同环比'
          }
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field label="Group By">
                <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as AnalyticsGroupBy)}>
                  {GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {GROUP_LABEL[g].cn} {GROUP_LABEL[g].en}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-44">
              <Field label="Project">
                <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">全部项目</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nameCn} {p.nameEn}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-40">
              <Field label="Domain">
                <Select value={domain} onChange={(e) => setDomain(e.target.value)}>
                  <option value="">全部领域</option>
                  {Object.entries(domainMap).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.cn} {v.en}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-40">
              <Field label="From">
                <DateInput value={from} onChange={setFrom} />
              </Field>
            </div>
            <div className="w-40">
              <Field label="To">
                <DateInput value={to} onChange={setTo} />
              </Field>
            </div>
          </div>
        </PageHeader>

        {isError && (
          <div className="mb-4 text-xs text-rose-400">加载失败，请确认后端服务已启动（http://localhost:8792）。</div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-5">
            <div className={`text-sm font-semibold ${isCost ? 'text-rose-400' : 'text-emerald-400'}`}>
              {isCost ? 'Total Cost' : 'Total Revenue'}
            </div>
            <div className="mb-3 text-[11px] text-slate-500">{isCost ? '支出合计' : '收入合计'}</div>
            <Money
              cny={total?.cny}
              usd={total?.usd}
              size="xl"
              mainClass={isCost ? 'text-rose-400' : 'text-emerald-400'}
            />
          </Card>
          <Card className="p-5">
            <div className="text-sm font-semibold text-slate-300">Transactions</div>
            <div className="mb-3 text-[11px] text-slate-500">流水笔数</div>
            <div className="text-2xl font-semibold tabular-nums text-slate-100">
              {formatInt(total?.txnCount)}
            </div>
          </Card>
          {isCost ? (
            <>
              <Card className="p-5">
                <div className="text-sm font-semibold text-emerald-400">Revenue (Ref.)</div>
                <div className="mb-3 text-[11px] text-slate-500">同期收入对照</div>
                <Money cny={total?.revenueCny} usd={total?.revenueUsd} size="xl" mainClass="text-emerald-400" />
              </Card>
              <Card className="p-5">
                <div className="text-sm font-semibold text-indigo-400">Cost Ratio</div>
                <div className="mb-3 text-[11px] text-slate-500">成本收入比</div>
                <div className="text-2xl font-semibold tabular-nums text-indigo-300">
                  {total?.costRatio === null || total?.costRatio === undefined ? (
                    '—'
                  ) : (
                    <>
                      {formatRate(total.costRatio, 1)}
                      <span className="text-base text-slate-500">%</span>
                    </>
                  )}
                </div>
              </Card>
            </>
          ) : (
            <>
              <Card className="p-5">
                <div className="text-sm font-semibold text-slate-300">Current Month</div>
                <div className="mb-3 text-[11px] text-slate-500">本期（区间内最后一个月）</div>
                <div className="text-sm text-slate-400">{data?.comparison.current.ym ?? '—'}</div>
                <Money
                  cny={data?.comparison.current.cny}
                  usd={data?.comparison.current.usd}
                  size="lg"
                  mainClass="text-emerald-400"
                />
              </Card>
              <Card className="p-5">
                <div className="text-sm font-semibold text-slate-300">MoM / YoY</div>
                <div className="mb-3 text-[11px] text-slate-500">环比 / 同比</div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-slate-500">MoM 环比</div>
                    <DeltaCell pct={data?.comparison.mom.deltaPct} />
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-slate-500">YoY 同比</div>
                    <DeltaCell pct={data?.comparison.yoy.deltaPct} />
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardHeader en="Breakdown" cn={`按「${GROUP_LABEL[groupBy].cn}」下钻排名`} />
            {isLoading ? (
              <Empty text="加载中…" />
            ) : (data?.breakdown ?? []).length === 0 ? (
              <Empty />
            ) : (
              <div className="overflow-x-auto p-3">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2 font-medium">维度 Dimension</th>
                      <th className="px-3 py-2 text-right font-medium">金额 Amount</th>
                      <th className="px-3 py-2 text-right font-medium">占比 Share</th>
                      <th className="px-3 py-2 text-right font-medium">笔数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.breakdown ?? []).map((b) => {
                      const label = rowLabel(b, direction);
                      return (
                        <tr key={b.key} className="border-t border-slate-800/70 hover:bg-slate-800/30">
                          <td className="px-3 py-2.5">
                            <div className="leading-tight">
                              <div className="text-sm text-slate-200">{label.cn}</div>
                              {label.en && <div className="text-[11px] text-slate-500">{label.en}</div>}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Money
                              cny={b.cny}
                              usd={b.usd}
                              size="sm"
                              align="right"
                              mainClass={isCost ? 'text-rose-300' : 'text-emerald-300'}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-800">
                                <div
                                  className={`h-full rounded-full ${isCost ? 'bg-rose-500' : 'bg-emerald-500'}`}
                                  style={{ width: `${Math.min(100, b.share)}%` }}
                                />
                              </div>
                              <span className="w-12 text-right text-xs tabular-nums text-slate-400">
                                {formatRate(b.share, 1)}%
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-500">
                            {formatInt(b.txnCount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader en="Monthly Trend" cn="月度趋势与累计" />
            <div className="p-5">
              {isLoading ? (
                <Empty text="加载中…" />
              ) : (data?.monthly ?? []).length === 0 ? (
                <Empty />
              ) : (
                <div className="flex h-56 items-stretch gap-3 overflow-x-auto pb-1">
                  {(data?.monthly ?? []).map((m) => (
                    <div key={m.ym} className="flex h-full min-w-[44px] flex-1 flex-col items-center gap-2">
                      <div className="flex w-full flex-1 items-end justify-center">
                        <div
                          title={`${m.ym} ¥${formatCny(m.cny)} · 累计 ¥${formatCny(m.cumCny)}`}
                          className={`w-4 rounded-t transition-all ${
                            isCost ? 'bg-rose-500/80 hover:bg-rose-400' : 'bg-emerald-500/80 hover:bg-emerald-400'
                          }`}
                          style={{ height: `${(m.cny / maxMonthly) * 100}%`, minHeight: m.cny > 0 ? 2 : 0 }}
                        />
                      </div>
                      <span className="whitespace-nowrap text-[11px] text-slate-500">{m.ym}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-800 pt-4 text-xs">
                <div>
                  <div className="text-[11px] text-slate-500">本期 MoM 环比</div>
                  <DeltaCell pct={data?.comparison.mom.deltaPct} />
                  <div className="mt-0.5 text-[11px] text-slate-600">
                    上期 ¥{formatCny(data?.comparison.mom.cny)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">本期 YoY 同比</div>
                  <DeltaCell pct={data?.comparison.yoy.deltaPct} />
                  <div className="mt-0.5 text-[11px] text-slate-600">
                    去年同期 ¥{formatCny(data?.comparison.yoy.cny)}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
