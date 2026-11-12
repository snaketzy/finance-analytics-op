import type { FastifyInstance } from 'fastify';
import type { ResultSetHeader } from 'mysql2';
import { pool, type Row } from '../db';
import { ok, fail } from '../http';

const ACCOUNT_TYPES = ['cash', 'bank', 'platform', 'credit', 'virtual'];

const SELECT = `
  SELECT id, name_cn AS nameCn, name_en AS nameEn, type, currency,
         opening_balance_cny AS openingBalanceCny, sort_order AS sortOrder, status
    FROM accounts
`;

export default async function (app: FastifyInstance) {
  // 列表：默认仅启用账户；?all=1 含已停用。
  app.get('/', async (req) => {
    const all = (req.query as { all?: string }).all;
    const where = all === '1' || all === 'true' ? '' : 'WHERE status = 1';
    const [rows] = await pool.query<Row[]>(`${SELECT} ${where} ORDER BY sort_order, id`);
    return ok(rows);
  });

  // 新增
  app.post('/', async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    const nameCn = String(b.nameCn ?? '').trim();
    const nameEn = String(b.nameEn ?? '').trim();
    if (!nameCn || !nameEn) {
      reply.code(400);
      return fail(400, '账户中英文名称不能为空');
    }
    const type = String(b.type ?? 'cash');
    if (!ACCOUNT_TYPES.includes(type)) {
      reply.code(400);
      return fail(400, `账户类型必须为 ${ACCOUNT_TYPES.join(' / ')}`);
    }
    const currency = String(b.currency ?? 'CNY').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      reply.code(400);
      return fail(400, '币种必须为 3 位字母代码');
    }
    const openingBalanceCny = Number(b.openingBalanceCny ?? 0) || 0;
    const sortOrder = Number(b.sortOrder ?? 0) || 0;

    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO accounts (name_cn, name_en, type, currency, opening_balance_cny, sort_order, status)
       VALUES (?,?,?,?,?,?,1)`,
      [nameCn, nameEn, type, currency, openingBalanceCny, sortOrder]
    );
    const [rows] = await pool.query<Row[]>(`${SELECT} WHERE id = ?`, [res.insertId]);
    reply.code(201);
    return ok(rows[0]);
  });

  // 更新
  app.patch('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as Record<string, unknown>;
    const fields: string[] = [];
    const params: unknown[] = [];

    const map: Record<string, string> = {
      nameCn: 'name_cn',
      nameEn: 'name_en',
      type: 'type',
      currency: 'currency',
      openingBalanceCny: 'opening_balance_cny',
      sortOrder: 'sort_order',
      status: 'status',
    };
    for (const [key, column] of Object.entries(map)) {
      if (b[key] === undefined) continue;
      if (key === 'type' && !ACCOUNT_TYPES.includes(String(b[key]))) {
        reply.code(400);
        return fail(400, `账户类型必须为 ${ACCOUNT_TYPES.join(' / ')}`);
      }
      if (key === 'currency' && !/^[A-Za-z]{3}$/.test(String(b[key]))) {
        reply.code(400);
        return fail(400, '币种必须为 3 位字母代码');
      }
      fields.push(`${column} = ?`);
      params.push(key === 'currency' ? String(b[key]).toUpperCase() : b[key]);
    }
    if (!fields.length) {
      reply.code(400);
      return fail(400, '没有可更新的字段');
    }
    params.push(id);
    const [res] = await pool.query<ResultSetHeader>(
      `UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`,
      params
    );
    if (!res.affectedRows) {
      reply.code(404);
      return fail(404, '账户不存在');
    }
    const [rows] = await pool.query<Row[]>(`${SELECT} WHERE id = ?`, [id]);
    return ok(rows[0]);
  });

  // 停用（软删除）：保留流水与分析中的账户引用。
  app.delete('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [res] = await pool.query<ResultSetHeader>('UPDATE accounts SET status = 0 WHERE id = ?', [id]);
    if (!res.affectedRows) {
      reply.code(404);
      return fail(404, '账户不存在');
    }
    return ok({ id });
  });
}
