# Deník obchodů a průvodce připojením MetaTraderu (MT sync, část 2)

Datum: 7. 10. 2026 · Stav: ke schválení · Větev: `feature/journal`
Navazuje na: `docs/superpowers/specs/2026-10-07-mt-sync-design.md` (část 1 – sběr dat, nasazeno)

## Cíl

1. **Deník obchodů** – trader si může rozebrat každý obchod (průběh v grafu se svíčkami, posuny SL/TP, MFE/MAE, vlastní tagy, poznámka, screenshoty) a ve statistikách zjistit, co mu funguje (podle strategie/tagu, páru, směru, dne, hodiny, délky držení).
2. **Průvodce připojením** na `/mt` pro úplné začátečníky (MT5/MT4 × Windows/Mac/VPS), který sám ověřuje, že kroky proběhly.

## Rozhodnutí

- Deník = obojí (rozbor obchodů i statistiky); detail a graf jen u MT obchodů.
- **Ruční obchody** (tabulka `trades`) jsou v deníku s tím, co o nich víme (datum, trh, výsledek, poznámka); ve statistikách se počítají jen do metrik, které z nich jdou spočítat (počet, win rate, součet, profit factor, křivka); do R, MFE/MAE, délky držení a hodiny vstupu ne.
- **Graf = svíčky z MetaTraderu** (událost `bars` z EA), ne čára ze snímků.
- Knihovna **lightweight-charts** (TradingView, Apache 2.0) jen pro svíčkový graf; ostatní grafy aplikace zůstávají v SVG.
- Statistiky a filtry se počítají **v prohlížeči** z jednoho kompaktního seznamu obchodů (čistý modul s testy).
- Průvodce počítá s **MT5 i MT4** a **Windows, Mac i VPS**; screenshoty MetaTraderu se doplní později (Jindřich je nafotí při testu) – do té doby jen text.

## 1. Svíčky z EA (protokol v1, nová událost)

Událost `bars` (patří do `events` dávky; id `b:<position>:<tf>`):

| pole | typ | poznámka |
|---|---|---|
| `position` | tk | id pozice (MT5 POSITION_IDENTIFIER, MT4 kořenový ticket) |
| `symbol` | sym | |
| `tf` | `M1\|M5\|M15\|M30\|H1\|H4\|D1` | |
| `bars` | pole ≤ 1000 položek `[t, o, h, l, c]` | `t` = čas otevření svíčky v ms UTC, ceny konečná čísla |

- **Výběr timeframu v EA:** okno = od `open − 20 % délky (min. 30 min)` do `close + 20 % délky (min. 30 min)`; vezme se nejmenší TF z řady M1, M5, M15, M30, H1, H4, D1, při kterém má okno ≤ 600 svíček. `CopyRates` (MT5) / `CopyRates` nebo `iTime/iOpen…` (MT4).
- **Kdy EA posílá:** (a) po uzavření pozice (po finálním `out` dealu), odloženě o 5 min, aby byla k dispozici i svíčka po výstupu; (b) jednorázově po připojení pro pozice uzavřené za posledních 30 dní, které server ještě nemá (viz `/api/mt/state`). Dávka obsahuje nejvýš **20** událostí `bars`.
- **`/api/mt/state`** vrací navíc `barsKnown: string[]` – pozice (bez `:rN`) uzavřené za posledních 30 dní, ke kterým server svíčky má.
- **Uložení:** tabulka `mt_position_bars(account_id, position, tf, symbol, data LONGTEXT, updated, PRIMARY(account_id, position))` – upsert (novější přepíše). Do `mt_events` se `bars` neukládají (zbytečně velké); deduplikace = upsert.
- Validace (`lib/mt/protocol.ts`): typ pole, ≤ 1000 svíček, každá svíčka 5 konečných čísel, `t` v rozsahu 2000–2100, `l ≤ min(o,c)` a `h ≥ max(o,c)` (jinak 400 jen pro celou dávku – EA posílá `bars` v samostatných dávkách, aby chyba nesmazala obchody).
- **EA verze 1.1.0**; stránka `/mt` upozorní na starší verzi (už existuje pole `ea_version`).

## 2. API deníku (jen přihlášení, každý jen svoje)

- `GET /api/journal` → `{currency, accounts:[{id,name,platform,currency}], trades:[…]}`; řádek obchodu (kompaktní):
  - MT: `{id:'mt:<position_id>', source:'mt', account, symbol, side, open_ts, close_ts, volume, net, pnl (v měně souhrnu), converted, r, rr, risk_pct, mfe_r, mae_r, hold_ms, tags:[auto∪manual], has_note, files}` – jen uzavřené pozice.
  - ruční: `{id:'man:<id>', source:'manual', symbol:instrument, date, pnl, note}`.
