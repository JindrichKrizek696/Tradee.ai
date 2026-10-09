# Graf trhu v Tradee – návrh

Schváleno v chatu 9. 10. 2026 (Daniel): „vlastní graf, který zná tradera a Tradee“, ne kopie TradingView.

## Cíl
V detailu trhu (Analýza trhů → trh) interaktivní svíčkový graf, na kterém trader vidí současně cenu, **své obchody**, **zprávy z kalendáře**, **skóre Tradee v čase** a **seance**; později vlastní **kreslení** uložené k účtu a **minutové svíčky přes EA**.

## Fáze
1. **Graf s kontextem** (tento plán): svíčky H1 / H4 / D1 z Yahoo, vrstvy obchody, otevřená pozice, zprávy, pás skóre, seance.
2. **Kreslení**: trendová čára, horizontála, obdélník (zóna), Fibonacci, text, měření; ukládání per uživatel × trh (DB), mazání, barvy z palety.
3. **Svíčky od brokera přes EA** (M1–M15) pro uživatele s běžícím EA – rozšíření `barsWanted` o „market bars“.

## Fáze 1 – požadavky
- Knihovna `lightweight-charts` (už v projektu, `app/journal/trade-chart.tsx` jako vzor; atribuce TradingView dle licence – odkaz v rohu grafu, jak knihovna vyžaduje).
- **Data svíček**: Yahoo `v8/finance/chart/<sym>` s UA `Mozilla/5.0` (viz `lib/live.ts`, `yahooSymbol`); timeframy: **H1** (interval 60m, range 60d), **H4** (agregace z 60m po 4 h zarovnaná na UTC 0/4/8…), **D1** (interval 1d, range 2y). Cache v DB tabulce `market_candles(instrument, tf, data LONGTEXT, updated)`; obnova on-demand když starší než 15 min (H1/H4) / 6 h (D1); souběžné požadavky na stejný klíč nesmí udělat víc než jeden fetch (zámek v DB řádku nebo „stale-while-revalidate“: vrátit starý a obnovit). Selhání Yahoo → vrátit cache se `stale:true`, bez cache prázdný stav „Ceny teď nejsou k dispozici“.
- Trhy bez Yahoo symbolu (měnové indexy) → graf nezobrazit (stávající detail beze změny).
- **Vrstva obchody**: uzavřené MT a ruční obchody uživatele na tomto trhu (mapSymbol + symbol_map) v rozsahu grafu: značka vstupu (šipka ▲ buy / ▼ sell v barvě bull/bear) a výstupu (kroužek s výsledkem), klik → detail obchodu v Deníku. Ruční obchody bez času: značka na den (D1) / začátek dne.
- **Otevřená pozice**: vodorovné čáry vstup (modrá čárkovaná), SL (bear), TP (bull) s popisky a plovoucím P&L; z `/api/positions/open`.
- **Zprávy**: události kalendáře se signálem ≥ 2 v měnách / trzích instrumentu jako značky na ose (ikona + tooltip „CPI USA · 14:30“); signál 3 výraznější.
- **Pás skóre**: pod grafem úzký pruh (histogram) skóre Tradee v čase ze `score-history` (`scoreSeries` v `lib/dashboard.ts`): zelená > 0, červená < 0, sytost podle velikosti; tooltip skóre a datum.
- **Seance**: volitelné pozadí Asie / Londýn / New York (pražský čas, stejné rozdělení jako analytika) jen na H1.
- **Ovládání**: přepínač TF (H1/H4/D1), přepínače vrstev (Obchody, Zprávy, Skóre, Seance) s pamětí v localStorage, tlačítko „Na současnost“, crosshair s OHLC v hlavičce, kolečko/pinch zoom, tmavý režim a barvy palety (recolor jako trade-chart), mobil (výška 360 px, ovládání ve dvou řádcích).
- Admin `?as=` a cizí deníky: graf je jen v hlavní aplikaci pro přihlášeného uživatele (vlastní obchody).

## Mimo rozsah fáze 1
Kreslení, indikátory (MA/RSI – možná později jako jednoduché vrstvy), minutové svíčky, alerty.
