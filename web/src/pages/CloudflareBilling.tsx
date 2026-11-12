import { useMemo, useState } from 'react';
import {
  extractErrorMessage,
  useGetCategoriesQuery,
  useGetCloudflareBillsQuery,
  useGetProjectsQuery,
  useImportCloudflareInvoiceMutation,
  useParseCloudflareInvoiceMutation,
  useUpdateCloudflareBillMutation,
  type Category,
  type CloudflareBillLine,
  type CloudflareInvoiceLine,
  type CloudflareInvoiceLineKind,
  type CloudflareInvoiceParse,
} from '../api';
import { Card, CardHeader, Empty, PageHeader } from '../components/Card';
import { Button, DateInput, Field, Input, MonthInput, Select } from '../components/Field';
import { todayISO } from '../lib/format';

type InvoiceRow = CloudflareInvoiceLine & {
  selected: boolean;
  projectId: string;
  categoryId: string;
};

/** 明细类别 → 中文标签。 */
const KIND_LABEL: Record<CloudflareInvoiceLineKind, string> = {
  domain: '域名',
  r2: '对象存储 (R2)',
  stream: '转码/流媒体',
  images: '图片/CDN',
  other: '其他',
};

const MIN_AMOUNT = 0.005;

function fmtAmount(v: number | null | undefined): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(
    Number(v ?? 0)
  );
}

function fmtQty(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v);
}

/* ------------------------------------------------------------------ */
/* 账单列表 Tab：展示全部已导入账单，可调整最终归属                     */
/* ------------------------------------------------------------------ */

type BillDraft = { projectId: string; categoryId: string };

