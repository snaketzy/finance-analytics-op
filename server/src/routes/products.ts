import type { FastifyInstance } from 'fastify';
import type { ResultSetHeader } from 'mysql2';
import { pool, type Row } from '../db';
import { ok, fail } from '../http';
import {
  loadActiveAllocations,
  loadAllocations,
  loadProductActuals,
  loadProductCompositions,
  loadProjectActiveAllocations,
  applyAllocationVersion,
  loadProjectShares,
} from '../lib/allocation';

const KINDS = ['frontend', 'backend', 'platform', 'other'];
const STATUSES = ['active', 'paused', 'archived'];

const todayISO = () => {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
};

/** 均摊比例：N 份等分，末位吸收舍入余量，保证合计恰为 1。 */
function equalShares(ids: number[]): { productId: number; ratio: number }[] {
  const n = ids.length;
  if (n === 0) return [];
  const base = Number((1 / n).toFixed(6));
  const items = ids.map((id) => ({ productId: id, ratio: base }));
  const diff = Number((1 - base * n).toFixed(6));
  items[n - 1].ratio = Number((base + diff).toFixed(6));
  return items;
}

const PRODUCT_COLS = `id, code, name_cn AS nameCn, name_en AS nameEn, kind, status,
  launch_date AS launchDate, sort_order AS sortOrder, note`;

