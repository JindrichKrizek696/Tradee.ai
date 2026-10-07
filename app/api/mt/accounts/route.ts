import {identity,db,failed,sameOrigin} from '@/lib/server';
import {listAccounts,deleteAccount} from '@/lib/mt/store';
export async function GET(req:Request){try{const u=await identity(req);return Response.json({accounts:await listAccounts(db(),u.id)},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function PATCH(req:Request){try{sameOrigin(req);const u=await identity(req);const {id,name}=await req.json() as {id?:unknown;name?:unknown};
 if(typeof id!=='string'||typeof name!=='string')throw Error('Chybí účet nebo název.');
 await db().prepare('UPDATE mt_accounts SET name=? WHERE id=? AND user_id=?').bind(name.trim().slice(0,60),id,u.id).run();return Response.json({ok:true})}catch(e){return failed(e)}}
export async function DELETE(req:Request){try{sameOrigin(req);const u=await identity(req);const {id}=await req.json() as {id?:unknown};if(typeof id!=='string')throw Error('Chybí účet.');
 if(!await deleteAccount(db(),u.id,id))throw Error('Účet nenalezen.');return Response.json({ok:true})}catch(e){return failed(e)}}
