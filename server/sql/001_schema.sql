-- =============================================================
-- FBAP 项目财务与经营分析平台 · 数据库结构
-- 目标：MySQL 8.0+（使用窗口函数 / CTE / 生成列）
-- 记账本位币：CNY，自动折算 USD
-- =============================================================

SET NAMES utf8mb4;

-- ---------- 项目 ----------
CREATE TABLE IF NOT EXISTS projects (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(32)  NOT NULL UNIQUE,
  name_cn     VARCHAR(64)  NOT NULL,
  name_en     VARCHAR(64)  NOT NULL,
  status      ENUM('active','paused','archived') NOT NULL DEFAULT 'active',
  launch_date DATE NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 资金账户 ----------
CREATE TABLE IF NOT EXISTS accounts (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name_cn             VARCHAR(64) NOT NULL,
  name_en             VARCHAR(64) NOT NULL,
  type                ENUM('cash','bank','platform','credit','virtual') NOT NULL DEFAULT 'cash',
  currency            CHAR(3) NOT NULL DEFAULT 'CNY',
  opening_balance_cny DECIMAL(18,2) NOT NULL DEFAULT 0,
  sort_order          INT NOT NULL DEFAULT 0,
  status              TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 收支科目（树形 + 领域） ----------
CREATE TABLE IF NOT EXISTS categories (
  id           BIGINT UNSIGNED PRIMARY KEY,
  parent_id    BIGINT UNSIGNED NULL,
  name_cn      VARCHAR(64) NOT NULL,
  name_en      VARCHAR(64) NOT NULL,
  type         ENUM('income','expense') NOT NULL,
  domain       VARCHAR(24) NOT NULL,
  is_recurring TINYINT(1) NOT NULL DEFAULT 0,
  is_cogs      TINYINT(1) NOT NULL DEFAULT 0,
  sort_order   INT NOT NULL DEFAULT 0,
  status       TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_tree (parent_id, type, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 汇率快照 ----------
CREATE TABLE IF NOT EXISTS fx_rates (
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rate_date DATE          NOT NULL,
  base_ccy  CHAR(3)       NOT NULL DEFAULT 'CNY',
  quote_ccy CHAR(3)       NOT NULL DEFAULT 'USD',
  rate      DECIMAL(18,8) NOT NULL,   -- 1 USD = ? CNY
  source    VARCHAR(32)   NOT NULL DEFAULT 'manual',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_fx (rate_date, base_ccy, quote_ccy)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 流水 ----------
CREATE TABLE IF NOT EXISTS transactions (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id  BIGINT UNSIGNED NOT NULL,
  account_id  BIGINT UNSIGNED NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  direction   ENUM('income','expense') NOT NULL,
  txn_date    DATE NOT NULL,
  amount_cny  DECIMAL(18,2) NOT NULL,
  fx_rate     DECIMAL(18,8) NOT NULL,
  amount_usd  DECIMAL(18,2) AS (ROUND(amount_cny / NULLIF(fx_rate,0), 2)) STORED,
  src_currency CHAR(3) NOT NULL DEFAULT 'CNY',
  src_amount  DECIMAL(18,2) NULL,
  is_recurring TINYINT(1) NOT NULL DEFAULT 0,
  recurring_id BIGINT UNSIGNED NULL,
  counterparty VARCHAR(128) NULL,
  ref_type    VARCHAR(24) NULL,
  ref_id      VARCHAR(64) NULL,
  note        VARCHAR(255) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_proj_date (project_id, txn_date),
  KEY idx_cat (category_id, txn_date),
  KEY idx_dir_date (direction, txn_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 周期性运营成本 ----------
CREATE TABLE IF NOT EXISTS recurring_costs (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id    BIGINT UNSIGNED NOT NULL,
  category_id   BIGINT UNSIGNED NOT NULL,
  name_cn       VARCHAR(64) NOT NULL,
  name_en       VARCHAR(64) NOT NULL,
  amount_cny    DECIMAL(18,2) NOT NULL,
  cycle         ENUM('monthly','quarterly','yearly') NOT NULL DEFAULT 'monthly',
  cost_nature   ENUM('fixed','variable') NOT NULL DEFAULT 'fixed',
  start_date    DATE NOT NULL,
  end_date      DATE NULL,
  auto_generate TINYINT(1) NOT NULL DEFAULT 1,
  last_gen_date DATE NULL,
  status        TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 预算 ----------
CREATE TABLE IF NOT EXISTS budgets (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id  BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  period      CHAR(7) NOT NULL,
  period_type ENUM('monthly','yearly') NOT NULL DEFAULT 'monthly',
  amount_cny  DECIMAL(18,2) NOT NULL,
  UNIQUE KEY uk_budget (project_id, category_id, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 产品用户（被分析对象） ----------
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id    BIGINT UNSIGNED NOT NULL,
  device_id     VARCHAR(64) NULL,
  channel       VARCHAR(32) NULL,
  region        VARCHAR(16) NULL,
  registered_at DATETIME NULL,
  first_paid_at DATETIME NULL,
  plan          VARCHAR(24) NULL,
  status        ENUM('free','active','churned') NOT NULL DEFAULT 'free',
  UNIQUE KEY uk_proj_device (project_id, device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 订阅 ----------
CREATE TABLE IF NOT EXISTS subscriptions (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id            BIGINT UNSIGNED NOT NULL,
  project_id         BIGINT UNSIGNED NOT NULL,
  plan               VARCHAR(24) NOT NULL,
  price_cny          DECIMAL(18,2) NOT NULL,
  cycle              ENUM('monthly','quarterly','yearly') NOT NULL DEFAULT 'monthly',
  started_at         DATETIME NOT NULL,
  current_period_end DATETIME NULL,
  canceled_at        DATETIME NULL,
  status             ENUM('active','canceled','expired') NOT NULL DEFAULT 'active',
  KEY idx_proj_status (project_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 行为事件 ----------
CREATE TABLE IF NOT EXISTS user_events (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  event_name VARCHAR(48) NOT NULL,
  event_time DATETIME NOT NULL,
  props      JSON NULL,
  KEY idx_evt (project_id, event_name, event_time),
  KEY idx_user (user_id, event_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 凭证附件 ----------
CREATE TABLE IF NOT EXISTS attachments (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  txn_id     BIGINT UNSIGNED NULL,
  file_name  VARCHAR(255) NOT NULL,
  url        VARCHAR(512) NOT NULL,
  size_bytes BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_txn (txn_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 审计日志 ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor      VARCHAR(64) NULL,
  action     VARCHAR(32) NOT NULL,
  entity     VARCHAR(32) NOT NULL,
  entity_id  VARCHAR(64) NULL,
  payload    JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_entity (entity, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 预测场景 ----------
CREATE TABLE IF NOT EXISTS forecast_scenarios (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id     BIGINT UNSIGNED NULL,
  name_cn        VARCHAR(64) NOT NULL,
  name_en        VARCHAR(64) NOT NULL,
  horizon_months INT NOT NULL DEFAULT 24,
  assumptions    JSON NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS forecast_entries (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id  BIGINT UNSIGNED NOT NULL,
  period       CHAR(7) NOT NULL,
  revenue_cny  DECIMAL(18,2) NOT NULL,
  cost_cny     DECIMAL(18,2) NOT NULL,
  net_cash_cny DECIMAL(18,2) NOT NULL,
  fx_rate      DECIMAL(18,8) NOT NULL,
  KEY idx_scen (scenario_id, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
