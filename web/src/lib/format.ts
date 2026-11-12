const amountFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 人民币主值，保留两位小数，千分位逗号。 */
export function formatCny(v: number | null | undefined): string {
  return amountFmt.format(Number(v ?? 0));
}

/** 美元副值，保留两位小数，千分位逗号。 */
export function formatUsd(v: number | null | undefined): string {
  return amountFmt.format(Number(v ?? 0));
}

/** 汇率，默认 4 位小数。 */
export function formatRate(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(v));
}

/** 整数（用于笔数等）。 */
export function formatInt(v: number | null | undefined): string {
  return new Intl.NumberFormat('en-US').format(Number(v ?? 0));
}

/** 取 ISO 日期（YYYY-MM-DD）。 */
export function formatDate(v: string | null | undefined): string {
  if (!v) return '—';
  return String(v).slice(0, 10);
}

/** 本地今天，YYYY-MM-DD（避免 UTC 偏移）。 */
export function todayISO(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}
