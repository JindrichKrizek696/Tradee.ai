import {identity,db,failed,sameOrigin} from '@/lib/server';
import {updateProfile,deleteProfile} from '@/lib/risk/store';
import {parseProfileInput} from '@/lib/risk/account';
import {pragueDate} from '@/lib/mt/trades';
import {CURRENCIES} from '@/lib/fx';
type Ctx={params:Promise<{id:string}>};
const notFound=()=>Response.json({error:'Profil nenalezen.'},{status:404,headers:{'Cache-Control':'no-store'}});
export async function PUT(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),id=(await params).id;
 const b=await req.json().catch(()=>null) as {archived?:unknown}|null;
 const p=parseProfileInput(b,pragueDate(Date.now()),CURRENCIES);if(!p.ok)throw Error(p.error);
 if(!await updateProfile(db(),u.id,id,p.value,typeof b?.archived==='boolean'?b.archived:undefined))return notFound();
 return Response.json({ok:true},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function DELETE(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req);
 if(!await deleteProfile(db(),u.id,(await params).id))return notFound();
 return Response.json({ok:true},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
