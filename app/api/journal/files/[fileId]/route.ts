import {runtime,identity,db,failed} from '@/lib/server';
import {ownFile} from '@/lib/journal/store';
// screenshot jen pro vlastníka; typ je z povoleného seznamu (uložený při nahrání), nosniff + CSP proti spuštění obsahu
export async function GET(req:Request,{params}:{params:Promise<{fileId:string}>}){try{const u=await identity(req),{fileId}=await params,f=await ownFile(db(),u.id,fileId);
 if(!f)return new Response('Obrázek nenalezen.',{status:404});
 const o=await runtime().BUCKET.get(f.r2_key);if(!o)return new Response('Obrázek nenalezen.',{status:404});
 return new Response(o.body,{headers:{'Content-Type':f.type,'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}})}catch(e){return failed(e)}}
