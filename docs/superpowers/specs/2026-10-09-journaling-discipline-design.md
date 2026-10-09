# Journaling a disciplína – návrh

Schváleno v chatu 9. 10. 2026 (Daniel). Zdroj: poznámky z callu s Jindřichem (Obsidian „Tradee poznamky“).

## Cíl

Trader v Tradee vyhodnocuje své obchody (hvězdičky, strategie, důvod vstupu, emoce, ponaučení) a Tradee sám hlídá dodržování pravidel. Když trader zavře obchod předčasně nebo posune SL proti sobě, Tradee se ho zeptá proč (okno v aplikaci, odznak, mail, push). Na Dashboardu je vidět „Disciplína X %“.

## Rozhodnutí

| Téma | Volba |
|---|---|
| Umístění | samostatná záložka **Journaling** v hlavním menu; Deník zůstává na čísla |
| Strategie | vlastní seznam + nová strategie se dá napsat přímo u obchodu (přidá se do seznamu) |
| Pravidla | automatická (z MT dat) + vlastní textová + nesplněné body checklistu při vstupu |
| Výzva ke zdůvodnění | okno v aplikaci + odznak u Journalingu + mail + push |
| Mail | zatím z `info@dejny.eu` přes Resend; později doména tradee.eu |

## Automatická pravidla

Každé lze zapnout/vypnout a nastavit hodnotu. Výchozí:

| id | Pravidlo | Výchozí | Detekce | Zdůvodnění |
|---|---|---|---|---|
| `sl_required` | Vždy SL | zapnuto | `sl_initial` je null (SL nebyl nastaven do 2 min od vstupu – `INITIAL_SL_WINDOW` v lib/mt/build.ts) | ne |
| `max_risk` | Max. riziko na obchod | 1 % | `risk_pct` > hodnota | ne |
| `max_trades_day` | Max. obchodů za den | 3 | pořadí obchodu dne (podle `open_ts`, pražský den, na účet) > hodnota; porušení nese obchod, který limit překročil | ne |
| `stop_after_losses` | Stop po ztrátách v řadě | 2 | obchod otevřený týž den po N uzavřených ztrátových obchodech v řadě (uzavřených před jeho vstupem) | ne |
| `max_daily_loss` | Max. denní ztráta | 2 % | obchod otevřený poté, co součet výsledků uzavřených obchodů dne ≤ −hodnota % zůstatku na začátku dne | ne |
| `no_early_close` | Nezavírat předčasně | zapnuto | `close_reason` není `sl`/`tp`/`so` a pozice měla SL nebo TP (ruční zavření, i částečné, se počítá podle posledního zavření) | **ano** |
| `no_sl_widen` | Neposouvat SL proti sobě | zapnuto | změna `sl` v `mt_position_changes`, kde nový SL je dál od vstupu než předchozí (buy: níž, sell: výš) | **ano** |
| `no_news` | Neobchodovat kolem zpráv | vypnuto | vstup ±15 min od události kalendáře se signálem 3 (vysoký dopad) v měně páru (lib/calendar.ts) | ne |

- Vyhodnocuje se proti **nastavení platnému v okamžiku vyhodnocení** a výsledek se uloží; pozdější změna nastavení staré obchody nepřepíše (přepočet jen ručně tlačítkem „Přepočítat“ v nastavení – volitelné, mimo rozsah fáze 1).
- Vyhodnocení běží po příjmu dat z MT (stejně jako snímek checklistu) pro obchody dotčené dávkou; chyba nikdy neshodí příjem.
- Ručně zapsané obchody (`man:`) nemají SL ani časy → automatická pravidla se nevyhodnocují; ručně se dají zaškrtnout vlastní pravidla.
- Otevřená pozice: `sl_required`, `max_risk`, `max_trades_day`, `stop_after_losses`, `max_daily_loss`, `no_news` se vyhodnotí hned po vstupu; `no_sl_widen` při každé změně SL; `no_early_close` po zavření.

