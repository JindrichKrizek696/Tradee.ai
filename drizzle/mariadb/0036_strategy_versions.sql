-- Etapa 1A: strategie s verzemi (playbook), tří-stavový checklist, scénáře (plán obchodu), vynechané obchody, stav dne a plán u obchodu.
-- Strategie: původ (vlastní / od mentora / příklad), volitelně jméno mentora; legacy_checklist_id = strategie vznikla převodem starého checklistu
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS origin VARCHAR(10) NOT NULL DEFAULT 'own';
--> statement-breakpoint
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS mentor VARCHAR(80) NULL;
--> statement-breakpoint
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS legacy_checklist_id VARCHAR(40) NULL;
--> statement-breakpoint
-- Verze strategie: obsah 8 bloků s podmínkami (JSON). Verze použitá obchodem, scénářem nebo vynechaným obchodem se už nepřepisuje – úprava založí další verzi s popisem změny.
CREATE TABLE IF NOT EXISTS strategy_versions(
  id VARCHAR(48) NOT NULL PRIMARY KEY,
  strategy_id VARCHAR(40) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  version INT NOT NULL,
  content MEDIUMTEXT NOT NULL,
  changelog VARCHAR(300) NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  UNIQUE KEY strategy_versions_num(strategy_id,version),
  INDEX strategy_versions_user(user_id,strategy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Převod: každá stávající strategie dostane prázdnou verzi 1 (id v1_<strategie>, stejný tvar jako emptyContent() v lib/strategy/core.ts)
INSERT IGNORE INTO strategy_versions(id,strategy_id,user_id,version,content,changelog,created,updated)
SELECT CONCAT('v1_',s.id),s.id,s.user_id,1,'{"models":[],"scope":{"markets":[],"timeframes":[],"sessions":[],"style":null},"noTrade":{"newsBefore":null,"newsAfter":null,"days":[]},"blocks":{"scope":{"text":"","conditions":[]},"context":{"text":"","conditions":[]},"setup":{"text":"","conditions":[]},"trigger":{"text":"","conditions":[]},"invalidation":{"text":"","conditions":[]},"risk":{"text":"","conditions":[]},"notrade":{"text":"","conditions":[]},"review":{"text":"","conditions":[]}}}','Verze 1 převedená z původní strategie',s.created,s.created
FROM strategies s;
--> statement-breakpoint
-- Staré checklisty se převedou na strategie (verze 1: trhy do Rozsahu, body jako podpůrné podmínky Setupu) při prvním načtení strategií uživatele.
-- migrate_pending = 1 jen u checklistů, které existovaly před touto migrací; checklisty dál fungují beze změny.
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS migrate_pending TINYINT(1) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS strategy_id VARCHAR(40) NULL;
--> statement-breakpoint
UPDATE checklists SET migrate_pending=1 WHERE strategy_id IS NULL;
--> statement-breakpoint
-- Scénář = plán obchodu: hypotéza, směr, strategie + verze + vstupní model, úrovně (JSON), platnost, přehodnocení, stav, snímek checklistu (JSON)
-- status: waiting | active | entered | skipped | invalidated | expired; alert_id = propojený cenový alert (upozornění otevře scénář)
CREATE TABLE IF NOT EXISTS scenarios(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  instrument VARCHAR(64) NOT NULL,
  bias VARCHAR(6) NOT NULL,
  hypothesis TEXT NOT NULL,
  strategy_id VARCHAR(40) NULL,
  version_id VARCHAR(48) NULL,
  model VARCHAR(40) NULL,
  levels TEXT NOT NULL,
  valid_until DATETIME NULL,
  review_at DATETIME NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'waiting',
  snapshot MEDIUMTEXT NULL,
  note TEXT NULL,
  chart_url VARCHAR(500) NULL,
  file_id VARCHAR(40) NULL,
  alert_id VARCHAR(40) NULL,
  closed_at DATETIME NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  INDEX scenarios_user(user_id,status,valid_until),
  INDEX scenarios_instrument(user_id,instrument,created),
  INDEX scenarios_version(version_id),
  INDEX scenarios_alert(alert_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Vynechaný obchod: ze scénáře nebo samostatně; důvod (condition | news | session | emotion | risk | other), poznámka a snímek checklistu; bez P&L
CREATE TABLE IF NOT EXISTS no_trades(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  scenario_id VARCHAR(40) NULL,
  instrument VARCHAR(64) NULL,
  direction VARCHAR(6) NULL,
  reason VARCHAR(12) NOT NULL,
  note TEXT NULL,
  strategy_id VARCHAR(40) NULL,
  version_id VARCHAR(48) NULL,
  snapshot MEDIUMTEXT NULL,
  at DATETIME NOT NULL,
  created DATETIME NOT NULL,
  INDEX no_trades_user(user_id,at),
  INDEX no_trades_scenario(scenario_id),
  INDEX no_trades_version(version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Stav dne jako legitimní výsledek deníku: waiting (čekám) | skipping (vynechávám) | pause (pauza)
CREATE TABLE IF NOT EXISTS day_status(
  user_id VARCHAR(128) NOT NULL,
  day DATE NOT NULL,
  status VARCHAR(10) NOT NULL,
  note VARCHAR(500) NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY(user_id,day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Plán u obchodu: scénář a/nebo strategie + verze, snímek checklistu v době vstupu (trade_id jako v deníku: mt:<id> / man:<id>)
CREATE TABLE IF NOT EXISTS trade_plans(
  user_id VARCHAR(128) NOT NULL,
  trade_id VARCHAR(100) NOT NULL,
  scenario_id VARCHAR(40) NULL,
  strategy_id VARCHAR(40) NULL,
  version_id VARCHAR(48) NULL,
  model VARCHAR(40) NULL,
  snapshot MEDIUMTEXT NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY(user_id,trade_id),
  INDEX trade_plans_scenario(user_id,scenario_id),
  INDEX trade_plans_version(version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Převod: obchody se strategií z vyhodnocení se navážou na verzi 1 (ta je tím použitá – další úprava založí verzi 2, staré obchody zůstanou na v1)
INSERT IGNORE INTO trade_plans(user_id,trade_id,scenario_id,strategy_id,version_id,model,snapshot,created,updated)
SELECT r.user_id,r.trade_id,NULL,r.strategy_id,CONCAT('v1_',r.strategy_id),NULL,NULL,r.updated,r.updated
FROM trade_reviews r JOIN strategies s ON s.id=r.strategy_id AND s.user_id=r.user_id
WHERE r.strategy_id IS NOT NULL;
--> statement-breakpoint
-- Obrázky k plánům (příklady podmínek, screenshot ke scénáři) v R2, jen pro vlastníka
CREATE TABLE IF NOT EXISTS plan_files(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  r2_key VARCHAR(200) NOT NULL,
  name VARCHAR(120) NOT NULL,
  size INT NOT NULL,
  type VARCHAR(20) NOT NULL,
  created DATETIME NOT NULL,
  INDEX plan_files_user(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
