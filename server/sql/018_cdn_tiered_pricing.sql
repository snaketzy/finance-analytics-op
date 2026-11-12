-- =============================================================
-- 018 · CDN 流量阶梯计价
-- product_econ_variables 增加两区的 CDN 阶梯单价（JSON 数组，固定 5 档：
-- 0-2TB / 2-10TB / 10-50TB / 50-100TB / >=100TB），按腾讯云 CDN
-- 「月度阶梯累进」口径计费：每档只对落入该档区间的流量计价，再求和。
-- 元素形如 {"upToTb": 2, "pricePerTbCny": 460}，末档 upToTb = null 表示无上限。
-- 保留 cdn_tierN_per_tb_cny 作为「阶梯缺失时的单档兜底」，历史快照仍可复现。
-- 幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables'
              AND COLUMN_NAME = 'cdn_tier1_tiers'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN cdn_tier1_tiers JSON NULL AFTER cdn_tier1_per_tb_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_econ_variables'
              AND COLUMN_NAME = 'cdn_tier2_tiers'),
    'SELECT 1',
    'ALTER TABLE product_econ_variables ADD COLUMN cdn_tier2_tiers JSON NULL AFTER cdn_tier2_per_tb_cny'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
