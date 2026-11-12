import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  extractErrorMessage,
  useCreateBudgetMutation,
  useDeleteBudgetMutation,
  useGetBudgetsQuery,
  useGetCategoriesQuery,
  useGetProjectsQuery,
  type Budget,
} from '../api';
import { Card, CardHeader, Empty, PageHeader } from '../components/Card';
import { Button, Field, Input, MonthInput, Select } from '../components/Field';
import { Modal } from '../components/Modal';
import { Money } from '../components/Money';
import { buildCategoryGroups } from '../lib/categories';
import { domainLabel } from '../lib/domains';
import { formatInt, formatRate } from '../lib/format';

function CategoryOptions() {
  const { data: categories = [] } = useGetCategoriesQuery({ type: 'expense' });
  const groups = useMemo(() => buildCategoryGroups(categories), [categories]);
  return (
    <>
      {groups.map((g) => {
        const items = g.children.length ? g.children : [g.parent];
        return (
          <optgroup key={g.parent.id} label={`${g.parent.nameCn} ${g.parent.nameEn}`}>
            {items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameCn} {c.nameEn}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

/** 执行率进度条：>100% 变红并显示超额。 */
function UsageBar({ rate, over }: { rate: number | null; over: boolean }) {
  if (rate === null) return <span className="text-xs text-slate-600">—</span>;
  const width = Math.min(100, rate);
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full ${over ? 'bg-rose-500' : rate > 85 ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={`w-14 text-right text-xs tabular-nums ${over ? 'text-rose-400' : 'text-slate-300'}`}>
        {formatRate(rate, 1)}%
      </span>
    </div>
  );
}

type FormState = {
  projectId: string;
  categoryId: string;
  periodType: 'monthly' | 'yearly';
  period: string;
  amountCny: string;
};

const emptyForm = (): FormState => ({
  projectId: '',
  categoryId: '',
  periodType: 'monthly',
  period: new Date().toISOString().slice(0, 7),
  amountCny: '',
});

export default function Budgets() {
  const [projectId, setProjectId] = useState('');
  const [period, setPeriod] = useState('');
  const [overOnly, setOverOnly] = useState(false);

  const { data: projects = [] } = useGetProjectsQuery();
  const { data, isLoading } = useGetBudgetsQuery({
    ...(projectId ? { projectId: Number(projectId) } : {}),
    ...(period ? { period } : {}),
    ...(overOnly ? { overOnly: '1' } : {}),
  });

  const [createOne, { isLoading: creating }] = useCreateBudgetMutation();
  const [deleteOne] = useDeleteBudgetMutation();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(emptyForm());
      setError(null);
    }
  }, [open]);

  const summary = data?.summary;
  const items = data?.items ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amount = Number(form.amountCny);
    if (!form.projectId || !form.period) {
      setError('请选择项目并填写预算周期');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('请输入正数预算金额（CNY）');
      return;
    }
    try {
      await createOne({
        projectId: Number(form.projectId),
        categoryId: form.categoryId ? Number(form.categoryId) : null,
        period: form.period,
        periodType: form.periodType,
        amountCny: amount,
      }).unwrap();
      setOpen(false);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function remove(b: Budget) {
    await deleteOne(b.id).unwrap().catch(() => undefined);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 md:px-12">
        <PageHeader en="Budgets" cn="预算 · 预实对比与超预算预警">
          <div className="flex flex-wrap items-end gap-3">
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
            <div className="w-44">
              <Field label="Period" hint="如 2026-11">
                <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="筛选周期…" />
              </Field>
            </div>
            <label className="flex items-center gap-2 pb-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={overOnly}
                onChange={(e) => setOverOnly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800"
              />
              仅看超预算
            </label>
            <Button onClick={() => setOpen(true)}>+ 新增预算</Button>
          </div>
        </PageHeader>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-5">
            <div className="text-sm font-semibold text-indigo-400">Budget</div>
            <div className="mb-3 text-[11px] text-slate-500">预算合计</div>
            <Money cny={summary?.totalBudgetCny} usd={summary?.totalBudgetUsd} size="xl" mainClass="text-indigo-400" />
          </Card>
          <Card className="p-5">
            <div className="text-sm font-semibold text-rose-400">Actual</div>
            <div className="mb-3 text-[11px] text-slate-500">实际支出合计</div>
            <Money cny={summary?.totalActualCny} usd={summary?.totalActualUsd} size="xl" mainClass="text-rose-400" />
          </Card>
          <Card className="p-5">
            <div className="text-sm font-semibold text-slate-300">Usage</div>
            <div className="mb-3 text-[11px] text-slate-500">整体执行率</div>
            <div className="text-2xl font-semibold tabular-nums text-slate-100">
              {formatRate(summary?.usageRate, 1)}
              <span className="text-base text-slate-500">%</span>
            </div>
          </Card>
          <Card className="p-5">
            <div className="text-sm font-semibold text-rose-400">Over Budget</div>
            <div className="mb-3 text-[11px] text-slate-500">超预算项数</div>
            <div className="text-2xl font-semibold tabular-nums text-rose-400">
              {formatInt(summary?.overCount)}
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader en="Budget vs Actual" cn="预算预实对比" />
          {isLoading ? (
            <Empty text="加载中…" />
          ) : items.length === 0 ? (
            <Empty />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-medium">周期 Period</th>
                    <th className="px-4 py-2.5 font-medium">预算对象 Scope</th>
                    <th className="px-4 py-2.5 text-right font-medium">预算 Budget</th>
                    <th className="px-4 py-2.5 text-right font-medium">实际 Actual</th>
                    <th className="px-4 py-2.5 text-right font-medium">差异 Variance</th>
                    <th className="px-4 py-2.5 text-right font-medium">执行率 Usage</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => (
                    <tr
                      key={b.id}
                      className={`border-t border-slate-800/70 hover:bg-slate-800/30 ${
                        b.overBudget ? 'bg-rose-500/[0.04]' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="leading-tight">
                          <div className="text-xs tabular-nums text-slate-200">{b.period}</div>
                          <div className="text-[11px] text-slate-500">
                            {b.periodType === 'yearly' ? '年度 Yearly' : '月度 Monthly'}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="leading-tight">
                          <div className="text-xs text-slate-300">{b.projectNameCn}</div>
                          <div className="text-[11px] text-slate-500">
                            {b.categoryId === null ? (
                              <span className="text-indigo-300">项目总预算 / Total</span>
                            ) : (
                              <>
                                {b.categoryNameCn} · {domainLabel(b.domain ?? '', 'expense').cn}
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Money cny={b.amountCny} usd={b.budgetUsd} size="sm" align="right" mainClass="text-indigo-300" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Money cny={b.actualCny} usd={b.actualUsd} size="sm" align="right" mainClass="text-rose-300" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Money
                          cny={b.varianceCny}
                          usd={b.varianceUsd}
                          size="sm"
                          align="right"
                          mainClass={b.varianceCny >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <UsageBar rate={b.usageRate} over={b.overBudget} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="danger" size="sm" onClick={() => remove(b)}>
                          删除
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={open}
        title="新增预算 / New Budget"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="budget-form" disabled={creating}>
              {creating ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        <form id="budget-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Project">
            <Select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
              <option value="">请选择项目…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameCn} {p.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="预算对象 Scope" hint="可留空=项目总预算">
            <Select
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              <option value="">（项目总预算 / Total）</option>
              <CategoryOptions />
            </Select>
          </Field>
          <Field label="周期类型 Period Type">
            <Select
              value={form.periodType}
              onChange={(e) =>
                setForm({
                  ...form,
                  periodType: e.target.value as 'monthly' | 'yearly',
                  period:
                    e.target.value === 'yearly'
                      ? new Date().toISOString().slice(0, 4)
                      : new Date().toISOString().slice(0, 7),
                })
              }
            >
              <option value="monthly">月度 Monthly</option>
              <option value="yearly">年度 Yearly</option>
            </Select>
          </Field>
          <Field label={form.periodType === 'yearly' ? '年度 Year' : '月份 Month'}>
            {form.periodType === 'yearly' ? (
              <Input
                value={form.period}
                onChange={(e) => setForm({ ...form, period: e.target.value })}
                placeholder="2026"
              />
            ) : (
              <MonthInput
                value={form.period}
                onChange={(v) => setForm({ ...form, period: v })}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field label="预算金额（CNY）">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.amountCny}
                onChange={(e) => setForm({ ...form, amountCny: e.target.value })}
                placeholder="0.00"
              />
            </Field>
          </div>
          {error && <div className="sm:col-span-2 text-xs text-rose-400">{error}</div>}
        </form>
      </Modal>
    </div>
  );
}
