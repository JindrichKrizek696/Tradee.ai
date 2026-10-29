-- Etapa 3A: pracovní plocha grafu – záložky (pracovní kontexty: trh + TF + rozvržení) a pojmenovaná rozvržení per uživatel.
-- Záložka: pořadí pos, active = poslední aktivní, closed_at = nedávno zavřená (data obsahuje i snímek kreseb trhu pro obnovení); data = JSON (lib/chart/workspace.ts)
CREATE TABLE IF NOT EXISTS chart_tabs(
  user_id VARCHAR(128) NOT NULL,
  id VARCHAR(40) NOT NULL,
  pos INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 0,
  closed_at DATETIME NULL,
  data MEDIUMTEXT NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (user_id,id),
  INDEX chart_tabs_user(user_id,closed_at,pos)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Rozvržení: viditelnost panelů, nástroje, indikátory, seance, volitelně svázaná verze strategie (JSON)
CREATE TABLE IF NOT EXISTS chart_layouts(
  user_id VARCHAR(128) NOT NULL,
  id VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  pos INT NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (user_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
