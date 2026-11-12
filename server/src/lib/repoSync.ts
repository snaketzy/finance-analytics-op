import type { ResultSetHeader } from 'mysql2';
import { pool, type Row } from '../db';
import { env } from '../env';
import { fetchRepoStats, parseRepoUrl, GitHubError } from './github';

export const SNAPSHOT_COLS = `id, project_id AS projectId, repo_full_name AS repoFullName,
  default_branch AS defaultBranch, language, stars, total_commits AS totalCommits,
  contributors, active_weeks AS activeWeeks, first_commit_at AS firstCommitAt,
  last_commit_at AS lastCommitAt, hours_per_commit AS hoursPerCommit,
  estimated_hours AS estimatedHours, captured_at AS capturedAt`;

export type Snapshot = {
  id: number;
  projectId: number;
  repoFullName: string;
  defaultBranch: string | null;
  language: string | null;
  stars: number;
  totalCommits: number;
  contributors: number;
  activeWeeks: number;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
  hoursPerCommit: number;
  estimatedHours: number;
  capturedAt: string;
};

function mapSnapshot(r: Row): Snapshot {
  const f = (v: unknown) => (v ? new Date(v as string | Date).toISOString().slice(0, 19) : null);
  return {
    id: Number(r.id),
    projectId: Number(r.projectId),
    repoFullName: String(r.repoFullName),
    defaultBranch: r.defaultBranch ? String(r.defaultBranch) : null,
    language: r.language ? String(r.language) : null,
    stars: Number(r.stars),
    totalCommits: Number(r.totalCommits),
    contributors: Number(r.contributors),
    activeWeeks: Number(r.activeWeeks),
    firstCommitAt: f(r.firstCommitAt),
    lastCommitAt: f(r.lastCommitAt),
    hoursPerCommit: Number(r.hoursPerCommit),
    estimatedHours: Number(r.estimatedHours),
    capturedAt: f(r.capturedAt) ?? '',
  };
}

/** 最近一次快照。 */
export async function latestSnapshot(projectId: number): Promise<Snapshot | null> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${SNAPSHOT_COLS} FROM project_repo_snapshots
      WHERE project_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1`,
    [projectId]
  );
  return rows.length ? mapSnapshot(rows[0]) : null;
}

/** 快照历史（倒序）。 */
export async function snapshotHistory(projectId: number, limit = 20): Promise<Snapshot[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${SNAPSHOT_COLS} FROM project_repo_snapshots
      WHERE project_id = ? ORDER BY captured_at DESC, id DESC LIMIT ?`,
    [projectId, limit]
  );
  return rows.map(mapSnapshot);
}

/**
 * 同步单个项目的 GitHub 仓库统计并落库一条快照。
 * 失败时抛出 GitHubError（不写库，避免污染趋势）。
 */
export async function syncProjectRepo(projectId: number): Promise<Snapshot> {
  const [rows] = await pool.query<Row[]>(
    'SELECT id, repo_url AS repoUrl, hours_per_commit AS hoursPerCommit FROM projects WHERE id = ?',
    [projectId]
  );
  if (!rows.length) throw new Error('项目不存在');

  const repoUrl = rows[0].repoUrl ? String(rows[0].repoUrl) : '';
  const ref = parseRepoUrl(repoUrl);
  if (!ref) throw new GitHubError('该项目未配置有效的 GitHub 仓库地址');

  const hoursPerCommit = Number(rows[0].hoursPerCommit ?? 4);
  const stats = await fetchRepoStats(ref);
  const estimatedHours = Math.round(stats.totalCommits * hoursPerCommit * 100) / 100;

  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO project_repo_snapshots
       (project_id, repo_full_name, default_branch, language, stars, total_commits,
        contributors, active_weeks, first_commit_at, last_commit_at, hours_per_commit,
        estimated_hours, weekly, by_contributor)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CAST(? AS JSON),CAST(? AS JSON))`,
    [
      projectId,
      stats.repoFullName,
      stats.defaultBranch,
      stats.language,
      stats.stars,
      stats.totalCommits,
      stats.contributors,
      stats.activeWeeks,
      stats.firstCommitAt,
      stats.lastCommitAt,
      hoursPerCommit,
      estimatedHours,
      JSON.stringify(stats.weekly),
      JSON.stringify(stats.byContributor),
    ]
  );

  const [out] = await pool.query<Row[]>(
    `SELECT ${SNAPSHOT_COLS} FROM project_repo_snapshots WHERE id = ?`,
    [res.insertId]
  );
  return mapSnapshot(out[0]);
}

/** 同步全部已绑定仓库的在营项目；返回成功/失败统计。 */
export async function syncAllProjectRepos(): Promise<{ synced: number; failed: { projectId: number; message: string }[] }> {
  const [rows] = await pool.query<Row[]>(
    `SELECT id FROM projects
      WHERE repo_url IS NOT NULL AND repo_url <> '' AND status <> 'archived' ORDER BY id`
  );
  const failed: { projectId: number; message: string }[] = [];
  let synced = 0;
  for (const r of rows) {
    const id = Number(r.id);
    try {
      await syncProjectRepo(id);
      synced += 1;
    } catch (e) {
      failed.push({ projectId: id, message: (e as Error).message });
    }
  }
  return { synced, failed };
}

let timer: NodeJS.Timeout | null = null;

/** 启动每日自动同步（首次延迟 5 分钟，避免开发期频繁重启就触发）。 */
export function startRepoSyncScheduler(): void {
  if (!env.github.autoSync || timer) return;
  const intervalMs = Math.max(1, env.github.syncIntervalHours) * 3600 * 1000;
  const run = () => {
    syncAllProjectRepos()
      .then((r) => {
        if (r.synced || r.failed.length) {
          console.log(`▶ GitHub 仓库统计同步：成功 ${r.synced} 个，失败 ${r.failed.length} 个`);
          for (const f of r.failed) console.warn(`  · 项目 #${f.projectId} 同步失败：${f.message}`);
        }
      })
      .catch((e) => console.warn(`GitHub 仓库统计同步异常：${(e as Error).message}`));
  };
  timer = setTimeout(() => {
    run();
    timer = setInterval(run, intervalMs);
  }, 5 * 60 * 1000);
}
