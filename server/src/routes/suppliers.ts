import type { FastifyInstance } from 'fastify';
import type { ResultSetHeader } from 'mysql2';
import { pool, type Row } from '../db';
import { ok, fail } from '../http';

const KINDS = ['vendor', 'customer', 'both'];
const REGIONS = ['cn', 'global'];

const SELECT = `
  SELECT id, name_cn AS nameCn, name_en AS nameEn, kind, region,
         website, contact, note, sort_order AS sortOrder, status
    FROM suppliers
`;

/** 把 supplier_categories 的关联科目合并进供应商行。 */
async function attachCategories(rows: Row[]): Promise<Row[]> {
  if (!rows.length) return rows;
  const ids = rows.map((r) => Number(r.id));
  const ph = ids.map(() => '?').join(',');
  const [links] = await pool.query<Row[]>(
    `SELECT supplier_id AS supplierId, category_id AS categoryId
       FROM supplier_categories WHERE supplier_id IN (${ph}) ORDER BY category_id`,
    ids
  );
  const map = new Map<number, number[]>();
  for (const l of links) {
    const sid = Number(l.supplierId);
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid)!.push(Number(l.categoryId));
  }
  return rows.map((r) => ({ ...r, categoryIds: map.get(Number(r.id)) ?? [] }));
}

