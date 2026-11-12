-- =============================================================
-- P3 · 扩展 transactions.ref_id 长度
-- 账单/用量导入写入的幂等键形如 `usage:<sha256>` / `invoice:<sha256>`
-- （最长 72 字符），原 varchar(64) 会触发 ER_DATA_TOO_LONG。
-- 幂等：MODIFY COLUMN 可重复执行。
-- =============================================================

SET NAMES utf8mb4;

ALTER TABLE transactions MODIFY COLUMN ref_id VARCHAR(191) DEFAULT NULL;
