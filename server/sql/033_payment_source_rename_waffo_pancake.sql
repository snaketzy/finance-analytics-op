-- =============================================================
-- P5 · 修正渠道命名：Waffo Pancake 是单一产品
-- 将历史占位值 waffo / pancake 合并为 waffo_pancake
-- =============================================================

SET NAMES utf8mb4;

ALTER TABLE payment_imports
  MODIFY COLUMN source ENUM('stripe','paypal','waffo','pancake','waffo_pancake','paddle','creem') NOT NULL;

UPDATE payment_imports
   SET source = 'waffo_pancake'
 WHERE source IN ('waffo', 'pancake');

ALTER TABLE payment_imports
  MODIFY COLUMN source ENUM('stripe','paypal','waffo_pancake','paddle','creem') NOT NULL;
