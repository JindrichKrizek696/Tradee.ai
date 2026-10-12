import {identity,db,failed,sameOrigin} from '@/lib/server';
import {createFolder,renameFolder,reorderFolders,deleteFolder,notebookError} from '@/lib/notebook/store';
import {cleanFolderName,cleanOrder} from '@/lib/notebook/core';
const headers={'Cache-Control':'private, no-store'};
const notFound=()=>Response.json({error:'Složka nenalezena.'},{status:404,headers:{'Cache-Control':'no-store'}});
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {name?:unknown};const n=cleanFolderName(b?.name);if(typeof n!=='string')throw Error(n.error);
 return Response.json({folder:await createFolder(db(),u.id,n)},{headers})}catch(e){return failed(notebookError(e))}}
// {id,name} = přejmenovat, {order:[id…]} = nové pořadí
export async function PATCH(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {id?:unknown;name?:unknown;order?:unknown};
 if(b?.order!==undefined){const o=cleanOrder(b.order);if(!Array.isArray(o))throw Error(o.error);await reorderFolders(db(),u.id,o);return Response.json({ok:true},{headers})}
 if(typeof b?.id!=='string'||!b.id)throw Error('Chybí složka.');
 const n=cleanFolderName(b.name);if(typeof n!=='string')throw Error(n.error);
 return await renameFolder(db(),u.id,b.id,n)?Response.json({ok:true,name:n},{headers}):notFound()}catch(e){return failed(notebookError(e))}}
export async function DELETE(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {id?:unknown};if(typeof b?.id!=='string'||!b.id)throw Error('Chybí složka.');
 return await deleteFolder(db(),u.id,b.id)?Response.json({ok:true},{headers}):notFound()}catch(e){return failed(notebookError(e))}}
