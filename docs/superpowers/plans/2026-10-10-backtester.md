# Backtester – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Spec:** `docs/superpowers/specs/2026-10-10-backtester-design.md` (binding). Archiv svíček: `market_bars` + `lib/bars/query.ts` (`loadBars`, `toH4`), `lib/bars/yahoo.ts`.

## Global Constraints
- vinext (Next 16) na Cloudflare Workers runtime, MariaDB 10.6 (`lib/mysql.ts`), testy `node --experimental-strip-types scripts/check-*.mjs`; čisté moduly bez serverových importů.
- Žádné nahlížení do budoucna: podmínky jen z dat do zavření signální svíčky; vstup na open další svíčky.
- Vlastnictví přes `user_id`; zápisy `sameOrigin` + `identity`; `?as=` (admin) jen GET; `Cache-Control: private, no-store`.
- České texty a skloňování, barvy z tokenů, kompaktní TSX ve stylu repa, mobil, tmavý motiv.

## Review Focus
1. Look-ahead bias (MA/RSI/ATR na posledních datech, breakout počítá jen předchozích N svíček, COT od data zveřejnění).
2. SL a TP v téže svíčce → SL; gap přes SL/TP → výstup na open.
3. Podmínka bez dat (skóre mimo pokrytí) → nesplněná + varování s pokrytím.
4. Více trhů: equity jedna (sdílený kapitál, riziko % z aktuální equity), pozice na různých trzích současně povoleny.
5. Výkon: 28 trhů × 12k H1 svíček v jednom requestu (< ~5 s) – indikátory předpočítat jednou na trh.

### Task 1: Engine (čisté) + testy
Files: `lib/backtest/{indicators,rules,engine,metrics}.ts`, `scripts/check-backtest.mjs`.
- [ ] Indikátory (SMA/EMA/RSI Wilder/ATR Wilder/highest/lowest) s testy proti ručně spočteným hodnotám.
- [ ] `StrategyRules` typy, výchozí, `normalizeRules`, výchozí spread podle instrumentu.
- [ ] `runBacktest({rules, markets:[{instrument,bars}], tf, from, to, capital, context})` – context = funkce `score(instrument,t)`, `strength(ccy,t)`, `cot(instrument,t)`, `news(instrument,t,minutes,minSignal)` vracející hodnotu nebo `undefined` (bez dat); výstup trades (instrument, side, entryT, entryPrice, sl, tp, exitT, exitPrice, reason sl|tp|signal|time|end, r, pnl), equity body, perMarket, coverage, warnings.
- [ ] `metrics(trades, equity, capital)` – souhrn ze specu.
- [ ] Testy: syntetické svíčky – SMA cross vstup, SL/TP, SL+TP v jedné svíčce, gap, časový limit, exit „podmínka neplatí“, short, spread/komise, více trhů a sdílená equity, podmínka bez dat, breakout bez look-ahead.
- [ ] Commit „Backtest: engine, indikátory a metriky“.

### Task 2: Data + API
Files: `drizzle/mariadb/0017_backtest.sql`, `lib/backtest/store.ts`, `lib/backtest/context.ts` (z dat Tradee), `app/api/strategies/[id]/rules/route.ts`, `app/api/backtest/route.ts`, `app/api/backtest/[id]/route.ts`.
- [ ] Migrace dle specu (s `--> statement-breakpoint` mezi příkazy).
- [ ] Kontext: skóre/síla ze `data/score-history.json` (zjisti strukturu a jak je načítá app/tradee.tsx; na serveru import JSON jako v `/api/fundamentals`), COT ze `data/score-market.json`, zprávy přes `highNews`.
- [ ] `POST /api/backtest` validace (≤ 30 trhů, rozsahy), načtení svíček (`loadBars`, H4 přes `toH4` pokud potřeba – jen H1/D1 ve specu), běh, plán vs. realita (obchody uživatele se `strategy_id` v `trade_reviews` ve stejném období + porušení), uložení (max 50 běhů, nejstarší smazat).
- [ ] Commit „Backtest: data a API“.

### Task 3: UI
Files: `app/journaling/backtest/*.tsx`, CSS; Modify `app/journaling/journaling.tsx` (přepínač Obchody | Backtest).
- [ ] Výběr strategie, editor pravidel (skládačka podmínek s parametry, směr, výstup, velikost, náklady), nastavení běhu (trhy: jeden/víc/skupina, TF H1/D1, období, kapitál, riziko), Spustit (stav počítám…), výsledky (souhrn, equity + drawdown SVG, po trzích, seznam obchodů, plán vs. realita, varování pokrytí), uložené běhy + porovnání dvou.
- [ ] Commit „Backtest: záložka v Journalingu“.

### Task 4: Kontrola + nasazení
- [ ] Závěrečná kontrola, opravy, merge, migrace 0017, build, restart, ověření v prohlížeči (jednoduchá strategie MA cross na EURUSD H1).
