import { env } from '../env';

/** GitHub 仓库定位（owner/repo）。 */
export type RepoRef = { owner: string; repo: string };

/**
 * 解析 GitHub 仓库地址，支持：
 *   - https://github.com/owner/repo(.git)(/...)
 *   - git@github.com:owner/repo.git
 *   - owner/repo 简写
 */
export function parseRepoUrl(input: string | null | undefined): RepoRef | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  const url = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(s);
  if (url) return { owner: url[1], repo: url[2] };
  const shorthand = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(s);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2] };
  return null;
}

export type WeekPoint = { weekStart: string; commits: number };
export type ContributorPoint = { login: string; commits: number };

/** 仓库投入统计（估算口径：人时 = 提交数 × 每提交工时系数）。 */
export type RepoStats = {
  repoFullName: string;
  defaultBranch: string | null;
  language: string | null;
  stars: number;
  totalCommits: number;
  contributors: number;
  activeWeeks: number;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
  weekly: WeekPoint[];
  byContributor: ContributorPoint[];
};

export class GitHubError extends Error {}

async function ghJson(path: string): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'fbap-finance-analytics',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (env.github.token) headers.Authorization = `Bearer ${env.github.token}`;

  let res: Response;
  try {
    res = await fetch(`${env.github.apiBase}${path}`, { headers });
  } catch (e) {
    throw new GitHubError(`无法连接 GitHub：${(e as Error).message}`);
  }
  if (res.status === 404) {
    throw new GitHubError('仓库不存在或无权访问（私有仓库需配置 GITHUB_TOKEN）');
  }
  if (res.status === 401 || res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const hint = remaining === '0' ? '（已触发 API 限速，请配置 GITHUB_TOKEN）' : '（请检查 GITHUB_TOKEN 是否有效）';
    throw new GitHubError(`GitHub 拒绝访问 ${res.status}${hint}`);
  }
  if (!res.ok) {
    throw new GitHubError(`GitHub 返回 ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const isoDay = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const toDay = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isoDay(new Date(v * 1000));
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : isoDay(d);
};

type GhContributor = { total?: number; author?: { login?: string } | null; weeks?: { w?: number; c?: number }[] };

/**
 * 拉取仓库基本信息与提交统计。
 * 说明：GitHub 的 stats/contributors 为异步计算，首次请求可能返回 202（计算中），
 * 此时会等待后重试一次。
 */
export async function fetchRepoStats(ref: RepoRef): Promise<RepoStats> {
  const fullName = `${ref.owner}/${ref.repo}`;
  const meta = (await ghJson(`/repos/${ref.owner}/${ref.repo}`)).json as Record<string, any>;

  let contributors: GhContributor[] | null = null;
  for (let attempt = 0; attempt < 2 && contributors === null; attempt += 1) {
    const { status, json } = await ghJson(`/repos/${ref.owner}/${ref.repo}/stats/contributors`);
    if (status === 202 || json === null) {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    contributors = Array.isArray(json) ? (json as GhContributor[]) : [];
  }
  if (contributors === null) {
    throw new GitHubError('GitHub 正在计算提交统计（202），请稍后重试');
  }

  const weekMap = new Map<string, number>();
  const contributorsPoints: ContributorPoint[] = [];
  let totalCommits = 0;

  for (const c of contributors) {
    const commits = Number(c.total ?? 0);
    totalCommits += commits;
    const login = c.author?.login ?? '(unknown)';
    contributorsPoints.push({ login, commits });
    for (const w of c.weeks ?? []) {
      const commitsOfWeek = Number(w.c ?? 0);
      if (!commitsOfWeek) continue;
      const day = toDay(w.w);
      if (!day) continue;
      weekMap.set(day, (weekMap.get(day) ?? 0) + commitsOfWeek);
    }
  }

  const weekly: WeekPoint[] = [...weekMap.entries()]
    .map(([weekStart, commits]) => ({ weekStart, commits }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  const firstCommitAt = weekly.length ? weekly[0].weekStart : null;
  const lastCommitAt = weekly.length ? weekly[weekly.length - 1].weekStart : null;

  contributorsPoints.sort((a, b) => b.commits - a.commits);

  return {
    repoFullName: String(meta.full_name ?? fullName),
    defaultBranch: meta.default_branch ? String(meta.default_branch) : null,
    language: meta.language ? String(meta.language) : null,
    stars: Number(meta.stargazers_count ?? 0),
    totalCommits,
    contributors: contributors.length,
    activeWeeks: weekly.length,
    firstCommitAt,
    lastCommitAt,
    weekly,
    byContributor: contributorsPoints,
  };
}
