// Archiv svíček z Yahoo → market_bars (H1 ~2 roky, D1 celá historie). Cron přes scripts/bars-sync.sh.
// node --experimental-strip-types scripts/bars-sync.mjs [--backfill] [--dry] [instrument…]
import {readFileSync} from 'node:fs';
import {instruments,fxCurrencies} from '../lib/markets.ts';
import {yahooSymbol} from '../lib/live.ts';
import {parseBars,windows,incrementalPlan,planUrl} from '../lib/bars/yahoo.ts';
const args=process.argv.slice(2),backfill=args.includes('--backfill'),dry=args.includes('--dry'),only=args.filter(a=>!a.startsWith('--'));
const UA='Mozilla/5.0',DELAY=400,sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fetchPlan(symbol,plan){
 for(let attempt=0;;attempt++){
  const ac=new AbortController(),to=setTimeout(()=>ac.abort(),20000);
  try{
   const r=await fetch(planUrl(symbol,plan),{headers:{'User-Agent':UA},signal:ac.signal});
   if(r.status===429||r.status>=500){if(attempt>=3)throw Error('HTTP '+r.status);await sleep(1500*2**attempt);continue}
   if(!r.ok)throw Error('HTTP '+r.status);
   return parseBars(await r.json());
  }catch(e){
   if(e.message.startsWith('HTTP'))throw e;
   if(attempt>=3)throw Error(e.name==='AbortError'?'timeout':e.message);
   await sleep(1500*2**attempt);
  }finally{clearTimeout(to)}
 }
}
const list=instruments.map(i=>({id:i.id,symbol:yahooSymbol(i.id,fxCurrencies)})).filter(x=>x.symbol&&(!only.length||only.includes(x.id)));
let d=null;
if(!dry){
 const {createDb}=await import('../lib/mysql.ts');
 const env=Object.fromEntries(readFileSync(new URL('../.mariadb.env',import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
 d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
}
async function upsert(id,tf,bars){
 for(let i=0;i<bars.length;i+=1000){
  const ch=bars.slice(i,i+1000);
  await d.prepare('INSERT INTO market_bars(instrument,tf,t,o,h,l,c,v) VALUES '+ch.map(()=>'(?,?,?,?,?,?,?,?)').join(',')+' ON DUPLICATE KEY UPDATE o=VALUES(o),h=VALUES(h),l=VALUES(l),c=VALUES(c),v=VALUES(v)').bind(...ch.flatMap(b=>[id,tf,b.t,b.o,b.h,b.l,b.c,b.v])).run();
 }
}
const summary=[],errors=[];
for(const x of list)for(const tf of ['H1','D1']){
 try{
  let plans,before=0;
  if(backfill||dry)plans=windows(tf);
  else{const m=await d.prepare('SELECT last_t FROM market_bars_meta WHERE instrument=? AND tf=?').bind(x.id,tf).first();plans=incrementalPlan(tf,m&&m.last_t!==null?Number(m.last_t):null)}
  if(d){const c=await d.prepare('SELECT COUNT(*) n FROM market_bars WHERE instrument=? AND tf=?').bind(x.id,tf).first();before=Number(c.n)}
  let fetched=0;
  for(const p of plans){
   const {bars}=await fetchPlan(x.symbol,p);fetched+=bars.length;
   if(d&&bars.length)await upsert(x.id,tf,bars);
   await sleep(DELAY);
  }
  if(d){
   const s=await d.prepare('SELECT MIN(t) a,MAX(t) b,COUNT(*) n FROM market_bars WHERE instrument=? AND tf=?').bind(x.id,tf).first();
   await d.prepare('INSERT INTO market_bars_meta(instrument,tf,first_t,last_t,count,updated) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE first_t=VALUES(first_t),last_t=VALUES(last_t),count=VALUES(count),updated=VALUES(updated)').bind(x.id,tf,s.a===null?null:Number(s.a),s.b===null?null:Number(s.b),Number(s.n),new Date().toISOString().slice(0,19).replace('T',' ')).run();
   summary.push(`${x.id} ${tf} +${Number(s.n)-before}`);
  }else summary.push(`${x.id} ${tf} ${fetched}`);
 }catch(e){errors.push(`${x.id} ${tf}: ${e.message}`);await sleep(DELAY)}
}
console.log(`bars ${backfill?'backfill':dry?'dry':'sync'}: ${summary.join(' · ')}${errors.length?`\nchyby (${errors.length}): ${errors.join('; ')}`:''}`);
process.exit(errors.length&&!summary.length?1:0);
