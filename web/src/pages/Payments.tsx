import { useMemo, useState } from 'react';
import {
  extractErrorMessage,
  useGetCategoriesQuery,
  useGetPaymentSourcesQuery,
  useGetProjectsQuery,
  useImportPaymentsMutation,
  useLazyPreviewPaymentsQuery,
  type Category,
  type PaymentPreview,
  type PaymentPreviewItem,
  type PaymentSource,
} from '../api';
import { Card, CardHeader, Empty, PageHeader } from '../components/Card';
import { Button, Field, MonthInput, Select } from '../components/Field';
import { formatCny } from '../lib/format';

type RowState = {
  selected: boolean;
  projectId: string;
  categoryId: string;
  feeCategoryId: string;
};

const SOURCES: { source: PaymentSource; label: string }[] = [
  { source: 'stripe', label: 'Stripe' },
  { source: 'paypal', label: 'PayPal' },
];

function previousMonth(): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function money(value: number, currency: string): string {
  return `${currency} ${formatCny(value)}`;
}

function CategoryOptions({ categories, type }: { categories: Category[]; type: 'income' | 'expense' }) {
  return (
    <>
      {categories
        .filter((category) => category.type === type && category.parentId !== null)
        .map((category) => (
          <option key={category.id} value={category.id}>
            {category.nameCn} {category.nameEn}
          </option>
        ))}
    </>
  );
}

