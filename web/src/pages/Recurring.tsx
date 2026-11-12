import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  extractErrorMessage,
  useBillRecurringMutation,
  useCreateRecurringCostMutation,
  useDeleteRecurringCostMutation,
  useGenerateAllRecurringMutation,
  useGenerateRecurringMutation,
  useGetAmortizationQuery,
  useGetCategoriesQuery,
  useGetProjectsQuery,
  useGetRecurringCostsQuery,
  useGetUsageRecordsQuery,
  usePreviewUsageMutation,
  useUpdateRecurringCostMutation,
  useUpdateUsageRecordMutation,
  type CostNature,
  type Cycle,
  type MeterSource,
  type PricingMode,
  type RecurringCost,
  type UsagePreview,
  type UsageRecordLine,
} from '../api';
import { Card, CardHeader, Empty, PageHeader } from '../components/Card';
import { Button, DateInput, Field, Input, MonthInput, Select } from '../components/Field';
import { Modal } from '../components/Modal';
import { Money } from '../components/Money';
import { SupplierPicker } from '../components/SupplierPicker';
import { buildCategoryGroups } from '../lib/categories';
import { domainLabel } from '../lib/domains';
import { formatCny, formatDate, formatInt, todayISO } from '../lib/format';

const CYCLE_LABEL: Record<Cycle, { cn: string; en: string; months: number }> = {
  monthly: { cn: '每月', en: 'Monthly', months: 1 },
  quarterly: { cn: '每季', en: 'Quarterly', months: 3 },
  yearly: { cn: '每年', en: 'Yearly', months: 12 },
};

const NATURE_LABEL: Record<CostNature, { cn: string; en: string }> = {
  fixed: { cn: '固定', en: 'Fixed' },
  variable: { cn: '变动', en: 'Variable' },
};

const PRICING_LABEL: Record<PricingMode, { cn: string; en: string }> = {
  fixed: { cn: '固定金额', en: 'Fixed' },
  usage: { cn: '用量计费', en: 'Usage-based' },
  metered: { cn: '账单直读', en: 'Metered' },
};

/** 计量源选项（Cloudflare R2 支持按存储类分别计量；Vultr 直读已出账发票金额）。 */
const METER_OPTIONS: { value: MeterSource; cn: string; en: string; unit: string; metered?: boolean }[] = [
  { value: 'r2', cn: 'Cloudflare R2 存储（全部）', en: 'R2 Storage (All)', unit: 'GB' },
  { value: 'r2:Standard', cn: 'R2 存储 · 标准', en: 'R2 Storage · Standard', unit: 'GB' },
  { value: 'r2:InfrequentAccess', cn: 'R2 存储 · 低频访问', en: 'R2 Storage · Infrequent Access', unit: 'GB' },
  { value: 'vultr', cn: 'Vultr 账单（已出账）', en: 'Vultr Invoice', unit: 'USD', metered: true },
];

