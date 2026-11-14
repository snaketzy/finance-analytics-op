-- =============================================================
-- 024 · 视频流量测算（全局共用）
-- 按分辨率档位记录「体积 / 时长 / 每分钟流量」，作为码率参考数据。
-- 与产品无关（全局一份），固定 5 档：4K / 1080P / 720P / 480P / 360P。
-- 幂等，可反复执行。
-- =============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS video_traffic_bitrates (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resolution    VARCHAR(16) NOT NULL,              -- 分辨率档位：4K / 1080P / 720P / 480P / 360P
  size_gb       DECIMAL(18,3) NULL,                -- 体积 GB
  duration_min  DECIMAL(18,3) NULL,                -- 时长 min
  per_min_gb    DECIMAL(18,6) NULL,                -- 每分钟流量 GB/min = 体积 / 时长
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_vtb_resolution (resolution)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 固定 5 档占位（已存在则跳过）
INSERT IGNORE INTO video_traffic_bitrates (resolution) VALUES
  ('4K'), ('1080P'), ('720P'), ('480P'), ('360P');
