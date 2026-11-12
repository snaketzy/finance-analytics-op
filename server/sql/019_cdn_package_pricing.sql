-- 019 · CDN 资源包（预付费流量包）计价
-- product_econ_variables 增加资源包口径，与「按量阶梯累进」并存，由
-- cdn_pricing_mode 决定当前生效口径：
--   tiered  = 按流量计费 · 月度阶梯累进（默认，沿用 018 的阶梯列）
--   package = 预付费流量包 · 按月覆盖流量的最优包组合
-- 资源包固定 6 档（100GB / 500GB / 1TB / 5TB / 10TB / 50TB），元素形如
-- {"sizeGb": 100, "listCny": 46, "renewCny": 42.8}：
--   listCny  = 单次购买（刊例价）
--   renewCny = 连续包月自动续订价
-- 由 cdn_package_price 选择使用哪一档（renew 默认 / list）。
-- 进制口径：1TB = 1000GB（与腾讯云 CDN 计费一致）。
SET NAMES utf8mb4;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables'
              AND COLUMN_NAME = 'cdn_pricing_mode'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN cdn_pricing_mode VARCHAR(16) NULL AFTER cdn_tier2_tiers'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables'
              AND COLUMN_NAME = 'cdn_package_price'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN cdn_package_price VARCHAR(16) NULL AFTER cdn_pricing_mode'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables'
              AND COLUMN_NAME = 'cdn_tier1_packages'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN cdn_tier1_packages JSON NULL AFTER cdn_package_price'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables'
              AND COLUMN_NAME = 'cdn_tier2_packages'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN cdn_tier2_packages JSON NULL AFTER cdn_tier1_packages'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
