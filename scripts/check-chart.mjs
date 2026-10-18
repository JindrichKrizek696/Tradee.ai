// Kontrola dat grafu: node --experimental-strip-types scripts/check-chart.mjs
import {parseYahoo,toH4,toH2,toW1,toMN,bucketAggregate,mergeTail,buildTf,stale,TF_SOURCE,TFS,TF_CAP,HISTORY_FROM,fixFxDailyOpen,withVolume,volumeKey,VOLUME_PROXY} from '../lib/chart/candles.ts';
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
check('zdroje',TF_SOURCE.H1.interval==='60m'&&TF_SOURCE.H4.agg==='H4'&&TF_SOURCE.D1.base==='D1'&&TF_SOURCE.M1.range==='7d'&&TF_SOURCE.M5.interval==='5m'&&TF_SOURCE.M30.interval==='30m');
check('TF sada a pořadí',TFS.join()==='M1,M5,M15,M30,H1,H2,H4,D1,W1,MN'&&TFS.every(t=>TF_CAP[t]<=3000&&TF_SOURCE[t]));
check('stale: M1 1 min, M5 3, M15/M30 5',stale('M1',now-60000,now)&&!stale('M1',now-59000,now)&&!stale('M5',now-179000,now)&&stale('M5',now-180000,now)&&stale('M30',now-5*60000,now)&&!stale('M15',now-299000,now)&&!stale('H2',now-14*60000,now)&&!stale('W1',now-5*3600000,now)&&stale('MN',now-6*3600000,now));
// H2: sudé hodiny UTC, neúplný poslední koš
const h2=toH2([h(0,1,2,.5,1.5),h(1,1.5,3,1,2),h(2,2,2.2,1.9,2.1),h(3,2.1,2.4,2,2.3),h(5,2.3,2.5,2.2,2.4)]);
check('H2: zarovnání na sudé hodiny + OHLC',h2.length===3&&h2[0].join()===[Date.UTC(2026,9,9,0),1,3,.5,2].join()&&h2[1][0]===Date.UTC(2026,9,9,2)&&h2[1][4]===2.3&&h2[2][0]===Date.UTC(2026,9,9,4)&&h2[2][4]===2.4,h2);
check('H2: lichá hodina začíná koš sudé',toH2([h(5,1,2,1,1.5)])[0][0]===Date.UTC(2026,9,9,4));
check('H4 = bucketAggregate po 4 h',JSON.stringify(bucketAggregate([h(5,1,2,1,1.5),h(6,1.5,2,1,1.6)],t=>Math.floor(t/14400000)*14400000))===JSON.stringify(toH4([h(5,1,2,1,1.5),h(6,1.5,2,1,1.6)])));
check('DST: letní/zimní přechod nemění UTC koše',toH4([[Date.UTC(2026,9,25,23),1,1,1,1],[Date.UTC(2026,9,26,0),1,1,1,1]]).length===2&&toH4([[Date.UTC(2026,9,25,22),1,1,1,1],[Date.UTC(2026,9,25,23),1,1,1,1]]).length===1);
// W1 / MN z denních svíček (FX: čas otevření 22:00 UTC předchozího dne)
const day=(y,m,d,o,hi,lo,c,hh=0)=>[Date.UTC(y,m-1,d,hh),o,hi,lo,c];
const d1=[day(2026,10,4,1,2,.9,1.5,22),day(2026,10,5,1.5,3,1,2,22),day(2026,10,6,2,2.5,1.8,2.2,22),day(2026,10,7,2.2,2.3,1.7,1.9,22),day(2026,10,8,1.9,2.1,1.5,1.6,22),day(2026,10,9,1.6,1.7,1.2,1.3,22),day(2026,10,11,1.3,1.4,1.1,1.2,22),day(2026,10,12,1.2,1.5,1.0,1.4,22)];
const w=toW1(d1);
check('W1: otevření v pondělí 00:00 UTC (i z 22:00 UTC neděle)',w.length===2&&w[0][0]===Date.UTC(2026,9,5)&&new Date(w[0][0]).getUTCDay()===1&&w[1][0]===Date.UTC(2026,9,12)&&w[1][1]===1.3,w);
check('W1: OHLC týdne',w[0].join()===[Date.UTC(2026,9,5),1,3,.9,1.3].join(),w[0]);
check('W1: neúplný poslední týden zůstává',w[1][2]===1.5&&w[1][3]===1.0&&w[1][4]===1.4,w[1]);
const wst=toW1([day(2026,10,7,1,2,1,1.5,13),day(2026,10,9,1.5,3,1,2,14)]);
check('W1: akcie 13:30 UTC ve správném týdnu',wst.length===1&&wst[0][0]===Date.UTC(2026,9,5),wst);
const mn=toMN([day(2026,9,29,1,2,1,1.5),day(2026,9,30,1.5,3,1,2),day(2026,10,1,2,2.5,1.5,2.2),day(2026,10,30,2.2,2.3,1,1.1),day(2026,11,2,1.1,1.2,1,1.15),day(2026,9,30,0,0,0,0,22)]);
check('MN: kalendářní měsíce 1. den 00:00 UTC',mn.length===3&&mn[0][0]===Date.UTC(2026,8,1)&&mn[1][0]===Date.UTC(2026,9,1)&&mn[2][0]===Date.UTC(2026,10,1),mn);
check('MN: OHLC měsíce a hranice (22:00 UTC 30.9. = 1.10.)',mn[1][1]===0&&mn[1][4]===1.1,mn[1]);
check('mergeTail: ocas přepíše archiv',JSON.stringify(mergeTail([[1,0,0,0,0],[2,0,0,0,0],[3,0,0,0,0]],[[3,1,1,1,1],[4,1,1,1,1]]))==='[[1,0,0,0,0],[2,0,0,0,0],[3,1,1,1,1],[4,1,1,1,1]]'&&mergeTail([[1,0,0,0,0]],[]).length===1);
check('buildTf: H1 beze změny, H4 agreguje',buildTf('H1',[h(5,1,2,1,1.5)]).length===1&&buildTf('H4',[h(4,1,2,1,1.5),h(5,1,2,1,1.5)]).length===1&&buildTf('W1',d1).length===2);
check('historie od 2020-01-01',HISTORY_FROM===Date.UTC(2020,0,1));
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
{const {snapTo,newsLayer,tradeMarkers,scoreBand,sessionBands,withAlpha,instrumentMarkets,sortMarkers,logicalAt,upcomingNews,eventCountry,newsMarkers,newsReaction}=await import('../lib/chart/layers.ts');
const T=[0,3600,7200,10800,86400];
check('layers: snap uvnitř svíčky',snapTo(T,3600,4000)===3600,snapTo(T,3600,4000));
check('layers: snap v mezeře → další svíčka',snapTo(T,3600,20000)===86400,snapTo(T,3600,20000));
check('layers: snap mimo rozsah',snapTo(T,3600,-1)===null&&snapTo(T,3600,90000)===null,null);
check('layers: trhy instrumentu',JSON.stringify([instrumentMarkets('EUR/USD'),instrumentMarkets('BTC-USD'),instrumentMarkets('^NDX'),instrumentMarkets('AAPL')])==='[["EUR","USD"],["BTC"],["INDEX"],["AAPL"]]',null);
check('layers: komodity → Zlato+USD, Ropa',JSON.stringify([instrumentMarkets('GC=F'),instrumentMarkets('SI=F'),instrumentMarkets('CL=F'),instrumentMarkets('BZ=F')])==='[["GOLD","USD"],["GOLD","USD"],["OIL"],["OIL"]]',null);
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
check('layers: alfa barvy',withAlpha('#abc',.5)==='rgba(170,187,204,0.5)'&&withAlpha('rgb(1, 2, 3)',.2)==='rgba(1,2,3,0.2)',null);
// zprávy: proběhlé nad svíčkami, nadcházející v pásu dole (logický index i za poslední svíčkou)
const now14=Date.parse(at(12));
check('layers: zprávy do now = proběhlé, bez now všechny',newsLayer(ev,'EUR/USD',times,3600,now14).map(n=>n.event.id).join()==='d'&&newsLayer(ev,'EUR/USD',times,3600).length===2,newsLayer(ev,'EUR/USD',times,3600,now14));
check('layers: logický index – svíčka, mezera, za koncem, před začátkem',logicalAt(T,3600,4000)===1&&logicalAt(T,3600,20000)===4&&logicalAt(T,3600,86400+3600*5+10)===9&&logicalAt(T,3600,-5)===null&&logicalAt([],3600,1)===null,[logicalAt(T,3600,4000),logicalAt(T,3600,20000),logicalAt(T,3600,86400+3600*5+10)]);
const late={id:'e',at:at(30),timeKnown:true,title:'USA • NFP',markets:['USD'],signal:3,global:false};
const up=upcomingNews([late,...ev],'EUR/USD',times,3600,now14);
check('layers: nadcházející – jen po now, seřazené, za koncem svíček odhad',up.map(u=>u.event.id).join()==='a,e'&&up[0].logical===14&&up[1].logical===30&&up[1].t===base+30*3600,up);
check('layers: nadcházející – jiné trhy a slabé ne',upcomingNews(ev,'GBP/JPY',times,3600,now14).map(u=>u.event.id).join()===''&&upcomingNews(ev,'GBP/USD',times,3600,0).map(u=>u.event.id).join()==='d,b,a',upcomingNews(ev,'GBP/USD',times,3600,0));
check('layers: země zprávy – titulek, typ, měna, bez země null',eventCountry({title:'USA • CPI',markets:['USD']})==='US'&&eventCountry({title:'EIA • týdenní zásoby ropy',kind:'eia-oil',markets:['OIL']})==='US'&&eventCountry({title:'RBA • rozhodnutí o sazbách',markets:['AUD']})==='AU'&&eventCountry({title:'Swiss National Bank · rozhodnutí o sazbě',markets:['CHF']})==='CH'&&eventCountry({title:'Eurozóna • zápis ECB',markets:['EUR']})==='EU'&&eventCountry({title:'Bank of England · rozhodnutí',markets:['GBP']})==='GB'&&eventCountry({title:'Zasedání',markets:['JPY']})==='JP'&&eventCountry({title:'OPEC+ • schůzka',kind:'opec',markets:['OIL']})===null&&eventCountry({title:'Federální rozpočet',markets:[]})===null,null);
const nm=newsMarkers([...nl,{event:{id:'o',at:at(5),timeKnown:true,title:'OPEC+ • schůzka',kind:'opec',markets:['OIL'],signal:2,global:true},time:base+5*3600}],{high:'#f00',mid:'#f80'});
check('layers: značky zpráv – silná červená, střední oranžová, popisek země',nm[0].color==='#f00'&&nm[0].text==='US'&&nm[0].position==='aboveBar'&&nm[1].color==='#f80'&&nm[1].id==='n:d'&&nm[1].text==='US'&&nm[2].text===undefined,nm);
// reakce trhu po zprávě: M15 svíčky, open = 100 + i, close = open + 0,5, high = close + 1, low = open − 1
const m15=Array.from({length:192},(_,i)=>({time:base+i*900,open:100+i,high:101.5+i,low:99+i,close:100.5+i}));
const cpi={at:at(10),timeKnown:true},far=Date.parse(at(72));
const rx=newsReaction(m15,cpi,900,far),rk=k=>rx.find(r=>r.key===k);
check('reakce: 15 min = svíčka se zprávou',rk('15m').status==='ok'&&rk('15m').from===140&&rk('15m').to===140.5&&rk('15m').change===.5&&rk('15m').high===141.5&&rk('15m').low===139,rk('15m'));
check('reakce: 1 h a 4 h od otevření svíčky se zprávou',rk('1h').change===3.5&&rk('1h').pct===2.5&&rk('4h').to===155.5&&rk('4h').high===156.5&&rk('4h').low===139&&rk('4h').end===base+14*3600,[rk('1h'),rk('4h')]);
check('reakce: 1 den',rk('1d').status==='ok'&&rk('1d').change===95.5,rk('1d'));
check('reakce: TF hrubší než horizont',newsReaction(m15,cpi,3600,far).map(r=>r.status).join()==='coarse,ok,ok,ok'&&newsReaction(m15,cpi,604800,far).every(r=>r.status==='coarse'),newsReaction(m15,cpi,3600,far));
check('reakce: budoucí zpráva',newsReaction(m15,cpi,900,Date.parse(at(9))).every(r=>r.status==='future'),null);
check('reakce: horizont ještě běží',newsReaction(m15,cpi,900,Date.parse(at(10.5))).map(r=>r.status).join()==='ok,pending,pending,pending',newsReaction(m15,cpi,900,Date.parse(at(10.5))));
check('reakce: svíčky načtené dřív (asOf) → čeká',newsReaction(m15,cpi,900,far,Date.parse(at(10.3))).map(r=>r.status).join()==='ok,pending,pending,pending',null);
const rd=newsReaction(m15,{at:at(10),timeKnown:false},900,far);
check('reakce: bez přesného času jen 1 den od začátku dne',rd.map(r=>r.status).join()==='unknown,unknown,unknown,ok'&&rd[3].from===100&&rd[3].to===195.5,rd);
check('reakce: zpráva mimo svíčky',newsReaction(m15,{at:at(-5),timeKnown:true},900,far).map(r=>r.status).join()==='nodata,nodata,nodata,nodata',null);
const gap=m15.filter((_,i)=>i<48||i>=96);
check('reakce: mezera (zavřený trh) → poslední svíčka před mezerou',newsReaction(gap,{at:at(11),timeKnown:true},900,far).find(r=>r.key==='4h').to===147.5,newsReaction(gap,{at:at(11),timeKnown:true},900,far));}
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

