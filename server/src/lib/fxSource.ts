import { pool, type Row } from '../db';
import { env } from '../env';

/** 数据源标识，写入 fx_rates.source。 */
export const FX_PROVIDER = 'frankfurter';
/** 计价方向：1 USD = ? CNY（与库内 base_ccy / quote_ccy 约定一致）。 */
const BASE = 'USD';
const QUOTE = 'CNY';

const DAY = 86400000;

export type RemoteRate = { date: string; rate: number };

export type FxSyncResult = {
  provider: string;
  from: string;
  to: string;
  fetched: number;
  upserted: number;
  latest: RemoteRate | null;
};

async function getJson(url: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
  } catch (e) {
    throw Object.assign(new Error(`汇率数据源不可达：${(e as Error).message}`), { statusCode: 502 });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`汇率数据源返回 HTTP ${res.status}`), { statusCode: 502 });
  }
  return res.json();
}

/** 线上最新交易日汇率。 */
export async function fetchRemoteLatest(): Promise<RemoteRate> {
  const j = await getJson(`${env.fxApiBase}/latest?base=${BASE}&symbols=${QUOTE}`);
  const rate = Number(j?.rates?.[QUOTE]);
  if (!j?.date || !Number.isFinite(rate) || rate <= 0) {
    throw Object.assign(new Error('汇率数据源返回格式异常'), { statusCode: 502 });
  }
  return { date: String(j.date).slice(0, 10), rate };
}

/** 线上区间逐日汇率（自动跳过非交易日），按日期升序。 */
export async function fetchRemoteRange(from: string, to: string): Promise<RemoteRate[]> {
  const j = await getJson(`${env.fxApiBase}/${from}..${to}?base=${BASE}&symbols=${QUOTE}`);
  const rates = (j?.rates ?? {}) as Record<string, Record<string, number>>;
  return Object.entries(rates)
    .map(([date, v]) => ({ date: String(date).slice(0, 10), rate: Number(v?.[QUOTE]) }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.rate) && r.rate > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function shiftDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/**
 * 从线上数据源同步汇率并落库。
 * - 未指定 from：默认从库内最新日期起（库为空则回退 30 天）。
 * - 区间跨度上限 366 天（超出自动前移起点）。
 * - 冲突时以线上为准覆盖（含手动录入记录）。
 */
export async function syncFxRates(opts: { from?: string; to?: string } = {}): Promise<FxSyncResult> {
  const to = opts.to ?? todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw Object.assign(new Error('to 必须为 YYYY-MM-DD'), { statusCode: 400 });
  }

  let from = opts.from;
  if (!from) {
    const [rows] = await pool.query<Row[]>('SELECT MAX(rate_date) AS d FROM fx_rates');
    const d = rows[0]?.d ? String(rows[0].d).slice(0, 10) : null;
    from = d ?? shiftDays(to, -30);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    throw Object.assign(new Error('from 必须为 YYYY-MM-DD'), { statusCode: 400 });
  }

  const spanDays = Math.floor(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY
  );
  if (spanDays < 0) {
    throw Object.assign(new Error('from 不能晚于 to'), { statusCode: 400 });
  }
  if (spanDays > 366) from = shiftDays(to, -366);

  const list = await fetchRemoteRange(from, to);

  let upserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < list.length; i += CHUNK) {
    const part = list.slice(i, i + CHUNK);
    const values = part.map((r) => [r.date, 'CNY', 'USD', r.rate, FX_PROVIDER]);
    await pool.query(
      `INSERT INTO fx_rates (rate_date, base_ccy, quote_ccy, rate, source) VALUES ?
       ON DUPLICATE KEY UPDATE rate = VALUES(rate), source = VALUES(source)`,
      [values]
    );
    upserted += part.length;
  }

  return {
    provider: FX_PROVIDER,
    from,
    to,
    fetched: list.length,
    upserted,
    latest: list.length ? list[list.length - 1] : null,
  };
}

/** 每日定时同步：到点执行一次后自动排下一次（零依赖，不引入 cron 库）。 */
export function startDailyFxSync(hour = 1, minute = 30): void {
  const schedule = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);

    const timer = setTimeout(async () => {
      try {
        const r = await syncFxRates();
        console.log(`[fx] 每日同步完成：${r.from}~${r.to} 抓取 ${r.fetched} 条 · 写入 ${r.upserted} 条`);
      } catch (e) {
        console.error('[fx] 每日同步失败：', (e as Error).message);
      }
      schedule();
    }, next.getTime() - now.getTime());
    timer.unref?.();
  };
  schedule();
}
