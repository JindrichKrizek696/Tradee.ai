-- Laboratoř · Známé strategie + Populace agentů (jen vlastník). NA VPS SPUSTIT RUČNĚ: cd ~/tradee && python3 scripts/mariadb-migrate.py
-- lab_known = výsledky scripts/lab-known.mjs (JSON gzip+base64 „gz:…“ jako lab_sweeps, drží se posledních 10 na vlastníka).
-- Agenti G01… jsou varianty simulace v lab_paper_accounts (variant VARCHAR(4) 'G01'…'G999', rules = genom + meta, rules_version
-- „agent-G01-v1“) – bez změny schématu; archivace = active 0 (obchody, křivka i deník zůstávají, nic se nemaže).
-- lab_evolution = každá změna populace s důvodem: seed (založení), evaluate (týdenní fitness), clone (potomek), retire (archivace).
-- Po migraci: node --experimental-strip-types scripts/lab-known.mjs ; node --experimental-strip-types scripts/lab-evolve.mjs --seed
-- Cron (UTC): 15 16,17 * * 0 … scripts/lab-evolve.mjs (neděle 18:15 Praha) ; 30 16,17 * * 0 … bash scripts/lab-analyst.sh (18:30 Praha)
CREATE TABLE IF NOT EXISTS lab_known(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  created DATETIME NOT NULL,
  params LONGTEXT NOT NULL,
  results LONGTEXT NOT NULL,
  summary LONGTEXT NULL,
  INDEX lab_known_user(user_id,created)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lab_evolution(
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  gen INT NOT NULL,
  at DATETIME NOT NULL,
  agent VARCHAR(4) NOT NULL,
  parent VARCHAR(4) NULL,
  genome LONGTEXT NOT NULL,
  action VARCHAR(16) NOT NULL,
  reason TEXT NOT NULL,
  fitness DOUBLE NULL,
  INDEX lab_evolution_user(user_id,gen,at),
  INDEX lab_evolution_agent(user_id,agent,at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
