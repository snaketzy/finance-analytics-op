-- 027_viewer_segments.sql
-- 把「月观看人数 / 人均月观影分钟 / 每分钟流量上下限」拆为「普通用户」与「重度用户」两组。
-- 旧数据整体迁入 regular_*（普通用户），heavy_* 默认 NULL。
-- 采用与 024/025/026 一致的幂等模式：information_schema 检查 + PREPARE/EXECUTE。

-- 对单表执行拆分的存储过程（用 session 变量拼 DDL，避免 DELIMITER 问题）。
SET @tbl = 'product_econ_variables';

-- 1) 旧列存在且 regular_viewers 不存在时：一次性加 8 列并迁数据
SET @has_old = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'viewers');
SET @has_reg = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'regular_viewers');
SET @ddl = IF(@has_old > 0 AND @has_reg = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN regular_viewers DECIMAL(12,3) NULL COMMENT ''H1 普通用户月观看人数'', ADD COLUMN heavy_viewers DECIMAL(12,3) NULL COMMENT ''H2 重度用户月观看人数'', ADD COLUMN regular_minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I1 普通用户人均月观影分钟数'', ADD COLUMN heavy_minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I2 重度用户人均月观影分钟数'', ADD COLUMN regular_per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J1 普通用户每分钟流量下限 MB'', ADD COLUMN heavy_per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J2 重度用户每分钟流量下限 MB'', ADD COLUMN regular_per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K1 普通用户每分钟流量上限 MB'', ADD COLUMN heavy_per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K2 重度用户每分钟流量上限 MB'''),
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @upd = IF(@has_old > 0 AND @has_reg = 0,
  CONCAT('UPDATE `', @tbl, '` SET regular_viewers = viewers, regular_minutes_per_viewer = minutes_per_viewer, regular_per_min_mb_low = per_min_mb_low, regular_per_min_mb_high = per_min_mb_high'),
  'SELECT 1');
PREPARE stmt FROM @upd; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) 逐个补齐可能缺失的新列（幂等）
SET @col = 'regular_viewers';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''H1 普通用户月观看人数'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'heavy_viewers';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''H2 重度用户月观看人数'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'regular_minutes_per_viewer';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''I1 普通用户人均月观影分钟数'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'heavy_minutes_per_viewer';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''I2 重度用户人均月观影分钟数'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'regular_per_min_mb_low';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''J1 普通用户每分钟流量下限 MB'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'heavy_per_min_mb_low';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''J2 重度用户每分钟流量下限 MB'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'regular_per_min_mb_high';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''K1 普通用户每分钟流量上限 MB'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'heavy_per_min_mb_high';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''K2 重度用户每分钟流量上限 MB'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) 逐个删除旧列（幂等：每列单独检查，避免某列已删时整条语句失败）
SET @col = 'viewers';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) > 0,
  CONCAT('ALTER TABLE `', @tbl, '` DROP COLUMN ', @col), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'minutes_per_viewer';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) > 0,
  CONCAT('ALTER TABLE `', @tbl, '` DROP COLUMN ', @col), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'per_min_mb_low';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) > 0,
  CONCAT('ALTER TABLE `', @tbl, '` DROP COLUMN ', @col), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'per_min_mb_high';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) > 0,
  CONCAT('ALTER TABLE `', @tbl, '` DROP COLUMN ', @col), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========== 同样处理 product_thkcos_variables ==========
SET @tbl = 'product_thkcos_variables';

SET @has_old = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'viewers');
SET @has_reg = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'regular_viewers');
SET @ddl = IF(@has_old > 0 AND @has_reg = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN regular_viewers DECIMAL(12,3) NULL COMMENT ''H1 普通用户月观看人数'', ADD COLUMN heavy_viewers DECIMAL(12,3) NULL COMMENT ''H2 重度用户月观看人数'', ADD COLUMN regular_minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I1 普通用户人均月观影分钟数'', ADD COLUMN heavy_minutes_per_viewer DECIMAL(12,3) NULL COMMENT ''I2 重度用户人均月观影分钟数'', ADD COLUMN regular_per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J1 普通用户每分钟流量下限 MB'', ADD COLUMN heavy_per_min_mb_low DECIMAL(12,3) NULL COMMENT ''J2 重度用户每分钟流量下限 MB'', ADD COLUMN regular_per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K1 普通用户每分钟流量上限 MB'', ADD COLUMN heavy_per_min_mb_high DECIMAL(12,3) NULL COMMENT ''K2 重度用户每分钟流量上限 MB'''),
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @upd = IF(@has_old > 0 AND @has_reg = 0,
  CONCAT('UPDATE `', @tbl, '` SET regular_viewers = viewers, regular_minutes_per_viewer = minutes_per_viewer, regular_per_min_mb_low = per_min_mb_low, regular_per_min_mb_high = per_min_mb_high'),
  'SELECT 1');
PREPARE stmt FROM @upd; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'regular_viewers';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''H1 普通用户月观看人数'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'heavy_viewers';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''H2 重度用户月观看人数'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'regular_minutes_per_viewer';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''I1 普通用户人均月观影分钟数'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'heavy_minutes_per_viewer';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''I2 重度用户人均月观影分钟数'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'regular_per_min_mb_low';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''J1 普通用户每分钟流量下限 MB'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'heavy_per_min_mb_low';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''J2 重度用户每分钟流量下限 MB'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'regular_per_min_mb_high';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''K1 普通用户每分钟流量上限 MB'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'heavy_per_min_mb_high';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN ', @col, ' DECIMAL(12,3) NULL COMMENT ''K2 重度用户每分钟流量上限 MB'''), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'viewers';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) > 0,
  CONCAT('ALTER TABLE `', @tbl, '` DROP COLUMN ', @col), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'minutes_per_viewer';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) > 0,
  CONCAT('ALTER TABLE `', @tbl, '` DROP COLUMN ', @col), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'per_min_mb_low';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) > 0,
  CONCAT('ALTER TABLE `', @tbl, '` DROP COLUMN ', @col), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'per_min_mb_high';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) > 0,
  CONCAT('ALTER TABLE `', @tbl, '` DROP COLUMN ', @col), 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
