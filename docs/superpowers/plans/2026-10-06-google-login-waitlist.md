# Google login a waitlist – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** tradee.eu pouští dovnitř jen Google účty schválené v DB (nebo `OWNER_EMAIL`); ostatní vidí statickou homepage s waitlistem.

**Architecture:** Nginx `auth_request` schová celou aplikaci včetně `/assets` za `/auth/check`. Login přes Google (authorization code + PKCE) a podepsaná session cookie jsou route handlery v aplikaci. `identity()` v `lib/server.ts` čte session cookie, takže API routy se nemění. Homepage a stránka soukromí jsou statické soubory v `public/landing/`.

**Tech Stack:** vinext (Next 16 App Router na Cloudflare Workers runtime, lokálně přes `wrangler dev`), MariaDB přes adaptér `lib/mysql.ts`, WebCrypto, nginx, Python 3 (pymysql) pro skripty.

**Spec:** `docs/superpowers/specs/2026-10-06-google-login-waitlist-design.md`

## Global Constraints

- `OWNER_EMAIL=d.slaby06@gmail.com`, `PUBLIC_URL=https://tradee.eu`, redirect URI přesně `https://tradee.eu/auth/callback`.
- Session cookie `tradee_session`, 30 dní, `HttpOnly; Secure; SameSite=Lax; Path=/`. OAuth cookie `tradee_oauth`, 600 s.
- ID uživatele z Googlu = `g:` + `sub`.
- Scope `openid email profile`; přijímá se jen `email_verified = true`, `iss ∈ {accounts.google.com, https://accounts.google.com}`, `aud = GOOGLE_CLIENT_ID`.
- E-maily se ukládají vždy lowercase, max 254 znaků.
- Texty v UI česky. Hlášky landing podle `?stav=`: `zapsano`, `cekas`, `chyba`, `neplatny`.
- Tajné hodnoty jen v `~/tradee/.auth.env` na VPS (600), nikdy v gitu.
- Kód drží styl repa: kompaktní TS, české komentáře, testy jako `scripts/check-*.mjs` (`node --experimental-strip-types`), Python testy v `scripts/tests/` (unittest).
- Commity končí řádkem `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Na VPS se necommituje (blokovalo by `fundamentals_agent.py`); vše jde přes GitHub `main` a `git pull --ff-only`.

## Odchylky od specu (upřesnění při plánování)

- `identity()` ověřuje cookie sama a hlavičky `X-Tradee-*` se nepoužívají. Spec je zmiňoval jako kanál z `/auth/check`; čtení cookie přímo v aplikaci je jednodušší a bezpečnější (podvržená hlavička nemá kam vstoupit).
- Výsledek kontroly přístupu se v procesu cachuje **30 s** (jinak by `/auth/check` u každého assetu otevíral nové spojení do DB). Odebrání přístupu tedy platí do 30 s, ne okamžitě.
- Statické stránky obsluhuje wrangler assets (`html_handling: auto-trailing-slash`): `/landing/` → `landing/index.html`, `/landing/soukromi` → `landing/soukromi.html`.

## Review Focus

- Nepřihlášený stáhne `/assets/*.js` (obsahuje data) → musí dostat 302 na `/`, ne soubor. Pin: Task 9 krok s curl na asset.
- Klient pošle vlastní hlavičky `oai-authenticated-user-*` → po přepnutí nginxu nesmí být přihlášený. Pin: Task 9 krok s podvrženou hlavičkou.
- Session cookie s upraveným payloadem (jiný e-mail) nebo prošlá → odmítnuta. Pin: Task 1 testy `verifySession`.
- Uživatel v Google odmítne souhlas (`?error=access_denied`) nebo otevře starý callback odkaz → `/?stav=chyba`, žádná výjimka. Pin: Task 9 Step 4 (curl na `/auth/callback?error=access_denied`).
- Formulář waitlistu: prázdný/nevalidní e-mail, opakovaný zápis, vyplněný honeypot → česká hláška / tichý úspěch, žádná 500 a žádné prozrazení, kdo už je na seznamu. Pin: Task 1 testy `normalizeEmail` + Task 9 Step 4 (curl na `/api/waitlist`).

---

## Mapa souborů

| Soubor | Odpovědnost |
|---|---|
| `lib/auth.ts` (nový) | Čisté pomocné funkce bez DB a bez `cloudflare:workers`: base64url, session podpis/ověření, PKCE, claims, cookies, URL na Google, validace e-mailu. Testovatelné v Node. |
| `scripts/check-auth.mjs` (nový) | Testy `lib/auth.ts`. |
| `lib/server.ts` (úprava) | `runtime()` typy, `authEnv()`, `currentUser()`, `recordLogin()`, nové `identity()` (+ dočasný legacy fallback). |
| `drizzle/mariadb/0003_waitlist.sql` (nový) | Tabulka `waitlist`. |
| `app/auth/{google,callback,check,logout}/route.ts` (nové) | OAuth tok, kontrola pro nginx, odhlášení. |
| `app/api/waitlist/route.ts` (nový) | Veřejný zápis na waitlist (JSON i form). |
| `public/landing/index.html`, `public/landing/soukromi.html` (nové) | Veřejná homepage a zásady ochrany osobních údajů. |
| `app/shell.tsx`, `app/palette.tsx`, `app/palette.css` (úprava) | Tlačítko Odhlásit v menu avatara. |
| `scripts/migrate-legacy-user.py` + `scripts/tests/test_migrate_legacy_user.py` (nové) | Převod dat účtu `jindra` na Google ID. |
| `deploy/nginx-tradee.eu.conf`, `deploy/nginx-tradee-proxy.conf` (nové) | Nginx config (šablona v repu, kopíruje se na VPS). |
| `.gitignore`, `.env.example`, `app/chatgpt-auth.ts` (smazat), `scripts/refresh_calendar.py`, `scripts/fundamentals_agent.py` | Úklid a doména. |

---

### Task 1: Čisté auth helpery (`lib/auth.ts`)

**Files:**
- Create: `lib/auth.ts`
- Test: `scripts/check-auth.mjs`

**Interfaces:**
- Produces:
  - `SESSION_COOKIE='tradee_session'`, `OAUTH_COOKIE='tradee_oauth'`, `SESSION_DAYS=30`
  - `type Session={sub:string;email:string;name:string;exp:number}` (`exp` v sekundách)
  - `b64url(bytes:Uint8Array):string`, `fromB64url(s:string):Uint8Array`
  - `randomToken(bytes?:number):string`
  - `signSession(s:Session,secret:string):Promise<string>`
  - `verifySession(token:string|null|undefined,secret:string,nowSec?:number):Promise<Session|null>`
  - `pkceChallenge(verifier:string):Promise<string>`, `pkcePair():Promise<{verifier:string;challenge:string}>`
  - `decodeJwtPayload(jwt:string):Record<string,unknown>|null`
  - `checkIdClaims(c:Record<string,unknown>|null,clientId:string,nowSec:number):{ok:true;sub:string;email:string;name:string}|{ok:false;reason:string}`
  - `normalizeEmail(v:unknown):string|null`
  - `readCookie(header:string|null,name:string):string|null`
  - `serializeCookie(name:string,value:string,maxAgeSec:number):string`
  - `redirectTo(location:string,cookies?:string[],status?:number):Response`
  - `googleAuthUrl(p:{clientId:string;redirectUri:string;state:string;challenge:string}):string`

- [ ] **Step 1: Napiš failing test `scripts/check-auth.mjs`**

```js
// Kontrola auth helperů: node --experimental-strip-types scripts/check-auth.mjs
import {signSession,verifySession,pkceChallenge,pkcePair,checkIdClaims,decodeJwtPayload,normalizeEmail,readCookie,serializeCookie,b64url,googleAuthUrl,redirectTo} from '../lib/auth.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const now=1_800_000_000;
const s={sub:'g:123',email:'a@b.cz',name:'Áda',exp:now+60};

const t=await signSession(s,'tajne');
check('session: platná projde',JSON.stringify(await verifySession(t,'tajne',now))===JSON.stringify(s),await verifySession(t,'tajne',now));
check('session: prošlá neprojde',await verifySession(t,'tajne',now+61)===null);
check('session: jiný secret neprojde',await verifySession(t,'jine',now)===null);
const [p,sig]=t.split('.');
const forged=b64url(new TextEncoder().encode(JSON.stringify({...s,email:'admin@x.cz'})))+'.'+sig;
check('session: změněný payload neprojde',await verifySession(forged,'tajne',now)===null);
check('session: změněný podpis neprojde',await verifySession(p+'.'+sig.slice(0,-2)+'AA','tajne',now)===null);
check('session: nesmysl/prázdná neprojde',await verifySession('xyz','tajne',now)===null&&await verifySession(null,'tajne',now)===null&&await verifySession('a.b.c','tajne',now)===null);

check('pkce: vektor RFC 7636',await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')==='E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
const pair=await pkcePair();
check('pkce: pár sedí a verifier má 43+ znaků',pair.verifier.length>=43&&await pkceChallenge(pair.verifier)===pair.challenge,pair);

const claims={iss:'https://accounts.google.com',aud:'cid',sub:'999',email:'Ja@Gmail.com',email_verified:true,name:'Já',exp:now+100};
const okc=checkIdClaims(claims,'cid',now);
check('claims: platné → lowercase e-mail',okc.ok&&okc.email==='ja@gmail.com'&&okc.sub==='999'&&okc.name==='Já',okc);
check('claims: jiný aud',!checkIdClaims({...claims,aud:'jiny'},'cid',now).ok);
check('claims: cizí iss',!checkIdClaims({...claims,iss:'https://evil.com'},'cid',now).ok);
check('claims: neověřený e-mail',!checkIdClaims({...claims,email_verified:false},'cid',now).ok);
check('claims: prošlý token',!checkIdClaims({...claims,exp:now-1},'cid',now).ok);
check('claims: null',!checkIdClaims(null,'cid',now).ok);
const noName=checkIdClaims({...claims,name:undefined},'cid',now);
check('claims: bez jména → část e-mailu',noName.ok&&noName.name==='ja',noName);

const jwt='x.'+b64url(new TextEncoder().encode(JSON.stringify({sub:'1',name:'Žluťoučký'})))+'.y';
check('jwt: dekóduje UTF-8 payload',decodeJwtPayload(jwt)?.name==='Žluťoučký',decodeJwtPayload(jwt));
check('jwt: rozbitý → null',decodeJwtPayload('nic')===null&&decodeJwtPayload('a.###.c')===null);

check('email: normalizace',normalizeEmail('  Pepa@Seznam.CZ ')==='pepa@seznam.cz');
check('email: nevalidní',[ '', 'bez-zavinace', 'a@b', 'a b@c.cz', null, 42, 'x'.repeat(250)+'@a.cz'].every(v=>normalizeEmail(v)===null));

check('cookie: čtení',readCookie('a=1; tradee_session=abc.def; b=2','tradee_session')==='abc.def'&&readCookie(null,'x')===null&&readCookie('a=1','x')===null);
const sc=serializeCookie('tradee_session','v',60);
check('cookie: atributy',sc==='tradee_session=v; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60',sc);

const u=new URL(googleAuthUrl({clientId:'cid',redirectUri:'https://tradee.eu/auth/callback',state:'st',challenge:'ch'}));
check('google url',u.origin+u.pathname==='https://accounts.google.com/o/oauth2/v2/auth'&&u.searchParams.get('scope')==='openid email profile'&&u.searchParams.get('code_challenge_method')==='S256'&&u.searchParams.get('response_type')==='code'&&u.searchParams.get('state')==='st'&&u.searchParams.get('prompt')==='select_account',u.toString());

const r=redirectTo('/?stav=cekas',['a=1','b=2']);
check('redirect: 302 + dvě cookies',r.status===302&&r.headers.get('location')==='/?stav=cekas'&&r.headers.getSetCookie().length===2&&r.headers.get('cache-control')==='no-store',[r.status,r.headers.getSetCookie()]);

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
```

- [ ] **Step 2: Spusť test – musí selhat**

Run: `node --experimental-strip-types scripts/check-auth.mjs`
Expected: chyba `Cannot find module '…/lib/auth.ts'`.

- [ ] **Step 3: Implementuj `lib/auth.ts`**

```ts
// Čisté pomocné funkce pro přihlášení přes Google (bez DB a bez cloudflare:workers, aby šly testovat v Node).
export const SESSION_COOKIE='tradee_session',OAUTH_COOKIE='tradee_oauth',SESSION_DAYS=30;
export type Session={sub:string;email:string;name:string;exp:number};
const enc=new TextEncoder(),dec=new TextDecoder();
const ISSUERS=['accounts.google.com','https://accounts.google.com'];

export function b64url(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
export function fromB64url(s:string){const b=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));return Uint8Array.from(b,c=>c.charCodeAt(0))}
export const randomToken=(bytes=32)=>b64url(crypto.getRandomValues(new Uint8Array(bytes)));

const hmacKey=(secret:string)=>crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
export async function signSession(s:Session,secret:string){const body=b64url(enc.encode(JSON.stringify(s)));const sig=new Uint8Array(await crypto.subtle.sign('HMAC',await hmacKey(secret),enc.encode(body)));return body+'.'+b64url(sig)}
export async function verifySession(token:string|null|undefined,secret:string,nowSec=Date.now()/1000):Promise<Session|null>{
 const parts=(token||'').split('.');if(parts.length!==2||!parts[0]||!parts[1])return null;
 try{
  if(!await crypto.subtle.verify('HMAC',await hmacKey(secret),fromB64url(parts[1]),enc.encode(parts[0])))return null;
  const s=JSON.parse(dec.decode(fromB64url(parts[0]))) as Session;
  return typeof s.sub==='string'&&typeof s.email==='string'&&typeof s.name==='string'&&typeof s.exp==='number'&&s.exp>nowSec?s:null;
 }catch{return null}
}

export async function pkceChallenge(verifier:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(verifier))))}
export async function pkcePair(){const verifier=randomToken(32);return {verifier,challenge:await pkceChallenge(verifier)}}

export function decodeJwtPayload(jwt:string):Record<string,unknown>|null{const p=jwt.split('.');if(p.length!==3)return null;try{const v=JSON.parse(dec.decode(fromB64url(p[1])));return v&&typeof v==='object'?v:null}catch{return null}}

// Token přišel přímo z token endpointu Googlu přes TLS → podpis netřeba ověřovat (OIDC Core 3.1.3.7), jen claims.
export function checkIdClaims(c:Record<string,unknown>|null,clientId:string,nowSec:number):{ok:true;sub:string;email:string;name:string}|{ok:false;reason:string}{
 if(!c)return {ok:false,reason:'chybí claims'};
 if(!ISSUERS.includes(String(c.iss)))return {ok:false,reason:'iss'};
 if(c.aud!==clientId)return {ok:false,reason:'aud'};
 if(typeof c.exp!=='number'||c.exp<=nowSec)return {ok:false,reason:'exp'};
 if(c.email_verified!==true&&c.email_verified!=='true')return {ok:false,reason:'email_verified'};
 const email=normalizeEmail(c.email);if(!email||typeof c.sub!=='string'||!c.sub)return {ok:false,reason:'email/sub'};
 const name=typeof c.name==='string'&&c.name.trim()?c.name.trim().slice(0,200):email.split('@')[0];
 return {ok:true,sub:c.sub,email,name};
}

export function normalizeEmail(v:unknown){if(typeof v!=='string')return null;const e=v.trim().toLowerCase();return e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?e:null}

export function readCookie(header:string|null,name:string){for(const part of (header||'').split(';')){const i=part.indexOf('=');if(i>0&&part.slice(0,i).trim()===name)return part.slice(i+1).trim()}return null}
export const serializeCookie=(name:string,value:string,maxAgeSec:number)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
export function redirectTo(location:string,cookies:string[]=[],status=302){const h=new Headers({Location:location,'Cache-Control':'no-store'});for(const c of cookies)h.append('Set-Cookie',c);return new Response(null,{status,headers:h})}

export function googleAuthUrl(p:{clientId:string;redirectUri:string;state:string;challenge:string}){
 return 'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:p.clientId,redirect_uri:p.redirectUri,response_type:'code',scope:'openid email profile',state:p.state,code_challenge:p.challenge,code_challenge_method:'S256',prompt:'select_account'});
}
```

- [ ] **Step 4: Spusť test – musí projít**

Run: `node --experimental-strip-types scripts/check-auth.mjs`
Expected: všechny řádky `ok`, na konci `vše ok`.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts scripts/check-auth.mjs
git commit -m "Auth: helpery pro Google login (session, PKCE, claims, cookies)"
```

---

### Task 2: Tabulka waitlist, konfigurace a `identity()` ze session

**Files:**
- Create: `drizzle/mariadb/0003_waitlist.sql`
- Modify: `lib/server.ts:3` (typ `runtime`), `lib/server.ts:6-7` (`identity`)
- Modify: `.gitignore`, `.env.example`

**Interfaces:**
- Consumes: z Task 1 `verifySession`, `readCookie`, `SESSION_COOKIE`.
- Produces (v `lib/server.ts`):
  - `type User={id:string;email:string;name:string;role:string;owner:boolean}`
  - `authEnv():{clientId:string;clientSecret:string;sessionSecret:string;publicUrl:string}` (vyhodí `Error('Přihlášení není nastavené.')`, když chybí)
  - `isOwner(email:string):boolean`
  - `currentUser(req:Request):Promise<User|null>` (null = nepřihlášený nebo bez přístupu; DB chyba se propaguje)
  - `recordLogin(u:{sub:string;email:string;name:string}):Promise<boolean>` (`sub` už s prefixem `g:`; vrací, zda má přístup)
  - `identity(req:Request):Promise<User>` (beze změny signatury)

- [ ] **Step 1: Migrace `drizzle/mariadb/0003_waitlist.sql`**

```sql
CREATE TABLE IF NOT EXISTS waitlist(
  email VARCHAR(254) NOT NULL PRIMARY KEY,
  name VARCHAR(200) NULL,
  google_sub VARCHAR(64) NULL UNIQUE,
  source VARCHAR(16) NOT NULL,
  approved TINYINT(1) NOT NULL DEFAULT 0,
  created DATETIME NOT NULL,
  approved_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
```

- [ ] **Step 2: `.gitignore` a `.env.example`**

Do `.gitignore` pod řádek `.mariadb.env` přidej `.auth.env`. `.env.example` nahraď:

```
OWNER_EMAIL=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SESSION_SECRET=
PUBLIC_URL=https://tradee.eu
```

- [ ] **Step 3: Rozšiř `lib/server.ts`**

Na začátek přidej import a do typu `runtime()` doplň `GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;SESSION_SECRET?:string;PUBLIC_URL?:string`. Stávající `identity` (řádky 6–7) přejmenuj na `legacyIdentity`, místo `throw` vrať `null`, a nad ni vlož nový kód:

```ts
import {verifySession,readCookie,SESSION_COOKIE} from './auth';
```

```ts
export type User={id:string;email:string;name:string;role:string;owner:boolean};
export function authEnv(){const e=runtime();if(!e.GOOGLE_CLIENT_ID||!e.GOOGLE_CLIENT_SECRET||!e.SESSION_SECRET)throw new Error('Přihlášení není nastavené.');return {clientId:e.GOOGLE_CLIENT_ID,clientSecret:e.GOOGLE_CLIENT_SECRET,sessionSecret:e.SESSION_SECRET,publicUrl:e.PUBLIC_URL||'https://tradee.eu'}}
export function isOwner(email:string){const o=(runtime().OWNER_EMAIL||'').trim().toLowerCase();return !!o&&email.toLowerCase()===o}
// Krátká cache přístupu: /auth/check se volá u každého assetu, bez ní by každý soubor otevíral spojení do DB.
const accessCache=new Map<string,{until:number;role:string|null}>();
async function accessRole(id:string,email:string){
 const hit=accessCache.get(id);if(hit&&hit.until>Date.now())return hit.role;
 const owner=isOwner(email);let role:string|null=null;
 const w=owner?null:await db().prepare('SELECT approved FROM waitlist WHERE email=?').bind(email).first<{approved:number}>();
 if(owner||Number(w?.approved)===1){const m=await db().prepare('SELECT role FROM members WHERE id=?').bind(id).first<{role:string}>();role=owner?'admin':m?.role||'member'}
 accessCache.set(id,{until:Date.now()+30_000,role});return role;
}
export async function currentUser(req:Request):Promise<User|null>{
 const secret=runtime().SESSION_SECRET;if(!secret)return null;
 const s=await verifySession(readCookie(req.headers.get('cookie'),SESSION_COOKIE),secret);if(!s)return null;
 const role=await accessRole(s.sub,s.email);
 return role?{id:s.sub,email:s.email,name:s.name,role,owner:isOwner(s.email)}:null;
}
// Zapíše přihlášení na waitlist; schválenému (nebo ownerovi) založí/aktualizuje člena. Vrací, zda smí dovnitř.
export async function recordLogin(u:{sub:string;email:string;name:string}){
 await db().prepare("INSERT INTO waitlist(email,name,google_sub,source,approved,created) VALUES(?,?,?,'google',0,NOW()) ON DUPLICATE KEY UPDATE name=VALUES(name),google_sub=VALUES(google_sub)").bind(u.email,u.name,u.sub.slice(2)).run();
 const owner=isOwner(u.email);
 const w=await db().prepare('SELECT approved FROM waitlist WHERE email=?').bind(u.email).first<{approved:number}>();
 const ok=owner||Number(w?.approved)===1;
 if(ok)await db().prepare("INSERT INTO members(id,email,name,role) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE email=VALUES(email),name=VALUES(name),role=IF(VALUES(role)='admin','admin',role)").bind(u.sub,u.email,u.name,owner?'admin':'member').run();
 accessCache.delete(u.sub);return ok;
}
export async function identity(req:Request):Promise<User>{const u=await currentUser(req)??await legacyIdentity(req);if(!u)throw new Error('Pro tuto akci se přihlas.');return u}
```

`legacyIdentity` (dočasné do Task 10): první příkaz místo `if(!id||!email)throw new Error('Pro tuto akci se přihlas.');` bude `if(!id||!email)return null;`. Zbytek beze změny.

- [ ] **Step 4: Ověř typy a build**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "lib/(auth|server)\.ts" ; npm run build 2>&1 | tail -5`
Expected: žádná chyba v `lib/auth.ts` ani `lib/server.ts`; build skončí bez chyby. (Pokud lokální build selže kvůli chybějící R2/D1 konfiguraci, ověř build až na VPS v Task 9 a zde stačí `tsc`.)

- [ ] **Step 5: Commit**

```bash
git add drizzle/mariadb/0003_waitlist.sql lib/server.ts .gitignore .env.example
git commit -m "Auth: tabulka waitlist, identity() ze session cookie (s dočasným fallbackem na oai hlavičky)"
```

---

### Task 3: Route handlery `/auth/*`

**Files:**
- Create: `app/auth/google/route.ts`, `app/auth/callback/route.ts`, `app/auth/check/route.ts`, `app/auth/logout/route.ts`

**Interfaces:**
- Consumes: Task 1 (`pkcePair`, `randomToken`, `googleAuthUrl`, `serializeCookie`, `readCookie`, `redirectTo`, `decodeJwtPayload`, `checkIdClaims`, `signSession`, konstanty), Task 2 (`authEnv`, `currentUser`, `recordLogin`, `sameOrigin`).
- Produces: HTTP `GET /auth/google` → 302 Google; `GET /auth/callback` → 302 `/` | `/?stav=cekas` | `/?stav=chyba`; `GET /auth/check` → 204 | 401 | 503; `POST /auth/logout` → 303 `/`.

- [ ] **Step 1: `app/auth/google/route.ts`**

```ts
import {authEnv} from '@/lib/server';
import {pkcePair,randomToken,googleAuthUrl,serializeCookie,redirectTo,OAUTH_COOKIE} from '@/lib/auth';
export async function GET(){
 try{const c=authEnv();const state=randomToken(16);const {verifier,challenge}=await pkcePair();
  return redirectTo(googleAuthUrl({clientId:c.clientId,redirectUri:c.publicUrl+'/auth/callback',state,challenge}),[serializeCookie(OAUTH_COOKIE,state+'.'+verifier,600)])}
 catch(e){console.error(e);return redirectTo('/?stav=chyba')}
}
```

- [ ] **Step 2: `app/auth/callback/route.ts`**

```ts
import {authEnv,recordLogin} from '@/lib/server';
import {readCookie,serializeCookie,redirectTo,decodeJwtPayload,checkIdClaims,signSession,OAUTH_COOKIE,SESSION_COOKIE,SESSION_DAYS} from '@/lib/auth';
export async function GET(req:Request){
 const url=new URL(req.url),clear=serializeCookie(OAUTH_COOKIE,'',0);
 try{
  const c=authEnv();
  const [state,verifier]=(readCookie(req.headers.get('cookie'),OAUTH_COOKIE)||'').split('.');
  const code=url.searchParams.get('code');
  if(!state||!verifier||!code||url.searchParams.get('state')!==state)throw new Error('OAuth: nesedí state nebo chybí code ('+(url.searchParams.get('error')||'-')+')');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:c.clientId,client_secret:c.clientSecret,redirect_uri:c.publicUrl+'/auth/callback',grant_type:'authorization_code',code_verifier:verifier})});
  const j=await r.json().catch(()=>({})) as {id_token?:string;error?:string};
  if(!r.ok||!j.id_token)throw new Error('OAuth token: '+(j.error||r.status));
  const cl=checkIdClaims(decodeJwtPayload(j.id_token),c.clientId,Date.now()/1000);
  if(!cl.ok)throw new Error('OAuth claims: '+cl.reason);
  const user={sub:'g:'+cl.sub,email:cl.email,name:cl.name};
  if(!await recordLogin(user))return redirectTo('/?stav=cekas',[clear]);
  const token=await signSession({...user,exp:Math.floor(Date.now()/1000)+SESSION_DAYS*86400},c.sessionSecret);
  return redirectTo('/',[clear,serializeCookie(SESSION_COOKIE,token,SESSION_DAYS*86400)]);
 }catch(e){console.error(e);return redirectTo('/?stav=chyba',[clear])}
}
```

- [ ] **Step 3: `app/auth/check/route.ts`**

```ts
import {currentUser} from '@/lib/server';
// Jen pro nginx auth_request: 204 = pustit, 401 = landing/přesměrování, 503 = DB nedostupná (nesmí vypadat jako odhlášení).
export async function GET(req:Request){
 try{return new Response(null,{status:await currentUser(req)?204:401,headers:{'Cache-Control':'no-store'}})}
 catch(e){console.error(e);return new Response(null,{status:503})}
}
```

- [ ] **Step 4: `app/auth/logout/route.ts`**

```ts
import {sameOrigin,failed} from '@/lib/server';
import {serializeCookie,redirectTo,SESSION_COOKIE} from '@/lib/auth';
export async function POST(req:Request){try{sameOrigin(req);return redirectTo('/',[serializeCookie(SESSION_COOKIE,'',0)],303)}catch(e){return failed(e)}}
```

- [ ] **Step 5: Typy**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "app/auth/" ; echo "exit:$?"`
Expected: žádný výstup z grepu (žádné chyby v `app/auth/`).

- [ ] **Step 6: Commit**

```bash
git add app/auth
git commit -m "Auth: /auth/google, /auth/callback, /auth/check, /auth/logout"
```

---

### Task 4: Veřejný endpoint `/api/waitlist`

**Files:**
- Create: `app/api/waitlist/route.ts`

**Interfaces:**
- Consumes: Task 1 `normalizeEmail`, `redirectTo`; `db`, `sameOrigin`, `failed` z `lib/server.ts`.
- Produces: `POST /api/waitlist` – JSON `{email,web}` → `{ok:true}` | 400 `{error}`; form-urlencoded → 303 `/?stav=zapsano` | `/?stav=neplatny` | `/?stav=chyba`.

- [ ] **Step 1: Implementace**

```ts
import {db,sameOrigin,failed} from '@/lib/server';
import {normalizeEmail,redirectTo} from '@/lib/auth';
// Veřejný zápis na waitlist. Opakovaný zápis je tichý úspěch, aby nešlo zjistit, kdo už na seznamu je; `web` je honeypot.
export async function POST(req:Request){
 const form=!(req.headers.get('content-type')||'').includes('application/json');
 const done=(stav:string)=>form?redirectTo('/?stav='+stav,[],303):stav==='zapsano'?Response.json({ok:true}):Response.json({error:stav==='neplatny'?'Zadej platný e-mail.':'Zápis se nepovedl, zkus to znovu.'},{status:400});
 try{
  sameOrigin(req);
  const b=form?Object.fromEntries((await req.formData()).entries()):await req.json() as Record<string,unknown>;
  if(typeof b.web==='string'&&b.web)return done('zapsano');
  const email=normalizeEmail(b.email);if(!email)return done('neplatny');
  await db().prepare("INSERT IGNORE INTO waitlist(email,source,approved,created) VALUES(?,'form',0,NOW())").bind(email).run();
  return done('zapsano');
 }catch(e){if(!form)return failed(e);console.error(e);return done('chyba')}
}
```

- [ ] **Step 2: Typy**

Run: `npx tsc --noEmit -p . 2>&1 | grep "app/api/waitlist" ; true`
Expected: žádný výstup.

- [ ] **Step 3: Commit**

```bash
git add app/api/waitlist/route.ts
git commit -m "Waitlist: veřejný zápis e-mailu (JSON i formulář, honeypot)"
```

---

### Task 5: Statická homepage a stránka soukromí

**Files:**
- Create: `public/landing/index.html`, `public/landing/soukromi.html`

**Interfaces:**
- Consumes: `POST /api/waitlist` (Task 4), `GET /auth/google` (Task 3).
- Produces: `/landing/` a `/landing/soukromi` (wrangler assets); nginx je servíruje na `/` a `/soukromi`.

- [ ] **Step 1: `public/landing/index.html`**

Minimální verze (obsah a vzhled se doladí zvlášť – spec, „Mimo rozsah“). Barvy podle aplikace (`app/globals.css`: bílé pozadí, tmavý text, modrý akcent `#2f5bea`).

```html
<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tradee · fundamentální a technická analýza měn</title>
<meta name="description" content="Síla měn, COT pozice, sezonalita a transparentní skórování. Zapiš se na waitlist.">
<link rel="icon" href="/favicon.svg">
<style>
:root{--bg:#f6f8fc;--card:#fff;--text:#141518;--muted:#5d6676;--line:#e3e8f2;--accent:#2f5bea;--ok:#127a4a;--err:#b42318}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:32px 28px;box-shadow:0 12px 32px -16px #1b2a5a33}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px;margin-bottom:20px}
.brand img{width:32px;height:32px}
h1{font-size:24px;line-height:1.25;margin:0 0 8px}
p{color:var(--muted);margin:0 0 20px}
form{display:flex;gap:8px;flex-wrap:wrap}
input[type=email]{flex:1 1 200px;min-width:0;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font:inherit}
button{padding:11px 16px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
.hp{position:absolute;left:-9999px}
#msg{min-height:24px;margin:12px 0 0;font-size:14px}
#msg.ok{color:var(--ok)}#msg.err{color:var(--err)}
.login{margin-top:20px;padding-top:16px;border-top:1px solid var(--line);font-size:14px;color:var(--muted)}
a{color:var(--accent)}
footer{margin-top:16px;font-size:12px;color:var(--muted)}
</style>
</head>
<body>
<main>
 <div class="brand"><img src="/favicon.svg" alt=""><span>Tradee</span></div>
 <h1>Fundamentální a technická analýza měn na jednom místě</h1>
 <p>Tradee je zatím v uzavřeném provozu. Zapiš se a ozveme se, až tě pustíme dovnitř.</p>
 <form id="f" method="post" action="/api/waitlist">
  <input type="email" name="email" required maxlength="254" placeholder="Tvůj e-mail" aria-label="Tvůj e-mail" autocomplete="email">
  <input class="hp" type="text" name="web" tabindex="-1" autocomplete="off" aria-hidden="true">
  <button type="submit">Chci přístup</button>
 </form>
 <p id="msg" role="status" aria-live="polite"></p>
 <div class="login">Už máš přístup? <a href="/auth/google">Přihlásit přes Google</a></div>
 <footer><a href="/soukromi">Zásady ochrany osobních údajů</a></footer>
</main>
<script>
(function(){
 var M={zapsano:['ok','Díky, jsi na seznamu. Ozveme se.'],cekas:['ok','Tvůj účet čeká na schválení. Ozveme se.'],chyba:['err','Přihlášení se nepovedlo, zkus to znovu.'],neplatny:['err','Zadej platný e-mail.']};
 var msg=document.getElementById('msg'),f=document.getElementById('f');
 function show(k){var m=M[k];if(!m)return;msg.className=m[0];msg.textContent=m[1]}
 show(new URLSearchParams(location.search).get('stav'));
 f.addEventListener('submit',function(e){
  e.preventDefault();var b=f.querySelector('button');b.disabled=true;
  fetch('/api/waitlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.email.value,web:f.web.value})})
   .then(function(r){return r.json().then(function(j){if(!r.ok)throw j;show('zapsano');f.reset()})})
   .catch(function(j){msg.className='err';msg.textContent=(j&&j.error)||'Zápis se nepovedl, zkus to znovu.'})
   .then(function(){b.disabled=false});
 });
})();
</script>
</body>
</html>
```

- [ ] **Step 2: `public/landing/soukromi.html`**

```html
<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zásady ochrany osobních údajů · Tradee</title>
<link rel="icon" href="/favicon.svg">
<style>
body{margin:0;background:#f6f8fc;color:#141518;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;padding:32px 16px}
main{max-width:680px;margin:0 auto;background:#fff;border:1px solid #e3e8f2;border-radius:18px;padding:28px}
h1{font-size:24px;margin:0 0 16px}h2{font-size:17px;margin:24px 0 6px}
a{color:#2f5bea}
</style>
</head>
<body>
<main>
 <h1>Zásady ochrany osobních údajů</h1>
 <p>Platné od 6. 10. 2026. Týkají se webu tradee.eu.</p>
 <h2>Jaké údaje ukládáme</h2>
 <p>Když se zapíšeš na waitlist, uložíme tvůj e-mail a čas zápisu. Když se přihlásíš přes Google, uložíme navíc jméno a identifikátor účtu, které nám Google předá (rozsah <code>openid email profile</code>). K tvým kontaktům, souborům ani jiným údajům v Google účtu přístup nemáme.</p>
 <h2>K čemu je používáme</h2>
 <p>Jen k tomu, abychom tě mohli pustit do aplikace, poznat tě při dalším přihlášení a případně se ti ozvat ohledně přístupu. Údaje neprodáváme ani nepředáváme třetím stranám.</p>
 <h2>Cookies</h2>
 <p>Používáme jen nezbytné cookies pro přihlášení (session na 30 dní). Žádné reklamní ani analytické cookies.</p>
 <h2>Smazání údajů</h2>
 <p>O smazání svých údajů můžeš kdykoli požádat odpovědí na e-mail, který ti od nás přijde, nebo přes kontakt uvedený u aplikace v Google účtu. Údaje smažeme bez zbytečného odkladu.</p>
 <p><a href="/">← Zpět na Tradee</a></p>
</main>
</body>
</html>
```

- [ ] **Step 3: Kontrola HTML**

Run: `python3 -c "import html.parser,sys;[html.parser.HTMLParser().feed(open(f).read()) for f in ['public/landing/index.html','public/landing/soukromi.html']];print('ok')"`
Expected: `ok`. Pak otevři `public/landing/index.html` v prohlížeči a zkontroluj šířku 375 px (bez vodorovného posuvníku) a že `?stav=cekas` ukáže hlášku.

- [ ] **Step 4: Commit**

```bash
git add public/landing
git commit -m "Landing: minimální homepage s waitlistem a zásady ochrany osobních údajů"
```

---

### Task 6: Odhlášení v aplikaci a úklid

**Files:**
- Modify: `app/palette.tsx` (`PalettePicker` dostane volitelné `children`)
- Modify: `app/shell.tsx:16` (formulář Odhlásit v menu avatara)
- Modify: `app/palette.css` (styl tlačítka)
- Delete: `app/chatgpt-auth.ts`
- Modify: `scripts/refresh_calendar.py:17`, `scripts/fundamentals_agent.py:49`

**Interfaces:**
- Consumes: `POST /auth/logout` (Task 3).

- [ ] **Step 1: `PalettePicker` s `children`**

V `app/palette.tsx` změň signaturu a konec komponenty:

```tsx
export function PalettePicker({value,onChoose,error,children}:{value:string;onChoose:(id:string)=>void;error?:string;children?:React.ReactNode}){
```

a před `</div>;` na konci přidej `{children}` (za řádek s `error`).

- [ ] **Step 2: Formulář v `app/shell.tsx`**

`{menu&&<PalettePicker value={palette} onChoose={onPalette} error={paletteError}/>}` nahraď:

```tsx
{menu&&<PalettePicker value={palette} onChoose={onPalette} error={paletteError}><form method="post" action="/auth/logout" className="p-logout"><button type="submit">Odhlásit</button></form></PalettePicker>}
```

- [ ] **Step 3: Styl do `app/palette.css`**

```css
.p-logout{margin:6px 0 0;padding-top:6px;border-top:1px solid #e3e8f2}
.p-logout button{width:100%;color:#b42318;font-weight:600}
```

- [ ] **Step 4: Úklid**

```bash
git rm app/chatgpt-auth.ts
sed -i '' 's#+https://tradee.dejny.eu#+https://tradee.eu#' scripts/refresh_calendar.py
sed -i '' 's#bot@tradee.dejny.eu#bot@tradee.eu#' scripts/fundamentals_agent.py
grep -rn "tradee.dejny.eu\|chatgpt-auth" app lib scripts --include=*.ts --include=*.tsx --include=*.py --include=*.mjs
```

Expected: grep nic nenajde.

- [ ] **Step 5: Testy a typy**

Run: `python3 -m unittest discover -s scripts/tests -t . 2>&1 | tail -3 && npx tsc --noEmit -p . 2>&1 | grep -E "app/(shell|palette)" ; true`
Expected: `OK` z unittestů; žádné TS chyby v `shell`/`palette`.

- [ ] **Step 6: Commit**

```bash
git add -A app/palette.tsx app/shell.tsx app/palette.css app/chatgpt-auth.ts scripts/refresh_calendar.py scripts/fundamentals_agent.py
git commit -m "Odhlásit v menu avatara; úklid ChatGPT auth a staré domény"
```

---

### Task 7: Migrace účtu `jindra`

**Files:**
- Create: `scripts/migrate-legacy-user.py`
- Test: `scripts/tests/test_migrate_legacy_user.py`

**Interfaces:**
- Produces: `statements(old:str,new:str)->list[tuple[str,tuple]]`; CLI `python3 scripts/migrate-legacy-user.py <nové_id> [--apply]` (bez `--apply` jen vypíše počty).

- [ ] **Step 1: Failing test**

```python
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('mlu', Path(__file__).resolve().parents[1] / 'migrate-legacy-user.py')
mlu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mlu)


class StatementsTest(unittest.TestCase):
    def test_poradi_a_parametry(self):
        st = mlu.statements('jindra', 'g:42')
        sqls = [s for s, _ in st]
        # duplicitní vlaječky nového účtu pryč dřív, než se přejmenují staré (PK id = user:instrument)
        self.assertLess(next(i for i, s in enumerate(sqls) if s.startswith('DELETE FROM watch_flags')),
                        next(i for i, s in enumerate(sqls) if s.startswith('UPDATE watch_flags')))
        self.assertTrue(sqls[-1].startswith('DELETE FROM members'))
        for table in ('trades', 'progress', 'messages'):
            self.assertIn((f'UPDATE {table} SET user_id=%s WHERE user_id=%s', ('g:42', 'jindra')), st)
        self.assertIn(('DELETE FROM members WHERE id=%s', ('jindra',)), st)

    def test_odmitne_stejne_id(self):
        with self.assertRaises(ValueError):
            mlu.statements('jindra', 'jindra')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Spusť – musí selhat**

Run: `python3 -m unittest scripts.tests.test_migrate_legacy_user -v`
Expected: FAIL (`FileNotFoundError` / modul neexistuje).

- [ ] **Step 3: Implementace `scripts/migrate-legacy-user.py`**

```python
#!/usr/bin/env python3
"""Převede data starého sdíleného účtu (`jindra`, z nginx hlaviček) na Google ID přihlášeného uživatele.
Použití: python3 scripts/migrate-legacy-user.py g:<sub> [--apply]   (bez --apply jen vypíše, co by se změnilo)
Spouštět až po prvním přihlášení – řádek members s novým ID už musí existovat. Předtím scripts/backup.sh."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD = 'jindra'


def statements(old, new):
    if old == new:
        raise ValueError('staré a nové ID je stejné')
    return [
        ('DELETE FROM watch_flags WHERE user_id=%s AND instrument IN (SELECT instrument FROM (SELECT instrument FROM watch_flags WHERE user_id=%s) x)', (new, old)),
        ("UPDATE watch_flags SET id=CONCAT(%s,':',instrument), user_id=%s WHERE user_id=%s", (new, new, old)),
        ('UPDATE trades SET user_id=%s WHERE user_id=%s', (new, old)),
        ('UPDATE progress SET user_id=%s WHERE user_id=%s', (new, old)),
        ('UPDATE messages SET user_id=%s WHERE user_id=%s', (new, old)),
        ('UPDATE members m JOIN members o ON o.id=%s SET m.palette=o.palette WHERE m.id=%s AND o.palette IS NOT NULL', (old, new)),
        ('DELETE FROM members WHERE id=%s', (old,)),
    ]


def main():
    import pymysql
    sys.path.insert(0, str(ROOT / 'scripts'))
    from importlib import import_module
    load_env = import_module('mariadb-migrate').load_env
    args = [a for a in sys.argv[1:] if a != '--apply']
    if len(args) != 1 or not args[0].startswith('g:'):
        sys.exit('Použití: migrate-legacy-user.py g:<sub> [--apply]')
    new, apply = args[0], '--apply' in sys.argv
    cfg = load_env(ROOT / '.mariadb.env')
    conn = pymysql.connect(host=cfg['MARIADB_HOST'], port=int(cfg.get('MARIADB_PORT', 3306)), user=cfg['MARIADB_USER'], password=cfg['MARIADB_PASSWORD'], database=cfg['MARIADB_DB'], charset='utf8mb4', autocommit=False)
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT COUNT(*) FROM members WHERE id=%s', (new,))
            if cur.fetchone()[0] != 1:
                sys.exit(f'{new} v members není – nejdřív se přihlas.')
            for t in ('trades', 'watch_flags', 'progress', 'messages'):
                cur.execute(f'SELECT COUNT(*) FROM {t} WHERE user_id=%s', (OLD,))
                print(f'{t}: {cur.fetchone()[0]} řádků {OLD} → {new}')
            if not apply:
                print('Nanečisto. Spusť s --apply.')
                return
            for sql, params in statements(OLD, new):
                cur.execute(sql, params)
        conn.commit()
        print('Hotovo.')
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
```

Pozn.: `mariadb-migrate.py` má pomlčku v názvu → import přes `import_module('mariadb-migrate')` funguje, protože `scripts/` je v `sys.path`.

- [ ] **Step 4: Spusť – musí projít**

Run: `python3 -m unittest scripts.tests.test_migrate_legacy_user -v`
Expected: 2 testy `ok`.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-legacy-user.py scripts/tests/test_migrate_legacy_user.py
git commit -m "Skript na převod dat účtu jindra na Google ID"
```

---

### Task 8: Nginx config a service (šablony v repu)

**Files:**
- Create: `deploy/nginx-tradee.eu.conf`, `deploy/nginx-tradee-proxy.conf`

**Interfaces:**
- Consumes: `/auth/check` (204/401/503), `/auth/*`, `/api/waitlist`, `/landing/`, `/landing/soukromi`.

- [ ] **Step 1: `deploy/nginx-tradee-proxy.conf`** (na VPS do `/etc/nginx/snippets/tradee-proxy.conf`)

```nginx
# Společné hlavičky pro proxy na Tradee (wrangler :8787). Staré oai-* hlavičky od klienta se vždy mažou.
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Authorization "";
proxy_set_header oai-authenticated-user-id "";
proxy_set_header oai-authenticated-user-email "";
proxy_set_header oai-authenticated-user-full-name "";
proxy_set_header oai-authenticated-user-full-name-encoding "";
```

- [ ] **Step 2: `deploy/nginx-tradee.eu.conf`** (na VPS do `/etc/nginx/sites-available/tradee.eu`)

```nginx
# Tradee na tradee.eu: celá aplikace (i /assets s daty) za auth_request; veřejné jsou jen login, waitlist a landing.
limit_req_zone $binary_remote_addr zone=tradee_waitlist:1m rate=5r/m;

server {
    listen 443 ssl;
    server_name tradee.eu;
    ssl_certificate /etc/letsencrypt/live/tradee.eu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tradee.eu/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location = /auth/check {
        internal;
        include snippets/tradee-proxy.conf;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_pass http://127.0.0.1:8787;
    }
    location /auth/ {
        include snippets/tradee-proxy.conf;
        proxy_pass http://127.0.0.1:8787;
    }
    location = /api/waitlist {
        limit_req zone=tradee_waitlist burst=5 nodelay;
        limit_req_status 429;
        include snippets/tradee-proxy.conf;
        proxy_pass http://127.0.0.1:8787;
    }
    location /landing/ {
        include snippets/tradee-proxy.conf;
        proxy_pass http://127.0.0.1:8787;
    }
    location = /soukromi {
        include snippets/tradee-proxy.conf;
        proxy_pass http://127.0.0.1:8787/landing/soukromi;
    }
    location = /favicon.svg {
        include snippets/tradee-proxy.conf;
        proxy_pass http://127.0.0.1:8787;
    }
    location / {
        auth_request /auth/check;
        error_page 401 = @unauth;
        include snippets/tradee-proxy.conf;
        client_max_body_size 50m;
        proxy_pass http://127.0.0.1:8787;
    }
    # Nepřihlášený: "/" → landing, API → 401, ostatní → zpět na "/".
    location @unauth {
        if ($uri = /) { rewrite ^ /landing/ break; }
        if ($uri ~ ^/api/) { return 401; }
        return 302 /;
        include snippets/tradee-proxy.conf;
        proxy_pass http://127.0.0.1:8787;
    }
}
server {
    listen 443 ssl;
    server_name www.tradee.eu;
    ssl_certificate /etc/letsencrypt/live/tradee.eu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tradee.eu/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    return 301 https://tradee.eu$request_uri;
}
server {
    listen 80;
    server_name tradee.eu www.tradee.eu;
    return 301 https://tradee.eu$request_uri;
}
```

- [ ] **Step 3: Commit**

```bash
git add deploy
git commit -m "Nginx šablona pro tradee.eu s auth_request a veřejnou landing"
```

---

### Task 9: Nasazení a ověření na VPS

**Files:** žádné v repu (jen VPS: `tradee.service`, nginx). Na VPS se **necommituje**.

- [ ] **Step 1: Push a merge**

Lokálně: `node --experimental-strip-types scripts/check-auth.mjs && python3 -m unittest discover -s scripts/tests -t .` (vše ok), pak `git push origin feature/google-login`, a po souhlasu Daniela fast-forward `main`:

```bash
git checkout main && git pull --ff-only origin main && git merge --ff-only feature/google-login && git push origin main
```

(Když `main` mezitím dostal commity agenta fundamentů, použij `git rebase origin/main` na větvi a znovu testy.)

- [ ] **Step 2: Pull, migrace, build na VPS**

```bash
ssh ubuntu@130.61.122.142 'cd ~/tradee && git pull --ff-only && python3 scripts/mariadb-migrate.py && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run build 2>&1 | tail -3'
```

Expected: migrace vypíše `0003_waitlist.sql`, build bez chyby.

- [ ] **Step 3: Service načte `.auth.env`**

V `/etc/systemd/system/tradee.service` změň `ExecStart` na:

```
ExecStart=/bin/bash -lc 'source /home/ubuntu/.nvm/nvm.sh && nvm use 22 >/dev/null && cat .mariadb.env .auth.env > dist/server/.dev.vars && exec npm start -- --port 8787 --upstream-protocol https'
```

Pak `sudo systemctl daemon-reload && sudo systemctl restart tradee` a počkej, až `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/landing/` vrátí 200.

- [ ] **Step 4: Ověření přes localhost (nginx ještě starý, s heslem)**

```bash
ssh ubuntu@130.61.122.142 'b=http://127.0.0.1:8787
curl -s -o /dev/null -w "landing %{http_code}\n" $b/landing/
curl -s -o /dev/null -w "soukromi %{http_code}\n" $b/landing/soukromi
curl -s -o /dev/null -w "check bez cookie %{http_code}\n" $b/auth/check
curl -s -o /dev/null -w "check s nesmyslem %{http_code}\n" -H "Cookie: tradee_session=a.b" $b/auth/check
curl -s -D- -o /dev/null $b/auth/google | grep -iE "^(HTTP|location|set-cookie)"
curl -s -D- -o /dev/null "$b/auth/callback?error=access_denied" | grep -iE "^(HTTP|location)"
curl -s -H "Origin: https://tradee.eu" -H "Content-Type: application/json" -d "{\"email\":\"neplatny\"}" $b/api/waitlist; echo
curl -s -H "Content-Type: application/json" -d "{\"email\":\"x@y.cz\",\"web\":\"bot\"}" $b/api/waitlist; echo
curl -s -H "Content-Type: application/json" -d "{\"email\":\"Test.Tradee@Example.com\"}" $b/api/waitlist; echo
curl -s -H "Content-Type: application/json" -d "{\"email\":\"test.tradee@example.com\"}" $b/api/waitlist; echo
curl -s -D- -o /dev/null -d "email=" $b/api/waitlist | grep -iE "^(HTTP|location)"'
```

Expected: landing 200, soukromi 200, oba checky 401; `/auth/google` → 302 na `accounts.google.com…` + `Set-Cookie: tradee_oauth=…`; callback s `error` → 302 `/?stav=chyba`; neplatný e-mail → `{"error":"Zadej platný e-mail."}`; honeypot → `{"ok":true}`; oba zápisy testu → `{"ok":true}`; prázdný form → 303 `/?stav=neplatny`. V DB je `test.tradee@example.com` právě jednou a honeypot `x@y.cz` tam není; testovací řádek pak smaž (`DELETE FROM waitlist WHERE email='test.tradee@example.com'`).

Pokud `/landing/` nebo `/landing/soukromi` nevrací 200 (jiné `html_handling` wrangleru), uprav cesty v `deploy/nginx-tradee.eu.conf` podle skutečného chování a commitni opravu.

- [ ] **Step 5: Přepnutí nginxu**

```bash
scp deploy/nginx-tradee-proxy.conf ubuntu@130.61.122.142:/tmp/ && scp deploy/nginx-tradee.eu.conf ubuntu@130.61.122.142:/tmp/
ssh ubuntu@130.61.122.142 'sudo cp /etc/nginx/sites-available/tradee.eu /etc/nginx/sites-available/tradee.eu.bak-basicauth && sudo cp /tmp/nginx-tradee-proxy.conf /etc/nginx/snippets/tradee-proxy.conf && sudo cp /tmp/nginx-tradee.eu.conf /etc/nginx/sites-available/tradee.eu && sudo nginx -t && sudo systemctl reload nginx'
```

Expected: `syntax is ok`, reload bez chyby. Při chybě vrať `.bak-basicauth` a reload.

- [ ] **Step 6: Ověření zvenku (Review Focus)**

```bash
r="--resolve tradee.eu:443:130.61.122.142"
curl -s $r -o /dev/null -w "/ %{http_code}\n" https://tradee.eu/
curl -s $r https://tradee.eu/ | grep -c "Chci přístup"
asset=$(ssh ubuntu@130.61.122.142 'ls ~/tradee/dist/client/assets/*.js | head -1 | xargs basename')
curl -s $r -o /dev/null -w "asset %{http_code} %{redirect_url}\n" https://tradee.eu/assets/$asset
curl -s $r -o /dev/null -w "api %{http_code}\n" https://tradee.eu/api/fundamentals
curl -s $r -o /dev/null -w "spoof %{http_code}\n" -H "oai-authenticated-user-id: jindra" -H "oai-authenticated-user-email: x@y.cz" https://tradee.eu/api/watchlist
curl -s $r -o /dev/null -w "soukromi %{http_code}\n" https://tradee.eu/soukromi
curl -s $r -o /dev/null -w "check zvenku %{http_code}\n" https://tradee.eu/auth/check
curl -s $r -o /dev/null -w "neexistujici %{http_code} %{redirect_url}\n" https://tradee.eu/neco
```

Expected: `/` 200 a grep `1`; asset `302 https://tradee.eu/`; api 401; spoof 401; soukromi 200; check zvenku 404; neexistující 302 na `/`.

- [ ] **Step 7: Přihlášení Daniela a migrace dat**

Daniel otevře `https://tradee.eu`, klikne „Přihlásit přes Google“ (účet d.slaby06@gmail.com) → musí skončit v aplikaci. Pak:

```bash
ssh ubuntu@130.61.122.142 'cd ~/tradee && bash scripts/backup.sh && set -a && . ./.mariadb.env && set +a && sub=$(mysql -N -h"$MARIADB_HOST" -P"$MARIADB_PORT" -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DB" -e "SELECT google_sub FROM waitlist WHERE email=\"d.slaby06@gmail.com\"") && python3 scripts/migrate-legacy-user.py "g:$sub" && python3 scripts/migrate-legacy-user.py "g:$sub" --apply'
```

Expected: nanečisto `trades: 2`, `watch_flags: 4`, pak `Hotovo.`; po obnovení stránky jsou v aplikaci vidět 2 obchody, 4 vlaječky a uložená paleta. Odhlásit v menu avatara → landing.

- [ ] **Step 8: Úklid hesla**

```bash
ssh ubuntu@130.61.122.142 'sudo rm /etc/nginx/auth/tradee.htpasswd && sudo nginx -t && sudo systemctl reload nginx'
```

(Ověř předtím `grep -r tradee.htpasswd /etc/nginx/sites-enabled` – nesmí nic najít.)

---

### Task 10: Odstranit legacy fallback a publikovat Google aplikaci

**Files:**
- Modify: `lib/server.ts` (smazat `legacyIdentity` a jeho použití)

- [ ] **Step 1: Smaž fallback**

V `lib/server.ts` odstraň funkci `legacyIdentity` a `identity` změň na:

```ts
export async function identity(req:Request):Promise<User>{const u=await currentUser(req);if(!u)throw new Error('Pro tuto akci se přihlas.');return u}
```

Run: `grep -rn "oai-authenticated" app lib ; npx tsc --noEmit -p . 2>&1 | grep "lib/server" ; true`
Expected: žádný výstup.

- [ ] **Step 2: Commit, push, nasazení**

```bash
git commit -am "Auth: pryč s fallbackem na oai hlavičky"
git push origin main
ssh ubuntu@130.61.122.142 'cd ~/tradee && git pull --ff-only && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run build 2>&1 | tail -1 && sudo systemctl restart tradee'
```

Ověř: Daniel je dál přihlášený a aplikace funguje; spoof curl z Task 9 Step 6 dál vrací 401.

- [ ] **Step 3: Publikace v Google Auth Platform**

V `console.cloud.google.com/auth/branding?project=tradee-510816` vyplň Application home page `https://tradee.eu`, Privacy policy `https://tradee.eu/soukromi`, Authorized domain `tradee.eu`; uložit. Pak `Audience` → **Publish app** (se souhlasem Daniela). Ověř, že se přihlášení nabídne i účtu mimo test users (Jindřich) a skončí na `/?stav=cekas`.

- [ ] **Step 4: Paměť**

Aktualizuj `~/.claude/projects/-Users-dejny-Webs/memory/project_tradee.md`: login přes Google, schvalování `UPDATE waitlist SET approved=1, approved_at=NOW() WHERE email=…`, `.auth.env`, Google projekt `tradee-510816`, lokální klon `~/Webs/tradee`.