/** 上一自然月（默认计费期）。 */
function prevPeriodISO(): string {
  const d = new Date(`${todayISO()}T00:00:00`);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

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

/* ------------------------------------------------------------------ */
/* 计量记录 Tab：展示全部已计费期次，可调整最终归属                     */
/* ------------------------------------------------------------------ */

type UsageDraft = { projectId: string; categoryId: string };

function UsageRecordsTab() {
  const { data: projects = [] } = useGetProjectsQuery();
  const { data: allCategories = [] } = useGetCategoriesQuery({});
  const expenseCategories = useMemo(
    () => allCategories.filter((category) => category.type === 'expense' && category.parentId !== null),
    [allCategories]
  );

  const [period, setPeriod] = useState('');
  const [projectId, setProjectId] = useState('');
  const { data, isLoading, isFetching } = useGetUsageRecordsQuery({
    period: period || undefined,
    projectId: projectId ? Number(projectId) : undefined,
  });
  const [updateRecord] = useUpdateUsageRecordMutation();

  const records = data?.items ?? [];
  const [drafts, setDrafts] = useState<Record<number, UsageDraft>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const draftOf = (record: UsageRecordLine): UsageDraft =>
    drafts[record.id] ?? { projectId: String(record.projectId), categoryId: String(record.categoryId) };

  const isDirty = (record: UsageRecordLine) => {
    const draft = draftOf(record);
    return Number(draft.projectId) !== record.projectId || Number(draft.categoryId) !== record.categoryId;
  };

  const setDraft = (record: UsageRecordLine, patch: Partial<UsageDraft>) =>
    setDrafts((current) => {
      const base = current[record.id] ?? {
        projectId: String(record.projectId),
        categoryId: String(record.categoryId),
      };
      return { ...current, [record.id]: { ...base, ...patch } };
    });

  const save = async (record: UsageRecordLine) => {
    const draft = draftOf(record);
    setSavingId(record.id);
    setError(null);
    setNotice(null);
    try {
      await updateRecord({
        id: record.id,
        projectId: Number(draft.projectId),
        categoryId: Number(draft.categoryId),
      }).unwrap();
      setDrafts((current) => {
        const next = { ...current };
        delete next[record.id];
        return next;
      });
      setNotice(`已更新计量记录归属：${record.recurringNameCn ?? record.period}`);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSavingId(null);
    }
  };

  const totalCny = records.reduce((sum, record) => sum + Number(record.amountCny), 0);

  return (
    <Card>
      <CardHeader
        en="Usage Records"
        cn="计量记录 · 可调整最终归属（项目 / 科目）"
        right={
          <span className="text-[11px] text-slate-500">
            共 {records.length} 条 · 合计 ¥{formatCny(totalCny)}
            {isFetching && !isLoading ? ' · 刷新中…' : ''}
          </span>
        }
      />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="计费期" hint="可选">
            <MonthInput value={period} onChange={setPeriod} className="max-w-[12rem]" />
          </Field>
          <Field label="项目">
            <Select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="max-w-[14rem]"
            >
              <option value="">全部项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.nameCn} {project.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          {(period || projectId) && (
            <Button
              variant="ghost"
              onClick={() => {
                setPeriod('');
                setProjectId('');
              }}
            >
              清除筛选
            </Button>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
        )}
        {notice && (
          <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>
        )}

        {isLoading ? (
          <Empty text="加载中…" />
        ) : records.length === 0 ? (
          <Empty text="暂无计量记录" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full min-w-[1180px] text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-500">
                <tr>
                  <th className="px-3 py-2">计费期</th>
                  <th className="px-3 py-2">周期成本 / 计量</th>
                  <th className="px-3 py-2">方式</th>
                  <th className="px-3 py-2 text-right">原币金额</th>
                  <th className="px-3 py-2 text-right">金额 (CNY)</th>
                  <th className="w-24 px-3 py-2">入账日期</th>
                  <th className="w-40 px-3 py-2">项目归属</th>
                  <th className="w-52 px-3 py-2">科目归属</th>
                  <th className="w-24 px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {records.map((record) => {
                  const draft = draftOf(record);
                  const dirty = isDirty(record);
                  return (
                    <tr key={record.id} className="align-middle text-slate-300">
                      <td className="px-3 py-2.5 tabular-nums text-slate-400">{record.period}</td>
                      <td className="px-3 py-2.5">
                        <div className="max-w-[260px] truncate font-medium text-slate-200" title={record.recurringNameCn ?? ''}>
                          {record.recurringNameCn ?? '—'}
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-500">
                          {formatCny(record.quantity)} {record.unitLabel ?? ''} ×{' '}
                          {record.unitPrice === null ? '—' : formatCny(record.unitPrice)} {record.unitPriceCcy}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                          {record.pricingMode === 'metered' ? '账单直读' : '用量计费'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">
                        {record.unitPriceCcy} {formatCny(record.amountSrc)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums text-slate-100">
                        {formatCny(record.amountCny)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-400">{formatDate(record.billedOn)}</td>
                      <td className="px-3 py-2.5">
                        <Select value={draft.projectId} onChange={(e) => setDraft(record, { projectId: e.target.value })}>
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.nameCn}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3 py-2.5">
                        <Select
                          value={draft.categoryId}
                          onChange={(e) => setDraft(record, { categoryId: e.target.value })}
                        >
                          {expenseCategories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.nameCn} {category.nameEn}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {dirty ? (
                          <Button size="sm" disabled={savingId === record.id} onClick={() => void save(record)}>
                            {savingId === record.id ? '保存中…' : '保存'}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled
                            className="opacity-40"
                            title="归属未变更"
                          >
                            已一致
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] leading-5 text-slate-500">
          调整归属会同时更新该期次已生成的支出流水（以台账为权威口径）。计量记录恒为支出，科目仅显示支出类。
        </p>
      </div>
    </Card>
  );
}

type FormState = {
  projectId: string;
  categoryId: string;
  supplierId: string;
  supplierName: string;
  nameCn: string;
  nameEn: string;
  amountCny: string;
  cycle: Cycle;
  costNature: CostNature;
  pricingMode: PricingMode;
  unitPrice: string;
  unitPriceCcy: string;
  unitLabel: string;
  meterSource: MeterSource | '';
  startDate: string;
  endDate: string;
  autoGenerate: boolean;
  status: boolean;
};

const emptyForm = (): FormState => ({
  projectId: '',
  categoryId: '',
  supplierId: '',
  supplierName: '',
  nameCn: '',
  nameEn: '',
  amountCny: '',
  cycle: 'monthly',
  costNature: 'fixed',
  pricingMode: 'fixed',
  unitPrice: '',
  unitPriceCcy: 'USD',
  unitLabel: '',
  meterSource: '',
  startDate: todayISO(),
  endDate: '',
  autoGenerate: true,
  status: true,
});

export default function Recurring() {
  const [tab, setTab] = useState<'costs' | 'usage'>('costs');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('1');
  const [q, setQ] = useState('');
  const [months, setMonths] = useState(12);

  const { data: projects = [] } = useGetProjectsQuery();
  const { data: allCategories = [] } = useGetCategoriesQuery({});
  const { data, isLoading } = useGetRecurringCostsQuery({
    ...(projectId ? { projectId: Number(projectId) } : {}),
    status,
    ...(q ? { q } : {}),
  });
  const { data: plan } = useGetAmortizationQuery({
    months,
    ...(projectId ? { projectId: Number(projectId) } : {}),
  });

  const [createOne, { isLoading: creating }] = useCreateRecurringCostMutation();
  const [updateOne, { isLoading: updating }] = useUpdateRecurringCostMutation();
  const [deleteOne] = useDeleteRecurringCostMutation();
  const [generateOne] = useGenerateRecurringMutation();
  const [generateAll, { isLoading: generatingAll }] = useGenerateAllRecurringMutation();
  const [previewUsage, { isLoading: previewing }] = usePreviewUsageMutation();
  const [billRecurring, { isLoading: billing }] = useBillRecurringMutation();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [genUntil, setGenUntil] = useState(todayISO());

  // 用量计费弹窗
  const [billTarget, setBillTarget] = useState<RecurringCost | null>(null);
  const [billPeriod, setBillPeriod] = useState(prevPeriodISO);
  const [billQuantity, setBillQuantity] = useState('');
  const [preview, setPreview] = useState<UsagePreview | null>(null);
  const [billError, setBillError] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const summary = data?.summary;
  const items = data?.items ?? [];
  const maxMonth = Math.max(1, ...(plan?.rows ?? []).map((r) => r.amountCny));

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
    setOpen(true);
  }

  function openEdit(t: RecurringCost) {
    setEditingId(t.id);
    setForm({
      projectId: String(t.projectId),
      categoryId: String(t.categoryId),
      supplierId: t.supplierId ? String(t.supplierId) : '',
      supplierName: t.supplierNameCn ?? '',
      nameCn: t.nameCn,
      nameEn: t.nameEn,
      amountCny: String(t.amountCny),
      cycle: t.cycle,
      costNature: t.costNature,
      pricingMode: t.pricingMode,
      unitPrice: t.unitPrice === null ? '' : String(t.unitPrice),
      unitPriceCcy: t.unitPriceCcy || 'USD',
      unitLabel: t.unitLabel ?? '',
      meterSource: t.meterSource ?? '',
      startDate: formatDate(t.startDate),
      endDate: t.endDate ? formatDate(t.endDate) : '',
      autoGenerate: Boolean(t.autoGenerate),
      status: Boolean(t.status),
    });
    setError(null);
    setOpen(true);
  }

  /** 选择计量源时自动带出默认单位标签。 */
  function pickMeterSource(value: MeterSource | '') {
    const opt = METER_OPTIONS.find((o) => o.value === value);
    setForm((f) => ({
      ...f,
      meterSource: value,
      unitLabel: value ? (f.unitLabel || opt?.unit || '') : f.unitLabel,
    }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const isUsage = form.pricingMode === 'usage';
    const isMetered = form.pricingMode === 'metered';
    const isMeteredLike = isUsage || isMetered;
    const amount = Number(form.amountCny);
    const unitPrice = Number(form.unitPrice);
    if (!form.projectId || !form.categoryId || !form.nameCn || !form.nameEn || !form.startDate) {
      setError('请完整填写项目、科目、中英文名称与起始日期');
      return;
    }
    if (isUsage) {
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        setError('请输入正数单价（用量计费）');
        return;
      }
      if (!form.unitLabel) {
        setError('请填写计量单位（如 GB）');
        return;
      }
    } else if (!isMetered && (!Number.isFinite(amount) || amount <= 0)) {
      setError('请输入正数金额（CNY）');
      return;
    }
    const body = {
      projectId: Number(form.projectId),
      categoryId: Number(form.categoryId),
      supplierId: form.supplierId ? Number(form.supplierId) : null,
      nameCn: form.nameCn,
      nameEn: form.nameEn,
      amountCny: isMeteredLike ? 0 : amount,
      cycle: form.cycle,
      costNature: form.costNature,
      pricingMode: form.pricingMode,
      unitPrice: isUsage ? unitPrice : null,
      unitPriceCcy: form.unitPriceCcy || 'USD',
      unitLabel: isUsage ? form.unitLabel : null,
      meterSource: isMeteredLike && form.meterSource ? form.meterSource : null,
      startDate: form.startDate,
      endDate: form.endDate || null,
      autoGenerate: form.autoGenerate ? 1 : 0,
      status: form.status ? 1 : 0,
    };
    try {
      if (editingId) {
        await updateOne({ id: editingId, body }).unwrap();
        setNotice('已更新周期成本');
      } else {
        await createOne(body).unwrap();
        setNotice('已新增周期成本');
      }
      setOpen(false);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function toggleStatus(t: RecurringCost) {
    await updateOne({ id: t.id, body: { status: t.status ? 0 : 1 } }).unwrap().catch(() => undefined);
  }

  async function remove(t: RecurringCost) {
    if (!window.confirm(`确认删除「${t.nameCn}」？已生成的流水会保留（仅解除关联）。`)) return;
    await deleteOne(t.id).unwrap().catch((err) => setError(extractErrorMessage(err)));
  }

  async function generate(t: RecurringCost) {
    try {
      const res = await generateOne({ id: t.id, until: genUntil }).unwrap();
      setNotice(
        res.generated > 0
          ? `「${t.nameCn}」已生成 ${res.generated} 期流水，至 ${res.lastGenDate}`
          : `「${t.nameCn}」截至 ${genUntil} 无待生成期次`
      );
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function generateAllCosts() {
    try {
      const res = await generateAll({ until: genUntil }).unwrap();
      const base =
        res.totalGenerated > 0
          ? `一键生成完成：共生成 ${res.totalGenerated} 期流水，至 ${res.until}（用量计费期 ${res.period}）`
          : `截至 ${genUntil} 没有待生成期次（已是最新）`;
      setNotice(res.errors.length ? `${base}；${res.errors.length} 条用量计费失败` : base);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  function openBill(t: RecurringCost) {
    setBillTarget(t);
    setBillPeriod(prevPeriodISO());
    setBillQuantity('');
    setPreview(null);
    setBillError(null);
  }

  /** 预览用量：手工填写了数量则按手工值折算，否则走计量源拉取。 */
  async function runPreview() {
    if (!billTarget) return;
    setBillError(null);
    try {
      const manual = billQuantity.trim();
      const res = await previewUsage({
        id: billTarget.id,
        period: billPeriod,
        ...(manual ? { quantity: Number(manual) } : {}),
      }).unwrap();
      setPreview(res);
    } catch (err) {
      setPreview(null);
      setBillError(extractErrorMessage(err));
    }
  }

  async function runBill() {
    if (!billTarget) return;
    setBillError(null);
    try {
      const manual = billQuantity.trim();
      const res = await billRecurring({
        id: billTarget.id,
        period: billPeriod,
        ...(manual ? { quantity: Number(manual) } : {}),
      }).unwrap();
      setNotice(
        res.skipped
          ? `「${billTarget.nameCn}」${res.period} 已计费（跳过重复）`
          : billTarget.pricingMode === 'metered'
            ? `「${billTarget.nameCn}」${res.period} 已计费：账单 ${res.amountSrc} ${res.unitPriceCcy} = ¥${formatCny(res.amountCny)}`
            : `「${billTarget.nameCn}」${res.period} 已计费：${res.quantity}${res.unitLabel} × ${res.unitPrice}${res.unitPriceCcy} = ¥${formatCny(res.amountCny)}`
      );
      setBillTarget(null);
    } catch (err) {
      setBillError(extractErrorMessage(err));
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 md:px-12">
        <PageHeader en="Recurring Costs" cn="周期成本 · 摊销折算与到期自动记账">
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
            <div className="w-32">
              <Field label="Status">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="all">全部</option>
                  <option value="1">启用</option>
                  <option value="0">停用</option>
                </Select>
              </Field>
            </div>
            <div className="w-44">
              <Field label="Search">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名称关键词…" />
              </Field>
            </div>
            <Button onClick={openCreate}>+ 新增周期成本</Button>
          </div>
        </PageHeader>

        <div className="mb-4 flex gap-1 border-b border-slate-800">
          {(
            [
              { key: 'costs', en: 'Recurring Costs', cn: '周期成本' },
              { key: 'usage', en: 'Usage Records', cn: '计量记录' },
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

        {tab === 'usage' ? (
          <UsageRecordsTab />
        ) : (
          <>
        {notice && (
          <div className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            {notice}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-5">
            <div className="text-sm font-semibold text-indigo-400">Monthly Run-rate</div>
            <div className="mb-3 text-[11px] text-slate-500">固定成本月摊；动态成本见列表最近账单</div>
            <Money cny={summary?.monthlyTotalCny} usd={summary?.monthlyTotalUsd} size="xl" />
          </Card>
          <Card className="p-5">
            <div className="text-sm font-semibold text-slate-300">Active</div>
            <div className="mb-3 text-[11px] text-slate-500">启用 / 全部</div>
            <div className="text-2xl font-semibold tabular-nums text-slate-100">
              {formatInt(summary?.activeCount)}{' '}
              <span className="text-sm text-slate-500">/ {formatInt(summary?.count)}</span>
            </div>
          </Card>
          <Card className="p-5">
            <div className="text-sm font-semibold text-emerald-400">Fixed</div>
            <div className="mb-3 text-[11px] text-slate-500">固定成本 · 月摊</div>
            <Money cny={summary?.fixedMonthlyCny} size="xl" mainClass="text-emerald-400" />
          </Card>
          <Card className="p-5">
            <div className="text-sm font-semibold text-amber-400">Variable</div>
            <div className="mb-3 text-[11px] text-slate-500">变动成本 · 月摊</div>
            <Money cny={summary?.variableMonthlyCny} size="xl" mainClass="text-amber-400" />
          </Card>
        </div>

        <Card className="mb-6">
          <CardHeader
            en="Amortization Plan"
            cn="未来摊销计划 · 按周期金额折算为每月等额"
            right={
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">生成截止日</span>
                <DateInput
                  value={genUntil}
                  onChange={setGenUntil}
                  className="max-w-[17rem] py-1 text-xs"
                />
                <Button variant="ghost" size="sm" onClick={generateAllCosts} disabled={generatingAll}>
                  {generatingAll ? '生成中…' : '一键生成到期流水'}
                </Button>
              </div>
            }
          />
          <div className="p-5">
            {plan && plan.rows.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-500">
                  <span>月份 Month</span>
                  <span>应摊金额 Amortized</span>
                </div>
                {plan.rows.map((r) => (
                  <div key={r.ym} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs tabular-nums text-slate-400">{r.ym}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-slate-800">
                      <div
                        className="h-full rounded bg-gradient-to-r from-indigo-500/70 to-indigo-400"
                        style={{ width: `${(r.amountCny / maxMonth) * 100}%` }}
                        title={r.byDomain
                          .map((d) => `${domainLabel(d.domain, 'expense').cn} ¥${formatCny(d.cny)}`)
                          .join(' · ')}
                      />
                    </div>
                    <Money cny={r.amountCny} usd={r.amountUsd} size="sm" align="right" className="w-52 shrink-0 justify-end" />
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="暂无启用中的周期成本" />
            )}
            <div className="mt-4 flex items-center justify-end gap-2 text-[11px] text-slate-500">
              <span>计划月数</span>
              {[6, 12, 24, 36].map((m) => (
                <button
                  key={m}
                  onClick={() => setMonths(m)}
                  className={`rounded px-2 py-0.5 transition ${
                    months === m ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader en="Recurring Costs" cn="周期成本列表" />
          {isLoading ? (
            <Empty text="加载中…" />
          ) : items.length === 0 ? (
            <Empty />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-medium">名称 Name</th>
                    <th className="px-4 py-2.5 font-medium">项目 / 科目</th>
                    <th className="px-4 py-2.5 font-medium">供应商</th>
                    <th className="px-4 py-2.5 font-medium">周期</th>
                    <th className="px-4 py-2.5 text-right font-medium">金额 / 单价</th>
                    <th className="px-4 py-2.5 font-medium">计费方式</th>
                    <th className="px-4 py-2.5 font-medium">性质</th>
                    <th className="px-4 py-2.5 font-medium">状态</th>
                    <th className="px-4 py-2.5 font-medium">下次到期</th>
                    <th className="px-4 py-2.5 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id} className="border-t border-slate-800/70 hover:bg-slate-800/30">
                      <td className="px-4 py-3">
                        <div className="leading-tight">
                          <div className="text-sm text-slate-100">{t.nameCn}</div>
                          <div className="text-[11px] text-slate-500">{t.nameEn}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="leading-tight">
                          <div className="text-xs text-slate-300">{t.projectNameCn}</div>
                          <div className="text-[11px] text-slate-500">
                            {t.categoryNameCn} · {domainLabel(t.domain, 'expense').cn}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {t.supplierNameCn ? (
                          <div className="leading-tight">
                            <div className="text-xs text-slate-300">{t.supplierNameCn}</div>
                            <div className="truncate text-[11px] text-slate-500">{t.supplierNameEn}</div>
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="leading-tight">
                          <div className="text-xs text-slate-200">{CYCLE_LABEL[t.cycle].cn}</div>
                          <div className="text-[11px] text-slate-500">{CYCLE_LABEL[t.cycle].en}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {t.pricingMode === 'usage' ? (
                          <>
                            <div className="text-sm tabular-nums text-slate-200">
                              {t.unitPrice !== null ? `${t.unitPrice} ${t.unitPriceCcy}` : '—'}
                              <span className="text-[11px] text-slate-500"> / {t.unitLabel ?? 'unit'}</span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              {t.lastUsagePeriod && t.lastUsageAmountCny !== null
                                ? `${t.lastUsagePeriod} 实际 ¥${formatCny(t.lastUsageAmountCny)} · ${t.lastUsageAmountCcy} ${formatCny(t.lastUsageAmountSrc ?? 0)}`
                                : '尚未计费'}
                            </div>
                          </>
                        ) : t.pricingMode === 'metered' ? (
                          <>
                            <div className="text-sm tabular-nums text-slate-200">
                              {t.lastUsageAmountSrc !== null && t.lastUsageAmountSrc !== undefined
                                ? `${t.lastUsageAmountCcy} ${formatCny(t.lastUsageAmountSrc)}`
                                : '服务商账单直读'}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              {t.lastUsagePeriod && t.lastUsageAmountCny !== null
                                ? `${t.lastUsagePeriod} 实际 ¥${formatCny(t.lastUsageAmountCny)}`
                                : '尚未计费'}
                            </div>
                          </>
                        ) : (
                          <>
                            <Money cny={t.amountCny} size="sm" align="right" mainClass="text-slate-200" />
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              月摊 ¥{formatCny(t.monthlyCny)}
                              {t.monthlyUsd !== null && ` / $${formatCny(t.monthlyUsd)}`}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] ${
                            t.pricingMode !== 'fixed'
                              ? 'bg-sky-500/10 text-sky-300'
                              : 'bg-slate-700/40 text-slate-400'
                          }`}
                        >
                          {PRICING_LABEL[t.pricingMode].cn}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] ${
                            t.costNature === 'fixed'
                              ? 'bg-emerald-500/10 text-emerald-300'
                              : 'bg-amber-500/10 text-amber-300'
                          }`}
                        >
                          {NATURE_LABEL[t.costNature].cn}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleStatus(t)}
                          className={`rounded px-2 py-0.5 text-[11px] transition ${
                            t.status
                              ? 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                              : 'bg-slate-700/40 text-slate-400 hover:bg-slate-700'
                          }`}
                        >
                          {t.status ? '启用' : '停用'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-slate-400">
                        {t.nextDueDate ? formatDate(t.nextDueDate) : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          {t.pricingMode !== 'fixed' ? (
                            <Button variant="ghost" size="sm" onClick={() => openBill(t)}>
                              计费
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => generate(t)}>
                              生成
                            </Button>
                          )}
                          <Button variant="subtle" size="sm" onClick={() => openEdit(t)}>
                            编辑
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => remove(t)}>
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
          </>
        )}
      </div>

      <Modal
        open={open}
        title={editingId ? '编辑周期成本 / Edit Recurring Cost' : '新增周期成本 / New Recurring Cost'}
        onClose={() => setOpen(false)}
        width="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="recurring-form" disabled={creating || updating}>
              {creating || updating ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        <form id="recurring-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Project">
            <Select
              value={form.projectId}
              onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            >
              <option value="">请选择项目…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameCn} {p.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category">
            <Select
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              <option value="">请选择科目…</option>
              <CategoryOptions />
            </Select>
          </Field>
          <Field label="名称（中文）">
            <Input
              value={form.nameCn}
              onChange={(e) => setForm({ ...form, nameCn: e.target.value })}
              placeholder="如：对象存储 (R2)"
            />
          </Field>
          <Field label="Name (EN)">
            <Input
              value={form.nameEn}
              onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
              placeholder="e.g. Object Storage (R2)"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="供应商 Supplier" hint="可空 · 生成流水的交易对手优先取供应商名称">
              <div className="flex gap-2">
                <Input
                  readOnly
                  className="flex-1 cursor-default"
                  placeholder="未指定（点击「选择」从名录中挑选）"
                  value={form.supplierName}
                />
                <Button
                  type="button"
                  variant="subtle"
                  className="shrink-0"
                  onClick={() => setSupplierPickerOpen(true)}
                >
                  选择
                </Button>
                {form.supplierId && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => setForm({ ...form, supplierId: '', supplierName: '' })}
                  >
                    清除
                  </Button>
                )}
              </div>
            </Field>
          </div>
          <Field label="计费方式 Pricing">
            <Select
              value={form.pricingMode}
              onChange={(e) => {
                const mode = e.target.value as PricingMode;
                setForm((f) => ({
                  ...f,
                  pricingMode: mode,
                  ...(mode !== 'fixed' ? { costNature: 'variable' as CostNature } : {}),
                }));
              }}
            >
              <option value="fixed">固定金额 Fixed</option>
              <option value="usage">用量计费 Usage-based</option>
              <option value="metered">账单直读 Metered</option>
            </Select>
          </Field>
          <Field label="周期 Cycle">
            <Select
              value={form.cycle}
              onChange={(e) => setForm({ ...form, cycle: e.target.value as Cycle })}
            >
              <option value="monthly">每月 Monthly</option>
              <option value="quarterly">每季 Quarterly</option>
              <option value="yearly">每年 Yearly</option>
            </Select>
          </Field>
          <Field label="成本性质 Nature">
            <Select
              value={form.costNature}
              onChange={(e) => setForm({ ...form, costNature: e.target.value as CostNature })}
            >
              <option value="fixed">固定 Fixed</option>
              <option value="variable">变动 Variable</option>
            </Select>
          </Field>
          {form.pricingMode === 'usage' ? (
            <>
              <Field label="单价 Unit Price" hint={form.unitPriceCcy}>
                <Input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={form.unitPrice}
                  onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                  placeholder="如 0.015"
                />
              </Field>
              <Field label="单价币种 Currency">
                <Select
                  value={form.unitPriceCcy}
                  onChange={(e) => setForm({ ...form, unitPriceCcy: e.target.value })}
                >
                  <option value="USD">USD</option>
                  <option value="CNY">CNY</option>
                </Select>
              </Field>
              <Field label="计量单位 Unit Label" hint="如 GB / TB / 万次">
                <Input
                  value={form.unitLabel}
                  onChange={(e) => setForm({ ...form, unitLabel: e.target.value })}
                  placeholder="GB"
                />
              </Field>
              <Field label="计量源 Meter Source" hint="可空=手工录入">
                <Select
                  value={form.meterSource}
                  onChange={(e) => pickMeterSource(e.target.value as MeterSource | '')}
                >
                  <option value="">手工录入 Manual</option>
                  {METER_OPTIONS.filter((o) => !o.metered).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.cn} · {o.en}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : form.pricingMode === 'metered' ? (
            <div className="sm:col-span-2">
              <Field label="计量源 Meter Source" hint="每期直读服务商账单金额">
                <Select
                  value={form.meterSource}
                  onChange={(e) => pickMeterSource(e.target.value as MeterSource | '')}
                >
                  <option value="">手工录入 Manual</option>
                  {METER_OPTIONS.filter((o) => o.metered).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.cn} · {o.en}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : (
            <Field label="金额（CNY）" hint="按周期">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.amountCny}
                onChange={(e) => setForm({ ...form, amountCny: e.target.value })}
                placeholder="0.00"
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="起始日 Start">
              <DateInput
                value={form.startDate}
                onChange={(v) => setForm({ ...form, startDate: v })}
              />
            </Field>
            <Field label="结束日 End" hint="可空">
              <DateInput
                value={form.endDate}
                onChange={(v) => setForm({ ...form, endDate: v })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={form.autoGenerate}
              onChange={(e) => setForm({ ...form, autoGenerate: e.target.checked })}
              className="h-4 w-4 rounded border-slate-600 bg-slate-800"
            />
            自动生成流水 Auto-generate
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.checked })}
              className="h-4 w-4 rounded border-slate-600 bg-slate-800"
            />
            启用 Enabled
          </label>
          {error && <div className="sm:col-span-2 text-xs text-rose-400">{error}</div>}
        </form>
      </Modal>

      {/* 供应商选择弹窗 */}
      <SupplierPicker
        open={supplierPickerOpen}
        onClose={() => setSupplierPickerOpen(false)}
        categories={allCategories}
        defaultCategoryId={form.categoryId ? Number(form.categoryId) : undefined}
        role="vendor"
        onPick={(s) => setForm((prev) => ({ ...prev, supplierId: String(s.id), supplierName: s.nameCn }))}
      />

      <Modal
        open={billTarget !== null}
        title={
          billTarget?.pricingMode === 'metered'
            ? '账单计费 / Metered Billing'
            : '用量计费 / Usage Billing'
        }
        onClose={() => setBillTarget(null)}
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBillTarget(null)}>
              取消
            </Button>
            <Button onClick={runBill} disabled={billing}>
              {billing ? '计费中…' : '确认计费'}
            </Button>
          </>
        }
      >
        {billTarget && (
          <div className="space-y-4">
            <div className="text-xs text-slate-400">
              {billTarget.nameCn} <span className="text-slate-600">/ {billTarget.nameEn}</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="计费期 Period">
                <MonthInput value={billPeriod} onChange={setBillPeriod} />
              </Field>
              <Field
                label={billTarget.pricingMode === 'metered' ? '账单金额 Amount' : '计量值 Quantity'}
                hint="留空=自动拉取"
              >
                <Input
                  type="number"
                  min="0"
                  step={billTarget.pricingMode === 'metered' ? '0.01' : '0.0001'}
                  value={billQuantity}
                  onChange={(e) => setBillQuantity(e.target.value)}
                  placeholder={billTarget.meterSource ? '自动' : '必填'}
                />
              </Field>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                {billTarget.pricingMode === 'metered'
                  ? `服务商账单直读 · ${billTarget.unitPriceCcy}`
                  : `单价 ${billTarget.unitPrice ?? '—'} ${billTarget.unitPriceCcy} / ${
                      billTarget.unitLabel ?? 'unit'
                    }`}
              </span>
              <Button variant="subtle" size="sm" onClick={runPreview} disabled={previewing}>
                {previewing ? '拉取中…' : '预览用量'}
              </Button>
            </div>
            {preview && (
              <div className="rounded-md border border-slate-700/60 bg-slate-800/40 px-3 py-2 text-xs text-slate-300">
                <div>
                  {preview.period} · {preview.quantity} {preview.unitLabel}
                  <span className="ml-2 text-slate-500">
                    （{preview.source === 'manual' ? '手工' : preview.source}）
                  </span>
                </div>
                {preview.amountSrc !== null && (
                  <div className="mt-1 tabular-nums text-slate-100">
                    预计金额 {preview.amountSrc} {preview.unitPriceCcy}
                  </div>
                )}
              </div>
            )}
            {!billTarget.meterSource && (
              <div className="text-[11px] text-amber-400/80">
                {billTarget.pricingMode === 'metered'
                  ? '该周期成本未配置计量源，请手工填写账单金额后再计费。'
                  : '该周期成本未配置计量源，请手工填写计量值后再计费。'}
              </div>
            )}
            {billError && <div className="text-xs text-rose-400">{billError}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
