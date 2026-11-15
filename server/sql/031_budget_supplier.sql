-- 预算增加 supplier_id 维度，并用生成列统一 NULL 口径，支持：
--   1) 无供应商预算（supplier_id IS NULL）
--   2) 同一项目 / 科目 / 周期下按不同供应商分别建预算

SET @has_supplier = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'budgets' AND COLUMN_NAME = 'supplier_id'
);
SET @sql = IF(
  @has_supplier = 0,
  'ALTER TABLE budgets ADD COLUMN supplier_id BIGINT UNSIGNED NULL AFTER category_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_cat_key = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'budgets' AND COLUMN_NAME = 'budget_category_key'
);
SET @sql = IF(
  @has_cat_key = 0,
  'ALTER TABLE budgets ADD COLUMN budget_category_key BIGINT UNSIGNED AS (COALESCE(category_id, 0)) STORED AFTER supplier_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_sup_key = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'budgets' AND COLUMN_NAME = 'budget_supplier_key'
);
SET @sql = IF(
  @has_sup_key = 0,
  'ALTER TABLE budgets ADD COLUMN budget_supplier_key BIGINT UNSIGNED AS (COALESCE(supplier_id, 0)) STORED AFTER budget_category_key',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_old_key = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'budgets' AND INDEX_NAME = 'uk_budget'
);
SET @sql = IF(
  @has_old_key > 0,
  'ALTER TABLE budgets DROP INDEX uk_budget',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_scope_key = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'budgets' AND INDEX_NAME = 'uk_budget_scope'
);
SET @sql = IF(
  @has_scope_key = 0,
  'ALTER TABLE budgets ADD UNIQUE KEY uk_budget_scope (project_id, budget_category_key, budget_supplier_key, period)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