- `GET /api/journal/<id>` (jen `mt:`) → pozice (všechny sloupce `mt_positions` kromě interních), `changes`, `bars` (z `mt_position_bars` podle `account_id` + základního ticketu bez `:rN`), `files:[{key,name,size}]`, `prev`/`next` id podle `close_ts`.
- `PATCH /api/journal/<id>` → `{tags?:string[], note?:string}`; MT: `tags_manual` (max 10 tagů, každý 2–30 znaků `[0-9A-Za-zÀ-ɏ_-]`, lowercase) a `note` (max 5000 znaků); ruční: jen `note` (sloupec `trades.note`, max 500 znaků jako dnes).
- `POST /api/journal/<id>/files` (multipart, jen `mt:`) – PNG/JPEG/WebP, max **5 MB**, max **5** souborů na obchod; uloží do R2 `BUCKET` pod klíčem `journal/<user>/<uuid>`; metadata v tabulce `mt_position_files(id, position_id, user_id, r2_key, name, size, type, created)`.
- `DELETE /api/journal/<id>/files` `{fileId}`; `GET /api/journal/files/<fileId>` – vrátí obrázek jen vlastníkovi (`Cache-Control: private`).
- Všechny zapisující metody: `sameOrigin` + `identity`; vlastnictví ověřit přes `mt_positions → mt_accounts.user_id` (resp. `trades.user_id`).
- Migrace `drizzle/mariadb/0005_journal.sql`: `mt_position_bars`, `mt_position_files`.
- Smazání účtu (`deleteAccount`) maže i `mt_position_bars` a `mt_position_files` (+ R2 objekty).
- **Oprava z části 1:** přepočet pozice nesmí ztratit `tags_manual`/`note` při změně id segmentu – před smazáním starého segmentu se ruční údaje přenesou na segment se stejným `open_ts` (nebo na první segment pozice).

## 3. UI deníku (`app/journal/*`)

Záložka **Deník** v horní liště (`View` + `'journal'`), pod ní přepínač **Obchody · Statistiky**; detail se otevře jako panel/stránka uvnitř záložky (URL hash `#journal/<id>` kvůli odkazům a tlačítku zpět).

**Filtry** (sdílené oběma pohledy, pamatují se v `localStorage`): účet, období (tento měsíc, 30 dní, 90 dní, rok, vše, vlastní), pár, tag, směr, výsledek (zisk/ztráta), zdroj (MT/ruční).

**Obchody** – tabulka: datum zavření, účet, pár, směr, objem, výsledek (měna souhrnu; ≈ u nepřevedených), R, držení, tagy, ikona poznámky/screenshotu, štítek MT/ručně. Řazení podle sloupců, stránkování po 50. Mobil: karty místo tabulky. Klik na MT obchod → detail.

**Detail obchodu (MT):**
- **Graf** (lightweight-charts): svíčky, šipky vstupu/výstupů (dílčí uzavření zvlášť), schodovitá čára SL a TP podle `changes` (od času změny dál), vodorovné pásmo MFE/MAE ceny, tmavý/světlý motiv podle `data-theme`. Bez svíček (starší obchod, chybí `bars`) se místo grafu ukáže hláška „Graf není k dispozici – svíčky posílá EA od verze 1.1 a jen pro obchody z posledních 30 dní“.
- **Časová osa** změn (čas Europe/Prague): otevření, přidání, posun SL/TP (z → na), dílčí uzavření, uzavření + důvod.
- **Karta čísel:** vstup/výstup (průměr), objem, výsledek (účet + souhrn), riziko a % účtu, R:R plán / skutečné R, MFE/MAE v penězích a v R, slippage, spread, důvod otevření/zavření, délka držení, magic/komentář.
- **Tagy** (chipy, přidat/odebrat, našeptávání z existujících), **poznámka** (textarea, ukládání po opuštění pole), **screenshoty** (náhledy, nahrát/smazat, klik = zvětšení).
- Šipky předchozí/další obchod (podle aktuálního filtru).

**Statistiky** (podle filtru):
- Souhrn: počet obchodů, win rate, profit factor, expectancy (měna a R), průměrný zisk / ztráta, nejlepší / nejhorší obchod, nejdelší série výher / proher, max. drawdown (z kumulované křivky v měně souhrnu), průměrná doba držení.
- Křivka equity (kumulovaný výsledek v čase) – SVG jako ostatní grafy.
- Rozpady (tabulka + sloupec): podle tagu, páru, směru, dne v týdnu, hodiny vstupu (Europe/Prague), délky držení (< 15 min, 15 min–1 h, 1–4 h, 4–24 h, 1–7 d, > 7 d). Každý řádek: počet, win rate, součet, expectancy v R.
- Metriky v R jen z obchodů s rizikem (`risk_money`); u ostatních pomlčka + poznámka „X obchodů bez SL“.

