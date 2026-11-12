import { env } from '../env';

/** 一次用量读表结果。quantity 为计量值，unit 为计量单位。 */
export type MeterReading = {
  quantity: number;
  unit: string;
  source: string;
  raw: unknown;
};

/** 计费期（2026-10）→ 自然月起止日期。 */
export function periodRange(period: string): { start: string; end: string } {
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(lastDay).padStart(2, '0')}` };
}

/** 按计量源 + 计费期拉取用量。source 支持 `r2`、带存储类的 `r2:<StorageClass>`、以及 `vultr`。 */
export async function readUsage(source: string, period: string): Promise<MeterReading> {
  const idx = source.indexOf(':');
  const kind = idx === -1 ? source : source.slice(0, idx);
  const scope = idx === -1 ? '' : source.slice(idx + 1);
  switch (kind) {
    case 'r2':
      return readR2Storage(period, scope);
    case 'vultr':
      return readVultrInvoice(period);
    default:
      throw Object.assign(new Error(`不支持的计量源：${source}`), { statusCode: 400 });
  }
}

/** 计费期（YYYY-MM）的下个自然月（YYYY-MM）。 */
function nextMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

type CfGroup = {
  dimensions: { date: string; bucketName?: string; storageClass?: string };
  max: { payloadSize: number; metadataSize: number; objectCount: number };
};
type CfResponse = {
  data?: { viewer?: { accounts?: { r2StorageAdaptiveGroups?: CfGroup[] }[] } };
  errors?: { message: string }[];
};

/** R2 存储：取「当月每日全桶字节之和」的日均，折算为 GB（GB-month 口径）。
 *  storageClass 非空时仅统计该存储类（Standard / InfrequentAccess）。 */
async function readR2Storage(period: string, storageClass = ''): Promise<MeterReading> {
  const { accountId, apiToken, graphqlUrl, r2GbDivisor } = env.cloudflare;
  if (!accountId || !apiToken) {
    throw Object.assign(
      new Error('未配置 Cloudflare 凭据（CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN），请手工录入用量'),
      { statusCode: 400 }
    );
  }

  const { start, end } = periodRange(period);
  const query = `query ($accountTag: String!, $start: String!, $end: String!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        r2StorageAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $start, date_leq: $end }
          orderBy: [date_ASC]
        ) {
          dimensions { date bucketName storageClass }
          max { payloadSize metadataSize objectCount }
        }
      }
    }
  }`;

  let res: Response;
  try {
    res = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        query,
        variables: { accountTag: accountId, start, end },
      }),
    });
  } catch (e) {
    throw Object.assign(new Error(`调用 Cloudflare 失败：${(e as Error).message}`), { statusCode: 502 });
  }

  const payload = (await res.json().catch(() => ({}))) as CfResponse;
  if (!res.ok || payload.errors?.length) {
    const msg = payload.errors?.map((x) => x.message).join('; ') || `HTTP ${res.status}`;
    throw Object.assign(new Error(`Cloudflare 返回错误：${msg}`), { statusCode: 502 });
  }

  const all = payload.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups ?? [];
  // 计费期内的观测日集合（跨全部存储类），作为日均分母。
  const dates = new Set(all.map((g) => g.dimensions.date));
  if (!dates.size) {
    throw Object.assign(new Error(`未取到 ${period} 的 R2 用量（该期可能无数据）`), { statusCode: 404 });
  }

  // 目标存储类的每日字节合计（未出现的日期按 0 计入分母）。
  const byDate = new Map<string, number>();
  for (const g of all) {
    if (storageClass && (g.dimensions.storageClass ?? '') !== storageClass) continue;
    const bytes = Number(g.max?.payloadSize ?? 0) + Number(g.max?.metadataSize ?? 0);
    byDate.set(g.dimensions.date, (byDate.get(g.dimensions.date) ?? 0) + bytes);
  }
  const avgBytes = [...byDate.values()].reduce((s, b) => s + b, 0) / dates.size;
  const quantity = Math.round((avgBytes / r2GbDivisor) * 10000) / 10000;

  return {
    quantity,
    unit: 'GB',
    source: storageClass ? `r2:${storageClass}` : 'r2',
    raw: { days: dates.size, storageClass: storageClass || null, groups: all.length },
  };
}

type VultrInvoice = { id: number; date: string; description?: string; amount: number };
type VultrResponse = { billing_invoices?: VultrInvoice[]; error?: string };

/** Vultr 账单：计费期的发票在「次月月初」签发（period=2026-10 → 2026-11 签发的发票），
 *  取该月内全部发票金额合计（USD）。metered 模式下 quantity 即账单金额。 */
async function readVultrInvoice(period: string): Promise<MeterReading> {
  const { apiKey, apiBase } = env.vultr;
  if (!apiKey) {
    throw Object.assign(new Error('未配置 Vultr 凭据（VULTR_API_KEY），请手工录入账单金额'), {
      statusCode: 400,
    });
  }

  const invoiceMonth = nextMonth(period);
  let res: Response;
  try {
    res = await fetch(`${apiBase}/billing/invoices?per_page=100`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (e) {
    throw Object.assign(new Error(`调用 Vultr 失败：${(e as Error).message}`), { statusCode: 502 });
  }

  const payload = (await res.json().catch(() => ({}))) as VultrResponse;
  if (!res.ok) {
    throw Object.assign(new Error(`Vultr 返回错误：${payload.error ?? `HTTP ${res.status}`}`), {
      statusCode: 502,
    });
  }

  const invoices = (payload.billing_invoices ?? []).filter((i) => String(i.date).slice(0, 7) === invoiceMonth);
  if (!invoices.length) {
    throw Object.assign(
      new Error(`未取到 ${period} 的 Vultr 账单（对应发票于 ${invoiceMonth} 签发，可能尚未出账）`),
      { statusCode: 404 }
    );
  }

  const amount = Math.round(invoices.reduce((s, i) => s + Number(i.amount ?? 0), 0) * 10000) / 10000;
  return {
    quantity: amount,
    unit: 'USD',
    source: 'vultr',
    raw: {
      invoiceMonth,
      invoices: invoices.map((i) => ({ id: i.id, date: i.date, amount: i.amount })),
    },
  };
}
