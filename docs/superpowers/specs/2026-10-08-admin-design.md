# Admin stránka `/admin`

Datum: 8. 10. 2026 · Stav: ke schválení · Větev: `feature/admin`

## Cíl

Admini spravují přístupy a sledují provoz bez sahání do databáze. Vlastník (`OWNER_EMAIL`, Daniel) navíc může nahlédnout do deníku kteréhokoli uživatele, jen pro čtení a se záznamem.

## Role a oprávnění

| Akce | admin | vlastník |
|---|---|---|
| Vidět `/admin`, přehled, lidi, technický stav MT účtů | ✓ | ✓ |
| Schválit z waitlistu, zablokovat / odblokovat (kromě vlastníka) | ✓ | ✓ |
| Udělat adminem / odebrat admina | – | ✓ |
| Zůstatek a equity MT účtů, otevřít cizí deník (jen čtení), záznam nahlížení | – | ✓ |

- Vlastník = `isOwner(email)` (`lib/server.ts`); admin = `role==='admin'`. Oprávnění se kontroluje na serveru v každém `/api/admin/*` (`requireAdmin`, `requireOwner`); UI jen skrývá.
- Ne-admin na `/admin` dostane stránku „Sem nemáš přístup“ (API 403).

## Data

Migrace `drizzle/mariadb/0006_admin.sql`:
- `waitlist.blocked TINYINT(1) NOT NULL DEFAULT 0` – zablokování nemaže schválení (odblokování ho vrátí).
- `members.last_login DATETIME NULL` – zapisuje `recordLogin`.
- `admin_audit(id BIGINT AUTO_INCREMENT PK, actor_id VARCHAR(128), action VARCHAR(32), target_id VARCHAR(128), detail VARCHAR(255), at DATETIME, INDEX(at))`.

Přístup (`accessRole`, `recordLogin`): uživatel smí dovnitř, když je vlastník, nebo `approved=1 AND blocked=0`. Zablokovaný: aplikace jako neschválený (landing + „čeká na schválení“ → text „Přístup je pozastaven“), EA dostane 403 „Účet Tradee zatím nemá schválený přístup.“ (beze změny `lib/mt/http.ts`). Po změně stavu se smaže cache přístupu (`accessCache`) pro dotčeného uživatele, jinak platí max. 30 s.

Audit: zapisuje se schválení, zablokování, odblokování, změna role (všichni admini) a otevření cizího deníku / detailu obchodu (vlastník). Akce: `approve`, `block`, `unblock`, `role_admin`, `role_member`, `view_journal`, `view_trade`.

## API (`app/api/admin/*`, vše `identity` + `sameOrigin` u zápisu)

- `GET /api/admin/overview` (admin) → `{users:{total,approved,pending,blocked,admins},mt:{accounts,online,trades1d,trades7d,trades30d},waitlist7d}`; online = `last_seen` < 20 min; obchody = uzavřené MT pozice podle `close_ts`.
- `GET /api/admin/people` (admin) → seznam z `waitlist` LEFT JOIN `members` (podle e-mailu): `email,name,created,approved,blocked,role,lastLogin,mtAccounts,memberId,isOwner`; řazeno: čekající nahoře, pak podle `created` sestupně.
- `POST /api/admin/people` `{email,action:'approve'|'block'|'unblock'|'role_admin'|'role_member'}` – approve/block/unblock admin (block/unblock vlastníka → 400), role_* jen vlastník a jen pro existujícího člena (jinak 400 „Uživatel se ještě nepřihlásil.“); vlastníkovi roli měnit nejde.
- `GET /api/admin/mt` (admin) → MT účty všech: `id,owner(email,name,memberId),platform,mode,company,server,eaVersion,lastSeen,positions,open`; `balance,equity,currency` jen pro vlastníka (jinak se pole vůbec nepošlou). Login maskovaný `••••1234`.
- `GET /api/admin/audit` (vlastník) → posledních 100 záznamů.
- Deník za jiného uživatele (vlastník): stávající `GET /api/journal?as=<memberId>` a `GET /api/journal/<id>?as=<memberId>`; `GET /api/journal/files/<fileId>?as=<memberId>`. Server: `as` přijme jen od vlastníka (jinak 403), zapíše audit (`view_journal` při seznamu, `view_trade` při detailu; screenshoty se neaudituji zvlášť). PATCH/POST/DELETE parametr `as` nepřijímají (zápis vždy jen za sebe).

## UI (`/admin`, `app/admin/*`)

Samostatná stránka ve stylu `/mt` (tlačítko zpět do Tradee); odkaz „Administrace“ v menu avatara jen pro adminy (`GET /api/watchlist` už vrací `user` – doplnit `role` a `owner`).

1. **Přehled** – karty s čísly z overview + čerstvost dat (`checkedAt` fundamentů a `marketRefresh`/`refresh.attemptedAt` z `/api/fundamentals`).
2. **Lidé** – tabulka (mobil: karty), filtr Vše / Čekající / Schválení / Zablokovaní, hledání podle e-mailu/jména; akce tlačítky s potvrzením u blokace a změny role. Vlastník označen štítkem, bez akcí.
3. **MetaTrader účty** – tabulka technického stavu (zelená tečka = online, štítek „stará verze EA“ pod 1.1.0); vlastník navíc sloupec zůstatek/equity a tlačítko **Otevřít deník** u majitele.
4. **Záznam nahlížení** (jen vlastník) – posledních 100 záznamů auditu.

**Cizí deník:** `/admin/journal/<memberId>` vykreslí komponentu `Journal` v režimu `viewAs={memberId,name}` → načítá s `?as=`, nahoře pruh „Prohlížíš deník: <jméno> (jen pro čtení)“, v detailu se skryjí ovládací prvky tagů, poznámky a screenshotů (jen zobrazení), filtr se ukládá pod jiným klíčem v `localStorage` (nepřepisuje vlastní).

## Soukromí

`public/landing/soukromi.html`: doplnit odstavec – provozovatel může kvůli podpoře a kontrole funkčnosti nahlížet do dat synchronizovaných z MetaTraderu; každé nahlédnutí se zaznamenává.

## Chyby

- Neoprávněný přístup → 403 `{error:'Na tohle nemáš oprávnění.'}`; neexistující e-mail / člen → 404.
- Pokus zablokovat vlastníka nebo změnit jeho roli → 400.

## Testy

- Čistý modul `lib/admin/rules.ts` (rozhodování o oprávnění akcí: `canDo(actor,action,target)`) + `scripts/check-admin.mjs` (admin vs. vlastník, blokace vlastníka, role jen vlastník, člen bez přihlášení).
- Ručně na produkci po nasazení: schválit/zablokovat testovací e-mail, cizí deník jako vlastník (audit záznam), jako admin (Jindřich/Marko) 403 na `?as=` a bez zůstatků v `/api/admin/mt`.

## Mimo rozsah

Mazání uživatelů a jejich dat, e-mailové notifikace při schválení, grafy statistik v čase, export.
