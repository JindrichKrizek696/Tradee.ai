-- Etapa 3B: replay – trénink a validace obchodování na historických datech bez nahlížení do budoucna.
-- Seance: trhy, start, základní rámec a zobrazené rámce, simulační hodiny (clock), režim learn (výukový) | validate (validační),
-- „rozhodni, pak odkryj“ (decide_n svíček se odkryje až po zapsaném rozhodnutí; reveal_until = kam smí hodiny), konfigurace
-- (exekuce, specifikace trhů, replay účet a pravidla, strategie) a uložené výsledky. Čas všude v ms UTC.
CREATE TABLE IF NOT EXISTS replay_sessions(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  name VARCHAR(80) NOT NULL,
  mode VARCHAR(8) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'active',
  symbols VARCHAR(300) NOT NULL,
  base_tf VARCHAR(4) NOT NULL,
  tfs VARCHAR(40) NOT NULL,
  start_ts BIGINT NOT NULL,
  clock BIGINT NOT NULL,
  decide_n INT NULL,
  reveal_until BIGINT NULL,
  rewinds INT NOT NULL DEFAULT 0,
  resets INT NOT NULL DEFAULT 0,
  config MEDIUMTEXT NOT NULL,
  results MEDIUMTEXT NULL,
  journaled TINYINT NOT NULL DEFAULT 0,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  ended_at DATETIME NULL,
  INDEX replay_sessions_user(user_id,updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Záznam událostí seance (zdroj pravdy, jen přibývá): order, cancel, modify, close, decision, rewind, reset.
-- void = zneplatněno přetočením ve výukovém režimu; rewind/reset se nikdy nezneplatní (validace je ukáže ve výsledcích).
CREATE TABLE IF NOT EXISTS replay_events(
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(40) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  seq INT NOT NULL,
  clock BIGINT NOT NULL,
  kind VARCHAR(10) NOT NULL,
  data MEDIUMTEXT NOT NULL,
  void TINYINT NOT NULL DEFAULT 0,
  created DATETIME NOT NULL,
  UNIQUE KEY replay_events_seq(session_id,seq),
  INDEX replay_events_user(user_id,session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Příkazy seance – přepočtené enginem ze záznamu událostí při uložení (stav pending / filled / cancelled / rejected).
CREATE TABLE IF NOT EXISTS replay_orders(
  session_id VARCHAR(40) NOT NULL,
  id VARCHAR(40) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  side VARCHAR(5) NOT NULL,
  type VARCHAR(6) NOT NULL,
  price DOUBLE NULL,
  qty DOUBLE NOT NULL,
  sl DOUBLE NULL,
  tp DOUBLE NULL,
  status VARCHAR(10) NOT NULL,
  placed_at BIGINT NOT NULL,
  filled_at BIGINT NULL,
  fill_price DOUBLE NULL,
  reason VARCHAR(200) NULL,
  decision_id VARCHAR(40) NULL,
  PRIMARY KEY(session_id,id),
  INDEX replay_orders_user(user_id,session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Uzavřené obchody seance (přepočtené enginem): náklady, R, příznak nejednoznačné svíčky a gapu, snímek checklistu strategie
-- a odkaz do Deníku (journal_trade_id = id ručního zápisu v trades, v trade_meta s režimem 'replay').
CREATE TABLE IF NOT EXISTS replay_trades(
  session_id VARCHAR(40) NOT NULL,
  id VARCHAR(40) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  order_id VARCHAR(40) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  side VARCHAR(5) NOT NULL,
  qty DOUBLE NOT NULL,
  entry_ts BIGINT NOT NULL,
  entry_price DOUBLE NOT NULL,
  exit_ts BIGINT NOT NULL,
  exit_price DOUBLE NOT NULL,
  exit_reason VARCHAR(8) NOT NULL,
  sl DOUBLE NULL,
  tp DOUBLE NULL,
  gross DOUBLE NOT NULL,
  commission DOUBLE NOT NULL,
  swap DOUBLE NOT NULL,
  spread_cost DOUBLE NOT NULL,
  slippage_cost DOUBLE NOT NULL,
  net DOUBLE NOT NULL,
  planned_risk DOUBLE NULL,
  r DOUBLE NULL,
  ambiguous TINYINT NOT NULL DEFAULT 0,
  gap TINYINT NOT NULL DEFAULT 0,
  decision_id VARCHAR(40) NULL,
  plan_snapshot MEDIUMTEXT NULL,
  journal_trade_id VARCHAR(64) NULL,
  PRIMARY KEY(session_id,id),
  INDEX replay_trades_user(user_id,session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
