-- Laboratoř · Simulace: paralelní varianty pravidel A/B/C/D (každá vlastní virtuální účet 100 000 Kč, křivka, obchody, deník).
-- NA VPS SPUSTIT RUČNĚ: cd ~/tradee && python3 scripts/mariadb-migrate.py
-- Existující účet a obchody (paper-v1) zůstávají beze změny jako varianta 'A' (DEFAULT 'A' doplní všechny stávající řádky).
-- B/C/D vzniknou při prvním běhu scripts/lab-paper.mjs po nasazení. lab_paper_log.variant '*' = záznam pro všechny (týdenní souhrn).
ALTER TABLE lab_paper_accounts ADD COLUMN variant VARCHAR(4) NOT NULL DEFAULT 'A' AFTER user_id, ADD COLUMN rules LONGTEXT NULL AFTER rules_version;
--> statement-breakpoint
UPDATE lab_paper_accounts SET variant='A' WHERE variant IS NULL OR variant='';
--> statement-breakpoint
ALTER TABLE lab_paper_accounts DROP PRIMARY KEY, ADD PRIMARY KEY(user_id,variant);
--> statement-breakpoint
ALTER TABLE lab_paper_trades ADD COLUMN variant VARCHAR(4) NOT NULL DEFAULT 'A' AFTER user_id;
--> statement-breakpoint
UPDATE lab_paper_trades SET variant='A' WHERE variant IS NULL OR variant='';
--> statement-breakpoint
ALTER TABLE lab_paper_trades DROP INDEX lab_paper_trades_user, ADD INDEX lab_paper_trades_user(user_id,variant,closed);
--> statement-breakpoint
ALTER TABLE lab_paper_equity ADD COLUMN variant VARCHAR(4) NOT NULL DEFAULT 'A' AFTER user_id;
--> statement-breakpoint
UPDATE lab_paper_equity SET variant='A' WHERE variant IS NULL OR variant='';
--> statement-breakpoint
ALTER TABLE lab_paper_equity DROP PRIMARY KEY, ADD PRIMARY KEY(user_id,variant,at);
--> statement-breakpoint
ALTER TABLE lab_paper_log ADD COLUMN variant VARCHAR(4) NOT NULL DEFAULT 'A' AFTER user_id;
--> statement-breakpoint
UPDATE lab_paper_log SET variant='A' WHERE variant IS NULL OR variant='';
--> statement-breakpoint
ALTER TABLE lab_paper_log DROP INDEX lab_paper_log_user, ADD INDEX lab_paper_log_user(user_id,variant,at);
