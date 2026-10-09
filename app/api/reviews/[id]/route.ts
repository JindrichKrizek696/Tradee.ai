import {identity,db,failed,sameOrigin} from '@/lib/server';
import {tradeMarket,tradeChecklist} from '@/lib/checklists/store';
import {getReview,saveReview,type ReviewInput} from '@/lib/discipline/store';
import {parseJournalId} from '@/lib/journal/rows';
import {viewAs} from '@/lib/admin/http';
import {instruments} from '@/lib/markets';
type Ctx={params:Promise<{id:string}>};
const ids=instruments.map(i=>i.id);
const notFound=()=>Response.json({error:'Obchod nenalezen.'},{status:404,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request,{params}:Ctx){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 const p=parseJournalId((await params).id);if(!p)return notFound();
 const d=db(),tid=p.kind+':'+p.id;if(await tradeMarket(d,v.userId,p.kind,p.id,ids)===undefined)return notFound();
 const [r,c]=await Promise.all([getReview(d,v.userId,tid),tradeChecklist(d,v.userId,tid)]);
 return Response.json({...r,checklist:c?.snapshot??null},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function PUT(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),p=parseJournalId((await params).id);if(!p)return notFound();
 const d=db(),tid=p.kind+':'+p.id;if(await tradeMarket(d,u.id,p.kind,p.id,ids)===undefined)return notFound();
 const b=await req.json() as ReviewInput;if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Neplatné vyhodnocení.');
 await saveReview(d,u.id,tid,b);
 return Response.json(await getReview(d,u.id,tid),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
