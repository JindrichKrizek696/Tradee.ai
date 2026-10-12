// Laboratoř · úprava a smazání poznámky (jen vlastník, jen vlastní řádky).
import {db,sameOrigin} from '@/lib/server';
import {labUser,labFailed,labNotFound,LAB_HEADERS} from '@/lib/lab/http';
import {updateNote,deleteNote,listNotes,refreshSummary} from '@/lib/lab/store';
import {validateLabNote} from '@/lib/lab/core';
type Ctx={params:Promise<{id:string}>};
export async function PATCH(req:Request,{params}:Ctx){try{const u=await labUser(req);if(u instanceof Response)return u;sameOrigin(req);const d=db();
 const v=validateLabNote(await req.json().catch(()=>null));if('error' in v)throw Error(v.error);
 if(!await updateNote(d,u.id,(await params).id,v))return labNotFound();
 await refreshSummary(d,u.id).catch(e=>console.error(e));
 return Response.json({notes:await listNotes(d,u.id)},{headers:LAB_HEADERS})}catch(e){return labFailed(e)}}
export async function DELETE(req:Request,{params}:Ctx){try{const u=await labUser(req);if(u instanceof Response)return u;sameOrigin(req);const d=db();
 if(!await deleteNote(d,u.id,(await params).id))return labNotFound();
 await refreshSummary(d,u.id).catch(e=>console.error(e));
 return Response.json({notes:await listNotes(d,u.id)},{headers:LAB_HEADERS})}catch(e){return labFailed(e)}}
