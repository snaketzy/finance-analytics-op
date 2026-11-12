import type { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { fail, ok } from '../http';
import { PAYMENT_SOURCES, type PaymentSource } from '../lib/channel';
import { fetchStripeMonth, stripeEnabled } from '../lib/stripe';
import { fetchPaypalMonth, paypalEnabled } from '../lib/paypal';
import { insertPaymentImport, markImported } from '../lib/paymentImport';

function apiError(message: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function validPeriod(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isSource(value: string): value is PaymentSource {
  return (PAYMENT_SOURCES as readonly string[]).includes(value);
}

/** 读取某渠道某月的归一化收入交易（不落库）。 */
async function readMonth(source: PaymentSource, period: string, types: string[]) {
  return source === 'stripe' ? fetchStripeMonth(period, types) : fetchPaypalMonth(period);
}

export default async function paymentsRoutes(app: FastifyInstance) {
  // 渠道配置状态：未配置密钥时前端给出提示。
  app.get('/sources', async () =>
    ok(
      PAYMENT_SOURCES.map((source) => ({
        source,
        enabled: source === 'stripe' ? stripeEnabled() : paypalEnabled(),
      }))
    )
  );

  // 预览：读取渠道账单周期内收入交易 + 是否已导入。
  app.get('/:source/preview', async (req, reply) => {
    const source = String((req.params as { source: string }).source);
    if (!isSource(source)) {
      reply.code(400);
      return fail(400, '不支持的支付渠道');
    }
    const query = req.query as { period?: string; types?: string };
    if (!validPeriod(query.period)) {
      reply.code(400);
      return fail(400, 'period 必须为 YYYY-MM');
    }
    const types = (query.types ?? '')
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean);

    const { items, skipped } = await readMonth(source, query.period, types);
    return ok({
      source,
      period: query.period,
      skipped,
      items: await markImported(source, items),
    });
  });

  // 导入：为选中的渠道交易写入收入/手续费流水（幂等）。
  app.post('/:source/import', async (req, reply) => {
    const source = String((req.params as { source: string }).source);
    if (!isSource(source)) {
      reply.code(400);
      return fail(400, '不支持的支付渠道');
    }
    const body = req.body as {
      period?: string;
      types?: string;
      items?: {
        sourceKey?: string;
        projectId?: number;
        categoryId?: number;
        feeCategoryId?: number | null;
        accountId?: number | null;
      }[];
    };
    if (!validPeriod(body?.period) || !Array.isArray(body.items) || !body.items.length) {
      reply.code(400);
      return fail(400, '请提供计费月份和至少一条待导入交易');
    }

    const currentMonth = new Date().toISOString().slice(0, 7);
    if (body.period >= currentMonth) {
      reply.code(400);
      return fail(400, '只能导入已结束月份的账单；当前月份仍在累计中');
    }

    const types = (body.types ?? '')
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean);
    const preview = await readMonth(source, body.period, types);
    const byKey = new Map(preview.items.map((item) => [item.sourceKey, item]));
    const conn = await pool.getConnection();
    let imported = 0;
    let skipped = 0;
    let incomeCount = 0;
    let feeCount = 0;
    try {
      await conn.beginTransaction();
      for (const requested of body.items) {
        const item = byKey.get(String(requested.sourceKey ?? ''));
        const projectId = Number(requested.projectId);
        const categoryId = Number(requested.categoryId);
        if (!item || !Number.isInteger(projectId) || !Number.isInteger(categoryId)) {
          throw apiError('交易映射无效，请重新预览账单后再导入');
        }
        const feeCategoryId =
          requested.feeCategoryId === undefined || requested.feeCategoryId === null
            ? null
            : Number(requested.feeCategoryId);
        const accountId =
          requested.accountId === undefined || requested.accountId === null
            ? null
            : Number(requested.accountId);

        const result = await insertPaymentImport(conn, {
          source,
          sourceKey: item.sourceKey,
          period: body.period,
          sourceName: `${item.counterparty} · ${item.description} · ${body.period}`,
          reference: item.reference,
          counterparty: item.counterparty,
          projectId,
          categoryId,
          feeCategoryId,
          accountId,
          txnDate: item.occurredAt,
          currency: item.currency,
          gross: item.gross,
          fee: item.fee,
          raw: item,
        });
        if (result.status === 'imported') {
          imported += 1;
          if (result.incomeTxnId) incomeCount += 1;
          if (result.feeTxnId) feeCount += 1;
        } else {
          skipped += 1;
        }
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    return ok({ imported, skipped, incomeCount, feeCount });
  });
}
