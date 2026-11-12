import { useEffect, useState } from 'react';
import {
  extractErrorMessage,
  useCreateProjectMutation,
  useDeleteProjectMutation,
  useGetProjectDetailQuery,
  useGetProjectRefItemsQuery,
  useGetProjectsQuery,
  useSyncProjectRepoMutation,
  useUpdateProjectMutation,
  type Project,
  type ProjectInput,
  type ProjectRefItem,
  type ProjectRefKey,
  type ProjectReferenceCounts,
  type ProjectSnapshot,
  type ProjectStatus,
} from '../api';
import { Card, CardHeader, Empty, PageHeader } from '../components/Card';
import { Button, DateInput, Field, Input, Select } from '../components/Field';
import { Modal } from '../components/Modal';
import { formatCny, formatDate, formatInt } from '../lib/format';

/* ------------------------------------------------------------------ */
/* 元数据                                                              */
/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<ProjectStatus, { cn: string; en: string }> = {
  active: { cn: '在营', en: 'Active' },
  paused: { cn: '暂停', en: 'Paused' },
  archived: { cn: '归档', en: 'Archived' },
};

const REF_LABEL: { key: keyof ProjectReferenceCounts; cn: string; en: string }[] = [
  { key: 'transactions', cn: '台账流水', en: 'Ledger' },
  { key: 'budgets', cn: '预算', en: 'Budgets' },
  { key: 'usages', cn: '用量记录', en: 'Usage Records' },
  { key: 'cloudflareImports', cn: 'Cloudflare 账单', en: 'Cloudflare Imports' },
  { key: 'paymentImports', cn: '支付导入', en: 'Payment Imports' },
  { key: 'products', cn: '产品分摊', en: 'Product Allocation' },
];

const toPct = (ratio: number) => Math.round(ratio * 10000) / 100;
const fmtPct = (ratio: number) => `${toPct(ratio).toFixed(2)}%`;
/** 估算工时（保留整数，千分位）。 */
const fmtHours = (v: number | null | undefined) => formatInt(Math.round(Number(v ?? 0)));

/* ------------------------------------------------------------------ */
/* 引用明细列配置                                                       */
/* ------------------------------------------------------------------ */

type RefCol = {
  key: string;
  en: string;
  cn: string;
  align?: 'right';
  kind?: 'money' | 'num' | 'int' | 'date' | 'pct' | 'direction';
};

