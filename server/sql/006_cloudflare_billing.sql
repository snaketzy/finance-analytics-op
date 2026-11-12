-- =============================================================
-- P3 · Cloudflare billable usage and invoice imports
-- Idempotent for MySQL 8.0+
-- =============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS cloudflare_cost_imports (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_key    VARCHAR(191) NOT NULL,
  source_type   ENUM('usage','invoice') NOT NULL,
  billing_period CHAR(7) NOT NULL,
  source_name   VARCHAR(255) NOT NULL,
  invoice_no    VARCHAR(128) NULL,
  document_hash CHAR(64) NULL,
  project_id    BIGINT UNSIGNED NOT NULL,
  category_id   BIGINT UNSIGNED NOT NULL,
  direction     ENUM('income','expense') NOT NULL DEFAULT 'expense',
  txn_date      DATE NOT NULL,
  currency      CHAR(3) NOT NULL DEFAULT 'USD',
  amount_src    DECIMAL(18,4) NOT NULL,
  fx_rate       DECIMAL(18,8) NOT NULL,
  amount_cny    DECIMAL(18,2) NOT NULL,
  txn_id        BIGINT UNSIGNED NULL,
  raw           JSON NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cf_source_key (source_key),
  KEY idx_cf_period (billing_period),
  KEY idx_cf_invoice (invoice_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
