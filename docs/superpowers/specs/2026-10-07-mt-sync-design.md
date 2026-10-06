# MetaTrader synchronizace (část 1: sběr dat)

Datum: 7. 10. 2026 · Stav: ke schválení · Větev: `feature/mt-sync`

## Cíl

Každý přihlášený (schválený) uživatel Tradee si propojí svůj MetaTrader 5 nebo 4 a Tradee automaticky a bez nákladů zaznamená **každý obchod, každý výsledek, celý průběh pozice a každý posun SL/TP** – co nejvíc dat, která MetaTrader prozradí, plus dopočty.

Rozdělení:
- **Část 1 (tento spec):** EA → API → databáze → uzavřené pozice v kalendáři obchodů a P&L + stránka „Propojení s MetaTraderem“.
- **Část 2 (samostatný spec později):** deník obchodů – detail pozice s časovou osou SL/TP, statistiky, filtry podle strategie/účtu, editace tagů, poznámek a screenshotů.

## Rozhodnutí

- **Bez nákladů:** vlastní Expert Advisor „TradeeSync“ (MQL5 + MQL4), žádná služba třetí strany (MetaApi apod.). Hesla k účtům brokerů nikam neodcházejí.
- **Pro všechny uživatele**, víc MT účtů na uživatele (filtr po účtech i souhrn).
- **Přenos = události + pravidelné snímky + dorovnání po startu** (varianta A).
- **Setup obchodu:** automatické technické údaje (vstup, SL, TP, R:R, riziko v % účtu, velikost) + strategie přes tag v komentáři obchodu (`#breakout`) + ruční tag/poznámka v Tradee (úložiště už v části 1, UI v části 2).
- **Ruční zápis obchodů zůstává.** Uzavřené MT pozice se v kalendáři a P&L zobrazí vedle ručních.
- **Měny:** výsledky v měně účtu; souhrn přepočten do měny zvolené uživatelem (výchozí USD) podle denního kurzu ECB.

## Architektura

```
MetaTrader 5/4 ── EA TradeeSync ──HTTPS──▶ POST /api/mt/ingest   (Bearer tk_…)
     │  fronta v souboru při výpadku          GET  /api/mt/state    (Bearer tk_…)
     │                                               │
     │                                     mt_events (surový deník, zdroj pravdy)
     │                                               │ lib/mt/build.ts (čistá funkce)
     │                                               ▼
     │                     mt_accounts · mt_positions · mt_position_changes · mt_orders · mt_snapshots
     ▼                                               │
                                  /api/trades (ruční + MT) → kalendář obchodů, P&L
                                  /api/mt/keys, /api/mt/accounts → stránka Propojení
```

Jednotky:
- `mt/TradeeSync.mq5`, `mt/TradeeSync.mq4` – EA (zdroj v repu; zkompilované `.ex5`/`.ex4` v `public/downloads/` – za přihlášením).
- `lib/mt/protocol.ts` – typy a validace příchozí dávky (čisté, testovatelné).
- `lib/mt/build.ts` – z událostí jednoho účtu složí pozice, časovou osu a dopočty (čisté, testovatelné).
- `lib/mt/keys.ts` – generování a hashování klíčů (čisté).
- `lib/mt/store.ts` – zápis/čtení DB (adapter `db()`).
- `app/api/mt/ingest`, `app/api/mt/state`, `app/api/mt/keys`, `app/api/mt/accounts` – route handlery.
- `app/mt-connect.tsx` – stránka Propojení (v menu avatara / nastavení).

## Protokol (verze 1)

`POST /api/mt/ingest`, hlavička `Authorization: Bearer tk_<43 znaků base64url>`, `Content-Type: application/json`, tělo max **1 MB**, max **500 událostí**:

```json
{
  "v": 1,
  "account": {"platform":"mt5","login":"12345678","server":"ICMarketsSC-Demo","company":"Raw Trading Ltd",
              "currency":"USD","leverage":500,"mode":"demo","name":"","ea":"1.0.0"},
  "events": [ { "id":"d:123456789", "type":"deal", "ts":1791370000123, ... } ],
  "snapshot": { "ts":..., "balance":..., "equity":..., "margin":..., "positions":[ ... ] }
}
```

