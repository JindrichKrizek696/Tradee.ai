# Živé ceny trhů (pohyb během dne)

Datum: 9. 10. 2026 · Stav: schváleno v chatu · Větev: `feature/live`

## Cíl

Data mají odpovídat tomu, jak se trhy hýbou během dne: u každého z 51 trhů aktuální cena, dnešní změna a graf dnešního průběhu po 15 minutách, bez restartu aplikace. Skóre zůstává stabilní ukazatel; jen se v obchodní dny obnovuje každou hodinu místo každých 4 h.

## Sběr

- `scripts/refresh-live.mjs` (Node 22, `--experimental-strip-types`), spouští `scripts/refresh-live.sh` z cronu **každých 15 min nonstop** (vlastní zámek `/tmp/tradee-live.lock`, nesahá na build ani restart).
- Pro každý trh z `instruments` (`lib/markets.ts`) kromě měnových indexů: Yahoo `https://query1.finance.yahoo.com/v8/finance/chart/<symbol>?range=1d&interval=15m`. Symbol: FX pár `AAA/BBB` → `AAABBB=X`, ostatní = id (`^GSPC`, `BTC-USD`, `AAPL`…). Souběžně nejvýš 6 dotazů, timeout 10 s, User-Agent prohlížeče.
- Z odpovědi: `meta.regularMarketPrice`, `meta.chartPreviousClose` (fallback `previousClose`), `meta.regularMarketTime` (s), denní max/min z bodů, body `timestamp[]`+`indicators.quote[0].close[]` (null vynechat).
- **Měnové indexy** (USD, EUR, GBP, CHF, JPY, CAD, AUD, NZD): změna = průměr dnešních % změn měny proti ostatním 7 (pár `A/B` roste → A sílí, B slábne); průběh = stejný průměr v časech, kde mají data všechny páry dané měny (zarovnání na 15 min). Cena indexu = 100 × (1 + změna/100), předchozí zavření = 100.
- Selže-li trh, ponechá se poslední uložená hodnota; chyba do logu (`live.log`). Body starší 7 dní se mažou.
- Skóre: cron `refresh-vps.sh` v obchodní dny (po–pá) každou hodinu v :17, o víkendu každé 4 h.

## Data (migrace `0007_live.sql`)

- `market_live(instrument PK, symbol, price, prev_close, change_pct, day_high, day_low, market_time BIGINT ms, updated DATETIME UTC)`.
- `market_intraday(instrument, ts BIGINT ms, price, PK(instrument,ts))`.

## API

`GET /api/markets/live` (přihlášení) → `{updated:number|null, quotes:Record<id,{price,prevClose,changePct,high,low,marketTime,updated,points:[ts,price][]}>}`; `points` = body „dneška“ = body se stejným pražským datem jako nejnovější bod trhu (u akcií před otevřením tedy včerejší seance). `Cache-Control: private, no-store`.

## Zobrazení

- Hook `useLive()` načítá API při otevření a každých 5 min, když je karta viditelná.
- **Analýza trhů:** tabulka – sloupec **Dnes** (změna v % barvou podle palety + mini graf průběhu); heatmapa – na dlaždici malá dnešní změna.
- **Detail trhu:** karta „Dnes“ – graf průběhu (hover/dotyk: čas + cena + změna od předchozího zavření), cena, změna, max/min, stav.
- **Dashboard:** karta **„Co se dnes hýbe“** – 5 nejvíc rostoucích a 5 nejvíc padajících trhů (bez měnových indexů) + dnešní síla měn (8 indexů seřazeně).
- **Stav:** `delayed` když poslední stažení > 45 min („zpožděno“); `closed` když poslední cena trhu > 30 min stará, ale stažení čerstvé („zavřeno · poslední cena <čas>“); jinak `live`.

## Testy

`lib/live.ts` (čisté funkce) + `scripts/check-live.mjs`: symboly, změna v %, síla měn (znaménka, průměr, chybějící páry), zarovnání průběhu indexů, výběr „dnešních“ bodů přes půlnoc a DST, stav live/delayed/closed, parsování odpovědi Yahoo (nully, chybějící meta). Na produkci: jeden běh skriptu, kontrola tabulek a API.

## Mimo rozsah

Přepočet skóre z živé ceny, historie po 15 min delší než 7 dní, upozornění na pohyb.
