import {runtime,identity,db,failed,sameOrigin} from '@/lib/server';
import {checkUpload,MAX_FILE_BYTES} from '@/lib/journal/rows';
import {addPlanFile,countPlanFiles,PLAN_FILES_MAX} from '@/lib/strategy/store';
// Obrázek k plánu (příklad podmínky, screenshot ke scénáři): PNG / JPEG / WebP do 5 MB, nejvýš 300 na uživatele
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);
 if(Number(req.headers.get('content-length')||0)>MAX_FILE_BYTES+65536)throw Error('Obrázek může mít nejvýš 5 MB.');
 const file=(await req.formData()).get('file');if(!(file instanceof File))throw Error('Chybí obrázek.');
 const err=checkUpload({type:file.type,size:file.size},0);if(err)throw Error(err);
 const d=db();if(await countPlanFiles(d,u.id)>=PLAN_FILES_MAX)throw Error(`Nejvýš ${PLAN_FILES_MAX} obrázků k plánům.`);
 const key=`plans/${u.id}/${crypto.randomUUID()}`,id='plf_'+crypto.randomUUID().replace(/-/g,'').slice(0,24),name=file.name.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,120)||'obrazek',bucket=runtime().BUCKET;
 await bucket.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type}});
 try{await addPlanFile(d,{id,userId:u.id,r2Key:key,name,size:file.size,type:file.type})}catch(e){await bucket.delete(key).catch(()=>{});throw e}
 return Response.json({ok:true,file:{id,name,url:'/api/plan-files/'+id}},{headers:{'Cache-Control':'no-store'}})}catch(e){return failed(e)}}
