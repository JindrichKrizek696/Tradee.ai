# Otevřené pozice – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Zobrazit aktuálně otevřené MT pozice: karta na Dashboardu (pod „Můj trading“, stejný výběr účtu), záložka „Otevřené“ v Deníku, pruh v detailu trhu; admin v cizím deníku jen čte.

**Architecture:** Čistý modul `lib/positions/open.ts` (sestavení řádku z pozice + posledního stavu, R, pruh SL–vstup–TP, stáří) s testy; DB `lib/positions/store.ts` (`openPositions(d,userId)`); API `GET /api/positions/open` (viewAs = jen čtení); klient `app/open-positions.tsx` (`useOpenPositions`, `OpenPositionsCard`, `OpenPositionsList`, `MarketPositionBanner`).

## Spec (schváleno v chatu 9. 10. 2026)

- Zdroj: `mt_positions` se `status='open'` (vstup `open_price`, objem `volume_max`, směr, `sl_last`, `tp_last`, `risk_money`, `open_ts`, účet) + **poslední** událost `position_state` dané pozice z `mt_events` (payload `priceCurrent`, `profit`, `swap`, `ts`; EA posílá každé 2 min).
- Řádek: pár, směr, objem, vstup, aktuální cena, plovoucí P&L (`profit+swap` v měně účtu → přepočet do měny souhrnu kurzem ECB jako jinde; když kurz chybí, v měně účtu + ≈), pruh SL–vstup–TP s aktuální cenou, doba otevření, R (= plovoucí / `risk_money`, jen když je riziko), stáří dat; **„EA neběží“** když poslední stav > **10 min**.
- Souhrn: počet pozic, plovoucí P&L celkem (měna souhrnu), riziko celkem (součet `risk_money` převedený do měny souhrnu; pozice bez SL = „bez SL“ počet).
- Dashboard: karta „Otevřené pozice“ pod „Můj trading“, řízená sdíleným výběrem účtu (`readAccount`; `manual` → karta nic neukáže / skryje se); bez otevřených pozic karta skrytá (nebo „Žádné otevřené pozice“ jednou řádkou – vyber skrytí, aby nepřekážela).
- Deník: záložka **Otevřené** vedle Obchody/Statistiky (respektuje filtr účtu), klik na pozici otevře detail obchodu `#journal/mt:<id>` (detail API vrací i otevřené pozice).
- Detail trhu: pokud má uživatel otevřenou pozici na trhu (mapování `mapSymbol` z `lib/checklists/core.ts` + uživatelova `symbol_map`), pod nadpisem pruh „Máš otevřenou pozici: sell 10 lotů · −20 $ · SL 1,1250 · TP …“ (víc pozic = víc řádků).
- Obnovování: při otevření + každých 60 s, jen když je karta viditelná.
- Admin: `?as=` přes `viewAs` jen GET.

## Global Constraints
- Vlastnictví přes `mt_accounts.user_id`; API `private, no-store`.
- Barvy jen z tokenů (paleta), české texty a skloňování, kompaktní TSX, hooks před early return, mobil.
- Testy: `scripts/check-positions.mjs` + ostatní `check-*.mjs` (kromě dlouhodobě padajícího `check-score`), tsc, build.

---

### Task 1: Čistý modul + testy
**Files:** Create `lib/positions/open.ts`, `scripts/check-positions.mjs`

**Produces:** `type OpenPosition={id:string;accountId:string;account:string;symbol:string;instrument:string|null;side:'buy'|'sell';volume:number;openPrice:number;price:number|null;sl:number|null;tp:number|null;profit:number|null;accountCurrency:string;pnl:number|null;converted:boolean;riskMoney:number|null;r:number|null;openTs:number;updated:number|null;stale:boolean}`; `levelBar(side,open,price,sl,tp):{sl:number|null;tp:number|null;entry:number;price:number|null}|null` (pozice 0–100 % na ose mezi nejnižší a nejvyšší z hodnot SL/vstup/TP/cena; pro sell obrátit tak, aby zisk byl vždy doprava); `isStale(updated,now)` (> 10 min nebo null); `rMultiple(profit,risk)` (null bez rizika, zaokrouhleno na 2 desetinná místa); `summarize(list)` → `{count,pnl,converted,risk,noSl}`.

