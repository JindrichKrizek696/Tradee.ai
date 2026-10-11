// Kontrola dat grafu: node --experimental-strip-types scripts/check-chart.mjs
import {parseYahoo,toH4,stale,TF_SOURCE} from '../lib/chart/candles.ts';
import {getCandles} from '../lib/chart/store.ts';
import {heikinAshi,seriesData,isChartType,CHART_TYPES} from '../lib/chart/chart-types.ts';
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
// ---- vrstvy grafu
{const {snapTo,newsLayer,tradeMarkers,scoreBand,sessionBands,withAlpha,instrumentMarkets,sortMarkers}=await import('../lib/chart/layers.ts');
const T=[0,3600,7200,10800,86400];
check('layers: snap uvnitř svíčky',snapTo(T,3600,4000)===3600,snapTo(T,3600,4000));
check('layers: snap v mezeře → další svíčka',snapTo(T,3600,20000)===86400,snapTo(T,3600,20000));
check('layers: snap mimo rozsah',snapTo(T,3600,-1)===null&&snapTo(T,3600,90000)===null,null);
check('layers: trhy instrumentu',JSON.stringify([instrumentMarkets('EUR/USD'),instrumentMarkets('BTC-USD'),instrumentMarkets('^NDX'),instrumentMarkets('AAPL')])==='[["EUR","USD"],["BTC"],["INDEX"],["AAPL"]]',null);
const base=Date.UTC(2026,0,5,0)/1000,times=Array.from({length:24},(_,i)=>base+i*3600),at=h=>new Date((base+h*3600-3600)*1000).toISOString(); // zima: Praha = UTC+1
const ev=[{id:'a',at:at(14.5),timeKnown:true,title:'CPI',markets:['USD'],signal:3,global:false},{id:'b',at:at(10),timeKnown:true,title:'GBP x',markets:['GBP'],signal:3,global:false},{id:'c',at:at(9),timeKnown:true,title:'slabá',markets:['EUR'],signal:1,global:false},{id:'d',at:at(8),timeKnown:true,title:'FOMC',markets:[],signal:2,global:true}];
const nl=newsLayer(ev,'EUR/USD',times,3600);
check('layers: zprávy – měny páru, signál ≥ 2, globální',nl.map(n=>n.event.id).join()==='a,d'&&nl[0].time===base+14*3600,nl);
const tr=[{id:'mt:1',side:'buy',openTs:(base+2*3600-3600)*1000+60000,closeTs:(base+5*3600-3600)*1000,date:'2026-01-05',openPrice:1.1,closePrice:1.2,pnl:50,currency:'USD',r:1.5,source:'mt'},{id:'m:1',side:null,openTs:null,closeTs:0,date:'2026-01-05',openPrice:null,closePrice:null,pnl:-10,currency:'USD',r:null,source:'manual'}];
const tm=sortMarkers(tradeMarkers(tr,times,3600,{bull:'#0f0',bear:'#f00'}));
check('layers: obchod = vstup ▲ + výstup, ruční kroužek na začátku dne',tm.length===3&&tm[0].time===base&&tm[0].shape==='circle'&&tm[1].shape==='arrowUp'&&tm[1].time===base+2*3600&&tm[1].price===1.1&&tm[2].text==='+1,5 R',tm);
const sb=scoreBand([{at:at(3.5),score:40},{at:at(6),score:-80}],times,3600,{bull:'#00ff00',bear:'#ff0000'});
check('layers: pás skóre schodovitě, mezera před prvním snímkem',sb[2].value===undefined&&sb[3].value===40&&sb[5].value===40&&sb[6].value===-80&&sb[6].color==='rgba(255,0,0,0.85)',sb.slice(2,7));
const ses=sessionBands(times,.1);
check('layers: seance podle pražské hodiny',ses[3].color===withAlpha('#f59e0b',.1)&&ses[9].color===withAlpha('#3b82f6',.1)&&ses[14].color===withAlpha('#8b5cf6',.1)&&ses[18].color===withAlpha('#10b981',.1)&&ses[23].value===undefined,ses.map(s=>s.color));
check('layers: alfa barvy',withAlpha('#abc',.5)==='rgba(170,187,204,0.5)'&&withAlpha('rgb(1, 2, 3)',.2)==='rgba(1,2,3,0.2)',null);}
// typy grafu a Heikin-Ashi
const hb=[{time:1,open:10,high:12,low:9,close:11},{time:2,open:11,high:14,low:10,close:13},{time:3,open:13,high:13.5,low:8,close:9}];
const ha=heikinAshi(hb);
check('HA: první svíčka',ha[0].open===10.5&&ha[0].close===10.5&&ha[0].high===12&&ha[0].low===9,ha[0]);
check('HA: open z předchozí HA svíčky',ha[1].open===10.5&&ha[1].close===12&&ha[1].high===14&&ha[1].low===10,ha[1]);
check('HA: high/low zahrnují HA open',ha[2].open===11.25&&ha[2].close===10.875&&ha[2].high===13.5&&ha[2].low===8&&ha[2].time===3,ha[2]);
check('HA: high ≥ max(open,close), low ≤ min',heikinAshi([{time:1,open:5,high:5,low:5,close:5},{time:2,open:1,high:1.2,low:0.9,close:1}]).every(b=>b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)));
check('HA: prázdný vstup',heikinAshi([]).length===0);
check('typy: čára a plocha jen close',seriesData(hb,'line')[1].value===13&&!('open' in seriesData(hb,'area')[0]));
check('typy: svíčky beze změny, HA přepočteno',seriesData(hb,'candles')[2].close===9&&seriesData(hb,'bars')[0].open===10&&seriesData(hb,'ha')[1].close===12);
check('typy: seznam a validace',CHART_TYPES.length===6&&isChartType('hollow')&&!isChartType('footprint')&&!isChartType(5));
if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
