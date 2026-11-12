import type { FastifyInstance } from 'fastify';
import type { ResultSetHeader } from 'mysql2';
import { pool, type Row } from '../db';
import { ok, fail } from '../http';
import { resolveRate } from '../lib/fx';
import { signedUrl, r2Enabled, putInvoice } from '../lib/r2';

const BASE_SELECT = `
  SELECT t.id,
         t.project_id  AS projectId,  p.name_cn AS projectNameCn, p.name_en AS projectNameEn,
         t.category_id AS categoryId, c.name_cn AS categoryNameCn, c.name_en AS categoryNameEn,
         c.domain      AS domain,
         t.direction   AS direction,
         t.txn_date    AS txnDate,
         t.amount_cny  AS amountCny,
         t.amount_usd  AS amountUsd,
         t.fx_rate     AS fxRate,
         t.counterparty AS counterparty,
         t.note         AS note,
         t.created_at   AS createdAt,
         (SELECT COUNT(*) FROM attachments a WHERE a.txn_id = t.id) AS attachmentCount
    FROM transactions t
    JOIN projects   p ON p.id = t.project_id
    JOIN categories c ON c.id = t.category_id
`;

export default async function (app: FastifyInstance) {
  // 列表：多条件筛选 + 分页
  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = ['1=1'];
    const params: unknown[] = [];

    if (q.projectId) { where.push('t.project_id = ?'); params.push(Number(q.projectId)); }
    if (q.categoryId) { where.push('(t.category_id = ? OR c.parent_id = ?)'); params.push(Number(q.categoryId), Number(q.categoryId)); }
    if (q.domain) { where.push('c.domain = ?'); params.push(q.domain); }
    if (q.direction) { where.push('t.direction = ?'); params.push(q.direction); }
    if (q.from) { where.push('t.txn_date >= ?'); params.push(q.from); }
    if (q.to) { where.push('t.txn_date <= ?'); params.push(q.to); }
    if (q.q) { where.push('(t.counterparty LIKE ? OR t.note LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }

    const whereSql = where.join(' AND ');
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const [rows] = await pool.query<Row[]>(
      `${BASE_SELECT} WHERE ${whereSql} ORDER BY t.txn_date DESC, t.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const [agg] = await pool.query<Row[]>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN t.direction='income'  THEN t.amount_cny ELSE 0 END) AS incomeCny,
              SUM(CASE WHEN t.direction='expense' THEN t.amount_cny ELSE 0 END) AS expenseCny,
              SUM(CASE WHEN t.direction='income'  THEN t.amount_usd ELSE 0 END) AS incomeUsd,
              SUM(CASE WHEN t.direction='expense' THEN t.amount_usd ELSE 0 END) AS expenseUsd
         FROM transactions t
         JOIN categories c ON c.id = t.category_id
        WHERE ${whereSql}`,
      params
    );

    const a = agg[0] ?? {};
    return ok({
      items: rows,
      total: Number(a.total ?? 0),
      page,
      pageSize,
      incomeCny: Number(a.incomeCny ?? 0),
      expenseCny: Number(a.expenseCny ?? 0),
      incomeUsd: Number(a.incomeUsd ?? 0),
      expenseUsd: Number(a.expenseUsd ?? 0),
    });
  });

  // 新增
  app.post('/', async (req, reply) => {
    const b = req.body as Record<string, any>;
    const missing = ['projectId', 'categoryId', 'direction', 'txnDate', 'amountCny'].filter(
      (k) => b[k] === undefined || b[k] === null || b[k] === ''
    );
    if (missing.length) {
      reply.code(400);
      return fail(400, `缺少字段：${missing.join(', ')}`);
    }
    if (!['income', 'expense'].includes(b.direction)) {
      reply.code(400);
      return fail(400, 'direction 必须为 income 或 expense');
    }
    const rate = b.fxRate ? Number(b.fxRate) : await resolveRate(b.txnDate);

    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO transactions
         (project_id, account_id, category_id, direction, txn_date, amount_cny, fx_rate,
          src_currency, src_amount, counterparty, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        Number(b.projectId), b.accountId ?? null, Number(b.categoryId), b.direction, b.txnDate,
        Number(b.amountCny), rate, b.srcCurrency ?? 'CNY', b.srcAmount ?? null,
        b.counterparty ?? null, b.note ?? null,
      ]
    );
    const [rows] = await pool.query<Row[]>(`${BASE_SELECT} WHERE t.id = ?`, [res.insertId]);
    reply.code(201);
    return ok(rows[0]);
  });

  // 更新
  app.patch('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as Record<string, any>;
    const fields: string[] = [];
    const params: unknown[] = [];

    const map: Record<string, string> = {
      projectId: 'project_id', accountId: 'account_id', categoryId: 'category_id',
      direction: 'direction', txnDate: 'txn_date', amountCny: 'amount_cny',
      counterparty: 'counterparty', note: 'note',
    };
    for (const [k, col] of Object.entries(map)) {
      if (b[k] !== undefined) { fields.push(`${col} = ?`); params.push(b[k]); }
    }
    if (b.txnDate !== undefined || b.fxRate !== undefined) {
      const rate = b.fxRate !== undefined ? Number(b.fxRate) : await resolveRate(b.txnDate);
      fields.push('fx_rate = ?');
      params.push(rate);
    }
    if (!fields.length) {
      reply.code(400);
      return fail(400, '没有可更新的字段');
    }
    params.push(id);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`, params);
      // 由周期成本计费生成的流水：归属变更需回写计量记录，避免两表归属漂移
      if (b.projectId !== undefined || b.categoryId !== undefined) {
        await conn.query(
          `UPDATE usage_records u
             JOIN transactions t ON t.id = u.txn_id
              SET u.project_id = t.project_id, u.category_id = t.category_id
            WHERE u.txn_id = ?`,
          [id]
        );
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    const [rows] = await pool.query<Row[]>(`${BASE_SELECT} WHERE t.id = ?`, [id]);
    if (!rows.length) { reply.code(404); return fail(404, '流水不存在'); }
    return ok(rows[0]);
  });

  // 删除
  app.delete('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    // 被引用表指向的流水不可直接删除，否则会留下悬空 txn_id
    const refs: string[] = [];
    const [usages] = await pool.query<Row[]>('SELECT id FROM usage_records WHERE txn_id = ? LIMIT 1', [id]);
    if (usages.length) refs.push('计量记录（周期成本计费）');
    const [imports] = await pool.query<Row[]>('SELECT id FROM cloudflare_cost_imports WHERE txn_id = ? LIMIT 1', [id]);
    if (imports.length) refs.push('Cloudflare 账单导入');
    const [payments] = await pool.query<Row[]>(
      'SELECT id FROM payment_imports WHERE txn_id = ? OR fee_txn_id = ? LIMIT 1',
      [id, id]
    );
    if (payments.length) refs.push('支付渠道导入');
    if (refs.length) {
      reply.code(409);
      return fail(409, `该流水由【${refs.join(' / ')}】生成，请先在对应模块删除，避免产生悬空引用`);
    }
    await pool.query('DELETE FROM transactions WHERE id = ?', [id]);
    return ok({ id });
  });

  // 凭证附件：返回该流水的附件列表 + 实时预签名下载 URL
  app.get('/:id/attachments', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const [rows] = await pool.query<Row[]>(
      `SELECT id, file_name AS fileName, url AS objectKey, size_bytes AS sizeBytes, created_at AS createdAt
         FROM attachments WHERE txn_id = ? ORDER BY id`,
      [id]
    );
    const items = await Promise.all(
      rows.map(async (r) => {
        let downloadUrl: string | null = null;
        if (r.objectKey && r2Enabled()) {
          try {
            downloadUrl = await signedUrl(String(r.objectKey));
          } catch {
            downloadUrl = null;
          }
        }
        return { ...r, downloadUrl };
      })
    );
    return ok({ items });
  });

  // 手动补传凭证：原始 PDF 二进制上传 R2 并挂到该流水（用于给已存在的流水补发票）
  app.post('/:id/attachments', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const pdf = req.body;
    if (!Buffer.isBuffer(pdf) || pdf.length < 5 || pdf.subarray(0, 5).toString() !== '%PDF-') {
      reply.code(400);
      return fail(400, '上传文件不是有效的 PDF');
    }
    if (pdf.length > 10 * 1024 * 1024) {
      reply.code(413);
      return fail(413, 'PDF 大小不能超过 10 MB');
    }
    if (!r2Enabled()) {
      reply.code(503);
      return fail(503, '未配置 R2，无法留存凭证');
    }
    const [txn] = await pool.query<Row[]>('SELECT id FROM transactions WHERE id = ?', [id]);
    if (!txn.length) {
      reply.code(404);
      return fail(404, '流水不存在');
    }

    const rawName = String((req.query as Record<string, string>).fileName ?? `voucher-${id}.pdf`);
    const base =
      rawName.replace(/\.[pP][dD][fF]$/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) ||
      'voucher';
    const objectKey = `attachments/${id}/${Date.now()}-${base}.pdf`;
    await putInvoice(objectKey, pdf);
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO attachments (txn_id, file_name, url, size_bytes) VALUES (?,?,?,?)`,
      [id, rawName, objectKey, pdf.length]
    );
    reply.code(201);
    return ok({ id: res.insertId, fileName: rawName, objectKey, sizeBytes: pdf.length });
  });
}
