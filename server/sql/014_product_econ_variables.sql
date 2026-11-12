-- =============================================================
-- P5 · 产品经营变量测算（全变量成本 / 收入模型）
-- 按产品保存一套物理量输入（Vultr / 域名 / SSL / R2 存储 / CDN 流量 / 订阅收入），
-- 供「盈利模型 · 全变量测算」Tab 做动态盈亏测算。幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS product_econ_variables (
  id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id              BIGINT UNSIGNED NOT NULL,
  -- 基础设施（固定成本）
  vultr_monthly_cny       DECIMAL(18,2) NULL,   -- A 云主机月租
  domain_annual_cny       DECIMAL(18,2) NULL,   -- 域名年费
  ssl_annual_cny          DECIMAL(18,2) NULL,   -- SSL 证书年费
  -- R2 对象存储
  r2_storage_per_gb_cny   DECIMAL(18,6) NULL,   -- B 每 GB 月存储单价
  r2_class_a_monthly_cny  DECIMAL(18,2) NULL,   -- C 每月 Class A 操作费
  library_titles          INT NULL,             -- D 片库影片数
  avg_title_gb            DECIMAL(12,3) NULL,   -- E 单片平均体积 GB
  -- 腾讯云香港 CDN
  cdn_tier1_per_tb_cny    DECIMAL(18,2) NULL,   -- F 亚太一区 ¥/TB
  cdn_tier2_per_tb_cny    DECIMAL(18,2) NULL,   -- G 亚太二区 ¥/TB
  tier1_share             DECIMAL(9,6) NULL,    -- α 亚太一区流量占比 0-1
  viewers                 INT NULL,             -- H 月观看人数
  titles_per_viewer       DECIMAL(12,3) NULL,   -- I 人均月观看部数
  per_title_gb_low        DECIMAL(12,3) NULL,   -- J 单片流量下限 GB
  per_title_gb_high       DECIMAL(12,3) NULL,   -- K 单片流量上限 GB
  -- 订阅收入（月度确认口径）
  monthly_subs            INT NULL,             -- L1 月卡订阅人数
  monthly_price_cny       DECIMAL(18,2) NULL,   -- M1 月卡 ¥/月
  quarterly_subs          INT NULL,             -- L2 季卡订阅人数
  quarterly_price_cny     DECIMAL(18,2) NULL,   -- M2 季卡 ¥/月（实收 = ×3）
  yearly_subs             INT NULL,             -- L3 年卡订阅人数
  yearly_price_cny        DECIMAL(18,2) NULL,   -- M3 年卡 ¥/月（实收 = ×12）
  -- 推演参数
  viewer_growth           DECIMAL(9,6) NULL,    -- 观看人数月净增长率
  subscriber_growth       DECIMAL(9,6) NULL,    -- 订阅人数月净增长率
  horizon_months          INT NOT NULL DEFAULT 24,
  updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_econ_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
