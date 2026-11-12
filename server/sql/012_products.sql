-- =============================================================
-- P5 · 产品维度与项目成本分摊
--   产品(Product) = 业务线（Vidday 前台 / Movie Database 后台 …）
--   项目(Project) = 成本中心（交易仍挂 transactions.project_id）
--   product_projects = 产品 ←→ 项目 多对多 + 分摊比例 + 生效时间（版本化）
--   product_model_inputs 由「项目维度」改为「产品维度」
-- 幂等，可反复执行
-- =============================================================
SET NAMES utf8mb4;

-- ---------- 产品 ----------
CREATE TABLE IF NOT EXISTS products (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(32)  NOT NULL UNIQUE,
  name_cn     VARCHAR(64)  NOT NULL,
  name_en     VARCHAR(64)  NOT NULL,
  kind        ENUM('frontend','backend','platform','other') NOT NULL DEFAULT 'other',
  status      ENUM('active','paused','archived') NOT NULL DEFAULT 'active',
  launch_date DATE NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  note        VARCHAR(255) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 产品 ←→ 项目 分摊（时间版本化） ----------
-- 同一 (产品, 项目) 可存在多条记录，按 effective_from/effective_to 划分时间区间；
-- 任一项目在任一时刻，其全部生效产品的 ratio 合计须为 1（由后端写入时校验）。
CREATE TABLE IF NOT EXISTS product_projects (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id     BIGINT UNSIGNED NOT NULL,
  project_id     BIGINT UNSIGNED NOT NULL,
  ratio          DECIMAL(9,6) NOT NULL,          -- 0-1，该项目在本产品下的分摊比例
  effective_from DATE NOT NULL,                  -- 生效起（含）
  effective_to   DATE NULL,                      -- 生效止（含）；NULL = 至今仍生效
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_pp_product (product_id, effective_from),
  KEY idx_pp_project (project_id, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- product_model_inputs：project_id → product_id ----------
-- 1) 列改名（仅在仍为 project_id 时执行）
SET @c := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'product_model_inputs'
     AND COLUMN_NAME = 'project_id'
);
SET @s := IF(@c > 0,
  'ALTER TABLE product_model_inputs CHANGE COLUMN project_id product_id BIGINT UNSIGNED NOT NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 2) 删除旧唯一键 uk_proj_scenario（若存在）
SET @c := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'product_model_inputs'
     AND INDEX_NAME = 'uk_proj_scenario'
);
SET @s := IF(@c > 0,
  'ALTER TABLE product_model_inputs DROP INDEX uk_proj_scenario',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 3) 新增唯一键 uk_product_scenario（若不存在）
SET @c := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'product_model_inputs'
     AND INDEX_NAME = 'uk_product_scenario'
);
SET @s := IF(@c = 0,
  'ALTER TABLE product_model_inputs ADD UNIQUE KEY uk_product_scenario (product_id, scenario)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
