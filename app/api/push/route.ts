import {identity,db,failed,sameOrigin} from '@/lib/server';
import {nowSql} from '@/lib/mt/store';
import {pushEndpoint} from '@/lib/discipline/notify';
const H={headers:{'Cache-Control':'private, no-store'}};
const B64=/^[A-Za-z0-9_-]+={0,2}$/,BAD='Neplatný odběr upozornění.';
const endpointOf=(v:unknown)=>{const e=pushEndpoint(v);if(!e)throw Error(BAD);return e};
const keyOf=(v:unknown)=>{if(typeof v!=='string'||!v||v.length>255||!B64.test(v))throw Error(BAD);return v};
// Odběr Web Push pro toto zařízení. Zapisuje se jen za přihlášeného uživatele (i admin za sebe).
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json() as {endpoint?:unknown;keys?:{p256dh?:unknown;auth?:unknown}};
 if(!b||typeof b!=='object'||!b.keys||typeof b.keys!=='object')throw Error(BAD);
 const endpoint=endpointOf(b.endpoint),p256dh=keyOf(b.keys.p256dh),auth=keyOf(b.keys.auth),now=nowSql(),d=db();
 const known=await d.prepare('SELECT id FROM push_subscriptions WHERE endpoint=?').bind(endpoint).first();
 if(!known){const mine=(await d.prepare('SELECT id FROM push_subscriptions WHERE user_id=? ORDER BY created DESC,id DESC').bind(u.id).all<{id:string}>()).results;for(const o of mine.slice(9))await d.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(o.id).run()}
 await d.prepare('INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),p256dh=VALUES(p256dh),auth=VALUES(auth)').bind('ps_'+crypto.randomUUID().replace(/-/g,'').slice(0,24),u.id,endpoint,p256dh,auth,now).run();
 await d.prepare('INSERT INTO notify_settings(user_id,push,updated) VALUES(?,1,?) ON DUPLICATE KEY UPDATE push=1,updated=VALUES(updated)').bind(u.id,now).run();
 return Response.json({ok:true},H)}catch(e){return failed(e)}}
export async function DELETE(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json() as {endpoint?:unknown};
 if(!b||typeof b!=='object')throw Error(BAD);
 await db().prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').bind(endpointOf(b.endpoint),u.id).run();
 return Response.json({ok:true},H)}catch(e){return failed(e)}}
