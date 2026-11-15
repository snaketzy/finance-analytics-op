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

export const PAYMENT_SOURCES = ['stripe', 'paypal', 'waffo_pancake', 'paddle', 'creem'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export type PaymentSourceMeta = {
  cn: string;
  en: string;
  implemented: boolean;
  credentialHint: string | null;
  summary: string;
};

const META: Record<PaymentSource, PaymentSourceMeta> = {
  stripe: {
    cn: 'Stripe',
    en: 'Stripe',
    implemented: true,
    credentialHint: 'STRIPE_SECRET_KEY',
    summary: '读取 Stripe balance_transactions，毛额入收入、手续费单独入支出。',
  },
  paypal: {
    cn: 'PayPal',
    en: 'PayPal',
    implemented: true,
    credentialHint: 'PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET',
    summary: '读取 PayPal reporting/transactions，毛额入收入、手续费单独入支出。',
  },
  waffo_pancake: {
    cn: 'Waffo Pancake',
    en: 'Waffo Pancake',
    implemented: false,
    credentialHint: null,
    summary: 'Waffo Pancake 作为支付渠道已预留入口，API 同步待接入。',
  },
  paddle: {
    cn: 'Paddle',
    en: 'Paddle',
    implemented: false,
    credentialHint: null,
    summary: 'Paddle 作为支付渠道已预留入口，API 同步待接入。',
  },
  creem: {
    cn: 'Creem',
    en: 'Creem',
    implemented: false,
    credentialHint: null,
    summary: 'Creem 作为支付渠道已预留入口，API 同步待接入。',
  },
};

/** 渠道元信息（展示名、默认币种）。 */
export function sourceBrand(source: PaymentSource): { cn: string; en: string } {
  const meta = META[source];
  return { cn: meta.cn, en: meta.en };
}

/** 渠道展示/接入元信息。 */
export function sourceMeta(source: PaymentSource): PaymentSourceMeta {
  return META[source];
}
