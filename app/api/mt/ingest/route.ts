import {db} from '@/lib/server';
import {parseBatch,snapshotEvents,eventPosition,MAX_BYTES,type MtEvent,type OrderEvent} from '@/lib/mt/protocol';
import {upsertAccount,insertEvents,upsertOrders,insertSnapshot,rebuildPositions} from '@/lib/mt/store';
import {authKey,mtJson} from '@/lib/mt/http';
// Příjem dávky z EA. Chyba DB → 503, aby EA dávku podržel a poslal znovu (400 by ji zahodil).
export async function POST(req:Request){
 try{
  const a=await authKey(req);if(a instanceof Response)return a;
  if(Number(req.headers.get('content-length')||0)>MAX_BYTES)return mtJson({error:'Dávka je větší než 1 MB.'},413);
  const text=await req.text();if(text.length>MAX_BYTES)return mtJson({error:'Dávka je větší než 1 MB.'},413);
  let raw:unknown;try{raw=JSON.parse(text)}catch{return mtJson({error:'Neplatný JSON.'},400)}
  const p=parseBatch(raw);if(!p.ok)return mtJson({error:p.error},400);
  const {account,events,snapshot}=p.batch,d=db();
  const accEv=[...events].reverse().find(e=>e.type==='account');
  const balance=snapshot?.balance??(accEv?.type==='account'?accEv.balance:null),equity=snapshot?.equity??(accEv?.type==='account'?accEv.equity:null);
  const accountId=await upsertAccount(d,a.userId,account,balance,equity);
  const all:MtEvent[]=snapshot?[...events,...snapshotEvents(snapshot)]:events;
  const r=await insertEvents(d,accountId,all);
  await upsertOrders(d,accountId,r.fresh.filter((e):e is OrderEvent=>e.type==='order'));
  // neúspěšné přepočty se logují a opraví je: node --experimental-strip-types scripts/mt-rebuild.mjs <account>
  // dealy a posuny SL/TP se přepočítají i jako duplicity (dávka zopakovaná po výpadku uprostřed přepočtu); ostatní jen nové
  await rebuildPositions(d,accountId,[...r.fresh,...events.filter(e=>e.type==='deal'||e.type==='position_modify')].map(eventPosition));
  if(snapshot)try{await insertSnapshot(d,accountId,snapshot)}catch(e){console.error('mt snapshot',accountId,e)}
  return mtJson({ok:true,accepted:r.accepted,duplicates:r.duplicates});
 }catch(e){console.error('mt ingest',e);return mtJson({error:'Server data teď neuložil, EA to zkusí znovu.'},503)}
}
