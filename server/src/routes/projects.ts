import type { FastifyInstance } from 'fastify';
import type { ResultSetHeader } from 'mysql2';
import { pool, type Row } from '../db';
import { ok, fail } from '../http';
import { loadProjectShares } from '../lib/allocation';
import { parseRepoUrl, GitHubError } from '../lib/github';
import { latestSnapshot, snapshotHistory, syncProjectRepo, SNAPSHOT_COLS } from '../lib/repoSync';

const STATUSES = ['active', 'paused', 'archived'];

const PROJECT_COLS = `p.id, p.code, p.name_cn AS nameCn, p.name_en AS nameEn, p.status,
  p.launch_date AS launchDate, p.sort_order AS sortOrder, p.repo_url AS repoUrl,
  p.hours_per_commit AS hoursPerCommit, p.note`;

/** 引用该项目的业务表（用于删除前校验，避免历史数据失去归属）。 */
const REF_KEYS = [
  ['transactions', 'transactions', '流水'],
  ['budgets', 'budgets', '预算'],
  ['usages', 'usage_records', '用量记录'],
  ['cloudflareImports', 'cloudflare_cost_imports', 'Cloudflare 账单'],
  ['paymentImports', 'payment_imports', '支付导入'],
] as const;

type RefCounts = Record<string, number>;

/** 各引用类型的明细列表 SQL（供「引用统计」下钻查看）。 */
const REF_LIST_QUERIES: Record<string, string> = {
  transactions: `SELECT t.id, t.txn_date AS txnDate, t.direction,
      t.amount_cny AS amountCny, t.amount_usd AS amountUsd,
      c.name_cn AS categoryNameCn, c.name_en AS categoryNameEn,
      t.counterparty, t.note, t.ref_type AS refType, t.ref_id AS refId
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
   WHERE t.project_id = ?
   ORDER BY t.txn_date DESC, t.id DESC
   LIMIT 300`,
  budgets: `SELECT b.id, b.period, b.period_type AS periodType, b.amount_cny AS amountCny,
      c.name_cn AS categoryNameCn, c.name_en AS categoryNameEn
    FROM budgets b
    LEFT JOIN categories c ON c.id = b.category_id
   WHERE b.project_id = ?
   ORDER BY b.period DESC, b.id DESC
   LIMIT 300`,
  usages: `SELECT u.id, u.period, u.quantity, u.unit_label AS unitLabel,
      u.unit_price AS unitPrice, u.unit_price_ccy AS unitPriceCcy,
      u.amount_src AS amountSrc, u.amount_cny AS amountCny, u.source,
      u.billed_on AS billedOn, u.txn_id AS txnId,
      r.name_cn AS recurringNameCn, r.name_en AS recurringNameEn
    FROM usage_records u
    LEFT JOIN recurring_costs r ON r.id = u.recurring_id
   WHERE u.project_id = ?
   ORDER BY u.period DESC, u.id DESC
   LIMIT 300`,
  cloudflareImports: `SELECT id, billing_period AS billingPeriod, source_type AS sourceType,
      source_name AS sourceName, invoice_no AS invoiceNo, txn_date AS txnDate,
      currency, amount_src AS amountSrc, amount_cny AS amountCny, txn_id AS txnId
    FROM cloudflare_cost_imports
   WHERE project_id = ?
   ORDER BY billing_period DESC, id DESC
   LIMIT 300`,
  paymentImports: `SELECT id, source, billing_period AS billingPeriod, source_name AS sourceName,
      reference, counterparty, txn_date AS txnDate, currency,
      gross_src AS grossSrc, fee_src AS feeSrc, net_cny AS netCny,
      txn_id AS txnId, fee_txn_id AS feeTxnId
    FROM payment_imports
   WHERE project_id = ?
   ORDER BY billing_period DESC, id DESC
   LIMIT 300`,
  products: `SELECT pp.id, pp.ratio, pp.effective_from AS effectiveFrom, pp.effective_to AS effectiveTo,
      pr.id AS productId, pr.code, pr.name_cn AS nameCn, pr.name_en AS nameEn, pr.kind, pr.status
    FROM product_projects pp
    JOIN products pr ON pr.id = pp.product_id
   WHERE pp.project_id = ? AND pp.effective_to IS NULL
   ORDER BY pp.ratio DESC, pr.id
   LIMIT 300`,
};

