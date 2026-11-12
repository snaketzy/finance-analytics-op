-- =============================================================
-- P3 · 周期成本关联供应商
-- recurring_costs 增加 supplier_id（→ suppliers）；生成 / 计费流水时，
-- 交易对手优先取供应商名称。MySQL 8.0 不支持 ADD COLUMN IF NOT EXISTS，
-- 故用 information_schema 判断 + 动态 SQL，保证可反复执行。
-- =============================================================

SET NAMES utf8mb4;

SET @has_col := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'recurring_costs'
     AND column_name = 'supplier_id'
);
SET @ddl := IF(
  @has_col = 0,
  'ALTER TABLE recurring_costs ADD COLUMN supplier_id BIGINT UNSIGNED NULL AFTER category_id, ADD KEY idx_recurring_supplier (supplier_id)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
