// Odeslání upozornění na výzvy ke zdůvodnění (push + mail), z cronu každých 5 min přes scripts/notify.sh.
// Výstup jen souhrn (počty); klíče ani adresy se nevypisují.
import {readFileSync} from 'node:fs';
import webpush from 'web-push';
import {createDb} from '../lib/mysql.ts';
import {pushPayload,mailContent,dueForMail,pushEndpoint} from '../lib/discipline/notify.ts';
const load=f=>{try{return Object.fromEntries(readFileSync(new URL('../'+f,import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^(["'])(.*)\1$/,'$2')]))}catch{return {}}};
const env={...load('.mariadb.env'),...load('.notify.env')};
const d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
const now=()=>new Date().toISOString().slice(0,19).replace('T',' ');
const sqlMs=s=>{if(!s)return null;const t=Date.parse(String(s).replace(' ','T')+'Z');return Number.isFinite(t)?t:null};
const pushOn=!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT),mailOn=!!env.RESEND_API_KEY;
if(pushOn)webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);else console.log('push vypnutý – chybí VAPID klíče');
if(!mailOn)console.log('mail vypnutý – chybí klíč');
const rows=(await d.prepare("SELECT v.id,v.user_id,v.trade_id,v.rule,v.detail,v.notified_mail,v.notified_push,p.symbol,p.net,a.currency,m.email,m.name,COALESCE(n.mail,1) AS s_mail,COALESCE(n.push,0) AS s_push,n.last_mail FROM trade_violations v JOIN mt_positions p ON v.trade_id=CONCAT('mt:',p.id) JOIN mt_accounts a ON a.id=p.account_id AND a.user_id=v.user_id JOIN members m ON m.id=v.user_id LEFT JOIN notify_settings n ON n.user_id=v.user_id WHERE v.needs_reason=1 AND v.reason_code IS NULL AND v.created>=UTC_TIMESTAMP()-INTERVAL 7 DAY AND (v.notified_push IS NULL OR v.notified_mail IS NULL) ORDER BY v.user_id,v.id LIMIT 500").all()).results;
const byUser=new Map();for(const r of rows){if(!byUser.has(r.user_id))byUser.set(r.user_id,[]);byUser.get(r.user_id).push(r)}
let mailBlocked=false;
const S={users:byUser.size,push:0,pushGone:0,pushFail:0,mails:0,mailItems:0,mailFail:0,errors:0};
const item=r=>({id:Number(r.id),tradeId:r.trade_id,rule:r.rule,trade:{symbol:r.symbol,net:r.net===null?null:Number(r.net),currency:r.currency||null}});
// označení „vezmu si to“: jen když porušení stále čeká a nikdo jiný ho neoznačil (druhý běh ani pozdní zdůvodnění nic nepošlou)
const claim=async(col,id)=>(await d.prepare(`UPDATE trade_violations SET ${col}=? WHERE id=? AND ${col} IS NULL AND reason_code IS NULL`).bind(now(),id).run()).meta.changes>0;
for(const [userId,list] of byUser){try{
 const first=list[0],wantPush=Number(first.s_push)===1,wantMail=Number(first.s_mail)===1;
 // push: jedno upozornění na porušení, do všech zařízení; vypnutý push / žádný odběr = jen označit
 if(pushOn){
  const todo=list.filter(r=>!r.notified_push);
  const subs=wantPush&&todo.length?(await d.prepare('SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?').bind(userId).all()).results:[];
  const dead=new Set();
  for(const r of todo){
   if(!await claim('notified_push',r.id))continue;
   const body=JSON.stringify(pushPayload(item(r)));
   for(const s of subs){if(dead.has(s.id))continue;
    if(!pushEndpoint(s.endpoint)){dead.add(s.id);S.pushGone++;await d.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(s.id).run();continue}
    try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},body,{TTL:86400,urgency:'high',timeout:10000});S.push++;await d.prepare('UPDATE push_subscriptions SET last_ok=? WHERE id=?').bind(now(),s.id).run()}
    catch(e){if(e?.statusCode===404||e?.statusCode===410){dead.add(s.id);S.pushGone++;await d.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(s.id).run()}else S.pushFail++}}
  }
 }
 // mail: s vypnutým mailem jen označit; jinak jeden mail se vším čekajícím, nejvýš 1/h
 const mailTodo=list.filter(r=>!r.notified_mail);
 if(mailTodo.length&&!wantMail){for(const r of mailTodo)await claim('notified_mail',r.id)}
 else if(mailTodo.length&&mailOn&&!mailBlocked&&first.email&&dueForMail(sqlMs(first.last_mail),Date.now())){
  const claimed=[];for(const r of mailTodo)if(await claim('notified_mail',r.id))claimed.push(r);
  if(claimed.length){
   const prev=first.last_mail||null;await d.prepare('INSERT INTO notify_settings(user_id,last_mail,updated) VALUES(?,?,?) ON DUPLICATE KEY UPDATE last_mail=VALUES(last_mail),updated=VALUES(updated)').bind(userId,now(),now()).run();
   const m=mailContent(first.name||'',claimed.map(item));let ok=false,client=false;
   try{const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({from:env.MAIL_FROM||'Tradee <info@dejny.eu>',to:[first.email],subject:m.subject,html:m.html,text:m.text})});ok=res.ok;client=res.status>=400&&res.status<500}catch{}
   if(ok){S.mails++;S.mailItems+=claimed.length}
   else{S.mailFail++;// nepodařilo se: vrátit označení i čas posledního mailu, příští běh to zkusí znovu
    for(const r of claimed)await d.prepare('UPDATE trade_violations SET notified_mail=NULL WHERE id=?').bind(r.id).run();
    if(client)mailBlocked=true;else await d.prepare('UPDATE notify_settings SET last_mail=? WHERE user_id=?').bind(prev,userId).run()}
  }
 }
}catch(e){S.errors++;console.log('chyba u uživatele (přeskočen):',e?.code||e?.name||'neznámá')}}
console.log(`notify ${new Date().toISOString()} ${JSON.stringify(S)}`);
process.exit(0);