{const d=[[0,1.10,1.11,1.09,1.105],[1,1.106,1.12,1.10,1.115],[2,1.30,1.31,1.29,1.30]];const f=fixFxDailyOpen(d);
check('FX D1: open = close předchozího dne, high/low rozšířené',f[0][1]===1.10&&f[1][1]===1.105&&f[2][1]===1.115&&f[2][3]===1.115&&f[2][2]===1.31,f);}
// objem: Yahoo volume (0 = FX bez objemu), součet při agregaci, futures jako zdroj objemu FX
{const yv={chart:{result:[{timestamp:[t0,t0+3600,t0+7200],indicators:{quote:[{open:[1,2,3],high:[1,2,3],low:[1,2,3],close:[1,2,3],volume:[100,0,null]}]}}]}};const pv=parseYahoo(yv);
check('objem: kladný se uloží, 0 a null = bez objemu',pv[0].length===6&&pv[0][5]===100&&pv[1].length===5&&pv[2].length===5,pv);}
check('objem: H4 sečte objem, bez objemu zůstane bez',toH4([[Date.UTC(2026,9,9,0),1,2,1,1.5,10],[Date.UTC(2026,9,9,1),1,2,1,1.5,15]])[0][5]===25&&toH4([h(0,1,2,1,1.5),h(1,1,2,1,1.5)])[0].length===5);
check('objem: W1 z D1 sečte objem',toW1([[Date.UTC(2026,9,5),1,2,1,1,5],[Date.UTC(2026,9,6),1,2,1,1,7]])[0][5]===12);
check('objem: FX D1 open zachová objem',fixFxDailyOpen([[0,1,1,1,1,3],[1,2,2,2,2,4]])[1][5]===4);
{const spot=[[Date.UTC(2026,9,9,10),1,1,1,1],[Date.UTC(2026,9,9,11),1,1,1,1],[Date.UTC(2026,9,9,12),1,1,1,1,9]];
 const fut=[[Date.UTC(2026,9,9,10),5,5,5,5,120],[Date.UTC(2026,9,9,12),5,5,5,5,300]];
 const m=withVolume(spot,fut,volumeKey('60m'));
 check('futures objem: párování podle hodiny, chybějící zůstane bez, vlastní se nepřepíše',m[0][5]===120&&m[1].length===5&&m[2][5]===9,m);
 const dspot=[[Date.UTC(2026,9,8,22),1,1,1,1]],dfut=[[Date.UTC(2026,9,9,4),5,5,5,5,77]];
 check('futures objem: denní svíčky podle dne (FX 22:00 UTC předchozího dne)',withVolume(dspot,dfut,volumeKey('1d'))[0][5]===77);
 check('futures objem: bez dat beze změny',withVolume(spot,[],volumeKey('60m'))===spot);
 check('proxy: hlavní páry mají futures, kříže ne',VOLUME_PROXY['EUR/USD']==='6E=F'&&VOLUME_PROXY['USD/JPY']==='6J=F'&&!VOLUME_PROXY['EUR/GBP']);}
if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
