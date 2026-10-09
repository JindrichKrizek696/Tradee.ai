import {verifySession,readCookie,SESSION_COOKIE} from './auth';
import {env} from 'cloudflare:workers';
import {createDb,type Db} from './mysql';
export const runtime=()=>env as unknown as {BUCKET:R2Bucket;OWNER_EMAIL?:string;OPENAI_API_KEY?:string;OPENAI_MODEL?:string;MARIADB_HOST?:string;MARIADB_PORT?:string;MARIADB_USER?:string;MARIADB_PASSWORD?:string;MARIADB_DB?:string;GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;SESSION_SECRET?:string;PUBLIC_URL?:string;VAPID_PUBLIC_KEY?:string};
let cached:Db|null=null;
export function db(){const e=runtime();if(!e.MARIADB_HOST||!e.MARIADB_USER||!e.MARIADB_DB)throw new Error('Databáze zatím není dostupná.');return cached??=createDb({host:e.MARIADB_HOST,port:Number(e.MARIADB_PORT||3306),user:e.MARIADB_USER,password:e.MARIADB_PASSWORD||'',database:e.MARIADB_DB})}
export type User={id:string;email:string;name:string;role:string;owner:boolean};
export function authEnv(){const e=runtime();if(!e.GOOGLE_CLIENT_ID||!e.GOOGLE_CLIENT_SECRET||!e.SESSION_SECRET)throw new Error('Přihlášení není nastavené.');return {clientId:e.GOOGLE_CLIENT_ID,clientSecret:e.GOOGLE_CLIENT_SECRET,sessionSecret:e.SESSION_SECRET,publicUrl:e.PUBLIC_URL||'https://tradee.eu'}}
export function isOwner(email:string){const o=(runtime().OWNER_EMAIL||'').trim().toLowerCase();return !!o&&email.toLowerCase()===o}
// Krátká cache přístupu: /auth/check se volá u každého assetu, bez ní by každý soubor otevíral spojení do DB.
const accessCache=new Map<string,{until:number;role:string|null}>();
async function accessRole(id:string,email:string){
 const hit=accessCache.get(id);if(hit&&hit.until>Date.now())return hit.role;
 const owner=isOwner(email);let role:string|null=null;
 const w=owner?null:await db().prepare('SELECT approved,blocked FROM waitlist WHERE email=?').bind(email).first<{approved:number;blocked:number}>();
 if(owner||(Number(w?.approved)===1&&!Number(w?.blocked))){const m=await db().prepare('SELECT role FROM members WHERE id=?').bind(id).first<{role:string}>();role=owner?'admin':m?.role||'member'}
 accessCache.set(id,{until:Date.now()+30_000,role});return role;
}// po schválení/blokaci/změně role, ať změna platí hned (jinak do 30 s)
export function forgetAccess(id:string){accessCache.delete(id)}
export const ownerEmail=()=>(runtime().OWNER_EMAIL||'').trim().toLowerCase();
export async function currentUser(req:Request):Promise<User|null>{
 const secret=runtime().SESSION_SECRET;if(!secret)return null;
 const s=await verifySession(readCookie(req.headers.get('cookie'),SESSION_COOKIE),secret);if(!s)return null;
 const role=await accessRole(s.sub,s.email);
 return role?{id:s.sub,email:s.email,name:s.name,role,owner:isOwner(s.email)}:null;
}
// Přístup podle ID člena (pro požadavky z EA, které nemají session cookie).
export async function hasAccessById(id:string){const m=await db().prepare('SELECT email FROM members WHERE id=?').bind(id).first<{email:string}>();return !!m&&!!await accessRole(id,m.email)}
// Zapíše přihlášení na waitlist; schválenému (nebo ownerovi) založí/aktualizuje člena a zapíše poslední přihlášení. Vrací stav přístupu.
export async function recordLogin(u:{sub:string;email:string;name:string}):Promise<'ok'|'cekas'|'pozastaveno'>{
 await db().prepare("INSERT INTO waitlist(email,name,google_sub,source,approved,created) VALUES(?,?,?,'google',0,NOW()) ON DUPLICATE KEY UPDATE name=VALUES(name),google_sub=VALUES(google_sub)").bind(u.email,u.name,u.sub.slice(2)).run();
 const owner=isOwner(u.email);
 const w=await db().prepare('SELECT approved,blocked FROM waitlist WHERE email=?').bind(u.email).first<{approved:number;blocked:number}>();
 const state=owner?'ok':Number(w?.blocked)?'pozastaveno':Number(w?.approved)===1?'ok':'cekas';
 if(state==='ok')await db().prepare("INSERT INTO members(id,email,name,role,last_login) VALUES(?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE email=VALUES(email),name=VALUES(name),role=IF(VALUES(role)='admin','admin',role),last_login=VALUES(last_login)").bind(u.sub,u.email,u.name,owner?'admin':'member').run();
 accessCache.delete(u.sub);return state;
}
export async function identity(req:Request):Promise<User>{const u=await currentUser(req);if(!u)throw new Error('Pro tuto akci se přihlas.');return u}
export function sameOrigin(req:Request){const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)throw new Error('Nepovolený původ požadavku.');}
export function failed(e:unknown){console.error(e);return Response.json({error:e instanceof Error&& !/D1_|SQLITE|binding|R2|ER_|ECONN|mysql|MariaDB|ETIMEDOUT|Access denied/i.test(e.message)?e.message:'Uložení dat momentálně není dostupné. Zkus to prosím znovu.'},{status:400,headers:{'Cache-Control':'no-store'}})}
