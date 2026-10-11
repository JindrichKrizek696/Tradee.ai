// Kontrola footprintu (Binance): node --experimental-strip-types scripts/check-footprint.mjs
import {parseAggTrades,parseKlines,bucketIndex,addTrades,emptyState,footprintOf,chooseTick,toCandle,fpSymbol,isFpTf,fmtVol,roundTo,FP_LADDER,FP_HISTORY} from '../lib/chart/footprint.ts';
import {getFootprint,NO_DATA} from '../lib/chart/footprint-store.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
// symboly a TF
check('symboly: jen BTC, ETH, SOL',fpSymbol('BTC-USD')==='BTCUSDT'&&fpSymbol('ETH-USD')==='ETHUSDT'&&fpSymbol('SOL-USD')==='SOLUSDT'&&fpSymbol('EUR/USD')===null&&fpSymbol('^NDX')===null);
check('TF: M5, M15, H1',isFpTf('M5')&&isFpTf('M15')&&isFpTf('H1')&&!isFpTf('H4')&&!isFpTf('D1')&&FP_HISTORY.M5===288&&FP_HISTORY.H1===72);
// parsování
const raw=[{a:1,p:'100.5',q:'2',T:1000,m:false},{a:2,p:'101',q:'1.5',T:1100,m:true},{a:3,p:'x',q:'1',T:1,m:true},null];
const tr=parseAggTrades(raw);
check('aggTrades: čísla z textu, vadné vynechány',tr.length===2&&tr[0].p===100.5&&tr[1].m===true&&tr[0].id===1,tr);
check('aggTrades: ne-seznam → []',parseAggTrades({code:-1}).length===0);
check('klines: OHLCV',parseKlines([[0,'1','2','0.5','1.5','10',59999]]).join()==='0,1,2,0.5,1.5,10'&&parseKlines([['a']]).length===0&&parseKlines(null).length===0);
// bucketování
check('hladina: dolní hrana',bucketIndex(100.49,1)===100&&bucketIndex(100,5)===20&&bucketIndex(104.99,5)===20&&bucketIndex(0.3,0.1)===3&&bucketIndex(110.07,0.01)===11007);
check('zaokrouhlení ceny hladiny',roundTo(11007*0.01,0.01)===110.07&&roundTo(83005,5)===83005&&roundTo(2508.25,0.25)===2508.25);
// agregace: taker nákup m=false, taker prodej m=true
const T0=600000,END=T0+300000;
const s=emptyState(T0,100,103,99,102,0);
const trades=[
 {id:10,p:99.2,q:1,t:T0+1,m:true},{id:11,p:99.7,q:1,t:T0+2,m:false},
 {id:12,p:100.1,q:4,t:T0+3,m:false},{id:13,p:100.9,q:1,t:T0+4,m:true},
 {id:14,p:101.5,q:2,t:T0+5,m:false},{id:15,p:101.2,q:3,t:T0+6,m:true},
 {id:16,p:102.4,q:0.5,t:T0+7,m:true},{id:17,p:102.1,q:1,t:T0+8,m:false},
 {id:18,p:500,q:9,t:END,m:false},
];
const r=addTrades(s,trades,1,END);
check('agregace: obchod po konci svíčky se nezapočte',r.reachedEnd&&s.n===8&&s.next===19&&!s.b['500'],s);
check('agregace: nákup a prodej na hladině',s.b['100'][0]===4&&s.b['100'][1]===1&&s.b['99'][0]===1&&s.b['99'][1]===1&&s.b['101'][0]===2&&s.b['101'][1]===3,s.b);
const f=footprintOf(s.b,1,1);
check('řádky shora dolů [cena, prodej, nákup, příznak]',f.rows.length===4&&f.rows[0][0]===102&&f.rows[3][0]===99&&f.rows[0][1]===0.5&&f.rows[0][2]===1,f.rows);
check('delta a objem',f.delta===(1+4+2+1)-(1+1+3+0.5)&&f.total===13.5,f);
check('POC = hladina s největším objemem',f.poc===100||f.poc===101,f.poc);
const f2=footprintOf({'100':[5,1],'101':[1,1]},1,1);
check('POC jednoznačně',f2.poc===100,f2);
// nerovnováhy: nákup na hladině vs. prodej o hladinu níž (≥ 3:1), prodej vs. nákup o hladinu výš
const imb=footprintOf({'10':[1,6],'11':[9,1],'12':[1,1],'13':[0,0.1]},1,1);
const flag=p=>imb.rows.find(x=>x[0]===p)[3];
check('nerovnováha: 9 vs. 6 níž není 3:1, prodej 1 vs. 0 výš je',(flag(11)&1)===0&&flag(12)===2,imb.rows);
const im2=footprintOf({'10':[1,2],'11':[6,1],'12':[1,4]},1,1);
const fl=p=>im2.rows.find(x=>x[0]===p)[3];
check('nerovnováha: nákup 6 vs. prodej o hladinu níž 2 → 3:1',(fl(11)&1)===1,im2.rows);
check('nerovnováha: prodej 4 vs. nákup o hladinu výš – nejvyšší hladina nemá souseda',(fl(12)&2)===0,im2.rows);
check('nerovnováha: prodej 2 vs. nákup výš 6 → ne',(fl(10)&2)===0&&(fl(10)&1)===0,im2.rows);
const im3=footprintOf({'10':[1,9],'11':[2,1]},1,1);
check('nerovnováha: prodej 9 vs. nákup výš 2 → prodejní',(im3.rows.find(x=>x[0]===10)[3]&2)===2&&(im3.rows.find(x=>x[0]===11)[3]&1)===0,im3.rows);
check('nerovnováha: nula naproti se počítá jen u nenulové strany',(footprintOf({'10':[0,0],'11':[0.5,0]},1,1).rows[0][3]&1)===1&&(footprintOf({'10':[0,0],'11':[0,0.5]},1,1).rows[0][3])===0);
check('nerovnováha: těsně pod 3:1 ne',(footprintOf({'10':[0,1],'11':[2.99,0]},1,1).rows[0][3]&1)===0&&(footprintOf({'10':[0,1],'11':[3,0]},1,1).rows[0][3]&1)===1);
// hrubší krok: sloučení hladin, mezery doplněné nulami
const g=footprintOf({'20':[1,0],'21':[1,1],'25':[0,2]},5,10);
check('hrubší krok: sloučení po 2 základních, mezera prázdná',g.rows.length===3&&g.rows[2][0]===100&&g.rows[2][2]===2&&g.rows[2][1]===1&&g.rows[1][0]===110&&g.rows[1][1]+g.rows[1][2]===0&&g.rows[0][0]===120&&g.rows[0][1]===2,g.rows);
const gap=footprintOf({'1':[1,0],'4':[0,1]},1,1);
check('mezery uvnitř svíčky jako prázdné řádky',gap.rows.length===4&&gap.rows[1][1]===0&&gap.rows[1][2]===0,gap.rows);
check('prázdná svíčka',footprintOf({},1,1).rows.length===0&&footprintOf({},1,1).poc===null);
// krok podle rozsahu svíček (~10–25 řádků)
const btc=FP_LADDER.BTCUSDT;
check('krok: BTC M15 rozsah ~300 → 25',chooseTick([280,300,320,250,400],btc)===25,chooseTick([280,300,320,250,400],btc));
check('krok: BTC M5 rozsah ~120 → 10',chooseTick([110,120,130],btc)===10);
check('krok: SOL rozsah ~1 → 0,1',chooseTick([0.9,1,1.1],FP_LADDER.SOLUSDT)===0.1,chooseTick([0.9,1,1.1],FP_LADDER.SOLUSDT));
check('krok: bez dat → nejmenší',chooseTick([],btc)===5&&chooseTick([0,NaN],btc)===5);
for(const [rng,lad] of [[300,btc],[1500,btc],[12,FP_LADDER.ETHUSDT],[0.6,FP_LADDER.SOLUSDT]]){const t=chooseTick([rng],lad),rows=rng/t+1;check(`krok: ${rng} → ${t} (${rows.toFixed(0)} řádků v 10–25)`,rows>=8&&rows<=26)}
// svíčka pro klienta
const done={...s,done:true};
const c=toCandle(done,1,1,false);
check('svíčka: hotová má řádky, deltu, POC',c.rows.length===4&&typeof c.d==='number'&&typeof c.poc==='number'&&!c.live);
check('svíčka: nehotová uzavřená bez řádků, živá s řádky',!toCandle(s,1,1,false).rows&&toCandle(s,1,1,true).rows.length===4&&toCandle(s,1,1,true).live===true);
check('objem krátce',fmtVol(1234)==='1,2k'&&fmtVol(25000)==='25k'&&fmtVol(0.0123)==='0,012'&&fmtVol(12.34)==='12,3'&&fmtVol(0)==='0');
// úložiště s falešnou DB a Binance
function fakeDb(){const rows=new Map();return {rows,db:{prepare(sql){const mk=params=>({bind:(...p)=>mk(p),
 async all(){if(/^SELECT candle_t/.test(sql))return {results:[...rows.values()].filter(r=>r.instrument===params[0]&&r.tf===params[1]&&r.candle_t>=params[2]).sort((a,b)=>a.candle_t-b.candle_t)};return {results:[]}},
 async first(){return null},
 async run(){
  if(/^INSERT INTO footprint_cache/.test(sql)){check('úložiště: upsert SQL',/ON DUPLICATE KEY UPDATE/.test(sql));for(let i=0;i<params.length;i+=5)rows.set(params[i]+'|'+params[i+1]+'|'+params[i+2],{instrument:params[i],tf:params[i+1],candle_t:params[i+2],data:params[i+3],updated:params[i+4]});return {meta:{changes:1}}}
  if(/^DELETE FROM footprint_cache/.test(sql)){for(const [k,r] of rows)if(r.instrument===params[0]&&r.tf===params[1]&&r.candle_t<params[2])rows.delete(k);return {meta:{changes:1}}}
  return {meta:{changes:0}};
 }});return mk([])}}}}