export default async function (app: FastifyInstance) {
  // 产品列表（含成员项目数与近 3 个月分摊后月均收支）
  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where = q.status ? 'WHERE status = ?' : "WHERE status <> 'archived'";
    const params = q.status ? [q.status] : [];
    const [rows] = await pool.query<Row[]>(
      `SELECT ${PRODUCT_COLS} FROM products ${where} ORDER BY sort_order, id`,
      params
    );
    const items = await Promise.all(
      rows.map(async (p) => {
        const [cnt] = await pool.query<Row[]>(
          'SELECT COUNT(*) AS n FROM product_projects WHERE product_id = ? AND effective_to IS NULL',
          [p.id]
        );
        const actuals = await loadProductActuals(Number(p.id), 3);
        return { ...p, projectCount: Number(cnt[0].n), actuals };
      })
    );
    return ok({ items });
  });

  // 产品详情：基本信息 + 当前/历史分摊 + 组成项目下钻
  app.get('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [rows] = await pool.query<Row[]>(`SELECT ${PRODUCT_COLS} FROM products WHERE id = ?`, [id]);
    if (!rows.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const active = await loadActiveAllocations(id);
    const history = await loadAllocations(id);
    const [projects] = active.length
      ? await pool.query<Row[]>(
          'SELECT id, code, name_cn AS nameCn, name_en AS nameEn, status FROM projects WHERE id IN (?)',
          [active.map((a) => a.projectId)]
        )
      : [[] as Row[]];
    const projMeta = new Map(projects.map((p) => [Number(p.id), p]));

    const allocations = active.map((a) => {
      const m = projMeta.get(a.projectId);
      return {
        ...a,
        project: m
          ? { id: a.projectId, code: m.code, nameCn: m.nameCn, nameEn: m.nameEn, status: m.status }
          : null,
        // 该项目当前各产品的分摊合计（应恒为 1）
        projectRatioSum: 0,
      };
    });
    await Promise.all(
      allocations.map(async (a) => {
        const peers = await loadProjectActiveAllocations(a.projectId);
        a.projectRatioSum = Number(peers.reduce((s, p) => s + p.ratio, 0).toFixed(6));
      })
    );

    const [compositions, actuals] = await Promise.all([
      loadProductCompositions(id, 3),
      loadProductActuals(id, 3),
    ]);

    return ok({ product: rows[0], allocations, history, compositions, actuals });
  });

  // 新增产品
  app.post('/', async (req, reply) => {
    const b = req.body as Record<string, any>;
    const code = String(b.code ?? '').trim();
    const nameCn = String(b.nameCn ?? '').trim();
    const nameEn = String(b.nameEn ?? '').trim();
    if (!code || !nameCn || !nameEn) {
      reply.code(400);
      return fail(400, '产品 code 与中英文名称不能为空');
    }
    const kind = b.kind ?? 'other';
    if (!KINDS.includes(kind)) {
      reply.code(400);
      return fail(400, `kind 必须为 ${KINDS.join(' / ')}`);
    }
    const status = b.status ?? 'active';
    if (!STATUSES.includes(status)) {
      reply.code(400);
      return fail(400, `status 必须为 ${STATUSES.join(' / ')}`);
    }
    let insertId: number;
    try {
      const [res] = await pool.query<ResultSetHeader>(
        `INSERT INTO products (code, name_cn, name_en, kind, status, launch_date, sort_order, note)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          code,
          nameCn,
          nameEn,
          kind,
          status,
          b.launchDate || null,
          Number(b.sortOrder ?? 0) || 0,
          b.note ? String(b.note).trim() : null,
        ]
      );
      insertId = res.insertId;
    } catch (e) {
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') {
        reply.code(409);
        return fail(409, `产品 code「${code}」已存在`);
      }
      throw e;
    }
    const [rows] = await pool.query<Row[]>(`SELECT ${PRODUCT_COLS} FROM products WHERE id = ?`, [insertId]);
    reply.code(201);
    return ok(rows[0]);
  });

  // 更新产品基本信息
  app.put('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as Record<string, any>;
    const [cur] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [id]);
    if (!cur.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    const map: Record<string, string> = {
      code: 'code',
      nameCn: 'name_cn',
      nameEn: 'name_en',
      kind: 'kind',
      status: 'status',
      launchDate: 'launch_date',
      sortOrder: 'sort_order',
      note: 'note',
    };
    for (const [key, col] of Object.entries(map)) {
      if (b[key] === undefined) continue;
      if (key === 'kind' && !KINDS.includes(String(b[key]))) {
        reply.code(400);
        return fail(400, `kind 必须为 ${KINDS.join(' / ')}`);
      }
      if (key === 'status' && !STATUSES.includes(String(b[key]))) {
        reply.code(400);
        return fail(400, `status 必须为 ${STATUSES.join(' / ')}`);
      }
      if ((key === 'code' || key === 'nameCn' || key === 'nameEn') && !String(b[key]).trim()) {
        reply.code(400);
        return fail(400, '产品 code 与中英文名称不能为空');
      }
      const isText = key === 'code' || key === 'nameCn' || key === 'nameEn' || key === 'note';
      const v = isText && b[key] !== null ? String(b[key]).trim() : b[key];
      fields.push(`${col} = ?`);
      params.push(v === '' ? null : v);
    }
    if (fields.length) {
      params.push(id);
      try {
        await pool.query(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, params);
      } catch (e) {
        if ((e as { code?: string }).code === 'ER_DUP_ENTRY') {
          reply.code(409);
          return fail(409, '该产品 code 已存在');
        }
        throw e;
      }
    }
    const [rows] = await pool.query<Row[]>(`SELECT ${PRODUCT_COLS} FROM products WHERE id = ?`, [id]);
    return ok(rows[0]);
  });

  // 删除产品：其成员项目的分摊按「剩余产品均摊」重新平衡，历史版本保留
  app.delete('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [cur] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [id]);
    if (!cur.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const today = todayISO();
    const active = await loadActiveAllocations(id);
    for (const a of active) {
      const peers = await loadProjectActiveAllocations(a.projectId);
      const remaining = peers.filter((p) => p.productId !== id).map((p) => p.productId);
      await applyAllocationVersion(a.projectId, equalShares(remaining), today);
    }
    await pool.query('DELETE FROM products WHERE id = ?', [id]);
    return ok({ id });
  });

  // 给产品新增成员项目（该项目在全部引用产品间默认均摊）
  app.post('/:id/projects', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as Record<string, any>;
    const projectId = Number(b.projectId);
    if (!Number.isFinite(projectId)) {
      reply.code(400);
      return fail(400, 'projectId 必填');
    }
    const effectiveFrom = String(b.effectiveFrom || todayISO());
    const [p] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [id]);
    if (!p.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const [pj] = await pool.query<Row[]>('SELECT id FROM projects WHERE id = ?', [projectId]);
    if (!pj.length) {
      reply.code(404);
      return fail(404, '项目不存在');
    }
    const peers = await loadProjectActiveAllocations(projectId);
    const ids = Array.from(new Set([...peers.map((x) => x.productId), id]));
    await applyAllocationVersion(projectId, equalShares(ids), effectiveFrom);
    return ok({ productId: id, projectId, effectiveFrom });
  });

  // 从产品移除成员项目（该项目在剩余产品间默认均摊重新平衡）
  app.delete('/:id/projects/:projectId', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const projectId = Number((req.params as { projectId: string }).projectId);
    const b = (req.body ?? {}) as Record<string, any>;
    const effectiveTo = String(b.effectiveTo || todayISO());
    const [p] = await pool.query<Row[]>('SELECT id FROM products WHERE id = ?', [id]);
    if (!p.length) {
      reply.code(404);
      return fail(404, '产品不存在');
    }
    const peers = await loadProjectActiveAllocations(projectId);
    if (!peers.some((x) => x.productId === id)) {
      reply.code(404);
      return fail(404, '该产品未引用此项目');
    }
    const remaining = peers.filter((x) => x.productId !== id).map((x) => x.productId);
    await applyAllocationVersion(projectId, equalShares(remaining), effectiveTo);
    return ok({ productId: id, projectId, effectiveTo });
  });

  // 调整某项目在各产品间的分摊比例（合计必须 = 100%，版本化生效）
  app.put('/projects/:projectId/allocations', async (req, reply) => {
    const projectId = Number((req.params as { projectId: string }).projectId);
    const b = req.body as Record<string, any>;
    const effectiveFrom = String(b.effectiveFrom || todayISO());
    const rawItems = Array.isArray(b.items) ? b.items : [];
    if (!rawItems.length) {
      reply.code(400);
      return fail(400, 'items 不能为空');
    }
    const items: { productId: number; ratio: number }[] = [];
    for (const it of rawItems) {
      const pid = Number(it?.productId);
      const ratio = Number(it?.ratio);
      if (!Number.isFinite(pid) || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
        reply.code(400);
        return fail(400, '每项须含合法 productId 与 0-1 的 ratio');
      }
      items.push({ productId: pid, ratio: Number(ratio.toFixed(6)) });
    }
    const [pj] = await pool.query<Row[]>('SELECT id FROM projects WHERE id = ?', [projectId]);
    if (!pj.length) {
      reply.code(404);
      return fail(404, '项目不存在');
    }
    const [prodRows] = await pool.query<Row[]>(
      'SELECT id FROM products WHERE id IN (?)',
      [items.map((i) => i.productId)]
    );
    if (prodRows.length !== new Set(items.map((i) => i.productId)).size) {
      reply.code(400);
      return fail(400, '存在无效的产品 ID');
    }
    const sum = Number(items.reduce((s, i) => s + i.ratio, 0).toFixed(6));
    if (Math.abs(sum - 1) > 0.000001) {
      reply.code(400);
      return fail(400, `各产品分摊比例合计须为 100%，当前为 ${(sum * 100).toFixed(4)}%`);
    }
    await applyAllocationVersion(projectId, items, effectiveFrom);
    return ok({ projectId, effectiveFrom, items });
  });

  // 项目视角（预留入口）：某项目在各引用产品间的收支比重
  app.get('/projects/:projectId/shares', async (req, reply) => {
    const projectId = Number((req.params as { projectId: string }).projectId);
    const q = req.query as Record<string, string | undefined>;
    const lookback = Number(q.lookback ?? 3) || 3;
    const [rows] = await pool.query<Row[]>(
      'SELECT id, code, name_cn AS nameCn, name_en AS nameEn FROM projects WHERE id = ?',
      [projectId]
    );
    if (!rows.length) {
      reply.code(404);
      return fail(404, '项目不存在');
    }
    const shares = await loadProjectShares(projectId, lookback);
    return ok({ project: rows[0], lookback, shares });
  });
}
