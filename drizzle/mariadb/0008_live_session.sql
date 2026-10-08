-- Živé ceny: začátek seance podle Yahoo (ms UTC) pro výběr „dnešních" bodů
ALTER TABLE market_live ADD COLUMN IF NOT EXISTS session_start BIGINT NULL;
