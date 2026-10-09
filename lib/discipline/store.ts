// DB vrstva disciplíny: nastavení pravidel, vlastní pravidla, strategie a vyhodnocení MT obchodů (Db je parametr, dotazy filtrují user_id / účet).
import type {Db} from '../mysql.ts';
import {nowSql} from '../mt/store.ts';
import {pragueDate} from '../mt/trades.ts';
import {LIMITS,RULES,normalizeSettings,evaluate,effectiveLevel,currenciesOf,type RuleSettings,type RuleId,type EvalTrade} from './rules.ts';
import type {NewsEvent} from './news.ts';
export {LIMITS};
const uid=(p:string)=>p+'_'+crypto.randomUUID().replace(/-/g,'').slice(0,24);
export async function getRuleSettings(d:Db,userId:string):Promise<RuleSettings>{
 const r=await d.prepare('SELECT rules FROM rules_settings WHERE user_id=?').bind(userId).first<{rules:string}>();
 let raw:unknown=null;if(r)try{raw=JSON.parse(r.rules)}catch{}
 return normalizeSettings(raw);
}
export async function saveRuleSettings(d:Db,userId:string,raw:unknown):Promise<RuleSettings>{
 const s=normalizeSettings(raw),j=JSON.stringify(s),now=nowSql();
 await d.prepare('INSERT INTO rules_settings(user_id,rules,updated) VALUES(?,?,?) ON DUPLICATE KEY UPDATE rules=VALUES(rules),updated=VALUES(updated)').bind(userId,j,now).run();
 return s;
}
export type CustomRule={id:string;text:string};
export async function listCustomRules(d:Db,userId:string):Promise<CustomRule[]>{
 return (await d.prepare('SELECT id,text FROM custom_rules WHERE user_id=? ORDER BY position,created,id').bind(userId).all<CustomRule>()).results.map(r=>({id:r.id,text:r.text}));
}
// celý seznam najednou: pořadí = pořadí v poli, známá id (jen vlastní) se zachovají, ostatní dostanou nové; chybějící se smažou
export async function saveCustomRules(d:Db,userId:string,items:{id?:string;text:string}[]):Promise<CustomRule[]>{
 if(items.length>LIMITS.customRules)throw new Error(`Nejvýš ${LIMITS.customRules} vlastních pravidel.`);
 const texts=items.map(i=>String(i?.text??'').trim());
 if(texts.some(t=>!t||t.length>LIMITS.customText))throw new Error(`Text pravidla musí mít 1 až ${LIMITS.customText} znaků.`);
 const have=new Set((await d.prepare('SELECT id FROM custom_rules WHERE user_id=?').bind(userId).all<{id:string}>()).results.map(r=>r.id));
 const used=new Set<string>(),out:CustomRule[]=[],now=nowSql();
 for(let i=0;i<items.length;i++){
  const want=items[i]?.id;let id=typeof want==='string'&&have.has(want)&&!used.has(want)?want:'';
  if(id)await d.prepare('UPDATE custom_rules SET text=?,position=? WHERE id=? AND user_id=?').bind(texts[i],i,id,userId).run();
  else{id=uid('cr');await d.prepare('INSERT INTO custom_rules(id,user_id,text,position,created) VALUES(?,?,?,?,?)').bind(id,userId,texts[i],i,now).run()}
  used.add(id);out.push({id,text:texts[i]});
 }
 for(const id of have)if(!used.has(id))await d.prepare('DELETE FROM custom_rules WHERE id=? AND user_id=?').bind(id,userId).run();
 return out;
}
export type Strategy={id:string;name:string;archived:boolean};
export async function listStrategies(d:Db,userId:string):Promise<Strategy[]>{
 return (await d.prepare('SELECT id,name,archived FROM strategies WHERE user_id=? ORDER BY archived,name,id').bind(userId).all<{id:string;name:string;archived:number}>()).results.map(r=>({id:r.id,name:r.name,archived:!!Number(r.archived)}));
}
const cleanName=(name:unknown)=>{const n=String(name??'').trim();if(!n||n.length>LIMITS.strategyName)throw new Error(`Název strategie musí mít 1 až ${LIMITS.strategyName} znaků.`);return n};
// shoda názvu bez ohledu na velikost písmen (kolace general_ci) vrátí existující strategii
export async function createStrategy(d:Db,userId:string,name:string):Promise<string>{
 const n=cleanName(name);
 const hit=await d.prepare('SELECT id,archived FROM strategies WHERE user_id=? AND name=?').bind(userId,n).first<{id:string;archived:number|boolean}>();
 if(hit){if(Number(hit.archived))await d.prepare('UPDATE strategies SET archived=0 WHERE id=? AND user_id=?').bind(hit.id,userId).run();return hit.id}
 const c=await d.prepare('SELECT COUNT(*) AS n FROM strategies WHERE user_id=?').bind(userId).first<{n:number}>();
 if(Number(c?.n||0)>=LIMITS.strategies)throw new Error(`Nejvýš ${LIMITS.strategies} strategií.`);
 const id=uid('str');
 await d.prepare('INSERT IGNORE INTO strategies(id,user_id,name,archived,created) VALUES(?,?,?,0,?)').bind(id,userId,n,nowSql()).run();
 // souběžné vytvoření stejného názvu: vyhrává první
 return (await d.prepare('SELECT id FROM strategies WHERE user_id=? AND name=?').bind(userId,n).first<{id:string}>())?.id||id;
}
export async function renameStrategy(d:Db,userId:string,id:string,name:string):Promise<boolean>{
 const n=cleanName(name);
 const clash=await d.prepare('SELECT id FROM strategies WHERE user_id=? AND name=? AND id<>?').bind(userId,n,id).first();
 if(clash)throw new Error('Strategie s tímto názvem už existuje.');
 const own=await d.prepare('SELECT id FROM strategies WHERE id=? AND user_id=?').bind(id,userId).first();
 if(!own)return false;
 await d.prepare('UPDATE strategies SET name=? WHERE id=? AND user_id=?').bind(n,id,userId).run();
 return true;
}
export async function archiveStrategy(d:Db,userId:string,id:string,archived:boolean):Promise<boolean>{
 const own=await d.prepare('SELECT id FROM strategies WHERE id=? AND user_id=?').bind(id,userId).first();
 if(!own)return false;
 await d.prepare('UPDATE strategies SET archived=? WHERE id=? AND user_id=?').bind(archived?1:0,id,userId).run();
 return true;
}

