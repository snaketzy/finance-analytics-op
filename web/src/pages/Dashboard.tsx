import { useState, type ReactNode } from 'react';
import { useGetDashboardSummaryQuery, useGetProjectsQuery, type DashboardQuery } from '../api';
import { Card, CardHeader, Empty, PageHeader } from '../components/Card';
import { DateInput, Field, Select } from '../components/Field';
import { Money } from '../components/Money';
import { TrendChart } from '../components/TrendChart';
import { domainLabel } from '../lib/domains';
import { formatDate, formatInt, formatRate } from '../lib/format';

function KpiCard({
  en,
  cn,
  tone,
  children,
}: {
  en: string;
  cn: string;
  tone: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className={`text-sm font-semibold ${tone}`}>{en}</div>
      <div className="mb-3 text-[11px] text-slate-500">{cn}</div>
      {children}
    </Card>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-slate-500">
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />
        收入
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" />
        支出
      </span>
    </div>
  );
}

export default function Dashboard() {
  const [projectId, setProjectId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: projects = [] } = useGetProjectsQuery();

  const args: DashboardQuery = {
    ...(projectId ? { projectId: Number(projectId) } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const { data, isLoading, isError } = useGetDashboardSummaryQuery(args);

  const netCny = data?.netCny ?? 0;
  const netClass = netCny >= 0 ? 'text-emerald-400' : 'text-rose-400';

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 md:px-12">
        <PageHeader en="Dashboard" cn="总览 · 多项目聚合核心经营指标">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-48">
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

        {isLoading && <div className="mb-4 text-xs text-slate-500">加载中…</div>}
        {isError && (
          <div className="mb-4 text-xs text-rose-400">
            加载失败，请确认后端服务已启动（http://localhost:8792）。
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
          <span>
            当前汇率 Current FX：{' '}
            <span className="text-slate-300">1 USD = ¥ {formatRate(data?.fxRate)}</span>
          </span>
          <span>
            汇率日期：<span className="text-slate-300">{formatDate(data?.fxRateDate)}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard en="Revenue" cn="收入" tone="text-emerald-400">
            <Money cny={data?.revenueCny} usd={data?.revenueUsd} size="xl" />
          </KpiCard>
          <KpiCard en="Expense" cn="支出" tone="text-rose-400">
            <Money
              cny={data?.expenseCny}
              usd={data?.expenseUsd}
              size="xl"
              mainClass="text-rose-400"
            />
          </KpiCard>
          <KpiCard en="Net" cn="净额" tone="text-indigo-400">
            <Money cny={data?.netCny} usd={data?.netUsd} size="xl" mainClass={netClass} />
          </KpiCard>
          <KpiCard en="Transactions" cn="流水笔数" tone="text-slate-300">
            <div className="text-2xl font-semibold tabular-nums text-slate-100">
              {formatInt(data?.txnCount)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">条记录 records</div>
          </KpiCard>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader en="Monthly Trend" cn="月度趋势（收入 / 支出）" right={<Legend />} />
            <div className="p-5">
              {data && data.monthly.length > 0 ? <TrendChart data={data.monthly} /> : <Empty />}
            </div>
          </Card>

          <Card>
            <CardHeader en="Top Categories" cn="金额 Top 10 科目" />
            <div className="p-3">
              {data && data.topCategories.length > 0 ? (
                <ol className="space-y-1">
                  {data.topCategories.map((c, i) => (
                    <li
                      key={c.categoryId}
                      className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-slate-800/50"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="w-5 shrink-0 text-right text-[11px] text-slate-600">
                          {i + 1}
                        </span>
                        <div className="min-w-0 leading-tight">
                          <div className="truncate text-xs text-slate-200">{c.nameCn}</div>
                          <div className="truncate text-[11px] text-slate-500">{c.nameEn}</div>
                        </div>
                      </div>
                      <Money
                        cny={c.amountCny}
                        usd={c.amountUsd}
                        size="sm"
                        align="right"
                        mainClass={c.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}
                      />
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty />
              )}
            </div>
          </Card>
        </div>

        <div className="mt-6">
          <Card>
            <CardHeader en="By Domain" cn="按领域分布" />
            <div className="overflow-x-auto p-3">
              {data && data.byDomain.length > 0 ? (
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2 font-medium">领域 Domain</th>
                      <th className="px-3 py-2 text-right font-medium">收入 Income</th>
                      <th className="px-3 py-2 text-right font-medium">支出 Expense</th>
                      <th className="px-3 py-2 text-right font-medium">净额 Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byDomain.map((d) => {
                      const type = d.incomeCny !== 0 ? 'income' : 'expense';
                      const label = domainLabel(d.domain, type);
                      const netRowCny = d.incomeCny - d.expenseCny;
                      return (
                        <tr key={d.domain} className="border-t border-slate-800/70">
                          <td className="px-3 py-2.5">
                            <div className="leading-tight">
                              <div className="text-sm text-slate-200">{label.cn}</div>
                              <div className="text-[11px] text-slate-500">{label.en}</div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {d.incomeCny !== 0 || d.incomeUsd !== 0 ? (
                              <Money cny={d.incomeCny} usd={d.incomeUsd} size="sm" align="right" />
                            ) : (
                              <span className="text-xs text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {d.expenseCny !== 0 || d.expenseUsd !== 0 ? (
                              <Money
                                cny={d.expenseCny}
                                usd={d.expenseUsd}
                                size="sm"
                                align="right"
                                mainClass="text-rose-400"
                              />
                            ) : (
                              <span className="text-xs text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Money
                              cny={netRowCny}
                              usd={d.incomeUsd - d.expenseUsd}
                              size="sm"
                              align="right"
                              mainClass={netRowCny >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <Empty />
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
