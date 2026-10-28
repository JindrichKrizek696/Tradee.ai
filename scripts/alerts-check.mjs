// Kontrola cenových alertů (cena, % změna dnes, skóre Tradee) → push + e-mail (podle alertu a Nastavení → Upozornění) + testovací push. Cron na VPS každou minutu:
// * * * * * cd /home/ubuntu/tradee && . /home/ubuntu/.nvm/nvm.sh && nvm use 22 >/dev/null && node --experimental-strip-types scripts/alerts-check.mjs >> /home/ubuntu/tradee/alerts.log 2>&1
// Prostředí z .mariadb.env + .notify.env (VAPID_*, RESEND_API_KEY, MAIL_FROM) jako scripts/notify.mjs. Zámek /tmp/tradee-alerts.lock (souběžný běh skončí hned),
// tvrdý limit běhu 50 s. Ceny jen pro trhy s aktivním alertem: Yahoo 1m (bez pre/post), krypto Binance; zavřený trh se přeskočí.
//   --dry                      nic nezapisuje ani neposílá (ceny z DB alertů se stáhnou a vypíše se, co by se stalo)
//   --dry --fixture <soubor>   bez DB i sítě: alerty, ceny a skóre z JSON (ukázka: scripts/fixtures/alerts-fixture.json)
// Výstup jen souhrn a spuštěné alerty; klíče ani adresy se nevypisují.
import {readFileSync,openSync,writeSync,closeSync,unlinkSync,statSync} from 'node:fs';
import {runCheck} from '../lib/alerts/engine.ts';
import {pushPayload,mailContent,SITE} from '../lib/alerts/logic.ts';
import {scenarioLink} from '../lib/strategy/scenario.ts';
import {fetchQuotes} from '../lib/alerts/quotes.ts';
import {isMarketOpen} from '../lib/market-hours.ts';
import {instruments} from '../lib/markets.ts';
const args=process.argv.slice(2),dry=args.includes('--dry'),fx=args.includes('--fixture')?args[args.indexOf('--fixture')+1]:null;
const META=new Map(instruments.map(i=>[i.id,{name:i.name,group:i.group}]));
// ---- zámek a limit běhu
const LOCK='/tmp/tradee-alerts.lock';
let locked=false;
if(!fx){
 try{const fd=openSync(LOCK,'wx');writeSync(fd,String(process.pid));closeSync(fd);locked=true}
 catch{let stale=false;try{const pid=Number(readFileSync(LOCK,'utf8'));stale=Date.now()-statSync(LOCK).mtimeMs>120000;if(!stale){try{process.kill(pid,0)}catch{stale=true}}}catch{stale=true}
  if(!stale){console.log(`alerts ${new Date().toISOString()} přeskočeno – běží předchozí kontrola`);process.exit(0)}
  try{unlinkSync(LOCK)}catch{}try{const fd=openSync(LOCK,'wx');writeSync(fd,String(process.pid));closeSync(fd);locked=true}catch{process.exit(0)}}
}
const unlock=()=>{if(locked){try{unlinkSync(LOCK)}catch{}locked=false}};
process.on('exit',unlock);
setTimeout(()=>{console.log(`alerts ${new Date().toISOString()} timeout 50 s – ukončeno`);process.exit(2)},50000).unref();

const sqlT=ms=>new Date(ms).toISOString().slice(0,19).replace('T',' ');
const now=fx?Date.parse(JSON.parse(readFileSync(fx,'utf8')).now||new Date().toISOString()):Date.now();
// ---- skóre Tradee (jen když je nějaký alert na skóre): stejný výpočet jako aplikace z data/*.json
let scoreCtx=null;
async function makeScore(){
 const {marketScore}=await import('../lib/markets.ts');
 const read=n=>JSON.parse(readFileSync(new URL('../data/'+n,import.meta.url),'utf8'));
 const data={...read('fundamentals.json'),ffMacro:read('ff-macro.json'),tePmi:read('te-pmi.json'),retailOfficial:read('retail-official.json')},core=read('score-market.json'),extra=read('expanded-market.json');
 const market={...core,prices:{...core.prices,...extra.prices},legacy:extra.legacy};
 return id=>{try{const s=marketScore(data,market,id,now).score;return typeof s==='number'&&Number.isFinite(s)?s:null}catch{return null}};
}

