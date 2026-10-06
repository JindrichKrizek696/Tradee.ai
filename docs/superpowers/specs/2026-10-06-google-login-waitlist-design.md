# Google login a waitlist

Datum: 6. 10. 2026 · Stav: ke schválení · Větev: `feature/google-login`

## Cíl

Tradee běží na `https://tradee.eu` (od 6. 10. 2026; `www` a `tradee.dejny.eu` přesměrovávají 301). Dnes ho chrání sdílené heslo (nginx basic auth) a nginx za všechny dosazuje pevného uživatele `jindra` přes hlavičky `oai-authenticated-user-*`.

Nově:

- **Přihlášení přes Google.** Dovnitř smí jen účet schválený v DB (`waitlist.approved = 1`) nebo `OWNER_EMAIL`.
- **Nepřihlášený nebo neschválený návštěvník vidí jen veřejnou homepage s waitlistem.** E-mail z formuláře se uloží do DB.
- Každý nový uživatel, včetně Jindřicha, se zapíše (formulářem nebo přihlášením Googlem) a Daniel ho pustí ručně v DB. Admin UI se nedělá.

## Rozhodnutí

- **Login v aplikaci**, ne oauth2-proxy: Google OAuth (authorization code + PKCE) v route handlerech, session v podepsané cookie.
- **Admin = `OWNER_EMAIL` = `d.slaby06@gmail.com`.** Má přístup vždy, i bez řádku ve waitlistu.
- **Data účtu `jindra`** (2 obchody, 4 vlaječky watchlistu, paleta) se převedou na Danielův Google účet.
- **Schvalování přímo v DB:** `UPDATE waitlist SET approved=1, approved_at=NOW() WHERE email='…';`
- **Homepage zatím minimální** (název, jedna věta, pole na e-mail, odkaz na přihlášení Googlem). Obsah a vzhled se doladí samostatně; návrh s tím počítá tak, že homepage je jeden samostatný soubor.

## Proč brána v nginxu, ne jen v aplikaci

Klientský bundle obsahuje data přímo (`app/tradee.tsx` importuje `data/fundamentals.json`, `score-market.json`, `calendar.json` …). Statické soubory `/assets/*.js` obsluhuje wrangler a ne route handler, takže kontrola v `identity()` by je nechránila. Kdokoli by si data stáhl i bez přihlášení.

Proto se **celá aplikace včetně `/assets` schová za `auth_request`** a veřejná homepage je samostatné statické HTML mimo bundle aplikace.

## Tok požadavku

```
prohlížeč ─▶ nginx tradee.eu
              ├─ /auth/*, /api/waitlist, /landing/*, /favicon.svg ─▶ app (veřejné)
              └─ vše ostatní ─ auth_request /auth/check ─▶ app
                    ├─ 204 ─▶ proxy na app (+ hlavičky identity z /auth/check)
                    └─ 401 ─▶ cesta "/" → statická homepage (landing.html)
                              jiná stránka → 302 na "/"
                              /api/*       → 401 JSON
```

- `/auth/check` ověří session cookie (HMAC podpis, expirace) a **v DB**, že uživatel je stále schválený (nebo je owner). Vrací 204 a hlavičky `X-Tradee-User-Id`, `X-Tradee-User-Email`, `X-Tradee-User-Name` (percent-encoded UTF-8). Jinak vrací 401.
- Nginx tyto hlavičky přes `auth_request_set` předá aplikaci. **Příchozí hlavičky `X-Tradee-*` a `oai-*` od klienta nginx vždy maže**, aby je nikdo nemohl podvrhnout.
- `identity()` v `lib/server.ts` čte nové hlavičky. Rozhraní (`{id,email,name,role,owner}`) zůstává, takže API routy se nemění. Jako pojistku, kdyby někdo obešel nginx (`127.0.0.1:8787` je jen lokálně), `identity()` navíc ověří cookie sama. Tím je aplikace bezpečná i bez nginxu.

## Přihlášení

