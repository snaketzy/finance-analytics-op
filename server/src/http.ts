export type Envelope<T> = { code: number; message: string; data: T };

export function ok<T>(data: T, message = 'ok'): Envelope<T> {
  return { code: 0, message, data };
}

export function fail(code: number, message: string): Envelope<null> {
  return { code, message, data: null };
}

export function num(v: unknown, fallback: number | null = null): number | null {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
