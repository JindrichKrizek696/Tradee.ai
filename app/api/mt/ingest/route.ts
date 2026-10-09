import {db} from '@/lib/server';
import {parseBatch,snapshotEvents,eventPosition,MAX_BYTES,type BarsEvent,type MtEvent,type OrderEvent} from '@/lib/mt/protocol';
import {upsertAccount,insertEvents,upsertOrders,insertSnapshot,rebuildPositions,upsertBars} from '@/lib/mt/store';
import {snapshotNewPositions} from '@/lib/checklists/store';
import {evaluateAccount} from '@/lib/discipline/store';
import {highNews} from '@/lib/discipline/news';
import calendarAuto from '@/data/calendar.json';
import fundamentals from '@/data/fundamentals.json';
import type {AutoEvent,CuratedEvent} from '@/lib/calendar';
import {instruments} from '@/lib/markets';
import {authKey,mtJson} from '@/lib/mt/http';
// Příjem dávky z EA. Chyba DB → 503, aby EA dávku podržel a poslal znovu (400 by ji zahodil).
export async function POST(req:Request){
 try{
  const a=await authKey(req);if(a instanceof Response)return a;
  if(Number(req.headers.get('content-length')||0)>MAX_BYTES)return mtJson({error:'Dávka je větší než 1 MB.'},413);
  const text=await req.text();if(text.length>MAX_BYTES)return mtJson({error:'Dávka je větší než 1 MB.'},413);
  let raw:unknown;try{raw=JSON.parse(text)}catch{return mtJson({error:'Neplatný JSON.'},400)}
  const p=parseBatch(raw);if(!p.ok)return mtJson({error:p.error},400);
  const {account,snapshot}=p.batch,d=db();
  // svíčky se neukládají do mt_events (velké, deduplikace = přepis v mt_position_bars)
  const bars=p.batch.events.filter((e):e is BarsEvent=>e.type==='bars'),events=p.batch.events.filter(e=>e.type!=='bars');
  const accEv=[...events].reverse().find(e=>e.type==='account');
  const balance=snapshot?.balance??(accEv?.type==='account'?accEv.balance:null),equity=snapshot?.equity??(accEv?.type==='account'?accEv.equity:null);
  const accountId=await upsertAccount(d,a.userId,account,balance,equity);
  const all:MtEvent[]=snapshot?[...events,...snapshotEvents(snapshot)]:events;
  const r=await insertEvents(d,accountId,all);
  await upsertOrders(d,accountId,r.fresh.filter((e):e is OrderEvent=>e.type==='order'));
  // neúspěšné přepočty se logují a opraví je: node --experimental-strip-types scripts/mt-rebuild.mjs <account>
  // dealy a posuny SL/TP se přepočítají i jako duplicity (dávka zopakovaná po výpadku uprostřed přepočtu); ostatní jen nové
  const touched=[...new Set([...r.fresh,...events.filter(e=>e.type==='deal'||e.type==='position_modify')].map(eventPosition))];
  await rebuildPositions(d,accountId,touched);
  try{await snapshotNewPositions(d,a.userId,accountId,Date.now(),instruments.map(i=>i.id))}catch(e){console.error('checklist snapshot',accountId,e)}
  // vyhodnocení pravidel disciplíny; chyba příjem nikdy neshodí (backfill: scripts/discipline-backfill.mjs)
  try{await evaluateAccount(d,a.userId,accountId,touched,highNews(calendarAuto.events as AutoEvent[],fundamentals.events as CuratedEvent[],fundamentals.sources))}catch(e){console.error('discipline',accountId,e)}
  if(bars.length)await upsertBars(d,accountId,bars);
  if(snapshot)try{await insertSnapshot(d,accountId,snapshot)}catch(e){console.error('mt snapshot',accountId,e)}
  return mtJson({ok:true,accepted:r.accepted+bars.length,duplicates:r.duplicates});
 }catch(e){console.error('mt ingest',e);return mtJson({error:'Server data teď neuložil, EA to zkusí znovu.'},503)}
}