- [ ] Testy (napiš konkrétní hodnoty): levelBar buy (SL 1.09, vstup 1.10, TP 1.12, cena 1.11 → SL 0, vstup 33.33, cena 66.67, TP 100), sell (SL 1.12, vstup 1.10, TP 1.08, cena 1.09 → SL 0 vlevo, TP 100 vpravo, cena 75), bez SL/TP (jen vstup a cena; obě stejné → null), isStale (9 min false, 11 min true, null true), rMultiple (100/50 → 2, bez rizika null, −25/50 → −0.5), summarize (pnl součet jen převedených + `converted:false` když některá nejde převést; risk součet; noSl počet).
- [ ] Implementace, testy zelené, tsc. Commit „Otevřené pozice: čistý modul a testy“.

### Task 2: DB + API
**Files:** Create `lib/positions/store.ts`, `app/api/positions/open/route.ts`; Modify (pokud nutné) `app/api/journal/[id]/route.ts` a `lib/journal/store.ts` tak, aby detail fungoval i pro otevřenou pozici (ověř – `journalDetail` nefiltruje `status`, pak beze změny).
- [ ] `openPositions(d,userId)`: `SELECT p.*, a.currency acc_currency, a.name acc_name, a.login acc_login FROM mt_positions p JOIN mt_accounts a ON a.id=p.account_id WHERE a.user_id=? AND p.status='open'`; pro každou pozici poslední stav `SELECT payload,ts FROM mt_events WHERE account_id=? AND position=? AND type='position_state' ORDER BY ts DESC LIMIT 1` (pozice = ticket bez `:rN`); přepočet `loadRates`/`convert` (`lib/rates-db.ts`, `lib/fx.ts`) k dnešnímu pražskému datu; `mapSymbol` s `symbolMap(d,userId)` → `instrument`; sestav `OpenPosition` (Task 1 helpery). Vrací `{currency, positions, summary}`.
- [ ] Route: `identity` + `viewAs` (GET), `Cache-Control: private, no-store`.
- [ ] tsc. Commit „Otevřené pozice: API“.

### Task 3: UI – Dashboard, Deník, detail trhu
**Files:** Create `app/open-positions.tsx`, `app/open-positions.css`; Modify `app/dashboard.tsx` (karta pod „Můj trading“, další `tile()` přečíslovat, mřížka 12 sloupců bez děr), `app/journal/journal.tsx` (záložka „Otevřené“, `viewAs` → `?as=`), `app/tradee.tsx` (pruh v detailu trhu pod nadpisem, nad kartou „Dnes“).
- [ ] `useOpenPositions(query='')`: načte API při mountu a každých 60 s jen když `document.visibilityState==='visible'`; chyby nechají poslední data.
- [ ] `OpenPositionsCard({account})` (Dashboard): filtr `accountId` (all = vše, manual = nic); skrytá bez pozic; hlavička „Otevřené pozice“ + souhrn (počet, plovoucí P&L barevně, riziko, „N bez SL“); řádky (karta na mobilu): pár + směr chip + objem, vstup → cena, P&L (barva, ≈ když nepřevedeno), R, pruh `levelBar` (SL červená tečka, TP zelená, vstup šedá čárka, cena výrazná tečka), doba otevření (`fmtHold`), stáří („před 2 min“) nebo štítek „EA neběží“; klik → `location.hash='journal/'+encodeURIComponent(id)` a přepnutí na Deník (stejně jako odkazy `#journal`).
- [ ] Deník: `Tab` + `'open'`, tlačítko „Otevřené (N)“; obsah = stejný seznam (`OpenPositionsList`) filtrovaný účtem z filtru; v `viewAs` s `?as=`.
- [ ] Detail trhu: `MarketPositionBanner({instrument})` – pozice s `instrument===id`; text „Máš otevřenou pozici: sell 10 lotů · −20 $ · SL 1,1250 · TP 1,1100“; víc pozic pod sebou; bez pozic nic.
- [ ] Barvy z tokenů (paleta), české texty, tmavý režim, mobil. tsc + build. Commit „Otevřené pozice: Dashboard, Deník a detail trhu“.

### Task 4: Kontrola + nasazení (schváleno předem)
- [ ] Závěrečná kontrola větve, opravy, merge, push, build, restart; ověření v prohlížeči (Jindřichova otevřená pozice EURUSD přes admin cizí deník, vlastní Dashboard).
