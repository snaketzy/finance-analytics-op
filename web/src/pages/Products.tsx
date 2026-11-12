import { useEffect, useMemo, useState } from 'react';
import {
  extractErrorMessage,
  useAddProductProjectMutation,
  useCreateProductMutation,
  useDeleteProductMutation,
  useGetProductDetailQuery,
  useGetProductsQuery,
  useGetProjectsQuery,
  useLazyGetProjectSharesQuery,
  useRemoveProductProjectMutation,
  useUpdateProductMutation,
  useUpdateProjectAllocationsMutation,
  type Product,
  type ProductComposition,
  type ProductInput,
  type ProductKind,
  type ProductStatus,
} from '../api';
import { Card, CardHeader, Empty, PageHeader } from '../components/Card';
import { Button, DateInput, Field, Input, Select } from '../components/Field';
import { Modal } from '../components/Modal';
import { formatCny, formatDate, todayISO } from '../lib/format';

/* ------------------------------------------------------------------ */
/* 元数据                                                              */
/* ------------------------------------------------------------------ */

const KIND_LABEL: Record<ProductKind, { cn: string; en: string }> = {
  frontend: { cn: '前台', en: 'Frontend' },
  backend: { cn: '后台', en: 'Backend' },
  platform: { cn: '平台', en: 'Platform' },
  other: { cn: '其他', en: 'Other' },
};

const STATUS_LABEL: Record<ProductStatus, { cn: string; en: string }> = {
  active: { cn: '在营', en: 'Active' },
  paused: { cn: '暂停', en: 'Paused' },
  archived: { cn: '归档', en: 'Archived' },
};

const toPct = (ratio: number) => Math.round(ratio * 10000) / 100;
const fmtPct = (ratio: number) => `${toPct(ratio).toFixed(2)}%`;

/* ------------------------------------------------------------------ */
/* 产品信息表单                                                        */
/* ------------------------------------------------------------------ */

type FormState = {
  code: string;
  nameCn: string;
  nameEn: string;
  kind: ProductKind;
  status: ProductStatus;
  launchDate: string;
  sortOrder: string;
  note: string;
};

function toForm(p?: Product): FormState {
  return {
    code: p?.code ?? '',
    nameCn: p?.nameCn ?? '',
    nameEn: p?.nameEn ?? '',
    kind: p?.kind ?? 'other',
    status: p?.status ?? 'active',
    launchDate: p?.launchDate ? String(p.launchDate).slice(0, 10) : '',
    sortOrder: String(p?.sortOrder ?? 0),
    note: p?.note ?? '',
  };
}

