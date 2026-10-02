# Analýza trhů – rychlý přehled a barvy signálu

Datum: 2. 10. 2026 · Stav: ke schválení · Větev: `feature/analyza`

## Cíl

Seznam trhů v Analýze má sloužit jako **rychlý přehled**: jedním pohledem vidět, kde je silný signál a jakým směrem, místo dnešních ~4 řádků na obrazovku se stejným písmem všude.

1. Na desktopu (1440×900) je vidět **všech 51 trhů** naráz (heatmapa) nebo **~22 řádků** (tabulka).
2. Směr a síla signálu se čte **barvou a tvarem**, ne jen číslem.
3. Barvy signálu si každý uživatel vybere z **pěti předvoleb**; platí v celé aplikaci a ukládají se k účtu.

## Rozsah

**V rozsahu:** seznam trhů (hlavička, nejsilnější signály, heatmapa, tabulka, vlaječky v seznamu), předvolby barev signálu a jejich použití v celé aplikaci.

**Mimo rozsah (další kola):** přepracování detailu trhu, vlastní barvy mimo předvolby, tmavý režim.

## Barvy signálu

### Předvolby

| id | Název | bullish | bearish |
|---|---|---|---|
| `green-red` | Zelená / červená (**výchozí**) | `#16a34a` | `#dc2626` |
| `blue-black` | Modrá / černá | `#245bff` | `#17191e` |
| `blue-yellow` | Modrá / žlutá | `#2563eb` | `#eab308` |
| `purple-orange` | Fialová / oranžová | `#7c3aed` | `#ea580c` |
| `neon-pink` | Křiklavě zelená / růžová | `#00d664` | `#ec4899` |

Každá předvolba má navíc **textový odstín** pro čísla na bílém pozadí (kontrast ≥ 4,5 : 1 vůči `#fff`), např. žlutá → `#a16207`, křiklavě zelená → `#15803d`. Dlaždice a pruhy používají zářivou barvu, čísla textový odstín. „Bez skóre“ je ve všech předvolbách šedá `#dfe3ea`.

### Použití

- `lib/palettes.ts` definuje předvolby (`id`, `label`, `bull`, `bear`, `bullText`, `bearText`) a výchozí `green-red`.
- Aplikace nastaví na `<html>` CSS proměnné `--bull`, `--bear`, `--bull-text`, `--bear-text`; přepnutí je okamžité bez přenačtení.
- **Na proměnné přejdou jen barvy s významem směru signálu** (skóre, pruhy, příspěvky, sezonalita, COT long/short, mini grafy dashboardu, P&L v kalendáři obchodů). Síla v kalendáři událostí (silná/střední/slabá) **není směr**, zůstává červená/oranžová/šedá. Modrá `#245bff` jako **barva značky** (navigace, odkazy, tlačítka) zůstává.
- Výběr: klik na avatar → panel „Barvy signálu“ s pěti předvolbami a mini náhledem (pruh + dlaždice).

### Uložení

- Sloupec `members.palette VARCHAR(32) NULL` – migrace `drizzle/mariadb/0002_palette.sql` (produkce) a `drizzle/0003_palette.sql` (lokální D1); `db/schema.ts` doplněn.
- `GET /api/settings` → `{palette}`; `POST /api/settings` `{palette}` → uloží. Stejné ověření jako `/api/watchlist` (`identity`, `sameOrigin`, `failed`). Neznámé id → 400, nic se neuloží.
- Kopie v `localStorage` (`tradee.palette`, v try/catch) se použije hned při načtení, aby nebliklo výchozí; po odpovědi API se sjednotí. Bez přihlášení / při chybě API platí `localStorage`, jinak výchozí.

## Seznam trhů

### Hlavička
Jeden tenký řádek: „Analýza trhů“ · čas poslední kontroly podkladů · hledání · přepínač **Heatmapa / Tabulka** (volba v `localStorage`, výchozí Heatmapa). Pod ní záložky skupin (Všechny, FX páry, Měnové indexy, Indexy, Krypto, Akcie) – platí pro obě zobrazení i pro nejsilnější signály.

### Nejsilnější signály
Dva sloupce: **top 5 bullish** a **top 5 bearish** z vybrané skupiny, jen trhy s platným skóre. Karta = název · skóre (textový odstín) · pruh od středu · šipka trendu. Klik → detail. Méně než 5 platných → zobrazí se, kolik jich je; žádný → „Žádný platný signál“.

