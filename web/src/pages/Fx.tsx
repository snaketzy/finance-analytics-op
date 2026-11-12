import { useState, type FormEvent } from 'react';
import {
  extractErrorMessage,
  useCreateFxMutation,
  useDeleteFxMutation,
  useGetFxLatestQuery,
  useGetFxListQuery,
  useGetFxRemoteQuery,
  useSyncFxMutation,
} from '../api';
import { Card, CardHeader, Empty, PageHeader } from '../components/Card';
import { Button, DateInput, Field, Input } from '../components/Field';
import { formatDate, formatInt, formatRate, todayISO } from '../lib/format';

export default function Fx() {
  const { data: list = [], isLoading } = useGetFxListQuery({});
  const { data: latest } = useGetFxLatestQuery();
  const { data: remote } = useGetFxRemoteQuery();
  const [createFx, { isLoading: saving }] = useCreateFxMutation();
  const [deleteFx] = useDeleteFxMutation();
  const [syncFx, { isLoading: syncing }] = useSyncFxMutation();

  const [rateDate, setRateDate] = useState(todayISO());
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [syncFrom, setSyncFrom] = useState('');
  const [syncTo, setSyncTo] = useState('');
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const value = Number(rate);
    if (!rateDate || !Number.isFinite(value) || value <= 0) {
      setError('请输入有效日期与正数汇率（1 USD = ? CNY）');
      return;
    }
    try {
      await createFx({ rateDate, rate: value }).unwrap();
      setSuccess(`已保存 ${rateDate} 的汇率：1 USD = ¥ ${formatRate(value)}`);
      setRate('');
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  /** 从线上数据源同步；from/to 为空时由后端决定默认区间。 */
  async function runSync(body: { from?: string; to?: string }) {
    setSyncMsg(null);
    setSyncErr(null);
    try {
      const r = await syncFx(body).unwrap();
      setSyncMsg(
        r.fetched > 0
          ? `同步完成：${r.from} ~ ${r.to} 抓取 ${formatInt(r.fetched)} 个交易日，写入 ${formatInt(r.upserted)} 条`
          : `同步完成：${r.from} ~ ${r.to} 区间内线上暂无数据（非交易日）`
      );
    } catch (err) {
      setSyncErr(extractErrorMessage(err));
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 md:px-12">
        <PageHeader en="FX Rates" cn="汇率 · 1 USD = ? CNY，线上数据源同步 + 手动录入">
          <div className="text-right leading-tight">
            <div className="text-xs text-slate-300">
              最新汇率 1 USD = ¥{' '}
              <span className="font-semibold text-emerald-400">{formatRate(latest?.rate)}</span>
            </div>
            <div className="text-[11px] text-slate-500">汇率日期 {formatDate(latest?.rateDate)}</div>
          </div>
        </PageHeader>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader en="Rate History" cn="汇率列表" />
            {isLoading ? (
              <Empty text="加载中…" />
            ) : list.length === 0 ? (
              <Empty text="暂无汇率数据" />
            ) : (
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="border-b border-slate-800 px-4 py-2.5 font-medium">日期 Date</th>
                      <th className="border-b border-slate-800 px-4 py-2.5 text-right font-medium">
                        1 USD = ? CNY
                      </th>
                      <th className="border-b border-slate-800 px-4 py-2.5 font-medium">来源 Source</th>
                      <th className="border-b border-slate-800 px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr
                        key={r.rateDate}
                        className="border-b border-slate-800/60 hover:bg-slate-800/30"
                      >
                        <td className="px-4 py-3 tabular-nums text-slate-300">
                          {formatDate(r.rateDate)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-400">
                          {formatRate(r.rate)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded px-2 py-0.5 text-[11px] ${
                              r.source === 'manual'
                                ? 'bg-indigo-500/10 text-indigo-300'
                                : 'bg-emerald-500/10 text-emerald-300'
                            }`}
                          >
                            {r.source}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {r.source === 'manual' && (
                            <button
                              type="button"
                              onClick={() => deleteFx(r.rateDate)}
                              className="text-[11px] text-slate-500 transition-colors hover:text-rose-400"
                            >
                              删除
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader
                en="Online Source"
                cn="线上数据源 · frankfurter (ECB)"
                right={
                  <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
                    {remote?.provider ?? 'frankfurter'}
                  </span>
                }
              />
              <div className="space-y-4 p-5">
                <div className="rounded-md border border-slate-800 bg-slate-800/40 p-3">
                  <div className="text-[11px] text-slate-500">线上最新 Online Latest</div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-semibold tabular-nums text-emerald-400">
                      ¥ {formatRate(remote?.rate)}
                    </span>
                    <span className="text-[11px] text-slate-500">{formatDate(remote?.date)}</span>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    1 {remote?.base ?? 'USD'} = ? {remote?.quote ?? 'CNY'}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="From" hint="可空">
                    <DateInput value={syncFrom} onChange={setSyncFrom} />
                  </Field>
                  <Field label="To" hint="可空=今天">
                    <DateInput value={syncTo} onChange={setSyncTo} />
                  </Field>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    className="flex-1"
                    disabled={syncing}
                    onClick={() => runSync({})}
                  >
                    {syncing ? '同步中…' : '同步最新'}
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={syncing || !syncFrom}
                    onClick={() => runSync({ from: syncFrom, to: syncTo || undefined })}
                  >
                    补齐区间
                  </Button>
                </div>

                {syncErr && (
                  <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {syncErr}
                  </div>
                )}
                {syncMsg && (
                  <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                    {syncMsg}
                  </div>
                )}

                <p className="text-[11px] leading-relaxed text-slate-600">
                  区间留空时默认从库内最新日期补到今天；冲突以线上为准覆盖（含手动录入）。服务端每日 01:30
                  自动同步一次。
                </p>
              </div>
            </Card>

            <Card>
              <CardHeader en="Manual Entry" cn="手动录入 / 覆盖某日汇率" />
              <form onSubmit={submit} className="space-y-4 p-5">
                <Field label="Date *">
                  <DateInput value={rateDate} onChange={setRateDate} />
                </Field>
                <Field label="Rate (1 USD = ? CNY) *" hint="正数">
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    placeholder="例如 7.1200"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                  />
                </Field>
                <Button type="submit" disabled={saving} className="w-full">
                  {saving ? '保存中…' : '保存汇率'}
                </Button>

                {error && (
                  <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {error}
                  </div>
                )}
                {success && (
                  <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                    {success}
                  </div>
                )}
                <p className="text-[11px] leading-relaxed text-slate-600">
                  同一日期重复提交将覆盖原值（来源标记为 manual）。
                </p>
              </form>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
