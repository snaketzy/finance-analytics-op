-- =============================================================
-- P4 · 产品盈利模型（Unit Economics）
-- 每产品 × 三档情景（中性/乐观/悲观）各存一套模型假设；
-- 实际收入/成本由 transactions 反推（变动成本 = categories.is_cogs=1），
-- 假设仅保存用户可调参数与覆盖项。幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS product_model_inputs (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id        BIGINT UNSIGNED NOT NULL,
  scenario          ENUM('neutral','optimistic','pessimistic') NOT NULL DEFAULT 'neutral',
  mau               DECIMAL(18,2) NULL,   -- 月活跃用户
  paying_ratio      DECIMAL(9,6)  NULL,   -- 付费率 0-1
  arppu_cny         DECIMAL(18,2) NULL,   -- 每付费用户月均收入；NULL=按实际收入反推
  monthly_churn     DECIMAL(9,6)  NULL,   -- 月度付费流失率 0-1
  monthly_growth    DECIMAL(9,6)  NULL,   -- 月度 MAU 净增长率，如 0.05
  fixed_cost_cny    DECIMAL(18,2) NULL,   -- 月固定成本覆盖；NULL=按实际
  unit_var_cost_cny DECIMAL(18,2) NULL,   -- 单位活跃用户月变动成本覆盖；NULL=按实际
  horizon_months    INT NOT NULL DEFAULT 24,
  lookback_months   INT NOT NULL DEFAULT 3,
  -- 预留：未来对接外部会员/埋点系统时记录数据来源与原始字段
  source            VARCHAR(24) NOT NULL DEFAULT 'manual',
  extra             JSON NULL,
  thresholds        JSON NULL,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_proj_scenario (project_id, scenario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
