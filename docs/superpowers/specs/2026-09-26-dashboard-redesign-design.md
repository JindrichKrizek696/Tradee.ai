# Redesign Tradee.ai: dashboard a nový vzhled

Datum: 26. 9. 2026. Schváleno uživatelem v rozhovoru.

## Cíl
Aplikace dostane vzhled podle dodané ukázky (světlý dashboard s horní navigací, hero s maskoty, KPI dlaždice, karty s měkkým stínem). Veškerý dnešní obsah a data zůstávají: tabulka 51 trhů, detail trhu se skóre, COT, sezonalitou a výpočtem, Reporty, vlaječky v D1.

## Co se nemění
- `lib/`, `data/`, `app/api/`, D1 schéma, `drizzle/`, skripty v `scripts/`.
- Legacy soubory `app/trading-app.tsx`, `app/fundamental-analyzer.tsx` (nejsou v routě, nesahat).
- Texty zůstávají česky. Pozdrav používá jméno z přihlášení (`oai-authenticated-user-full-name`), fallback „Jindro“.

## Navigace (shell)
Horní lišta: logo (favicon T + „Tradee“), položky **Dashboard**, **Analýza trhů**, **Reporty**, **Kalendář**; vpravo tlačítko obnovit (stávající `refresh` + `loadFlags`), avatar s iniciálou. Aktivní položka má modré pozadí jako v ukázce. Na mobilu se položky zobrazí jako vodorovně rolovatelný pás.

## Stránky
1. **Dashboard** (výchozí)
   - Hero: „Dobré ráno / odpoledne / večer, {jméno}“ podle hodiny v Praze, tagline „Disciplína dnes. Svoboda zítra.“, vpravo maskoti (býk + medvěd bez pozadí) a karta s dnešním datem.
   - KPI dlaždice (5): Bullish trhy (počet, skóre > 0), Bearish trhy (počet, skóre < 0), Nejsilnější signál (název trhu + skóre), Čerstvost podkladů (% trhů s pokrytím 100 %), Moje vlaječky (počet sledovaných, z toho „Jsem v tradu“). Každá má malou ilustraci: mini graf, donut nebo pruhy jako v ukázce, kreslené v SVG bez nové knihovny.
   - Hlavní řada: karta **Historie skóre** s grafem z `history.snapshots` pro vybraný trh (výchozí: první trh s vlaječkou, jinak nejsilnější signál), přepínače 1T / 1M / 3M / Vše, tooltip s datem a hodnotou. Vpravo karta **Moje vlaječky**: souhrn (sleduji / v tradu / čekám) a tabulka označených trhů se skóre, trendem a barvou vlaječky; klik otevře detail v Analýze trhů.
   - Spodní řada: **Stav podkladů** (řádky: fundament ověřen do X h, COT do 11 dní, ceny do 7 dní, poslední kontrola; každý s fajfkou nebo varováním a pruhem využití limitu), **Poslední změny** (posledních 5 změn skóre z rozdílu dvou posledních snímků + `data.changes`), **Kalendář** (nejbližších 5 událostí z `data.events` s časem v Praze, měnou a štítkem důležitosti).
2. **Analýza trhů**: dnešní Analyzer (filtry, skupiny, tabulka, detail) v novém stylu karet. Chování beze změny.
3. **Reporty**: dnešní komponenta `Reports` beze změny obsahu.
4. **Kalendář**: všechny `data.events` seřazené podle času, seskupené po dnech, se štítkem důležitosti, očekáváním a výsledkem.

## Vzhled
- Pozadí: světlý modrošedý gradient (#f3f6fc → #e9eef8). Karty bílé, zaoblení 18 px, jemný stín, 1px hranice #e3e8f2.
- Barvy: primární #245bff, kladné #16a34a, záporné #dc2626, text #141518, sekundární text #6b7280.
- Písmo Inter přes systémové fallbacky, bez externího načítání fontů.
- Tokeny v `:root` v `app/globals.css` se upraví, `.s-card` a `.n-*` třídy se přestylují, aby detail trhu a Reporty odpovídaly bez přepisování JSX.
- Responzivita: dlaždice 5 → 2 → 1 sloupec, řady karet se skládají pod sebe.

## Assets
- `public/mascots-pair.png`: býk a medvěd s odstraněným bílým pozadím, složení ze samostatných PNG, zmenšené na šířku 640 px.
- Stávající PNG s náhodnými názvy se přejmenují na popisné názvy v `public/brand/` a zmenší na rozumnou velikost (WebP nebo PNG do 300 kB). Sada šesti návrhů loga a chromová loga se zatím nepoužijí.

## Soubory
- `app/shell.tsx`: horní navigace a layout stránky.
- `app/dashboard.tsx`: hero, KPI, karty.
- `app/calendar.tsx`: stránka kalendáře.
- `app/tradee.tsx`: zůstává zdrojem dat a stavů; `view` rozšířen o `dashboard` a `calendar`, výchozí `dashboard`. Analyzer a Reports se z něj nevytrhávají.
- `app/globals.css`: nové tokeny a styly.
- `scripts/prepare-brand-assets.mjs`: jednorázová úprava obrázků přes `sharp`.

## Ověření
- `npx tsc --noEmit` a `npm run build` projdou.
- V prohlížeči: dashboard, analýza, detail trhu, reporty, kalendář, mobilní šířka 390 px. Screenshoty.
- Vlaječky lze uložit a zobrazí se na dashboardu.
- Nasazení na VPS stejným postupem jako dnes a ověření přes https://tradee.dejny.eu.