Typy událostí a pole (všechna, co MT poskytne; čísla jako JSON čísla, časy v ms UTC):

| type | id | pole |
|---|---|---|
| `account` | `a:<ts>` | balance, equity, margin, leverage, currency |
| `deal` | `d:<deal ticket>` | position, order, symbol, side (`buy`/`sell`), entry (`in`/`out`/`inout`/`out_by`), volume, price, commission, swap, fee, profit, magic, comment, reason (`client`/`mobile`/`web`/`expert`/`sl`/`tp`/`so`/`rollover`/`vmargin`/`split`), dealType (`trade`/`balance`/`credit`/`charge`/`bonus`/…), sl, tp, contractSize, digits, point, tickValue |
| `position_modify` | `m:<position>:<ts>` | position, symbol, slOld, slNew, tpOld, tpNew, price (bid/ask v okamžiku) |
| `order` | `o:<order>:<state>:<ts>` | order, position, symbol, orderType (`buy_limit`/`sell_stop`/…), state (`placed`/`modified`/`canceled`/`expired`/`filled`/`rejected`), volume, priceOpen, priceRequested, sl, tp, expiration, comment, magic |

Snapshot `positions[]`: position, symbol, side, volume, priceOpen, priceCurrent, sl, tp, profit, swap, mfePrice, maePrice, mfeMoney, maeMoney, spread, openTs.

Odpověď: `{ok:true, accepted, duplicates}`; chyba `{error}` s HTTP 400 (validace), 401 (klíč), 413 (velikost), 429 (limit).

`GET /api/mt/state?login=…&server=…` → `{known:boolean, lastDealTs, lastDealTicket, openPositions:[ticket…]}`; EA podle toho dorovná historii (MT5 `HistorySelect(lastDealTs-60 s, now)`, MT4 `OrdersHistoryTotal`).

Idempotence: unikátní `(account_id, event_id)`; duplicitní událost se ignoruje (počítá se do `duplicates`).

## Datový model (MariaDB, migrace `0004_mt.sql`)

- `mt_keys(id PK, user_id, name, key_hash CHAR(64) UNIQUE, prefix CHAR(9), created, last_used NULL, revoked NULL)`
- `mt_accounts(id PK, user_id, platform, login, server, company, currency, leverage, mode, name, ea_version, last_seen, balance, equity, created, UNIQUE(user_id,server,login))`
- `mt_events(account_id, event_id VARCHAR(80), type, ts BIGINT, payload JSON/LONGTEXT, received, PRIMARY(account_id,event_id), INDEX(account_id,ts))`
- `mt_positions(id PK, account_id, ticket, symbol, side, status open|closed, open_ts, close_ts NULL, open_price, close_price_avg NULL, volume_max, sl_initial, tp_initial, sl_last, tp_last, profit, commission, swap, fee, net, magic, comment, tags, note, open_reason, close_reason, mfe_money, mae_money, mfe_price, mae_price, mfe_partial BOOL, spread_entry, slippage_points, risk_money NULL, risk_pct NULL, rr_planned NULL, r_result NULL, updated, UNIQUE(account_id,ticket))`
- `mt_position_changes(id PK, position_id, ts, kind open|add|partial_close|close|sl|tp, old_value NULL, new_value NULL, price NULL, volume NULL, reason NULL, INDEX(position_id,ts))`
- `mt_orders(account_id, ticket, symbol, order_type, state, volume, price_open, price_requested, sl, tp, placed_ts, done_ts NULL, comment, magic, PRIMARY(account_id,ticket))`
- `mt_snapshots(account_id, ts, balance, equity, margin, floating, PRIMARY(account_id,ts))`
- `members.currency VARCHAR(3) NOT NULL DEFAULT 'USD'` (nový sloupec, měna souhrnu)
- `fx_rates(date, currency, per_eur, PRIMARY(date,currency))` – denní ECB kurzy (`eurofxref-daily.xml`), plní `scripts/refresh_fx.py` v cronu `refresh-vps.sh`; při chybějícím dni se použije poslední dostupný.

