-- =============================================================
-- 030 · 历史快照名称
-- 为盈利模型 / THKCOS 历史版本快照增加可选自定义名称。
-- 幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables' AND COLUMN_NAME = 'snapshot_name'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN snapshot_name VARCHAR(80) NULL AFTER id'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables' AND COLUMN_NAME = 'snapshot_name'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN snapshot_name VARCHAR(80) NULL AFTER id'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
