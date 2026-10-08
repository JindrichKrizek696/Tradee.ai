// Živé ceny z Yahoo (15 min) → market_live, market_intraday. Cron přes scripts/refresh-live.sh.
// node --experimental-strip-types scripts/refresh-live.mjs [--dry]   (--dry = jen stáhne a vypíše, nic neukládá)
import {readFileSync} from 'node:fs';
import {instruments,fxCurrencies} from '../lib/markets.ts';
import {yahooSymbol,parseChart,changePct,currencyChange,currencySeries} from '../lib/live.ts';
const dry=process.argv.includes('--dry');
const UA='Mozilla/5.0'; // dlouhý Chrome UA Yahoo odmítá s HTTP 429 (neodpovídá TLS otisku Node/curl), krátký projde
async function chart(symbol){
 const ac=new AbortController(),t=setTimeout(()=>ac.abort(),10000);
 try{const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?range=1d&interval=15m',{headers:{'User-Agent':UA},signal:ac.signal});if(!r.ok)throw Error('HTTP '+r.status);return parseChart(await r.json())}
 finally{clearTimeout(t)}
}
const list=instruments.map(i=>({id:i.id,symbol:yahooSymbol(i.id,fxCurrencies)})).filter(x=>x.symbol);
const got={},fails=[];
for(let i=0;i<list.length;i+=6)await Promise.all(list.slice(i,i+6).map(async x=>{try{const c=await chart(x.symbol);if(!c)throw Error('prázdná odpověď');got[x.id]={...c,symbol:x.symbol}}catch(e){fails.push(x.id+': '+(e.name==='AbortError'?'timeout':e.message))}}));
// měnové indexy z párů
const fx=Object.fromEntries(Object.entries(got).filter(([id])=>id.includes('/')).map(([id,q])=>[id,{...q,changePct:changePct(q.price,q.prevClose)}]));
for(const c of fxCurrencies){
 const ch=currencyChange(c,fx);if(ch===null)continue;
 const mine=Object.entries(fx).filter(([id])=>id.split('/').includes(c)).map(([,q])=>q),mt=Math.max(...mine.map(q=>q.marketTime));
 const ss=mine.map(q=>q.sessionStart).filter(v=>v>0),sessionStart=ss.length?Math.min(...ss):null; // nejdřívější start seance z párů
 got[c]={symbol:'',price:100*(1+ch/100),prevClose:100,marketTime:mt,sessionStart,points:currencySeries(c,fx)};
}
if(dry){for(const [id,q] of Object.entries(got))console.log(id.padEnd(9),String(q.price).padEnd(12),changePct(q.price,q.prevClose)+' %',q.points.length+' bodů',q.points.every(p=>p[0]%900000===0)?'mřížka ok':'MIMO MŘÍŽKU','seance '+(q.sessionStart?new Date(q.sessionStart).toISOString().slice(5,16):'—'));console.log(`dry: ${Object.keys(got).length} trhů, chyby: ${fails.length?fails.join('; '):'žádné'}`);process.exit(0)}
let saved=0;
try{
const {createDb}=await import('../lib/mysql.ts');
const env=Object.fromEntries(readFileSync(new URL('../.mariadb.env',import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
const d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
const nowSql=new Date().toISOString().slice(0,19).replace('T',' ');
for(const [id,q] of Object.entries(got)){
 try{
  const ps=q.points.map(p=>p[1]),hi=ps.length?Math.max(...ps):null,lo=ps.length?Math.min(...ps):null;
  await d.prepare('INSERT INTO market_live(instrument,symbol,price,prev_close,change_pct,day_high,day_low,market_time,session_start,updated) VALUES(?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE symbol=VALUES(symbol),price=VALUES(price),prev_close=VALUES(prev_close),change_pct=VALUES(change_pct),day_high=VALUES(day_high),day_low=VALUES(day_low),market_time=VALUES(market_time),session_start=VALUES(session_start),updated=VALUES(updated)').bind(id,q.symbol,q.price,q.prevClose,changePct(q.price,q.prevClose),hi,lo,q.marketTime,q.sessionStart??null,nowSql).run();
  for(let i=0;i<q.points.length;i+=200){const ch=q.points.slice(i,i+200);await d.prepare('INSERT INTO market_intraday(instrument,ts,price) VALUES '+ch.map(()=>'(?,?,?)').join(',')+' ON DUPLICATE KEY UPDATE price=VALUES(price)').bind(...ch.flatMap(p=>[id,p[0],p[1]])).run()}
  saved++;
 }catch(e){fails.push(id+': DB '+e.message)}
}
await d.prepare('DELETE FROM market_intraday WHERE ts<?').bind(Date.now()-7*86400000).run();
}catch(e){fails.push('DB: '+e.message)}
console.log(`live ok: ${saved}/${list.length+fxCurrencies.length} uloženo${fails.length?' · chyby: '+fails.join('; '):''}`);
