// Kontrola dat grafu: node --experimental-strip-types scripts/check-chart.mjs
import {parseYahoo,toH4,stale,TF_SOURCE} from '../lib/chart/candles.ts';
import {getCandles} from '../lib/chart/store.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const t0=Date.UTC(2026,9,9,0,0)/1000;
const yj={chart:{result:[{timestamp:[t0,t0+3600,t0+7200,t0+10800],indicators:{quote:[{open:[1,2,null,4],high:[1.5,2.5,3,4.5],low:[0.5,1.5,2,3.5],close:[1.2,2.2,2.5,4.2]}]}}]}};
const p=parseYahoo(yj);
check('parse: null řádek vynechán',p.length===3&&p[0][0]===t0*1000&&p[2][0]===(t0+10800)*1000,p);
check('parse: pořadí OHLC',p[0].join()===[t0*1000,1,1.5,0.5,1.2].join(),p[0]);
check('parse: nepoužitelné → []',parseYahoo(null).length===0&&parseYahoo({chart:{result:null}}).length===0&&parseYahoo({chart:{result:[{}]}}).length===0);
const h=(hh,o,hi,lo,c,day=9)=>[Date.UTC(2026,9,day,hh),o,hi,lo,c];
const a=toH4([h(0,1,2,0.5,1.5),h(1,1.5,3,1,2),h(2,2,2.5,0.8,1.1),h(3,1.1,1.2,0.9,1.0),h(4,1,1.1,0.9,1.05)]);
check('H4: agregace OHLC',a.length===2&&a[0].join()===[Date.UTC(2026,9,9,0),1,3,0.5,1.0].join(),a);
const b=toH4([h(22,1,2,1,1.5,8),h(23,1.5,2.2,1.4,2,8),h(0,2,2.1,1.9,2.05,9),h(3,2.05,2.3,2,2.2,9)]);
check('H4: přes hranici dne',b.length===2&&b[0][0]===Date.UTC(2026,9,8,20)&&b[0][4]===2&&b[1][0]===Date.UTC(2026,9,9,0)&&b[1][1]===2&&b[1][4]===2.2,b);
const c=toH4([h(5,1,2,1,1.5),h(6,1.5,2,1,1.6)]);
check('H4: zarovnání 4/8',c.length===2&&c[0][0]===Date.UTC(2026,9,9,4)&&c[1][0]===Date.UTC(2026,9,9,4)+0===false||c.length===1&&c[0][0]===Date.UTC(2026,9,9,4),c);
const now=Date.UTC(2026,9,9,12);
check('stale H1 14 min čerstvé',!stale('H1',now-14*60000,now)&&stale('H1',now-15*60000,now)&&stale('H4',now-16*60000,now));
check('stale D1 6 h',!stale('D1',now-5*3600000,now)&&stale('D1',now-6*3600000,now)&&stale('D1',0,now));
check('zdroje',TF_SOURCE.H1.interval==='60m'&&TF_SOURCE.H4.aggregate&&TF_SOURCE.D1.range==='2y');
// store s falešnou DB
function fakeDb(){const rows=new Map();const st={rows,fetches:0};
 st.db={prepare(sql){const mk=params=>({bind:(...p)=>mk(p),
  async first(){if(/^SELECT data/.test(sql)){const r=rows.get(params[0]+'|'+params[1]);return r?{data:r.data,updated:r.updated}:null}return null},
  async all(){return {results:[]}},
  async run(){const k=params[params.length-2]+'|'+params[params.length-1];
   if(/^INSERT IGNORE/.test(sql)){if(!rows.has(params[0]+'|'+params[1]))rows.set(params[0]+'|'+params[1],{data:'[]',updated:'1970-01-02 00:00:00',fetching:null});return {meta:{changes:1}}}
   if(/SET fetching=\? WHERE/.test(sql)){const r=rows.get(params[1]+'|'+params[2]);if(r&&(r.fetching===null||r.fetching<params[3])){r.fetching=params[0];return {meta:{changes:1}}}return {meta:{changes:0}}}
   if(/SET data=/.test(sql)){const r=rows.get(params[2]+'|'+params[3]);r.data=params[0];r.updated=params[1];r.fetching=null;return {meta:{changes:1}}}
   if(/SET fetching=NULL/.test(sql)){rows.get(params[0]+'|'+params[1]).fetching=null;return {meta:{changes:1}}}
   return {meta:{changes:0}}}});return mk([])}};return st}
const f=fakeDb();const ok1=async()=>{f.fetches++;return [[1,1,2,0.5,1.5]]};
const bad=async()=>{throw new Error('x')};
let r=await getCandles(f.db,'EUR/USD','H1',now,bad);
check('store: bez cache a selhání → chyba',r.candles.length===0&&r.stale&&r.error==='Ceny teď nejsou k dispozici.',r);
r=await getCandles(f.db,'EUR/USD','H1',now,ok1);
check('store: fetch uloží',r.candles.length===1&&!r.stale&&f.fetches===1,r);
r=await getCandles(f.db,'EUR/USD','H1',now+60000,ok1);
check('store: čerstvá cache bez fetche',f.fetches===1&&!r.stale,r);
r=await getCandles(f.db,'EUR/USD','H1',now+20*60000,bad);
check('store: selhání → stará cache stale',r.candles.length===1&&r.stale,r);
const slow=()=>new Promise(res=>setTimeout(()=>{f.fetches++;res([[2,1,1,1,1]])},30));
const [x,y]=await Promise.all([getCandles(f.db,'EUR/USD','H1',now+40*60000,slow),getCandles(f.db,'EUR/USD','H1',now+40*60000,slow)]);
check('store: souběh = jeden fetch',f.fetches===2&&[x,y].filter(v=>v.stale).length===1,[x,y]);
r=await getCandles(f.db,'USD','H1',now,ok1);
check('store: měnový index nepodporován',r.unsupported===true&&r.candles.length===0,r);
if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
