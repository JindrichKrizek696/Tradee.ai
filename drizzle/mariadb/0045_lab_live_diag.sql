-- Laboratoř · Simulace: živá diagnostika agentů strategií R… (scripts/lab-paper.mjs každý krok, lib/lab/paper-store.ts saveLiveDiag).
-- NA VPS SPUSTIT RUČNĚ: cd ~/tradee && python3 scripts/mariadb-migrate.py  (bez migrace simulace běží dál, jen se diagnostika neukládá ani neukazuje)
-- JSON: poslední vyhodnocená svíčka, trhy bez dat, fáze vstupu a důvody přeskočení od startu agenta, čekající limity. Jen počty, časy a trhy – žádná pravidla.
ALTER TABLE lab_paper_accounts ADD COLUMN IF NOT EXISTS live_diag LONGTEXT NULL;
