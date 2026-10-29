-- Etapa 2B: historie kalendáře ForexFactory (plánovaný vs skutečný čas, historie odhadu, odvozená skutečnost a revize),
-- stav zdroje kalendáře a uložené filtry kalendáře uživatele.
-- Událost: měna + titul + první plánovaný čas (id = hash). at = poslední známý čas, scheduled_at = čas při prvním zachycení.
-- actual = skutečnost odvozená z `previous` dalšího vydání téže řady; actual_first = první takto zachycená hodnota (před revizemi).
CREATE TABLE IF NOT EXISTS calendar_events_hist(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  currency VARCHAR(8) NOT NULL,
  title VARCHAR(160) NOT NULL,
  impact VARCHAR(12) NOT NULL,
  scheduled_at BIGINT NOT NULL,
  at BIGINT NOT NULL,
  first_seen BIGINT NOT NULL,
  last_seen BIGINT NOT NULL,
  forecast VARCHAR(40) NULL,
  previous VARCHAR(40) NULL,
  actual VARCHAR(40) NULL,
  actual_first VARCHAR(40) NULL,
  actual_at BIGINT NULL,
  INDEX cal_hist_at(at),
  INDEX cal_hist_series(currency,title,at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Změny události v čase: time (posun termínu), forecast (historie odhadu FF), previous, impact,
-- actual (první odvozená skutečnost) a revision (pozdější jiná hodnota téhož období).
CREATE TABLE IF NOT EXISTS calendar_revisions(
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(40) NOT NULL,
  kind VARCHAR(10) NOT NULL,
  old_value VARCHAR(40) NULL,
  new_value VARCHAR(40) NULL,
  seen_at BIGINT NOT NULL,
  INDEX cal_rev_event(event_id,seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Stav stažení zdroje (ForexFactory): poslední pokus, poslední úspěch a chyba – kalendář ukáže „nedostupné“ a ponechá poslední data.
CREATE TABLE IF NOT EXISTS calendar_feed_status(
  source VARCHAR(20) NOT NULL PRIMARY KEY,
  attempted_at BIGINT NULL,
  ok_at BIGINT NULL,
  error VARCHAR(300) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Filtry kalendáře uživatele (dopad, jen moje trhy / pozice, události jen z FF) – sdílené mezi zařízeními.
CREATE TABLE IF NOT EXISTS calendar_prefs(
  user_id VARCHAR(128) NOT NULL PRIMARY KEY,
  prefs TEXT NOT NULL,
  updated DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
