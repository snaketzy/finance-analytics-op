-- =============================================================
-- 026 · 流量口径调整：片数 → 观影分钟，单片 GB → 每分钟 MB
-- 重命名两表的 I / J / K 列（保留既有数据）：
--   titles_per_viewer  -> minutes_per_viewer   （I 人均月观影分钟数）
--   per_title_gb_low   -> per_min_mb_low       （J 每分钟流量下限 MB）
--   per_title_gb_high  -> per_min_mb_high      （K 每分钟流量上限 MB）
-- 涉及：product_econ_variables（cf & CDN）、product_thkcos_variables（cf & THKCOS）
-- 幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

-- ------------------------- product_econ_variables -------------------------
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables'
              AND COLUMN_NAME = 'minutes_per_viewer'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables'
                AND COLUMN_NAME = 'titles_per_viewer'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN titles_per_viewer minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I 人均月观影分钟数''',
      'ALTER TABLE product_econ_variables ADD COLUMN minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I 人均月观影分钟数'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables'
              AND COLUMN_NAME = 'per_min_mb_low'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables'
                AND COLUMN_NAME = 'per_title_gb_low'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN per_title_gb_low per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J 每分钟流量下限 MB''',
      'ALTER TABLE product_econ_variables ADD COLUMN per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J 每分钟流量下限 MB'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables'
              AND COLUMN_NAME = 'per_min_mb_high'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables'
                AND COLUMN_NAME = 'per_title_gb_high'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN per_title_gb_high per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K 每分钟流量上限 MB''',
      'ALTER TABLE product_econ_variables ADD COLUMN per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K 每分钟流量上限 MB'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------ product_thkcos_variables ------------------------
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'minutes_per_viewer'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
                AND COLUMN_NAME = 'titles_per_viewer'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN titles_per_viewer minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I 人均月观影分钟数''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I 人均月观影分钟数'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'per_min_mb_low'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
                AND COLUMN_NAME = 'per_title_gb_low'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN per_title_gb_low per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J 每分钟流量下限 MB''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J 每分钟流量下限 MB'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'per_min_mb_high'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
                AND COLUMN_NAME = 'per_title_gb_high'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN per_title_gb_high per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K 每分钟流量上限 MB''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K 每分钟流量上限 MB'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
