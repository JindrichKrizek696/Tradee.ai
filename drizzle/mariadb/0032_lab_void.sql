-- Laboratoř · Simulace: neplatné obchody (otevřené nebo zavřené při zavřeném trhu – Yahoo o víkendu kotuje FX orientačně, viz lib/market-hours.ts isMarketOpen).
-- NA VPS SPUSTIT RUČNĚ: cd ~/tradee && python3 scripts/mariadb-migrate.py ; pak scripts/lab-void-closed-market.mjs (výchozí --dry, zápis --apply).
-- void_reason NULL = platný obchod. Neplatný zůstává v seznamech s odznakem „neplatný – zavřený trh“, ale nepočítá se do zůstatku, statistik, křivky,
-- fitness agentů, týdenního souhrnu, reportu analytika ani Shrnutí pro AI (lib/lab/paper.ts validTrades).
ALTER TABLE lab_paper_trades ADD COLUMN IF NOT EXISTS void_reason VARCHAR(80) NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS lab_paper_trades_void ON lab_paper_trades(user_id,variant,void_reason);
