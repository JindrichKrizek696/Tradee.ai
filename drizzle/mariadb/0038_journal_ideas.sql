-- Etapa 1C: nápady s více vstupy, poctivé R a BE, záznam změn SL/TP, náklady, režim obchodu, hodnocení procesu, limity seance a no-trade okna účtu.
-- Nastavení deníku: okno pro automatické seskupení pozic do nápadu (minuty od prvního vstupu, výchozí 4 h)
CREATE TABLE IF NOT EXISTS journal_settings(
  user_id VARCHAR(128) NOT NULL PRIMARY KEY,
  idea_window_min INT NOT NULL DEFAULT 240,
  updated DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Ruční nápad (vznikne přeskupením / rozdělením v Deníku nebo nastavením limitu rizika): společný stop a limit rizika v % účtu
CREATE TABLE IF NOT EXISTS ideas(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  account_id VARCHAR(40) NULL,
  symbol VARCHAR(32) NOT NULL,
  side VARCHAR(4) NOT NULL,
  scenario_id VARCHAR(40) NULL,
  risk_cap_pct DOUBLE NULL,
  stop DOUBLE NULL,
  note TEXT NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  INDEX ideas_user(user_id,updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Vstupy nápadu: status 'trade' = obchod ručně přiřazený k nápadu (trade_id jako v deníku: mt:<id> / man:<id>);
-- 'pending' = čekající limitní vstup (rezervace rizika), 'cancelled' = nevyplněný zrušený vstup (zůstává v záznamu)
CREATE TABLE IF NOT EXISTS idea_legs(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  idea_id VARCHAR(40) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  trade_id VARCHAR(100) NULL,
  status VARCHAR(10) NOT NULL,
  price DOUBLE NULL,
  qty DOUBLE NULL,
  stop DOUBLE NULL,
  risk_pct DOUBLE NULL,
  note VARCHAR(300) NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  UNIQUE KEY idea_legs_trade(user_id,trade_id),
  INDEX idea_legs_idea(user_id,idea_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Záznam obchodu: režim live / sim / replay (MT a T212 bez řádku = live) a plánované riziko (peníze v měně účtu, % účtu) pro R z původního plánu
CREATE TABLE IF NOT EXISTS trade_meta(
  user_id VARCHAR(128) NOT NULL,
  trade_id VARCHAR(100) NOT NULL,
  mode VARCHAR(6) NOT NULL DEFAULT 'live',
  planned_risk DOUBLE NULL,
  planned_risk_pct DOUBLE NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY(user_id,trade_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Změny SL/TP: ruční záznamy (source 'manual') a důvody ke změnám z EA (source 'mt', párují se s mt_position_changes podle času a druhu)
CREATE TABLE IF NOT EXISTS trade_changes(
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  trade_id VARCHAR(100) NOT NULL,
  ts BIGINT NOT NULL,
  kind VARCHAR(4) NOT NULL,
  old_value DOUBLE NULL,
  new_value DOUBLE NULL,
  reason VARCHAR(300) NULL,
  source VARCHAR(6) NOT NULL DEFAULT 'manual',
  created DATETIME NOT NULL,
  UNIQUE KEY trade_changes_mt(user_id,trade_id,source,ts,kind),
  INDEX trade_changes_trade(user_id,trade_id,ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Ruční / doplněné náklady obchodu v měně účtu (záporné = náklad); NULL = neznámé, platí hodnota z MT/T212
CREATE TABLE IF NOT EXISTS trade_costs(
  user_id VARCHAR(128) NOT NULL,
  trade_id VARCHAR(100) NOT NULL,
  spread DOUBLE NULL,
  commission DOUBLE NULL,
  swap DOUBLE NULL,
  slippage DOUBLE NULL,
  fee DOUBLE NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY(user_id,trade_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Hodnocení procesu (před zobrazením výsledku): odpovědi na otázky (JSON) a hodnocení 1–5
CREATE TABLE IF NOT EXISTS trade_process(
  user_id VARCHAR(128) NOT NULL,
  trade_id VARCHAR(100) NOT NULL,
  answers TEXT NOT NULL,
  rating TINYINT NULL,
  done_at DATETIME NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY(user_id,trade_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Limity seance: scope all (scope_id '') | account (id účtu) | strategy (id strategie); no-trade okno kolem zpráv pro účet
CREATE TABLE IF NOT EXISTS session_limits(
  user_id VARCHAR(128) NOT NULL,
  scope VARCHAR(8) NOT NULL,
  scope_id VARCHAR(40) NOT NULL DEFAULT '',
  max_trades INT NULL,
  max_losses INT NULL,
  max_decisions INT NULL,
  end_time VARCHAR(5) NULL,
  pause_after_sl INT NULL,
  review_after_sl INT NULL,
  news_before INT NULL,
  news_after INT NULL,
  news_min_impact TINYINT NOT NULL DEFAULT 3,
  updated DATETIME NOT NULL,
  PRIMARY KEY(user_id,scope,scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Provedené review po sérii ztrát (uvolní stav „review“)
CREATE TABLE IF NOT EXISTS session_reviews(
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  scope VARCHAR(8) NOT NULL,
  scope_id VARCHAR(40) NOT NULL DEFAULT '',
  note VARCHAR(1000) NULL,
  at DATETIME NOT NULL,
  INDEX session_reviews_user(user_id,scope,scope_id,at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
