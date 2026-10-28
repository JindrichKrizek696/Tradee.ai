import {identity,db,failed,sameOrigin} from '@/lib/server';
import {nowSql} from '@/lib/mt/store';
import {pushEndpoint} from '@/lib/discipline/notify';
import {deviceLabel,uaShort} from '@/lib/notify/prefs';
const H={headers:{'Cache-Control':'private, no-store'}};
const B64=/^[A-Za-z0-9_-]+={0,2}$/,BAD='Neplatný odběr upozornění.';
const endpointOf=(v:unknown)=>{const e=pushEndpoint(v);if(!e)throw Error(BAD);return e};
const keyOf=(v:unknown)=>{if(typeof v!=='string'||!v||v.length>255||!B64.test(v))throw Error(BAD);return v};
const ms=(s:unknown)=>s?Date.parse(String(s).replace(' ','T')+'Z'):null;
type Dev={id:string;endpoint:string;user_agent?:string|null;created:string;last_ok:string|null};
// Seznam zařízení s push (Nastavení → Upozornění). Endpoint se vrací jen vlastníkovi odběru, aby klient poznal „toto zařízení“.
export async function GET(req:Request){try{const u=await identity(req),d=db();
 let rows:Dev[];try{rows=(await d.prepare('SELECT id,endpoint,user_agent,created,last_ok FROM push_subscriptions WHERE user_id=? ORDER BY created DESC').bind(u.id).all<Dev>()).results}
 catch{rows=(await d.prepare('SELECT id,endpoint,created,last_ok FROM push_subscriptions WHERE user_id=? ORDER BY created DESC').bind(u.id).all<Dev>()).results}
 return Response.json({devices:rows.map(r=>({id:r.id,endpoint:r.endpoint,label:deviceLabel(r.user_agent,r.endpoint),created:ms(r.created),lastOk:ms(r.last_ok)}))},H)}catch(e){return failed(e)}}
// Odběr Web Push pro toto zařízení. Zapisuje se jen za přihlášeného uživatele (i admin za sebe).
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json() as {endpoint?:unknown;keys?:{p256dh?:unknown;auth?:unknown}};
 if(!b||typeof b!=='object'||!b.keys||typeof b.keys!=='object')throw Error(BAD);
 const endpoint=endpointOf(b.endpoint),p256dh=keyOf(b.keys.p256dh),auth=keyOf(b.keys.auth),now=nowSql(),d=db();
 const known=await d.prepare('SELECT id FROM push_subscriptions WHERE endpoint=?').bind(endpoint).first();
 if(!known){const mine=(await d.prepare('SELECT id FROM push_subscriptions WHERE user_id=? ORDER BY created DESC,id DESC').bind(u.id).all<{id:string}>()).results;for(const o of mine.slice(9))await d.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(o.id).run()}
 const sid='ps_'+crypto.randomUUID().replace(/-/g,'').slice(0,24),ua=uaShort(req.headers.get('user-agent'));
 try{await d.prepare('INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created,user_agent) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),p256dh=VALUES(p256dh),auth=VALUES(auth),user_agent=VALUES(user_agent)').bind(sid,u.id,endpoint,p256dh,auth,now,ua).run()}
 catch(e){if(!/user_agent/.test(String((e as Error)?.message)))throw e; // migrace 0034 ještě neproběhla
  await d.prepare('INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),p256dh=VALUES(p256dh),auth=VALUES(auth)').bind(sid,u.id,endpoint,p256dh,auth,now).run()}
 await d.prepare('INSERT INTO notify_settings(user_id,push,updated) VALUES(?,1,?) ON DUPLICATE KEY UPDATE push=1,updated=VALUES(updated)').bind(u.id,now).run();
 return Response.json({ok:true},H)}catch(e){return failed(e)}}
// DELETE {endpoint} (toto zařízení) nebo {id} (odebrání zařízení ze seznamu) – vždy jen vlastní odběr
export async function DELETE(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json() as {endpoint?:unknown;id?:unknown};
 if(!b||typeof b!=='object')throw Error(BAD);
 if(b.id!==undefined){if(typeof b.id!=='string'||!/^ps_[a-z0-9]{1,40}$/.test(b.id))throw Error(BAD);await db().prepare('DELETE FROM push_subscriptions WHERE id=? AND user_id=?').bind(b.id,u.id).run()}
 else await db().prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').bind(endpointOf(b.endpoint),u.id).run();
 return Response.json({ok:true},H)}catch(e){return failed(e)}}