Retence: `mt_events`, `mt_positions`, `mt_position_changes`, `mt_orders` navždy; `mt_snapshots` starší 90 dní se redukují na 1 za hodinu (týdenní úklid v `refresh-vps.sh`).

## Skládání pozic (`lib/mt/build.ts`)

Vstup: všechny události účtu týkající se jedné pozice (podle `position`), seřazené podle `ts`, pak `id`. Výstup: řádek `mt_positions` + `mt_position_changes`.

- `deal entry=in` → otevření (první) nebo přidání (další); `open_price` = objemově vážený průměr vstupů.
- `deal entry=out` → částečné uzavření (zbývá objem) nebo uzavření (objem 0); `close_price_avg` vážený.
- `entry=inout` (otočení) → uzavře původní směr a otevře nový jako **nová pozice** se stejným ticketem a příponou `:r1`.
- `out_by` (uzavření protipozicí) → uzavření obou pozic.
- `position_modify` → změny `sl`/`tp` (ignoruje se, pokud se hodnota nezměnila).
- SL/TP při vstupu: z `deal.sl/tp` vstupního dealu; když chybí (MT4 nastavil SL až po vstupu), první `position_modify` do 10 s po otevření se bere jako počáteční.
- `net = profit + commission + swap + fee` (všechny dealy pozice).
- `risk_money` = |open_price − sl_initial| × objem × tickValue/point (jen když je SL); `risk_pct` = risk_money / balance při vstupu; `rr_planned` = |tp_initial − open_price| / |open_price − sl_initial|; `r_result` = net / risk_money.
- MFE/MAE: maximum z hodnot snapshotů; `mfe_partial = true`, pokud mezi dvěma snapshoty otevřené pozice uplynulo > 10 min (MT neběžel).
- `slippage_points` = (fill price − priceRequested) / point ve směru proti obchodníkovi (z odpovídajícího `order`).
- Tagy: všechna slova `#[\p{L}\p{N}_-]{2,30}` z komentáře (lowercase); ruční tagy z Tradee se nepřepisují.
- Nestandardní dealy (vklad, výběr, kredit, bonus) se nepočítají do pozic; ukládají se jen v `mt_events` (budou v části 2 pro křivku účtu).

Po každé dávce se přepočítají jen dotčené pozice (načtou se všechny jejich události z `mt_events`), takže výsledek je vždy stejný bez ohledu na pořadí doručení.

## EA TradeeSync

Nastavení: `TradeeKey` (povinné), `AccountName` (volitelné), `Endpoint` (výchozí `https://tradee.eu`).

- **MT5:** `OnTradeTransaction` (deal add, order add/update/delete, position change → `position_modify`), fronta v paměti, odeslání dávky nejpozději po 2 s (`OnTimer` 1 s). Snapshot každé 2 min při otevřených pozicích, jinak 15 min. MFE/MAE: v `OnTimer` (1 s) se pro každou otevřenou pozici aktualizuje max/min cena a peníze.
- **MT4:** `OnTimer` 1 s: porovnání aktuálních `OrdersTotal` a historie s předchozím stavem → syntetické `deal`/`position_modify`/`order` události (ID z ticketu + stavu); částečné uzavření (nový ticket s komentářem `from #<ticket>`) se mapuje na původní pozici.
- **Fronta:** neodeslané dávky do `MQL5/Files/TradeeSync/<login>.queue` (MT4 `MQL4/Files/…`), opakování s odstupem 2 s → 5 min.
- **Start:** `GET /api/mt/state` → dorovnání historie dealů (MT5) / uzavřených objednávek (MT4) od `lastDealTs`.
- Chyby (`WebRequest` −1 → URL není povolená) se vypíšou do záložky Experti a na graf s návodem.
- Verze EA se posílá v `account.ea`; Tradee na stránce Propojení upozorní na zastaralou verzi.

## Stránka „Propojení s MetaTraderem“

