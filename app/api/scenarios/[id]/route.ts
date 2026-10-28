import {identity,db,failed,sameOrigin} from '@/lib/server';
import {getScenario,updateScenario,deleteScenario} from '@/lib/strategy/store';
import {nearestEvent} from '@/lib/strategy/scenario';
import {newsForScenarios} from '@/lib/strategy/news';
import calendarAuto from '@/data/calendar.json';
import fundamentals from '@/data/fundamentals.json';
import type {AutoEvent,CuratedEvent} from '@/lib/calendar';
import {instruments} from '@/lib/markets';
type Ctx={params:Promise<{id:string}>};
const headers={'Cache-Control':'private, no-store'},ids=instruments.map(i=>i.id);
const notFound=()=>Response.json({error:'Scénář nenalezen. Možná byl smazán v jiném okně.'},{status:404,headers});
const okId=(s:string)=>/^scn_[a-z0-9]{24}$/.test(s);
export async function GET(req:Request,{params}:Ctx){try{const u=await identity(req),{id}=await params;if(!okId(id))return notFound();
 const s=await getScenario(db(),u.id,id);if(!s)return notFound();
 const e=nearestEvent(newsForScenarios(calendarAuto.events as AutoEvent[],fundamentals.events as CuratedEvent[],fundamentals.sources as Record<string,{url?:string}>),s.instrument,Date.now());
 return Response.json({scenario:s,event:e?{at:e.at,title:e.title}:null},{headers})}catch(e){return failed(e)}}
// PATCH: pole scénáře, status (přechody hlídá moveStatus), checklist {states, chartUrl, fileId, note}
export async function PATCH(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),{id}=await params;if(!okId(id))return notFound();
 if(Number(req.headers.get('content-length')||0)>100_000)throw Error('Scénář je příliš velký.');
 const s=await updateScenario(db(),u.id,id,await req.json(),ids);return s?Response.json({scenario:s},{headers}):notFound()}catch(e){return failed(e)}}
export async function DELETE(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),{id}=await params;if(!okId(id))return notFound();
 return await deleteScenario(db(),u.id,id)?Response.json({ok:true},{headers}):notFound()}catch(e){return failed(e)}}
