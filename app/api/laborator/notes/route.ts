// Laboratoř · poznámky pro AI (jen vlastník, lab_notes).
import {db,sameOrigin} from '@/lib/server';
import {labUser,labFailed,LAB_HEADERS} from '@/lib/lab/http';
import {listNotes,createNote,refreshSummary} from '@/lib/lab/store';
import {validateLabNote} from '@/lib/lab/core';
export async function GET(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;
 return Response.json({notes:await listNotes(db(),u.id)},{headers:LAB_HEADERS})}catch(e){return labFailed(e)}}
export async function POST(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;sameOrigin(req);const d=db();
 const v=validateLabNote(await req.json().catch(()=>null));if('error' in v)throw Error(v.error);
 const id=await createNote(d,u.id,v);await refreshSummary(d,u.id).catch(e=>console.error(e));
 return Response.json({id,notes:await listNotes(d,u.id)},{headers:LAB_HEADERS})}catch(e){return labFailed(e)}}
