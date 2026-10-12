import {identity,db,failed,sameOrigin} from '@/lib/server';
import {createNote,notebookError} from '@/lib/notebook/store';
import {validateNote} from '@/lib/notebook/core';
import {instruments} from '@/lib/markets';
const ids=instruments.map(i=>i.id);
// nový papír ve vlastní složce (název a text můžou být prázdné, doplní se psaním)
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);
 const v=validateNote(await req.json(),ids,true);if('error' in v)throw Error(v.error);
 const note=await createNote(db(),u.id,{...v,folderId:v.folderId!});
 return note?Response.json({note},{headers:{'Cache-Control':'private, no-store'}}):Response.json({error:'Složka nenalezena.'},{status:404,headers:{'Cache-Control':'no-store'}})}catch(e){return failed(notebookError(e))}}
