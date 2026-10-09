import {identity,db,failed,sameOrigin} from '@/lib/server';
import {tradeMarket,tradeChecklist,saveTradeChecklist,snapshotTrade,listChecklists,cleanSnapshot} from '@/lib/checklists/store';
import {applicable} from '@/lib/checklists/core';
import {parseJournalId} from '@/lib/journal/rows';
import {viewAs} from '@/lib/admin/http';
import {instruments} from '@/lib/markets';
type Ctx={params:Promise<{id:string}>};
const ids=instruments.map(i=>i.id);
const notFound=()=>Response.json({error:'Obchod nenalezen.'},{status:404,headers:{'Cache-Control':'no-store'}});
const tid=(p:{kind:string;id:string})=>p.kind+':'+p.id;
export async function GET(req:Request,{params}:Ctx){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 const p=parseJournalId((await params).id);if(!p)return notFound();
 const d=db(),m=await tradeMarket(d,v.userId,p.kind,p.id,ids);if(m===undefined)return notFound();
 const t=await tradeChecklist(d,v.userId,tid(p));
 const available=!!m&&applicable(await listChecklists(d,v.userId),m).length>0;
 return Response.json({snapshot:t?.snapshot??null,available},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function PUT(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),p=parseJournalId((await params).id);if(!p)return notFound();
 const d=db(),m=await tradeMarket(d,u.id,p.kind,p.id,ids);if(m===undefined)return notFound();
 const b=await req.json() as {snapshot?:unknown};const s=cleanSnapshot(b.snapshot);if(typeof s==='string')throw Error(s);
 const ins=(await tradeChecklist(d,u.id,tid(p)))?.instrument||m;if(!ins)throw Error('Obchod nemá rozpoznaný trh.');
 await saveTradeChecklist(d,u.id,tid(p),ins,s);return Response.json({ok:true})}catch(e){return failed(e)}}
export async function POST(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),p=parseJournalId((await params).id);if(!p)return notFound();
 const d=db(),m=await tradeMarket(d,u.id,p.kind,p.id,ids);if(m===undefined)return notFound();
 if(!m)throw Error('Obchod nemá rozpoznaný trh.');
 const snap=await snapshotTrade(d,u.id,tid(p),m);
 if(snap)return Response.json({snapshot:snap});
 const t=await tradeChecklist(d,u.id,tid(p));
 if(t)return Response.json({snapshot:t.snapshot});
 throw Error('Pro tento trh nemáš žádný checklist.')}catch(e){return failed(e)}}
