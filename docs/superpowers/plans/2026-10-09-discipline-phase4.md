# Disciplína – fáze 4: mail a push

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Výzvy ke zdůvodnění (porušení `needs_reason=1` bez zdůvodnění) se doručí i mailem (Resend, `info@dejny.eu`, max. 1 mail/h, víc výzev v jednom) a pushem (Web Push, VAPID) do 5 minut; nastavení upozornění (Okno / Mail / Push) v menu avatara; Tradee jde přidat na plochu (manifest), aby push fungoval i na iPhonu.

**Spec:** `docs/superpowers/specs/2026-10-09-journaling-discipline-design.md` (Výzvy ke zdůvodnění, Nastavení upozornění). Fáze 1–3 nasazené: `trade_violations` (sloupce `notified_mail`, `notified_push`), `notify_settings` (popup, mail, push, snooze_until, last_mail), `/api/notify` (GET/PUT/POST snooze), `/api/violations/pending`.

## Global Constraints
- Tajemství jen v `~/tradee/.notify.env` na VPS (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `RESEND_API_KEY`, `MAIL_FROM`); nic z toho v repu, v logu ani ve výstupu. Worker dostane proměnné z `.dev.vars` (systemd skládá `.mariadb.env .auth.env` – controller přidá `.notify.env`), čte je přes `runtime()` v `lib/server.ts` (rozšiř typ o `VAPID_PUBLIC_KEY?`). `.env.example` doplnit o názvy proměnných bez hodnot.
- Odesílání dělá jen Node skript `scripts/notify.mjs` (cron každých 5 min), ne worker ani `/api/mt/ingest`. Knihovna `web-push` (přidat do `dependencies`); worker ji nesmí importovat.
- Bez `RESEND_API_KEY` se mail přeskočí (log „mail vypnutý – chybí klíč“), push poběží dál; bez VAPID klíčů se push přeskočí. Skript nikdy nespadne kvůli jednomu uživateli (try/catch na uživatele).
- Jen porušení vzniklá za posledních 7 dní (`created`), aby po zapnutí nepřišla záplava starých.
- Push: jedno upozornění na porušení; po odeslání `notified_push=now` (i když uživatel nemá odběr nebo má push vypnutý – aby se později neposlalo zpětně). Odběr s odpovědí 404/410 se smaže.
- Mail: uživatel s `mail=1`, porušení s `notified_mail IS NULL`, `last_mail` NULL nebo starší než 1 h → jeden mail se všemi takovými porušeními, pak `notified_mail=now` u nich a `last_mail=now`. Adresát `members.email`. Uživatel s `mail=0`: `notified_mail=now` bez odeslání.
- Odkazy `https://tradee.eu/#journaling/<encodeURIComponent(tradeId)>`.
- Kolace `utf8mb4_general_ci`, `user_id VARCHAR(128)`; migrace `drizzle/mariadb/0013_push.sql`.
- České texty, barvy z tokenů, kompaktní TSX ve stylu repa.

## Review Focus
1. Vypršelý odběr (410) se smaže a ostatní zařízení uživatele dostanou push dál.
2. Dvě běhy cronu za sebou nepošlou stejné porušení dvakrát (označení hned po odeslání; běh chráněný `flock` v `scripts/notify.sh`).
3. Porušení zdůvodněné mezi vznikem a během cronu se nepošle (filtr `reason_code IS NULL`).
4. Prohlížeč bez podpory push / zamítnuté oprávnění → přepínač Push ukáže srozumitelný stav, nic nespadne; iPhone mimo plochu → nápověda „Přidej Tradee na plochu“.
5. Admin v cizím pohledu nic z toho neovlivňuje (všechny zápisy jen za sebe).

---

### Task 1: Push, mail, nastavení, manifest

**Files:** Create `drizzle/mariadb/0013_push.sql`, `lib/discipline/notify.ts` (čisté: výběr porušení k odeslání, text push a mailu – HTML + text), `scripts/check-notify.mjs`, `scripts/notify.mjs`, `scripts/notify.sh`, `app/api/push/route.ts`, `public/sw.js`, `public/manifest.webmanifest`, ikony `public/icon-192.png` + `public/icon-512.png` + `public/apple-touch-icon.png` (vygeneruj z `public/brand/logo-chrome.png` přes `sips` nebo zkopíruj vhodnou velikost – ověř rozměry), `app/notify-settings.tsx`; Modify `package.json` (+`web-push`), `lib/server.ts` (typ env), `app/api/notify/route.ts` (GET vrací i `vapidPublic`), `app/layout.tsx` (manifest, apple-touch-icon, theme-color, apple-mobile-web-app-capable), `app/shell.tsx` (sekce „Upozornění“ v menu avatara), `.env.example`.

