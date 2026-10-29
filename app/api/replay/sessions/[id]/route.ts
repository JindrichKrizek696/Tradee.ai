// Replay seance: stav (svíčky jen do simulačních hodin), posun hodin, události (příkazy, rozhodnutí), přetočení, ukončení a zápis do Deníku.
// Hodiny drží server – klient nikdy nedostane svíčku, která v čase hodin ještě nebyla uzavřená.
import {identity,db,failed,sameOrigin} from '@/lib/server';
import {getVersion} from '@/lib/strategy/store';
import {buildSnapshot,decisionItems,type DecisionItem} from '@/lib/strategy/core';
import {parseOrder,type ReplayEvent} from '@/lib/replay/engine';
import {parseDecision,checkRewind} from '@/lib/replay/core';
import {nextSessionOpen,isSessionId,SESSION_OPENS} from '@/lib/replay/clock';
import {currenciesOf} from '@/lib/replay/panels';
import {getSession,deleteSession,loadEvents,appendEvent,setClock,rewindSession,barsBetween,sessionBars,nextCloses,nextNews,saveResults,loadTrades,exportToJournal,type Session} from '@/lib/replay/store';
type Ctx={params:Promise<{id:string}>};
const headers={'Cache-Control':'private, no-store'};
const okId=(s:string)=>/^rp_[a-z0-9]{1,30}$/.test(s);
const notFound=()=>Response.json({error:'Seance nenalezena.'},{status:404,headers});
const shortId=(p:string)=>p+crypto.randomUUID().replace(/-/g,'').slice(0,10);
async function checklistOf(d:ReturnType<typeof db>,userId:string,s:Session){
 if(!s.config.strategy)return null;
 const v=await getVersion(d,userId,s.config.strategy.versionId);if(!v)return null;
 const seen=new Map<string,DecisionItem>();for(const m of [null,...v.content.models])for(const i of decisionItems(v.content,m))seen.set(i.id,i);
 return {strategyName:v.strategyName,version:v.version,models:v.content.models,items:[...seen.values()]};
}
export async function GET(req:Request,{params}:Ctx){try{const u=await identity(req),{id}=await params;if(!okId(id))return notFound();const d=db();
 const s=await getSession(d,u.id,id);if(!s)return notFound();
 const [events,bars,trades,checklist]=await Promise.all([loadEvents(d,u.id,id),sessionBars(d,s),s.status==='active'?Promise.resolve([]):loadTrades(d,u.id,id),checklistOf(d,u.id,s)]);
 return Response.json({session:s,events,bars,trades,checklist,sessions:Object.entries(SESSION_OPENS).map(([k,v])=>({id:k,label:v.label}))},{headers})}catch(e){return failed(e)}}
export async function DELETE(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),{id}=await params;if(!okId(id))return notFound();
 if(!await deleteSession(db(),u.id,id))return notFound();return Response.json({ok:true},{headers})}catch(e){return failed(e)}}
