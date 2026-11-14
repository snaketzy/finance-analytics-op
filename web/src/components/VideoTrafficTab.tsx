import { useEffect, useMemo, useRef, useState } from 'react';
import {
  extractErrorMessage,
  useGetVideoTrafficQuery,
  useSaveVideoTrafficMutation,
} from '../api';
import { Card, CardHeader, Empty } from './Card';
import { Button, Input } from './Field';

/* ------------------------------------------------------------------ */
/* 视频流量测算（全局共用）                                             */
/* 按编码（HEVC / H264）× 分辨率录入「体积 / 时长」并折算每分钟流量。    */
/* 仅 HEVC 有 4K 档；H264 最高 1080P。                                  */
/* ------------------------------------------------------------------ */

const CODECS: { codec: string; cn: string; en: string; resolutions: string[] }[] = [
  { codec: 'HEVC', cn: 'HEVC（H.265）', en: 'HEVC', resolutions: ['4K', '1080P', '720P', '480P', '360P'] },
  { codec: 'H264', cn: 'H264（AVC）', en: 'H264', resolutions: ['1080P', '720P', '480P', '360P'] },
];

const RESOLUTION_HINT: Record<string, string> = {
  '4K': 'Ultra HD · 3840×2160',
  '1080P': 'Full HD · 1920×1080',
  '720P': 'HD · 1280×720',
  '480P': 'SD · 854×480',
  '360P': 'LD · 640×360',
};

type Row = { sizeGb: string; durationMin: string };

const rowKey = (codec: string, resolution: string) => `${codec}|${resolution}`;

const EMPTY_ROWS = (): Record<string, Row> =>
  Object.fromEntries(
    CODECS.flatMap((c) => c.resolutions.map((r) => [rowKey(c.codec, r), { sizeGb: '', durationMin: '' }]))
  );

const parseNum = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** 每分钟流量 GB/min = 体积 / 时长；参数不合法时返回 null。 */
const perMinGb = (row: Row): number | null => {
  const size = parseNum(row.sizeGb);
  const dur = parseNum(row.durationMin);
  if (size == null || dur == null || size <= 0 || dur <= 0) return null;
  return size / dur;
};

/** 码率 Mbps = 体积(GB) × 1024 × 8 ÷ 时长(s)；参数不合法时返回 null。 */
const bitrateMbps = (row: Row): number | null => {
  const size = parseNum(row.sizeGb);
  const dur = parseNum(row.durationMin);
  if (size == null || dur == null || size <= 0 || dur <= 0) return null;
  return (size * 1024 * 8) / (dur * 60);
};

const fmt = (v: number, digits: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);

/** 统一展示保存时间（后端返回 YYYY-MM-DD HH:MM:SS）。 */
const fmtSavedAt = (v: string | null) => (v ? v.slice(0, 16) : '—');