const REF_DETAIL: Record<ProjectRefKey, { en: string; cn: string; cols: RefCol[] }> = {
  transactions: {
    en: 'Ledger Transactions',
    cn: '台账流水明细',
    cols: [
      { key: 'txnDate', en: 'Date', cn: '日期', kind: 'date' },
      { key: 'direction', en: 'Direction', cn: '方向', kind: 'direction' },
      { key: 'categoryNameCn', en: 'Category', cn: '科目' },
      { key: 'amountCny', en: 'Amount', cn: '金额（CNY）', align: 'right', kind: 'money' },
      { key: 'counterparty', en: 'Counterparty', cn: '交易对手' },
      { key: 'note', en: 'Note', cn: '备注' },
    ],
  },
  budgets: {
    en: 'Budgets',
    cn: '预算明细',
    cols: [
      { key: 'period', en: 'Period', cn: '期间' },
      { key: 'periodType', en: 'Type', cn: '类型' },
      { key: 'categoryNameCn', en: 'Category', cn: '科目' },
      { key: 'amountCny', en: 'Budget', cn: '预算（CNY）', align: 'right', kind: 'money' },
    ],
  },
  usages: {
    en: 'Usage Records',
    cn: '用量记录明细',
    cols: [
      { key: 'period', en: 'Period', cn: '计费期' },
      { key: 'recurringNameCn', en: 'Template', cn: '周期成本项' },
      { key: 'quantity', en: 'Quantity', cn: '用量', align: 'right', kind: 'int' },
      { key: 'unitLabel', en: 'Unit', cn: '单位' },
      { key: 'amountSrc', en: 'Amount (Src)', cn: '原币金额', align: 'right', kind: 'num' },
      { key: 'amountCny', en: 'Amount', cn: '金额（CNY）', align: 'right', kind: 'money' },
      { key: 'billedOn', en: 'Billed On', cn: '计费日', kind: 'date' },
      { key: 'source', en: 'Source', cn: '来源' },
    ],
  },
  cloudflareImports: {
    en: 'Cloudflare Imports',
    cn: 'Cloudflare 账单明细',
    cols: [
      { key: 'billingPeriod', en: 'Period', cn: '账单期' },
      { key: 'sourceType', en: 'Type', cn: '类型' },
      { key: 'sourceName', en: 'Source', cn: '费用来源' },
      { key: 'invoiceNo', en: 'Invoice', cn: '发票号' },
      { key: 'txnDate', en: 'Date', cn: '入账日期', kind: 'date' },
      { key: 'currency', en: 'Ccy', cn: '币种' },
      { key: 'amountSrc', en: 'Amount (Src)', cn: '原币金额', align: 'right', kind: 'num' },
      { key: 'amountCny', en: 'Amount', cn: '金额（CNY）', align: 'right', kind: 'money' },
    ],
  },
  paymentImports: {
    en: 'Payment Imports',
    cn: '支付渠道导入明细',
    cols: [
      { key: 'billingPeriod', en: 'Period', cn: '账单期' },
      { key: 'source', en: 'Source', cn: '渠道' },
      { key: 'reference', en: 'Reference', cn: '参考号' },
      { key: 'counterparty', en: 'Counterparty', cn: '交易对手' },
      { key: 'txnDate', en: 'Date', cn: '日期', kind: 'date' },
      { key: 'grossSrc', en: 'Gross (Src)', cn: '毛额', align: 'right', kind: 'num' },
      { key: 'feeSrc', en: 'Fee (Src)', cn: '手续费', align: 'right', kind: 'num' },
      { key: 'netCny', en: 'Net', cn: '净额（CNY）', align: 'right', kind: 'money' },
    ],
  },
  products: {
    en: 'Product Allocation',
    cn: '产品分摊明细',
    cols: [
      { key: 'nameEn', en: 'Product', cn: '产品' },
      { key: 'code', en: 'Code', cn: '编码' },
      { key: 'ratio', en: 'Ratio', cn: '分摊比例', align: 'right', kind: 'pct' },
      { key: 'effectiveFrom', en: 'Effective From', cn: '生效起', kind: 'date' },
    ],
  },
};

