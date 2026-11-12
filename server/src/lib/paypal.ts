import { env } from '../env';
import { round4, type ChannelTxn } from './channel';

/** PayPal 未配置凭据时返回 false。 */
export function paypalEnabled(): boolean {
  return Boolean(env.paypal.clientId && env.paypal.clientSecret);
}

function apiError(message: string, statusCode = 502) {
  return Object.assign(new Error(message), { statusCode });
}

type PaypalMoney = { currency_code?: string; value?: string };
type PaypalTransactionInfo = {
  transaction_id?: string;
  transaction_event_code?: string;
  transaction_initiation_date?: string;
  transaction_amount?: PaypalMoney;
  fee_amount?: PaypalMoney;
  transaction_status?: string;
  transaction_subject?: string;
  transaction_note?: string;
  invoice_id?: string;
  paypal_reference_id?: string;
};
type PaypalTransactionDetail = {
  transaction_info?: PaypalTransactionInfo;
  payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string } };
};
type PaypalTransactionsResponse = {
  transaction_details?: PaypalTransactionDetail[];
  total_pages?: number;
  page?: number;
};

async function getAccessToken(): Promise<string> {
  const basic = Buffer.from(`${env.paypal.clientId}:${env.paypal.clientSecret}`).toString('base64');
  let response: Response;
  try {
    response = await fetch(`${env.paypal.apiBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
  } catch (error) {
    throw apiError(`调用 PayPal 鉴权失败：${(error as Error).message}`);
  }
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw apiError(`PayPal 鉴权返回错误：${payload.error_description ?? `HTTP ${response.status}`}`);
  }
  return payload.access_token;
}

function iso(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** 把自然月拆成若干 ≤30 天的窗口（PayPal 单次查询上限 31 天）。 */
function monthWindows(period: string): [string, string][] {
  const [year, month] = period.split('-').map(Number);
  const startMs = Date.UTC(year, month - 1, 1);
  const endMs = Date.UTC(year, month, 1) - 1000;
  const step = 30 * 24 * 3600 * 1000;
  const windows: [string, string][] = [];
  let cursor = startMs;
  while (cursor <= endMs) {
    const windowEnd = Math.min(cursor + step - 1000, endMs);
    windows.push([iso(cursor), iso(windowEnd)]);
    cursor = windowEnd + 1000;
  }
  return windows;
}

async function paypalGet<T>(path: string, params: URLSearchParams, token: string): Promise<T> {
  const url = `${env.paypal.apiBase}${path}?${params.toString()}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    throw apiError(`调用 PayPal API 失败：${(error as Error).message}`);
  }
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    name?: string;
  };
  if (!response.ok) {
    throw apiError(`PayPal API 返回错误：${payload.message ?? `HTTP ${response.status}`}`);
  }
  return payload;
}

/**
 * 拉取某自然月的 PayPal 收入交易（reporting/transactions）。
 * 净额口径：gross=交易金额，fee=PayPal 手续费；退款等非正金额计入 skipped。
 */
export async function fetchPaypalMonth(period: string): Promise<{ items: ChannelTxn[]; skipped: number }> {
  if (!paypalEnabled()) {
    throw apiError('未配置 PayPal（.env 需设置 PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET）', 400);
  }
  const token = await getAccessToken();
  const unique = new Map<string, PaypalTransactionDetail>();

  for (const [from, to] of monthWindows(period)) {
    let page = 1;
    for (;;) {
      const params = new URLSearchParams();
      params.set('start_date', from);
      params.set('end_date', to);
      params.set('fields', 'all');
      params.set('page_size', '100');
      params.set('page', String(page));

      const result = await paypalGet<PaypalTransactionsResponse>('/v1/reporting/transactions', params, token);
      const details = result.transaction_details ?? [];
      for (const detail of details) {
        const id = detail.transaction_info?.transaction_id;
        if (id) unique.set(id, detail);
      }
      const totalPages = Number(result.total_pages ?? 1);
      if (page >= totalPages || !details.length) break;
      page += 1;
    }
  }

  const items: ChannelTxn[] = [];
  let skipped = 0;
  for (const detail of unique.values()) {
    const info = detail.transaction_info ?? {};
    const day = String(info.transaction_initiation_date ?? '').slice(0, 10);
    if (!day.startsWith(period)) continue;
    const currency = (info.transaction_amount?.currency_code ?? 'USD').toUpperCase();
    const gross = round4(Number(info.transaction_amount?.value ?? 0));
    if (!Number.isFinite(gross) || gross <= 0) {
      skipped += 1;
      continue;
    }
    const fee = round4(Math.abs(Number(info.fee_amount?.value ?? 0)));
    const payer = detail.payer_info;
    items.push({
      sourceKey: String(info.transaction_id),
      occurredAt: day,
      currency,
      gross,
      fee: Number.isFinite(fee) ? fee : 0,
      reference: info.invoice_id || info.paypal_reference_id || null,
      description: info.transaction_subject?.trim() || `PayPal ${info.transaction_event_code ?? 'transaction'}`,
      counterparty: payer?.email_address || payer?.payer_name?.alternate_full_name || 'PayPal',
    });
  }

  items.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sourceKey.localeCompare(b.sourceKey));
  return { items, skipped };
}
