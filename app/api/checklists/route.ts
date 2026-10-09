import {identity,db,failed,sameOrigin} from '@/lib/server';
import {listChecklists,saveChecklist,deleteChecklist,reorderChecklists} from '@/lib/checklists/store';
import {validateChecklist} from '@/lib/checklists/core';
import {instruments} from '@/lib/markets';
const ids=instruments.map(i=>i.id);
const notFound=()=>Response.json({error:'Checklist nenalezen.'},{status:404,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request){try{const u=await identity(req);
 return Response.json({checklists:await listChecklists(db(),u.id),markets:instruments},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {id?:unknown;name?:unknown;items?:unknown;markets?:unknown};
 const v=validateChecklist(b,ids);if(typeof v==='string')throw Error(v);
 const id=await saveChecklist(db(),u.id,typeof b.id==='string'&&b.id?b.id:null,v);
 return id?Response.json({ok:true,id}):notFound()}catch(e){return failed(e)}}
export async function DELETE(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {id?:unknown};if(typeof b.id!=='string')throw Error('Chybí checklist.');
 return await deleteChecklist(db(),u.id,b.id)?Response.json({ok:true}):notFound()}catch(e){return failed(e)}}
export async function PATCH(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {order?:unknown};
 if(!Array.isArray(b.order)||b.order.length>100||b.order.some(x=>typeof x!=='string'))throw Error('Neplatné pořadí.');
 await reorderChecklists(db(),u.id,b.order as string[]);return Response.json({ok:true})}catch(e){return failed(e)}}