function ProductForm({
  initial,
  saving,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Product;
  saving: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: (body: ProductInput) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormState>(() => toForm(initial));
  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          code: f.code.trim(),
          nameCn: f.nameCn.trim(),
          nameEn: f.nameEn.trim(),
          kind: f.kind,
          status: f.status,
          launchDate: f.launchDate || null,
          sortOrder: Number(f.sortOrder) || 0,
          note: f.note.trim() || null,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code" hint="唯一标识">
          <Input value={f.code} onChange={(e) => set({ code: e.target.value })} placeholder="如 vidday-web" required />
        </Field>
        <Field label="Kind 类型">
          <Select value={f.kind} onChange={(e) => set({ kind: e.target.value as ProductKind })}>
            {(Object.keys(KIND_LABEL) as ProductKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k].en} · {KIND_LABEL[k].cn}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="中文名称">
          <Input value={f.nameCn} onChange={(e) => set({ nameCn: e.target.value })} placeholder="如 Vidday 流媒体前台" required />
        </Field>
        <Field label="English Name">
          <Input value={f.nameEn} onChange={(e) => set({ nameEn: e.target.value })} placeholder="e.g. Vidday Web" required />
        </Field>
        <Field label="Status 状态">
          <Select value={f.status} onChange={(e) => set({ status: e.target.value as ProductStatus })}>
            {(Object.keys(STATUS_LABEL) as ProductStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s].en} · {STATUS_LABEL[s].cn}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="上线日期" hint="Launch Date">
          <DateInput value={f.launchDate} onChange={(v) => set({ launchDate: v })} />
        </Field>
        <Field label="排序" hint="Sort Order">
          <Input type="number" value={f.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} />
        </Field>
        <Field label="备注" hint="Note">
          <Input value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder="选填" />
        </Field>
      </div>
      {error && <div className="mt-3 text-xs text-rose-400">{error}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? '保存中…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* 分摊比例编辑器（某项目在各产品间，合计须 = 100%）                      */
/* ------------------------------------------------------------------ */

function AllocationEditor({
  project,
  onClose,
}: {
  project: { id: number; nameCn: string; nameEn: string };
  onClose: () => void;
}) {
  const [load, { isLoading }] = useLazyGetProjectSharesQuery();
  const [save, { isLoading: saving }] = useUpdateProjectAllocationsMutation();
  const [rows, setRows] = useState<{ productId: number; nameCn: string; nameEn: string; pct: string }[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load({ projectId: project.id })
      .unwrap()
      .then((res) =>
        setRows(
          res.shares.map((s) => ({
            productId: s.productId,
            nameCn: s.nameCn,
            nameEn: s.nameEn,
            pct: String(toPct(s.ratio)),
          }))
        )
      )
      .catch((e) => setError(extractErrorMessage(e)));
  }, [project.id, load]);

  const sum = useMemo(() => rows.reduce((s, r) => s + (Number(r.pct) || 0), 0), [rows]);
  const balanced = Math.abs(sum - 100) < 0.0001;

  function equalize() {
    const n = rows.length;
    if (!n) return;
    const base = Math.round((100 / n) * 100) / 100;
    setRows((rs) =>
      rs.map((r, i) => ({ ...r, pct: String(i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base) }))
    );
  }

  async function submit() {
    setError(null);
    try {
      await save({
        projectId: project.id,
        effectiveFrom,
        items: rows.map((r) => ({ productId: r.productId, ratio: (Number(r.pct) || 0) / 100 })),
      }).unwrap();
      onClose();
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  return (
    <Modal open title={`分摊比例 / Allocation · ${project.nameEn}`} onClose={onClose} width="max-w-xl">
      {isLoading ? (
        <Empty text="加载中…" />
      ) : rows.length === 0 ? (
        <Empty text="该项目尚未被任何产品引用" />
      ) : (
        <>
          <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
            「{project.nameCn} · {project.nameEn}」在各引用产品间的分摊比例，合计须为 100%。
            保存后自所选生效日起按新比例复算，历史月份仍按当时比例。
          </p>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={r.productId} className="flex items-center gap-3">
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-sm text-slate-200">{r.nameEn}</div>
                  <div className="truncate text-[11px] text-slate-500">{r.nameCn}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    className="w-24 text-right"
                    value={r.pct}
                    onChange={(e) =>
                      setRows((rs) => rs.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))
                    }
                  />
                  <span className="text-xs text-slate-500">%</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-800 pt-3">
            <div className="text-xs">
              合计{' '}
              <span className={balanced ? 'text-emerald-400' : 'text-rose-400'}>
                {sum.toFixed(2)}%
              </span>
              {!balanced && <span className="ml-2 text-rose-400">须等于 100%</span>}
            </div>
            <Button variant="ghost" size="sm" onClick={equalize}>
              均分
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="生效起" hint="Effective From">
              <DateInput value={effectiveFrom} onChange={setEffectiveFrom} />
            </Field>
          </div>
          {error && <div className="mt-3 text-xs text-rose-400">{error}</div>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button disabled={!balanced || saving} onClick={submit}>
              {saving ? '保存中…' : '保存比例'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 主页面                                                              */
/* ------------------------------------------------------------------ */

export default function Products() {
  const { data: list, isLoading } = useGetProductsQuery();
  const { data: allProjects = [] } = useGetProjectsQuery();
  const products = list?.items ?? [];

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: detail } = useGetProductDetailQuery(selectedId ?? 0, { skip: selectedId === null });

  const [createOne, { isLoading: creating }] = useCreateProductMutation();
  const [updateOne, { isLoading: updating }] = useUpdateProductMutation();
  const [deleteOne] = useDeleteProductMutation();
  const [addProject, { isLoading: adding }] = useAddProductProjectMutation();
  const [removeProject] = useRemoveProductProjectMutation();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [addProjectId, setAddProjectId] = useState('');
  const [addFrom, setAddFrom] = useState(todayISO());
  const [actionError, setActionError] = useState<string | null>(null);

  const [editorProject, setEditorProject] = useState<{ id: number; nameCn: string; nameEn: string } | null>(null);

  useEffect(() => {
    if (selectedId === null && products.length) setSelectedId(products[0].id);
  }, [products, selectedId]);

  // 已加入本产品的项目 id
  const joinedIds = useMemo(
    () => new Set((detail?.allocations ?? []).map((a) => a.projectId)),
    [detail]
  );
  const availableProjects = useMemo(
    () => allProjects.filter((p) => !joinedIds.has(p.id)),
    [allProjects, joinedIds]
  );

  async function submitForm(body: ProductInput) {
    setFormError(null);
    try {
      if (editing) {
        await updateOne({ id: editing.id, body }).unwrap();
      } else {
        const created = await createOne(body).unwrap();
        setSelectedId(created.id);
      }
      setFormOpen(false);
    } catch (e) {
      setFormError(extractErrorMessage(e));
    }
  }

  async function removeProduct(p: Product) {
    if (!window.confirm(`确认删除产品「${p.nameCn}」？其成员项目将按剩余产品重新均摊，历史版本保留。`)) return;
    try {
      await deleteOne(p.id).unwrap();
      if (selectedId === p.id) setSelectedId(null);
    } catch (e) {
      window.alert(extractErrorMessage(e));
    }
  }

  async function handleAddProject() {
    if (!detail || !addProjectId) return;
    setActionError(null);
    try {
      await addProject({ id: detail.product.id, projectId: Number(addProjectId), effectiveFrom: addFrom }).unwrap();
      setAddProjectId('');
    } catch (e) {
      setActionError(extractErrorMessage(e));
    }
  }

  async function handleRemoveProject(projectId: number, nameCn: string) {
    if (!detail) return;
    if (!window.confirm(`确认将「${nameCn}」移出本产品？自今日起该项目成本不再摊入本产品。`)) return;
    setActionError(null);
    try {
      await removeProject({ id: detail.product.id, projectId, effectiveTo: todayISO() }).unwrap();
    } catch (e) {
      setActionError(extractErrorMessage(e));
    }
  }

  const compByProject = useMemo(() => {
    const m = new Map<number, ProductComposition>();
    for (const c of detail?.compositions ?? []) m.set(c.projectId, c);
    return m;
  }, [detail]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 md:px-12">
        <PageHeader en="Products" cn="产品维护 · 产品与项目分摊（时间版本化，合计 100%）">
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-500">共 {products.length} 个产品</span>
            <Button
              onClick={() => {
                setEditing(null);
                setFormError(null);
                setFormOpen(true);
              }}
            >
              + 新增产品
            </Button>
          </div>
        </PageHeader>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
          {/* 产品列表 */}
          <Card className="h-fit">
            <CardHeader en="Product List" cn="产品名录" />
            {isLoading ? (
              <Empty text="加载中…" />
            ) : products.length === 0 ? (
              <Empty text="暂无产品，请先新增" />
            ) : (
              <ul className="max-h-[70vh] divide-y divide-slate-800/70 overflow-y-auto">
                {products.map((p) => {
                  const selected = p.id === selectedId;
                  return (
                    <li
                      key={p.id}
                      className={`cursor-pointer px-4 py-3 transition ${
                        selected ? 'bg-emerald-500/[0.06]' : 'hover:bg-slate-800/40'
                      }`}
                      onClick={() => setSelectedId(p.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 leading-tight">
                          <div className={`truncate text-sm font-medium ${selected ? 'text-emerald-300' : 'text-slate-200'}`}>
                            {p.nameEn}
                          </div>
                          <div className="truncate text-[11px] text-slate-500">{p.nameCn}</div>
                        </div>
                        <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                          {KIND_LABEL[p.kind]?.cn ?? p.kind}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                        <span>{p.projectCount} 个项目</span>
                        <span className={STATUS_LABEL[p.status]?.cn === '在营' ? 'text-emerald-400' : 'text-amber-400'}>
                          {STATUS_LABEL[p.status]?.cn ?? p.status}
                        </span>
                        <span className="tabular-nums text-slate-400">净 ¥{formatCny(p.actuals.netCny)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* 产品详情 */}
          <div className="space-y-4">
            {!detail ? (
              <Card>
                <Empty text={selectedId === null ? '请选择或新增一个产品' : '加载中…'} />
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader
                    en={detail.product.nameEn}
                    cn={`${detail.product.nameCn} · ${detail.product.code}`}
                    right={
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(detail.product);
                            setFormError(null);
                            setFormOpen(true);
                          }}
                        >
                          编辑
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => removeProduct(detail.product)}>
                          删除
                        </Button>
                      </div>
                    }
                  />
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-5 py-4 text-xs sm:grid-cols-4">
                    <div>
                      <div className="text-[11px] text-slate-500">类型 Kind</div>
                      <div className="text-slate-200">{KIND_LABEL[detail.product.kind]?.en} · {KIND_LABEL[detail.product.kind]?.cn}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">状态 Status</div>
                      <div className="text-slate-200">{STATUS_LABEL[detail.product.status]?.en} · {STATUS_LABEL[detail.product.status]?.cn}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">上线日期</div>
                      <div className="text-slate-200">{formatDate(detail.product.launchDate)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">近 3 月分摊后</div>
                      <div className="tabular-nums text-slate-200">
                        收 ¥{formatCny(detail.actuals.revenueCny)} · 支 ¥{formatCny(detail.actuals.totalCostCny)}
                      </div>
                    </div>
                    {detail.product.note && (
                      <div className="col-span-2 sm:col-span-4">
                        <div className="text-[11px] text-slate-500">备注 Note</div>
                        <div className="text-slate-300">{detail.product.note}</div>
                      </div>
                    )}
                  </div>
                </Card>

                {/* 成员项目与分摊 */}
                <Card>
                  <CardHeader
                    en="Composition & Allocation"
                    cn="组成项目与分摊（比例合计须 100%）"
                    right={<span className="text-[11px] text-slate-500">{detail.allocations.length} 个项目</span>}
                  />
                  <div className="flex flex-wrap items-end gap-3 border-b border-slate-800 px-5 py-4">
                    <div className="w-64">
                      <Field label="加入项目 Add Project">
                        <Select value={addProjectId} onChange={(e) => setAddProjectId(e.target.value)}>
                          <option value="">选择项目…</option>
                          {availableProjects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nameEn} · {p.nameCn}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <div className="w-40">
                      <Field label="生效起">
                        <DateInput value={addFrom} onChange={setAddFrom} />
                      </Field>
                    </div>
                    <Button disabled={!addProjectId || adding} onClick={handleAddProject}>
                      {adding ? '加入中…' : '+ 加入'}
                    </Button>
                    <span className="ml-auto pb-2 text-[11px] text-slate-500">
                      新增项目默认在全部引用产品间均摊
                    </span>
                  </div>

                  {actionError && <div className="px-5 pt-3 text-xs text-rose-400">{actionError}</div>}

                  {detail.allocations.length === 0 ? (
                    <Empty text="该产品尚未关联任何项目" />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[900px] text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                            <th className="border-b border-slate-800 px-5 py-2.5 font-medium">项目 Project</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">分摊比例</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 font-medium">生效起</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">项目原始 收 / 支</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">本产品分摊后 收 / 支</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.allocations.map((a) => {
                            const c = compByProject.get(a.projectId);
                            const sumOk = Math.abs(a.projectRatioSum - 1) < 0.000001;
                            return (
                              <tr key={a.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                                <td className="px-5 py-3">
                                  <div className="leading-tight">
                                    <div className="text-slate-200">{a.project?.nameEn ?? `#${a.projectId}`}</div>
                                    <div className="text-[11px] text-slate-500">{a.project?.nameCn}</div>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <span className="tabular-nums text-slate-200">{fmtPct(a.ratio)}</span>
                                  {!sumOk && (
                                    <div className="text-[10px] text-rose-400">项目合计 {fmtPct(a.projectRatioSum)}</div>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-[11px] text-slate-400">{formatDate(a.effectiveFrom)}</td>
                                <td className="px-4 py-3 text-right text-[11px] tabular-nums text-slate-400">
                                  ¥{formatCny(c?.rawRevenueCny)} / ¥{formatCny(c?.rawCostCny)}
                                </td>
                                <td className="px-4 py-3 text-right text-[11px] tabular-nums">
                                  <span className="text-emerald-400">¥{formatCny(c?.allocRevenueCny)}</span>
                                  <span className="text-slate-600"> / </span>
                                  <span className="text-rose-400">¥{formatCny(c?.allocCostCny)}</span>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        a.project &&
                                        setEditorProject({ id: a.projectId, nameCn: a.project.nameCn, nameEn: a.project.nameEn })
                                      }
                                    >
                                      调整比例
                                    </Button>
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      onClick={() => handleRemoveProject(a.projectId, a.project?.nameCn ?? '')}
                                    >
                                      移出
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>

                {/* 分摊历史 */}
                <Card>
                  <CardHeader en="Allocation History" cn="分摊历史版本（可审计）" />
                  {detail.history.length === 0 ? (
                    <Empty text="暂无历史记录" />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                            <th className="border-b border-slate-800 px-5 py-2.5 font-medium">项目</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">比例</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 font-medium">生效起</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 font-medium">生效止</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.history.map((h) => (
                            <tr key={h.id} className="border-b border-slate-800/60">
                              <td className="px-5 py-2.5 text-[11px] text-slate-400">
                                {allProjects.find((p) => p.id === h.projectId)?.nameCn ?? `#${h.projectId}`}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">{fmtPct(h.ratio)}</td>
                              <td className="px-4 py-2.5 text-[11px] text-slate-400">{formatDate(h.effectiveFrom)}</td>
                              <td className="px-4 py-2.5 text-[11px] text-slate-400">
                                {h.effectiveTo ? formatDate(h.effectiveTo) : <span className="text-emerald-400">至今</span>}
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
        </div>
      </div>

      <Modal
        open={formOpen}
        title={editing ? '编辑产品 / Edit Product' : '新增产品 / New Product'}
        onClose={() => setFormOpen(false)}
      >
        {formOpen && (
          <ProductForm
            initial={editing ?? undefined}
            saving={creating || updating}
            error={formError}
            submitLabel={editing ? '保存' : '创建'}
            onSubmit={submitForm}
            onCancel={() => setFormOpen(false)}
          />
        )}
      </Modal>

      {editorProject && <AllocationEditor project={editorProject} onClose={() => setEditorProject(null)} />}
    </div>
  );
}
