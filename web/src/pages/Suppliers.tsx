import { useEffect, useMemo, useState } from 'react';
import {
  extractErrorMessage,
  useCreateSupplierMutation,
  useDeleteSupplierMutation,
  useGetCategoriesQuery,
  useGetSuppliersQuery,
  useUpdateSupplierMutation,
  type Supplier,
  type SupplierInput,
  type SupplierKind,
  type SupplierRegion,
} from '../api';
import { Card, Empty, PageHeader } from '../components/Card';
import { Button, Field, Input, Select } from '../components/Field';
import { Modal } from '../components/Modal';
import { SupplierForm } from '../components/SupplierForm';
import { buildCategoryGroups } from '../lib/categories';
import { SUPPLIER_KIND_LABEL, SUPPLIER_REGION_LABEL, domainLabel } from '../lib/domains';

export default function Suppliers() {
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [kind, setKind] = useState<'' | SupplierKind>('');
  const [region, setRegion] = useState<'' | SupplierRegion>('');
  const [showDisabled, setShowDisabled] = useState(false);

  const { data: categories = [] } = useGetCategoriesQuery({});
  const { data, isLoading } = useGetSuppliersQuery({
    ...(debounced ? { q: debounced } : {}),
    ...(categoryId ? { categoryId: Number(categoryId) } : {}),
    ...(kind ? { kind } : {}),
    ...(region ? { region } : {}),
    ...(showDisabled ? { all: true } : {}),
  });
  const [createOne, { isLoading: creating }] = useCreateSupplierMutation();
  const [updateOne, { isLoading: updating }] = useUpdateSupplierMutation();
  const [deleteOne] = useDeleteSupplierMutation();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = data?.items ?? [];

  useEffect(() => {
    const t = setTimeout(() => setDebounced(keyword.trim()), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  const categoryName = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of categories) m.set(c.id, c.nameCn);
    return m;
  }, [categories]);

  const categoryOptions = useMemo(() => {
    const groups = buildCategoryGroups(categories);
    return groups.flatMap((g) => {
      const parentLabel = domainLabel(g.parent.domain, g.parent.type);
      return [
        { id: g.parent.id, text: `${parentLabel.cn} · ${g.parent.nameCn}` },
        ...g.children.map((c) => ({ id: c.id, text: `　${g.parent.nameCn} / ${c.nameCn}` })),
      ];
    });
  }, [categories]);

  function openCreate() {
    setEditing(null);
    setError(null);
    setOpen(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setError(null);
    setOpen(true);
  }

  async function submit(body: SupplierInput) {
    setError(null);
    try {
      if (editing) {
        await updateOne({ id: editing.id, body }).unwrap();
      } else {
        await createOne(body).unwrap();
      }
      setOpen(false);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  async function remove(s: Supplier) {
    if (!window.confirm(`确认停用供应商「${s.nameCn}」？历史流水中的对手方名称不受影响。`)) return;
    try {
      await deleteOne(s.id).unwrap();
    } catch (e) {
      window.alert(extractErrorMessage(e));
    }
  }

  async function restore(s: Supplier) {
    try {
      await updateOne({ id: s.id, body: { status: 1 } }).unwrap();
    } catch (e) {
      window.alert(extractErrorMessage(e));
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 md:px-12">
        <PageHeader en="Suppliers" cn="供应商 · 交易对手名录（按科目归类 / 可多选）">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={showDisabled}
                onChange={(e) => setShowDisabled(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800"
              />
              显示已停用
            </label>
            <Button onClick={openCreate}>+ 新增供应商</Button>
          </div>
        </PageHeader>

        <Card>
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-800 px-5 py-4">
            <div className="w-56">
              <Field label="Search">
                <Input
                  placeholder="名称 / 联系人 / 备注"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </Field>
            </div>
            <div className="w-56">
              <Field label="Category">
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">全部科目</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.text}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-36">
              <Field label="Role">
                <Select value={kind} onChange={(e) => setKind(e.target.value as '' | SupplierKind)}>
                  <option value="">全部</option>
                  <option value="vendor">供应商</option>
                  <option value="customer">客户</option>
                  <option value="both">供应商/客户</option>
                </Select>
              </Field>
            </div>
            <div className="w-32">
              <Field label="Region">
                <Select value={region} onChange={(e) => setRegion(e.target.value as '' | SupplierRegion)}>
                  <option value="">全部</option>
                  <option value="cn">国内</option>
                  <option value="global">海外</option>
                </Select>
              </Field>
            </div>
            <span className="ml-auto pb-2 text-[11px] text-slate-600">共 {items.length} 个</span>
          </div>

          {isLoading ? (
            <Empty text="加载中…" />
          ) : items.length === 0 ? (
            <Empty text="暂无供应商数据" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="border-b border-slate-800 px-5 py-2.5 font-medium">供应商 Supplier</th>
                    <th className="border-b border-slate-800 px-4 py-2.5 font-medium">角色 / 地域</th>
                    <th className="border-b border-slate-800 px-4 py-2.5 font-medium">关联科目</th>
                    <th className="border-b border-slate-800 px-4 py-2.5 font-medium">官网 / 联系人</th>
                    <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => {
                    const kindLabel = SUPPLIER_KIND_LABEL[s.kind] ?? { cn: s.kind, en: s.kind };
                    const regionLabel = SUPPLIER_REGION_LABEL[s.region] ?? { cn: s.region, en: s.region };
                    const inactive = s.status === 0;
                    return (
                      <tr
                        key={s.id}
                        className={`border-b border-slate-800/60 hover:bg-slate-800/30 ${inactive ? 'opacity-50' : ''}`}
                      >
                        <td className="px-5 py-3">
                          <div className="leading-tight">
                            <div className="text-slate-200">
                              {s.nameCn}
                              {inactive && <span className="ml-2 text-[10px] text-slate-500">已停用</span>}
                            </div>
                            <div className="text-[11px] text-slate-500">{s.nameEn}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                              {kindLabel.cn}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] ${
                                s.region === 'cn'
                                  ? 'bg-sky-500/10 text-sky-400'
                                  : 'bg-violet-500/10 text-violet-400'
                              }`}
                            >
                              {regionLabel.cn}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex max-w-[320px] flex-wrap gap-1">
                            {s.categoryIds.length === 0 ? (
                              <span className="text-[11px] text-slate-600">—</span>
                            ) : (
                              s.categoryIds.map((id) => (
                                <span
                                  key={id}
                                  className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"
                                >
                                  {categoryName.get(id) ?? `#${id}`}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="leading-tight">
                            {s.website ? (
                              <a
                                href={s.website}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-emerald-400 hover:underline"
                              >
                                {s.website.replace(/^https?:\/\//, '')}
                              </a>
                            ) : (
                              <div className="text-[11px] text-slate-600">—</div>
                            )}
                            {s.contact && <div className="text-[11px] text-slate-500">{s.contact}</div>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                              编辑
                            </Button>
                            {inactive ? (
                              <Button variant="subtle" size="sm" onClick={() => restore(s)}>
                                启用
                              </Button>
                            ) : (
                              <Button variant="danger" size="sm" onClick={() => remove(s)}>
                                停用
                              </Button>
                            )}
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
      </div>

      <Modal
        open={open}
        title={editing ? '编辑供应商 / Edit Supplier' : '新增供应商 / New Supplier'}
        onClose={() => setOpen(false)}
      >
        {open && (
          <SupplierForm
            formId="supplier-form"
            categories={categories}
            initial={editing ?? undefined}
            saving={creating || updating}
            error={error}
            submitLabel={editing ? '保存' : '创建'}
            onSubmit={submit}
            onCancel={() => setOpen(false)}
          />
        )}
      </Modal>
    </div>
  );
}
