-- =============================================================
-- 023 · cf & THKCOS 订阅会员分级（基础 / 高级）
-- 「月卡订阅人数」拆成「基础订阅会员」与「高级订阅会员」两档，且各档再分
-- 月卡 / 季卡 / 年卡（季卡实收 ×3、年卡实收 ×12，均按月度确认口径折算）：
--   基础：basic_monthly_subs   / basic_quarterly_subs   / basic_yearly_subs
--   高级：premium_monthly_subs / premium_quarterly_subs / premium_yearly_subs
-- 每档各配一个 ¥/月 单价列（*_price_cny），共 6 组人数 + 6 组单价。
-- 原 monthly_subs / quarterly_subs / yearly_subs 系列列重命名为 basic_*（保留既有数据）。
-- 幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

-- 1) 原「月卡」列 → 「基础会员 · 月卡」（已存在则跳过；旧列存在则重命名，否则新增）
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'basic_monthly_subs'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
                AND COLUMN_NAME = 'monthly_subs'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN monthly_subs basic_monthly_subs INT NULL COMMENT ''L1 基础会员·月卡订阅人数''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN basic_monthly_subs INT NULL COMMENT ''L1 基础会员·月卡订阅人数'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'basic_monthly_price_cny'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
                AND COLUMN_NAME = 'monthly_price_cny'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN monthly_price_cny basic_monthly_price_cny DECIMAL(18,2) NULL COMMENT ''M1 基础会员·月卡 ¥/月''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN basic_monthly_price_cny DECIMAL(18,2) NULL COMMENT ''M1 基础会员·月卡 ¥/月'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) 原「季卡」列 → 「基础会员 · 季卡」
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'basic_quarterly_subs'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
                AND COLUMN_NAME = 'quarterly_subs'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN quarterly_subs basic_quarterly_subs INT NULL COMMENT ''L2 基础会员·季卡订阅人数（实收 ×3）''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN basic_quarterly_subs INT NULL COMMENT ''L2 基础会员·季卡订阅人数（实收 ×3）'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'basic_quarterly_price_cny'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
                AND COLUMN_NAME = 'quarterly_price_cny'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN quarterly_price_cny basic_quarterly_price_cny DECIMAL(18,2) NULL COMMENT ''M2 基础会员·季卡 ¥/月（实收 = ×3）''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN basic_quarterly_price_cny DECIMAL(18,2) NULL COMMENT ''M2 基础会员·季卡 ¥/月（实收 = ×3）'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) 原「年卡」列 → 「基础会员 · 年卡」
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'basic_yearly_subs'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
                AND COLUMN_NAME = 'yearly_subs'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN yearly_subs basic_yearly_subs INT NULL COMMENT ''L3 基础会员·年卡订阅人数（实收 ×12）''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN basic_yearly_subs INT NULL COMMENT ''L3 基础会员·年卡订阅人数（实收 ×12）'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'basic_yearly_price_cny'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
                AND COLUMN_NAME = 'yearly_price_cny'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN yearly_price_cny basic_yearly_price_cny DECIMAL(18,2) NULL COMMENT ''M3 基础会员·年卡 ¥/月（实收 = ×12）''',
      'ALTER TABLE product_thkcos_variables ADD COLUMN basic_yearly_price_cny DECIMAL(18,2) NULL COMMENT ''M3 基础会员·年卡 ¥/月（实收 = ×12）'''
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) 新增「高级会员」月卡 / 季卡 / 年卡（人数 + 单价）
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'premium_monthly_subs'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN premium_monthly_subs INT NULL COMMENT ''L4 高级会员·月卡订阅人数'' AFTER basic_yearly_price_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'premium_monthly_price_cny'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN premium_monthly_price_cny DECIMAL(18,2) NULL COMMENT ''M4 高级会员·月卡 ¥/月'' AFTER premium_monthly_subs'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'premium_quarterly_subs'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN premium_quarterly_subs INT NULL COMMENT ''L5 高级会员·季卡订阅人数（实收 ×3）'' AFTER premium_monthly_price_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'premium_quarterly_price_cny'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN premium_quarterly_price_cny DECIMAL(18,2) NULL COMMENT ''M5 高级会员·季卡 ¥/月（实收 = ×3）'' AFTER premium_quarterly_subs'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'premium_yearly_subs'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN premium_yearly_subs INT NULL COMMENT ''L6 高级会员·年卡订阅人数（实收 ×12）'' AFTER premium_quarterly_price_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'premium_yearly_price_cny'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN premium_yearly_price_cny DECIMAL(18,2) NULL COMMENT ''M6 高级会员·年卡 ¥/月（实收 = ×12）'' AFTER premium_yearly_subs'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
