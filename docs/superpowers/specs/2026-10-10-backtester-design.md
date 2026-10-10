# Backtester – návrh

Schváleno v chatu 10. 10. 2026 (Daniel).

## Cíl
Strategie z Journalingu dostanou **pravidla** (skládačka podmínek). Backtester je projede nad archivem svíček (`market_bars`, H1 2 roky, D1 celá historie) a ukáže výsledky; vedle nich **plán vs. realita** – skutečné obchody označené touž strategií.

## Pravidla strategie (`StrategyRules`)
- **Vstup**: seznam podmínek spojených „a zároveň“ (vyhodnocení na **zavření** svíčky; vstup na **otevření další**).
- **Směr**: `long` | `short` | `score` (podle znaménka skóre Tradee; bez skóre → bez obchodu).
- **Výstup**: SL = body (pips) | % ceny | × ATR(14); TP = R násobek | body | % | „když vstupní podmínky přestanou platit“ (na zavření svíčky) | žádný; časový limit N svíček (volitelný).
- **Velikost**: riziko % účtu na obchod (výchozí 1 %), počáteční kapitál (výchozí 10 000 USD); P&L v měně účtu přes R (výsledek = R × riziko), aby nebylo nutné řešit hodnotu bodu.
- **Náklady**: spread v bodech (výchozí podle typu: FX major 1 pip, ostatní FX 2, JPY páry 1,5, kovy 3, indexy 1 bod, akcie 0,05 %, krypto 0,1 %) a komise jako % rizika na obchod (výchozí 0; např. 5 % = každý obchod −0,05 R) – oboje upravitelné; spread se odečte v cenách (vstup i výstup horší o polovinu spreadu); swap ne.
- Jedna pozice na trh; konflikt SL+TP v téže svíčce → SL (konzervativně); gap přes SL → výstup na open svíčky.

## Podmínky
| typ | parametry |
|---|---|
| `score` | op `>`/`<`, value; nebo `rising`/`falling` za N dní |
| `strength` | base vs quote síla: rozdíl `>`/`<` value |
| `cot` | spekulanti net `long`/`short` nebo změna `>`/`<` value (týdenní, platí od data zveřejnění) |
| `ma` | cena `above`/`below` SMA/EMA(period) |
| `ma_cross` | rychlá MA kříží pomalou `up`/`down` (na této svíčce) |
| `breakout` | close nad N-maximem / pod N-minimem (předchozích N svíček) |
| `ma_distance` | vzdálenost od MA v ATR `>`/`<` value |
| `rsi` | RSI(period) `>`/`<` value; nebo `cross_up`/`cross_down` přes value |
| `change` | změna ceny za N svíček v % `>`/`<` value |
| `atr` | ATR(14) vs průměr ATR(N): `above`/`below` (×k) |
| `session` | seance z analytiky (Asie/Londýn/Překryv/NY/Mimo), víc možností |
| `weekday` | dny (víc možností) |
| `hour` | od–do (Praha) |
| `no_news` | žádná zpráva se signálem ≥ s v měnách/trzích instrumentu ±N min |

Podmínky s daty Tradee (`score`, `strength`, `cot`, `no_news`) mají historii jen tam, kde existuje: kde chybí, podmínka je **nesplněná** a výsledek ukáže „pokryté období“ (od–do) + varování.

## Výsledky
Souhrn (obchody, win rate, čistý P&L, průměrné R, profit factor, max drawdown v % a měně, nejdelší série proher, expectancy), equity křivka + drawdown, rozpad po trzích, seznam obchodů (klik → graf trhu s vyznačeným obchodem – fáze 2, zatím jen detail v seznamu), **plán vs. realita**: skutečné obchody se strategií ve stejném období (počet, win rate, průměrné R, P&L) + počet porušení pravidel u nich. Běhy se ukládají (`backtest_runs`), max 50 na uživatele (nejstarší se mažou), lze otevřít a porovnat dva běhy vedle sebe.

## Architektura
- Čisté: `lib/backtest/indicators.ts` (SMA, EMA, RSI Wilder, ATR Wilder, highest/lowest), `lib/backtest/rules.ts` (typy, výchozí, validace/normalizace, spread výchozí podle trhu), `lib/backtest/engine.ts` (`runBacktest(input) → {trades, equity, perMarket, coverage, warnings}`), `lib/backtest/metrics.ts`. Testy `scripts/check-backtest.mjs`.
- DB `0017_backtest.sql`: `strategy_rules(strategy_id PK, user_id, rules LONGTEXT, updated)`, `backtest_runs(id PK, user_id, strategy_id, params LONGTEXT, summary LONGTEXT, result LONGTEXT, created, INDEX(user_id,created))`.
- API: `GET/PUT /api/strategies/[id]/rules`, `POST /api/backtest` (spustí, uloží, vrátí běh; limit: max 30 trhů, H1 max 2 roky, D1 max 25 let; timeout-friendly – výpočet v jednom requestu), `GET /api/backtest?strategy=` (seznam běhů bez `result`), `GET /api/backtest/[id]`, `DELETE /api/backtest/[id]`.
- Kontext pro podmínky Tradee: historie skóre a síly ze `data/score-history.json` (jak ji načítá app), COT ze `data/score-market.json` (`cot`), kalendář z `data/calendar.json` + `data/fundamentals.json` (`highNews` z `lib/discipline/news.ts`).
- UI: Journaling dostane přepínač **Obchody | Backtest**; v Backtestu výběr strategie → editor pravidel (skládačka) → nastavení běhu → výsledky; seznam uložených běhů.
