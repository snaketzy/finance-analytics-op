-- =============================================================
-- 015 · 全变量测算：版本化快照（保存日期）
-- 将 product_econ_variables 由「每产品唯一一行（覆盖式）」改为「按次保存的历史快照」：
--   1) 新增 saved_at（保存时刻）
--   2) 移除 UNIQUE KEY uk_econ_product，允许同一产品保留多份假设
--   3) 建立 (product_id, saved_at) 索引，按时间倒序取最新版本
-- 幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

-- 1) 新增 saved_at 列（保存日期），先建为可空以便回填历史行
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables' AND COLUMN_NAME = 'saved_at'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN saved_at DATETIME NULL AFTER horizon_months'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) 回填历史行：既有数据只有 updated_at 可作保存时间
UPDATE product_econ_variables
   SET saved_at = IFNULL(updated_at, CURRENT_TIMESTAMP)
 WHERE saved_at IS NULL;

-- 3) 收紧为 NOT NULL DEFAULT CURRENT_TIMESTAMP（不随更新变化）
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables'
              AND COLUMN_NAME = 'saved_at' AND (COLUMN_DEFAULT IS NULL OR IS_NULLABLE = 'YES')),
    'ALTER TABLE product_econ_variables MODIFY COLUMN saved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    'SELECT 1'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) 移除产品唯一键（改为可保留多版本）
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables' AND INDEX_NAME = 'uk_econ_product'),
    'ALTER TABLE product_econ_variables DROP INDEX uk_econ_product',
    'SELECT 1'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5) 建立产品 + 保存时间索引（取最新 / 列历史）
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables' AND INDEX_NAME = 'idx_pev_product_savedat'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD INDEX idx_pev_product_savedat (product_id, saved_at)'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
