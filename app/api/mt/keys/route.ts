import {identity,db,failed,sameOrigin} from '@/lib/server';
import {generateKey} from '@/lib/mt/keys';
import {nowSql} from '@/lib/mt/store';
const MAX_KEYS=10,nc={headers:{'Cache-Control':'private, no-store'}};
export async function GET(req:Request){try{const u=await identity(req);const r=await db().prepare('SELECT id,name,prefix,created,last_used FROM mt_keys WHERE user_id=? AND revoked IS NULL ORDER BY created').bind(u.id).all();return Response.json({keys:r.results},nc)}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);const b=await req.json().catch(()=>({})) as {name?:unknown};
 const name=typeof b.name==='string'?b.name.trim().slice(0,60):'';
 const n=await db().prepare('SELECT COUNT(*) AS n FROM mt_keys WHERE user_id=? AND revoked IS NULL').bind(u.id).first<{n:number}>();
 if(Number(n?.n)>=MAX_KEYS)throw Error(`Můžeš mít nejvýš ${MAX_KEYS} aktivních klíčů. Nějaký zruš.`);
 const k=await generateKey(),id='mtk_'+crypto.randomUUID().replace(/-/g,'').slice(0,24);
 await db().prepare('INSERT INTO mt_keys(id,user_id,name,key_hash,prefix,created) VALUES(?,?,?,?,?,?)').bind(id,u.id,name||'MetaTrader',k.hash,k.prefix,nowSql()).run();
 return Response.json({id,key:k.key,prefix:k.prefix},nc)}catch(e){return failed(e)}}
export async function DELETE(req:Request){try{sameOrigin(req);const u=await identity(req);const {id}=await req.json() as {id?:unknown};if(typeof id!=='string')throw Error('Chybí id klíče.');
 await db().prepare('UPDATE mt_keys SET revoked=? WHERE id=? AND user_id=? AND revoked IS NULL').bind(nowSql(),id,u.id).run();return Response.json({ok:true})}catch(e){return failed(e)}}
