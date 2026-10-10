// Kontrola kreslení v grafu: node --experimental-strip-types scripts/check-drawings.mjs
import {parseDrawings,fibLevels,FIB_LEVELS,measure,measureLines,fmtDuration,snapPrice,distToSegment,rayEnd,hitShape,hitTest,logicalOf,timeOfLogical,fromChartTime,translate,MAX_DRAWINGS} from '../lib/chart/drawings.ts';
import {chartTime} from '../lib/journal/chart-data.ts';
import {loadDrawings,saveDrawings} from '../lib/chart/drawings-store.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const T=Date.UTC(2026,9,9,8);
const line={id:'a1',type:'trend',a:[{t:T,p:1.1},{t:T+3600000,p:1.2}],color:'brand',ray:true,extra:1};
// validace
let r=parseDrawings([line]);
check('validace: platná čára, zahozené cizí klíče',r.ok&&r.drawings[0].ray===true&&!('extra' in r.drawings[0]),r);
check('validace: ray jen u čáry',parseDrawings([{...line,type:'rect'}]).ok&&!('ray' in parseDrawings([{...line,type:'rect'}]).drawings[0]));
check('validace: není seznam',!parseDrawings({}).ok&&parseDrawings({}).error==='Kresby musí být seznam.');
check('validace: neznámý typ',!parseDrawings([{...line,type:'circle'}]).ok&&parseDrawings([{...line,type:'circle'}]).error==='Neznámý typ kresby.');
check('validace: počet bodů podle typu',!parseDrawings([{...line,type:'hline'}]).ok&&parseDrawings([{...line,type:'hline',a:[line.a[0]]}]).ok);
check('validace: nekonečná cena',!parseDrawings([{...line,a:[{t:T,p:Infinity},line.a[1]]}]).ok&&!parseDrawings([{...line,a:[{t:'x',p:1},line.a[1]]}]).ok&&!parseDrawings([{...line,a:[{t:T,p:NaN},line.a[1]]}]).ok);
check('validace: barva z povolených',!parseDrawings([{...line,color:'#ff0000'}]).ok&&parseDrawings([{...line,color:'amber'}]).ok);
const txt={id:'t1',type:'text',a:[{t:T,p:1}],color:'fg',text:'Support'};
check('validace: text',parseDrawings([txt]).ok&&!parseDrawings([{...txt,text:''}]).ok&&!parseDrawings([{...txt,text:'x'.repeat(201)}]).ok&&parseDrawings([{...txt,text:'x'.repeat(200)}]).ok);
check('validace: max 200',parseDrawings(Array.from({length:MAX_DRAWINGS},(_,i)=>({...txt,id:'t'+i}))).ok&&!parseDrawings(Array.from({length:201},(_,i)=>({...txt,id:'t'+i}))).ok);
check('validace: duplicitní a neplatné ID',!parseDrawings([txt,txt]).ok&&!parseDrawings([{...txt,id:'a b'}]).ok);
check('validace: text se u jiných typů zahodí',!('text' in parseDrawings([{...line,text:'x'}]).drawings[0]));
// Fibonacci
const fl=fibLevels({t:0,p:100},{t:1,p:200});
check('fib: 7 hladin',fl.length===7&&FIB_LEVELS.join()==='0,0.236,0.382,0.5,0.618,0.786,1');
check('fib: 0 u druhého bodu, 1 u prvního',fl[0].price===200&&fl[6].price===100&&Math.abs(fl[4].price-138.2)<1e-9,fl);
// měření
const m=measure({t:T,p:100},{t:T+26*3600000,p:101.5},10,36);
check('měření: Δ, %, svíčky, čas',m.dp===1.5&&Math.abs(m.pct-1.5)<1e-9&&m.bars===26&&m.ms===26*3600000,m);
const ml=measureLines(m,v=>v.toLocaleString('cs-CZ'));
check('měření: popisky',ml[0]==='+1,5 (+1,5 %)'&&ml[1]==='26 svíček · 1 d 2 h',ml);
check('měření: pokles',measureLines(measure({t:0,p:2},{t:-3600000,p:1},3,2),String)[0]==='−1 (−50 %)'&&measureLines(measure({t:0,p:2},{t:3600000,p:1},0,1),String)[1]==='1 svíčka · 1 h');
check('délka: minuty, záporná',fmtDuration(45*60000)==='45 min'&&fmtDuration(-90*60000)==='−1 h 30 min'&&fmtDuration(0)==='0 min');
// magnet
const bar={open:1,high:5,low:0.5,close:3};
check('magnet: nejbližší OHLC',snapPrice(bar,4.2)===5&&snapPrice(bar,2.2)===3&&snapPrice(bar,0.6)===0.5&&snapPrice(null,2.2)===2.2);
// geometrie
check('vzdálenost k úsečce',distToSegment({x:5,y:5},{x:0,y:0},{x:10,y:0})===5&&distToSegment({x:15,y:0},{x:0,y:0},{x:10,y:0})===5);
const re=rayEnd({x:0,y:0},{x:10,y:10},100,100);
check('polopřímka za okraj',re.x>100&&re.y>100&&Math.abs(re.x-re.y)<1e-9,re);
const tr={type:'trend',pts:[{x:10,y:10},{x:50,y:50}]};
check('zásah: úchyt',hitShape(tr,{x:11,y:12},200,200)?.part==='handle'&&hitShape(tr,{x:49,y:50},200,200)?.index===1);
check('zásah: tělo čáry',hitShape(tr,{x:30,y:33},200,200)?.part==='body'&&hitShape(tr,{x:30,y:45},200,200)===null);
check('zásah: polopřímka',hitShape({...tr,ray:true},{x:120,y:121},200,200)?.part==='body'&&hitShape(tr,{x:120,y:121},200,200)===null);
check('zásah: horizontála v celé šíři',hitShape({type:'hline',pts:[{x:10,y:40}]},{x:190,y:44},200,200)?.part==='body'&&hitShape({type:'hline',pts:[{x:10,y:40}]},{x:10,y:40},200,200)?.part==='body');
check('zásah: zóna uvnitř',hitShape({type:'rect',pts:[{x:10,y:10},{x:60,y:40}]},{x:30,y:25},200,200)?.part==='body'&&hitShape({type:'rect',pts:[{x:10,y:10},{x:60,y:40}]},{x:90,y:25},200,200)===null);
const fs={type:'fib',pts:[{x:10,y:100},{x:110,y:0}],levels:[0,23.6,38.2,50,61.8,78.6,100]};
check('zásah: Fibonacci hladina',hitShape(fs,{x:80,y:51},200,200)?.part==='body'&&hitShape(fs,{x:150,y:50},200,200)===null);
check('zásah: text box',hitShape({type:'text',pts:[{x:10,y:10}],box:{x:6,y:-1,w:60,h:22}},{x:50,y:12},200,200)?.part==='body');
check('zásah: nahoře poslední',hitTest([{id:'a',shape:tr},{id:'b',shape:{...tr}}],{x:30,y:30},200,200)?.id==='b'&&hitTest([{id:'a',shape:tr}],{x:150,y:10},200,200)===null);
// čas ↔ logický index (svíčky H1 s víkendovou mezerou)
const H=3600,times=[0,H,2*H,50*H,51*H];
check('logický index: přesně na svíčce',logicalOf(times,H,2*H)===2&&logicalOf(times,H,50*H)===3);
check('logický index: uvnitř svíčky',logicalOf(times,H,H+1800)===1.5);
check('logický index: v mezeře konec svíčky',logicalOf(times,H,10*H)===3&&logicalOf(times,H,2*H+1800)===2.5);
check('logický index: mimo rozsah po TF',logicalOf(times,H,-2*H)===-2&&logicalOf(times,H,53*H)===6&&logicalOf([],H,5)===0);
check('zpět na čas',timeOfLogical(times,H,1.5)===H+1800&&timeOfLogical(times,H,-2)===-2*H&&timeOfLogical(times,H,6)===53*H&&timeOfLogical(times,H,3)===50*H);
// H1 kotva na H4 svíčkách = zlomek H4 svíčky
const H4=[0,4*H,8*H];
check('jiný TF: H1 kotva uvnitř H4',logicalOf(H4,4*H,5*H)===1.25);
// pražský čas ↔ UTC (léto i zima)
const summer=Date.UTC(2026,6,1,10),winter=Date.UTC(2026,0,15,10),dst=Date.UTC(2026,9,25,0,30);
check('čas grafu → UTC (léto/zima)',fromChartTime(chartTime(summer))===summer&&fromChartTime(chartTime(winter))===winter);
// dvojznačná hodina při přechodu na zimní čas: stačí, že se trefí do stejného času grafu
check('čas grafu → UTC (přechod)',chartTime(fromChartTime(chartTime(dst)))===chartTime(dst));
// posun kresby
const toL=t=>t/1000/H,fromL=l=>l*H*1000;
const moved=translate({id:'x',type:'rect',a:[{t:0,p:1},{t:2*H*1000,p:2}],color:'bull'},3,0.5,toL,fromL);
check('posun: čas i cena',moved.a[0].t===3*H*1000&&moved.a[1].t===5*H*1000&&moved.a[0].p===1.5,moved);
const mh=translate({id:'h',type:'hline',a:[{t:7,p:1}],color:'bull'},3,0.5,toL,fromL);
check('posun: horizontála jen cena',mh.a[0].t===7&&mh.a[0].p===1.5);
// úložiště s falešnou DB
const rows=new Map();
const db={prepare(sql){const mk=params=>({bind:(...p)=>mk(p),
 async first(){if(/^SELECT data FROM chart_drawings/.test(sql)){const v=rows.get(params[0]+'|'+params[1]);return v?{data:v}:null}return null},
 async run(){if(/^INSERT INTO chart_drawings/.test(sql)){check('úložiště: upsert SQL',/ON DUPLICATE KEY UPDATE/.test(sql));rows.set(params[0]+'|'+params[1],params[2]);return {meta:{changes:1}}}
  if(/^DELETE FROM chart_drawings/.test(sql)){rows.delete(params[0]+'|'+params[1]);return {meta:{changes:1}}}return {meta:{changes:0}}}});return mk([])}};
await saveDrawings(db,'u1','EUR/USD',[r.drawings[0]],T);
check('úložiště: per uživatel × trh',(await loadDrawings(db,'u1','EUR/USD')).length===1&&(await loadDrawings(db,'u2','EUR/USD')).length===0&&(await loadDrawings(db,'u1','GBP/USD')).length===0);
rows.set('u1|BAD',JSON.stringify([txt,{id:'zz',type:'circle'}]));
check('úložiště: poškozený záznam → jen platné',(await loadDrawings(db,'u1','BAD')).map(d=>d.id).join()==='t1');
rows.set('u1|BAD2','{nejson');check('úložiště: neplatný JSON → []',(await loadDrawings(db,'u1','BAD2')).length===0);
await saveDrawings(db,'u1','EUR/USD',[],T);
check('úložiště: prázdný seznam smaže řádek',!rows.has('u1|EUR/USD'));
console.log(fails.length?`\n${fails.length} chyb`:'\nvše ok');
process.exit(fails.length?1:0);