## Nastavení „Pravidla a strategie“

Stránka `/checklisty` se přejmenuje na `/pravidla` (stará adresa přesměruje), odkaz v menu avatara „Pravidla a strategie“. Sekce:

1. **Automatická pravidla** – přepínač + hodnota (číslo s jednotkou) u každého.
2. **Vlastní pravidla** – text ≤ 120 znaků, max. 30, přidat / přejmenovat / smazat / posunout.
3. **Strategie** – název ≤ 60 znaků, max. 50, přejmenovat, archivovat (archivovaná zůstává u starých obchodů, nejde vybrat k novým).
4. **Checklisty** – beze změny.

## Záložka Journaling

**Přehled** (období Týden/Měsíc/Rok/Vše + účet, stejné jako „Můj trading“):
- Disciplína % = obchody bez porušení / vyhodnocené obchody (MT obchody s vyhodnocenými pravidly + ruční s vyhodnocením); trend proti předchozímu období.
- Nejčastěji porušené pravidlo (název + počet).
- Průměrné hodnocení ★ a počet obchodů k vyhodnocení.
- Tabulka podle strategie: obchody, win rate, P&L, průměr ★ („Bez strategie“ jako poslední řádek).

**Seznam obchodů**: filtry jako v Deníku + „Jen nevyhodnocené“ + „Jen s porušením“. Řádek: pár, směr, datum, výsledek, ★, strategie, červené štítky porušení (a oranžový „Chybí zdůvodnění“).

**Panel vyhodnocení** (klik na obchod; na mobilu přes celou obrazovku):
- Hodnocení 1–5 ★ (provedení obchodu, ne výsledek).
- Strategie: výběr / napsání nové.
- Proč jsem šel dovnitř: text ≤ 2000.
- Pravidla: automatická porušení (u `no_early_close` a `no_sl_widen` povinné zdůvodnění = důvod + text), nesplněné body checklistu při vstupu (jen zobrazení), vlastní pravidla k zaškrtnutí „porušil jsem“.
- Emoce: štítky Klid, Sebevědomí, Strach, FOMO, Nuda, Únava, Pomsta, Chamtivost (víc možností).
- Ponaučení „Co příště jinak“: text ≤ 2000.
- Uložit / Uložit a další (další nevyhodnocený obchod v aktuálním filtru).
- Vpravo náhled: čísla obchodu + graf (TradeChart, pokud jsou svíčky) a odkaz „Otevřít v Deníku“.
- „Vyhodnocený obchod“ = má hodnocení ★ (ostatní pole volitelná).
- Admin v cizím deníku (`?as=`) vidí Journaling jen pro čtení.

Důvody zdůvodnění: Změnil se trh, Zprávy / událost, Splněný cíl, Strach, Únava, Chyba v plánu, Jiné (+ text; u „Jiné“ text povinný).

## Výzvy ke zdůvodnění

- Vznikají z porušení `no_early_close` a `no_sl_widen` bez zdůvodnění.
- **Okno v aplikaci** při otevření Tradee (po načtení), výzvy jedna po druhé; „Později“ odloží všechny o 4 h (uloženo na serveru); uložení zdůvodnění zapíše porušení.
- **Odznak** s počtem nezdůvodněných u položky Journaling v menu.
- **Mail** (Resend, `info@dejny.eu`): nejvýš jeden za hodinu na uživatele, víc výzev v jednom mailu, odkaz `https://tradee.eu/#journaling/<id>`; jen pokud má uživatel mail zapnutý.
- **Push** (Web Push, VAPID): hned po zjištění (nejpozději do 5 min – odesílá cron), jedno upozornění na výzvu; klik otevře obchod v Journalingu.
- Odesílání mailů a pushů dělá cron každých 5 minut (`scripts/notify.mjs` na VPS), ne příjem dat z MT.

## Nastavení upozornění

