# Kalendář událostí – návrh

Datum: 2. 10. 2026 · Stav: ke schválení · Větev: `feature/kalendar`

## Cíl

Stránka **Kalendář** v Tradee.ai má ukazovat všechny události, které můžou pohnout sledovanými trhy – primárně forex, ale i krypto, komodity, akcie a indexy – a být na první pohled čitelná:

1. jako první oko zachytí **sílu signálu**, pak **datum a čas**, až potom **o co jde**,
2. na jednu obrazovku se vejde **~20 událostí** (dnes ~5),
3. uživatel si **filtrem** vybere, co ho zajímá; události, které hýbou vším, uvidí vždy.

Zachovává se dnešní princip Tradee: události z **oficiálních zdrojů**, žádné vymyšlené konsensy; u každé je vidět, kdo ji dodal a jak je ověřená.

## Rozsah

### Skupiny událostí

| Skupina (`category`) | Obsah |
|---|---|
| `macro` | HDP, CPI/PPI, zaměstnanost, PMI, maloobchod, obchodní bilance – všech 8 měn (USD EUR GBP JPY CHF AUD NZD CAD) |
| `central-bank` | rozhodnutí o sazbách, zápisy, projevy guvernérů (Fed, ECB, BoE, BoJ, SNB, RBA, RBNZ, BoC) |
| `exchange` | svátky a zkrácené obchodování (NYSE, CME, LSE, JPX), měsíční expirace opcí |
| `commodity` | zásoby ropy a plynu (EIA), OPEC+, počty vrtů (Baker Hughes), zlato |
| `crypto` | upgrady sítí, rozhodnutí SEC o ETF, velké unlocky – jen BTC, ETH, SOL |
| `equity` | výsledky sledovaných akcií + velké technologické firmy, které hýbou Nasdaqem |
| `politics` | volby, G7/G20, termíny cel |

### Mimo rozsah (později)

Filtry uložené k účtu, notifikace na blížící se události, historie výsledků vs. očekávání v grafu, neoficiální feedy (Forex Factory, CoinMarketCal).

## Architektura a tok dat

```
oficiální kalendáře ──► scripts/refresh-calendar.py ──► data/calendar.json  (kostra, „termín“)
                         (cron přes refresh-vps.sh, 4 h)          │
                                                                  ▼
agent podle FUNDAMENTALS.md ──► data/fundamentals.json.events ──► lib/calendar.ts: merge ──► UI
                                (doplnění, „ověřeno“)                (build-time import JSON)
```

### 1. Kostra – `scripts/refresh-calendar.py`

- Spouští ho `scripts/refresh-vps.sh` před buildem (stejný 4h cron, žádný nový cron).
- Stahuje termíny na **60 dní dopředu** z oficiálních zdrojů. Každý zdroj = samostatný parser (funkce), aby šly testovat a vypínat jednotlivě:
  - makro: BLS, BEA, ECB, Eurostat, ONS, StatCan, ABS, Stats NZ, japonská a švýcarská statistika,
  - centrální banky: kalendáře zasedání všech 8 bank,
  - burzy: svátkové kalendáře NYSE, CME, LSE, JPX; expirace opcí výpočtem (3. pátek v měsíci),
  - komodity: EIA (týdenní ropa a plyn), Baker Hughes (výpočtem: pátek).
- Výstup `data/calendar.json`:
  ```json
  {
    "generatedAt": "ISO",
    "sources": {"bls": {"ok": true, "lastSuccess": "ISO", "url": "…", "error": null}},
    "events": [ /* CalendarEvent bez agentových polí */ ]
  }
  ```
- **Stálé ID** podle zdroje, typu a období, např. `bls-cpi-2026-09`, `fed-fomc-2026-10-28`, `nyse-holiday-2026-11-26`. Stejná událost má při dalším běhu stejné ID (žádné duplikáty).
- **Selhání zdroje:** parser, který spadne nebo vrátí 0 událostí, se přeskočí; pro jeho zdroj zůstanou události z předchozího `calendar.json`, `ok:false`, `error` s textem a `lastSuccess` beze změny. Chyba jde do `refresh.log`. Ostatní zdroje se zpracují normálně.
- Snímek `data/calendar.json` je v gitu (aby šel build lokálně), na VPS ho přepisuje cron – stejně jako ostatní soubory v `data/`.

### 2. Doplnění – agent (`FUNDAMENTALS.md`)

- Agent dál píše do `data/fundamentals.json` → `events`. Schéma události se rozšíří o nová pole (viz níže); stávající pole zůstávají, staré záznamy bez nových polí jsou platné.
- Když agent použije **ID ze skriptu**, jeho záznam má přednost (doplní sílu, „na co se dívat“, očekávání, výsledek).
- Události, které skript neumí (krypto, OPEC+, politika, výsledky firem, projevy), agent přidává sám s vlastním ID.
- Do `FUNDAMENTALS.md` se doplní: nové skupiny, pravidla pro sílu 1–3, pevný seznam událostí se štítkem VŠE, povinnost používat ID ze skriptu, pokud událost v `calendar.json` existuje.

### 3. Sloučení – `lib/calendar.ts`

Čistá funkce `mergeCalendar(auto, curated, now) → CalendarEvent[]`:

- spojí podle `id`; agentův záznam přepíše pole skriptu (prázdné hodnoty agenta nepřepisují neprázdné ze skriptu),
- `verified: true` pro záznamy od agenta, `false` pro čistě skriptové,
- chybějící `signal` doplní z tabulky **výchozí síly podle typu** (`DEFAULT_SIGNAL` v kódu, např. CPI/NFP/sazby = 3, ISM/PMI/zásoby ropy = 2, svátky burz = 1),
- `global` (štítek VŠE) = agentova hodnota, jinak podle pevného seznamu typů `GLOBAL_KINDS`: FOMC, NFP USA, CPI USA, HDP USA, ECB sazby, OPEC+, velké geopolitické události (jen agent),
- výstup seřazený podle `at`.

Starší funkce (`upcomingEvents` v `lib/dashboard.ts`, kalendář v `fundamental-analyzer.tsx`) přejdou na `mergeCalendar`.

### Datový model

```ts
type CalendarEvent = {
  id: string;
  at: string;              // ISO UTC
  timeKnown: boolean;
  title: string;           // česky, „Země • co“
  category: 'macro'|'central-bank'|'exchange'|'commodity'|'crypto'|'equity'|'politics';
  markets: string[];       // 'USD','EUR',…,'BTC','ETH','SOL','OIL','GOLD','GAS','INDEX', tickery akcií
  kind?: string;           // typ pro výchozí sílu / VŠE, např. 'us-cpi','fomc','eia-oil'
  signal: 1|2|3;           // slabá / střední / silná
  global: boolean;         // štítek VŠE
  verified: boolean;       // ✓ agent / ○ jen skript
  source: string;          // URL oficiálního zdroje
  watch?: string;          // na co se dívat
  consensus?: string|null; previous?: string|null; actual?: string|null;
  verifiedAt?: string;     // kdy ověřil agent
};
```

Stávající pole agenta `currency` a `importance` se při slučování převedou: `currency` → `markets:[currency]`, `importance` (vysoká/střední/nízká) → `signal` 3/2/1, kategorie → `macro`/`central-bank` podle titulku. Staré záznamy tak fungují bez úprav.

## UI

Schválené mockupy: varianta A (hustá tabulka) + celá stránka s filtry.

### Stránka Kalendář (`app/calendar.tsx`)

- **Hlavička:** „Kalendář“, čas v Praze, počet událostí celkem / zobrazeno, čas poslední aktualizace (`calendar.json.generatedAt`).
- **Filtrační lišta** (přilepená při scrollu):
  - Skupiny – čipy, víc najednou,
  - Trhy – čipy (8 měn, BTC/ETH/SOL, ropa, zlato, plyn, indexy, akcie),
  - Síla – vše / střední+ / jen silná,
  - přepínač **„vždy ukázat VŠE“** (výchozí zapnuto) – události `global` projdou všemi filtry (skupiny, trhy i síla),
  - přepínač **„skrýt proběhlé“** (výchozí vypnuto).
  - Stav filtrů v `localStorage` (try/catch; bez něj výchozí stav = vše zapnuto, síla střední+).
- **Seznam:** oddělovače dnů (malý pruh s názvem dne, „dnes“), řádek výšky **32 px**, sloupce:
  1. síla – signálové čárky (červená/oranžová/šedá) + slovo Silná/Střední/Slabá,
  2. čas (nebo „celý den“ / „—“) + relativní odpočet („za 2 h 50 min“, „za 4 d“),
  3. titulek,
  4. štítky – `VŠE` (černý), trhy, `sleduješ` (oranžový, když se týká trhu s vlaječkou uživatele),
  5. ✓ ověřeno / ○ termín.
- Proběhlé události zešednou; **modrá čára „teď“** mezi minulými a budoucími.
- **Klik na řádek** rozbalí detail v místě (3 sloupce): *Na co se dívat* + dotčené páry (a které uživatel sleduje) · *Očekávání / předchozí / výsledek* · *Zdroj* + kdo a kdy ověřil. Neznámé hodnoty textem „zatím neznámé“, nikdy prázdné ani vymyšlené.
- Mobil (< 640 px): řádek se zalomí na 2 linky (síla + čas / titulek + štítky), filtry se sbalí do tlačítka „Filtry“.

### Dashboard widget

Nejbližších 5 událostí se silou ≥ 2 nebo `global`, stejný styl řádku (bez filtrů), odkaz „Zobrazit vše“.

### Detail páru – záložka Makro kalendář

Stejné řádky, filtrované na měny daného páru + `global`.

## Testy

- **Python (`unittest`)** – `scripts/tests/test_refresh_calendar.py`: každý parser nad uloženou ukázkou odpovědi zdroje (`scripts/tests/fixtures/`), stabilita ID, převod časových zón vč. letního času, chování při selhání zdroje (zachování starých dat, `ok:false`).
- **Node (`scripts/check-calendar.mjs`)**, ve stylu stávajících `check-*.mjs`: `mergeCalendar` (přednost agenta, převod starých polí, výchozí síla, `GLOBAL_KINDS`), filtrovací funkce (VŠE přes filtr, síla, skrytí proběhlých).
- **Ručně v prohlížeči:** desktop 1440×900 → ≥ 20 řádků viditelných; mobil 390 px bez vodorovného scrollu; rozbalení detailu; přepínače filtrů.

## Nasazení a git

- Vývoj ve větvi `feature/kalendar`, do `main` přes **PR** (Jindřich schvaluje hlavně změny `FUNDAMENTALS.md`).
- Přidá se `.gitattributes` (`*.sh text eol=lf`, `*.py text eol=lf`), aby se skripty z Windows nedostaly na VPS s CRLF (to 26. 9.–1. 10. shodilo refresh cron).
- Na VPS: `git pull`, `npm run build`, restart `tradee`; první běh `refresh-calendar.py` ručně a kontrola `refresh.log`.
