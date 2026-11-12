import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../env';

let client: S3Client | null = null;

/** 是否已配置 R2（缺少任一必填项则视为未启用，走降级逻辑）。 */
export function r2Enabled(): boolean {
  const { accountId, bucket, accessKeyId, secretAccessKey } = env.r2;
  return Boolean(accountId && bucket && accessKeyId && secretAccessKey);
}

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      // R2 使用固定 region 'auto'
      region: 'auto',
      endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.r2.accessKeyId,
        secretAccessKey: env.r2.secretAccessKey,
      },
    });
  }
  return client;
}

/** 上传账单 PDF 到 R2（私有桶），返回对象 key。 */
export async function putInvoice(key: string, body: Buffer): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: env.r2.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/pdf',
    })
  );
}

/** 生成对象预签名下载 URL（私有桶临时授权）。 */
export async function signedUrl(key: string, expiresIn = env.r2.signedUrlTtl): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: env.r2.bucket, Key: key }),
    { expiresIn }
  );
}

/** 生成账单对象 key：invoices/{YYYY-MM}/{invoiceNo|noinv}-{hash前8}.pdf */
export function invoiceKey(period: string, invoiceNo: string, documentHash: string): string {
  const safeNo = (invoiceNo || 'noinv').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 60) || 'noinv';
  return `invoices/${period}/${safeNo}-${documentHash.slice(0, 8)}.pdf`;
}