type Body={action?:unknown;steps?:unknown;until?:unknown;kind?:unknown;data?:unknown;to?:unknown;confirm?:unknown};
export async function POST(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),{id}=await params;if(!okId(id))return notFound();const d=db(),now=Date.now();
 const s=await getSession(d,u.id,id);if(!s)return notFound();
 const b=(await req.json().catch(()=>null)??{}) as Body,action=String(b.action||'');
 if(action==='journal'){
  if(s.status==='active')throw Error('Nejdřív seanci ukonči – do Deníku jdou uzavřené výsledky.');
  const n=await exportToJournal(d,u.id,s,now);return Response.json({ok:true,added:n},{headers});
 }
 if(s.status!=='active')throw Error('Seance je ukončená.');
 const primary=s.symbols[0];
 if(action==='advance'){
  const until=String(b.until||'bar'),steps=Math.max(1,Math.min(500,Math.floor(Number(b.steps)||1)));
  let target:number|null=null,news:{at:number;title:string;currency:string}|null=null;
  if(until==='bar')target=(await nextCloses(d,primary,s.baseTf,s.clock,steps)).at(-1)??null;
  else{
   let x:number;
   if(until==='news'){news=await nextNews(d,currenciesOf(s.symbols),s.clock);if(!news)throw Error('Další silná zpráva v historii kalendáře není.');x=news.at}
   else if(until.startsWith('session:')&&isSessionId(until.slice(8)))x=nextSessionOpen(s.clock,until.slice(8) as Parameters<typeof nextSessionOpen>[1]);
   else throw Error('Neznámý posun.');
   const c=await nextCloses(d,primary,s.baseTf,s.clock,500),le=c.filter(t=>t<=x);
   target=le.length?le[le.length-1]:c[0]??null;
  }
  if(target===null)throw Error('Data došla – konec archivu svíček.');
  if(s.decideN){
   if(s.revealUntil===null||s.revealUntil<=s.clock)throw Error('Nejdřív zapiš rozhodnutí (long / short / bez obchodu) – pak se odkryjí další svíčky.');
   target=Math.min(target,s.revealUntil);
  }
  const bars:Record<string,unknown>={};for(const sym of s.symbols)bars[sym]=await barsBetween(d,sym,s.baseTf,s.clock,target);
  await setClock(d,u.id,id,target,s.revealUntil,now);
  return Response.json({clock:target,bars,revealUntil:s.revealUntil,news},{headers});
 }
 if(action==='event'){
  const kind=String(b.kind||''),raw=(b.data&&typeof b.data==='object'?b.data:{}) as Record<string,unknown>;
  let ev:ReplayEvent,revealUntil=s.revealUntil;
  if(kind==='order'){const o=parseOrder(raw,s.config.specs,shortId('o'));if(typeof o==='string')throw Error(o);ev=await appendEvent(d,u.id,id,s.clock,'order',o as unknown as Record<string,unknown>,now)}
  else if(kind==='cancel'||kind==='close'||kind==='modify'){
   const orderId=String(raw.orderId||'');if(!/^o[a-z0-9]{1,20}$/.test(orderId))throw Error('Neznámý příkaz.');
   const data:Record<string,unknown>={orderId};
   if(kind==='modify')for(const k of ['sl','tp'] as const)if(k in raw){const v=raw[k]===null||raw[k]===''?null:Number(raw[k]);if(v!==null&&!(Number.isFinite(v)&&v>0))throw Error('Úroveň musí být kladné číslo.');data[k]=v}
   ev=await appendEvent(d,u.id,id,s.clock,kind,data,now);
  }
  else if(kind==='decision'){
   const x=parseDecision(raw,s.symbols);if(typeof x==='string')throw Error(x);
   let snapshot:unknown=null;
   if(s.config.strategy){const v=await getVersion(d,u.id,s.config.strategy.versionId);
    if(v){const sn=buildSnapshot({id:v.strategyId,name:v.strategyName},{id:v.id,version:v.version,content:v.content},x.model,x.states,{note:x.note},s.clock);if(typeof sn==='string')throw Error(sn);snapshot=sn}}
   ev=await appendEvent(d,u.id,id,s.clock,'decision',{id:shortId('d'),symbol:x.symbol,choice:x.choice,note:x.note,snapshot},now);
   if(s.decideN){revealUntil=(await nextCloses(d,primary,s.baseTf,s.clock,s.decideN)).at(-1)??s.clock;await setClock(d,u.id,id,s.clock,revealUntil,now)}
  }
  else throw Error('Neznámá událost.');
  return Response.json({event:ev,revealUntil},{headers});
 }
 if(action==='rewind'||action==='reset'){
  if(s.mode==='validate'&&b.confirm!==true)throw Error('Ve validačním režimu se každé přetočení zapíše do výsledků – potvrď ho.');
  const to=action==='reset'?s.start:checkRewind(b.to,s.clock,s.start);if(typeof to==='string')throw Error(to);
  const ev=await rewindSession(d,u.id,s,to,action==='reset'?'reset':'rewind',now);
  return Response.json({ok:true,event:ev},{headers});
 }
 if(action==='finish'||action==='save'){
  const [bars,events]=await Promise.all([sessionBars(d,s,false),loadEvents(d,u.id,id)]);
  const r=await saveResults(d,u.id,s,bars,events,action==='finish',now);
  return Response.json({ok:true,status:r.status,summary:r.summary,breach:r.res.breach,trades:r.status==='active'?[]:await loadTrades(d,u.id,id)},{headers});
 }
 throw Error('Neznámá akce.');
}catch(e){return failed(e)}}
