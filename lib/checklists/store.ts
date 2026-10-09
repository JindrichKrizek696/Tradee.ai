// DB vrstva checklistů (Db je parametr, každý dotaz filtruje user_id).
import type {Db} from '../mysql.ts';
import {nowSql} from '../mt/store.ts';
import {LIMITS,newItemId,mapSymbol,applicable,snapshotFor,completion,type Checklist,type ChecklistItem,type SnapshotList} from './core.ts';
const parse=<T>(s:unknown):T[]=>{try{const v=JSON.parse(String(s));return Array.isArray(v)?v:[]}catch{return []}};
type Row={id:string;name:string;items:string;markets:string};
export async function listChecklists(d:Db,userId:string):Promise<Checklist[]>{
 return (await d.prepare('SELECT id,name,items,markets FROM checklists WHERE user_id=? ORDER BY sort,created,id').bind(userId).all<Row>()).results.map(r=>({id:r.id,name:r.name,items:parse<ChecklistItem>(r.items),markets:parse<string>(r.markets)}));
}
// nový (id null) nebo úprava vlastního; vrací id, false = cizí/neexistující; limit hází chybu
export async function saveChecklist(d:Db,userId:string,id:string|null,data:Omit<Checklist,'id'>):Promise<string|false>{
 const seen=new Set<string>(),items=data.items.map(i=>{let x=i.id;while(seen.has(x))x=newItemId();seen.add(x);return {id:x,text:i.text}});
 const now=nowSql(),items_=JSON.stringify(items),markets=JSON.stringify(data.markets);
 if(id){
  const r=await d.prepare('UPDATE checklists SET name=?,items=?,markets=?,updated=? WHERE id=? AND user_id=?').bind(data.name,items_,markets,now,id,userId).run();
  if(r.meta.changes>0)return id;
  return await d.prepare('SELECT id FROM checklists WHERE id=? AND user_id=?').bind(id,userId).first()?id:false;
 }
 const n=await d.prepare('SELECT COUNT(*) AS n FROM checklists WHERE user_id=?').bind(userId).first<{n:number}>();
 if(Number(n?.n||0)>=LIMITS.lists)throw new Error(`Nejvýš ${LIMITS.lists} checklistů.`);
 const nid='chk_'+crypto.randomUUID().replace(/-/g,'').slice(0,24);
 const s=await d.prepare('SELECT COALESCE(MAX(sort),-1)+1 AS s FROM checklists WHERE user_id=?').bind(userId).first<{s:number}>();
 await d.prepare('INSERT INTO checklists(id,user_id,name,items,markets,sort,created,updated) VALUES(?,?,?,?,?,?,?,?)').bind(nid,userId,data.name,items_,markets,Number(s?.s||0),now,now).run();
 return nid;
}
export async function deleteChecklist(d:Db,userId:string,id:string){
 const r=await d.prepare('DELETE FROM checklists WHERE id=? AND user_id=?').bind(id,userId).run();
 if(r.meta.changes<1)return false;
 await d.prepare('DELETE FROM checklist_state WHERE user_id=? AND checklist_id=?').bind(userId,id).run();
 return true;
}
export async function reorderChecklists(d:Db,userId:string,ids:string[]){
 for(let i=0;i<ids.length;i++)await d.prepare('UPDATE checklists SET sort=? WHERE id=? AND user_id=?').bind(i,ids[i],userId).run();
}
export async function marketState(d:Db,userId:string,instrument:string):Promise<Record<string,string[]>>{
 const out:Record<string,string[]>={};
 for(const r of (await d.prepare('SELECT checklist_id,checked FROM checklist_state WHERE user_id=? AND instrument=?').bind(userId,instrument).all<{checklist_id:string;checked:string}>()).results)out[r.checklist_id]=parse<string>(r.checked);
 return out;
}
// jen pro vlastní checklist, který trh obsahuje; id bodů mimo checklist se zahodí; prázdné = smazat řádek
export async function setMarketState(d:Db,userId:string,checklistId:string,instrument:string,checked:string[]){
 const c=(await listChecklists(d,userId)).find(l=>l.id===checklistId);
 if(!c||!c.markets.includes(instrument))return false;
 const valid=new Set(c.items.map(i=>i.id)),keep=[...new Set(checked)].filter(x=>valid.has(x));
 if(!keep.length){await clearMarketState(d,userId,checklistId,instrument);return true}
 await d.prepare('INSERT INTO checklist_state(user_id,checklist_id,instrument,checked,updated) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE checked=VALUES(checked),updated=VALUES(updated)').bind(userId,checklistId,instrument,JSON.stringify(keep),nowSql()).run();
 return true;
}
export async function clearMarketState(d:Db,userId:string,checklistId:string,instrument:string){
 await d.prepare('DELETE FROM checklist_state WHERE user_id=? AND checklist_id=? AND instrument=?').bind(userId,checklistId,instrument).run();
}
export async function symbolMap(d:Db,userId:string):Promise<Record<string,string>>{
 const m:Record<string,string>={};
 for(const r of (await d.prepare('SELECT symbol,instrument FROM symbol_map WHERE user_id=?').bind(userId).all<{symbol:string;instrument:string}>()).results)m[r.symbol.toUpperCase()]=r.instrument;
 return m;
}
// '' = nesledovat, null = smazat přiřazení
export async function setSymbol(d:Db,userId:string,symbol:string,instrument:string|null){
 const s=symbol.trim().toUpperCase();
 if(instrument===null){await d.prepare('DELETE FROM symbol_map WHERE user_id=? AND symbol=?').bind(userId,s).run();return}
 await d.prepare('INSERT INTO symbol_map(user_id,symbol,instrument) VALUES(?,?,?) ON DUPLICATE KEY UPDATE instrument=VALUES(instrument)').bind(userId,s,instrument).run();
}
export async function unmappedSymbols(d:Db,userId:string,ids:readonly string[],map:Record<string,string>):Promise<string[]>{
 const rows=(await d.prepare('SELECT DISTINCT p.symbol FROM mt_positions p JOIN mt_accounts a ON a.id=p.account_id WHERE a.user_id=?').bind(userId).all<{symbol:string}>()).results;
 return rows.map(r=>r.symbol).filter(s=>s&&!Object.hasOwn(map,s.toUpperCase())&&mapSymbol(s,ids,map)===null).sort();
}
// trh obchodu: undefined = obchod není uživatelův, null = trh nepoznán
export async function tradeMarket(d:Db,userId:string,kind:'mt'|'man',id:string,ids:readonly string[]):Promise<string|null|undefined>{
 const r=kind==='mt'
  ?await d.prepare('SELECT p.symbol AS s FROM mt_positions p JOIN mt_accounts a ON a.id=p.account_id WHERE p.id=? AND a.user_id=?').bind(id,userId).first<{s:string}>()
  :await d.prepare('SELECT instrument AS s FROM trades WHERE id=? AND user_id=?').bind(id,userId).first<{s:string}>();
 if(!r)return undefined;
 return mapSymbol(r.s,ids,await symbolMap(d,userId));
}
export async function tradeChecklist(d:Db,userId:string,tradeId:string){
 const r=await d.prepare('SELECT instrument,snapshot,completion FROM trade_checklists WHERE user_id=? AND trade_id=?').bind(userId,tradeId).first<{instrument:string;snapshot:string;completion:number|null}>();
 return r?{instrument:r.instrument,snapshot:parse<SnapshotList>(r.snapshot),completion:r.completion===null?null:Number(r.completion)}:null;
}
export async function saveTradeChecklist(d:Db,userId:string,tradeId:string,instrument:string,snapshot:SnapshotList[]){
 const now=nowSql();
 await d.prepare('INSERT INTO trade_checklists(user_id,trade_id,instrument,snapshot,completion,created,updated) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE instrument=VALUES(instrument),snapshot=VALUES(snapshot),completion=VALUES(completion),updated=VALUES(updated)').bind(userId,tradeId,instrument,JSON.stringify(snapshot),completion(snapshot),now,now).run();
}
// snímek ze současného stavu trhu; jen když existují checklisty pro trh a obchod ještě snímek nemá
export async function snapshotTrade(d:Db,userId:string,tradeId:string,instrument:string):Promise<SnapshotList[]|null>{
 if(await tradeChecklist(d,userId,tradeId))return null;
 const lists=await listChecklists(d,userId);
 if(!applicable(lists,instrument).length)return null;
 const snap=snapshotFor(lists,instrument,await marketState(d,userId,instrument)),now=nowSql();
 const r=await d.prepare('INSERT IGNORE INTO trade_checklists(user_id,trade_id,instrument,snapshot,completion,created,updated) VALUES(?,?,?,?,?,?,?)').bind(userId,tradeId,instrument,JSON.stringify(snap),completion(snap),now,now).run();
 return r.meta.changes>0?snap:null;
}
// snímek pro pozice účtu otevřené v poslední hodině, které ještě snímek nemají
export async function snapshotNewPositions(d:Db,userId:string,accountId:string,now:number,ids:readonly string[]){
 const rows=(await d.prepare("SELECT p.id,p.symbol FROM mt_positions p WHERE p.account_id=? AND p.open_ts>=? AND NOT EXISTS(SELECT 1 FROM trade_checklists t WHERE t.user_id=? AND t.trade_id=CONCAT('mt:',p.id))").bind(accountId,now-60*60000,userId).all<{id:string;symbol:string}>()).results;
 if(!rows.length)return;
 const map=await symbolMap(d,userId);
 for(const r of rows){const inst=mapSymbol(r.symbol,ids,map);if(inst)await snapshotTrade(d,userId,'mt:'+r.id,inst)}
}
// tvar snímku od klienta → očištěný snímek, nebo text chyby
export function cleanSnapshot(v:unknown):SnapshotList[]|string{
 const bad='Neplatný snímek checklistu.';
 if(!Array.isArray(v))return bad;if(v.length>LIMITS.lists)return bad;
 const str=(x:unknown,max:number)=>typeof x==='string'&&x.trim()&&x.trim().length<=max?x.trim():null;
 const out:SnapshotList[]=[];
 for(const l of v as {checklistId?:unknown;name?:unknown;items?:unknown}[]){
  const checklistId=str(l?.checklistId,40),name=str(l?.name,LIMITS.name);
  if(!checklistId||!name||!Array.isArray(l.items)||l.items.length>LIMITS.items)return bad;
  const items:SnapshotList['items']=[];
  for(const i of l.items as {id?:unknown;text?:unknown;checked?:unknown}[]){const id=str(i?.id,16),text=str(i?.text,LIMITS.item);if(!id||!text||typeof i.checked!=='boolean')return bad;items.push({id,text,checked:i.checked})}
  out.push({checklistId,name,items});
 }
 return out;
}
