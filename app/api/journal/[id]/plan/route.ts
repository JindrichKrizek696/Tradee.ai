import {identity,db,failed,sameOrigin} from '@/lib/server';
import {viewAs} from '@/lib/admin/http';
import {tradeMarket} from '@/lib/checklists/store';
import {parseJournalId} from '@/lib/journal/rows';
import {getTradePlan,getScenario,linkTrade,unlinkTrade,tradeEntry,suggestForTrade} from '@/lib/strategy/store';
import {instruments} from '@/lib/markets';
type Ctx={params:Promise<{id:string}>};
const headers={'Cache-Control':'private, no-store'},ids=instruments.map(i=>i.id);
const notFound=()=>Response.json({error:'Obchod nenalezen.'},{status:404,headers});
const tid=(p:{kind:string;id:string})=>p.kind+':'+p.id;
// Plán u obchodu: propojený scénář / strategie + verze a snímek checklistu; GET vrací i návrhy scénářů (stejný trh a směr, platný při vstupu)
export async function GET(req:Request,{params}:Ctx){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 const p=parseJournalId((await params).id);if(!p)return notFound();
 const d=db(),m=await tradeMarket(d,v.userId,p.kind,p.id,ids);if(m===undefined)return notFound();
 const plan=await getTradePlan(d,v.userId,tid(p)),scenario=plan?.scenarioId?await getScenario(d,v.userId,plan.scenarioId):null;
 const entry=await tradeEntry(d,v.userId,p.kind,p.id);
 const suggestions=v.viewing||!entry?[]:await suggestForTrade(d,v.userId,m,entry);
 return Response.json({instrument:m,plan,scenario,suggestions},{headers})}catch(e){return failed(e)}}
// PUT {scenarioId} nebo {strategyId, versionId?, model?, checklist?:{states,chartUrl,fileId,note}}
export async function PUT(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),p=parseJournalId((await params).id);if(!p)return notFound();
 const d=db(),m=await tradeMarket(d,u.id,p.kind,p.id,ids);if(m===undefined)return notFound();
 if(Number(req.headers.get('content-length')||0)>100_000)throw Error('Plán je příliš velký.');
 return Response.json({plan:await linkTrade(d,u.id,tid(p),await req.json())},{headers})}catch(e){return failed(e)}}
export async function DELETE(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),p=parseJournalId((await params).id);if(!p)return notFound();
 const d=db(),m=await tradeMarket(d,u.id,p.kind,p.id,ids);if(m===undefined)return notFound();
 await unlinkTrade(d,u.id,tid(p));return Response.json({ok:true},{headers})}catch(e){return failed(e)}}
