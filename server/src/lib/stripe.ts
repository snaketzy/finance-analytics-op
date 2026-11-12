import { env } from '../env';
import { round4, type ChannelTxn } from './channel';

/** Stripe 未配置密钥时返回 false，接口应提示补全 .env。 */
export function stripeEnabled(): boolean {
  return Boolean(env.stripe.secretKey);
}

function apiError(message: string, statusCode = 502) {
  return Object.assign(new Error(message), { statusCode });
}

type StripeList<T> = {
  data?: T[];
  has_more?: boolean;
};

type StripeBalanceTxn = {
  id: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  created: number;
  type: string;
  description?: string | null;
  source?: string | null;
};

/** 零小数币种（金额本身即主单位，不除以 100）。 */
const ZERO_DECIMAL = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg',
  'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

/** Stripe 金额以最小货币单位计，转换为主单位金额。 */
function toMajor(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? amount : amount / 100;
}

function monthRange(period: string): { gte: number; lte: number } {
  const [year, month] = period.split('-').map(Number);
  const gte = Math.floor(Date.UTC(year, month - 1, 1) / 1000);
  const lte = Math.floor(Date.UTC(year, month, 1) / 1000) - 1;
  return { gte, lte };
}

async function stripeGet<T>(path: string, params: URLSearchParams): Promise<T> {
  const url = `${env.stripe.apiBase}${path}?${params.toString()}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.stripe.secretKey}` },
    });
  } catch (error) {
    throw apiError(`调用 Stripe API 失败：${(error as Error).message}`);
  }
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string; type?: string };
  };
  if (!response.ok || payload.error) {
    throw apiError(`Stripe API 返回错误：${payload.error?.message ?? `HTTP ${response.status}`}`);
  }
  return payload;
}

/**
 * 拉取某自然月的 Stripe 收入交易（balance_transactions）。
 * 默认只看 charge 类型（正向收入）；amount<=0 的记录（退款等）计入 skipped 不入账。
 */
export async function fetchStripeMonth(
  period: string,
  types: string[]
): Promise<{ items: ChannelTxn[]; skipped: number }> {
  if (!stripeEnabled()) {
    throw apiError('未配置 Stripe（.env 需设置 STRIPE_SECRET_KEY）', 400);
  }
  const { gte, lte } = monthRange(period);
  const wanted = types.length ? types : ['charge'];
  const unique = new Map<string, StripeBalanceTxn>();

  for (const type of wanted) {
    let startingAfter: string | null = null;
    for (;;) {
      const params = new URLSearchParams();
      params.set('limit', '100');
      params.set('created[gte]', String(gte));
      params.set('created[lte]', String(lte));
      params.set('type', type);
      if (startingAfter) params.set('starting_after', startingAfter);

      const page = await stripeGet<StripeList<StripeBalanceTxn>>('/balance_transactions', params);
      const rows = page.data ?? [];
      for (const row of rows) unique.set(row.id, row);
      if (!page.has_more || !rows.length) break;
      startingAfter = rows[rows.length - 1].id;
    }
  }

  const items: ChannelTxn[] = [];
  let skipped = 0;
  for (const row of unique.values()) {
    const day = new Date(row.created * 1000).toISOString().slice(0, 10);
    if (!day.startsWith(period)) continue;
    const currency = row.currency.toUpperCase();
    const gross = round4(toMajor(row.amount, row.currency));
    if (gross <= 0) {
      skipped += 1;
      continue;
    }
    items.push({
      sourceKey: row.id,
      occurredAt: day,
      currency,
      gross,
      fee: round4(Math.abs(toMajor(row.fee, row.currency))),
      reference: row.source ? String(row.source) : null,
      description: row.description?.trim() || `Stripe ${row.type}`,
      counterparty: 'Stripe',
    });
  }

  items.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sourceKey.localeCompare(b.sourceKey));
  return { items, skipped };
}
