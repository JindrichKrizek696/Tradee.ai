import {identity,db,failed,sameOrigin} from '@/lib/server';
import {getAlert,updateAlert,deleteAlert,publicAlert} from '@/lib/alerts/store';
import {H,ctxFor,notFound} from '@/lib/alerts/api';
type Ctx={params:Promise<{id:string}>};
// Úprava (i přetažení čáry v grafu, pauza / obnovení) a smazání vlastního alertu.
export async function PATCH(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),d=db(),id=(await params).id,b=await req.json() as Record<string,unknown>;
 if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Neplatná změna.');
 const cur=await getAlert(d,u.id,id);if(!cur)return notFound();
 const now=Date.now(),r=await updateAlert(d,u.id,id,b,await ctxFor(d,b.instrument??cur.instrument,b.hint,now));
 if(!r||!r.alert)return notFound();
 return Response.json({alert:publicAlert(r.alert),warnings:r.warnings},H)}catch(e){return failed(e)}}
export async function DELETE(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req);
 if(!await deleteAlert(db(),u.id,(await params).id))return notFound();
 return Response.json({ok:true},H)}catch(e){return failed(e)}}
