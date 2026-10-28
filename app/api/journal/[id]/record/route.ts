import {identity,db,failed,sameOrigin} from '@/lib/server';
import {parseJournalId} from '@/lib/journal/rows';
import {tradeRecord,saveRecord,addChange,deleteChange,ownsTrade} from '@/lib/journal/record-store';
import {allImpactNews} from '@/lib/journal/news-data';
import {viewAs} from '@/lib/admin/http';
type Ctx={params:Promise<{id:string}>};
const headers={'Cache-Control':'private, no-store'};
const notFound=()=>Response.json({error:'Obchod nenalezen.'},{status:404,headers:{'Cache-Control':'no-store'}});
// Záznam obchodu: GET režim, riziko (plán / provedení), R z původního rizika, BE, náklady, změny SL/TP, upozornění, no-trade okna, hodnocení procesu
// PUT {mode?,plannedRisk?,plannedRiskPct?,costs?,process?} · POST změna SL/TP (ruční nebo důvod ke změně z EA) · DELETE {changeId}
export async function GET(req:Request,{params}:Ctx){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 const id=parseJournalId((await params).id);if(!id)return notFound();
 const r=await tradeRecord(db(),v.userId,{kind:id.kind,id:id.id},allImpactNews);
 return r?Response.json(r,{headers}):notFound()}catch(e){return failed(e)}}
export async function PUT(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),id=parseJournalId((await params).id);if(!id)return notFound();
 const d=db(),ref={kind:id.kind,id:id.id} as const;if(!await ownsTrade(d,u.id,ref))return notFound();
 await saveRecord(d,u.id,ref,await req.json().catch(()=>null));
 return Response.json(await tradeRecord(d,u.id,ref,allImpactNews),{headers})}catch(e){return failed(e)}}
export async function POST(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),id=parseJournalId((await params).id);if(!id)return notFound();
 const d=db(),ref={kind:id.kind,id:id.id} as const;if(!await ownsTrade(d,u.id,ref))return notFound();
 await addChange(d,u.id,ref,await req.json().catch(()=>null));
 return Response.json(await tradeRecord(d,u.id,ref,allImpactNews),{headers})}catch(e){return failed(e)}}
export async function DELETE(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),id=parseJournalId((await params).id);if(!id)return notFound();
 const d=db(),ref={kind:id.kind,id:id.id} as const;if(!await ownsTrade(d,u.id,ref))return notFound();
 const b=await req.json().catch(()=>null) as {changeId?:unknown}|null;
 if(!await deleteChange(d,u.id,ref,Number(b?.changeId)))return notFound();
 return Response.json(await tradeRecord(d,u.id,ref,allImpactNews),{headers})}catch(e){return failed(e)}}
