-- 013_project_repo.sql
-- 项目：绑定 GitHub 仓库、配置工时折算系数；新增仓库统计快照表。
-- 说明：GitHub 不记录人时，快照中的 estimated_hours = total_commits × hours_per_commit，
--       仅为投入强度的估算口径，用于产品成本评估的参考维度。

-- ---------- projects 增列（幂等：information_schema 判断 + 动态 SQL） ----------
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'repo_url'),
    'SELECT 1',
    'ALTER TABLE projects ADD COLUMN repo_url VARCHAR(255) NULL AFTER sort_order'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'note'),
    'SELECT 1',
    'ALTER TABLE projects ADD COLUMN note VARCHAR(255) NULL AFTER repo_url'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'hours_per_commit'),
    'SELECT 1',
    'ALTER TABLE projects ADD COLUMN hours_per_commit DECIMAL(6,2) NOT NULL DEFAULT 4.00 AFTER note'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- 仓库统计快照 ----------
CREATE TABLE IF NOT EXISTS project_repo_snapshots (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id       BIGINT UNSIGNED NOT NULL,
  repo_full_name   VARCHAR(160) NOT NULL,
  default_branch   VARCHAR(120) NULL,
  language         VARCHAR(64)  NULL,
  stars            INT NOT NULL DEFAULT 0,
  total_commits    INT NOT NULL DEFAULT 0,
  contributors     INT NOT NULL DEFAULT 0,
  active_weeks     INT NOT NULL DEFAULT 0,
  first_commit_at  DATETIME NULL,
  last_commit_at   DATETIME NULL,
  hours_per_commit DECIMAL(6,2) NOT NULL DEFAULT 4.00,
  estimated_hours  DECIMAL(12,2) NOT NULL DEFAULT 0,
  weekly           JSON NULL,
  by_contributor   JSON NULL,
  captured_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_prs_project (project_id, captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
