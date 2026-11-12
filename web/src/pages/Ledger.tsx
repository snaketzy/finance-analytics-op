import { useEffect, useMemo, useRef, useState } from 'react';
import {
  extractErrorMessage,
  useCreateTransactionMutation,
  useDeleteTransactionMutation,
  useGetCategoriesQuery,
  useGetProjectsQuery,
  useGetTransactionsQuery,
  useLazyGetTransactionAttachmentsQuery,
  useUpdateTransactionMutation,
  useUploadTransactionAttachmentMutation,
  type Attachment,
  type Category,
  type Direction,
  type Transaction,
  type TransactionInput,
  type TransactionQuery,
} from '../api';
import { Button, DateInput, Field, Input, Select } from '../components/Field';
import { Money } from '../components/Money';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { SupplierPicker } from '../components/SupplierPicker';
import { buildCategoryGroups } from '../lib/categories';
import { DIRECTION_LABEL } from '../lib/domains';
import { formatDate, todayISO } from '../lib/format';

const PAGE_SIZE = 20;

/** 科目下拉选项：按领域 optgroup 分组，展示「中文名 English」。 */
function CategoryOptions({ categories }: { categories: Category[] }) {
  const groups = buildCategoryGroups(categories);
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

type Filters = {
  projectId: string;
  categoryId: string;
  direction: '' | Direction;
  from: string;
  to: string;
};

type FormState = {
  projectId: string;
  categoryId: string;
  direction: Direction;
  txnDate: string;
  amountCny: string;
  counterparty: string;
  note: string;
};

const emptyForm = (): FormState => ({
  projectId: '',
  categoryId: '',
  direction: 'expense',
  txnDate: todayISO(),
  amountCny: '',
  counterparty: '',
  note: '',
});

export default function Ledger() {
  const [filters, setFilters] = useState<Filters>({
    projectId: '',
    categoryId: '',
    direction: '',
    from: '',
    to: '',
  });
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);

  const { data: projects = [] } = useGetProjectsQuery();
  const { data: categories = [] } = useGetCategoriesQuery({});

  const queryArgs: TransactionQuery = useMemo(
    () => ({
      ...(filters.projectId ? { projectId: Number(filters.projectId) } : {}),
      ...(filters.categoryId ? { categoryId: Number(filters.categoryId) } : {}),
      ...(filters.direction ? { direction: filters.direction } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
      ...(debouncedKeyword ? { q: debouncedKeyword } : {}),
      page,
      pageSize: PAGE_SIZE,
    }),
    [filters, debouncedKeyword, page]
  );

  const { data, isLoading, isFetching } = useGetTransactionsQuery(queryArgs);
  const [createTransaction] = useCreateTransactionMutation();
  const [updateTransaction] = useUpdateTransactionMutation();
  const [deleteTransaction] = useDeleteTransactionMutation();
  const [fetchAttachments] = useLazyGetTransactionAttachmentsQuery();
  const [uploadAttachment] = useUploadTransactionAttachmentMutation();

  // 凭证弹窗
  const [voucherTxn, setVoucherTxn] = useState<Transaction | null>(null);
  const [voucherItems, setVoucherItems] = useState<Attachment[]>([]);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [voucherUploading, setVoucherUploading] = useState(false);

  const items = data?.items ?? [];

  // 关键词防抖
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword.trim()), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  // 筛选变化时回到第一页
  useEffect(() => {
    setPage(1);
  }, [filters, debouncedKeyword]);

  // 翻页后表格主体回到顶部
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [page]);

  function patchFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(t: Transaction) {
    setEditing(t);
    setForm({
      projectId: String(t.projectId),
      categoryId: String(t.categoryId),
      direction: t.direction,
      txnDate: formatDate(t.txnDate),
      amountCny: String(t.amountCny),
      counterparty: t.counterparty ?? '',
      note: t.note ?? '',
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function submitForm() {
    if (!form.projectId || !form.categoryId || !form.txnDate || !form.amountCny) {
      setFormError('请完整填写项目、科目、日期与金额');
      return;
    }
    const payload: TransactionInput = {
      projectId: Number(form.projectId),
      categoryId: Number(form.categoryId),
      direction: form.direction,
      txnDate: form.txnDate,
      amountCny: Number(form.amountCny),
      counterparty: form.counterparty || undefined,
      note: form.note || undefined,
    };
    try {
      if (editing) {
        await updateTransaction({ id: editing.id, body: payload }).unwrap();
      } else {
        await createTransaction(payload).unwrap();
      }
      setModalOpen(false);
    } catch (e) {
      setFormError(extractErrorMessage(e));
    }
  }

  async function removeTransaction(t: Transaction) {
    const ok = window.confirm(
      `确认删除该流水？\n${formatDate(t.txnDate)} · ${t.categoryNameCn} · ¥${t.amountCny}`
    );
    if (!ok) return;
    try {
      await deleteTransaction(t.id).unwrap();
    } catch (e) {
      window.alert(extractErrorMessage(e));
    }
  }

  async function openVoucher(t: Transaction) {
    setVoucherTxn(t);
    setVoucherItems([]);
    setVoucherError(null);
    setVoucherLoading(true);
    try {
      const res = await fetchAttachments(t.id).unwrap();
      setVoucherItems(res.items);
    } catch (e) {
      setVoucherError(extractErrorMessage(e));
    } finally {
      setVoucherLoading(false);
    }
  }

  async function uploadVoucher(file?: File) {
    if (!file || !voucherTxn) return;
    setVoucherError(null);
    setVoucherUploading(true);
    try {
      await uploadAttachment({ txnId: voucherTxn.id, file }).unwrap();
      await openVoucher(voucherTxn);
    } catch (e) {
      setVoucherError(extractErrorMessage(e));
    } finally {
      setVoucherUploading(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 固定筛选栏 */}
      <div className="shrink-0 border-b border-slate-800 px-4 py-4 md:px-12">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="leading-tight">
            <h1 className="text-lg font-semibold text-slate-100">Ledger</h1>
            <p className="text-xs text-slate-500">台账流水 · 收支明细</p>
          </div>
          <Button onClick={openCreate}>+ 新增流水</Button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <Field label="Project">
              <Select
                value={filters.projectId}
                onChange={(e) => patchFilter('projectId', e.target.value)}
              >
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
            <Field label="Direction">
              <Select
                value={filters.direction}
                onChange={(e) => patchFilter('direction', e.target.value as Filters['direction'])}
              >
                <option value="">全部</option>
                <option value="income">收入 Income</option>
                <option value="expense">支出 Expense</option>
              </Select>
            </Field>
          </div>
          <div className="w-56">
            <Field label="Category">
              <Select
                value={filters.categoryId}
                onChange={(e) => patchFilter('categoryId', e.target.value)}
              >
                <option value="">全部科目</option>
                <CategoryOptions categories={categories} />
              </Select>
            </Field>
          </div>
          <div className="w-40">
            <Field label="From">
              <DateInput value={filters.from} onChange={(v) => patchFilter('from', v)} />
            </Field>
          </div>
          <div className="w-40">
            <Field label="To">
              <DateInput value={filters.to} onChange={(v) => patchFilter('to', v)} />
            </Field>
          </div>
          <div className="w-56">
            <Field label="Search">
              <Input
                placeholder="对手方 / 备注关键词"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </Field>
          </div>
        </div>
      </div>

      {/* 固定合计栏 */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-8 gap-y-1 border-b border-slate-800 bg-slate-900/60 px-4 py-2.5 md:px-12">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">收入 Income</span>
          <Money cny={data?.incomeCny} usd={data?.incomeUsd} size="sm" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">支出 Expense</span>
          <Money cny={data?.expenseCny} usd={data?.expenseUsd} size="sm" mainClass="text-rose-400" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">净额 Net</span>
          <Money
            cny={(data?.incomeCny ?? 0) - (data?.expenseCny ?? 0)}
            usd={(data?.incomeUsd ?? 0) - (data?.expenseUsd ?? 0)}
            size="sm"
            mainClass={
              (data?.incomeCny ?? 0) - (data?.expenseCny ?? 0) >= 0
                ? 'text-emerald-400'
                : 'text-rose-400'
            }
          />
        </div>
        <span className="ml-auto text-[11px] text-slate-600">
          {isFetching ? '刷新中…' : '按快照汇率折算'}
        </span>
      </div>

      {/* 滚动表格主体 */}
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto px-4 md:px-12">
        <table className="w-full min-w-[1000px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-900">
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="border-b border-slate-800 px-3 py-2.5 font-medium">日期 Date</th>
              <th className="border-b border-slate-800 px-3 py-2.5 font-medium">项目 Project</th>
              <th className="border-b border-slate-800 px-3 py-2.5 font-medium">科目 Category</th>
              <th className="border-b border-slate-800 px-3 py-2.5 font-medium">方向</th>
              <th className="border-b border-slate-800 px-3 py-2.5 text-right font-medium">
                金额 Amount (¥ / $)
              </th>
              <th className="border-b border-slate-800 px-3 py-2.5 font-medium">对手方</th>
              <th className="border-b border-slate-800 px-3 py-2.5 font-medium">备注</th>
              <th className="border-b border-slate-800 px-3 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-xs text-slate-600">
                  加载中…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-xs text-slate-600">
                  暂无流水数据
                </td>
              </tr>
            ) : (
              items.map((t) => (
                <tr key={t.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-300">
                    {formatDate(t.txnDate)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="leading-tight">
                      <div className="text-slate-200">{t.projectNameCn}</div>
                      <div className="text-[11px] text-slate-500">{t.projectNameEn}</div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="leading-tight">
                      <div className="text-slate-200">{t.categoryNameCn}</div>
                      <div className="text-[11px] text-slate-500">{t.categoryNameEn}</div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] ${
                        t.direction === 'income'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-rose-500/10 text-rose-400'
                      }`}
                    >
                      {DIRECTION_LABEL[t.direction].cn} {DIRECTION_LABEL[t.direction].en}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    <Money cny={t.amountCny} usd={t.amountUsd} size="sm" align="right" />
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-2.5 text-slate-400">
                    {t.counterparty || '—'}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2.5 text-slate-500" title={t.note ?? ''}>
                    {t.note || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    <div className="inline-flex gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => openVoucher(t)}>
                        {t.attachmentCount > 0 ? `凭证 ${t.attachmentCount}` : '凭证'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                        编辑
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => removeTransaction(t)}>
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 固定分页 */}
      <div className="shrink-0 border-t border-slate-800 px-4 py-3 md:px-12">
        <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPageChange={setPage} />
      </div>

      {/* 新增 / 编辑弹窗 */}
      <Modal
        open={modalOpen}
        title={editing ? 'Edit Transaction · 编辑流水' : 'New Transaction · 新增流水'}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button onClick={submitForm}>{editing ? '保存' : '创建'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Project *">
              <Select
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
              >
                <option value="">请选择项目</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameCn} {p.nameEn}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category *">
              <Select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">请选择科目</option>
                <CategoryOptions categories={categories} />
              </Select>
            </Field>
            <Field label="Direction">
              <Select
                value={form.direction}
                onChange={(e) => setForm({ ...form, direction: e.target.value as Direction })}
              >
                <option value="income">收入 Income</option>
                <option value="expense">支出 Expense</option>
              </Select>
            </Field>
            <Field label="Date *">
              <DateInput
                value={form.txnDate}
                onChange={(v) => setForm({ ...form, txnDate: v })}
              />
            </Field>
            <Field label="Amount (CNY) *" hint="人民币原值">
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={form.amountCny}
                onChange={(e) => setForm({ ...form, amountCny: e.target.value })}
              />
            </Field>
            <Field label="Counterparty" hint="可手填 / 可挑选">
              <div className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder="交易对手 / 供应商"
                  value={form.counterparty}
                  onChange={(e) => setForm({ ...form, counterparty: e.target.value })}
                />
                <Button
                  type="button"
                  variant="subtle"
                  className="shrink-0"
                  onClick={() => setSupplierPickerOpen(true)}
                >
                  选择
                </Button>
              </div>
            </Field>
          </div>
          <Field label="Note">
            <Input
              placeholder="备注"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>

          {formError && (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {formError}
            </div>
          )}
        </div>
      </Modal>

      {/* 供应商选择弹窗 */}
      <SupplierPicker
        open={supplierPickerOpen}
        onClose={() => setSupplierPickerOpen(false)}
        categories={categories}
        defaultCategoryId={form.categoryId ? Number(form.categoryId) : undefined}
        role={form.direction === 'income' ? 'customer' : 'vendor'}
        onPick={(s) => setForm((prev) => ({ ...prev, counterparty: s.nameCn }))}
      />

      {/* 凭证附件弹窗 */}
      <Modal
        open={voucherTxn !== null}
        title="Voucher · 凭证原件"
        onClose={() => setVoucherTxn(null)}
        footer={
          <Button variant="ghost" onClick={() => setVoucherTxn(null)}>
            关闭
          </Button>
        }
      >
        {voucherTxn && (
          <div className="space-y-3">
            <div className="rounded-md border border-slate-700 bg-slate-800/40 px-3 py-2 text-xs text-slate-400">
              <span className="text-slate-200">{formatDate(voucherTxn.txnDate)}</span>
              {' · '}
              {voucherTxn.categoryNameCn}
              {' · ¥'}
              {voucherTxn.amountCny}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">凭证原件（PDF，≤ 10 MB）</span>
              <label
                className={`rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-200 ${
                  voucherUploading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-slate-700'
                }`}
              >
                {voucherUploading ? '上传中…' : '上传凭证'}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  disabled={voucherUploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    void uploadVoucher(f);
                  }}
                />
              </label>
            </div>
            {voucherError && (
              <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {voucherError}
              </div>
            )}
            {voucherLoading ? (
              <div className="py-6 text-center text-xs text-slate-600">加载凭证中…</div>
            ) : voucherItems.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-600">暂无凭证附件</div>
            ) : (
              <ul className="space-y-2">
                {voucherItems.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-slate-700 bg-slate-800/40 px-3 py-2"
                  >
                    <div className="min-w-0 leading-tight">
                      <div className="truncate text-sm text-slate-200">{a.fileName}</div>
                      <div className="text-[11px] text-slate-500">
                        {a.sizeBytes ? `${(a.sizeBytes / 1024).toFixed(0)} KB` : '—'}
                      </div>
                    </div>
                    {a.downloadUrl ? (
                      <a
                        href={a.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
                      >
                        下载 PDF
                      </a>
                    ) : (
                      <span className="shrink-0 text-[11px] text-slate-600">未配置 R2</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
