// DB operace MetaTrader synchronizace. Db je parametr, aby šly použít z route handlerů i ze skriptu mt-rebuild.
import type {Db} from '../mysql.ts';
import type {AccountInfo,MtEvent,OrderEvent,Snapshot} from './protocol.ts';
import {buildPositions,POSITION_COLUMNS} from './build.ts';
export const nowSql=()=>new Date().toISOString().slice(0,19).replace('T',' ');
const CHUNK=100;

export async function keyOwner(d:Db,hash:string){
 const k=await d.prepare('SELECT id,user_id FROM mt_keys WHERE key_hash=? AND revoked IS NULL').bind(hash).first<{id:string;user_id:string}>();
 if(!k)return null;
 await d.prepare('UPDATE mt_keys SET last_used=? WHERE id=? AND (last_used IS NULL OR last_used<?)').bind(nowSql(),k.id,new Date(Date.now()-60000).toISOString().slice(0,19).replace('T',' ')).run();
 return {keyId:k.id,userId:k.user_id};
}
export async function upsertAccount(d:Db,userId:string,a:AccountInfo,balance:number|null,equity:number|null){
 const found=await d.prepare('SELECT id FROM mt_accounts WHERE user_id=? AND server=? AND login=?').bind(userId,a.server,a.login).first<{id:string}>();
 if(found){
  // název z EA jen pokud ho uživatel v Tradee nepřejmenoval
  await d.prepare("UPDATE mt_accounts SET platform=?,company=?,currency=?,leverage=?,mode=?,ea_version=?,last_seen=?,balance=COALESCE(?,balance),equity=COALESCE(?,equity),name=IF(name='',?,name) WHERE id=?").bind(a.platform,a.company,a.currency,a.leverage,a.mode,a.ea,nowSql(),balance,equity,a.name,found.id).run();
  return found.id;
 }
 const id='mta_'+crypto.randomUUID().replace(/-/g,'').slice(0,24);
 await d.prepare('INSERT INTO mt_accounts(id,user_id,platform,login,server,company,currency,leverage,mode,name,ea_version,last_seen,balance,equity,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,userId,a.platform,a.login,a.server,a.company,a.currency,a.leverage,a.mode,a.name,a.ea,nowSql(),balance,equity,nowSql()).run();
 return id;
}
export async function insertEvents(d:Db,accountId:string,events:MtEvent[]){
 let accepted=0;const fresh:MtEvent[]=[];
 for(let i=0;i<events.length;i+=CHUNK){
  const chunk=events.slice(i,i+CHUNK);
  // nejdřív zjistit, co už v DB je; vkládá se jen nové (INSERT IGNORE pro souběh)
  const have=new Set((await d.prepare('SELECT event_id FROM mt_events WHERE account_id=? AND event_id IN ('+chunk.map(()=>'?').join(',')+')').bind(accountId,...chunk.map(e=>e.id)).all<{event_id:string}>()).results.map(r=>r.event_id));
  const add=chunk.filter(e=>!have.has(e.id));
  if(!add.length)continue;
  const params=add.flatMap(e=>[accountId,e.id,e.type,'position' in e&&e.position?e.position:null,e.ts,JSON.stringify(e),nowSql()]);
  const r=await d.prepare('INSERT IGNORE INTO mt_events(account_id,event_id,type,position,ts,payload,received) VALUES '+add.map(()=>'(?,?,?,?,?,?,?)').join(',')).bind(...params).run();
  accepted+=r.meta.changes;fresh.push(...add);
 }
 return {accepted,duplicates:events.length-accepted,fresh};
}
const DONE=['canceled','expired','filled','rejected'];
export async function upsertOrders(d:Db,accountId:string,orders:OrderEvent[]){
 for(const o of orders)try{await d.prepare(`INSERT INTO mt_orders(account_id,ticket,symbol,order_type,state,volume,price_open,price_requested,sl,tp,placed_ts,updated_ts,done_ts,comment,magic) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON DUPLICATE KEY UPDATE state=IF(VALUES(updated_ts)>updated_ts OR (VALUES(updated_ts)=updated_ts AND VALUES(state) IN ('filled','canceled','expired','rejected')),VALUES(state),state),volume=IF(VALUES(updated_ts)>updated_ts OR (VALUES(updated_ts)=updated_ts AND VALUES(state) IN ('filled','canceled','expired','rejected')),VALUES(volume),volume),price_open=IF(VALUES(updated_ts)>updated_ts OR (VALUES(updated_ts)=updated_ts AND VALUES(state) IN ('filled','canceled','expired','rejected')),VALUES(price_open),price_open),sl=IF(VALUES(updated_ts)>updated_ts OR (VALUES(updated_ts)=updated_ts AND VALUES(state) IN ('filled','canceled','expired','rejected')),VALUES(sl),sl),tp=IF(VALUES(updated_ts)>updated_ts OR (VALUES(updated_ts)=updated_ts AND VALUES(state) IN ('filled','canceled','expired','rejected')),VALUES(tp),tp),placed_ts=LEAST(placed_ts,VALUES(placed_ts)),done_ts=COALESCE(done_ts,VALUES(done_ts)),updated_ts=GREATEST(updated_ts,VALUES(updated_ts))`)
  .bind(accountId,o.order,o.symbol,o.orderType,o.state,o.volume,o.priceOpen,o.priceRequested,o.sl,o.tp,o.ts,o.ts,DONE.includes(o.state)?o.ts:null,o.comment,o.magic).run()}catch(e){console.error('mt order',accountId,o.order,e)}
}
export async function insertSnapshot(d:Db,accountId:string,s:Snapshot){
 const floating=Math.round(s.positions.reduce((a,p)=>a+p.profit+p.swap,0)*100)/100;
 await d.prepare('INSERT IGNORE INTO mt_snapshots(account_id,ts,balance,equity,margin,floating) VALUES(?,?,?,?,?,?)').bind(accountId,s.ts,s.balance,s.equity,s.margin,floating).run();
}
export async function rebuildPositions(d:Db,accountId:string,positions:string[]){
 for(const p of new Set(positions)){
  if(!p||p==='0')continue;
  try{
  const rows=(await d.prepare('SELECT payload FROM mt_events WHERE account_id=? AND position=? ORDER BY ts,event_id').bind(accountId,p).all<{payload:string}>()).results;
  const built=buildPositions(accountId,rows.map(r=>JSON.parse(r.payload) as MtEvent));
  const keep=new Set(built.map(b=>b.position.id));
  const old=(await d.prepare('SELECT id FROM mt_positions WHERE account_id=? AND (ticket=? OR LEFT(ticket,CHAR_LENGTH(?)+2)=CONCAT(?,\':r\'))').bind(accountId,p,p,p).all<{id:string}>()).results;
  for(const {id} of old)if(!keep.has(id)){await d.prepare('DELETE FROM mt_position_changes WHERE position_id=?').bind(id).run();await d.prepare('DELETE FROM mt_positions WHERE id=?').bind(id).run()}
  for(const b of built){
   const cols=[...POSITION_COLUMNS],vals=cols.map(c=>b.position[c]);
   // tags_manual a note se nepřepisují (ruční údaje z Tradee)
   await d.prepare(`INSERT INTO mt_positions(${cols.join(',')},updated) VALUES(${cols.map(()=>'?').join(',')},?) ON DUPLICATE KEY UPDATE ${cols.filter(c=>c!=='id'&&c!=='account_id').map(c=>`${c}=VALUES(${c})`).join(',')},updated=VALUES(updated)`).bind(...vals,nowSql()).run();
   await d.prepare('DELETE FROM mt_position_changes WHERE position_id=?').bind(b.position.id).run();
   for(let i=0;i<b.changes.length;i+=CHUNK){
    const chunk=b.changes.slice(i,i+CHUNK);
    await d.prepare('INSERT INTO mt_position_changes(position_id,ts,kind,old_value,new_value,price,volume,reason) VALUES '+chunk.map(()=>'(?,?,?,?,?,?,?,?)').join(',')).bind(...chunk.flatMap(c=>[b.position.id,c.ts,c.kind,c.old_value,c.new_value,c.price,c.volume,c.reason])).run();
   }
  }
  }catch(e){console.error('mt rebuild',accountId,p,e)}
 }
}
export async function accountState(d:Db,userId:string,login:string,server:string){
 const a=await d.prepare('SELECT id FROM mt_accounts WHERE user_id=? AND server=? AND login=?').bind(userId,server,login).first<{id:string}>();
 if(!a)return {known:false,lastDealTs:0,lastDealTicket:'',openPositions:[] as string[]};
 const last=await d.prepare("SELECT event_id,ts FROM mt_events WHERE account_id=? AND type='deal' ORDER BY ts DESC, event_id DESC LIMIT 1").bind(a.id).first<{event_id:string;ts:number}>();
 const open=(await d.prepare("SELECT ticket FROM mt_positions WHERE account_id=? AND status='open'").bind(a.id).all<{ticket:string}>()).results.map(r=>r.ticket);
 return {known:true,lastDealTs:Number(last?.ts||0),lastDealTicket:last?last.event_id.replace(/^d:/,''):'',openPositions:open};
}
