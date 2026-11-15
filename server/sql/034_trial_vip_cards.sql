-- =============================================================
-- 034 · Econ / THKCOS 新增体验卡与 VIP 卡字段
-- 为两套全变量模型补充：
--   X1 体验卡人数             experience_card_subs
--   Y1 体验卡单价（默认 9.9） experience_card_price_cny
--   Z1 VIP 卡人数            vip_card_subs
-- 幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

-- ===== product_econ_variables =====

SET @tbl = 'product_econ_variables';

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'experience_card_subs'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN experience_card_subs INT NULL COMMENT ''X1 体验卡人数'' AFTER premium_per_min_mb_high'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'experience_card_price_cny'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN experience_card_price_cny DECIMAL(18,2) NULL COMMENT ''Y1 体验卡单价 ¥（默认 9.9，可修改）'' AFTER experience_card_subs'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'vip_card_subs'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN vip_card_subs INT NULL COMMENT ''Z1 VIP 卡人数（价格固定 0）'' AFTER experience_card_price_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ===== product_thkcos_variables =====

SET @tbl = 'product_thkcos_variables';

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'experience_card_subs'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN experience_card_subs INT NULL COMMENT ''X1 体验卡人数'' AFTER premium_per_min_mb_high'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'experience_card_price_cny'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN experience_card_price_cny DECIMAL(18,2) NULL COMMENT ''Y1 体验卡单价 ¥（默认 9.9，可修改）'' AFTER experience_card_subs'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'vip_card_subs'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN vip_card_subs INT NULL COMMENT ''Z1 VIP 卡人数（价格固定 0）'' AFTER experience_card_price_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
