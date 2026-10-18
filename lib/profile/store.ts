// DB dotazy profilu (Db je parametr). Sloupce přidává migrace 0031_profile.
import type {Db} from '../mysql.ts';
import {STYLES,MARKETS,AVATAR_COLORS,avatarUrl,joinList,splitList,type Profile} from './rules.ts';
type Row={display_name:string|null;greet_name:string|null;avatar_key:string|null;avatar_color:string|null;bio:string|null;trading_style:string|null;trading_markets:string|null;trading_since:number|null;last_login:string|null};
const COLUMNS='display_name,greet_name,avatar_key,avatar_color,bio,trading_style,trading_markets,trading_since';
// bez migrace (chybí sloupec) srozumitelná chyba místo „Uložení dat není dostupné“
const missing=(e:unknown)=>{if(/Unknown column|ER_BAD_FIELD/i.test(String((e as Error)?.message)))return Error('Profil se na serveru teprve připravuje. Zkus to prosím později.');return e};
const toProfile=(r:Row|null):Profile=>({displayName:r?.display_name||null,greet:r?.greet_name||null,color:r?.avatar_color&&AVATAR_COLORS.includes(r.avatar_color)?r.avatar_color:null,bio:r?.bio||null,styles:splitList(r?.trading_style,STYLES),markets:splitList(r?.trading_markets,MARKETS),since:r?.trading_since?Number(r.trading_since):null});

export async function readProfile(d:Db,userId:string,email:string){
 const r=await d.prepare(`SELECT ${COLUMNS},last_login FROM members WHERE id=?`).bind(userId).first<Row>().catch(e=>{throw missing(e)});
 const w=await d.prepare('SELECT created FROM waitlist WHERE email=?').bind(email).first<{created:string|null}>().catch(()=>null);
 return {profile:toProfile(r),avatar:avatarUrl(r?.avatar_key),memberSince:w?.created||null,lastLogin:r?.last_login||null};
}
/** Krátký výtah pro horní lištu a pozdrav na Dashboardu; bez migrace null (aplikace jede dál se jménem z Google). */
export async function profileBadge(d:Db,userId:string){
 const r=await d.prepare('SELECT display_name,greet_name,avatar_key,avatar_color FROM members WHERE id=?').bind(userId).first<Row>().catch(()=>null);
 if(!r)return null;const p=toProfile(r);
 return {display:p.displayName,greet:p.greet,avatar:avatarUrl(r.avatar_key),color:p.color};
}
export async function saveProfile(d:Db,userId:string,v:Partial<Profile>){
 const set:string[]=[],args:(string|number|null)[]=[];
 const put=(col:string,val:string|number|null)=>{set.push(col+'=?');args.push(val)};
 if(v.displayName!==undefined)put('display_name',v.displayName);
 if(v.greet!==undefined)put('greet_name',v.greet);
 if(v.color!==undefined)put('avatar_color',v.color);
 if(v.bio!==undefined)put('bio',v.bio);
 if(v.styles!==undefined)put('trading_style',joinList(v.styles));
 if(v.markets!==undefined)put('trading_markets',joinList(v.markets));
 if(v.since!==undefined)put('trading_since',v.since);
 if(!set.length)return;
 await d.prepare(`UPDATE members SET ${set.join(',')} WHERE id=?`).bind(...args,userId).run().catch(e=>{throw missing(e)});
}
/** Nastaví novou fotku (nebo null) a vrátí klíč předchozí, ať ji volající smaže z úložiště. */
export async function swapAvatar(d:Db,userId:string,key:string|null){
 const old=await d.prepare('SELECT avatar_key FROM members WHERE id=?').bind(userId).first<{avatar_key:string|null}>().catch(e=>{throw missing(e)});
 await d.prepare('UPDATE members SET avatar_key=? WHERE id=?').bind(key,userId).run();
 return old?.avatar_key||null;
}
export async function avatarInUse(d:Db,key:string){return !!await d.prepare('SELECT id FROM members WHERE avatar_key=?').bind(key).first()}
