-- =============================================================
-- 020 · cf & THKCOS 全变量测算
-- 与 product_econ_variables（cf & CDN 版）并列的独立测算表：
--   · 双副本存储：R2 为主副本、腾讯云香港 COS 为镜像副本（同容量）
--   · 增量同步：R2 更新增量同步给 COS 的月度流量成本
--   · 流量：直连 COS 外网下行 / 经 CDN（CDN 边缘下行 + COS 回源）两套口径
-- 采用「按次保存的历史快照」语义（saved_at + 索引，无产品唯一键）。
-- 幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS product_thkcos_variables (
  id                        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id                BIGINT UNSIGNED NOT NULL,
  -- 基础设施（固定成本）
  vultr_monthly_cny         DECIMAL(18,2) NULL,   -- A 云主机月租
  domain_annual_cny         DECIMAL(18,2) NULL,   -- 域名年费
  ssl_annual_cny            DECIMAL(18,2) NULL,   -- SSL 证书年费
  -- 双副本存储（R2 + 腾讯云香港 COS）
  r2_storage_per_gb_cny     DECIMAL(18,6) NULL,   -- B R2 每 GB 月存储单价
  cos_storage_per_gb_cny    DECIMAL(18,6) NULL,   -- C 腾讯云 COS 每 GB 月存储单价
  library_titles            INT NULL,             -- D 片库影片数
  avg_title_gb              DECIMAL(12,3) NULL,   -- E 单片平均体积 GB
  -- 增量同步（R2 → COS）
  sync_gb_per_month         DECIMAL(18,3) NULL,   -- F 每月增量同步数据量 GB/月
  sync_per_gb_cny           DECIMAL(18,6) NULL,   -- G 同步入口流量单价 ¥/GB
  -- 流量（直连 COS / 经 CDN）
  traffic_mode              VARCHAR(16) NULL,     -- 计价模式：direct | cdn（空 = direct）
  viewers                   INT NULL,             -- H 月观看人数
  titles_per_viewer         DECIMAL(12,3) NULL,   -- I 人均月观看部数
  per_title_gb_low          DECIMAL(12,3) NULL,   -- J 单片流量下限 GB
  per_title_gb_high         DECIMAL(12,3) NULL,   -- K 单片流量上限 GB
  cache_hit_ratio           DECIMAL(9,6) NULL,    -- λ CDN 缓存命中率 0-1（仅 cdn 模式）
  cos_down_tiers            JSON NULL,            -- 直连：COS 外网下行阶梯（5 档 ¥/TB）
  cdn_edge_tiers            JSON NULL,            -- 经 CDN：CDN 边缘下行阶梯（5 档 ¥/TB）
  cos_origin_tiers          JSON NULL,            -- 经 CDN：COS 回源阶梯（5 档 ¥/TB）
  -- 订阅收入（月度确认口径）
  monthly_subs              INT NULL,             -- L1 月卡订阅人数
  monthly_price_cny         DECIMAL(18,2) NULL,   -- M1 月卡 ¥/月
  quarterly_subs            INT NULL,             -- L2 季卡订阅人数
  quarterly_price_cny       DECIMAL(18,2) NULL,   -- M2 季卡 ¥/月（实收 = ×3）
  yearly_subs               INT NULL,             -- L3 年卡订阅人数
  yearly_price_cny          DECIMAL(18,2) NULL,   -- M3 年卡 ¥/月（实收 = ×12）
  -- 推演参数
  viewer_growth             DECIMAL(9,6) NULL,    -- 观看人数月净增长率
  subscriber_growth         DECIMAL(9,6) NULL,    -- 订阅人数月净增长率
  horizon_months            INT NOT NULL DEFAULT 24,
  saved_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ptcv_product_savedat (product_id, saved_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