async function loadRefs(projectId: number): Promise<RefCounts> {
  const selects = REF_KEYS.map(([key, table]) => `(SELECT COUNT(*) FROM ${table} WHERE project_id = ?) AS ${key}`);
  selects.push(
    `(SELECT COUNT(*) FROM product_projects WHERE project_id = ? AND effective_to IS NULL) AS products`
  );
  const [rows] = await pool.query<Row[]>(
    `SELECT ${selects.join(', ')}`,
    Array.from({ length: REF_KEYS.length + 1 }, () => projectId)
  );
  const r = rows[0] ?? {};
  const out: RefCounts = {};
  for (const [key] of REF_KEYS) out[key] = Number(r[key] ?? 0);
  out.products = Number(r.products ?? 0);
  return out;
}

/** 引用总数（用于删除校验与列表提示）。 */
const refTotal = (r: RefCounts) => Object.values(r).reduce((s, n) => s + n, 0);

const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** 把项目 id → 最后一次快照，一次性取回避免 N+1。 */
async function latestSnapshots(projectIds: number[]): Promise<Map<number, Row>> {
  const map = new Map<number, Row>();
  if (!projectIds.length) return map;
  const [rows] = await pool.query<Row[]>(
    `SELECT ${SNAPSHOT_COLS} FROM project_repo_snapshots
      WHERE project_id IN (?) ORDER BY captured_at DESC, id DESC`,
    [projectIds]
  );
  for (const r of rows) {
    const id = Number(r.projectId);
    if (!map.has(id)) map.set(id, r);
  }
  return map;
}

