import { env } from '../env';

/* ------------------------------------------------------------------ */
/* 渠道交易归一化模型（Stripe / PayPal 共用）                            */
/* ------------------------------------------------------------------ */

/** 渠道侧的一笔收入交易：毛额 + 手续费，落库时拆成收入/支出两条流水。 */
export type ChannelTxn = {
  /** 渠道交易唯一 ID（幂等键）。 */
  sourceKey: string;
  /** 交易日 YYYY-MM-DD。 */
  occurredAt: string;
  currency: string;
  /** 毛额（>0 视为收入）。 */
  gross: number;
  /** 平台手续费（>=0）。 */
  fee: number;
  reference: string | null;
  description: string;
  counterparty: string;
};

/** 归一化的金额保留 4 位小数。 */
export function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4;
}

/* ------------------------------------------------------------------ */
/* 预览结果：附加「是否已导入」标记                                       */
/* ------------------------------------------------------------------ */

export type PaymentPreviewItem = ChannelTxn & { imported: boolean };

export const PAYMENT_SOURCES = ['stripe', 'paypal'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

const BRAND: Record<PaymentSource, { cn: string; en: string }> = {
  stripe: { cn: 'Stripe', en: 'Stripe' },
  paypal: { cn: 'PayPal', en: 'PayPal' },
};

/** 渠道元信息（展示名、默认币种）。 */
export function sourceBrand(source: PaymentSource): { cn: string; en: string } {
  return BRAND[source];
}
