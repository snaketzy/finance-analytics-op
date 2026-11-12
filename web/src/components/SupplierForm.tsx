import { useMemo, useState, type FormEvent } from 'react';
import type { Category, Supplier, SupplierInput, SupplierKind, SupplierRegion } from '../api';
import { Button, Field, Input, Select } from './Field';
import { buildCategoryGroups } from '../lib/categories';
import { SUPPLIER_KIND_LABEL, SUPPLIER_REGION_LABEL, domainLabel } from '../lib/domains';

const KINDS: SupplierKind[] = ['vendor', 'customer', 'both'];
const REGIONS: SupplierRegion[] = ['cn', 'global'];

type FormValues = {
  nameCn: string;
  nameEn: string;
  kind: SupplierKind;
  region: SupplierRegion;
  website: string;
  contact: string;
  note: string;
  sortOrder: string;
  categoryIds: number[];
};

function fromSupplier(initial?: Partial<Supplier>, defaultCategoryId?: number): FormValues {
  return {
    nameCn: initial?.nameCn ?? '',
    nameEn: initial?.nameEn ?? '',
    kind: initial?.kind ?? 'vendor',
    region: initial?.region ?? 'global',
    website: initial?.website ?? '',
    contact: initial?.contact ?? '',
    note: initial?.note ?? '',
    sortOrder: initial?.sortOrder != null ? String(initial.sortOrder) : '',
    categoryIds:
      initial?.categoryIds && initial.categoryIds.length
        ? [...initial.categoryIds]
        : defaultCategoryId
          ? [defaultCategoryId]
          : [],
  };
}

/**
 * 供应商表单（中英文名 / 角色 / 地域 / 联系 / 关联科目多选）。
 * 供「供应商」维护模块与流水弹窗内的快速新增共用。
 */
export function SupplierForm({
  formId,
  categories,
  initial,
  defaultCategoryId,
  saving,
  error,
  submitLabel = '保存',
  onSubmit,
  onCancel,
}: {
  formId: string;
  categories: Category[];
  initial?: Partial<Supplier>;
  defaultCategoryId?: number;
  saving?: boolean;
  error?: string | null;
  submitLabel?: string;
  onSubmit: (body: SupplierInput) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<FormValues>(() => fromSupplier(initial, defaultCategoryId));
  const [localError, setLocalError] = useState<string | null>(null);

  const groups = useMemo(() => buildCategoryGroups(categories), [categories]);

  function toggleCategory(id: number) {
    setForm((prev) => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(id)
        ? prev.categoryIds.filter((x) => x !== id)
        : [...prev.categoryIds, id],
    }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    const nameCn = form.nameCn.trim();
    const nameEn = form.nameEn.trim();
    if (!nameCn || !nameEn) {
      setLocalError('请填写供应商中英文名称');
      return;
    }
    const sortOrder = form.sortOrder === '' ? undefined : Number(form.sortOrder);
    const body: SupplierInput = {
      nameCn,
      nameEn,
      kind: form.kind,
      region: form.region,
      website: form.website.trim() || null,
      contact: form.contact.trim() || null,
      note: form.note.trim() || null,
      ...(sortOrder !== undefined ? { sortOrder } : {}),
      categoryIds: form.categoryIds,
    };
    onSubmit(body);
  }

  const shownError = localError ?? error;

  return (
    <form id={formId} onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="中文名 Name (CN)">
          <Input value={form.nameCn} onChange={(e) => setForm({ ...form, nameCn: e.target.value })} />
        </Field>
        <Field label="英文名 Name (EN)">
          <Input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
        </Field>
        <Field label="角色 Role">
          <Select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as SupplierKind })}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {SUPPLIER_KIND_LABEL[k].cn} {SUPPLIER_KIND_LABEL[k].en}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="地域 Region">
          <Select
            value={form.region}
            onChange={(e) => setForm({ ...form, region: e.target.value as SupplierRegion })}
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {SUPPLIER_REGION_LABEL[r].cn} {SUPPLIER_REGION_LABEL[r].en}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="官网 Website">
          <Input
            placeholder="https://"
            value={form.website}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
          />
        </Field>
        <Field label="联系人 Contact" hint="选填">
          <Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
        </Field>
        <Field label="备注 Note" hint="选填">
          <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        <Field label="排序 Sort" hint="留空=默认">
          <Input
            type="number"
            placeholder="默认"
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
          />
        </Field>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-slate-400">
          <span>关联科目 Categories</span>
          <span className="normal-case tracking-normal text-slate-600">
            已选 {form.categoryIds.length} 个 · 可多选
          </span>
        </div>
        <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-slate-700 bg-slate-800/40 p-2.5">
          {groups.length === 0 ? (
            <div className="py-3 text-center text-xs text-slate-600">暂无科目</div>
          ) : (
            groups.map((g) => {
              const label = domainLabel(g.parent.domain, g.parent.type);
              const chips = g.children.length ? [g.parent, ...g.children] : [g.parent];
              return (
                <div key={g.parent.id}>
                  <div className="mb-1 text-[11px] text-slate-500">
                    {label.cn} <span className="text-slate-600">{label.en}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {chips.map((c) => {
                      const active = form.categoryIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleCategory(c.id)}
                          className={`rounded px-2 py-0.5 text-[11px] transition ${
                            active
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                          }`}
                        >
                          {c.nameCn}
                          {c.parentId === null && g.children.length > 0 ? ' ·领域' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {shownError && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {shownError}
        </div>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            取消
          </Button>
        )}
        <Button type="submit" disabled={saving}>
          {saving ? '保存中…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
