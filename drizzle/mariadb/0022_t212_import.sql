-- Import historie z Trading 212 (CSV): účet s platformou 't212' v mt_accounts, obchody v mt_positions; spread T212 vykazuje zvlášť (už je v ceně, jen informativně)
ALTER TABLE mt_accounts MODIFY platform VARCHAR(8) NOT NULL;
--> statement-breakpoint
ALTER TABLE mt_positions ADD COLUMN IF NOT EXISTS spread_cost DOUBLE NULL;
