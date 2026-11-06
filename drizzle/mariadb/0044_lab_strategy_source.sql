-- Laboratoř · Strategie: volitelný ZDROJ definice (krátký popisek, ze kterého podkladu pravidla pochází) – jen data vlastníka v DB, v kódu žádné zdroje.
-- NA VPS SPUSTIT RUČNĚ: cd ~/tradee && python3 scripts/mariadb-migrate.py  (bez migrace Strategie fungují dál, jen zdroj nejde uložit a ukazuje se „bez zdroje“)
-- Upravuje se v záložce Strategie; nová verze definice zdroj převezme z předchozí verze téhož názvu. Agent R… si zdroj zkopíruje do své
-- neměnné kopie při spuštění (lab_paper_accounts.rules → rule.origin.sourceLabel); u starších agentů se dohledá podle defId.
ALTER TABLE lab_strategy_defs ADD COLUMN IF NOT EXISTS source_label VARCHAR(120) NULL;