Dostupná z menu avatara. Obsah:
1. Návod ve 4 krocích (stáhnout EA → zkopírovat do `MQL5/Experts` → povolit `https://tradee.eu` v Nástroje → Možnosti → Experti → přetáhnout na graf a vložit klíč).
2. Klíče: vytvořit (zobrazí se jednou + tlačítko Kopírovat), seznam (název, `tk_xxxx…`, naposledy použit), zrušit.
3. Účty: platforma, broker/server, číslo účtu (zobrazeno jen poslední 4 číslice), měna, demo/live, poslední spojení (zelená do 5 min, šedá jinak), počet pozic; přejmenovat, odpojit (smaže účet a jeho data po potvrzení).
4. Měna souhrnu (USD/EUR/CZK/…) – uloží se do `members.currency` (nový sloupec, výchozí `USD`).

## Kalendář obchodů a P&L

- `GET /api/trades` vrátí ruční obchody (`source:'manual'`) i uzavřené MT pozice (`source:'mt'`, `account`, `currency`, `net`, `pnlConverted` v měně souhrnu). Datum MT pozice = den uzavření v časovém pásmu Europe/Prague.
- Kalendář a P&L sčítají `pnlConverted`; MT obchody nejdou smazat z kalendáře (jen ruční), u MT řádku je štítek účtu.
- `lib/trades.ts` dostane pole `source`, `currency`, `pnlConverted` (ruční: měna souhrnu = jejich hodnota, jako dnes `$`).

## Zabezpečení

- Klíč 32 náhodných bajtů (`tk_` + base64url), v DB jen SHA-256; porovnání přes otisk (unikátní index), plaintext se ukáže jen při vytvoření.
- Zápis jen pro uživatele, kterému klíč patří, a jen pokud má přístup (`approved=1` nebo owner) – kontrola při každém požadavku (stejná cache 30 s).
- Nginx: `/api/mt/ingest` a `/api/mt/state` veřejné (bez `auth_request`), `limit_req` 120 r/min na IP (burst 60), `client_max_body_size 1m`.
- Validace všech polí (`lib/mt/protocol.ts`): typy, délky (symbol ≤ 32, comment ≤ 64), konečná čísla, povolené hodnoty výčtů; nevalidní událost se odmítne celá dávka s indexem chyby.
- Stažení EA (`public/downloads/`) jen pro přihlášené (za `auth_request`).

## Chyby

- Server nedostupný / 5xx / 429 → EA drží frontu a opakuje.
- 401 (zrušený klíč) → EA přestane posílat a vypíše hlášku na graf.
- 400 → EA zaloguje a dávku zahodí (aby se nezasekla fronta); server loguje chybu s indexem události.
- Selhání skládání pozice → událost zůstává v `mt_events`, chyba do logu, ostatní pozice se zpracují; skript `scripts/mt-rebuild.mjs <account>` přepočítá vše znovu.

## Testy

- `scripts/check-mt.mjs` (node --experimental-strip-types) nad `lib/mt/build.ts`, `protocol.ts`, `keys.ts`, fixture sekvence v `scripts/fixtures/mt/`:
  jednoduchý buy s TP; sell zasažený SL; 3× posunutý SL (časová osa); částečné uzavření ve dvou krocích; přidání do pozice (vážený vstup); otočení `inout`; `out_by`; duplicitní a přeházené události (stejný výsledek); MT4 částečné uzavření s `from #`; chybějící SL (bez R); MFE/MAE ze snapshotů vč. `mfe_partial`; tagy z komentáře; validace (špatný typ, NaN, dlouhý symbol, 501 událostí).
- Ingest a state přes curl na VPS (platný/zrušený klíč, duplicitní dávka, 413, 429, neschválený uživatel).
- EA: ruční checklist na demo účtu MT5 a MT4 (otevřít, posunout SL 2×, posunout TP, částečně zavřít, zavřít; pending limit založit/upravit/zrušit; vypnout síť → zapnout; restart terminálu → dorovnání).

## Mimo rozsah (část 2 a dál)

UI deníku (detail pozice, časová osa, grafy, statistiky, filtry, editace tagů/poznámek/screenshotů), křivka equity účtu, vklady/výběry v UI, obchodování z Tradee, cTrader/TradingView/kryptoburzy.