/** 校验传入的科目 id 均存在且启用，返回去重后的列表。 */
async function validCategoryIds(input: unknown): Promise<number[]> {
  if (!Array.isArray(input)) return [];
  const ids = [...new Set(input.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const [rows] = await pool.query<Row[]>(
    `SELECT id FROM categories WHERE id IN (${ph}) AND status = 1`,
    ids
  );
  return rows.map((r) => Number(r.id));
}

async function replaceCategories(supplierId: number, categoryIds: number[]): Promise<void> {
  await pool.query('DELETE FROM supplier_categories WHERE supplier_id = ?', [supplierId]);
  if (!categoryIds.length) return;
  const values = categoryIds.map(() => '(?,?)').join(',');
  const params = categoryIds.flatMap((cid) => [supplierId, cid]);
  await pool.query(`INSERT INTO supplier_categories (supplier_id, category_id) VALUES ${values}`, params);
}

export default async function (app: FastifyInstance) {
  // 列表：模糊筛选（名称/联系人/备注）+ 按科目 + 角色（供应商/客户）+ 地域。
  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = [];
    const params: unknown[] = [];

    if (q.all !== '1' && q.all !== 'true') where.push('s.status = 1');
    if (q.region && REGIONS.includes(q.region)) {
      where.push('s.region = ?');
      params.push(q.region);
    }
    if (q.role === 'vendor' || q.role === 'customer') {
      where.push("(s.kind = ? OR s.kind = 'both')");
      params.push(q.role);
    } else if (q.kind && KINDS.includes(q.kind)) {
      where.push('s.kind = ?');
      params.push(q.kind);
    }
    if (q.q) {
      where.push('(s.name_cn LIKE ? OR s.name_en LIKE ? OR s.contact LIKE ? OR s.note LIKE ?)');
      const like = `%${q.q}%`;
      params.push(like, like, like, like);
    }
    // 按科目：命中该科目本身或（当传入子科目时）其父领域下的供应商。
    const categoryId = Number(q.categoryId);
    if (Number.isFinite(categoryId) && categoryId > 0) {
      where.push(`EXISTS (
        SELECT 1 FROM supplier_categories sc
         WHERE sc.supplier_id = s.id
           AND sc.category_id IN (?, COALESCE((SELECT parent_id FROM categories WHERE id = ?), 0))
      )`);
      params.push(categoryId, categoryId);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 200));

    const [rows] = await pool.query<Row[]>(
      `SELECT s.id, s.name_cn AS nameCn, s.name_en AS nameEn, s.kind, s.region,
              s.website, s.contact, s.note, s.sort_order AS sortOrder, s.status
         FROM suppliers s
         ${whereSql}
        ORDER BY s.sort_order, s.name_en
        LIMIT ?`,
      [...params, limit]
    );
    return ok({ items: await attachCategories(rows) });
  });

  // 新增
  app.post('/', async (req, reply) => {
    const b = req.body as Record<string, any>;
    const nameCn = String(b.nameCn ?? '').trim();
    const nameEn = String(b.nameEn ?? '').trim();
    if (!nameCn || !nameEn) {
      reply.code(400);
      return fail(400, '供应商中英文名称不能为空');
    }
    const kind = b.kind ?? 'vendor';
    if (!KINDS.includes(kind)) {
      reply.code(400);
      return fail(400, `kind 必须为 ${KINDS.join(' / ')}`);
    }
    const region = b.region ?? 'global';
    if (!REGIONS.includes(region)) {
      reply.code(400);
      return fail(400, `region 必须为 ${REGIONS.join(' / ')}`);
    }
    const categoryIds = await validCategoryIds(b.categoryIds);

    let insertId: number;
    try {
      const [res] = await pool.query<ResultSetHeader>(
        `INSERT INTO suppliers (name_cn, name_en, kind, region, website, contact, note, sort_order, status)
         VALUES (?,?,?,?,?,?,?,?,1)`,
        [
          nameCn, nameEn, kind, region,
          b.website ? String(b.website).trim() : null,
          b.contact ? String(b.contact).trim() : null,
          b.note ? String(b.note).trim() : null,
          Number(b.sortOrder ?? 0) || 0,
        ]
      );
      insertId = res.insertId;
    } catch (e) {
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') {
        reply.code(409);
        return fail(409, `供应商「${nameCn}」已存在`);
      }
      throw e;
    }
    await replaceCategories(insertId, categoryIds);
    const [rows] = await pool.query<Row[]>(`${SELECT} WHERE id = ?`, [insertId]);
    reply.code(201);
    return ok((await attachCategories(rows))[0]);
  });

  // 更新
  app.patch('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as Record<string, any>;
    const [cur] = await pool.query<Row[]>('SELECT id FROM suppliers WHERE id = ?', [id]);
    if (!cur.length) {
      reply.code(404);
      return fail(404, '供应商不存在');
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    const map: Record<string, string> = {
      nameCn: 'name_cn', nameEn: 'name_en', kind: 'kind', region: 'region',
      website: 'website', contact: 'contact', note: 'note', sortOrder: 'sort_order', status: 'status',
    };
    for (const [key, col] of Object.entries(map)) {
      if (b[key] === undefined) continue;
      if (key === 'kind' && !KINDS.includes(String(b[key]))) {
        reply.code(400);
        return fail(400, `kind 必须为 ${KINDS.join(' / ')}`);
      }
      if (key === 'region' && !REGIONS.includes(String(b[key]))) {
        reply.code(400);
        return fail(400, `region 必须为 ${REGIONS.join(' / ')}`);
      }
      if ((key === 'nameCn' || key === 'nameEn') && !String(b[key]).trim()) {
        reply.code(400);
        return fail(400, '供应商中英文名称不能为空');
      }
      const v =
        (key === 'nameCn' || key === 'nameEn' || key === 'website' || key === 'contact' || key === 'note') &&
        b[key] !== null
          ? String(b[key]).trim()
          : b[key];
      fields.push(`${col} = ?`);
      params.push(v === '' ? null : v);
    }

    if (fields.length) {
      params.push(id);
      try {
        await pool.query(`UPDATE suppliers SET ${fields.join(', ')} WHERE id = ?`, params);
      } catch (e) {
        if ((e as { code?: string }).code === 'ER_DUP_ENTRY') {
          reply.code(409);
          return fail(409, '该供应商名称已存在');
        }
        throw e;
      }
    }
    if (b.categoryIds !== undefined) {
      await replaceCategories(id, await validCategoryIds(b.categoryIds));
    }

    const [rows] = await pool.query<Row[]>(`${SELECT} WHERE id = ?`, [id]);
    return ok((await attachCategories(rows))[0]);
  });

  // 停用（软删除）：保留历史流水中已写入的对手方名称。
  app.delete('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [res] = await pool.query<ResultSetHeader>(
      'UPDATE suppliers SET status = 0 WHERE id = ?',
      [id]
    );
    if (!res.affectedRows) {
      reply.code(404);
      return fail(404, '供应商不存在');
    }
    return ok({ id });
  });
}
