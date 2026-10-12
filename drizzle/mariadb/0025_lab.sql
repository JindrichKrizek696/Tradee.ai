-- Laboratoř (jen vlastník): soukromé poznámky pro AI, uložená pravidla, výsledky studií, historie COT pro studii signálů.
-- NA VPS SPUSTIT RUČNĚ: cd ~/tradee && python3 scripts/mariadb-migrate.py ; pak jednou node --experimental-strip-types scripts/lab-cot-history.mjs
-- Každá tabulka má user_id vlastníka. Žádná admin routa ani export tyto tabulky nečte (lib/admin/* je nezná).
CREATE TABLE IF NOT EXISTS lab_notes(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  title VARCHAR(160) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  tags VARCHAR(600) NOT NULL DEFAULT '[]',
  created DATETIME NOT NULL, updated DATETIME NOT NULL,
  INDEX lab_notes_user(user_id,updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lab_rules(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  name VARCHAR(120) NOT NULL,
  rule LONGTEXT NOT NULL,
  last_summary LONGTEXT NULL,
  created DATETIME NOT NULL, updated DATETIME NOT NULL,
  INDEX lab_rules_user(user_id,updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lab_studies(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  params LONGTEXT NOT NULL,
  result LONGTEXT NOT NULL,
  created DATETIME NOT NULL,
  INDEX lab_studies_user(user_id,created)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lab_summary(
  user_id VARCHAR(128) NOT NULL PRIMARY KEY,
  body MEDIUMTEXT NOT NULL,
  updated DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Týdenní COT z CFTC (TFF futures-only pro měny, Disaggregated pro komodity); plní scripts/lab-cot-history.mjs.
-- market = měna (EUR…) nebo id trhu (GC=F…); grp = leveraged / assetManagers / managedMoney / producers
CREATE TABLE IF NOT EXISTS lab_cot(
  user_id VARCHAR(128) NOT NULL,
  market VARCHAR(16) NOT NULL,
  grp VARCHAR(20) NOT NULL,
  report_date DATE NOT NULL,
  code VARCHAR(12) NOT NULL,
  open_interest BIGINT NOT NULL,
  long_pos BIGINT NOT NULL,
  short_pos BIGINT NOT NULL,
  spread_pos BIGINT NOT NULL DEFAULT 0,
  fetched DATETIME NOT NULL,
  PRIMARY KEY(market,grp,report_date),
  INDEX lab_cot_user(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
