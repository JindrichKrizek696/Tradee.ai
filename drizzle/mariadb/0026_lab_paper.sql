-- Laboratoř · Simulace (jen vlastník): virtuální účet 100 000 Kč obchodující podle nejsilnějších signálů Tradee.
-- NA VPS SPUSTIT RUČNĚ: cd ~/tradee && python3 scripts/mariadb-migrate.py ; běh simulace přidává scripts/refresh-live.sh (scripts/lab-paper.mjs).
-- Každá tabulka má user_id vlastníka. Žádná admin routa ani export tyto tabulky nečte (lib/admin/* je nezná).
-- rules_version u účtu i u každého obchodu: pozdější změna pravidel nepřepíše historii (lib/lab/paper.ts PAPER_RULES_VERSION).
CREATE TABLE IF NOT EXISTS lab_paper_accounts(
  user_id VARCHAR(128) NOT NULL PRIMARY KEY,
  start_equity DECIMAL(14,2) NOT NULL,
  started DATETIME NOT NULL,
  rules_version VARCHAR(20) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  updated DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- opened/closed = čas UTC; exit_price = cena výstupu (EXIT je v MariaDB/MySQL rezervované slovo); r a pnl_czk podle pravidel v rules_version
CREATE TABLE IF NOT EXISTS lab_paper_trades(
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  instrument VARCHAR(16) NOT NULL,
  direction VARCHAR(5) NOT NULL,
  opened DATETIME(3) NOT NULL,
  entry DOUBLE NOT NULL,
  sl DOUBLE NOT NULL,
  tp DOUBLE NOT NULL,
  risk_czk DECIMAL(12,2) NOT NULL,
  confidence TINYINT UNSIGNED NOT NULL,
  score_at_entry DOUBLE NOT NULL,
  parts_at_entry LONGTEXT NOT NULL,
  why TEXT NOT NULL,
  closed DATETIME(3) NULL,
  exit_price DOUBLE NULL,
  exit_reason VARCHAR(10) NULL,
  r DOUBLE NULL,
  pnl_czk DECIMAL(12,2) NULL,
  pct DOUBLE NULL,
  score_at_exit DOUBLE NULL,
  result_note TEXT NULL,
  rules_version VARCHAR(20) NOT NULL,
  INDEX lab_paper_trades_user(user_id,closed),
  INDEX lab_paper_trades_inst(user_id,instrument,opened)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- snímek po každém běhu (slot 15 min): equity = uzavřený zůstatek, open_pnl = otevřené pozice podle živé ceny
CREATE TABLE IF NOT EXISTS lab_paper_equity(
  user_id VARCHAR(128) NOT NULL,
  at DATETIME NOT NULL,
  equity DECIMAL(14,2) NOT NULL,
  open_pnl DECIMAL(14,2) NOT NULL DEFAULT 0,
  open_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id,at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lab_paper_log(
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  at DATETIME NOT NULL,
  text TEXT NOT NULL,
  INDEX lab_paper_log_user(user_id,at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