const M5=300000,NOW=Date.UTC(2026,9,11,12,2),LIVE=Math.floor(NOW/M5)*M5;
const kl=Array.from({length:288},(_,i)=>{const t=LIVE-(287-i)*M5;return [t,'100','110','95','105','10',t+M5-1]});
let calls=[];
const trade=(id,t,p,q,m)=>({a:id,p:String(p),q:String(q),T:t,m});
function binance(status=200){return async url=>{calls.push(url);if(status!==200)return new Response('{}',{status});
 if(url.includes('/klines'))return Response.json(kl);
 const u=new URL(url),st=Number(u.searchParams.get('startTime')),from=Number(u.searchParams.get('fromId'));
 if(u.searchParams.has('startTime'))return Response.json([trade(st/100,st+1,100.2,1,false),trade(st/100+1,st+2,99.1,2,true)]);
 return Response.json([trade(from,0,100,1,false)]);
}}
const clock=()=>0,sleep=async()=>{};
const F=fakeDb();
let res=await getFootprint(F.db,'BTC-USD','M5',NOW,binance(),clock,sleep);
check('úložiště: nejvýš 10 požadavků na volání',calls.length===10,calls.length);
check('úložiště: klines + živá svíčka první, pak nejnovější uzavřené',calls[0].includes('/klines')&&calls[1].includes('startTime='+LIVE)&&calls[2].includes('startTime='+(LIVE-M5)),calls.slice(0,3));
check('úložiště: 288 svíček, 8 hotových + živá s řádky',res.candles.length===288&&res.candles.filter(c=>c.rows).length===9&&res.candles.at(-1).live===true&&res.pending===287-8,{n:res.candles.length,rows:res.candles.filter(c=>c.rows).length,pending:res.pending});
check('úložiště: delta svíčky z obchodů',res.candles.at(-2).d===-1&&res.candles.at(-2).rows.length>=1,res.candles.at(-2));
check('úložiště: uloženo do DB',F.rows.size===9);
calls=[];
res=await getFootprint(F.db,'BTC-USD','M5',NOW+10000,binance(),clock,sleep);
check('úložiště: živá svíčka do 30 s znovu nepočítá, pokračuje ve starších',calls.length===10&&!calls.some(u=>u.includes('startTime='+LIVE))&&calls[1].includes('startTime='+(LIVE-9*M5)),calls.slice(0,2));
check('úložiště: ubývá nehotových',res.pending===287-17,res.pending);
calls=[];
res=await getFootprint(F.db,'BTC-USD','M5',NOW+40000,binance(429),clock,sleep);
check('Binance 429 → česká hláška, cache zůstane',res.error===NO_DATA&&res.stale&&res.candles.filter(c=>c.rows).length>=17&&calls.length===1,{err:res.error,n:res.candles.length});
res=await getFootprint(fakeDb().db,'ETH-USD','H1',NOW,binance(451),clock,sleep);
check('Binance 451 bez cache → prázdné s hláškou',res.error===NO_DATA&&res.candles.length===0);
check('mimo krypto: unsupported',(await getFootprint(F.db,'EUR/USD','M5',NOW,binance(),clock,sleep)).unsupported===true);
// časový rozpočet ~6 s
const slow=fakeDb();calls=[];let tt=0;
await getFootprint(slow.db,'SOL-USD','M5',NOW,async u=>{tt+=2500;return binance()(u)},()=>tt,async ms=>{tt+=ms});
check('časový rozpočet: pomalé odpovědi → méně požadavků',calls.length<=3,calls.length);
console.log(fails.length?`\n${fails.length} chyb`:'\nvše ok');
process.exit(fails.length?1:0);