function BillListTab() {
  const { data: projects = [] } = useGetProjectsQuery();
  const { data: allCategories = [] } = useGetCategoriesQuery({});
  const expenseCategories = useMemo(
    () => allCategories.filter((category) => category.type === 'expense' && category.parentId !== null),
    [allCategories]
  );
  const incomeCategories = useMemo(
    () => allCategories.filter((category) => category.type === 'income' && category.parentId !== null),
    [allCategories]
  );

  const [period, setPeriod] = useState('');
  const [sourceType, setSourceType] = useState<'' | 'usage' | 'invoice'>('');
  const { data, isLoading, isFetching } = useGetCloudflareBillsQuery({
    period: period || undefined,
    sourceType: sourceType || undefined,
  });
  const [updateBill] = useUpdateCloudflareBillMutation();

  const bills = data?.items ?? [];
  const [drafts, setDrafts] = useState<Record<number, BillDraft>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const draftOf = (bill: CloudflareBillLine): BillDraft =>
    drafts[bill.id] ?? { projectId: String(bill.projectId), categoryId: String(bill.categoryId) };

  const isDirty = (bill: CloudflareBillLine) => {
    const draft = draftOf(bill);
    return Number(draft.projectId) !== bill.projectId || Number(draft.categoryId) !== bill.categoryId;
  };

  const setDraft = (bill: CloudflareBillLine, patch: Partial<BillDraft>) =>
    setDrafts((current) => {
      const base = current[bill.id] ?? {
        projectId: String(bill.projectId),
        categoryId: String(bill.categoryId),
      };
      return { ...current, [bill.id]: { ...base, ...patch } };
    });

  const categoriesFor = (bill: CloudflareBillLine) =>
    bill.direction === 'income' ? incomeCategories : expenseCategories;

  const save = async (bill: CloudflareBillLine) => {
    const draft = draftOf(bill);
    setSavingId(bill.id);
    setError(null);
    setNotice(null);
    try {
      await updateBill({
        id: bill.id,
        projectId: Number(draft.projectId),
        categoryId: Number(draft.categoryId),
      }).unwrap();
      setDrafts((current) => {
        const next = { ...current };
        delete next[bill.id];
        return next;
      });
      setNotice(`已更新账单归属：${bill.sourceName}`);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSavingId(null);
    }
  };

  const totalCny = bills.reduce((sum, bill) => sum + Number(bill.amountCny), 0);

  return (
    <Card>
      <CardHeader
        en="Imported Bills"
        cn="已导入账单 · 可调整最终归属（项目 / 科目）"
        right={
          <span className="text-[11px] text-slate-500">
            共 {bills.length} 条 · 合计 ¥{fmtAmount(totalCny)}
            {isFetching && !isLoading ? ' · 刷新中…' : ''}
          </span>
        }
      />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="账单期" hint="可选">
            <MonthInput value={period} onChange={setPeriod} className="max-w-[12rem]" />
          </Field>
          <Field label="来源类型">
            <Select
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value as '' | 'usage' | 'invoice')}
              className="max-w-[12rem]"
            >
              <option value="">全部</option>
              <option value="invoice">发票 Invoice</option>
              <option value="usage">用量 Usage</option>
            </Select>
          </Field>
          {(period || sourceType) && (
            <Button
              variant="ghost"
              onClick={() => {
                setPeriod('');
                setSourceType('');
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
        ) : bills.length === 0 ? (
          <Empty text="暂无已导入账单" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full min-w-[1180px] text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-500">
                <tr>
                  <th className="px-3 py-2">账单期</th>
                  <th className="px-3 py-2">类型</th>
                  <th className="px-3 py-2">费用来源 / 明细</th>
                  <th className="w-28 px-3 py-2">发票号</th>
                  <th className="w-24 px-3 py-2">入账日期</th>
                  <th className="px-3 py-2 text-right">原币金额</th>
                  <th className="px-3 py-2 text-right">金额 (CNY)</th>
                  <th className="w-40 px-3 py-2">项目归属</th>
                  <th className="w-52 px-3 py-2">科目归属</th>
                  <th className="w-24 px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {bills.map((bill) => {
                  const draft = draftOf(bill);
                  const dirty = isDirty(bill);
                  return (
                    <tr key={bill.id} className="align-middle text-slate-300">
                      <td className="px-3 py-2.5 tabular-nums text-slate-400">{bill.billingPeriod}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            bill.direction === 'income'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {bill.sourceType === 'invoice' ? '发票' : '用量'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="max-w-[280px] truncate font-medium text-slate-200" title={bill.sourceName}>
                          {bill.sourceName}
                        </div>
                        {bill.attachmentCount > 0 && (
                          <span className="mt-0.5 inline-block text-[10px] text-slate-500">含账单原件</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-400">{bill.invoiceNo ?? '—'}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-400">{bill.txnDate}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">
                        {bill.currency} {fmtAmount(bill.amountSrc)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums text-slate-100">
                        {fmtAmount(bill.amountCny)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Select value={draft.projectId} onChange={(e) => setDraft(bill, { projectId: e.target.value })}>
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
                          onChange={(e) => setDraft(bill, { categoryId: e.target.value })}
                        >
                          {categoriesFor(bill).map((category: Category) => (
                            <option key={category.id} value={category.id}>
                              {category.nameCn} {category.nameEn}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {dirty ? (
                          <Button size="sm" disabled={savingId === bill.id} onClick={() => void save(bill)}>
                            {savingId === bill.id ? '保存中…' : '保存'}
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
          调整归属会同时更新该账单已生成的支出流水（以台账为权威口径）。科目按账单方向（收入 / 支出）过滤。
        </p>
      </div>
    </Card>
  );
}

export default function CloudflareBilling() {
  const [tab, setTab] = useState<'import' | 'bills'>('import');
  const { data: projects = [] } = useGetProjectsQuery();
  const { data: allCategories = [] } = useGetCategoriesQuery({});
  const expenseCategories = useMemo(
    () => allCategories.filter((category) => category.type === 'expense' && category.parentId !== null),
    [allCategories]
  );
  const defaultProjectId = String(projects[0]?.id ?? '');
  const fallbackCategoryId = String(expenseCategories[0]?.id ?? '');

  const [parseInvoice, { isLoading: parsingInvoice }] = useParseCloudflareInvoiceMutation();
  const [importInvoice, { isLoading: importingInvoice }] = useImportCloudflareInvoiceMutation();

  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoiceParse, setInvoiceParse] = useState<CloudflareInvoiceParse | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [invoiceRows, setInvoiceRows] = useState<InvoiceRow[]>([]);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [invoiceNotice, setInvoiceNotice] = useState<string | null>(null);

  const resolveCategoryId = (suggested: number | null): string => {
    if (suggested && expenseCategories.some((category) => category.id === suggested)) {
      return String(suggested);
    }
    return fallbackCategoryId;
  };

  const toRows = (parsed: CloudflareInvoiceParse): InvoiceRow[] =>
    parsed.items.map((line) => ({
      ...line,
      selected: !line.imported && line.amount >= MIN_AMOUNT,
      projectId: defaultProjectId,
      categoryId: resolveCategoryId(line.suggestedCategoryId),
    }));

  const handleFile = async (file?: File) => {
    if (!file) return;
    setInvoiceError(null);
    setInvoiceNotice(null);
    setInvoiceFile(file);
    try {
      const parsed = await parseInvoice(file).unwrap();
      setInvoiceParse(parsed);
      setInvoiceNumber(parsed.invoiceNumber);
      setInvoiceDate(parsed.invoiceDate ?? todayISO());
      setInvoiceRows(toRows(parsed));
      if (parsed.parseWarning) setInvoiceError(parsed.parseWarning);
      else if (!parsed.items.length) {
        setInvoiceError('PDF 已读取，但未识别出任何费用行。请确认这是一张 Cloudflare 费用发票。');
      }
      if (parsed.uploadWarning) setInvoiceNotice(parsed.uploadWarning);
    } catch (error) {
      setInvoiceParse(null);
      setInvoiceRows([]);
      setInvoiceError(extractErrorMessage(error));
    }
  };

  const updateRow = (lineKey: string, patch: Partial<InvoiceRow>) => {
    setInvoiceRows((current) =>
      current.map((row) => (row.lineKey === lineKey ? { ...row, ...patch } : row))
    );
  };

  const selectable = (row: InvoiceRow) => !row.imported && row.amount >= MIN_AMOUNT;
  const allSelectableSelected =
    invoiceRows.some(selectable) && invoiceRows.filter(selectable).every((row) => row.selected);
  const toggleAll = () => {
    const next = !allSelectableSelected;
    setInvoiceRows((current) => current.map((row) => (selectable(row) ? { ...row, selected: next } : row)));
  };

  const selectedRows = invoiceRows.filter((row) => row.selected && selectable(row));
  const selectedTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of selectedRows) totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amount);
    return [...totals];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceRows]);

  const parsedTotal = invoiceParse?.total ?? null;
  const lineSum = invoiceRows.reduce((sum, row) => sum + row.amount, 0);
  const totalMatches = parsedTotal === null || Math.abs(parsedTotal - lineSum) < 0.01;

  const canImport =
    Boolean(invoiceParse) &&
    Boolean(invoiceNumber.trim()) &&
    selectedRows.length > 0 &&
    selectedRows.every((row) => row.projectId && row.categoryId);

  const confirmImport = async () => {
    if (!invoiceParse || !canImport) return;
    setInvoiceError(null);
    setInvoiceNotice(null);
    const sending = selectedRows.slice();
    try {
      const result = await importInvoice({
        documentHash: invoiceParse.documentHash,
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        objectKey: invoiceParse.objectKey ?? null,
        fileName: invoiceFile?.name,
        fileSize: invoiceParse.fileSize,
        items: sending.map((row) => ({
          description: row.description,
          amount: Number(row.amount),
          currency: row.currency,
          projectId: Number(row.projectId),
          categoryId: Number(row.categoryId),
        })),
      }).unwrap();
      const sentKeys = new Set(sending.map((row) => row.lineKey));
      setInvoiceRows((current) =>
        current.map((row) => (sentKeys.has(row.lineKey) ? { ...row, imported: true, selected: false } : row))
      );
      setInvoiceNotice(
        `新增 ${result.transactionCount} 条流水，跳过重复 ${result.skipped} 项（已入账明细不会再重复导入）。`
      );
    } catch (error) {
      setInvoiceError(extractErrorMessage(error));
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-5 md:px-12 md:py-6">
      <PageHeader en="Cloudflare Billing" cn="上传 Cloudflare 发票，核对后一键入账" />
      <div className="mb-4 flex gap-1 border-b border-slate-800">
        {(
          [
            { key: 'import', en: 'Invoice Import', cn: '发票导入' },
            { key: 'bills', en: 'Imported Bills', cn: '账单列表' },
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
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-6">
        {tab === 'bills' ? (
          <BillListTab />
        ) : (
        <Card>
          <CardHeader
            en="Invoice Import"
            cn="以发票为记账口径 · 支持存量、R2、域名注册、Stream/Images 订阅等全部费用行"
          />
          <div className="space-y-4 p-5">
            <p className="text-xs leading-5 text-slate-500">
              上传 Cloudflare 发票 PDF，系统自动识别发票编号、日期与全部费用行，并按类别建议科目。确认后生成支出流水，
              账单原件留存至私有存储。幂等键为「发票号 + 明细描述 + 金额 + 币种」，同一张发票重复上传只会跳过，不会重复入账。
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Cloudflare 发票 PDF">
                <Input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="max-w-md file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-1 file:text-xs"
                  onChange={(event) => void handleFile(event.target.files?.[0])}
                  disabled={parsingInvoice}
                />
              </Field>
              {parsingInvoice && <span className="pb-2 text-xs text-slate-500">正在读取 PDF…</span>}
              {invoiceFile && !parsingInvoice && (
                <span className="pb-2 text-xs text-slate-500">{invoiceFile.name}</span>
              )}
            </div>
            {invoiceError && (
              <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{invoiceError}</div>
            )}
            {invoiceNotice && (
              <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{invoiceNotice}</div>
            )}

            {invoiceParse && (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="发票编号">
                    <Input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} />
                  </Field>
                  <Field label="发票日期" hint="记账日期">
                    <DateInput value={invoiceDate} onChange={setInvoiceDate} />
                  </Field>
                  <Field label="币种">
                    <Input value={invoiceParse.currency} readOnly />
                  </Field>
                  <Field label="发票合计" hint={totalMatches ? '与明细一致' : '与明细不一致'}>
                    <Input
                      value={
                        parsedTotal === null
                          ? `明细合计 ${fmtAmount(lineSum)}`
                          : `${invoiceParse.currency} ${fmtAmount(parsedTotal)}`
                      }
                      readOnly
                      className={totalMatches ? '' : 'border-amber-500/60 text-amber-300'}
                    />
                  </Field>
                </div>

                {!totalMatches && (
                  <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    明细合计 {fmtAmount(lineSum)} 与发票合计 {fmtAmount(parsedTotal ?? 0)} 不一致，请核对后再入账。
                  </div>
                )}

                {invoiceRows.length ? (
                  <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <table className="w-full min-w-[1080px] text-left text-xs">
                      <thead className="bg-slate-950/80 text-slate-500">
                        <tr>
                          <th className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={allSelectableSelected}
                              onChange={toggleAll}
                              aria-label="全选"
                              className="accent-emerald-500"
                            />
                          </th>
                          <th className="px-3 py-2">类别</th>
                          <th className="px-3 py-2">费用明细</th>
                          <th className="px-3 py-2 text-right">数量</th>
                          <th className="px-3 py-2 text-right">单价</th>
                          <th className="px-3 py-2 text-right">金额</th>
                          <th className="w-40 px-3 py-2">项目</th>
                          <th className="w-52 px-3 py-2">科目</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {invoiceRows.map((row) => {
                          const disabled = !selectable(row);
                          return (
                            <tr key={row.lineKey} className={`align-middle ${row.imported ? 'opacity-50' : 'text-slate-300'}`}>
                              <td className="px-3 py-2.5">
                                <input
                                  type="checkbox"
                                  checked={row.selected}
                                  disabled={disabled}
                                  onChange={(event) => updateRow(row.lineKey, { selected: event.target.checked })}
                                  aria-label={`导入 ${row.description}`}
                                  className="accent-emerald-500"
                                />
                                {row.imported && <span className="ml-2 text-[10px] text-emerald-500">已入账</span>}
                              </td>
                              <td className="px-3 py-2.5">
                                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                                  {KIND_LABEL[row.kind]}
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="font-medium text-slate-200">{row.description}</div>
                                {row.domain && <div className="mt-0.5 text-[10px] text-slate-500">{row.domain}</div>}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">{fmtQty(row.quantity)}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">
                                {row.unitPrice === null ? '—' : fmtAmount(row.unitPrice)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-medium tabular-nums text-slate-100">
                                {row.currency} {fmtAmount(row.amount)}
                              </td>
                              <td className="px-3 py-2.5">
                                <Select
                                  value={row.projectId}
                                  onChange={(event) => updateRow(row.lineKey, { projectId: event.target.value })}
                                  disabled={disabled}
                                >
                                  {projects.map((project) => (
                                    <option key={project.id} value={project.id}>{project.nameCn}</option>
                                  ))}
                                </Select>
                              </td>
                              <td className="px-3 py-2.5">
                                <Select
                                  value={row.categoryId}
                                  onChange={(event) => updateRow(row.lineKey, { categoryId: event.target.value })}
                                  disabled={disabled}
                                >
                                  {expenseCategories.map((category: Category) => (
                                    <option key={category.id} value={category.id}>
                                      {category.nameCn} {category.nameEn}
                                    </option>
                                  ))}
                                </Select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty text="该发票未识别出费用行" />
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-slate-400">
                    已选 {selectedRows.length} 项 ·{' '}
                    <span className="font-semibold text-slate-100">
                      {selectedTotals.length
                        ? selectedTotals.map(([currency, amount]) => `${currency} ${fmtAmount(amount)}`).join(' + ')
                        : '—'}
                    </span>
                  </div>
                  <Button onClick={confirmImport} disabled={importingInvoice || !canImport}>
                    {importingInvoice ? '正在入账…' : `确认导入 ${selectedRows.length} 项`}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
        )}
      </div>
    </div>
  );
}
