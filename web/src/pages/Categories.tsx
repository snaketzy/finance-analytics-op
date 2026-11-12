import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  extractErrorMessage,
  useCreateCategoryMutation,
  useDeleteCategoryMutation,
  useGetCategoriesQuery,
  useUpdateCategoryMutation,
  type Category,
  type CategoryInput,
  type CategoryType,
} from '../api';
import { Empty, PageHeader } from '../components/Card';
import { Button, Field, Input, Select } from '../components/Field';
import { Modal } from '../components/Modal';
import { buildCategoryGroups } from '../lib/categories';
import { EXPENSE_DOMAINS, INCOME_DOMAINS, domainLabel } from '../lib/domains';

function domainOptions(type: CategoryType) {
  const map = type === 'income' ? INCOME_DOMAINS : EXPENSE_DOMAINS;
  return Object.entries(map).map(([key, label]) => ({ key, ...label }));
}

type FormState = {
  editing: Category | null;
  type: CategoryType;
  parentId: string;
  domain: string;
  nameCn: string;
  nameEn: string;
  isRecurring: boolean;
  isCogs: boolean;
  sortOrder: string;
};

function emptyForm(type: CategoryType = 'expense'): FormState {
  return {
    editing: null,
    type,
    parentId: '',
    domain: domainOptions(type)[0]?.key ?? '',
    nameCn: '',
    nameEn: '',
    isRecurring: false,
    isCogs: false,
    sortOrder: '',
  };
}

