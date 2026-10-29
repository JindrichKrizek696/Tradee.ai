-- Etapa 3C: úvodní dotazník (odpovědi, panely Dashboardu a pole deníku, stav k vrácení), soukromé check-iny
-- a záznam „Den bez obchodu“ v Poznámkách (druh papíru a den).
-- NA VPS SPUSTIT RUČNĚ: cd ~/tradee && python3 scripts/mariadb-migrate.py  (bez migrace průvodce, check-iny i den bez obchodu jen hlásí, že nejsou zapnuté)
-- onboarding_answers: jeden řádek na uživatele. answers = JSON odpovědí (riziko na obchod bez výchozí hodnoty),
-- prefs = skryté panely Dashboardu a pole záznamu obchodu, previous = nastavení před použitím průvodce (pro „Vrátit“).
CREATE TABLE IF NOT EXISTS onboarding_answers(
  user_id VARCHAR(128) NOT NULL PRIMARY KEY,
  answers TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'new',
  prefs TEXT NULL,
  previous TEXT NULL,
  strategy_id VARCHAR(40) NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- checkins: soukromé (jen uživatel, žádný pohled správce). kind: session (před seancí), entry (před vstupem), after (po obchodu).
CREATE TABLE IF NOT EXISTS checkins(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  kind VARCHAR(12) NOT NULL,
  day DATE NOT NULL,
  ts BIGINT NOT NULL,
  energy TINYINT NULL,
  focus TINYINT NULL,
  mood TINYINT NULL,
  fomo TINYINT NULL,
  plan TINYINT NULL,
  verdict VARCHAR(16) NULL,
  trade_id VARCHAR(80) NULL,
  scenario_id VARCHAR(40) NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  created DATETIME NOT NULL,
  INDEX checkins_user_day(user_id,day),
  INDEX checkins_user_trade(user_id,trade_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
ALTER TABLE notebook_notes ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'note';
--> statement-breakpoint
ALTER TABLE notebook_notes ADD COLUMN IF NOT EXISTS day DATE NULL;
