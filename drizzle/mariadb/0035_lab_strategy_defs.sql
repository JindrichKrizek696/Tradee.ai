-- Laboratoř · Strategie (jen vlastník): definice pravidlových strategií jako JSON (lib/lab/rules-def.ts) a výsledky jejich testů.
-- NA VPS SPUSTIT RUČNĚ: cd ~/tradee && python3 scripts/mariadb-migrate.py ; definice se vkládají node --experimental-strip-types scripts/lab-strategies.mjs --import <soubor mimo repo>
-- Obsah definic žije jen v této tabulce (nikdy v kódu, testech ani commitech). Žádná admin routa ani export ji nečte.
-- lab_strategy_runs.result = JSON výsledku zabalený gzipem v base64 („gz:…“, lib/lab/strat-store.ts); drží se posledních 5 běhů na definici.
-- Agenti R01…R40 (simulace) se ukládají do lab_paper_accounts (variant VARCHAR(4), neměnná kopie definice v rules) – bez změny schématu.
-- lab_cot.available_at = okamžik zveřejnění reportu CFTC (pátek 15:30 New York po úterním datu); doplní se konzervativně 20:30 UTC
-- (= 15:30 EST, v letním čase o hodinu později než skutečnost); nové řádky bez hodnoty dopočítá kód přesně podle časové zóny.
CREATE TABLE IF NOT EXISTS lab_strategy_defs(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  name VARCHAR(120) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  def LONGTEXT NOT NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  notes TEXT NULL,
  INDEX lab_strategy_defs_user(user_id,updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lab_strategy_runs(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  def_id VARCHAR(40) NOT NULL,
  version INT NOT NULL,
  params LONGTEXT NOT NULL,
  result LONGTEXT NOT NULL,
  summary LONGTEXT NULL,
  created DATETIME NOT NULL,
  INDEX lab_strategy_runs_def(user_id,def_id,created)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
ALTER TABLE lab_cot ADD COLUMN IF NOT EXISTS available_at DATETIME NULL;
--> statement-breakpoint
UPDATE lab_cot SET available_at=TIMESTAMP(DATE_ADD(report_date,INTERVAL 3 DAY),'20:30:00') WHERE available_at IS NULL;