// --- vyhodnocení ---
// začátek pražského dne (ms): půlnoc je 22:00 nebo 23:00 UTC předchozího dne podle letního času
export function pragueDayStart(date:string):number{
 const [y,m,dd]=date.split('-').map(Number),t0=Date.UTC(y,m-1,dd);
 for(const off of [2,1]){const c=t0-off*3600000;if(pragueDate(c)===date&&pragueDate(c-1)!==date)return c}
 return t0-3600000;
}
const nextDate=(date:string)=>{const [y,m,d]=date.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10)};
type PosRow={id:string;side:string;status:string;open_ts:number;close_ts:number|null;open_price:number;symbol:string;sl_initial:number|null;tp_initial:number|null;risk_pct:number|null;net:number;close_reason:string|null};
const COLS='id,side,status,open_ts,close_ts,open_price,symbol,sl_initial,tp_initial,risk_pct,net,close_reason';
const num=(v:unknown)=>v===null||v===undefined?null:Number(v);
const chunks=<T>(a:T[],n=400)=>{const o:T[][]=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n));return o};
// Zůstatek na začátku dne: nejbližší mt_snapshots.balance před začátkem dne; bez snímku zůstatek z prvního dealu dne v mt_events (payload.balance, tj. jako při výpočtu risk_pct); jinak null (max_daily_loss se nevyhodnotí).
async function balanceAt(d:Db,accountId:string,start:number,end:number):Promise<number|null>{
 const s=await d.prepare('SELECT balance FROM mt_snapshots WHERE account_id=? AND ts<? ORDER BY ts DESC LIMIT 1').bind(accountId,start).first<{balance:number}>();
 if(s&&Number(s.balance)>0)return Number(s.balance);
 const e=await d.prepare("SELECT payload FROM mt_events WHERE account_id=? AND type='deal' AND ts>=? AND ts<? ORDER BY ts LIMIT 1").bind(accountId,start,end).first<{payload:string}>();
 if(e)try{const b=Number((JSON.parse(e.payload) as {balance?:unknown}).balance);if(b>0)return b}catch{}
 return null;
}
/** Vyhodnotí pozice MT účtu proti pravidlům uživatele. `tickets` = základní tikety pozic (jako u rebuildPositions, segmenty :rN se přiřadí samy); bez nich všechny pozice účtu. Nová porušení přidá (INSERT IGNORE), existující se nepřepisují; porušení, které přestalo platit a nemá zdůvodnění, smaže (jen u zapnutých pravidel). */
export async function evaluateAccount(d:Db,userId:string,accountId:string,tickets?:string[],news:()=>NewsEvent[]=()=>[]):Promise<{evaluated:number;added:number;removed:number}>{
 const base=tickets?[...new Set(tickets.filter(t=>t&&t!=='0'))]:undefined;
 if(base&&!base.length)return {evaluated:0,added:0,removed:0};
 const settings=await getRuleSettings(d,userId);
 if(!RULES.some(r=>settings[r.id].on))return {evaluated:0,added:0,removed:0};
 let lo=0,hi=Number.MAX_SAFE_INTEGER,targetIds:Set<string>|null=null;
 if(base){
  const rows:PosRow[]=[];
  for(const c of chunks(base))rows.push(...(await d.prepare(`SELECT ${COLS} FROM mt_positions WHERE account_id=? AND SUBSTRING_INDEX(ticket,':r',1) IN (${c.map(()=>'?').join(',')})`).bind(accountId,...c).all<PosRow>()).results);
  if(!rows.length)return {evaluated:0,added:0,removed:0};
  targetIds=new Set(rows.map(r=>r.id));
  const days=rows.map(r=>pragueDate(Number(r.open_ts))).sort();
  lo=pragueDayStart(days[0]);hi=pragueDayStart(nextDate(days[days.length-1]));
 }
 // jeden dotaz na všechny pozice dotčených dní účtu
 const all=(await d.prepare(`SELECT ${COLS} FROM mt_positions WHERE account_id=? AND open_ts>=? AND open_ts<? ORDER BY open_ts,id`).bind(accountId,lo,hi).all<PosRow>()).results;
 const targets=all.filter(r=>!targetIds||targetIds.has(r.id));
 const changes=new Map<string,EvalTrade['slChanges']>(),tpChanges=new Map<string,EvalTrade['slChanges']>();
 for(const c of chunks(targets.map(r=>r.id)))for(const r of (await d.prepare(`SELECT position_id,kind,ts,old_value,new_value FROM mt_position_changes WHERE kind IN ('sl','tp') AND position_id IN (${c.map(()=>'?').join(',')}) ORDER BY ts,id`).bind(...c).all<{position_id:string;kind:string;ts:number;old_value:number|null;new_value:number|null}>()).results){
  const m=r.kind==='tp'?tpChanges:changes,l=m.get(r.position_id)||[];l.push({ts:Number(r.ts),old:num(r.old_value),new:num(r.new_value)});m.set(r.position_id,l);
 }
 const byDay=new Map<string,PosRow[]>();
 for(const r of all){const k=pragueDate(Number(r.open_ts));(byDay.get(k)||byDay.set(k,[]).get(k)!).push(r)}
 const balances=new Map<string,number|null>();
 if(settings.max_daily_loss.on)for(const k of new Set(targets.map(r=>pragueDate(Number(r.open_ts)))))balances.set(k,await balanceAt(d,accountId,pragueDayStart(k),pragueDayStart(nextDate(k))));
 const useNews=settings.no_news.on?news():[];
 const toTrade=(r:PosRow,k:string):EvalTrade=>({id:r.id,accountId,side:r.side==='sell'?'sell':'buy',status:r.status==='closed'?'closed':'open',openTs:Number(r.open_ts),closeTs:num(r.close_ts),openPrice:Number(r.open_price),slInitial:effectiveLevel(num(r.sl_initial),changes.get(r.id)||[],Number(r.open_ts)),tpInitial:effectiveLevel(num(r.tp_initial),tpChanges.get(r.id)||[],Number(r.open_ts)),riskPct:num(r.risk_pct),net:Number(r.net)||0,closeReason:r.close_reason,balanceStart:balances.get(k)??null,slChanges:changes.get(r.id)||[],currencies:currenciesOf(r.symbol)});
 const dayTrades=new Map<string,EvalTrade[]>();
 for(const [k,rows] of byDay)dayTrades.set(k,rows.map(r=>toTrade(r,k)));
 const found=new Map<string,Map<RuleId,ReturnType<typeof evaluate>[number]>>();
 for(const r of targets){
  const k=pragueDate(Number(r.open_ts)),day=dayTrades.get(k)!,t=day.find(x=>x.id===r.id)!;
  found.set(r.id,new Map(evaluate(t,day,settings,useNews).map(v=>[v.rule,v])));
 }
 // existující porušení cílových obchodů
 const tradeIds=targets.map(r=>'mt:'+r.id),existing=new Map<string,{id:number;rule:string;reasoned:boolean}[]>();
 for(const c of chunks(tradeIds))for(const r of (await d.prepare(`SELECT id,trade_id,rule,reason_code,reasoned_at FROM trade_violations WHERE user_id=? AND trade_id IN (${c.map(()=>'?').join(',')})`).bind(userId,...c).all<{id:number;trade_id:string;rule:string;reason_code:string|null;reasoned_at:string|null}>()).results){
  const l=existing.get(r.trade_id)||[];l.push({id:Number(r.id),rule:r.rule,reasoned:r.reason_code!==null||r.reasoned_at!==null});existing.set(r.trade_id,l);
 }
 const now=nowSql(),ins:unknown[][]=[],del:number[]=[];
 for(const r of targets){
  const tid='mt:'+r.id,have=existing.get(tid)||[],cur=found.get(r.id)!;
  for(const [rule,v] of cur)if(!have.some(h=>h.rule===rule))ins.push([userId,tid,rule,JSON.stringify(v.detail),v.needsReason?1:0,now]);
  for(const h of have)if(!cur.has(h.rule as RuleId)&&!h.reasoned&&settings[h.rule as RuleId]?.on)del.push(h.id);
 }
 for(const c of chunks(ins,100))await d.prepare('INSERT IGNORE INTO trade_violations(user_id,trade_id,rule,detail,needs_reason,created) VALUES '+c.map(()=>'(?,?,?,?,?,?)').join(',')).bind(...c.flat()).run();
 for(const c of chunks(del))await d.prepare(`DELETE FROM trade_violations WHERE user_id=? AND reason_code IS NULL AND reasoned_at IS NULL AND id IN (${c.map(()=>'?').join(',')})`).bind(userId,...c).run();
 return {evaluated:targets.length,added:ins.length,removed:del.length};
}
