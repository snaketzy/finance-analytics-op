-- =============================================================
-- 035 · Econ / THKCOS 新增连续包月会员字段
-- 为两套全变量模型补充：
--   L11 基础会员连续包月人数      basic_continuous_monthly_subs
--   M11 基础会员连续包月单价      basic_continuous_monthly_price_cny
--   L41 高级会员连续包月人数      premium_continuous_monthly_subs
--   M41 高级会员连续包月单价      premium_continuous_monthly_price_cny
-- 幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

-- ===== product_econ_variables =====
SET @tbl = 'product_econ_variables';

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_continuous_monthly_subs'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN basic_continuous_monthly_subs INT NULL COMMENT ''L11 基础会员·连续包月订阅人数'' AFTER basic_monthly_price_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_continuous_monthly_price_cny'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN basic_continuous_monthly_price_cny DECIMAL(18,2) NULL COMMENT ''M11 基础会员·连续包月 ¥/月'' AFTER basic_continuous_monthly_subs'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_continuous_monthly_subs'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN premium_continuous_monthly_subs INT NULL COMMENT ''L41 高级会员·连续包月订阅人数'' AFTER premium_monthly_price_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_continuous_monthly_price_cny'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN premium_continuous_monthly_price_cny DECIMAL(18,2) NULL COMMENT ''M41 高级会员·连续包月 ¥/月'' AFTER premium_continuous_monthly_subs'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ===== product_thkcos_variables =====
SET @tbl = 'product_thkcos_variables';

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_continuous_monthly_subs'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN basic_continuous_monthly_subs INT NULL COMMENT ''L11 基础会员·连续包月订阅人数'' AFTER basic_monthly_price_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_continuous_monthly_price_cny'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN basic_continuous_monthly_price_cny DECIMAL(18,2) NULL COMMENT ''M11 基础会员·连续包月 ¥/月'' AFTER basic_continuous_monthly_subs'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_continuous_monthly_subs'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN premium_continuous_monthly_subs INT NULL COMMENT ''L41 高级会员·连续包月订阅人数'' AFTER premium_monthly_price_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_continuous_monthly_price_cny'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN premium_continuous_monthly_price_cny DECIMAL(18,2) NULL COMMENT ''M41 高级会员·连续包月 ¥/月'' AFTER premium_continuous_monthly_subs'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
