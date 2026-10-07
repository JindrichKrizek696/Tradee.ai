import {identity,db,failed,sameOrigin} from '@/lib/server';
import {journalDetail,updateMtJournal,updateManualNote} from '@/lib/journal/store';
import {parseJournalId,cleanTags,cleanNote} from '@/lib/journal/rows';
type Ctx={params:Promise<{id:string}>};
const notFound=()=>Response.json({error:'Obchod nenalezen.'},{status:404,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request,{params}:Ctx){try{const u=await identity(req),id=parseJournalId((await params).id);
 if(!id||id.kind!=='mt')return notFound();
 const d=await journalDetail(db(),u.id,id.id);return d?Response.json(d,{headers:{'Cache-Control':'private, no-store'}}):notFound()}catch(e){return failed(e)}}
export async function PATCH(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),id=parseJournalId((await params).id);if(!id)return notFound();
 const b=await req.json() as {tags?:unknown;note?:unknown};
 if(id.kind==='man'){if(b.tags!==undefined)throw Error('Ruční obchod nemá tagy.');if(b.note===undefined)throw Error('Chybí poznámka.');return await updateManualNote(db(),u.id,id.id,cleanNote(b.note,500))?Response.json({ok:true}):notFound()}
 if(b.tags===undefined&&b.note===undefined)throw Error('Není co uložit.');
 const ok=await updateMtJournal(db(),u.id,id.id,{tags:b.tags===undefined?undefined:cleanTags(b.tags),note:b.note===undefined?undefined:cleanNote(b.note,5000)});
 return ok?Response.json({ok:true}):notFound()}catch(e){return failed(e)}}