### Heatmapa
- Skupiny v pořadí FX páry, Měnové indexy, Indexy, Krypto, Akcie; uvnitř seřazeno od nejvyššího skóre po nejnižší, trhy bez skóre na konci.
- Dlaždice ~94×46 px: název + skóre (u měnových indexů bez „· měnový index“). Skupiny s málo trhy (Měnové indexy, Akciové indexy, Krypto) stojí vedle sebe v jedné řadě, aby se vešlo všech 51. Barva = `--bull`/`--bear` s průhledností `0.15 + 0.85 × min(1, |skóre| / 70)`; bez skóre šedá. Text na dlaždici bílý nebo `#141518` podle světlosti výsledné barvy.
- Tečka vlaječky v pravém horním rohu (viz Vlaječky).
- Najetí myší (title/tooltip): směr, trend, pokrytí dat. Klik → detail. Enter na zaměřené dlaždici → detail.
- Hledání **ztlumí** nevyhovující dlaždice (opacity), neskryje je.

### Tabulka
- V tabulkovém zobrazení se nejsilnější signály skryjí (tabulka je řazená podle skóre, nejsilnější jsou nahoře) a filtry skóre/vlaječek jsou v řádku se skupinami – jinak by se nevešlo ~20 řádků.
- Řádek 32 px; sloupce **Trh · Skóre · pruh −100…+100 od středu · Trend (▲▼■) · Pokrytí % · Vlaječka**.
- Řazení klikem na hlavičku (Trh, Skóre, Pokrytí; opakovaný klik obrací). Zůstávají filtry skóre a vlaječek a hledání (zde filtruje).

### Vlaječky v seznamu
Barevná tečka (zelená v tradu, oranžová vyhlížím, červená čekám, prázdná bez vlaječky). Klik na tečku otevře malé menu se čtyřmi volbami a uloží přes stávající `/api/watchlist` (stejná logika a hlášky jako dnes). Klik mimo tečku otevře detail. Klikací plocha tečky min. 24×24 px.

### Mobil (< 640 px)
Heatmapa 3–4 sloupce, nejsilnější signály pod sebou, tabulka jen Trh · Skóre · pruh. Bez vodorovného scrollu.

## Kód

| Soubor | Odpovědnost |
|---|---|
| `lib/palettes.ts` | předvolby, výchozí, validace id |
| `lib/market-view.ts` | čisté funkce: `topSignals`, `heatmapGroups`, `sortRows`, `intensity`, `textOn(bg)` |
| `app/palette.tsx` | provider: CSS proměnné, `localStorage`, `/api/settings`; panel výběru u avataru |
| `app/api/settings/route.ts` | GET/POST předvolby |
| `app/markets/top-signals.tsx`, `heatmap.tsx`, `market-table.tsx`, `flag-dot.tsx` | komponenty seznamu |
| `app/markets.css` | styly seznamu |
| `app/tradee.tsx` | seznam trhů nahrazen novými komponentami |
| `app/shell.tsx` | avatar otevírá panel barev |
| CSS + grafy (`globals.css`, `dashboard.css`, `calendar.css`, `score-analyzer.tsx`, `tradee.tsx`, `dashboard.tsx`) | směrové barvy → proměnné |

## Testy

- `scripts/check-market-view.mjs` (Node, styl `check-*.mjs`): top 5 (jen platné, správné pořadí, < 5 trhů), řazení heatmapy (bez skóre na konci), `intensity` (0, 70, 100, záporné), `textOn` (světlá/tmavá barva), validace předvolby (neznámé id → výchozí), kontrast textových odstínů ≥ 4,5.
- Lokálně: migrace na D1, `GET/POST /api/settings` včetně neznámého id → 400.
- Prohlížeč: 1440×900 – 51 dlaždic viditelných, tabulka ~22 řádků; menu vlaječky uloží a nepustí klik do detailu; přepnutí předvolby změní barvy na seznamu, dashboardu i v kalendáři bez přenačtení; reload drží předvolbu; 390 px bez vodorovného scrollu.

## Nasazení

Větev `feature/analyza` → `main`; na VPS `python3 scripts/mariadb-migrate.py` (aplikuje `0002_palette.sql`), pak `npm run build` a restart `tradee`.
