// Volba kanálů upozornění po kategoriích (tabulka notify_prefs): Push / E-mail / V aplikaci.
// Čisté funkce (výchozí hodnoty, sloučení, validace změny, brány pro odesílací skripty) + malé DB pomocníky.
// Používá aplikace (/api/notify/prefs, Nastavení, Alerty) i cron skripty (alerts-check.mjs, notify.mjs, lab-*). Testy: scripts/check-notify-prefs.mjs
import type {Db} from '../mysql.ts';
export const CATEGORIES=['alerts','discipline','lab'] as const;
export type Category=typeof CATEGORIES[number];
export const CHANNELS=['push','mail','inapp'] as const;
export type ChannelKey=typeof CHANNELS[number];
export type Channels={push:boolean;mail:boolean;inapp:boolean};
export type Prefs=Record<Category,Channels>;
/** Popisky pro UI. `inapp` = co znamená „V aplikaci“ u dané kategorie (null = kategorie nic v aplikaci neukazuje). */
export const CATEGORY_META:Record<Category,{label:string;hint:string;inapp:string|null;ownerOnly:boolean}>={
 alerts:{label:'Cenové alerty',hint:'Cena, % změna dnes a skóre Tradee. Ve schránce u zvonku jsou vždy, „V aplikaci“ přidá okénko, když máš Tradee otevřené.',inapp:'Okénko při spuštění alertu',ownerOnly:false},
 discipline:{label:'Porušení pravidel a disciplína',hint:'Výzva ke zdůvodnění obchodu, který porušil pravidlo (zavřeno dřív, posunutý SL…). E-mail nejvýš jednou za hodinu.',inapp:'Okno se žádostí o zdůvodnění',ownerOnly:false},
 lab:{label:'Laboratoř – uzavřené obchody a týdenní souhrn',hint:'Jen pro vlastníka: uzavřené obchody simulace, nedělní souhrn a analýza týdne.',inapp:null,ownerOnly:true},
};
const ON:Channels={push:true,mail:true,inapp:true};
/** Dosavadní nastavení disciplíny (notify_settings: popup, mail, push) – výchozí, dokud uživatel nezmění řádek disciplíny. */
export type Legacy={popup:boolean;mail:boolean;push:boolean}|null|undefined;
export function defaultPrefs(legacy?:Legacy):Prefs{
 return {alerts:{...ON},discipline:legacy?{push:!!legacy.push,mail:!!legacy.mail,inapp:!!legacy.popup}:{push:false,mail:true,inapp:true},lab:{...ON}};
}
export type PrefRow={category:unknown;push:unknown;mail:unknown;inapp:unknown};
const isCat=(v:unknown):v is Category=>typeof v==='string'&&(CATEGORIES as readonly string[]).includes(v);
/** Výchozí hodnoty + uložené řádky (neznámé kategorie se ignorují). */
export function mergePrefs(rows:PrefRow[]|null|undefined,legacy?:Legacy):Prefs{
 const p=defaultPrefs(legacy);
 for(const r of rows||[])if(isCat(r.category))p[r.category]={push:Number(r.push)===1,mail:Number(r.mail)===1,inapp:Number(r.inapp)===1};
 return p;
}
export const visibleCategories=(owner:boolean):Category[]=>CATEGORIES.filter(c=>owner||!CATEGORY_META[c].ownerOnly);
/** Pro klienta: jen kategorie, které uživatel vidí (lab jen vlastník). */
export function publicPrefs(p:Prefs,owner:boolean):Partial<Prefs>{const o:Partial<Prefs>={};for(const c of visibleCategories(owner))o[c]={...p[c]};return o}
/** Ověří změnu z API: {kategorie:{push?,mail?,inapp?}}; vrací jen platné změny, jinak výjimka s českou hláškou. */
export function parsePatch(raw:unknown,owner:boolean):Partial<Record<Category,Partial<Channels>>>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Neplatné nastavení upozornění.');
 const out:Partial<Record<Category,Partial<Channels>>>={};let n=0;
 for(const [k,v] of Object.entries(raw as Record<string,unknown>)){
  if(!isCat(k))throw Error('Neznámá kategorie upozornění.');
  if(CATEGORY_META[k].ownerOnly&&!owner)throw Error('Neznámá kategorie upozornění.');
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Neplatné nastavení upozornění.');
  const ch:Partial<Channels>={};
  for(const [c,b] of Object.entries(v as Record<string,unknown>)){
   if(!(CHANNELS as readonly string[]).includes(c))throw Error('Neznámý kanál upozornění.');
   if(typeof b!=='boolean')throw Error('Volba kanálu musí být ano / ne.');
   ch[c as ChannelKey]=b;n++;
  }
  out[k]=ch;
 }
 if(!n)throw Error('Není co uložit.');
 return out;
}
export function applyPatch(p:Prefs,patch:Partial<Record<Category,Partial<Channels>>>):Prefs{
 const o:Prefs={alerts:{...p.alerts},discipline:{...p.discipline},lab:{...p.lab}};
 for(const c of CATEGORIES)if(patch[c])o[c]={...o[c],...patch[c]};
 return o;
}
// ---- brány pro odesílací skripty (čisté)
/** Alert: kanál jde ven, jen když ho má alert vybraný A uživatel ho u cenových alertů nevypnul. */
export function gateAlert(channels:readonly string[],p:Channels){return {push:channels.includes('push')&&p.push,mail:channels.includes('mail')&&p.mail}}
/** Výchozí kanály nového alertu podle nastavení (push jen se zapnutým zařízením); bez kanálu nejde alert uložit → záloha e-mail. */
export function defaultAlertChannels(p:Channels|null|undefined,pushAvailable:boolean|undefined):('push'|'mail')[]{
 const c=p??ON,out:('push'|'mail')[]=[];
 if(c.push&&pushAvailable)out.push('push');if(c.mail)out.push('mail');
 return out.length?out:pushAvailable?['push']:['mail'];
}
/** Okénko v aplikaci: jen nové události (id > poslední ukázané) a jen se zapnutým „V aplikaci“. Vrací události k ukázání (nejstarší první) a nové „poslední“. */
export function toastsToShow<E extends {id:number;read?:boolean}>(events:readonly E[],lastShown:number|null,inapp:boolean):{show:E[];last:number}{
 const max=events.reduce((m,e)=>Math.max(m,e.id),lastShown??0);
 if(lastShown===null||!inapp)return {show:[],last:max}; // první načtení: staré neukazovat
 return {show:events.filter(e=>e.id>lastShown&&!e.read).sort((a,b)=>a.id-b.id).slice(-3),last:max};
}
/** Testovací push nejvýš jednou za minutu (last = čas poslední žádosti v ms nebo null). */
export const testAllowed=(last:number|null,now:number)=>last===null||!Number.isFinite(last)||now-last>=60000;
/** Popis zařízení z user agenta (prohlížeč · systém). */
export function deviceLabel(ua:string|null|undefined,endpoint?:string|null){
 const s=String(ua||'');
 const os=/iPhone|iPad|iPod/.test(s)?'iOS':/Android/.test(s)?'Android':/Mac OS X|Macintosh/.test(s)?'macOS':/Windows/.test(s)?'Windows':/CrOS/.test(s)?'ChromeOS':/Linux/.test(s)?'Linux':'';
 const br=/Edg\//.test(s)?'Edge':/OPR\/|Opera/.test(s)?'Opera':/Firefox\//.test(s)?'Firefox':/Chrome\//.test(s)?'Chrome':/Safari\//.test(s)?'Safari':'';
 const parts=[br,os].filter(Boolean);
 if(parts.length)return parts.join(' · ');
 let h='';try{h=endpoint?new URL(endpoint).hostname:''}catch{}
 return /apple/.test(h)?'Safari / Apple':/mozilla/.test(h)?'Firefox':/googleapis/.test(h)?'Chrome / Android':/windows/.test(h)?'Windows':'Neznámé zařízení';
}
export const uaShort=(ua:string|null|undefined)=>ua?String(ua).replace(/[^\x20-\x7e]/g,'').slice(0,200):null;
// ---- DB
const sqlNow=()=>new Date().toISOString().slice(0,19).replace('T',' ');
/** Kanály jedné kategorie pro více uživatelů (cron). Chybí-li tabulka (migrace ještě neproběhla), vrátí prázdnou mapu → platí výchozí. */
export async function prefRowsFor(d:Db,category:Category,userIds:readonly string[]):Promise<Map<string,Channels>>{
 const m=new Map<string,Channels>();const ids=[...new Set(userIds)];if(!ids.length)return m;
 try{for(let i=0;i<ids.length;i+=500){const part=ids.slice(i,i+500);
  const rows=(await d.prepare(`SELECT user_id,push,mail,inapp FROM notify_prefs WHERE category=? AND user_id IN (${part.map(()=>'?').join(',')})`).bind(category,...part).all<{user_id:string;push:number;mail:number;inapp:number}>()).results;
  for(const r of rows)m.set(String(r.user_id),{push:Number(r.push)===1,mail:Number(r.mail)===1,inapp:Number(r.inapp)===1})}}catch{}
 return m;
}
/** Kanály jedné kategorie jednoho uživatele; bez řádku / bez tabulky výchozí (u lab vše zapnuto, aby nic potichu nepřestalo chodit). */
export async function channelsFor(d:Db,userId:string,category:Category,legacy?:Legacy):Promise<Channels>{
 return (await prefRowsFor(d,category,[userId])).get(userId)??defaultPrefs(legacy)[category];
}
async function legacyOf(d:Db,userId:string):Promise<Legacy>{
 const r=await d.prepare('SELECT popup,mail,push FROM notify_settings WHERE user_id=?').bind(userId).first<{popup:number;mail:number;push:number}>();
 return r?{popup:!!Number(r.popup),mail:!!Number(r.mail),push:!!Number(r.push)}:null;
}
export async function getPrefs(d:Db,userId:string):Promise<Prefs>{
 const legacy=await legacyOf(d,userId);
 let rows:PrefRow[]=[];try{rows=(await d.prepare('SELECT category,push,mail,inapp FROM notify_prefs WHERE user_id=?').bind(userId).all<PrefRow>()).results}catch{}
 return mergePrefs(rows,legacy);
}
export async function setPrefs(d:Db,userId:string,patch:Partial<Record<Category,Partial<Channels>>>):Promise<Prefs>{
 const next=applyPatch(await getPrefs(d,userId),patch),now=sqlNow();
 for(const c of CATEGORIES){if(!patch[c])continue;const v=next[c];
  await d.prepare('INSERT INTO notify_prefs(user_id,category,push,mail,inapp,updated) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE push=VALUES(push),mail=VALUES(mail),inapp=VALUES(inapp),updated=VALUES(updated)').bind(userId,c,v.push?1:0,v.mail?1:0,v.inapp?1:0,now).run()}
 return next;
}
