-- =============================================================
-- P3 · Metered 计费（服务商直读金额，如 Vultr 账单）
-- 目标：MySQL 8.0+，幂等可反复执行
-- =============================================================

SET NAMES utf8mb4;

-- ---------- recurring_costs.pricing_mode 扩展枚举：加入 metered ----------
-- metered = 金额由服务商账单直读（不再走 单价 × 用量 的乘积）。
-- MODIFY COLUMN 重跑结果一致，天然幂等。
ALTER TABLE recurring_costs
  MODIFY COLUMN pricing_mode ENUM('fixed','usage','metered') NOT NULL DEFAULT 'fixed';
