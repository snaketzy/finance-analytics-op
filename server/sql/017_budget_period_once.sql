-- =============================================================
-- 017 · 预算周期类型增加「一次性」
-- budgets.period_type 由 ENUM('monthly','yearly') 扩为 ('monthly','yearly','once')。
-- 「一次性」的 period 仍为 YYYY-MM，取数区间与月度一致（仅语义上标记非经常性）。
-- 幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'budgets'
              AND COLUMN_NAME = 'period_type' AND COLUMN_TYPE LIKE '%once%'),
    'SELECT 1',
    'ALTER TABLE budgets MODIFY COLUMN period_type ENUM(''monthly'',''yearly'',''once'') NOT NULL DEFAULT ''monthly'''
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
