import { useEffect, useState, type FormEvent } from 'react';
import {
  extractErrorMessage,
  useCreateAccountMutation,
  useDeleteAccountMutation,
  useGetAccountsQuery,
  useUpdateAccountMutation,
  type Account,
  type AccountInput,
} from '../api';
import { Card, Empty, PageHeader } from '../components/Card';
import { Button, Field, Input, Select } from '../components/Field';
import { Modal } from '../components/Modal';
import { ACCOUNT_TYPE_LABEL } from '../lib/domains';
import { formatCny } from '../lib/format';

const TYPE_OPTIONS = ['cash', 'bank', 'platform', 'credit', 'virtual'];

type FormState = {
  editing: Account | null;
  nameCn: string;
  nameEn: string;
  type: string;
  currency: string;
  openingBalanceCny: string;
  sortOrder: string;
};

function emptyForm(): FormState {
  return {
    editing: null,
    nameCn: '',
    nameEn: '',
    type: 'cash',
    currency: 'CNY',
    openingBalanceCny: '0',
    sortOrder: '',
  };
}

export default function Accounts() {
  const [showAll, setShowAll] = useState(false);
  const { data: accounts = [], isLoading } = useGetAccountsQuery(showAll ? { all: true } : undefined);
  const [createOne, { isLoading: creating }] = useCreateAccountMutation();
  const [updateOne, { isLoading: updating }] = useUpdateAccountMutation();
  const [deleteOne] = useDeleteAccountMutation();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  function openCreate() {
    setForm(emptyForm());
    setOpen(true);
  }

  function openEdit(a: Account) {
    setForm({
      editing: a,
      nameCn: a.nameCn,
      nameEn: a.nameEn,
      type: a.type,
      currency: a.currency,
      openingBalanceCny: String(a.openingBalanceCny ?? 0),
      sortOrder: String(a.sortOrder ?? ''),
    });
    setOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const nameCn = form.nameCn.trim();
    const nameEn = form.nameEn.trim();
    if (!nameCn || !nameEn) {
      setError('请填写账户中英文名称');
      return;
    }
    const sortOrder = form.sortOrder === '' ? undefined : Number(form.sortOrder);
    const body: AccountInput = {
      nameCn,
      nameEn,
      type: form.type,
      currency: form.currency.trim().toUpperCase(),
      openingBalanceCny: Number(form.openingBalanceCny) || 0,
      ...(sortOrder !== undefined ? { sortOrder } : {}),
    };
    try {
      if (form.editing) {
        await updateOne({ id: form.editing.id, body }).unwrap();
      } else {
        await createOne(body).unwrap();
      }
      setOpen(false);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function remove(a: Account) {
    if (!window.confirm(`确认停用账户「${a.nameCn}」？已产生的流水与分析不受影响。`)) return;
    try {
      await deleteOne(a.id).unwrap();
    } catch (err) {
      window.alert(extractErrorMessage(err));
    }
  }

  async function restore(a: Account) {
    try {
      await updateOne({ id: a.id, body: { status: 1 } }).unwrap();
    } catch (err) {
      window.alert(extractErrorMessage(err));
    }
  }

  const saving = creating || updating;

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 md:px-12">
        <PageHeader en="Accounts" cn="账户 · 资金账户与期初余额">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800"
              />
              显示已停用
            </label>
            <Button onClick={openCreate}>+ 新增账户</Button>
          </div>
        </PageHeader>

        <Card>
          {isLoading ? (
            <Empty text="加载中…" />
          ) : accounts.length === 0 ? (
            <Empty text="暂无账户数据" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="border-b border-slate-800 px-4 py-2.5 font-medium">账户 Account</th>
                    <th className="border-b border-slate-800 px-4 py-2.5 font-medium">类型 Type</th>
                    <th className="border-b border-slate-800 px-4 py-2.5 font-medium">币种 Ccy</th>
                    <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">
                      期初余额 Opening (¥)
                    </th>
                    <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => {
                    const typeLabel = ACCOUNT_TYPE_LABEL[a.type] ?? { cn: a.type, en: a.type };
                    const inactive = a.status === 0;
                    return (
                      <tr
                        key={a.id}
                        className={`border-b border-slate-800/60 hover:bg-slate-800/30 ${inactive ? 'opacity-50' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <div className="leading-tight">
                            <div className="text-slate-200">
                              {a.nameCn}
                              {inactive && <span className="ml-2 text-[10px] text-slate-500">已停用</span>}
                            </div>
                            <div className="text-[11px] text-slate-500">{a.nameEn}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="leading-tight">
                            <div className="text-slate-300">{typeLabel.cn}</div>
                            <div className="text-[11px] text-slate-500">{typeLabel.en}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-400">{a.currency}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-400">
                          ¥ {formatCny(a.openingBalanceCny)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>
                              编辑
                            </Button>
                            {inactive ? (
                              <Button variant="subtle" size="sm" onClick={() => restore(a)}>
                                启用
                              </Button>
                            ) : (
                              <Button variant="danger" size="sm" onClick={() => remove(a)}>
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
        title={form.editing ? '编辑账户 / Edit Account' : '新增账户 / New Account'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="account-form" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        <form id="account-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="中文名 Name (CN)">
            <Input value={form.nameCn} onChange={(e) => setForm({ ...form, nameCn: e.target.value })} />
          </Field>
          <Field label="英文名 Name (EN)">
            <Input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
          </Field>
          <Field label="账户类型 Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPE_OPTIONS.map((t) => {
                const label = ACCOUNT_TYPE_LABEL[t];
                return (
                  <option key={t} value={t}>
                    {label.cn} {label.en}
                  </option>
                );
              })}
            </Select>
          </Field>
          <Field label="币种 Currency">
            <Input
              value={form.currency}
              maxLength={3}
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="期初余额 Opening (¥)">
            <Input
              type="number"
              step="0.01"
              value={form.openingBalanceCny}
              onChange={(e) => setForm({ ...form, openingBalanceCny: e.target.value })}
            />
          </Field>
          <Field label="排序 Sort" hint="留空=默认">
            <Input
              type="number"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              placeholder="默认"
            />
          </Field>
          {error && <div className="text-xs text-rose-400 sm:col-span-2">{error}</div>}
        </form>
      </Modal>
    </div>
  );
}
