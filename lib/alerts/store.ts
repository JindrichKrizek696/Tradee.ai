// Cenové alerty v DB pro API: každý dotaz je omezený na user_id přihlášeného (kontrola izolace: scripts/check-alerts.mjs).
import type {Db} from '../mysql.ts';
import {MAX_ACTIVE,validateAlert,type Alert,type AlertInput,type Channel,type Ctx,type Kind} from './logic.ts';
const sql=(ms:number)=>new Date(ms).toISOString().slice(0,19).replace('T',' ');
const ms=(s:unknown)=>s?Date.parse(String(s).replace(' ','T')+'Z'):null;
const n=(v:unknown)=>v===null||v===undefined?null:Number(v);
export function rowToAlert(r:Record<string,unknown>):Alert{
 return {id:String(r.id),userId:String(r.user_id),instrument:String(r.instrument),kind:String(r.kind) as Kind,level:n(r.level),pct:n(r.pct),op:r.op===null||r.op===undefined?null:String(r.op),note:r.note===null||r.note===undefined?null:String(r.note),cooldownMin:n(r.repeat_cooldown_min),expiresAt:ms(r.expires_at),channels:String(r.channels||'').split(',').filter(c=>c==='push'||c==='mail') as Channel[],active:Number(r.active)===1,ended:r.ended==='triggered'||r.ended==='expired'?r.ended:null,lastPrice:n(r.last_price),lastChecked:ms(r.last_checked),lastTriggered:ms(r.last_triggered),created:ms(r.created)??0,updated:ms(r.updated)??0};
}
/** Pro klienta: bez user_id a interních polí kontroly. */
export const publicAlert=({userId:_u,...a}:Alert)=>a;
const COLS='id,user_id,instrument,kind,level,pct,op,note,repeat_cooldown_min,expires_at,channels,active,ended,last_price,last_checked,last_triggered,created,updated';
export async function listAlerts(d:Db,userId:string,instrument?:string|null):Promise<Alert[]>{
 const rows=instrument?(await d.prepare(`SELECT ${COLS} FROM price_alerts WHERE user_id=? AND instrument=? ORDER BY created DESC`).bind(userId,instrument).all()).results
  :(await d.prepare(`SELECT ${COLS} FROM price_alerts WHERE user_id=? ORDER BY created DESC LIMIT 500`).bind(userId).all()).results;
 return rows.map(rowToAlert);
}
export async function getAlert(d:Db,userId:string,id:string){const r=await d.prepare(`SELECT ${COLS} FROM price_alerts WHERE id=? AND user_id=?`).bind(id,userId).first();return r?rowToAlert(r):null}
export async function countActive(d:Db,userId:string,exceptId?:string){
 const r=exceptId?await d.prepare('SELECT COUNT(*) AS c FROM price_alerts WHERE user_id=? AND active=1 AND id<>?').bind(userId,exceptId).first<{c:number}>()
  :await d.prepare('SELECT COUNT(*) AS c FROM price_alerts WHERE user_id=? AND active=1').bind(userId).first<{c:number}>();
 return Number(r?.c||0);
}
export async function pushAvailable(d:Db,userId:string){const r=await d.prepare('SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id=?').bind(userId).first<{c:number}>();return Number(r?.c||0)>0}
const LIMIT_MSG=`Najednou můžeš mít nejvýš ${MAX_ACTIVE} aktivních alertů. Nějaký pozastav nebo smaž.`;
export async function createAlert(d:Db,userId:string,raw:unknown,ctx:Omit<Ctx,'pushAvailable'>){
 const push=await pushAvailable(d,userId),{value,warnings}=validateAlert(raw,{...ctx,pushAvailable:push});
 if(value.active&&await countActive(d,userId)>=MAX_ACTIVE)throw Error(LIMIT_MSG);
 const id='al_'+crypto.randomUUID().replace(/-/g,'').slice(0,24),now=sql(ctx.now);
 await d.prepare('INSERT INTO price_alerts(id,user_id,instrument,kind,level,pct,op,note,repeat_cooldown_min,expires_at,channels,active,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind(id,userId,value.instrument,value.kind,value.level,value.pct,value.op,value.note,value.cooldownMin,value.expiresAt===null?null:sql(value.expiresAt),value.channels.join(','),value.active?1:0,now,now).run();
 return {alert:await getAlert(d,userId,id),warnings};
}
const EDIT=['instrument','kind','level','pct','op','note','cooldownMin','expiresAt','channels','active'] as const;
/** Úprava: sloučí změnu se stávajícím alertem a znovu ověří. Změna podmínky (trh, typ, úroveň, %) vynuluje poslední kontrolu – překřížení se počítá znovu. */
export async function updateAlert(d:Db,userId:string,id:string,patch:unknown,ctx:Omit<Ctx,'pushAvailable'>){
 const cur=await getAlert(d,userId,id);if(!cur)return null;
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('Neplatná změna.');
 const p=patch as Record<string,unknown>,merged:Record<string,unknown>={};
 for(const k of EDIT)merged[k]=k in p?p[k]:cur[k as keyof AlertInput];
 if(!('expiresAt' in p)&&cur.expiresAt!==null&&cur.expiresAt<=ctx.now)merged.expiresAt=null; // úprava / reaktivace vypršelého bez nového data = bez vypršení
 const push=await pushAvailable(d,userId),{value,warnings}=validateAlert(merged,{...ctx,pushAvailable:push});
 if(value.active&&!cur.active&&await countActive(d,userId,id)>=MAX_ACTIVE)throw Error(LIMIT_MSG);
 const reset=value.instrument!==cur.instrument||value.kind!==cur.kind||value.level!==cur.level||value.pct!==cur.pct||value.op!==cur.op||(value.active&&!cur.active);
 await d.prepare(`UPDATE price_alerts SET instrument=?,kind=?,level=?,pct=?,op=?,note=?,repeat_cooldown_min=?,expires_at=?,channels=?,active=?,ended=?${reset?',last_price=NULL,last_checked=NULL':''},updated=? WHERE id=? AND user_id=?`)
  .bind(value.instrument,value.kind,value.level,value.pct,value.op,value.note,value.cooldownMin,value.expiresAt===null?null:sql(value.expiresAt),value.channels.join(','),value.active?1:0,value.active?null:cur.active?null:cur.ended,sql(ctx.now),id,userId).run();
 return {alert:await getAlert(d,userId,id),warnings};
}
export async function deleteAlert(d:Db,userId:string,id:string){return (await d.prepare('DELETE FROM price_alerts WHERE id=? AND user_id=?').bind(id,userId).run()).meta.changes>0}
export type AlertEvent={id:number;alertId:string;at:number;price:number;instrument:string;label:string;push:boolean|null;mail:boolean|null;read:boolean};
const ev=(r:Record<string,unknown>):AlertEvent=>({id:Number(r.id),alertId:String(r.alert_id),at:ms(r.at)??0,price:Number(r.price),instrument:String(r.instrument),label:String(r.label),push:r.delivered_push===null||r.delivered_push===undefined?null:Number(r.delivered_push)===1,mail:r.delivered_mail===null||r.delivered_mail===undefined?null:Number(r.delivered_mail)===1,read:r.read_at!==null&&r.read_at!==undefined});
export async function listEvents(d:Db,userId:string,o:{unread?:boolean;alertId?:string|null;limit?:number}={}){
 const lim=Math.max(1,Math.min(200,Math.floor(o.limit??50)));
 const where=['user_id=?'],args:unknown[]=[userId];
 if(o.unread)where.push('read_at IS NULL');
 if(o.alertId){where.push('alert_id=?');args.push(o.alertId)}
 const rows=(await d.prepare(`SELECT id,alert_id,at,price,instrument,label,delivered_push,delivered_mail,read_at FROM alert_events WHERE ${where.join(' AND ')} ORDER BY at DESC,id DESC LIMIT ${lim}`).bind(...args).all()).results;
 const u=await d.prepare('SELECT COUNT(*) AS c FROM alert_events WHERE user_id=? AND read_at IS NULL').bind(userId).first<{c:number}>();
 return {events:rows.map(ev),unread:Number(u?.c||0)};
}
/** Označí přečtené: konkrétní id (jen vlastní), nebo všechny. */
export async function markRead(d:Db,userId:string,ids:number[]|null,now:number){
 if(ids===null)return (await d.prepare('UPDATE alert_events SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(sql(now),userId).run()).meta.changes;
 const ok=ids.filter(i=>Number.isInteger(i)&&i>0).slice(0,200);if(!ok.length)return 0;
 return (await d.prepare(`UPDATE alert_events SET read_at=? WHERE user_id=? AND read_at IS NULL AND id IN (${ok.map(()=>'?').join(',')})`).bind(sql(now),userId,...ok).run()).meta.changes;
}
