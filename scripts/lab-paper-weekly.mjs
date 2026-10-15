// Laboratoř · Simulace: týdenní souhrn všech variant A/B/C/D i S01… ze sweepu – jen VLASTNÍKOVI (OWNER_EMAIL), nikomu jinému.
// Každou neděli v 18:00 Europe/Prague: (a) Web Push na odběry vlastníka (push_subscriptions jeho members.id, VAPID z .notify.env),
// (b) e-mail přes Resend (RESEND_API_KEY, MAIL_FROM z .notify.env; výchozí odesílatel Tradee <info@dejny.eu>) na OWNER_EMAIL,
// (c) text do lab_paper_log (variant '*') a do „Shrnutí pro AI“ (lab_summary přes refreshSummary).
//
// Cron na VPS (crontab je v UTC → spouští se v 16:00 i 17:00 UTC, skript sám pustí jen běh, kdy je v Praze 18:00 – letní i zimní čas):
//   0 16,17 * * 0 cd ~/tradee && OWNER_EMAIL="$(grep '^OWNER_EMAIL=' .auth.env | cut -d= -f2- | tr -d '"\r')" node --experimental-strip-types scripts/lab-paper-weekly.mjs >> ~/logs/lab-paper-weekly.log 2>&1
//   (s nvm: source ~/.nvm/nvm.sh && nvm use 22 před node)
// node --experimental-strip-types scripts/lab-paper-weekly.mjs [--dry] [--force] [--owner-email x@y]
//   --dry = nic neposílá ani neukládá, jen vypíše push, předmět a text e-mailu; --force = bez kontroly neděle 18:00 a duplicity.
// Výstup jen souhrn; klíče se nevypisují.
import {readFileSync} from 'node:fs';
import {weeklySummary} from '../lib/lab/paper-weekly.ts';

const args=process.argv.slice(2),dry=args.includes('--dry'),force=args.includes('--force'),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
const load=f=>{try{return Object.fromEntries(readFileSync(new URL('../'+f,import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^(["'])(.*)\1$/,'$2')]))}catch{return {}}};
const env={...load('.auth.env'),...load('.mariadb.env'),...load('.notify.env')};
const now=Date.now();
const prague=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',weekday:'short',hour:'2-digit',hour12:false}).formatToParts(new Date(now));
const wd=prague.find(p=>p.type==='weekday')?.value,hour=Number(prague.find(p=>p.type==='hour')?.value);
if(!dry&&!force&&!(wd==='Sun'&&hour===18)){console.log(`lab-paper-weekly: v Praze není neděle 18:00 (${wd} ${hour}:00) – nic nedělám`);process.exit(0)}
if(!env.MARIADB_HOST){console.error('lab-paper-weekly: chybí .mariadb.env');process.exit(dry?0:1)}

const ownerEmail=(opt('--owner-email')||process.env.OWNER_EMAIL||env.OWNER_EMAIL||'').trim().toLowerCase();
if(!ownerEmail){console.log('lab-paper-weekly: chybí OWNER_EMAIL – nic nedělám');process.exit(0)}
const {createDb}=await import('../lib/mysql.ts');
const d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
const owner=await d.prepare('SELECT id,email FROM members WHERE LOWER(email)=?').bind(ownerEmail).first();
if(!owner||String(owner.email).trim().toLowerCase()!==ownerEmail){console.log('lab-paper-weekly: vlastník nenalezen – nic nedělám');process.exit(0)}
const uid=owner.id;
const ps=await import('../lib/lab/paper-store.ts');
if(!force&&!dry){const last=await ps.lastWeekly(d,uid);if(last&&now-last.at<20*3600000){console.log('lab-paper-weekly: souhrn za tento týden už odešel');process.exit(0)}}
const {liveQuotes}=await import('../lib/live-store.ts');
const quotes={};for(const [id,q] of Object.entries((await liveQuotes(d).catch(()=>({quotes:{}}))).quotes))quotes[id]={price:q.price,marketTime:q.marketTime};
const all=await ps.paperAll(d,uid,quotes);
const s=weeklySummary(all.map(x=>({id:x.variant,name:x.V.name,started:x.account?.started??null,startEquity:x.account?.startEquity??100000,stats:x.stats,equity:x.equity,trades:x.trades,open:x.open})),now);

if(dry){
 console.log('PUSH  ',s.pushTitle,'|',s.pushBody);
 console.log('MAIL  ',ownerEmail.replace(/(.).*@/,'$1…@'),'|',s.subject,`| HTML ${s.html.length} znaků`);
 console.log('\n'+s.text);
 process.exit(0);
}

// (c) deník + shrnutí pro AI
await ps.addLog(d,uid,now,`Týdenní souhrn simulace\n${s.md}`,'*');
try{const {refreshSummary}=await import('../lib/lab/store.ts');await refreshSummary(d,uid)}catch(e){console.error('lab-paper-weekly: shrnutí pro AI',e.message)}
const S={push:0,pushGone:0,pushFail:0,mail:false};
// (a) push jen na odběry vlastníka
if(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT){
 const webpush=(await import('web-push')).default;
 const {pushEndpoint}=await import('../lib/discipline/notify.ts');
 webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
 const subs=(await d.prepare('SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?').bind(uid).all()).results;
 const body=JSON.stringify({title:s.pushTitle,body:s.pushBody,url:'https://tradee.eu/laborator#paper',tag:'lab-weekly'});
 for(const sub of subs){
  if(!pushEndpoint(sub.endpoint)){S.pushGone++;continue}
  try{await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},body,{TTL:86400,urgency:'normal',timeout:10000});S.push++}
  catch(e){if(e?.statusCode===404||e?.statusCode===410){S.pushGone++;await d.prepare('DELETE FROM push_subscriptions WHERE id=? AND user_id=?').bind(sub.id,uid).run()}else S.pushFail++}
 }
}else console.log('push vypnutý – chybí VAPID klíče');
// (b) e-mail jen na OWNER_EMAIL
if(env.RESEND_API_KEY){
 try{const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
  body:JSON.stringify({from:env.MAIL_FROM||'Tradee <info@dejny.eu>',to:[ownerEmail],subject:s.subject,html:s.html,text:s.text})});S.mail=res.ok;if(!res.ok)console.log('mail HTTP',res.status)}catch(e){console.log('mail chyba',e?.name||'neznámá')}
}else console.log('mail vypnutý – chybí klíč');
console.log(`lab-paper-weekly ${new Date(now).toISOString()} ${JSON.stringify(S)}`);
process.exit(0);