| Cesta | Co dělá |
|---|---|
| `GET /auth/google` | Vygeneruje `state` a PKCE `code_verifier`, uloží je do krátké cookie `tradee_oauth` (10 min, HttpOnly, Secure, SameSite=Lax) a přesměruje na Google (`scope=openid email profile`, `prompt=select_account`). |
| `GET /auth/callback` | Ověří `state`, vymění `code` za tokeny na `https://oauth2.googleapis.com/token` (server→server přes TLS s client secret, takže claims z `id_token` se berou bez ověření podpisu podle OIDC Core 3.1.3.7). Ověří `aud = GOOGLE_CLIENT_ID`, `iss ∈ {accounts.google.com, https://accounts.google.com}`, `email_verified = true`, `exp` v budoucnosti. Pak: upsert do `waitlist` (`source='google'`, doplní `name`, `google_sub`); **schválený nebo owner** → upsert do `members`, session cookie, 302 na `/`; **neschválený** → 302 na `/?stav=cekas`. |
| `GET /auth/check` | Viz výše (jen pro nginx `auth_request`). |
| `POST /auth/logout` | Smaže session cookie a přesměruje na `/`. Kvůli CSRF jen POST se `sameOrigin`. |

**Session cookie `tradee_session`:** `base64url(JSON {sub,email,name,exp}) + "." + base64url(HMAC-SHA256(SESSION_SECRET))`. Platnost 30 dní, HttpOnly, Secure, SameSite=Lax, Path=/. Podpis i ověření přes WebCrypto (`crypto.subtle`), takže to funguje ve Worker runtime. Odvolání přístupu (`approved=0`) platí okamžitě, protože `/auth/check` se ptá DB při každém požadavku.

**ID uživatele** = Google `sub` s prefixem `g:` (např. `g:1043…`), aby se nemohl potkat se starými ID.

## Waitlist

**Tabulka** (`drizzle/mariadb/0003_waitlist.sql`, pouští ji `scripts/mariadb-migrate.py`):

```sql
CREATE TABLE waitlist(
  email VARCHAR(254) PRIMARY KEY,      -- vždy lowercase
  name VARCHAR(200) NULL,
  google_sub VARCHAR(64) NULL UNIQUE,
  source VARCHAR(16) NOT NULL,         -- 'form' | 'google'
  approved TINYINT(1) NOT NULL DEFAULT 0,
  created DATETIME NOT NULL,
  approved_at DATETIME NULL
);
```

Párování schválení podle **e-mailu**: kdo se zapsal formulářem a pak se přihlásí Googlem se stejnou adresou, je to tentýž řádek.

**`POST /api/waitlist`** (veřejné):
- Přijme `{email, web}` (`web` je honeypot; když je vyplněný, odpověď je `ok`, ale nic se neuloží).
- Validace: délka ≤ 254, jednoduchý regex, lowercase.
- `INSERT IGNORE`: opakované zapsání nic nemění a nevrací chybu, takže se nedá zjistit, kdo už na seznamu je.
- Limit: max 5 zápisů za 10 min z jedné IP (nginx `limit_req` na této cestě).
- Odpověď vždy `{ok:true}` nebo `{error}` s českou hláškou.

**Homepage** `public/landing/index.html` (+ případné soubory v `public/landing/`):
- Statické HTML s inline CSS a malým inline skriptem, který pošle formulář přes `fetch` na `/api/waitlist`. Bez JS funguje jako běžný `<form method=post>`: endpoint přijme i `application/x-www-form-urlencoded` a odpoví 303 na `/?stav=zapsano`.
- Obsah: Tradee, jedna věta, pole „Tvůj e-mail“ s tlačítkem „Chci přístup“, odkaz „Už máš přístup? Přihlásit přes Google“ (`/auth/google`).
- Podle `?stav=` ukáže hlášku: `zapsano` („Díky, ozveme se.“), `cekas` („Účet čeká na schválení.“), `chyba` („Přihlášení se nepovedlo, zkus to znovu.“).
- Nginx ji servíruje na `/` pro nepřihlášené. Odkazy na fonty a obrázky jen z `/landing/`.

## Odhlášení v aplikaci

Do shellu aplikace (`app/shell.tsx`, oblast s uživatelem) přibude tlačítko **Odhlásit** (formulář `POST /auth/logout`). Jiné změny UI aplikace nejsou.

## Migrace účtu `jindra`

