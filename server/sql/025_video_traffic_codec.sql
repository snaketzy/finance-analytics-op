-- =============================================================
-- 025 · 视频流量测算区分编码（HEVC / H264）
-- 仅 HEVC 有 4K 档；H264 最高 1080P。
--   1) 新增 codec 列（HEVC / H264），旧行默认归入 HEVC
--   2) 唯一键由 (resolution) 改为 (codec, resolution)
--   3) 补齐占位档位：HEVC 5 档（含 4K）+ H264 4 档（无 4K）
-- 幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

-- 1) 新增 codec 列（旧行默认 'HEVC'）
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'video_traffic_bitrates'
              AND COLUMN_NAME = 'codec'),
    'SELECT 1',
    'ALTER TABLE video_traffic_bitrates ADD COLUMN codec VARCHAR(8) NOT NULL DEFAULT ''HEVC'' COMMENT ''编码：HEVC / H264'' AFTER id'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) 删除旧唯一键 uk_vtb_resolution（单 resolution 维度）
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'video_traffic_bitrates'
              AND INDEX_NAME = 'uk_vtb_resolution'),
    'ALTER TABLE video_traffic_bitrates DROP INDEX uk_vtb_resolution',
    'SELECT 1'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) 新增唯一键 uk_vtb_codec_resolution (codec, resolution)
SET @ddl := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'video_traffic_bitrates'
              AND INDEX_NAME = 'uk_vtb_codec_resolution'),
    'SELECT 1',
    'ALTER TABLE video_traffic_bitrates ADD UNIQUE KEY uk_vtb_codec_resolution (codec, resolution)'
  )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) 补齐占位档位（已存在则跳过）
INSERT IGNORE INTO video_traffic_bitrates (codec, resolution) VALUES
  ('HEVC', '4K'), ('HEVC', '1080P'), ('HEVC', '720P'), ('HEVC', '480P'), ('HEVC', '360P'),
  ('H264', '1080P'), ('H264', '720P'), ('H264', '480P'), ('H264', '360P');
