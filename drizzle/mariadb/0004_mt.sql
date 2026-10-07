-- MetaTrader synchronizace (docs/superpowers/specs/2026-10-07-mt-sync-design.md)
CREATE TABLE IF NOT EXISTS mt_keys(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  name VARCHAR(60) NOT NULL DEFAULT '',
  key_hash CHAR(64) NOT NULL UNIQUE,
  prefix CHAR(9) NOT NULL,
  created DATETIME NOT NULL,
  last_used DATETIME NULL,
  revoked DATETIME NULL,
  INDEX mt_keys_user(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mt_accounts(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  platform VARCHAR(3) NOT NULL,
  login VARCHAR(80) NOT NULL,
  server VARCHAR(64) NOT NULL,
  company VARCHAR(64) NOT NULL DEFAULT '',
  currency VARCHAR(8) NOT NULL DEFAULT '',
  leverage INT NOT NULL DEFAULT 0,
  mode VARCHAR(8) NOT NULL DEFAULT '',
  name VARCHAR(64) NOT NULL DEFAULT '',
  ea_version VARCHAR(64) NOT NULL DEFAULT '',
  last_seen DATETIME NULL,
  balance DOUBLE NULL,
  equity DOUBLE NULL,
  created DATETIME NOT NULL,
  UNIQUE KEY mt_accounts_uniq(user_id,server,login)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mt_events(
  account_id VARCHAR(40) NOT NULL,
  event_id VARCHAR(80) NOT NULL,
  type VARCHAR(16) NOT NULL,
  position VARCHAR(40) NULL,
  ts BIGINT NOT NULL,
  payload LONGTEXT NOT NULL,
  received DATETIME NOT NULL,
  PRIMARY KEY(account_id,event_id),
  INDEX mt_events_pos(account_id,position,ts),
  INDEX mt_events_type(account_id,type,ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mt_positions(
  id VARCHAR(90) NOT NULL PRIMARY KEY,
  account_id VARCHAR(40) NOT NULL,
  ticket VARCHAR(48) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  side VARCHAR(4) NOT NULL,
  status VARCHAR(6) NOT NULL,
  open_ts BIGINT NOT NULL,
  close_ts BIGINT NULL,
  open_price DOUBLE NOT NULL,
  close_price_avg DOUBLE NULL,
  volume_max DOUBLE NOT NULL,
  sl_initial DOUBLE NULL, tp_initial DOUBLE NULL, sl_last DOUBLE NULL, tp_last DOUBLE NULL,
  profit DOUBLE NOT NULL DEFAULT 0, commission DOUBLE NOT NULL DEFAULT 0, swap DOUBLE NOT NULL DEFAULT 0, fee DOUBLE NOT NULL DEFAULT 0, net DOUBLE NOT NULL DEFAULT 0,
  magic BIGINT NOT NULL DEFAULT 0,
  comment VARCHAR(64) NOT NULL DEFAULT '',
  tags VARCHAR(255) NOT NULL DEFAULT '',
  tags_manual VARCHAR(255) NOT NULL DEFAULT '',
  note TEXT NULL,
  open_reason VARCHAR(64) NOT NULL DEFAULT '',
  close_reason VARCHAR(64) NULL,
  mfe_money DOUBLE NULL, mae_money DOUBLE NULL, mfe_price DOUBLE NULL, mae_price DOUBLE NULL,
  mfe_partial TINYINT(1) NOT NULL DEFAULT 0,
  spread_entry DOUBLE NULL, slippage_points DOUBLE NULL,
  risk_money DOUBLE NULL, risk_pct DOUBLE NULL, rr_planned DOUBLE NULL, r_result DOUBLE NULL,
  updated DATETIME NOT NULL,
  UNIQUE KEY mt_positions_ticket(account_id,ticket),
  INDEX mt_positions_close(account_id,status,close_ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mt_position_changes(
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  position_id VARCHAR(90) NOT NULL,
  ts BIGINT NOT NULL,
  kind VARCHAR(16) NOT NULL,
  old_value DOUBLE NULL, new_value DOUBLE NULL, price DOUBLE NULL, volume DOUBLE NULL,
  reason VARCHAR(64) NULL,
  INDEX mt_changes_pos(position_id,ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mt_orders(
  account_id VARCHAR(40) NOT NULL,
  ticket VARCHAR(48) NOT NULL,
  symbol VARCHAR(32) NOT NULL DEFAULT '',
  order_type VARCHAR(64) NOT NULL DEFAULT '',
  state VARCHAR(12) NOT NULL,
  volume DOUBLE NOT NULL DEFAULT 0,
  price_open DOUBLE NOT NULL DEFAULT 0,
  price_requested DOUBLE NOT NULL DEFAULT 0,
  sl DOUBLE NOT NULL DEFAULT 0, tp DOUBLE NOT NULL DEFAULT 0,
  placed_ts BIGINT NOT NULL,
  updated_ts BIGINT NOT NULL,
  done_ts BIGINT NULL,
  comment VARCHAR(64) NOT NULL DEFAULT '',
  magic BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,ticket)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mt_snapshots(
  account_id VARCHAR(40) NOT NULL,
  ts BIGINT NOT NULL,
  balance DOUBLE NOT NULL, equity DOUBLE NOT NULL, margin DOUBLE NOT NULL, floating DOUBLE NOT NULL,
  PRIMARY KEY(account_id,ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS fx_rates(
  date DATE NOT NULL,
  currency CHAR(3) NOT NULL,
  per_eur DOUBLE NOT NULL,
  PRIMARY KEY(date,currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
ALTER TABLE members ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'USD';
