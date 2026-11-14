-- =============================================================
-- 022 · cf & THKCOS 流量链路从「传统 CDN」切换为 EdgeOne (EO)
-- 腾讯云 CDN 已全面升级为 EdgeOne 3.0，新开通用户只能走 EO。
-- EO 计费结构：套餐订阅（月费 + 内含流量）→ 全球流量包（按地区抵扣系数换算）→ 超量阶梯。
-- 本迁移：
--   1) 重命名 cdn_edge_tiers   → eo_overage_tiers  （超量阶梯，¥/TB）
--   2) 重命名 cdn_edge_packages → eo_packages        （全球流量包，6 档 list/renew）
--   3) 新增 eo_plan_monthly_cny   套餐月费（如个人版 29.9）
--   4) 新增 eo_plan_included_gb   套餐内含流量（如个人版 50 GB/月）
--   5) 新增 eo_deduction_ratio    地区抵扣系数（亚太1区 = 2.49，即 1GB 流量包只抵 1/2.49 GB 流量）
-- COS 回源 (cos_origin_tiers) 与直连 COS (cos_down_tiers / cos_down_packages) 不变。
-- 幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

-- 1) cdn_edge_tiers → eo_overage_tiers
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'eo_overage_tiers'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
                AND COLUMN_NAME = 'cdn_edge_tiers'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN cdn_edge_tiers eo_overage_tiers JSON NULL',
      'ALTER TABLE product_thkcos_variables ADD COLUMN eo_overage_tiers JSON NULL AFTER cos_origin_tiers'
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) cdn_edge_packages → eo_packages
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'eo_packages'),
    'SELECT 1',
    IF(
      EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
                AND COLUMN_NAME = 'cdn_edge_packages'),
      'ALTER TABLE product_thkcos_variables CHANGE COLUMN cdn_edge_packages eo_packages JSON NULL',
      'ALTER TABLE product_thkcos_variables ADD COLUMN eo_packages JSON NULL AFTER cos_down_packages'
    )
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) eo_plan_monthly_cny
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'eo_plan_monthly_cny'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN eo_plan_monthly_cny DECIMAL(12,4) NULL AFTER eo_packages'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) eo_plan_included_gb
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'eo_plan_included_gb'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN eo_plan_included_gb DECIMAL(12,4) NULL AFTER eo_plan_monthly_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5) eo_deduction_ratio
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_thkcos_variables'
              AND COLUMN_NAME = 'eo_deduction_ratio'),
    'SELECT 1',
    'ALTER TABLE product_thkcos_variables ADD COLUMN eo_deduction_ratio DECIMAL(6,3) NULL AFTER eo_plan_included_gb'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