**Migrace 0013:** `push_subscriptions(id VARCHAR(40) PK, user_id VARCHAR(128) NOT NULL, endpoint VARCHAR(512) NOT NULL, p256dh VARCHAR(255) NOT NULL, auth VARCHAR(255) NOT NULL, created DATETIME NOT NULL, last_ok DATETIME NULL, UNIQUE KEY(endpoint), INDEX(user_id))`.

**API `/api/push`:** `POST {endpoint,keys:{p256dh,auth}}` (validace: https URL ≤ 512, klíče base64url ≤ 255) → upsert na `endpoint` (přepíše `user_id`), zároveň `notify_settings.push=1`; `DELETE {endpoint}` → smaže odběr uživatele. `sameOrigin` + `identity`.

**Service worker `public/sw.js`:** `push` → `showNotification(title,{body,data:{url},icon:'/icon-192.png',badge:'/icon-192.png',tag})`; `notificationclick` → zavřít, fokus na existující okno tradee.eu a navigace na `url`, jinak `clients.openWindow(url)`.

**`app/notify-settings.tsx` (sekce v menu avatara):** přepínače Okno v aplikaci / Mail / Push (`GET/PUT /api/notify`). Zapnutí Push: kontrola `'serviceWorker' in navigator && 'PushManager' in window`; iOS mimo standalone → text „Na iPhonu nejdřív přidej Tradee na plochu (Sdílet → Přidat na plochu)“; `Notification.requestPermission()`; `navigator.serviceWorker.register('/sw.js')`; `pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidPublic})`; `POST /api/push`. Vypnutí: `PUT {push:false}` + `subscription.unsubscribe()` + `DELETE /api/push`. Stavy: „Zapnuto na tomto zařízení“, „Prohlížeč upozornění blokuje – povol je v nastavení prohlížeče“, „Tento prohlížeč push nepodporuje“. Bez `vapidPublic` přepínač Push skrytý.

**`lib/discipline/notify.ts` (čisté, testované):** `pushPayload(v)` → `{title:'Tradee · zdůvodni obchod',body:'Zavřel jsi NZDCHF dřív – proč?',url,tag:'v<id>'}` (texty podle pravidla jako v `app/reason-prompt.tsx`); `mailContent(name, items)` → `{subject, html, text}` (předmět „Tradee: 1 obchod čeká na zdůvodnění“ / „N obchody/obchodů …“ se správným skloňováním; seznam s párem, výsledkem, pravidlem a odkazem; patička „Upozornění vypneš v Tradee v menu u avataru“); `dueForMail(lastMail, now)` (≥ 1 h). HTML escapovat.

**`scripts/notify.mjs`:** načte `.mariadb.env` a `.notify.env` (vzor z `scripts/discipline-backfill.mjs`), vybere porušení `needs_reason=1 AND reason_code IS NULL AND created>=now-7d AND (notified_push IS NULL OR notified_mail IS NULL)` s údaji obchodu (join jako `pendingReasons`) a uživatele (`members.email,name`, `notify_settings`), provede push a mail podle Global Constraints, vypíše jen souhrn (počty), nikdy klíče ani adresy celé. `scripts/notify.sh`: `flock -n /tmp/tradee-notify.lock`, `source ~/.nvm/nvm.sh && nvm use 22`, spustí skript (vzor `scripts/refresh-live.sh`).

- [ ] Testy `scripts/check-notify.mjs`: payload pro `no_early_close` a `no_sl_widen`, skloňování předmětu (1/2/5), escapování `<script>` v názvu, `dueForMail` (null → ano, 59 min → ne, 61 min → ano).
- [ ] `npx tsc --noEmit -p .`, `npm run build`, check-notify/check-discipline/check-journaling vše ok.
- [ ] Commit „Disciplína: mail a push upozornění“.

### Task 2: Nasazení (controller)
- [ ] Merge, push; na VPS `npm ci`, migrace 0013, vygenerovat VAPID klíče do `~/tradee/.notify.env` (`npx web-push generate-vapid-keys --json`, nic nevypisovat), `VAPID_SUBJECT=mailto:info@dejny.eu`, `MAIL_FROM=Tradee <info@dejny.eu>`, `RESEND_API_KEY` doplní Daniel (stávající klíče na VPS Resend odmítá); systemd `awk 1 .mariadb.env .auth.env .notify.env`; build, restart; cron `*/5 * * * * …/scripts/notify.sh >> notify.log` (záloha crontabu).
- [ ] Ověření: manifest a sw.js se načtou, přepínače v menu, zapnutí push v Chromu (dočasné testovací porušení → push dorazí), test data smazat.