export default function Payments() {
  const { data: projects = [] } = useGetProjectsQuery();
  const { data: allCategories = [] } = useGetCategoriesQuery({});
  const { data: sourceStatus = [] } = useGetPaymentSourcesQuery();

  const incomeCategories = useMemo(
    () => allCategories.filter((category) => category.type === 'income' && category.parentId !== null),
    [allCategories]
  );
  const expenseCategories = useMemo(
    () => allCategories.filter((category) => category.type === 'expense' && category.parentId !== null),
    [allCategories]
  );

  const defaultProjectId = String(projects[0]?.id ?? '');
  const defaultIncomeCategoryId = String(
    incomeCategories.some((category) => category.id === 10101) ? 10101 : incomeCategories[0]?.id ?? ''
  );
  const defaultFeeCategoryId = String(
    expenseCategories.some((category) => category.id === 20602) ? 20602 : expenseCategories[0]?.id ?? ''
  );

  const [source, setSource] = useState<PaymentSource>('stripe');
  const [period, setPeriod] = useState(previousMonth);
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [runPreview, { isFetching: loading }] = useLazyPreviewPaymentsQuery();
  const [importPayments, { isLoading: importing }] = useImportPaymentsMutation();

  const enabled = sourceStatus.find((item) => item.source === source)?.enabled ?? true;

  const switchSource = (next: PaymentSource) => {
    setSource(next);
    setPreview(null);
    setRows({});
    setError(null);
    setNotice(null);
  };

  const handlePreview = async () => {
    setError(null);
    setNotice(null);
    try {
      const result = await runPreview({ source, period }).unwrap();
      setPreview(result);
      setRows(
        Object.fromEntries(
          result.items.map((item) => [
            item.sourceKey,
            {
              selected: !item.imported && item.gross >= 0.005,
              projectId: defaultProjectId,
              categoryId: defaultIncomeCategoryId,
              feeCategoryId: item.fee > 0 ? defaultFeeCategoryId : '',
            },
          ])
        )
      );
    } catch (err) {
      setPreview(null);
      setError(extractErrorMessage(err));
    }
  };

  const updateRow = (sourceKey: string, patch: Partial<RowState>) => {
    setRows((current) => ({ ...current, [sourceKey]: { ...current[sourceKey], ...patch } }));
  };

  const selected = preview?.items.filter((item) => rows[item.sourceKey]?.selected && !item.imported) ?? [];

  const totals = useMemo(() => {
    const gross = new Map<string, number>();
    const fee = new Map<string, number>();
    for (const item of selected) {
      gross.set(item.currency, (gross.get(item.currency) ?? 0) + item.gross);
      fee.set(item.currency, (fee.get(item.currency) ?? 0) + item.fee);
    }
    return { gross: [...gross], fee: [...fee] };
  }, [selected]);

  const confirmImport = async () => {
    if (!preview || !selected.length) return;
    setError(null);
    setNotice(null);
    try {
      const result = await importPayments({
        source,
        period: preview.period,
        items: selected.map((item) => ({
          sourceKey: item.sourceKey,
          projectId: Number(rows[item.sourceKey]?.projectId),
          categoryId: Number(rows[item.sourceKey]?.categoryId),
          feeCategoryId: rows[item.sourceKey]?.feeCategoryId
            ? Number(rows[item.sourceKey]?.feeCategoryId)
            : null,
        })),
      }).unwrap();
      setNotice(
        `处理 ${result.imported + result.skipped} 笔：新增收入流水 ${result.incomeCount} 条、手续费流水 ${result.feeCount} 条，跳过重复 ${result.skipped} 笔。`
      );
      await handlePreview();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const previewTotals = useMemo(() => {
    if (!preview) return null;
    const gross = new Map<string, number>();
    for (const item of preview.items) {
      gross.set(item.currency, (gross.get(item.currency) ?? 0) + item.gross);
    }
    return [...gross];
  }, [preview]);

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-5 md:px-12 md:py-6">
      <PageHeader en="Payment Channels" cn="支付渠道 · Stripe / PayPal 收入自动同步" />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-6">
        <Card>
          <CardHeader
            en="Revenue Sync"
            cn="拉取渠道账单 → 毛额记收入、手续费记支出（拆两行）"
            right={
              <div className="flex items-end gap-2">
                <div className="flex overflow-hidden rounded-md border border-slate-700">
                  {SOURCES.map((item) => (
                    <button
                      key={item.source}
                      onClick={() => switchSource(item.source)}
                      className={`px-4 py-2 text-sm font-medium transition ${
                        source === item.source
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <Field label="计费月份">
                  <MonthInput value={period} onChange={setPeriod} />
                </Field>
                <Button onClick={handlePreview} disabled={loading || !period}>
                  {loading ? '读取中…' : '预览账单'}
                </Button>
              </div>
            }
          />
          <div className="space-y-3 p-5">
            <p className="text-xs leading-5 text-slate-500">
              {source === 'stripe'
                ? '读取 Stripe balance_transactions（默认 charge 类型）：毛额入收入、平台手续费单独记入「支付手续费」科目；退款等非正金额交易自动排除。'
                : '读取 PayPal reporting/transactions：毛额入收入、PayPal 手续费单独记入「支付手续费」科目；退款等非正金额交易自动排除。'}
              {' '}导入后自动关联到对应渠道的资金账户（Stripe 余额 / PayPal 余额），便于对账。
            </p>
            {!enabled && (
              <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                当前渠道未配置 API 凭据，请在后端 .env 设置
                {source === 'stripe' ? ' STRIPE_SECRET_KEY' : ' PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET'} 后重启服务。
              </div>
            )}
            {error && <div className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}
            {notice && <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>}

            {preview && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3">
                  <div className="text-xs text-slate-400">
                    {preview.source.toUpperCase()} · {preview.period} · {preview.items.length} 笔交易
                    {preview.skipped > 0 && `（已排除非正金额 ${preview.skipped} 笔）`}
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <div className="text-sm font-semibold text-slate-100">
                      已选 {selected.length} 笔 · 收入{' '}
                      {totals.gross.length
                        ? totals.gross.map(([ccy, amount]) => money(amount, ccy)).join(' + ')
                        : '—'}
                    </div>
                    {totals.fee.length > 0 && (
                      <div className="text-[11px] text-rose-300">
                        手续费 {totals.fee.map(([ccy, amount]) => money(amount, ccy)).join(' + ')}
                      </div>
                    )}
                  </div>
                </div>

                {preview.items.length ? (
                  <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <table className="w-full min-w-[1040px] text-left text-xs">
                      <thead className="bg-slate-950/80 text-slate-500">
                        <tr>
                          <th className="px-3 py-2">导入</th>
                          <th className="px-3 py-2">交易</th>
                          <th className="px-3 py-2 text-right">毛额</th>
                          <th className="px-3 py-2 text-right">手续费</th>
                          <th className="px-3 py-2 text-right">净额</th>
                          <th className="px-3 py-2">项目</th>
                          <th className="px-3 py-2">收入科目</th>
                          <th className="px-3 py-2">手续费科目</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {preview.items.map((item: PaymentPreviewItem) => {
                          const row =
                            rows[item.sourceKey] ?? {
                              selected: false,
                              projectId: defaultProjectId,
                              categoryId: defaultIncomeCategoryId,
                              feeCategoryId: defaultFeeCategoryId,
                            };
                          return (
                            <tr key={item.sourceKey} className="align-middle text-slate-300">
                              <td className="px-3 py-2.5">
                                <input
                                  type="checkbox"
                                  checked={row.selected}
                                  disabled={item.imported || item.gross < 0.005}
                                  onChange={(event) =>
                                    updateRow(item.sourceKey, { selected: event.target.checked })
                                  }
                                  aria-label={`导入 ${item.description}`}
                                  className="accent-emerald-500"
                                />
                                {item.imported && (
                                  <span className="ml-2 text-[10px] text-emerald-500">已导入</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="font-medium text-slate-200">{item.description}</div>
                                <div className="mt-0.5 text-[10px] text-slate-500">
                                  {item.counterparty} · {item.occurredAt}
                                  {item.reference ? ` · ${item.reference}` : ''}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right font-medium tabular-nums text-emerald-400">
                                {money(item.gross, item.currency)}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-rose-300">
                                {item.fee > 0 ? money(item.fee, item.currency) : '—'}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">
                                {money(item.gross - item.fee, item.currency)}
                              </td>
                              <td className="w-36 px-3 py-2.5">
                                <Select
                                  value={row.projectId}
                                  onChange={(event) =>
                                    updateRow(item.sourceKey, { projectId: event.target.value })
                                  }
                                  disabled={item.imported}
                                >
                                  {projects.map((project) => (
                                    <option key={project.id} value={project.id}>
                                      {project.nameCn}
                                    </option>
                                  ))}
                                </Select>
                              </td>
                              <td className="w-52 px-3 py-2.5">
                                <Select
                                  value={row.categoryId}
                                  onChange={(event) =>
                                    updateRow(item.sourceKey, { categoryId: event.target.value })
                                  }
                                  disabled={item.imported}
                                >
                                  <CategoryOptions categories={allCategories} type="income" />
                                </Select>
                              </td>
                              <td className="w-52 px-3 py-2.5">
                                <Select
                                  value={row.feeCategoryId}
                                  onChange={(event) =>
                                    updateRow(item.sourceKey, { feeCategoryId: event.target.value })
                                  }
                                  disabled={item.imported || item.fee <= 0}
                                >
                                  <option value="">不记手续费</option>
                                  <CategoryOptions categories={allCategories} type="expense" />
                                </Select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty text="该月没有可同步的渠道收入交易" />
                )}

                {previewTotals && preview.items.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-[11px] text-slate-500">
                      全月毛额合计：{previewTotals.map(([ccy, amount]) => money(amount, ccy)).join(' + ')}
                    </div>
                    <Button onClick={confirmImport} disabled={importing || !selected.length}>
                      {importing ? '正在入账…' : `确认导入 ${selected.length} 笔`}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