export default async function (app: FastifyInstance) {
  // 列表：含成员产品数与最近一次仓库快照
  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where = q.status ? 'WHERE p.status = ?' : '';
    const params = q.status && STATUSES.includes(q.status) ? [q.status] : [];
    const [rows] = await pool.query<Row[]>(
      `SELECT ${PROJECT_COLS},
              (SELECT COUNT(*) FROM product_projects pp
                WHERE pp.project_id = p.id AND pp.effective_to IS NULL) AS productCount
         FROM projects p ${where}
        ORDER BY p.sort_order, p.id`,
      params
    );
    const snaps = await latestSnapshots(rows.map((r) => Number(r.id)));
    const items = rows.map((r) => ({ ...r, latestSnapshot: snaps.get(Number(r.id)) ?? null }));
    return ok({ items });
  });

  // 详情：基本信息 + 引用统计 + 分摊产品 + 仓库快照（最新 + 历史）
  app.get('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [rows] = await pool.query<Row[]>(`SELECT ${PROJECT_COLS} FROM projects p WHERE p.id = ?`, [id]);
    if (!rows.length) {
      reply.code(404);
      return fail(404, '项目不存在');
    }
    const [references, productShares, latest, snapshots] = await Promise.all([
      loadRefs(id),
      loadProjectShares(id, 3),
      latestSnapshot(id),
      snapshotHistory(id, 20),
    ]);
    const project = {
      ...rows[0],
      productCount: references.products,
      latestSnapshot: latest,
    };
    return ok({ project, references, productShares, snapshots });
  });

  // 引用明细：按引用类型下钻，返回该项目的关联记录列表
  app.get('/:id/references/:key', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const key = (req.params as { key: string }).key;
    const sql = REF_LIST_QUERIES[key];
    if (!sql) {
      reply.code(400);
      return fail(400, `未知的引用类型：${key}`);
    }
    const [cur] = await pool.query<Row[]>('SELECT id FROM projects WHERE id = ?', [id]);
    if (!cur.length) {
      reply.code(404);
      return fail(404, '项目不存在');
    }
    const [rows] = await pool.query<Row[]>(sql, [id]);
    return ok({ key, items: rows, truncated: rows.length >= 300 });
  });

  // 新增项目
  app.post('/', async (req, reply) => {
    const b = req.body as Record<string, any>;
    const code = String(b.code ?? '').trim();
    const nameCn = String(b.nameCn ?? '').trim();
    const nameEn = String(b.nameEn ?? '').trim();
    if (!code || !nameCn || !nameEn) {
      reply.code(400);
      return fail(400, '项目 code 与中英文名称不能为空');
    }
    const status = b.status ?? 'active';
    if (!STATUSES.includes(status)) {
      reply.code(400);
      return fail(400, `status 必须为 ${STATUSES.join(' / ')}`);
    }
    const repoUrl = b.repoUrl ? String(b.repoUrl).trim() : '';
    if (repoUrl && !parseRepoUrl(repoUrl)) {
      reply.code(400);
      return fail(400, 'GitHub 仓库地址格式无效（示例：https://github.com/owner/repo）');
    }
    const hoursPerCommit = b.hoursPerCommit === undefined || b.hoursPerCommit === '' ? 4 : Number(b.hoursPerCommit);
    if (!Number.isFinite(hoursPerCommit) || hoursPerCommit < 0) {
      reply.code(400);
      return fail(400, '每提交工时系数须为不小于 0 的数字');
    }

    let insertId: number;
    try {
      const [res] = await pool.query<ResultSetHeader>(
        `INSERT INTO projects (code, name_cn, name_en, status, launch_date, sort_order, repo_url, hours_per_commit, note)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          code,
          nameCn,
          nameEn,
          status,
          b.launchDate || null,
          Number(b.sortOrder ?? 0) || 0,
          repoUrl || null,
          hoursPerCommit,
          b.note ? String(b.note).trim() : null,
        ]
      );
      insertId = res.insertId;
    } catch (e) {
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') {
        reply.code(409);
        return fail(409, `项目 code「${code}」已存在`);
      }
      throw e;
    }
    const [out] = await pool.query<Row[]>(`SELECT ${PROJECT_COLS} FROM projects p WHERE p.id = ?`, [insertId]);
    reply.code(201);
    return ok(out[0]);
  });

  // 更新项目
  app.put('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as Record<string, any>;
    const [cur] = await pool.query<Row[]>('SELECT id FROM projects WHERE id = ?', [id]);
    if (!cur.length) {
      reply.code(404);
      return fail(404, '项目不存在');
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    const map: Record<string, string> = {
      code: 'code',
      nameCn: 'name_cn',
      nameEn: 'name_en',
      status: 'status',
      launchDate: 'launch_date',
      sortOrder: 'sort_order',
      repoUrl: 'repo_url',
      hoursPerCommit: 'hours_per_commit',
      note: 'note',
    };
    for (const [key, col] of Object.entries(map)) {
      if (b[key] === undefined) continue;
      if (key === 'status' && !STATUSES.includes(String(b[key]))) {
        reply.code(400);
        return fail(400, `status 必须为 ${STATUSES.join(' / ')}`);
      }
      if ((key === 'code' || key === 'nameCn' || key === 'nameEn') && !String(b[key]).trim()) {
        reply.code(400);
        return fail(400, '项目 code 与中英文名称不能为空');
      }
      if (key === 'repoUrl') {
        const v = b[key] ? String(b[key]).trim() : '';
        if (v && !parseRepoUrl(v)) {
          reply.code(400);
          return fail(400, 'GitHub 仓库地址格式无效（示例：https://github.com/owner/repo）');
        }
        fields.push(`${col} = ?`);
        params.push(v || null);
        continue;
      }
      if (key === 'hoursPerCommit') {
        const v = b[key] === '' || b[key] === null ? 4 : Number(b[key]);
        if (!Number.isFinite(v) || v < 0) {
          reply.code(400);
          return fail(400, '每提交工时系数须为不小于 0 的数字');
        }
        fields.push(`${col} = ?`);
        params.push(v);
        continue;
      }
      const isText = key === 'code' || key === 'nameCn' || key === 'nameEn' || key === 'note';
      const v = isText && b[key] !== null ? String(b[key]).trim() : b[key];
      fields.push(`${col} = ?`);
      params.push(v === '' ? null : v);
    }

    if (fields.length) {
      params.push(id);
      try {
        await pool.query(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, params);
      } catch (e) {
        if ((e as { code?: string }).code === 'ER_DUP_ENTRY') {
          reply.code(409);
          return fail(409, '该项目 code 已存在');
        }
        throw e;
      }
    }
    const [out] = await pool.query<Row[]>(`SELECT ${PROJECT_COLS} FROM projects p WHERE p.id = ?`, [id]);
    return ok(out[0]);
  });

  // 删除项目：存在任何引用时禁止删除，改为使用「归档」状态
  app.delete('/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [cur] = await pool.query<Row[]>('SELECT id FROM projects WHERE id = ?', [id]);
    if (!cur.length) {
      reply.code(404);
      return fail(404, '项目不存在');
    }
    const refs = await loadRefs(id);
    if (refTotal(refs) > 0) {
      const detail = [
        ...REF_KEYS.filter(([key]) => refs[key] > 0).map(([key, , label]) => `${label} ${refs[key]} 条`),
        refs.products > 0 ? `产品分摊 ${refs.products} 个` : '',
      ]
        .filter(Boolean)
        .join('、');
      reply.code(409);
      return fail(409, `该项目已被引用（${detail}），无法删除；请改为「归档」`);
    }
    await pool.query('DELETE FROM projects WHERE id = ?', [id]);
    return ok({ id });
  });

  // 同步 GitHub 仓库统计并落库快照
  app.post('/:id/sync-repo', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    try {
      const snapshot = await syncProjectRepo(id);
      return ok({ snapshot, syncedAt: todayISO() });
    } catch (e) {
      if (e instanceof GitHubError) {
        reply.code(502);
        return fail(502, e.message);
      }
      if ((e as Error).message === '项目不存在') {
        reply.code(404);
        return fail(404, '项目不存在');
      }
      throw e;
    }
  });
}
