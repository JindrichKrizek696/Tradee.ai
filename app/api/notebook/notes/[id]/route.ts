import {identity,db,failed,sameOrigin} from '@/lib/server';
import {getNote,updateNote,deleteNote,notebookError} from '@/lib/notebook/store';
import {validateNote} from '@/lib/notebook/core';
import {instruments} from '@/lib/markets';
const ids=instruments.map(i=>i.id),headers={'Cache-Control':'private, no-store'};
type Ctx={params:Promise<{id:string}>};
const notFound=()=>Response.json({error:'Papír nenalezen. Možná byl smazán v jiném okně.'},{status:404,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request,{params}:Ctx){try{const u=await identity(req),note=await getNote(db(),u.id,(await params).id);
 return note?Response.json({note},{headers}):notFound()}catch(e){return failed(notebookError(e))}}
// automatické ukládání z editoru: jen změněná pole
export async function PATCH(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req);
 const v=validateNote(await req.json(),ids);if('error' in v)throw Error(v.error);
 const r=await updateNote(db(),u.id,(await params).id,v);
 return r?Response.json({ok:true,...r},{headers}):notFound()}catch(e){return failed(notebookError(e))}}
export async function DELETE(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req);
 return await deleteNote(db(),u.id,(await params).id)?Response.json({ok:true},{headers}):notFound()}catch(e){return failed(notebookError(e))}}