V menu avatara sekce „Upozornění“: přepínače Okno v aplikaci / Mail / Push (výchozí: okno + mail zapnuto, push vypnuto). Push se zapíná tlačítkem „Povolit upozornění na tomto zařízení“ (žádost prohlížeče, registrace service workeru, uložení odběru). Na iPhonu nápověda „Přidej si Tradee na plochu“ (manifest + ikony).

## Dashboard

Dlaždice **Disciplína** vedle „Můj trading“: % za zvolené období a účet, počet výzev ke zdůvodnění (klik → Journaling s filtrem „Jen s porušením“).

## Data (MariaDB, utf8mb4_general_ci)

- `rules_settings(user_id PK, rules JSON, updated)` – `{id:{on:boolean,value:number|null}}`.
- `custom_rules(id PK, user_id, text, position, created)`.
- `strategies(id PK, user_id, name, archived TINYINT, created)` – unikátní (user_id, name).
- `trade_reviews(user_id, trade_id, rating TINYINT NULL, strategy_id NULL, reason TEXT NULL, emotions VARCHAR(255), lesson TEXT NULL, custom_broken JSON, updated, PK(user_id,trade_id))`.
- `trade_violations(id PK auto, user_id, trade_id, rule VARCHAR(32), detail JSON, needs_reason TINYINT, reason_code VARCHAR(32) NULL, reason_text TEXT NULL, reasoned_at DATETIME NULL, notified_mail DATETIME NULL, notified_push DATETIME NULL, created, UNIQUE(trade_id,rule))`.
- `notify_settings(user_id PK, popup TINYINT, mail TINYINT, push TINYINT, snooze_until DATETIME NULL, last_mail DATETIME NULL)`.
- `push_subscriptions(id PK, user_id, endpoint VARCHAR(512) UNIQUE, p256dh, auth, created, last_ok DATETIME NULL)`.
- Úklid: smazání ručního obchodu / MT účtu / přeskupení MT pozic (rebuildPositions) přenáší nebo maže `trade_reviews` a `trade_violations` stejně jako `trade_checklists`.

## Architektura

- `lib/discipline/rules.ts` – čisté: definice pravidel, výchozí hodnoty, `evaluate(trade, dayTrades, settings, calendar) → Violation[]`, výpočet disciplíny a přehledu. Testy `scripts/check-discipline.mjs` (hranice: SL ve 2. minutě, 3./4. obchod dne, ztráty v řadě přes půlnoc, posun SL buy/sell, zavření `sl`/`tp`/`client`, zpráva ±15 min).
- `lib/discipline/store.ts` – DB: nastavení, strategie, vlastní pravidla, review, porušení, vyhodnocení po příjmu MT.
- API: `/api/rules` (GET/PUT), `/api/strategies`, `/api/custom-rules`, `/api/reviews/[id]` (GET/PUT), `/api/journaling` (přehled + seznam, `?as=`), `/api/violations/pending` + `/api/violations/[id]` (zdůvodnění), `/api/notify` (nastavení, snooze), `/api/push/subscribe`.
- Notifikace: `scripts/notify.mjs` (cron */5), Resend klíč a VAPID klíče jen v `.env` na VPS; `public/sw.js`, `public/manifest.webmanifest`.
- Žádný klíč ani tajemství v repu.

## Fáze (každá nasazená zvlášť)

1. Pravidla a strategie – nastavení `/pravidla` + vyhodnocování obchodů při příjmu MT + jednorázové vyhodnocení existujících obchodů.
2. Záložka Journaling – přehled, seznam, panel vyhodnocení.
3. Výzvy – okno v aplikaci, odznak, dlaždice Disciplína.
4. Mail a push – Resend, Web Push, cron, nastavení upozornění, manifest.

## Mimo rozsah

Analytika „co můžu zlepšit“, heatmapy a seance (samostatný návrh), push na iOS bez přidání na plochu, doména tradee.eu pro maily.
