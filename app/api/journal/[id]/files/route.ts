import {runtime,identity,db,failed,sameOrigin} from '@/lib/server';
import {parseJournalId,checkUpload,MAX_FILE_BYTES} from '@/lib/journal/rows';
import {countFiles,addFile,ownFile,deleteFile} from '@/lib/journal/store';
import {ownsTrade} from '@/lib/journal/record-store';
type Ctx={params:Promise<{id:string}>};
const notFound=()=>Response.json({error:'Obchod nenalezen.'},{status:404,headers:{'Cache-Control':'no-store'}});
export async function POST(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),id=parseJournalId((await params).id);
 // MT pozice: position_id = id pozice; ruční zápis: position_id = man:<id> (stejné úložiště screenshotů)
 if(!id)return notFound();const pid=id.kind==='mt'?id.id:'man:'+id.id;
 const d=db();if(!await ownsTrade(d,u.id,{kind:id.kind,id:id.id}))return notFound();
 if(Number(req.headers.get('content-length')||0)>MAX_FILE_BYTES+65536)throw Error('Obrázek může mít nejvýš 5 MB.');
 const file=(await req.formData()).get('file');if(!(file instanceof File))throw Error('Chybí obrázek.');
 const err=checkUpload({type:file.type,size:file.size},await countFiles(d,pid));if(err)throw Error(err);
 const key=`journal/${u.id}/${crypto.randomUUID()}`,fid='mpf_'+crypto.randomUUID().replace(/-/g,'').slice(0,24),name=file.name.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,120)||'screenshot',bucket=runtime().BUCKET;
 await bucket.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type}});
 try{await addFile(d,{id:fid,positionId:pid,userId:u.id,r2Key:key,name,size:file.size,type:file.type})}catch(e){await bucket.delete(key).catch(()=>{});throw e}
 return Response.json({ok:true,file:{id:fid,name,size:file.size,type:file.type}})}catch(e){return failed(e)}}
export async function DELETE(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),id=parseJournalId((await params).id);if(!id)return notFound();
 const {fileId}=await req.json() as {fileId?:unknown};if(typeof fileId!=='string')throw Error('Chybí screenshot.');
 const d=db(),f=await ownFile(d,u.id,fileId);if(!f||f.position_id!==(id.kind==='mt'?id.id:'man:'+id.id))return notFound();
 await deleteFile(d,fileId);await runtime().BUCKET.delete(f.r2_key).catch(e=>console.error('journal r2 delete',f.r2_key,e));
 return Response.json({ok:true})}catch(e){return failed(e)}}
