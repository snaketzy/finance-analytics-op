import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT ?? 8791),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5169',
  /** 汇率线上数据源（frankfurter / ECB），可用 env 覆盖以便测试。 */
  fxApiBase: process.env.FX_API_BASE ?? 'https://api.frankfurter.dev/v1',
  /** Cloudflare 用量采集（R2 等），未配置时预览/计费会要求手工录入用量。 */
  cloudflare: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? '',
    billingApiToken: process.env.CLOUDFLARE_BILLING_API_TOKEN ?? '',
    graphqlUrl: process.env.CLOUDFLARE_GRAPHQL_URL ?? 'https://api.cloudflare.com/client/v4/graphql',
    /** 字节 → GB 的除数，Cloudflare 按 10^9 计。 */
    r2GbDivisor: Number(process.env.CLOUDFLARE_R2_GB_DIVISOR ?? 1e9),
  },
  /** Vultr 账单采集（metered 模式：读取上一期已出账发票金额）。 */
  vultr: {
    apiKey: process.env.VULTR_API_KEY ?? '',
    apiBase: process.env.VULTR_API_BASE ?? 'https://api.vultr.com/v2',
  },
  /** Stripe 收入同步（balance_transactions：毛额 + 手续费）。 */
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    apiBase: process.env.STRIPE_API_BASE ?? 'https://api.stripe.com/v1',
  },
  /** PayPal 收入同步（reporting/transactions）。 */
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID ?? '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
    /** live | sandbox */
    mode: (process.env.PAYPAL_MODE ?? 'live') as 'live' | 'sandbox',
    apiBase:
      process.env.PAYPAL_API_BASE ??
      ((process.env.PAYPAL_MODE ?? 'live') === 'sandbox'
        ? 'https://api-m.sandbox.paypal.com'
        : 'https://api-m.paypal.com'),
  },
  /** Cloudflare R2（账单附件存储；S3 兼容 API，私有桶 + 预签名 URL）。 */
  r2: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    bucket: process.env.R2_BUCKET ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    /** 预签名 URL 有效期（秒），默认 1 小时。 */
    signedUrlTtl: Number(process.env.R2_SIGNED_URL_TTL ?? 3600),
  },
  /** GitHub 仓库统计（项目投入工时维度）。 */
  github: {
    /** Personal Access Token：配置后可读私有仓库并提升限速；留空则仅公开仓库。 */
    token: process.env.GITHUB_TOKEN ?? '',
    apiBase: process.env.GITHUB_API_BASE ?? 'https://api.github.com',
    /** 每日自动同步开关（默认开启；设为 0 关闭）。 */
    autoSync: (process.env.GITHUB_AUTO_SYNC ?? '1') !== '0',
    /** 自动同步间隔（小时），默认 24。 */
    syncIntervalHours: Number(process.env.GITHUB_SYNC_INTERVAL_HOURS ?? 24),
  },
  mysql: {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'finance_analytics',
  },
};
