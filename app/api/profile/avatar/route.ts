import {runtime,identity,db,failed,sameOrigin} from '@/lib/server';
import {sniffImage,avatarUrl,AVATAR_PREFIX,AVATAR_MAX_BYTES} from '@/lib/profile/rules';
import {swapAvatar} from '@/lib/profile/store';
const drop=(key:string|null)=>key?runtime().BUCKET.delete(key).catch(e=>console.error('avatar r2 delete',key,e)):undefined;
// fotku ořízne a zmenší prohlížeč (čtverec 256 px); server hlídá velikost a typ podle obsahu souboru
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);
 if(Number(req.headers.get('content-length')||0)>AVATAR_MAX_BYTES+65536)throw Error('Fotka je moc velká.');
 const file=(await req.formData()).get('file');if(!(file instanceof File))throw Error('Chybí fotka.');
 if(file.size>AVATAR_MAX_BYTES)throw Error('Fotka je moc velká.');
 const bytes=new Uint8Array(await file.arrayBuffer()),type=sniffImage(bytes);if(!type)throw Error('Nahraj obrázek PNG, JPG nebo WebP.');
 const key=AVATAR_PREFIX+crypto.randomUUID(),bucket=runtime().BUCKET;
 await bucket.put(key,bytes,{httpMetadata:{contentType:type}});
 let old:string|null;try{old=await swapAvatar(db(),u.id,key)}catch(e){await bucket.delete(key).catch(()=>{});throw e}
 await drop(old);return Response.json({ok:true,avatar:avatarUrl(key)})}catch(e){return failed(e)}}
export async function DELETE(req:Request){try{sameOrigin(req);const u=await identity(req);await drop(await swapAvatar(db(),u.id,null));return Response.json({ok:true,avatar:null})}catch(e){return failed(e)}}
