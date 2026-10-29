// DB vrstva průvodce (Db je parametr, každý dotaz filtruje user_id). Tabulka drizzle/mariadb/0043_onboarding.sql.
import type {Db} from '../mysql.ts';
import {parseNav,normalizeNav,type Nav} from '../nav.ts';
import {parseAnswers,parsePrefs,parseSnapshot,normalizePrefs,buildPreview,planApply,planRevert,STATUSES,type Answers,type Current,type OnbStatus,type Prefs} from './core.ts';
const now=()=>new Date().toISOString().slice(0,19).replace('T',' ');
export const MISSING='Průvodce ještě není na serveru zapnutý (chybí migrace databáze). Dej prosím vědět správci.';
export const isMissing=(e:unknown)=>/doesn't exist|ER_NO_SUCH_TABLE|Unknown column/i.test(String((e as Error)?.message??''));
type Row={answers:string|null;status:string;prefs:string|null;previous:string|null;strategy_id:string|null};
export type State={status:OnbStatus;answers:Answers|null;prefs:Prefs;canRevert:boolean;strategyId:string|null};
export async function getState(d:Db,userId:string):Promise<State>{
 const r=await d.prepare('SELECT answers,status,prefs,previous,strategy_id FROM onboarding_answers WHERE user_id=?').bind(userId).first<Row>();
 const status=(STATUSES as readonly string[]).includes(String(r?.status))?r!.status as OnbStatus:'new';
 return {status:r?status:'new',answers:parseAnswers(r?.answers),prefs:parsePrefs(r?.prefs),canRevert:!!parseSnapshot(r?.previous),strategyId:r?.strategy_id||null};
}
/** Panely a pole bez chyby i bez migrace (výchozí = vše zobrazené). */
export async function getPrefs(d:Db,userId:string):Promise<Prefs>{try{return (await getState(d,userId)).prefs}catch(e){if(isMissing(e))return parsePrefs(null);throw e}}
async function upsert(d:Db,userId:string,set:Partial<{answers:string|null;status:OnbStatus;prefs:string;previous:string|null;strategy_id:string|null}>){
 const t=now(),cols=Object.keys(set) as (keyof typeof set)[];
 await d.prepare(`INSERT INTO onboarding_answers(user_id,${cols.join(',')},created,updated) VALUES(?,${cols.map(()=>'?').join(',')},?,?) ON DUPLICATE KEY UPDATE ${cols.map(c=>`${c}=VALUES(${c})`).join(',')},updated=VALUES(updated)`).bind(userId,...cols.map(c=>set[c]??null),t,t).run();
}
export async function currentOf(d:Db,userId:string):Promise<Current>{
 const m=await d.prepare('SELECT nav FROM members WHERE id=?').bind(userId).first<{nav:string|null}>();
 const f=await d.prepare('SELECT instrument,flag FROM watch_flags WHERE user_id=?').bind(userId).all<{instrument:string;flag:string}>();
 return {nav:parseNav(m?.nav),flags:Object.fromEntries(f.results.map(x=>[x.instrument,x.flag])),prefs:await getPrefs(d,userId)};
}
export async function saveDraft(d:Db,userId:string,a:Answers){
 const s=await getState(d,userId);
 await upsert(d,userId,{answers:JSON.stringify(a),...(s.status==='new'||s.status==='skipped'?{status:'draft' as const}:{})});
}
export async function skip(d:Db,userId:string,a?:Answers|null){await upsert(d,userId,{status:'skipped',...(a?{answers:JSON.stringify(a)}:{})})}
export async function setPrefs(d:Db,userId:string,raw:unknown):Promise<Prefs>{const p=normalizePrefs(raw);await upsert(d,userId,{prefs:JSON.stringify(p)});return p}
async function writeNav(d:Db,userId:string,nav:Nav){await d.prepare('UPDATE members SET nav=? WHERE id=?').bind(JSON.stringify(normalizeNav(nav)),userId).run()}
async function writeFlag(d:Db,userId:string,instrument:string,flag:string){
 await d.prepare('INSERT INTO watch_flags(id,user_id,instrument,flag,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET flag=excluded.flag,updated=excluded.updated').bind(userId+':'+instrument,userId,instrument,flag,new Date().toISOString()).run();
}
/** Použít odpovědi: náhled se spočítá znovu z aktuálního stavu v DB, zapíše se navigace, vlaječky a panely, uloží se stav k vrácení. */
export async function apply(d:Db,userId:string,a:Answers,marketIds:readonly string[]){
 const cur=await currentOf(d,userId),preview=buildPreview(a,cur,marketIds),{writes,previous}=planApply(preview,cur);
 if(writes.nav)await writeNav(d,userId,writes.nav);
 for(const f of writes.flags)await writeFlag(d,userId,f.instrument,f.flag);
 await upsert(d,userId,{answers:JSON.stringify(a),status:'applied',prefs:JSON.stringify(writes.prefs),previous:JSON.stringify(previous)});
 return preview;
}
export async function revert(d:Db,userId:string):Promise<boolean>{
 const r=await d.prepare('SELECT previous FROM onboarding_answers WHERE user_id=?').bind(userId).first<{previous:string|null}>(),prev=parseSnapshot(r?.previous);
 if(!prev)return false;
 const plan=planRevert(prev,await currentOf(d,userId));
 await writeNav(d,userId,plan.nav);
 for(const f of plan.flags)await writeFlag(d,userId,f.instrument,f.flag);
 await upsert(d,userId,{status:'reverted',prefs:JSON.stringify(plan.prefs),previous:null});
 return true;
}
export async function setStrategy(d:Db,userId:string,id:string){await upsert(d,userId,{strategy_id:id})}