let deps;
if(fx){
 // ---- fixture: vše v paměti
 const F=JSON.parse(readFileSync(fx,'utf8')),mem=F.alerts.map(a=>({lastPrice:null,lastChecked:null,lastTriggered:null,cooldownMin:null,expiresAt:null,note:null,pct:null,op:null,level:null,ended:null,active:true,channels:['push','mail'],created:0,updated:0,...a,lastChecked:a.lastChecked?Date.parse(a.lastChecked):null,lastTriggered:a.lastTriggered?Date.parse(a.lastTriggered):null,expiresAt:a.expiresAt?Date.parse(a.expiresAt):null}));
 let evId=0;
 deps={now,loadAlerts:async()=>mem,
  fetchQuotes:async ids=>({quotes:new Map(ids.map(id=>[id,F.quotes?.[id]?{...F.quotes[id],bars:(F.quotes[id].bars||[]).map(b=>({...b,t:typeof b.t==='string'?Date.parse(b.t):b.t}))}:null])),errors:ids.filter(id=>!F.quotes?.[id]).map(id=>id+': ve fixture chybí')}),
  scoreOf:id=>F.scores?.[id]??null,meta:id=>META.get(id)??null,isOpen:(id,g,t)=>isMarketOpen(id,g,t),
  expire:async a=>{console.log(`  vypršel  ${a.id}`);return true},
  touch:async(a,v)=>{console.log(`  kontrola ${a.id} (${a.instrument} ${a.kind}) → ${v}, beze spuštění`)},
  claim:async()=>true,record:async()=>++evId,
  deliver:async(a,f)=>{const p=pushPayload(f),m=mailContent(a.name||'',f);console.log(`  PUSH  ${JSON.stringify(p)}`);console.log(`  MAIL  ${m.subject}\n        ${m.text.split('\n').join('\n        ')}`);return {push:null,mail:null}},
  delivered:async()=>{},log:l=>console.log('▶ '+l)};
}else{
 // ---- DB, push a mail
 const load=f=>{try{return Object.fromEntries(readFileSync(new URL('../'+f,import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^(["'])(.*)\1$/,'$2')]))}catch{return {}}};
 const env={...load('.mariadb.env'),...load('.notify.env')};
 const {createDb}=await import('../lib/mysql.ts');
 const {rowToAlert}=await import('../lib/alerts/store.ts');
 const {pushEndpoint}=await import('../lib/discipline/notify.ts');
 const {prefRowsFor,gateAlert,defaultPrefs}=await import('../lib/notify/prefs.ts');
 const d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
 const pushOn=!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT),mailOn=!!env.RESEND_API_KEY;
 let webpush=null;if(pushOn&&!dry){webpush=(await import('web-push')).default;webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY)}
 const needScore=async()=>{if(!scoreCtx)scoreCtx=await makeScore();return scoreCtx};
 // scenario_id: alert propojený se scénářem → upozornění otevře scénář (bez migrace 0036 dotaz bez scénářů)
 const rows=await d.prepare("SELECT a.*,m.email,m.name AS member_name,(SELECT s.id FROM scenarios s WHERE s.alert_id=a.id AND s.user_id=a.user_id ORDER BY s.updated DESC LIMIT 1) AS scenario_id FROM price_alerts a LEFT JOIN members m ON m.id=a.user_id WHERE a.active=1 LIMIT 5000").all().then(r=>r.results)
  .catch(async()=>(await d.prepare("SELECT a.*,m.email,m.name AS member_name FROM price_alerts a LEFT JOIN members m ON m.id=a.user_id WHERE a.active=1 LIMIT 5000").all()).results);
 const loaded=rows.map(r=>({...rowToAlert(r),email:r.email??null,name:r.member_name??null,_updated:r.updated,scenarioId:r.scenario_id??null}));
 const scoreFn=loaded.some(a=>a.kind==='score')?await needScore():()=>null;
 // Nastavení → Upozornění → Cenové alerty: push / e-mail jde ven jen když ho má alert vybraný A uživatel ho nevypnul (bez řádku vše zapnuto)
 const aPrefs=await prefRowsFor(d,'alerts',loaded.map(a=>a.userId)),gate=a=>gateAlert(a.channels,aPrefs.get(a.userId)??defaultPrefs().alerts);
 // push na všechna zařízení uživatele; mrtvé odběry pryč. Vrací {subs, ok}
 const sendPush=async(userId,body,ttl)=>{
  const subs=(await d.prepare('SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?').bind(userId).all()).results;let ok=0;
  for(const s of subs){
   if(!pushEndpoint(s.endpoint)){await d.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(s.id).run();continue}
   try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},body,{TTL:ttl,urgency:'high',timeout:10000});ok++;await d.prepare('UPDATE push_subscriptions SET last_ok=? WHERE id=?').bind(sqlT(Date.now()),s.id).run()}
   catch(e){if(e?.statusCode===404||e?.statusCode===410)await d.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(s.id).run()}
  }
  return {subs:subs.length,ok};
 };
 // testovací push z Nastavení (POST /api/notify/test zapíše žádost, nejvýš 1/min); kategorie se neřeší – testuje se zařízení
 if(!dry){try{
  const tests=(await d.prepare('SELECT user_id FROM notify_tests WHERE done IS NULL AND requested>=UTC_TIMESTAMP()-INTERVAL 10 MINUTE LIMIT 50').all()).results;
  for(const t of tests){
   if(!(await d.prepare('UPDATE notify_tests SET done=? WHERE user_id=? AND done IS NULL').bind(sqlT(Date.now()),t.user_id).run()).meta.changes)continue;
   const r=pushOn?await sendPush(t.user_id,JSON.stringify({title:'Tradee · test upozornění',body:'Push funguje – takhle ti dorazí alerty a další upozornění.',url:'https://tradee.eu/nastaveni#upozorneni',tag:'tradee-test'}),600):{ok:0};
   await d.prepare('UPDATE notify_tests SET sent=? WHERE user_id=?').bind(r.ok,t.user_id).run();
   console.log(`test push: ${r.ok} zařízení`);
  }
 }catch(e){if(!/notify_tests/.test(String(e?.message)))console.log('test push chyba:',e?.code||e?.name||'neznámá')}}
 deps={now,loadAlerts:async()=>loaded,
  fetchQuotes:(ids,lim)=>fetchQuotes(ids,fetch,{concurrency:4,limitMin:lim}),
  scoreOf:scoreFn,meta:id=>META.get(id)??null,isOpen:(id,g,t)=>isMarketOpen(id,g,t),
  // podmínka updated=? : uživatel mezitím alert upravil → tento běh ho nechá být (jeho úprava vynulovala poslední kontrolu)
  expire:async a=>dry?true:(await d.prepare("UPDATE price_alerts SET active=0,ended='expired' WHERE id=? AND active=1 AND updated=?").bind(a.id,a._updated).run()).meta.changes>0,
  touch:async(a,v)=>{if(!dry)await d.prepare('UPDATE price_alerts SET last_price=?,last_checked=? WHERE id=? AND active=1 AND updated=?').bind(v,sqlT(now),a.id,a._updated).run()},
  claim:async(a,s)=>dry?true:(await d.prepare(`UPDATE price_alerts SET last_price=?,last_checked=?,last_triggered=?${s.oneShot?",active=0,ended='triggered'":''} WHERE id=? AND active=1 AND updated=? AND ${a.lastTriggered===null?'last_triggered IS NULL':'last_triggered=?'}`).bind(s.value,sqlT(now),sqlT(now),a.id,a._updated,...(a.lastTriggered===null?[]:[sqlT(a.lastTriggered)])).run()).meta.changes>0,
  record:async(a,s,label)=>dry?0:Number((await d.prepare('INSERT INTO alert_events(alert_id,user_id,at,price,instrument,label) VALUES(?,?,?,?,?,?)').bind(a.id,a.userId,sqlT(now),s.price,a.instrument,label.slice(0,200)).run()).meta.last_row_id),
  deliver:async(a,f0)=>{
   const res={push:null,mail:null},f=a.scenarioId?{...f0,link:scenarioLink(SITE,a.scenarioId)}:f0;
   if(dry){console.log('  (dry) push+mail by odešel: '+pushPayload(f).title);return res}
   const g=gate(a);
   if(g.push&&pushOn){const r=await sendPush(a.userId,JSON.stringify(pushPayload(f)),3600);res.push=r.subs?r.ok>0:false}
   else if(g.push)res.push=false;
   if(g.mail&&mailOn&&a.email){
    const m=mailContent(a.name||'',f);
    try{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({from:env.MAIL_FROM||'Tradee <info@dejny.eu>',to:[a.email],subject:m.subject,html:m.html,text:m.text})});res.mail=r.ok}catch{res.mail=false}
   }else if(g.mail)res.mail=false;
   return res;
  },
  delivered:async(id,r)=>{if(!dry&&id)await d.prepare('UPDATE alert_events SET delivered_push=?,delivered_mail=? WHERE id=?').bind(r.push===null?null:r.push?1:0,r.mail===null?null:r.mail?1:0,id).run()},
  log:l=>console.log(l)};
}
try{
 const S=await runCheck(deps);
 console.log(`alerts ${new Date(now).toISOString()}${dry?' (dry)':''} ${JSON.stringify({...S,errors:S.errors.length})}${S.errors.length?' · chyby: '+S.errors.slice(0,10).join('; '):''}`);
}catch(e){console.log(`alerts ${new Date().toISOString()} chyba: ${e?.code||e?.message||'neznámá'}`);unlock();process.exit(1)}
unlock();process.exit(0);
