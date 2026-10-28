import {identity,db,failed,sameOrigin} from '@/lib/server';
import {listScenarios,createScenario} from '@/lib/strategy/store';
import {nearestEvent} from '@/lib/strategy/scenario';
import {newsForScenarios} from '@/lib/strategy/news';
import calendarAuto from '@/data/calendar.json';
import fundamentals from '@/data/fundamentals.json';
import type {AutoEvent,CuratedEvent} from '@/lib/calendar';
import {instruments} from '@/lib/markets';
import {scenarioCollisions} from '@/lib/journal/record-store';
import {allImpactNews} from '@/lib/journal/news-data';
const headers={'Cache-Control':'private, no-store'},ids=instruments.map(i=>i.id);
let news:ReturnType<typeof newsForScenarios>|null=null;
const allNews=()=>news??=newsForScenarios(calendarAuto.events as AutoEvent[],fundamentals.events as CuratedEvent[],fundamentals.sources as Record<string,{url?:string}>);
// Scénáře: GET ?scope=open|closed|all&instrument= (u otevřených i nejbližší zpráva s vysokým dopadem pro měny trhu); POST = nový scénář
export async function GET(req:Request){try{const u=await identity(req),q=new URL(req.url).searchParams,now=Date.now();
 const scope=q.get('scope')==='open'||q.get('scope')==='closed'?q.get('scope') as 'open'|'closed':'all',inst=q.get('instrument');
 const list=await listScenarios(db(),u.id,{scope,instrument:inst&&ids.includes(inst)?inst:null,limit:Number(q.get('limit'))||200},now);
 const events:Record<string,{at:number;title:string}>={};
 for(const s of list)if(s.status==='waiting'||s.status==='active'){const e=nearestEvent(allNews(),s.instrument,now);if(e)events[s.id]={at:e.at,title:e.title}}
 // no-trade okna (verze strategie, všechny účty), do kterých platnost otevřeného scénáře zasahuje
 const windows=await scenarioCollisions(db(),u.id,list,allImpactNews(),now).catch(e=>{console.error('scenario windows',e);return {}});
 return Response.json({scenarios:list,events,windows,now},{headers})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);
 if(Number(req.headers.get('content-length')||0)>100_000)throw Error('Scénář je příliš velký.');
 return Response.json({scenario:await createScenario(db(),u.id,await req.json(),ids)},{headers})}catch(e){return failed(e)}}
