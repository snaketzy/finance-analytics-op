-- =============================================================
-- P3 · Stripe / PayPal 收入同步导入（幂等）
-- 一笔渠道交易 → 毛额收入（income）+ 手续费支出（expense）两条流水
-- =============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS payment_imports (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source          ENUM('stripe','paypal') NOT NULL,
  source_key      VARCHAR(191) NOT NULL,          -- 渠道交易唯一 ID（Stripe balance transaction id / PayPal transaction id）
  billing_period  CHAR(7) NOT NULL,
  source_name     VARCHAR(255) NOT NULL,
  reference       VARCHAR(128) NULL,              -- 渠道参考号 / 发票号
  counterparty    VARCHAR(128) NULL,
  project_id      BIGINT UNSIGNED NOT NULL,
  category_id     BIGINT UNSIGNED NOT NULL,       -- 收入科目
  fee_category_id BIGINT UNSIGNED NULL,           -- 手续费科目
  account_id      BIGINT UNSIGNED NULL,           -- 关联的渠道资金账户
  txn_date        DATE NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'USD',
  gross_src       DECIMAL(18,4) NOT NULL,         -- 毛额（收入）
  fee_src         DECIMAL(18,4) NOT NULL DEFAULT 0,
  net_src         DECIMAL(18,4) NOT NULL DEFAULT 0,
  fx_rate         DECIMAL(18,8) NOT NULL,
  gross_cny       DECIMAL(18,2) NOT NULL DEFAULT 0,
  fee_cny         DECIMAL(18,2) NOT NULL DEFAULT 0,
  net_cny         DECIMAL(18,2) NOT NULL DEFAULT 0,
  txn_id          BIGINT UNSIGNED NULL,           -- 毛额收入流水
  fee_txn_id      BIGINT UNSIGNED NULL,           -- 手续费支出流水
  raw             JSON NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pay_source_key (source, source_key),
  KEY idx_pay_period (billing_period),
  KEY idx_pay_txn (txn_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