**Výpočty** v `lib/journal/stats.ts` (čisté funkce, testy `scripts/check-journal.mjs`): `filterTrades`, `summary`, `equityCurve`, `maxDrawdown`, `streaks`, `breakdown(by)`.

## 4. Průvodce připojením (`/mt`)

Nahradí současnou sekci „Jak propojit“; zbytek stránky (klíče, účty, měna) zůstává.

- **Volba nahoře:** MT5 / MT4 a Windows / Mac / VPS (chipy, uloženo v `localStorage`); texty kroků se podle toho mění.
- **Kroky (karty s číslem a stavem):**
  1. *Co to je* – EA je malý program uvnitř MetaTraderu; jen posílá informace o obchodech do Tradee, sám neobchoduje, k penězům ani heslu účtu nemá přístup. Kdo MetaTrader nemá: stáhni ho od svého brokera (nebo z metatrader5.com) a otevři si demo účet.
  2. *Vytvoř klíč* – stav ✓, když existuje aktivní klíč.
  3. *Stáhni EA a vlož ho do MetaTraderu* – tlačítko ke stažení správného souboru; Windows/VPS: Soubor → Otevřít složku dat → `MQL5` → `Experts` (MT4 `MQL4/Experts`) → vložit; Mac: totéž přes menu Soubor v okně MetaTraderu (aplikace běží v kompatibilní vrstvě, složka se otevře ve Finderu); pak v okně Navigátor pravým na *Expert Advisors* → *Obnovit*. MT4: *Historie účtu* → pravým → *Celá historie*.
  4. *Povol připojení* – Nástroje → Možnosti → Expert Advisors: zaškrtni „Povolit algoritmické obchodování“ a „Povolit WebRequest pro uvedené URL“, přidej `https://tradee.eu`; zapni tlačítko *Algo Trading* (MT4 *AutoTrading*) v horní liště.
  5. *Spusť EA na grafu* – otevři libovolný graf, přetáhni TradeeSync z Navigátoru na graf, v okně *Vstupy* vlož klíč do `TradeeKey`, na kartě *Obecné*/*Společné* povol algoritmické obchodování, OK. V pravém horním rohu grafu se objeví čepička/ikona EA (zelená = běží); v levém horním rohu text „TradeeSync … synchronizováno“.
  6. *Ověření* – ✓ „EA se ozvalo“ (účet s `last_seen` < 5 min), ✓ „Dorazil první obchod“ (≥ 1 pozice); stránka se během kroků obnovuje každých 15 s.
- **„Něco nefunguje?“** (rozbalovací): EA není v Navigátoru (obnovit / špatná složka / soubor .mq5 místo .ex5); na grafu „povol adresu…“ (WebRequest); „TradeeSync zastaven: Klíč neexistuje…“ (nový klíč); „…nemá schválený přístup“ (čekání na schválení); smajlík je smutný / šedá čepička (Algo Trading vypnuté); nevidím starší obchody v MT4 (Celá historie); účet se neukazuje (zkontrolovat internet, záložku *Experti* v okně Nástroje – poslat nám text chyby).
- **Screenshoty:** ke každému kroku volitelný obrázek `public/landing/mt-guide/<platforma>-<krok>.webp`; seznam dostupných obrázků je v kódu (`app/mt-guide.ts`), dokud je prázdný, obrázky se nezobrazují.

## Chyby

- Chybějící svíčky → hláška místo grafu (ne chyba). Neplatná `bars` událost → 400 jen pro dávku se svíčkami.
- Nahrání souboru: nepodporovaný typ / > 5 MB / > 5 souborů → 400 s českou hláškou.
- Detail cizího nebo neexistujícího obchodu → 404.

## Testy

- `scripts/check-journal.mjs`: statistiky (win rate, PF bez ztrát = ∞ → zobrazit „—“, expectancy, drawdown na známé křivce, série, rozpady podle hodiny v Europe/Prague včetně přechodu letního času, R jen z obchodů s rizikem, ruční obchody bez R), filtry.
- `scripts/check-mt.mjs`: validace `bars` (počet, OHLC pravidla, tf výčet), výběr timeframu (sdílená čistá funkce v `lib/mt/bars.ts` zrcadlí logiku EA: délka obchodu → tf).
- Ručně na VPS: curl `bars` dávka, `/api/mt/state` s `barsKnown`, `/api/journal` a detail přes prohlížeč, nahrání a smazání screenshotu, přenos `tags_manual` při přepočtu (`mt-rebuild`).
- EA 1.1: Jindřich v rámci demo checklistu ověří, že u uzavřeného obchodu se do 5 min objeví graf.

## Mimo rozsah

Rozšíření ručního zápisu o vstup/výstup/SL/TP, hodnocení disciplíny/emocí, sdílení obchodů, export CSV, porovnání s benchmarkem, svíčky pro obchody starší než 30 dní.
