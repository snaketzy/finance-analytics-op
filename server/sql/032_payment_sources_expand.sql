-- =============================================================
-- P5 · 支付渠道扩展（Waffo Pancake / Paddle / Creem）
-- 仅扩展来源枚举；实际 API 同步可后续逐渠道接入
-- =============================================================

SET NAMES utf8mb4;

ALTER TABLE payment_imports
  MODIFY COLUMN source ENUM('stripe','paypal','waffo_pancake','paddle','creem') NOT NULL;
