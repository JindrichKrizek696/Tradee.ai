import {runtime,identity,db,failed,sameOrigin} from '@/lib/server';
import {ownPlanFile,deletePlanFile} from '@/lib/strategy/store';
type Ctx={params:Promise<{id:string}>};
// obrázek jen pro vlastníka; nosniff + CSP proti spuštění obsahu
export async function GET(req:Request,{params}:Ctx){try{const u=await identity(req),{id}=await params,f=await ownPlanFile(db(),u.id,id);
 if(!f)return new Response('Obrázek nenalezen.',{status:404});
 const o=await runtime().BUCKET.get(f.r2_key);if(!o)return new Response('Obrázek nenalezen.',{status:404});
 return new Response(o.body,{headers:{'Content-Type':f.type,'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}})}catch(e){return failed(e)}}
export async function DELETE(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),{id}=await params,d=db(),f=await ownPlanFile(d,u.id,id);
 if(!f)return Response.json({error:'Obrázek nenalezen.'},{status:404});
 await deletePlanFile(d,u.id,id);await runtime().BUCKET.delete(f.r2_key).catch(e=>console.error('plan r2 delete',f.r2_key,e));
 return Response.json({ok:true})}catch(e){return failed(e)}}
