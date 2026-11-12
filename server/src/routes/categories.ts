import type { FastifyInstance } from 'fastify';
import type { ResultSetHeader } from 'mysql2';
import { pool, type Row } from '../db';
import { ok, fail } from '../http';

/** 收入/支出领域 key（与前端 lib/domains.ts 保持一致）。 */
const INCOME_DOMAINS = [
  'subscription', 'transactional', 'advertising', 'licensing', 'valueadd',
  'sponsorship', 'incentive', 'financial', 'other',
];
const EXPENSE_DOMAINS = [
  'infra', 'compute', 'content', 'people', 'marketing', 'channel', 'ops', 'other',
];

function domainsFor(type: string): string[] {
  return type === 'income' ? INCOME_DOMAINS : EXPENSE_DOMAINS;
}

const BASE_SELECT = `
  SELECT id, parent_id AS parentId, name_cn AS nameCn, name_en AS nameEn,
         type, domain, is_recurring AS isRecurring, is_cogs AS isCogs,
         sort_order AS sortOrder
    FROM categories
`;

/**
 * 生成下一个科目 id（沿用既有层级编号约定，id 列无 AUTO_INCREMENT）：
 * - 子科目占用 `父级 id * 100 + 序号`（如 201 → 20101、20102…）
 * - 顶层领域：收入 `1xx`、支出 `2xx`（如 109 之后为 110）
 */
async function nextCategoryId(parentId: number | null, type: string): Promise<number> {
  if (parentId !== null) {
    const base = parentId * 100;
    const [rows] = await pool.query<Row[]>(
      'SELECT COALESCE(MAX(id), ?) AS mx FROM categories WHERE parent_id = ?',
      [base, parentId]
    );
    return Number(rows[0]?.mx ?? base) + 1;
  }
  const base = type === 'income' ? 100 : 200;
  const [rows] = await pool.query<Row[]>(
    'SELECT COALESCE(MAX(id), ?) AS mx FROM categories WHERE parent_id IS NULL AND type = ?',
    [base, type]
  );
  return Number(rows[0]?.mx ?? base) + 1;
}