export default function VideoTrafficTab() {
  const { data, isLoading } = useGetVideoTrafficQuery();
  const [save, { isLoading: saving }] = useSaveVideoTrafficMutation();

  const [rows, setRows] = useState<Record<string, Row>>(EMPTY_ROWS);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const initedRef = useRef(false);
  useEffect(() => {
    if (!data || initedRef.current) return;
    initedRef.current = true;
    const next = EMPTY_ROWS();
    for (const item of data.items) {
      next[rowKey(item.codec, item.resolution)] = {
        sizeGb: item.sizeGb == null ? '' : String(item.sizeGb),
        durationMin: item.durationMin == null ? '' : String(item.durationMin),
      };
    }
    setRows(next);
    setSavedAt(data.updatedAt);
  }, [data]);

  const set = (codec: string, resolution: string, key: keyof Row, value: string) =>
    setRows((prev) => ({ ...prev, [rowKey(codec, resolution)]: { ...prev[rowKey(codec, resolution)], [key]: value } }));

  /** 是否填过任何档位（决定「保存」是否可点）。 */
  const dirty = useMemo(
    () => Object.values(rows).some((r) => r.sizeGb.trim() !== '' || r.durationMin.trim() !== ''),
    [rows]
  );

  async function handleSave() {
    setError(null);
    try {
      const res = await save({
        items: CODECS.flatMap((c) =>
          c.resolutions.map((resolution) => {
            const row = rows[rowKey(c.codec, resolution)];
            return {
              codec: c.codec,
              resolution,
              sizeGb: parseNum(row.sizeGb),
              durationMin: parseNum(row.durationMin),
            };
          })
        ),
      }).unwrap();
      setSavedAt(res.updatedAt);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  if (isLoading) return <Empty text="加载视频流量测算…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
        <div className="text-[11px] leading-relaxed text-slate-500">
          按编码与分辨率录入「体积 / 时长」，自动折算每分钟流量（
          <span className="text-slate-300">GB/min = 体积 ÷ 时长</span>）。仅 HEVC 提供 4K 档。数据全局共用，与产品无关。
        </div>
        <div className="flex items-center gap-2">
          {savedAt ? (
            <span className="text-[11px] tabular-nums text-emerald-400">保存时间 {fmtSavedAt(savedAt)}</span>
          ) : (
            <span className="text-[11px] text-slate-500">尚未保存</span>
          )}
          <Button size="sm" disabled={saving || !dirty} onClick={handleSave}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-300">
          {error}
        </div>
      ) : null}

      {CODECS.map(({ codec, cn, en, resolutions }) => (
        <Card key={codec}>
          <CardHeader
            en={`Video Traffic · ${en}`}
            cn={`视频流量测算 · ${cn}（${resolutions.length} 档${codec === 'HEVC' ? '，含 4K' : '，无 4K'}）`}
            right={<span className="text-[11px] text-slate-500">示例：体积 0.6 GB · 时长 10 min → 61.4 MB/min · 8.19 Mbps</span>}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2 text-left font-medium">分辨率 Resolution</th>
                  <th className="px-4 py-2 text-left font-medium">体积 Size (GB)</th>
                  <th className="px-4 py-2 text-left font-medium">时长 Duration (min)</th>
                  <th className="px-4 py-2 text-right font-medium">每分钟流量 MB/min</th>
                  <th className="px-4 py-2 text-right font-medium">GB/min</th>
                  <th className="px-4 py-2 text-right font-medium">码率 Bitrate (Mbps)</th>
                </tr>
              </thead>
              <tbody>
                {resolutions.map((resolution) => {
                  const row = rows[rowKey(codec, resolution)];
                  const perMin = perMinGb(row);
                  const bitrate = bitrateMbps(row);
                  return (
                    <tr
                      key={resolution}
                      className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30"
                    >
                      <td className="px-4 py-2.5 align-top">
                        <div className="leading-tight">
                          <div className="font-medium text-slate-200">{resolution}</div>
                          <div className="text-[11px] text-slate-500">{RESOLUTION_HINT[resolution]}</div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          inputMode="decimal"
                          value={row.sizeGb}
                          placeholder="如 0.6"
                          onChange={(e) => set(codec, resolution, 'sizeGb', e.target.value)}
                          className="max-w-[10rem]"
                        />
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <Input
                          type="number"
                          min="0"
                          step="0.1"
                          inputMode="decimal"
                          value={row.durationMin}
                          placeholder="如 10"
                          onChange={(e) => set(codec, resolution, 'durationMin', e.target.value)}
                          className="max-w-[10rem]"
                        />
                      </td>
                      <td className="px-4 py-2.5 align-top text-right tabular-nums">
                        {perMin == null ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          <span className="text-slate-100">{fmt(perMin * 1024, 1)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-top text-right tabular-nums">
                        {perMin == null ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          <span className="text-slate-400">{fmt(perMin, 4)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-top text-right tabular-nums">
                        {bitrate == null ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          <span className="text-slate-100">{fmt(bitrate, 2)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
