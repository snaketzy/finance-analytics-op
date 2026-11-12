-- =============================================================
-- P3 · 用量计费（unit-price × metered usage）
-- 目标：MySQL 8.0+，幂等可反复执行
-- =============================================================

SET NAMES utf8mb4;

-- ---------- recurring_costs 扩列：计费模式 + 单价 ----------
-- MySQL 8 无 ADD COLUMN IF NOT EXISTS，用 information_schema 判存保证幂等。
SET @exist := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'recurring_costs'
     AND COLUMN_NAME = 'pricing_mode'
);
SET @sql := IF(
  @exist = 0,
  'ALTER TABLE recurring_costs
     ADD COLUMN pricing_mode ENUM(''fixed'',''usage'') NOT NULL DEFAULT ''fixed'' AFTER cost_nature,
     ADD COLUMN unit_price     DECIMAL(18,6) NULL AFTER pricing_mode,
     ADD COLUMN unit_price_ccy CHAR(3) NOT NULL DEFAULT ''USD'' AFTER unit_price,
     ADD COLUMN unit_label     VARCHAR(16) NULL AFTER unit_price_ccy,
     ADD COLUMN meter_source   VARCHAR(24) NULL AFTER unit_label',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- 用量计量记录（每模板每期一行，幂等键 recurring_id + period） ----------
CREATE TABLE IF NOT EXISTS usage_records (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recurring_id   BIGINT UNSIGNED NOT NULL,
  project_id     BIGINT UNSIGNED NOT NULL,
  category_id    BIGINT UNSIGNED NOT NULL,
  period         CHAR(7) NOT NULL,                 -- 计费期：2026-10
  quantity       DECIMAL(18,4) NOT NULL,           -- 计量值（R2 为当月平均 GB）
  unit_label     VARCHAR(16) NOT NULL,             -- GB / TB / 万次请求
  unit_price     DECIMAL(18,6) NOT NULL,           -- 单价（快照）
  unit_price_ccy CHAR(3) NOT NULL DEFAULT 'USD',   -- 单价币种
  amount_src     DECIMAL(18,2) NOT NULL,           -- 原币金额 = quantity * unit_price
  fx_rate        DECIMAL(18,8) NOT NULL,           -- 1 USD = ? CNY 快照
  amount_cny     DECIMAL(18,2) NOT NULL,           -- 本位币金额
  source         VARCHAR(24) NOT NULL DEFAULT 'manual',  -- r2 / manual
  billed_on      DATE NOT NULL,                    -- 计费日（= 生成的流水日期）
  txn_id         BIGINT UNSIGNED NULL,             -- 生成的流水 id
  raw            JSON NULL,                        -- 采集原始返回
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_usage (recurring_id, period),
  KEY idx_period (period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
