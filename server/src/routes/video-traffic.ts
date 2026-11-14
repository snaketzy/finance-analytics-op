import type { FastifyInstance } from 'fastify';
import type { ResultSetHeader } from 'mysql2';
import { pool, type Row } from '../db';
import { ok, fail } from '../http';

/* ------------------------------------------------------------------ */
/* 视频流量测算（全局共用）                                             */
/* 按编码（HEVC / H264）× 分辨率记录「体积 / 时长」，折算每分钟流量。    */
/* 仅 HEVC 有 4K 档；H264 最高 1080P。                                  */
/* ------------------------------------------------------------------ */

/** 编码与其可用分辨率档位（固定顺序）。 */
const CODECS: { codec: string; resolutions: string[] }[] = [
  { codec: 'HEVC', resolutions: ['4K', '1080P', '720P', '480P', '360P'] },
  { codec: 'H264', resolutions: ['1080P', '720P', '480P', '360P'] },
];

/** 合法 (codec, resolution) 组合集合，用于校验入参。 */
const ALLOWED = new Set(CODECS.flatMap((c) => c.resolutions.map((r) => `${c.codec}|${r}`)));

const toNum = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 每分钟流量（GB/min）= 体积 / 时长；参数不合法时返回 null。 */
function perMinGb(sizeGb: number | null, durationMin: number | null): number | null {
  if (sizeGb == null || durationMin == null || sizeGb <= 0 || durationMin <= 0) return null;
  return sizeGb / durationMin;
}

type VideoTrafficItem = {
  codec: string;
  resolution: string;
  sizeGb: number | null;
  durationMin: number | null;
  perMinGb: number | null;
};

/** 读取全部档位（按编码 / 分辨率固定顺序，缺失档位补空）。 */
async function loadItems(): Promise<{ items: VideoTrafficItem[]; updatedAt: string | null }> {
  const [rows] = await pool.query<Row[]>(
    `SELECT codec, resolution, size_gb AS sizeGb, duration_min AS durationMin,
            per_min_gb AS perMinGb, updated_at AS updatedAt
       FROM video_traffic_bitrates`
  );
  const byKey = new Map(rows.map((r) => [`${String(r.codec)}|${String(r.resolution)}`, r]));
  let updatedAt: string | null = null;
  const items = CODECS.flatMap(({ codec, resolutions }) =>
    resolutions.map((resolution) => {
      const r = byKey.get(`${codec}|${resolution}`);
      if (!r) return { codec, resolution, sizeGb: null, durationMin: null, perMinGb: null };
      const at = r.updatedAt ? String(r.updatedAt) : null;
      if (at && (updatedAt === null || at > updatedAt)) updatedAt = at;
      return {
        codec,
        resolution,
        sizeGb: toNum(r.sizeGb),
        durationMin: toNum(r.durationMin),
        perMinGb: toNum(r.perMinGb),
      };
    })
  );
  return { items, updatedAt };
}

export default async function (app: FastifyInstance) {
  /* ---------------------------------------------------------------- */
  /* 视频流量测算：读取 / 保存                                           */
  /* ---------------------------------------------------------------- */

  /** 读取各编码 × 分辨率流量测算。 */
  app.get('/', async () => {
    const { items, updatedAt } = await loadItems();
    return ok({ items, updatedAt });
  });

  /** 保存（按 codec + resolution upsert），每分钟流量服务端折算。 */
  app.put('/', async (req, reply) => {
    const body = (req.body ?? {}) as { items?: unknown };
    if (!Array.isArray(body.items)) {
      reply.code(400);
      return fail(400, 'items 必须为数组');
    }
    for (const raw of body.items) {
      if (!raw || typeof raw !== 'object') continue;
      const o = raw as Record<string, unknown>;
      const codec = typeof o.codec === 'string' ? o.codec.trim() : '';
      const resolution = typeof o.resolution === 'string' ? o.resolution.trim() : '';
      // 仅接受预置（编码 × 分辨率）组合，避免脏数据。
      if (!ALLOWED.has(`${codec}|${resolution}`)) continue;
      const sizeGb = toNum(o.sizeGb);
      const durationMin = toNum(o.durationMin);
      await pool.query<ResultSetHeader>(
        `INSERT INTO video_traffic_bitrates (codec, resolution, size_gb, duration_min, per_min_gb)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           size_gb = VALUES(size_gb),
           duration_min = VALUES(duration_min),
           per_min_gb = VALUES(per_min_gb)`,
        [codec, resolution, sizeGb, durationMin, perMinGb(sizeGb, durationMin)]
      );
    }
    const { items, updatedAt } = await loadItems();
    return ok({ items, updatedAt });
  });
}
