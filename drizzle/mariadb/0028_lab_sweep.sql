-- Laboratoř · Hledání prahů (jen vlastník): historický sweep parametrů s ověřením mimo vzorek (scripts/lab-sweep.mjs).
-- NA VPS SPUSTIT RUČNĚ: cd ~/tradee && python3 scripts/mariadb-migrate.py ; pak node --experimental-strip-types scripts/lab-sweep.mjs
-- results = JSON výsledku zabalený gzipem v base64 („gz:…“, lib/lab/sweep-store.ts); drží se posledních 10 sweepů na vlastníka.
-- Varianty simulace ze sweepu (S01…S20) se ukládají do lab_paper_accounts (variant VARCHAR(4), pravidla v rules, rules_version „sweep-S01-v1“ ≤ 20 znaků) – bez změny schématu.
CREATE TABLE IF NOT EXISTS lab_sweeps(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  created DATETIME NOT NULL,
  params LONGTEXT NOT NULL,
  results LONGTEXT NOT NULL,
  summary LONGTEXT NULL,
  INDEX lab_sweeps_user(user_id,created)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