export default async function (app: FastifyInstance) {
  // 列表：仅返回启用中的科目
  app.get('/', async (req) => {
    const q = req.query as { type?: string };
    const params: unknown[] = [];
    let sql = `SELECT id, parent_id AS parentId, name_cn AS nameCn, name_en AS nameEn,
                      type, domain, is_recurring AS isRecurring, is_cogs AS isCogs,
                      sort_order AS sortOrder
                 FROM categories
                WHERE status = 1`;
    if (q.type) {
      sql += ' AND type = ?';
      params.push(q.type);
    }
    sql += ' ORDER BY type, sort_order, id';
    const [rows] = await pool.query<Row[]>(sql, params);
    return ok(rows);
  });

  // 新增：不传 parentId 创建顶层「领域」节点，传则在其下建子科目
  app.post('/', async (req, reply) => {
    const b = req.body as Record<string, any>;
    const nameCn = String(b.nameCn ?? '').trim();
    const nameEn = String(b.nameEn ?? '').trim();
    const type = b.type;
    if (!nameCn || !nameEn) {
      reply.code(400);
      return fail(400, '缺少中英文科目名');
    }
    if (type !== 'income' && type !== 'expense') {
      reply.code(400);
      return fail(400, 'type 必须为 income 或 expense');
    }

    let parentId: number | null = null;
    let domain = String(b.domain ?? '').trim();
    if (b.parentId !== undefined && b.parentId !== null && b.parentId !== '') {
      parentId = Number(b.parentId);
      const [p] = await pool.query<Row[]>(
        'SELECT id, type, domain FROM categories WHERE id = ? AND status = 1',
        [parentId]
      );
      if (!p.length) {
        reply.code(400);
        return fail(400, '上级科目不存在');
      }
      if (p[0].type !== type) {
        reply.code(400);
        return fail(400, '子科目的收支类型必须与上级一致');
      }
      domain = String(p[0].domain); // 子科目领域跟随父级
    } else if (!domainsFor(type).includes(domain)) {
      reply.code(400);
      return fail(400, '领域 domain 无效');
    }

    const isRecurring = b.isRecurring ? 1 : 0;
    const isCogs = b.isCogs ? 1 : 0;
    let sortOrder = b.sortOrder !== undefined && b.sortOrder !== '' ? Number(b.sortOrder) : null;
    if (sortOrder === null || !Number.isFinite(sortOrder)) {
      const [mx] = await pool.query<Row[]>(
        parentId === null
          ? 'SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM categories WHERE type = ? AND parent_id IS NULL'
          : 'SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM categories WHERE parent_id = ?',
        parentId === null ? [type] : [parentId]
      );
      sortOrder = Number(mx[0]?.next ?? 1);
    }

    const newId = await nextCategoryId(parentId, type);
    await pool.query<ResultSetHeader>(
      `INSERT INTO categories
         (id, parent_id, name_cn, name_en, type, domain, is_recurring, is_cogs, sort_order, status)
       VALUES (?,?,?,?,?,?,?,?,?,1)`,
      [newId, parentId, nameCn, nameEn, type, domain, isRecurring, isCogs, sortOrder]
    );
    const [rows] = await pool.query<Row[]>(`${BASE_SELECT} WHERE id = ?`, [newId]);
    reply.code(201);
    return ok(rows[0]);
  });

  // 更新：中英文名 / 周期标记 / COGS 标记 / 排序；顶层节点可改领域
  app.patch('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as Record<string, any>;

    const [cur] = await pool.query<Row[]>(
      'SELECT id, parent_id AS parentId, type, domain FROM categories WHERE id = ?',
      [id]
    );
    if (!cur.length) {
      reply.code(404);
      return fail(404, '科目不存在');
    }
    const row = cur[0];
    const fields: string[] = [];
    const params: unknown[] = [];

    if (b.nameCn !== undefined) {
      const v = String(b.nameCn).trim();
      if (!v) { reply.code(400); return fail(400, '科目中文名不能为空'); }
      fields.push('name_cn = ?');
      params.push(v);
    }
    if (b.nameEn !== undefined) {
      const v = String(b.nameEn).trim();
      if (!v) { reply.code(400); return fail(400, '科目英文名不能为空'); }
      fields.push('name_en = ?');
      params.push(v);
    }
    if (b.isRecurring !== undefined) { fields.push('is_recurring = ?'); params.push(b.isRecurring ? 1 : 0); }
    if (b.isCogs !== undefined) { fields.push('is_cogs = ?'); params.push(b.isCogs ? 1 : 0); }
    if (b.sortOrder !== undefined && b.sortOrder !== '') {
      const n = Number(b.sortOrder);
      if (!Number.isFinite(n)) { reply.code(400); return fail(400, '排序值无效'); }
      fields.push('sort_order = ?');
      params.push(n);
    }

    // 仅顶层「领域」节点可修改 domain；子科目领域始终跟随父级
    let domainChanged = false;
    if (b.domain !== undefined && row.parentId === null) {
      const dom = String(b.domain).trim();
      if (!domainsFor(String(row.type)).includes(dom)) {
        reply.code(400);
        return fail(400, '领域 domain 无效');
      }
      if (dom !== String(row.domain)) {
        fields.push('domain = ?');
        params.push(dom);
        domainChanged = true;
      }
    }

    if (!fields.length) {
      reply.code(400);
      return fail(400, '没有可更新的字段');
    }
    params.push(id);
    await pool.query(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, params);

    // 顶层领域变更时，子科目领域同步跟随
    if (domainChanged) {
      await pool.query('UPDATE categories SET domain = ? WHERE parent_id = ?', [
        String(b.domain).trim(), id,
      ]);
    }

    const [rows] = await pool.query<Row[]>(`${BASE_SELECT} WHERE id = ?`, [id]);
    return ok(rows[0]);
  });

  // 删除：软删（status=0）；顶层节点连同其子科目一并停用；存在关联数据时拒绝
  app.delete('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [cur] = await pool.query<Row[]>(
      'SELECT id, parent_id AS parentId FROM categories WHERE id = ? AND status = 1',
      [id]
    );
    if (!cur.length) {
      reply.code(404);
      return fail(404, '科目不存在');
    }
    const ids: number[] = [id];
    if (cur[0].parentId === null) {
      const [kids] = await pool.query<Row[]>(
        'SELECT id FROM categories WHERE parent_id = ? AND status = 1',
        [id]
      );
      ids.push(...kids.map((k) => Number(k.id)));
    }
    const ph = ids.map(() => '?').join(',');

    const [refs] = await pool.query<Row[]>(
      `SELECT
         (SELECT COUNT(*) FROM transactions           WHERE category_id IN (${ph})) AS txn,
         (SELECT COUNT(*) FROM recurring_costs        WHERE category_id IN (${ph})) AS rec,
         (SELECT COUNT(*) FROM budgets                WHERE category_id IN (${ph})) AS bud,
         (SELECT COUNT(*) FROM usage_records          WHERE category_id IN (${ph})) AS usg,
         (SELECT COUNT(*) FROM cloudflare_cost_imports WHERE category_id IN (${ph})) AS cf`,
      [...ids, ...ids, ...ids, ...ids, ...ids]
    );
    const r = refs[0] ?? {};
    const used =
      Number(r.txn ?? 0) + Number(r.rec ?? 0) + Number(r.bud ?? 0) +
      Number(r.usg ?? 0) + Number(r.cf ?? 0);
    if (used > 0) {
      reply.code(409);
      return fail(
        409,
        `该科目存在关联数据（流水 ${r.txn} / 周期成本 ${r.rec} / 预算 ${r.bud} / 计量 ${r.usg} / 账单导入 ${r.cf}），不能删除`
      );
    }

    await pool.query(`UPDATE categories SET status = 0 WHERE id IN (${ph})`, ids);
    return ok({ id });
  });
}
