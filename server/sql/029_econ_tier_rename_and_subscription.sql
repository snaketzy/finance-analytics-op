-- =============================================================
-- 029 · Econ 观看人群字段重命名 + 订阅收入拆为基础/高级两档
-- 为与 THKCOS 模型保持一致：
--   1) 观看人群 regular_*/heavy_* → basic_*/premium_*（8 列）
--   2) 订阅收入拆为「基础会员 / 高级会员」两档，每档再分月卡/季卡/年卡
--      原 monthly_subs / quarterly_subs / yearly_subs（及对应 *_price_cny）
--      重命名为 basic_*（保留既有数据），新增 premium_* 6 列。
-- 仅作用于 product_econ_variables。幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

SET @tbl = 'product_econ_variables';

-- ===== 1) 观看人群：regular_* → basic_* =====

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_viewers'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'regular_viewers'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN regular_viewers basic_viewers DECIMAL(12,3) NULL COMMENT ''H1 基础会员月观看人数''',
      'ALTER TABLE product_econ_variables ADD COLUMN basic_viewers DECIMAL(12,3) NULL COMMENT ''H1 基础会员月观看人数'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_minutes_per_viewer'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'regular_minutes_per_viewer'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN regular_minutes_per_viewer basic_minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I1 基础会员人均月观影分钟数''',
      'ALTER TABLE product_econ_variables ADD COLUMN basic_minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I1 基础会员人均月观影分钟数'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_per_min_mb_low'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'regular_per_min_mb_low'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN regular_per_min_mb_low basic_per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J1 基础会员每分钟流量下限 MB''',
      'ALTER TABLE product_econ_variables ADD COLUMN basic_per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J1 基础会员每分钟流量下限 MB'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_per_min_mb_high'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'regular_per_min_mb_high'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN regular_per_min_mb_high basic_per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K1 基础会员每分钟流量上限 MB''',
      'ALTER TABLE product_econ_variables ADD COLUMN basic_per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K1 基础会员每分钟流量上限 MB'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ===== 2) 观看人群：heavy_* → premium_* =====

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_viewers'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'heavy_viewers'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN heavy_viewers premium_viewers DECIMAL(12,3) NULL COMMENT ''H2 高级会员月观看人数''',
      'ALTER TABLE product_econ_variables ADD COLUMN premium_viewers DECIMAL(12,3) NULL COMMENT ''H2 高级会员月观看人数'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_minutes_per_viewer'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'heavy_minutes_per_viewer'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN heavy_minutes_per_viewer premium_minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I2 高级会员人均月观影分钟数''',
      'ALTER TABLE product_econ_variables ADD COLUMN premium_minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I2 高级会员人均月观影分钟数'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_per_min_mb_low'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'heavy_per_min_mb_low'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN heavy_per_min_mb_low premium_per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J2 高级会员每分钟流量下限 MB''',
      'ALTER TABLE product_econ_variables ADD COLUMN premium_per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J2 高级会员每分钟流量下限 MB'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_per_min_mb_high'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'heavy_per_min_mb_high'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN heavy_per_min_mb_high premium_per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K2 高级会员每分钟流量上限 MB''',
      'ALTER TABLE product_econ_variables ADD COLUMN premium_per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K2 高级会员每分钟流量上限 MB'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ===== 3) 订阅收入：原 *_subs / *_price_cny → basic_* =====

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_monthly_subs'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'monthly_subs'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN monthly_subs basic_monthly_subs INT NULL COMMENT ''L1 基础会员·月卡订阅人数''',
      'ALTER TABLE product_econ_variables ADD COLUMN basic_monthly_subs INT NULL COMMENT ''L1 基础会员·月卡订阅人数'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_monthly_price_cny'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'monthly_price_cny'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN monthly_price_cny basic_monthly_price_cny DECIMAL(18,2) NULL COMMENT ''M1 基础会员·月卡 ¥/月''',
      'ALTER TABLE product_econ_variables ADD COLUMN basic_monthly_price_cny DECIMAL(18,2) NULL COMMENT ''M1 基础会员·月卡 ¥/月'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_quarterly_subs'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'quarterly_subs'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN quarterly_subs basic_quarterly_subs INT NULL COMMENT ''L2 基础会员·季卡订阅人数（实收 ×3）''',
      'ALTER TABLE product_econ_variables ADD COLUMN basic_quarterly_subs INT NULL COMMENT ''L2 基础会员·季卡订阅人数（实收 ×3）'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_quarterly_price_cny'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'quarterly_price_cny'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN quarterly_price_cny basic_quarterly_price_cny DECIMAL(18,2) NULL COMMENT ''M2 基础会员·季卡 ¥/月（实收 = ×3）''',
      'ALTER TABLE product_econ_variables ADD COLUMN basic_quarterly_price_cny DECIMAL(18,2) NULL COMMENT ''M2 基础会员·季卡 ¥/月（实收 = ×3）'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_yearly_subs'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'yearly_subs'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN yearly_subs basic_yearly_subs INT NULL COMMENT ''L3 基础会员·年卡订阅人数（实收 ×12）''',
      'ALTER TABLE product_econ_variables ADD COLUMN basic_yearly_subs INT NULL COMMENT ''L3 基础会员·年卡订阅人数（实收 ×12）'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'basic_yearly_price_cny'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'yearly_price_cny'),
      'ALTER TABLE product_econ_variables CHANGE COLUMN yearly_price_cny basic_yearly_price_cny DECIMAL(18,2) NULL COMMENT ''M3 基础会员·年卡 ¥/月（实收 = ×12）''',
      'ALTER TABLE product_econ_variables ADD COLUMN basic_yearly_price_cny DECIMAL(18,2) NULL COMMENT ''M3 基础会员·年卡 ¥/月（实收 = ×12）'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ===== 4) 新增「高级会员」月卡 / 季卡 / 年卡（人数 + 单价）=====

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_monthly_subs'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN premium_monthly_subs INT NULL COMMENT ''L4 高级会员·月卡订阅人数'' AFTER basic_yearly_price_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_monthly_price_cny'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN premium_monthly_price_cny DECIMAL(18,2) NULL COMMENT ''M4 高级会员·月卡 ¥/月'' AFTER premium_monthly_subs'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_quarterly_subs'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN premium_quarterly_subs INT NULL COMMENT ''L5 高级会员·季卡订阅人数（实收 ×3）'' AFTER premium_monthly_price_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_quarterly_price_cny'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN premium_quarterly_price_cny DECIMAL(18,2) NULL COMMENT ''M5 高级会员·季卡 ¥/月（实收 = ×3）'' AFTER premium_quarterly_subs'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_yearly_subs'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN premium_yearly_subs INT NULL COMMENT ''L6 高级会员·年卡订阅人数（实收 ×12）'' AFTER premium_quarterly_price_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'premium_yearly_price_cny'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN premium_yearly_price_cny DECIMAL(18,2) NULL COMMENT ''M6 高级会员·年卡 ¥/月（实收 = ×12）'' AFTER premium_yearly_subs'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
