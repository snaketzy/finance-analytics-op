-- =============================================================
-- 016 · 科目说明字段
-- categories 增加 note（科目说明，用于记录该科目的口径与用途）。
-- 幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'note'),
    'SELECT 1',
    'ALTER TABLE categories ADD COLUMN note VARCHAR(255) NULL AFTER name_en'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
