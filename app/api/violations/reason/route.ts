import {identity,db,failed,sameOrigin} from '@/lib/server';
import {saveViolationReason} from '@/lib/discipline/store';
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {id?:unknown;code?:unknown;text?:unknown};if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Neplatné zdůvodnění.');
 const id=typeof b.id==='number'?b.id:NaN;
 if(!await saveViolationReason(db(),u.id,id,b.code,b.text))return Response.json({error:'Porušení už není k zdůvodnění.'},{status:404,headers:{'Cache-Control':'no-store'}});
 return Response.json({ok:true},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