function renderCell(v: unknown, kind?: RefCol['kind']) {
  if (v === null || v === undefined || v === '') return <span className="text-slate-600">—</span>;
  switch (kind) {
    case 'money':
      return <span className="tabular-nums">¥{formatCny(Number(v))}</span>;
    case 'num':
      return (
        <span className="tabular-nums">
          {Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      );
    case 'int':
      return <span className="tabular-nums">{formatInt(Number(v))}</span>;
    case 'date':
      return formatDate(String(v));
    case 'pct':
      return <span className="tabular-nums">{fmtPct(Number(v))}</span>;
    case 'direction':
      return String(v) === 'income' ? (
        <span className="text-emerald-400">收入</span>
      ) : (
        <span className="text-rose-400">支出</span>
      );
    default:
      return String(v);
  }
}

/** 引用明细下钻弹窗（按引用类型动态列渲染）。 */
function RefDetailModal({
  projectId,
  refKey,
  onClose,
}: {
  projectId: number;
  refKey: ProjectRefKey;
  onClose: () => void;
}) {
  const { en, cn, cols } = REF_DETAIL[refKey];
  const { data, isLoading } = useGetProjectRefItemsQuery({ id: projectId, key: refKey });

  return (
    <Modal open title={`${en} / ${cn}`} onClose={onClose} width="max-w-5xl">
      {isLoading ? (
        <Empty text="加载中…" />
      ) : !data || data.items.length === 0 ? (
        <Empty text="暂无记录" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  {cols.map((c) => (
                    <th
                      key={c.key}
                      className={`border-b border-slate-800 px-3 py-2 font-medium ${
                        c.align === 'right' ? 'text-right' : ''
                      }`}
                    >
                      {c.en}
                      <span className="ml-1 normal-case text-slate-600">{c.cn}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((it: ProjectRefItem, i) => (
                  <tr key={i} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                    {cols.map((c) => (
                      <td
                        key={c.key}
                        className={`px-3 py-2 text-slate-300 ${c.align === 'right' ? 'text-right' : ''}`}
                      >
                        {renderCell(it[c.key], c.kind)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
            <span>共 {data.items.length} 条</span>
            {data.truncated && <span className="text-amber-400">仅显示前 300 条</span>}
          </div>
        </>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 项目信息表单                                                        */
/* ------------------------------------------------------------------ */

type FormState = {
  code: string;
  nameCn: string;
  nameEn: string;
  status: ProjectStatus;
  launchDate: string;
  sortOrder: string;
  repoUrl: string;
  hoursPerCommit: string;
  note: string;
};

function toForm(p?: Project): FormState {
  return {
    code: p?.code ?? '',
    nameCn: p?.nameCn ?? '',
    nameEn: p?.nameEn ?? '',
    status: (p?.status as ProjectStatus) ?? 'active',
    launchDate: p?.launchDate ? String(p.launchDate).slice(0, 10) : '',
    sortOrder: String(p?.sortOrder ?? 0),
    repoUrl: p?.repoUrl ?? '',
    hoursPerCommit: String(p?.hoursPerCommit ?? 4),
    note: p?.note ?? '',
  };
}

function ProjectForm({
  initial,
  saving,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Project;
  saving: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: (body: ProjectInput) => void;
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
          status: f.status,
          launchDate: f.launchDate || null,
          sortOrder: Number(f.sortOrder) || 0,
          repoUrl: f.repoUrl.trim() || null,
          hoursPerCommit: Number(f.hoursPerCommit) || 0,
          note: f.note.trim() || null,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code" hint="唯一标识">
          <Input value={f.code} onChange={(e) => set({ code: e.target.value })} placeholder="如 vidday" required />
        </Field>
        <Field label="Status 状态">
          <Select value={f.status} onChange={(e) => set({ status: e.target.value as ProjectStatus })}>
            {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s].en} · {STATUS_LABEL[s].cn}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="中文名称">
          <Input value={f.nameCn} onChange={(e) => set({ nameCn: e.target.value })} placeholder="如 Vidday 流媒体" required />
        </Field>
        <Field label="English Name">
          <Input value={f.nameEn} onChange={(e) => set({ nameEn: e.target.value })} placeholder="e.g. Vidday" required />
        </Field>
        <Field label="上线日期" hint="Launch Date">
          <DateInput value={f.launchDate} onChange={(v) => set({ launchDate: v })} />
        </Field>
        <Field label="排序" hint="Sort Order">
          <Input type="number" value={f.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} />
        </Field>
        <div className="col-span-2">
          <Field label="GitHub 仓库" hint="owner/repo 或完整 URL（选填）">
            <Input
              value={f.repoUrl}
              onChange={(e) => set({ repoUrl: e.target.value })}
              placeholder="https://github.com/owner/repo"
            />
          </Field>
        </div>
        <Field label="每提交工时系数" hint="Hours / Commit">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={f.hoursPerCommit}
            onChange={(e) => set({ hoursPerCommit: e.target.value })}
          />
        </Field>
        <Field label="备注" hint="Note">
          <Input value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder="选填" />
        </Field>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        绑定仓库后，可在项目详情中查看 GitHub 记录的提交数、贡献者与活跃周，并以「提交数 × 系数」估算项目投入工时，作为产品成本评估的参考维度。
      </p>
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
/* GitHub 仓库统计卡                                                    */
/* ------------------------------------------------------------------ */

function RepoStatCard({ project, snapshots }: { project: Project; snapshots: ProjectSnapshot[] }) {
  const [sync, { isLoading }] = useSyncProjectRepoMutation();
  const [error, setError] = useState<string | null>(null);
  const snap = snapshots[0] ?? null;

  async function handleSync() {
    setError(null);
    try {
      await sync(project.id).unwrap();
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  return (
    <Card>
      <CardHeader
        en="Repository Stats"
        cn="GitHub 仓库统计 · 投入工时估算维度"
        right={
          <div className="flex items-center gap-3">
            {snap && (
              <span className="text-[11px] text-slate-500">
                最近同步 {snap.capturedAt.slice(0, 19).replace('T', ' ')}
              </span>
            )}
            <Button variant="ghost" size="sm" disabled={isLoading} onClick={handleSync}>
              {isLoading ? '同步中…' : '同步仓库'}
            </Button>
          </div>
        }
      />

      {!project.repoUrl ? (
        <Empty text="未绑定 GitHub 仓库，编辑项目并填入仓库地址后即可同步统计" />
      ) : (
        <>
          <div className="border-b border-slate-800 px-5 py-3 text-[11px] text-slate-500">
            仓库{' '}
            <a
              href={project.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 hover:underline"
            >
              {project.repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, '')}
            </a>
          </div>
          {error && <div className="px-5 pt-3 text-xs text-rose-400">{error}</div>}
          {!snap ? (
            <Empty text="暂无统计快照，点击「同步仓库」拉取 GitHub 数据" />
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-4">
              <div>
                <div className="text-[11px] text-slate-500">提交数 Commits</div>
                <div className="tabular-nums text-lg text-slate-100">{formatInt(snap.totalCommits)}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">贡献者 Contributors</div>
                <div className="tabular-nums text-lg text-slate-100">{formatInt(snap.contributors)}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">活跃周 Active Weeks</div>
                <div className="tabular-nums text-lg text-slate-100">{formatInt(snap.activeWeeks)}</div>
              </div>
              <div>
                <div className="text-[11px] text-amber-500/80">估算工时 Est. Hours</div>
                <div className="tabular-nums text-lg text-amber-300">{fmtHours(snap.estimatedHours)}</div>
                <div className="text-[10px] text-slate-600">提交数 × {snap.hoursPerCommit} h</div>
              </div>
              <div className="col-span-2 sm:col-span-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-800 pt-3 text-[11px] text-slate-500">
                <span>
                  主分支 <span className="text-slate-300">{snap.defaultBranch ?? '—'}</span>
                </span>
                <span>
                  主语言 <span className="text-slate-300">{snap.language ?? '—'}</span>
                </span>
                <span>
                  Stars <span className="text-slate-300">{formatInt(snap.stars)}</span>
                </span>
                <span>
                  首次提交 <span className="text-slate-300">{formatDate(snap.firstCommitAt)}</span>
                </span>
                <span>
                  最近提交 <span className="text-slate-300">{formatDate(snap.lastCommitAt)}</span>
                </span>
              </div>
              <p className="col-span-2 sm:col-span-4 text-[10px] leading-relaxed text-slate-600">
                注：工时为估算口径，由「提交数 × 每提交工时系数（当前 {snap.hoursPerCommit}h）」折算，非真实工时记录，仅供成本评估参考。
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 主页面                                                              */
/* ------------------------------------------------------------------ */

export default function Projects() {
  const { data: list, isLoading } = useGetProjectsQuery();
  const projects = list ?? [];

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: detail } = useGetProjectDetailQuery(selectedId ?? 0, { skip: selectedId === null });

  const [createOne, { isLoading: creating }] = useCreateProjectMutation();
  const [updateOne, { isLoading: updating }] = useUpdateProjectMutation();
  const [deleteOne] = useDeleteProjectMutation();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [refKey, setRefKey] = useState<ProjectRefKey | null>(null);

  useEffect(() => {
    if (selectedId === null && projects.length) setSelectedId(projects[0].id);
  }, [projects, selectedId]);

  async function submitForm(body: ProjectInput) {
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

  async function removeProject(p: Project) {
    if (!window.confirm(`确认删除项目「${p.nameCn}」？存在引用时将无法删除，请改用「归档」。`)) return;
    try {
      await deleteOne(p.id).unwrap();
      if (selectedId === p.id) setSelectedId(null);
    } catch (e) {
      window.alert(extractErrorMessage(e));
    }
  }

  const refTotal = detail
    ? Object.values(detail.references).reduce((s, n) => s + n, 0)
    : 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 md:px-12">
        <PageHeader en="Projects" cn="项目维护 · 成本中心与 GitHub 投入工时估算">
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-500">共 {projects.length} 个项目</span>
            <Button
              onClick={() => {
                setEditing(null);
                setFormError(null);
                setFormOpen(true);
              }}
            >
              + 新增项目
            </Button>
          </div>
        </PageHeader>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
          {/* 项目列表 */}
          <Card className="h-fit">
            <CardHeader en="Project List" cn="项目名录" />
            {isLoading ? (
              <Empty text="加载中…" />
            ) : projects.length === 0 ? (
              <Empty text="暂无项目，请先新增" />
            ) : (
              <ul className="max-h-[70vh] divide-y divide-slate-800/70 overflow-y-auto">
                {projects.map((p) => {
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
                          <div
                            className={`truncate text-sm font-medium ${selected ? 'text-emerald-300' : 'text-slate-200'}`}
                          >
                            {p.nameEn}
                          </div>
                          <div className="truncate text-[11px] text-slate-500">
                            {p.nameCn} · {p.code}
                          </div>
                        </div>
                        <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                          {STATUS_LABEL[p.status as ProjectStatus]?.cn ?? p.status}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                        <span>{p.productCount ?? 0} 个产品</span>
                        {p.repoUrl ? (
                          <span>
                            提交 {formatInt(p.latestSnapshot?.totalCommits ?? 0)} · 估算{' '}
                            {fmtHours(p.latestSnapshot?.estimatedHours)}h
                          </span>
                        ) : (
                          <span className="text-slate-600">未绑定仓库</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* 项目详情 */}
          <div className="space-y-4">
            {!detail ? (
              <Card>
                <Empty text={selectedId === null ? '请选择或新增一个项目' : '加载中…'} />
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader
                    en={detail.project.nameEn}
                    cn={`${detail.project.nameCn} · ${detail.project.code}`}
                    right={
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(detail.project);
                            setFormError(null);
                            setFormOpen(true);
                          }}
                        >
                          编辑
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => removeProject(detail.project)}>
                          删除
                        </Button>
                      </div>
                    }
                  />
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-5 py-4 text-xs sm:grid-cols-4">
                    <div>
                      <div className="text-[11px] text-slate-500">状态 Status</div>
                      <div className="text-slate-200">
                        {STATUS_LABEL[detail.project.status as ProjectStatus]?.en} ·{' '}
                        {STATUS_LABEL[detail.project.status as ProjectStatus]?.cn}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">上线日期</div>
                      <div className="text-slate-200">{formatDate(detail.project.launchDate)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">成员产品</div>
                      <div className="text-slate-200">{detail.references.products} 个</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">每提交工时系数</div>
                      <div className="tabular-nums text-slate-200">{detail.project.hoursPerCommit} h</div>
                    </div>
                    {detail.project.note && (
                      <div className="col-span-2 sm:col-span-4">
                        <div className="text-[11px] text-slate-500">备注 Note</div>
                        <div className="text-slate-300">{detail.project.note}</div>
                      </div>
                    )}
                  </div>
                </Card>

                {/* GitHub 统计 */}
                <RepoStatCard project={detail.project} snapshots={detail.snapshots} />

                {/* 引用统计 */}
                <Card>
                  <CardHeader
                    en="References"
                    cn="引用统计（点击查看明细·存在引用时禁止删除）"
                    right={
                      <span className={`text-[11px] ${refTotal > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {refTotal > 0 ? `共 ${refTotal} 条引用` : '可删除'}
                      </span>
                    }
                  />
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-3 sm:grid-cols-3">
                    {REF_LABEL.map((r) => {
                      const count = detail.references[r.key];
                      const clickable = count > 0;
                      return (
                        <button
                          key={r.key}
                          type="button"
                          disabled={!clickable}
                          onClick={() => setRefKey(r.key as ProjectRefKey)}
                          className={`flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition ${
                            clickable
                              ? 'cursor-pointer hover:bg-slate-800/60'
                              : 'cursor-default opacity-70'
                          }`}
                        >
                          <div className="min-w-0 leading-tight">
                            <div className={`truncate text-xs ${clickable ? 'text-slate-200' : 'text-slate-400'}`}>
                              {r.en}
                            </div>
                            <div className="truncate text-[11px] text-slate-500">{r.cn}</div>
                          </div>
                          <span className="flex shrink-0 items-center gap-1">
                            <span
                              className={`tabular-nums text-sm ${count > 0 ? 'text-slate-100' : 'text-slate-600'}`}
                            >
                              {formatInt(count)}
                            </span>
                            {clickable && <span className="text-[10px] text-slate-600">›</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Card>

                {/* 分摊产品 */}
                <Card>
                  <CardHeader
                    en="Product Allocation"
                    cn="成本分摊至产品（近 3 个月口径）"
                    right={<span className="text-[11px] text-slate-500">{detail.productShares.length} 个产品</span>}
                  />
                  {detail.productShares.length === 0 ? (
                    <Empty text="该项目尚未被任何产品引用·可在「产品维护」中加入" />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[820px] text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                            <th className="border-b border-slate-800 px-5 py-2.5 font-medium">产品 Product</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">分摊比例</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">分摊后收入</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">分摊后成本</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">收入 / 成本占比</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.productShares.map((s) => (
                            <tr key={s.productId} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                              <td className="px-5 py-3">
                                <div className="leading-tight">
                                  <div className="text-slate-200">{s.nameEn}</div>
                                  <div className="text-[11px] text-slate-500">
                                    {s.nameCn} · {s.code}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-slate-200">{fmtPct(s.ratio)}</td>
                              <td className="px-4 py-3 text-right text-[11px] tabular-nums text-emerald-400">
                                ¥{formatCny(s.allocRevenueCny)}
                              </td>
                              <td className="px-4 py-3 text-right text-[11px] tabular-nums text-rose-400">
                                ¥{formatCny(s.allocCostCny)}
                              </td>
                              <td className="px-4 py-3 text-right text-[11px] tabular-nums text-slate-400">
                                {fmtPct(s.revenueShare)} / {fmtPct(s.costShare)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>

                {/* 快照历史 */}
                <Card>
                  <CardHeader en="Snapshot History" cn="仓库统计快照（趋势可审计）" />
                  {detail.snapshots.length === 0 ? (
                    <Empty text="暂无快照记录" />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                            <th className="border-b border-slate-800 px-5 py-2.5 font-medium">采集时间</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">提交数</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">贡献者</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">活跃周</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">系数</th>
                            <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">估算工时</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.snapshots.map((s) => (
                            <tr key={s.id} className="border-b border-slate-800/60">
                              <td className="px-5 py-2.5 text-[11px] text-slate-400">
                                {s.capturedAt.slice(0, 19).replace('T', ' ')}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">
                                {formatInt(s.totalCommits)}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">
                                {formatInt(s.contributors)}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">
                                {formatInt(s.activeWeeks)}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{s.hoursPerCommit} h</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-amber-300">
                                {fmtHours(s.estimatedHours)} h
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

      {refKey !== null && detail && (
        <RefDetailModal projectId={detail.project.id} refKey={refKey} onClose={() => setRefKey(null)} />
      )}

      <Modal
        open={formOpen}
        title={editing ? '编辑项目 / Edit Project' : '新增项目 / New Project'}
        onClose={() => setFormOpen(false)}
      >
        {formOpen && (
          <ProjectForm
            initial={editing ?? undefined}
            saving={creating || updating}
            error={formError}
            submitLabel={editing ? '保存' : '创建'}
            onSubmit={submitForm}
            onCancel={() => setFormOpen(false)}
          />
        )}
      </Modal>
    </div>
  );
}
