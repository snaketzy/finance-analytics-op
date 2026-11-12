import { useEffect, useMemo, useState } from 'react';
import {
  extractErrorMessage,
  useCreateSupplierMutation,
  useGetSuppliersQuery,
  type Category,
  type Supplier,
  type SupplierInput,
} from '../api';
import { Button, Field, Input, Select } from './Field';
import { Modal } from './Modal';
import { SupplierForm } from './SupplierForm';
import { buildCategoryGroups } from '../lib/categories';
import { SUPPLIER_KIND_LABEL, SUPPLIER_REGION_LABEL, domainLabel } from '../lib/domains';

type RoleFilter = '' | 'vendor' | 'customer';

/**
 * 供应商选择弹窗：按当前科目预筛 + 关键词模糊搜索，支持弹窗内快速新增。
 * 选中后通过 onPick 回填「交易对手 / 供应商」。
 */
export function SupplierPicker({
  open,
  onClose,
  categories,
  defaultCategoryId,
  role,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  defaultCategoryId?: number;
  role?: 'vendor' | 'customer';
  onPick: (supplier: Supplier) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [createSupplier, { isLoading: creating }] = useCreateSupplierMutation();

  // 打开时以当前流水科目 / 方向作为默认筛选。
  useEffect(() => {
    if (!open) return;
    setKeyword('');
    setDebounced('');
    setCategoryId(defaultCategoryId ? String(defaultCategoryId) : '');
    setRoleFilter(role ?? '');
    setAdding(false);
    setAddError(null);
  }, [open, defaultCategoryId, role]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(keyword.trim()), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  const { data, isFetching } = useGetSuppliersQuery(
    {
      ...(debounced ? { q: debounced } : {}),
      ...(categoryId ? { categoryId: Number(categoryId) } : {}),
      ...(roleFilter ? { role: roleFilter } : {}),
      limit: 300,
    },
    { skip: !open }
  );
  const items = data?.items ?? [];

  // 科目 id -> 展示名，用于在列表中标注供应商所属科目。
  const categoryName = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of categories) m.set(c.id, c.nameCn);
    return m;
  }, [categories]);

  const groups = useMemo(() => buildCategoryGroups(categories), [categories]);
  const categoryOptions = useMemo(
    () =>
      groups.flatMap((g) => {
        const parentLabel = domainLabel(g.parent.domain, g.parent.type);
        return [
          { id: g.parent.id, text: `${parentLabel.cn} · ${g.parent.nameCn}` },
          ...g.children.map((c) => ({ id: c.id, text: `　${g.parent.nameCn} / ${c.nameCn}` })),
        ];
      }),
    [groups]
  );

  function pick(s: Supplier) {
    onPick(s);
    onClose();
  }

  async function quickAdd(body: SupplierInput) {
    setAddError(null);
    try {
      const created = await createSupplier(body).unwrap();
      setAdding(false);
      pick(created);
    } catch (e) {
      setAddError(extractErrorMessage(e));
    }
  }

  return (
    <Modal
      open={open}
      title="Suppliers · 选择供应商 / 交易对手"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <Button variant="ghost" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="space-y-3">
        {!adding ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <Field label="Search">
                <Input
                  autoFocus
                  placeholder="模糊搜索名称 / 联系人 / 备注"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </Field>
            </div>
            <div className="w-48">
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
                <Select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
                >
                  <option value="">全部</option>
                  <option value="vendor">供应商</option>
                  <option value="customer">客户</option>
                </Select>
              </Field>
            </div>
            <Button variant="subtle" onClick={() => setAdding(true)}>
              + 快速新增
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">快速新增供应商</span>
              <button
                className="text-[11px] text-slate-400 hover:text-slate-200"
                onClick={() => {
                  setAdding(false);
                  setAddError(null);
                }}
              >
                返回列表
              </button>
            </div>
            <SupplierForm
              formId="supplier-quick-form"
              categories={categories}
              defaultCategoryId={categoryId ? Number(categoryId) : defaultCategoryId}
              saving={creating}
              error={addError}
              submitLabel="创建并选用"
              onSubmit={quickAdd}
              onCancel={() => {
                setAdding(false);
                setAddError(null);
              }}
            />
          </div>
        )}

        {!adding && (
          <div className="max-h-[46vh] overflow-y-auto rounded-md border border-slate-800">
            {isFetching && items.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-600">加载中…</div>
            ) : items.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-600">
                未找到匹配的供应商，可点击「快速新增」补充
              </div>
            ) : (
              <ul className="divide-y divide-slate-800/70">
                {items.map((s) => {
                  const kind = SUPPLIER_KIND_LABEL[s.kind] ?? { cn: s.kind, en: s.kind };
                  const region = SUPPLIER_REGION_LABEL[s.region] ?? { cn: s.region, en: s.region };
                  const cats = s.categoryIds
                    .map((id) => categoryName.get(id))
                    .filter(Boolean)
                    .slice(0, 4);
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => pick(s)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-slate-800/50"
                      >
                        <div className="min-w-0 leading-tight">
                          <div className="truncate text-sm text-slate-100">{s.nameCn}</div>
                          <div className="truncate text-[11px] text-slate-500">{s.nameEn}</div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          {cats.map((c) => (
                            <span
                              key={c}
                              className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"
                            >
                              {c}
                            </span>
                          ))}
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] ${
                              s.region === 'cn'
                                ? 'bg-sky-500/10 text-sky-400'
                                : 'bg-violet-500/10 text-violet-400'
                            }`}
                          >
                            {region.cn}
                          </span>
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                            {kind.cn}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
