-- =============================================================
-- 028 · THKCOS 观看人群字段重命名：regular_/heavy_ → basic_/premium_
-- 为与「订阅收入」中的基础会员（basic_*）/ 高级会员（premium_*）命名保持一致，
-- 将 COS 流量侧的 regular_*（原普通用户）/ heavy_*（原重度用户）列重命名为
-- basic_*（基础会员）/ premium_*（高级会员）。
-- 仅作用于 product_thkcos_variables，不影响 product_econ_variables（CDN 流量）。
-- 幂等：新列已存在则跳过；旧列存在则 CHANGE 重命名，否则 ADD 新增。
-- =============================================================
SET NAMES utf8mb4;

SET @tbl = 'product_thkcos_variables';

-- 1) regular_viewers → basic_viewers
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_viewers'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'regular_viewers'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN regular_viewers basic_viewers DECIMAL(12,3) NULL COMMENT ''H1 基础会员月观看人数''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN basic_viewers DECIMAL(12,3) NULL COMMENT ''H1 基础会员月观看人数'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) heavy_viewers → premium_viewers
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_viewers'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'heavy_viewers'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN heavy_viewers premium_viewers DECIMAL(12,3) NULL COMMENT ''H2 高级会员月观看人数''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN premium_viewers DECIMAL(12,3) NULL COMMENT ''H2 高级会员月观看人数'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) regular_minutes_per_viewer → basic_minutes_per_viewer
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_minutes_per_viewer'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'regular_minutes_per_viewer'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN regular_minutes_per_viewer basic_minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I1 基础会员人均月观影分钟数''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN basic_minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I1 基础会员人均月观影分钟数'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) heavy_minutes_per_viewer → premium_minutes_per_viewer
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_minutes_per_viewer'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'heavy_minutes_per_viewer'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN heavy_minutes_per_viewer premium_minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I2 高级会员人均月观影分钟数''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN premium_minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I2 高级会员人均月观影分钟数'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5) regular_per_min_mb_low → basic_per_min_mb_low
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_per_min_mb_low'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'regular_per_min_mb_low'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN regular_per_min_mb_low basic_per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J1 基础会员每分钟流量下限 MB''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN basic_per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J1 基础会员每分钟流量下限 MB'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 6) heavy_per_min_mb_low → premium_per_min_mb_low
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_per_min_mb_low'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'heavy_per_min_mb_low'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN heavy_per_min_mb_low premium_per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J2 高级会员每分钟流量下限 MB''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN premium_per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J2 高级会员每分钟流量下限 MB'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7) regular_per_min_mb_high → basic_per_min_mb_high
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_per_min_mb_high'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'regular_per_min_mb_high'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN regular_per_min_mb_high basic_per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K1 基础会员每分钟流量上限 MB''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN basic_per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K1 基础会员每分钟流量上限 MB'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 8) heavy_per_min_mb_high → premium_per_min_mb_high
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_per_min_mb_high'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'heavy_per_min_mb_high'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN heavy_per_min_mb_high premium_per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K2 高级会员每分钟流量上限 MB''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN premium_per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K2 高级会员每分钟流量上限 MB'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