function DomainSection({
  type,
  list,
  accent,
  onEdit,
  onDelete,
  onAddChild,
}: {
  type: CategoryType;
  list: Category[];
  accent: string;
  onEdit: (c: Category) => void;
  onDelete: (c: Category) => void;
  onAddChild: (parent: Category) => void;
}) {
  const groups = useMemo(() => buildCategoryGroups(list), [list]);
  if (groups.length === 0) return <Empty text="暂无科目" />;
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const label = domainLabel(g.parent.domain, type);
        const items = g.children.length ? g.children : [g.parent];
        const isLeafParent = g.children.length === 0;
        return (
          <div key={g.parent.id} className="rounded-lg border border-slate-800 bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
              <div className="leading-tight">
                <div className={`text-sm font-semibold ${accent}`}>{label.en}</div>
                <div className="text-[11px] text-slate-500">{label.cn}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-slate-600">{items.length} 个科目</span>
                <Button variant="subtle" size="sm" onClick={() => onAddChild(g.parent)}>
                  + 子科目
                </Button>
                {!isLeafParent && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => onEdit(g.parent)}>
                      编辑领域
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => onDelete(g.parent)}>
                      停用
                    </Button>
                  </>
                )}
              </div>
            </div>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 p-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((c) => (
                <li
                  key={c.id}
                  className="group flex items-baseline justify-between gap-3 rounded px-2 py-1 hover:bg-slate-800/50"
                >
                  <span className="truncate text-xs text-slate-200">{c.nameCn}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    {c.isCogs ? (
                      <span className="rounded bg-slate-800 px-1 text-[10px] text-amber-400" title="计入 COGS">
                        COGS
                      </span>
                    ) : null}
                    {c.isRecurring ? (
                      <span className="rounded bg-slate-800 px-1 text-[10px] text-sky-400" title="周期成本">
                        周期
                      </span>
                    ) : null}
                    <span className="hidden truncate text-[11px] text-slate-500 sm:inline">{c.nameEn}</span>
                    <span className="hidden gap-1 group-hover:flex">
                      <button
                        onClick={() => onEdit(c)}
                        className="rounded px-1 text-[11px] text-slate-400 transition hover:bg-slate-700 hover:text-slate-200"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => onDelete(c)}
                        className="rounded px-1 text-[11px] text-rose-400 transition hover:bg-rose-500/10"
                      >
                        停用
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default function Categories() {
  const { data: categories = [], isLoading } = useGetCategoriesQuery({});
  const [createOne, { isLoading: creating }] = useCreateCategoryMutation();
  const [updateOne, { isLoading: updating }] = useUpdateCategoryMutation();
  const [deleteOne] = useDeleteCategoryMutation();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const income = categories.filter((c) => c.type === 'income');
  const expense = categories.filter((c) => c.type === 'expense');

  const parents = useMemo(
    () => categories.filter((c) => c.parentId === null && c.type === form.type),
    [categories, form.type]
  );

  const domainEditable = form.parentId === '';

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  function openCreate() {
    setForm(emptyForm('expense'));
    setOpen(true);
  }

  function openCreateChild(parent: Category) {
    setForm({
      ...emptyForm(parent.type),
      parentId: String(parent.id),
      domain: parent.domain,
    });
    setOpen(true);
  }

  function openEdit(c: Category) {
    setForm({
      editing: c,
      type: c.type,
      parentId: c.parentId === null ? '' : String(c.parentId),
      domain: c.domain,
      nameCn: c.nameCn,
      nameEn: c.nameEn,
      isRecurring: Boolean(c.isRecurring),
      isCogs: Boolean(c.isCogs),
      sortOrder: String(c.sortOrder ?? ''),
    });
    setOpen(true);
  }

  function changeType(next: CategoryType) {
    setForm({ ...form, type: next, parentId: '', domain: domainOptions(next)[0]?.key ?? '' });
  }

  function changeParent(next: string) {
    if (next === '') {
      setForm({ ...form, parentId: '', domain: domainOptions(form.type)[0]?.key ?? '' });
      return;
    }
    const p = parents.find((x) => String(x.id) === next);
    setForm({ ...form, parentId: next, domain: p?.domain ?? form.domain });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const nameCn = form.nameCn.trim();
    const nameEn = form.nameEn.trim();
    if (!nameCn || !nameEn) {
      setError('请填写中英文科目名');
      return;
    }
    const sortOrder = form.sortOrder === '' ? undefined : Number(form.sortOrder);

    try {
      if (form.editing) {
        const body: Partial<CategoryInput> = {
          nameCn,
          nameEn,
          isRecurring: form.isRecurring,
          isCogs: form.isCogs,
          ...(sortOrder !== undefined ? { sortOrder } : {}),
          ...(form.parentId === '' ? { domain: form.domain } : {}),
        };
        await updateOne({ id: form.editing.id, body }).unwrap();
      } else {
        const body: CategoryInput = {
          nameCn,
          nameEn,
          type: form.type,
          isRecurring: form.isRecurring,
          isCogs: form.isCogs,
          ...(sortOrder !== undefined ? { sortOrder } : {}),
          ...(form.parentId === '' ? { domain: form.domain } : { parentId: Number(form.parentId) }),
        };
        await createOne(body).unwrap();
      }
      setOpen(false);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function remove(c: Category) {
    const okDel = window.confirm(
      `确认停用科目「${c.nameCn}」？${c.parentId === null ? '其下子科目将一并停用。' : ''}`
    );
    if (!okDel) return;
    try {
      await deleteOne(c.id).unwrap();
    } catch (err) {
      window.alert(extractErrorMessage(err));
    }
  }

  const saving = creating || updating;

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 md:px-12">
        <PageHeader en="Categories" cn="科目 · 按收支分区 / 按领域分组的科目树">
          <Button onClick={openCreate}>+ 新增科目</Button>
        </PageHeader>

        {isLoading ? (
          <div className="text-xs text-slate-500">加载中…</div>
        ) : (
          <div className="space-y-8">
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <div className="leading-tight">
                  <div className="text-base font-semibold text-emerald-400">Income</div>
                  <div className="text-[11px] text-slate-500">收入科目</div>
                </div>
                <span className="text-xs text-slate-600">{income.length} 个科目</span>
              </div>
              <DomainSection
                type="income"
                list={income}
                accent="text-emerald-400"
                onEdit={openEdit}
                onDelete={remove}
                onAddChild={openCreateChild}
              />
            </section>

            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <div className="leading-tight">
                  <div className="text-base font-semibold text-rose-400">Expense</div>
                  <div className="text-[11px] text-slate-500">支出科目</div>
                </div>
                <span className="text-xs text-slate-600">{expense.length} 个科目</span>
              </div>
              <DomainSection
                type="expense"
                list={expense}
                accent="text-rose-400"
                onEdit={openEdit}
                onDelete={remove}
                onAddChild={openCreateChild}
              />
            </section>
          </div>
        )}
      </div>

      <Modal
        open={open}
        title={form.editing ? '编辑科目 / Edit Category' : '新增科目 / New Category'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="category-form" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        <form id="category-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="收支类型 Type">
            <Select
              value={form.type}
              disabled={!!form.editing}
              onChange={(e) => changeType(e.target.value as CategoryType)}
            >
              <option value="income">收入 Income</option>
              <option value="expense">支出 Expense</option>
            </Select>
          </Field>
          <Field label="上级科目 Parent" hint="留空=顶层领域">
            <Select
              value={form.parentId}
              disabled={!!form.editing}
              onChange={(e) => changeParent(e.target.value)}
            >
              <option value="">（无 · 领域父节点）</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameCn} {p.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="领域 Domain" hint={domainEditable ? undefined : '跟随上级'}>
            <Select
              value={form.domain}
              disabled={!domainEditable}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
            >
              {domainEditable ? (
                domainOptions(form.type).map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.cn} {d.en}
                  </option>
                ))
              ) : (
                <option value={form.domain}>
                  {domainLabel(form.domain, form.type).cn} {domainLabel(form.domain, form.type).en}
                </option>
              )}
            </Select>
          </Field>
          <Field label="排序 Sort" hint="留空=自动追加">
            <Input
              type="number"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              placeholder="自动"
            />
          </Field>
          <Field label="中文名 Name (CN)">
            <Input value={form.nameCn} onChange={(e) => setForm({ ...form, nameCn: e.target.value })} />
          </Field>
          <Field label="英文名 Name (EN)">
            <Input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={form.isRecurring}
              onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })}
              className="h-4 w-4 rounded border-slate-600 bg-slate-800"
            />
            周期成本科目
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={form.isCogs}
              onChange={(e) => setForm({ ...form, isCogs: e.target.checked })}
              className="h-4 w-4 rounded border-slate-600 bg-slate-800"
            />
            计入 COGS
          </label>
          {error && <div className="sm:col-span-2 text-xs text-rose-400">{error}</div>}
        </form>
      </Modal>
    </div>
  );
}