Skript `scripts/migrate-legacy-user.py <nové_id>` v jedné transakci přepíše `jindra` → `g:<sub>` v `members.id`, `trades.user_id`, `watch_flags.user_id` (včetně `id`, kde je prefix `jindra:`), `progress.user_id` a `messages.user_id`. Spouští se ručně **po prvním Danielově přihlášení** (`sub` se vyčte z `waitlist.google_sub`). Předtím záloha (`scripts/backup.sh`). Řádek `jindra` se v `members` jen přejmenuje (zachová paletu); role se při přihlášení ownera nastaví na `admin`.

## Konfigurace a nasazení

- Tajné údaje v `~/tradee/.auth.env` na VPS (mimo git, `chmod 600`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` (32 B náhodně, base64), `OWNER_EMAIL=d.slaby06@gmail.com`, `PUBLIC_URL=https://tradee.eu`.
- `tradee.service`: `cat .mariadb.env .auth.env > dist/server/.dev.vars`. `--var OWNER_EMAIL:jindra@…` se odstraní. `runtime()` v `lib/server.ts` dostane nové proměnné do typu.
- `.env.example` doplnit o nové klíče (bez hodnot).
- **Google Cloud (udělá Daniel):** OAuth consent screen (External, název Tradee, režim Testing nebo Published), OAuth client typu Web application, Authorized redirect URI `https://tradee.eu/auth/callback`. Client ID a Secret přijdou do `.auth.env`.
- **Nginx** (`/etc/nginx/sites-available/tradee.eu`): odstranit `auth_basic` a `oai-*` hlavičky, přidat `auth_request` s výjimkami viz Tok požadavku, `limit_req_zone` pro `/api/waitlist`, `error_page 401` → named location, který podle cesty vrátí landing, 302 nebo 401 JSON. Šablona configu bude v repu (`deploy/nginx-tradee.eu.conf`) kvůli dohledatelnosti.
- **Pořadí nasazení:**
  1. merge do `main`, na VPS `git pull --ff-only`, migrace `0003`, build, restart;
  2. přepnout nginx;
  3. Daniel se přihlásí;
  4. migrace `jindra`;
  5. smazat `/etc/nginx/auth/tradee.htpasswd`.

  Do kroku 2 platí staré heslo a aplikace funguje dál, protože `identity()` během přechodu přijme i staré `oai-*` hlavičky. Po přepnutí nginxu se tahle zpětná kompatibilita v dalším commitu odstraní.
- `app/chatgpt-auth.ts` se smaže (nepoužívá se). Odkazy na `tradee.dejny.eu` ve skriptech (`User-Agent`, git e-mail bota) se přepíšou na `tradee.eu`.

## Chyby

- Google vrátí `error` nebo nesedí `state` / `code` → 302 na `/?stav=chyba` a do logu.
- `email_verified = false` → `/?stav=chyba`.
- DB nedostupná v `/auth/check` → 503 (nginx ukáže chybu, ne landing, aby výpadek DB nevypadal jako odhlášení).
- Chybějící `GOOGLE_*` nebo `SESSION_SECRET` → `/auth/*` vrací 500 s jasnou hláškou v logu; `/auth/check` vrací 401 (bezpečné selhání).

## Testy

`scripts/check-auth.mjs` (styl jako `check-reports.mjs`, `node --experimental-strip-types`) nad čistým modulem `lib/auth.ts`:
- podpis a ověření session: platná, prošlá, změněný payload, změněný podpis, jiný secret;
- validace claims `id_token` (`aud`, `iss`, `email_verified`, `exp`);
- PKCE: `code_challenge` = S256 z verifieru (vektor z RFC 7636);
- `safeReturn` / validace e-mailu waitlistu.

Ručně po nasazení (curl proti `tradee.eu`):
- bez cookie: `/` vrací landing (200), `/assets/<chunk>.js` vrací 302/401, `/api/fundamentals` vrací 401, `/api/waitlist` přijme e-mail;
- podvržená hlavička `X-Tradee-User-Email` nic nezmění;
- přihlášení Googlem (Daniel) projde, aplikace se načte, obchody a watchlist jsou vidět (po migraci);
- neschválený účet skončí na `/?stav=cekas`; po `approved=1` se dostane dovnitř, po `approved=0` hned ven.

## Mimo rozsah

Admin UI pro schvalování, e-mailové notifikace (nový zápis, schválení), finální obsah a design homepage, jiné způsoby přihlášení.
