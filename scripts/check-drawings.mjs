// Kontrola kreslení v grafu: node --experimental-strip-types scripts/check-drawings.mjs
import {parseDrawings,fibLevels,FIB_LEVELS,measure,measureLines,fmtDuration,snapPrice,distToSegment,rayEnd,hitShape,hitTest,logicalOf,timeOfLogical,fromChartTime,translate,MAX_DRAWINGS,MAX_POINTS,MAX_TOTAL_POINTS,styleOf,capsOf,visibleOn,filterTf,toggleTf,extendSeg,channelOffset,positionFrom,positionStats,positionLines,moveHandle,firstTouch,simplify,simplifyMax,pipSize,priceRangeLine,timeRangeLine,dashOf,fibExtLevels,FIB_EXT_LEVELS,fibExtSpan,pitchfork,gannGrid,withRR,rrOf,record,undoStep,redoStep,emptyHistory,normalizePrefs,parsePrefs,lookOf,applyLook,MAX_PRESETS,MAX_COLORS,colorOf,isDrawColor,moveEdge,edgeHandles,edgesOf,edgeCursor} from '../lib/chart/drawings.ts';
import {loadPrefs,savePrefs} from '../lib/chart/prefs-store.ts';
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
check('validace: barva z povolených nebo #RRGGBB',parseDrawings([{...line,color:'#FF0000'}]).drawings[0].color==='#ff0000'&&parseDrawings([{...line,color:'amber'}]).ok&&!parseDrawings([{...line,color:'red'}]).ok&&!parseDrawings([{...line,color:'#ff00'}]).ok&&!parseDrawings([{...line,color:'#gg0000'}]).ok);
const txt={id:'t1',type:'text',a:[{t:T,p:1}],color:'fg',text:'Support'};
check('validace: text',parseDrawings([txt]).ok&&!parseDrawings([{...txt,text:''}]).ok&&!parseDrawings([{...txt,text:'x'.repeat(201)}]).ok&&parseDrawings([{...txt,text:'x'.repeat(200)}]).ok);
check('validace: max 200',parseDrawings(Array.from({length:MAX_DRAWINGS},(_,i)=>({...txt,id:'t'+i}))).ok&&!parseDrawings(Array.from({length:201},(_,i)=>({...txt,id:'t'+i}))).ok);
check('validace: duplicitní a neplatné ID',!parseDrawings([txt,txt]).ok&&!parseDrawings([{...txt,id:'a b'}]).ok);
check('validace: poznámka u libovolné kresby',parseDrawings([{...line,text:'pozn.'}]).drawings[0].text==='pozn.'&&!('text' in parseDrawings([{...line,text:'  '}]).drawings[0])&&!parseDrawings([{...line,text:'x'.repeat(201)}]).ok&&!parseDrawings([{...line,text:5}]).ok);
// styl a viditelnost na TF
const styled={...line,s:{lw:3,ls:'dashed',op:.5,fill:false,border:true,bc:'bear',ta:'bottom',ts:'L',tc:'fg',extL:true,extR:false,risk:100,junk:1},tfs:['H1','D1']};
r=parseDrawings([styled]);
check('styl: platný styl a TF projdou, cizí klíče pryč',r.ok&&r.drawings[0].s.lw===3&&r.drawings[0].s.ls==='dashed'&&!('junk' in r.drawings[0].s)&&r.drawings[0].tfs.join()==='H1,D1',r);
for(const [k,v] of [['lw',5],['ls','wavy'],['op',0],['op',1.5],['fill','yes'],['bc','#f00'],['ta','left'],['ts','XXL'],['tc','pink'],['risk',-1],['extL',1]])check('styl: odmítne '+k+'='+JSON.stringify(v),!parseDrawings([{...line,s:{[k]:v}}]).ok);
check('styl: s není objekt',!parseDrawings([{...line,s:'x'}]).ok&&!parseDrawings([{...line,s:[1]}]).ok&&parseDrawings([{...line,s:null}]).ok);
check('TF: odmítne prázdné, neznámé a duplicitní',!parseDrawings([{...line,tfs:[]}]).ok&&!parseDrawings([{...line,tfs:['X1']}]).ok&&!parseDrawings([{...line,tfs:['H1','H1']}]).ok&&parseDrawings([{...line,tfs:['M15','W1','MN']}]).ok);
check('styl: prázdný styl se neuloží',!('s' in parseDrawings([{...line,s:{}}]).drawings[0]));
// stará kresba bez stylu = stejné výchozí hodnoty jako dřív
const sOld=styleOf({type:'trend',color:'brand',ray:true}),sRect=styleOf({type:'rect',color:'bull'}),sText=styleOf({type:'text',color:'fg'});
check('styl: výchozí hodnoty starých kreseb',sOld.lw===2&&sOld.extR&&!sOld.extL&&sOld.op===1&&sOld.ls==='solid'&&sRect.lw===1&&sRect.fill&&sRect.border&&sRect.bc==='bull'&&!sText.fill&&!sText.border&&sText.ta==='middle'&&sText.tc==='fg',[sOld,sRect,sText]);
check('styl: paprsek prodloužen doprava, pozice bez okraje',styleOf({type:'ray',color:'brand'}).extR&&!styleOf({type:'long',color:'brand'}).border&&styleOf({type:'long',color:'brand'}).fill);
check('styl: uložené hodnoty mají přednost',styleOf({type:'rect',color:'bull',s:{fill:false,bc:'bear',op:.3}}).fill===false&&styleOf({type:'rect',color:'bull',s:{bc:'bear'}}).bc==='bear'&&styleOf({type:'rect',color:'bull',s:{op:.3}}).op===.3);
check('styl: schopnosti podle typu',capsOf('trend').extend&&!capsOf('trend').fill&&capsOf('rect').border&&capsOf('channel').fill&&capsOf('long').risk&&!capsOf('hline').extend&&capsOf('text').border);
check('styl: čárkování',dashOf('solid',2).length===0&&dashOf('dashed',1).length===2&&dashOf('dotted',2)[0]<1);
check('TF: viditelnost',visibleOn({},'H4')&&visibleOn({tfs:['H4']},'H4')&&!visibleOn({tfs:['H1']},'H4')&&filterTf([{id:1},{id:2,tfs:['D1']}],'H1').length===1);
const ALL=['H1','H4','D1'];
check('TF: přepínání',toggleTf(undefined,'H1',ALL).join()==='H4,D1'&&toggleTf(['H4','D1'],'H1',ALL)===undefined&&toggleTf(['H4'],'H4',ALL).join()==='H4'&&toggleTf(['D1','H1'],'H4',ALL)===undefined);
// nové typy: počty bodů
const A=(n)=>Array.from({length:n},(_,i)=>({t:T+i*3600000,p:1+i/100}));
const mk=(type,n,extra={})=>({id:'n'+type,type,a:A(n),color:'brand',...extra});
check('nové typy: počty bodů',['ray','prange','trange'].every(t=>parseDrawings([mk(t,2)]).ok&&!parseDrawings([mk(t,3)]).ok)&&['hray','touch'].every(t=>parseDrawings([mk(t,1)]).ok&&!parseDrawings([mk(t,2)]).ok)&&['channel','long','short'].every(t=>parseDrawings([mk(t,3)]).ok&&!parseDrawings([mk(t,2)]).ok));
check('nové typy: lomená a štětec',parseDrawings([mk('path',2)]).ok&&!parseDrawings([mk('path',1)]).ok&&!parseDrawings([mk('path',101)]).ok&&parseDrawings([mk('brush',MAX_POINTS)]).ok&&!parseDrawings([mk('brush',MAX_POINTS+1)]).ok);
check('nové typy: limit bodů celkem',!parseDrawings(Array.from({length:Math.ceil(MAX_TOTAL_POINTS/MAX_POINTS)+1},(_,i)=>({...mk('brush',MAX_POINTS),id:'b'+i}))).ok);
// zpětná kompatibilita: uložené kresby starého formátu projdou beze změny
const legacy=[{id:'l1',type:'trend',a:[{t:T,p:1.1},{t:T+3600000,p:1.2}],color:'brand',ray:true},{id:'l2',type:'hline',a:[{t:T,p:1.15}],color:'bear'},{id:'l3',type:'rect',a:[{t:T,p:1},{t:T+7200000,p:1.3}],color:'bull'},{id:'l4',type:'fib',a:[{t:T,p:1},{t:T+7200000,p:1.3}],color:'amber'},{id:'l5',type:'text',a:[{t:T,p:1}],color:'fg',text:'Support'},{id:'l6',type:'measure',a:[{t:T,p:1},{t:T+7200000,p:1.3}],color:'muted'}];
r=parseDrawings(JSON.parse(JSON.stringify(legacy)));
check('kompatibilita: staré kresby beze změny',r.ok&&JSON.stringify(r.drawings)===JSON.stringify(legacy),r);
// prodloužení, kanál
const [e0,e1]=extendSeg({x:10,y:10},{x:20,y:10},100,100,true,true);
check('prodloužení: oba směry',e0.x<0&&e1.x>100&&e0.y===10&&e1.y===10,[e0,e1]);
const [f0,f1]=extendSeg({x:10,y:10},{x:20,y:10},100,100,false,false);
check('prodloužení: bez prodloužení beze změny',f0.x===10&&f1.x===20);
check('kanál: posun rovnoběžky',channelOffset({x:0,y:0},{x:10,y:10},{x:5,y:25})===20&&channelOffset({x:0,y:50},{x:100,y:50},{x:30,y:20})===-30);
const ch={type:'channel',pts:[{x:0,y:50},{x:100,y:50},{x:50,y:20}]};
check('zásah: kanál uvnitř, na hraně, mimo',hitShape(ch,{x:30,y:35},200,200)?.part==='body'&&hitShape(ch,{x:70,y:21},200,200)?.part==='body'&&hitShape(ch,{x:150,y:35},200,200)===null&&hitShape({...ch,extR:true},{x:150,y:35},200,200)?.part==='body');
check('zásah: paprsek vpravo, ne vlevo',hitShape({type:'ray',pts:[{x:10,y:10},{x:20,y:10}]},{x:150,y:11},200,200)?.part==='body'&&hitShape({type:'ray',pts:[{x:30,y:10},{x:40,y:10}]},{x:5,y:10},200,200)===null);
check('zásah: trend prodloužený doleva',hitShape({type:'trend',pts:[{x:50,y:10},{x:60,y:10}],extL:true},{x:5,y:10},200,200)?.part==='body'&&hitShape({type:'trend',pts:[{x:50,y:10},{x:60,y:10}]},{x:5,y:10},200,200)===null);
check('zásah: horizontální paprsek a dotyk',hitShape({type:'hray',pts:[{x:50,y:10}]},{x:190,y:12},200,200)?.part==='body'&&hitShape({type:'hray',pts:[{x:50,y:10}]},{x:20,y:10},200,200)===null&&hitShape({type:'touch',pts:[{x:50,y:10}],touchX:90},{x:120,y:10},200,200)===null&&hitShape({type:'touch',pts:[{x:50,y:10}],touchX:90},{x:80,y:10},200,200)?.part==='body');
check('zásah: lomená čára a štětec bez úchytů',hitShape({type:'path',pts:[{x:0,y:0},{x:50,y:0},{x:50,y:50}]},{x:52,y:30},200,200)?.part==='body'&&hitShape({type:'path',pts:[{x:0,y:0},{x:50,y:0}]},{x:50,y:1},200,200)?.part==='handle'&&hitShape({type:'brush',pts:[{x:0,y:0},{x:50,y:0}]},{x:50,y:1},200,200)?.part==='body');
check('zásah: poznámka',hitShape({type:'trend',pts:[{x:0,y:0},{x:10,y:0}],label:{x:100,y:100,w:40,h:20}},{x:120,y:110},200,200)?.part==='body');
check('zásah: zóna prodloužená doprava',hitShape({type:'rect',pts:[{x:10,y:10},{x:60,y:40}],extR:true},{x:190,y:25},200,200)?.part==='body');
// pozice
const pl=positionFrom('long',{t:0,p:100},{t:10,p:98});
check('pozice: long z tahu (SL pod, TP R:R 2)',pl[1].p===98&&pl[2].p===104&&pl[1].t===10&&pl[2].t===10,pl);
const ps=positionFrom('short',{t:0,p:100},{t:10,p:98});
check('pozice: short (SL nad, TP pod)',ps[1].p===102&&ps[2].p===96,ps);
check('pozice: nulové riziko → malé výchozí',positionFrom('long',{t:5,p:100},{t:5,p:100})[1].p<100&&positionFrom('long',{t:5,p:100},{t:5,p:100})[1].t===6);
const st=positionStats('long',pl,50);
check('pozice: R:R, %, zisk',st.rr===2&&st.risk===2&&st.reward===4&&Math.abs(st.tpPct-4)<1e-9&&st.valid&&st.profit===100,st);
check('pozice: SL na špatné straně',!positionStats('long',[{t:0,p:100},{t:1,p:101},{t:1,p:104}]).valid&&positionStats('short',ps).valid);
const pls=positionLines('long',pl,String,50);
check('pozice: popisky',pls.mid==='Long · R:R 2,00'&&pls.tp.includes('zisk 100')&&pls.sl.includes('riziko 50')&&pls.sl.startsWith('Stop 98'),pls);
const posD={id:'p',type:'long',a:pl,color:'brand'};
const mv=moveHandle(posD,1,{t:20,p:97});
check('pozice: tažení SL posune konec boxu i u TP',mv.a[1].p===97&&mv.a[1].t===20&&mv.a[2].t===20&&mv.a[2].p===104&&mv.a[0].t===0,mv.a);
check('pozice: tažení vstupu',moveHandle(posD,0,{t:3,p:99}).a[0].p===99&&moveHandle(posD,0,{t:3,p:99}).a[1].t===10);
check('úchyt: obecná kresba',moveHandle({id:'x',type:'trend',a:[{t:0,p:1},{t:1,p:2}],color:'brand'},1,{t:5,p:3}).a[1].t===5);
check('zásah: pozice',hitShape({type:'long',pts:[{x:10,y:50},{x:60,y:70},{x:60,y:10}]},{x:30,y:20},200,200)?.part==='body'&&hitShape({type:'long',pts:[{x:10,y:50},{x:60,y:70},{x:60,y:10}]},{x:30,y:90},200,200)===null);
// úroveň do dotyku
const tb=[{high:2,low:1},{high:3,low:2.5},{high:2.9,low:2.6},{high:2.4,low:1.8},{high:5,low:1}];
check('dotyk: první pozdější svíčka',firstTouch(tb,0,2.2)===3&&firstTouch(tb,0,2.7)===1&&firstTouch(tb,1,2.7)===2);
check('dotyk: kotva sama se nepočítá, netestováno',firstTouch(tb,3,2)===4&&firstTouch(tb,0,9)===null&&firstTouch(tb,4,2)===null&&firstTouch(tb,-3,1.5)===0);
check('dotyk: zlomkový index kotvy',firstTouch(tb,0.4,2.2)===3);
// zjednodušení štětce
const zig=Array.from({length:1000},(_,i)=>({x:i,y:i%2?0.3:0}));
check('štětec: rovná čára → 2 body',simplify(zig,1).join()==='0,999');
const corner=[{x:0,y:0},{x:5,y:0.1},{x:10,y:0},{x:10,y:5},{x:10,y:10}];
check('štětec: zachová roh',simplify(corner,1).join()==='0,2,4',simplify(corner,1));
const wave=Array.from({length:3000},(_,i)=>({x:i,y:Math.sin(i/7)*40}));
const sm=simplifyMax(wave,300);
check('štětec: nejvýš 300 bodů, začátek a konec',sm.length<=300&&sm.length>20&&sm[0]===0&&sm[sm.length-1]===2999,sm.length);
check('štětec: krátký tah beze změny',simplify([{x:0,y:0},{x:1,y:1}],1).join()==='0,1');
// cenový a časový rozsah
check('pip: FX, JPY, ostatní',pipSize('EUR/USD')===.0001&&pipSize('USD/JPY')===.01&&pipSize('^GSPC')===null&&pipSize('BTC-USD')===null&&pipSize('XAU/USD')===null);
check('cenový rozsah: Δ, %, pips',priceRangeLine({t:0,p:1.1},{t:0,p:1.1123},v=>v.toFixed(4),.0001)==='+0.0123 (+1,12 %) · +123 pips'&&priceRangeLine({t:0,p:200},{t:0,p:190},String,null)==='−10 (−5 %)',priceRangeLine({t:0,p:1.1},{t:0,p:1.1123},v=>v.toFixed(4),.0001));
check('časový rozsah: svíčky a doba',timeRangeLine({t:0,p:1},{t:26*3600000,p:1},10,36)==='26 svíček · 1 d 2 h');
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
// Fibonacci extension, Andrewsovy vidle, Gannova mřížka
check('nové nástroje: počty bodů',['fibext','pitchfork'].every(t=>parseDrawings([mk(t,3)]).ok&&!parseDrawings([mk(t,2)]).ok)&&parseDrawings([mk('gann',2)]).ok&&!parseDrawings([mk('gann',3)]).ok);
const fe=fibExtLevels({t:0,p:100},{t:1,p:200},{t:2,p:150});
check('extension: hladiny 0 … 2,618',FIB_EXT_LEVELS.join()==='0,0.618,1,1.272,1.618,2,2.618'&&fe.length===7,fe);
check('extension: c + (b − a) × úroveň',fe[0].price===150&&fe[2].price===250&&Math.abs(fe[1].price-211.8)<1e-9&&Math.abs(fe[4].price-311.8)<1e-9&&Math.abs(fe[6].price-411.8)<1e-9,fe);
const feDown=fibExtLevels({t:0,p:200},{t:1,p:100},{t:2,p:150});
check('extension: sestupný impuls',feDown[2].price===50&&Math.abs(feDown[3].price-22.8)<1e-9,feDown);
check('extension: rozsah hladin',fibExtSpan({x:0,y:0},{x:100,y:0},{x:150,y:0},500,false,false).join()==='150,250'&&fibExtSpan({x:0,y:0},{x:10,y:0},{x:150,y:0},500,false,true).join()==='150,500'&&fibExtSpan({x:0,y:0},{x:10,y:0},{x:150,y:0},500,true,false).join()==='0,190');
const pf=pitchfork({x:0,y:50},{x:100,y:0},{x:100,y:100});
check('vidle: medián přes střed b–c',pf.m.x===100&&pf.m.y===50&&pf.mid[1].x===100&&pf.mid[1].y===50,pf);
check('vidle: rovnoběžky přes b a c',pf.upper[0].y===0&&pf.upper[1].x===200&&pf.upper[1].y===0&&pf.lower[1].x===200&&pf.lower[1].y===100,pf);
const pf2=pitchfork({x:0,y:0},{x:10,y:10},{x:10,y:30});
check('vidle: šikmý medián – stejný směr všech tří',pf2.m.y===20&&pf2.upper[1].x===20&&pf2.upper[1].y===30&&pf2.lower[1].y===50,pf2);
const pfs={type:'pitchfork',pts:[{x:0,y:50},{x:100,y:0},{x:100,y:100}],extR:true};
check('zásah: vidle – medián, rovnoběžka, prodloužení',hitShape(pfs,{x:150,y:51},300,300)?.part==='body'&&hitShape(pfs,{x:250,y:2},300,300)?.part==='body'&&hitShape({...pfs,extR:false},{x:250,y:2},300,300)===null&&hitShape(pfs,{x:150,y:25},300,300)===null);
check('zásah: vidle – úchyty',hitShape(pfs,{x:101,y:99},300,300)?.index===2);
const gg=gannGrid({x:0,y:0},{x:100,y:200});
check('Gann: dělení po čtvrtinách',gg.xs.join()==='0,25,50,75,100'&&gg.ys.join()==='0,50,100,150,200',gg);
check('Gann: úhlopříčky',gg.diag.length===2&&gg.diag[0][1].x===100&&gg.diag[0][1].y===200&&gg.diag[1][0].y===200&&gg.diag[1][1].x===100&&gg.diag[1][1].y===0,gg.diag);
check('Gann: obrácené rohy',gannGrid({x:100,y:200},{x:0,y:0}).xs.join()==='100,75,50,25,0');
check('zásah: Gann uvnitř a mimo',hitShape({type:'gann',pts:[{x:10,y:10},{x:60,y:40}]},{x:30,y:25},200,200)?.part==='body'&&hitShape({type:'gann',pts:[{x:10,y:10},{x:60,y:40}]},{x:90,y:25},200,200)===null);
const fes={type:'fibext',pts:[{x:0,y:100},{x:50,y:0},{x:80,y:50}],levels:[50,-11.8,-50]};
check('zásah: extension hladina a spojnice',hitShape(fes,{x:110,y:51},300,300)?.part==='body'&&hitShape(fes,{x:25,y:52},300,300)?.part==='body'&&hitShape(fes,{x:200,y:50},300,300)===null);
check('styl: vidle prodloužené doprava, schopnosti',styleOf({type:'pitchfork',color:'brand'}).extR&&capsOf('pitchfork').extend&&capsOf('fibext').fill&&capsOf('gann').fill&&!capsOf('gann').extend&&capsOf('gann').line);
// R:R pozice
const lp=[{t:0,p:100},{t:5,p:90},{t:5,p:120}];
check('R:R: long – cíl = vstup + rr × riziko',withRR('long',lp,3)[2].p===130&&withRR('long',lp,1.5)[2].p===115&&withRR('long',lp,3)[2].t===5&&withRR('long',lp,3)[1].p===90);
const sp=[{t:0,p:100},{t:5,p:104},{t:5,p:96}];
check('R:R: short – cíl = vstup − rr × riziko',withRR('short',sp,2.5)[2].p===90&&withRR('short',sp,1)[2].p===96);
check('R:R: výpočet z kotev a po tažení cíle',rrOf(lp)===2&&rrOf(withRR('long',lp,0.5))===0.5&&rrOf([lp[0],lp[1],{t:5,p:125}])===2.5&&rrOf([lp[0],{t:5,p:100},lp[2]])===0);
check('R:R: nulové riziko nespadne, kladné R:R zachová stranu',withRR('long',[{t:0,p:100},{t:1,p:100},{t:1,p:100}],2)[2].p>100&&withRR('short',lp.map(x=>({...x})),2)[2].p<100);
check('R:R: stats souhlasí s withRR',Math.abs(positionStats('long',withRR('long',lp,1.7)).rr-1.7)<1e-9&&positionStats('long',withRR('long',lp,1.7)).valid);
// historie (Zpět / Znovu)
let hh=emptyHistory();hh=record(hh,['a']);hh=record(hh,['a','b']);
let u=undoStep(hh,['a','b','c']);
check('historie: zpět vrátí předchozí stav',u&&u.value.join()==='a,b'&&u.h.future[0].join()==='a,b,c');
let rd=redoStep(u.h,u.value);
check('historie: znovu vrátí zpět vrácené',rd&&rd.value.join()==='a,b,c'&&rd.h.past.length===2&&!rd.h.future.length);
check('historie: nová změna smaže „znovu“',record(u.h,['a','b']).future.length===0);
check('historie: prázdná → null',undoStep(emptyHistory(),[])===null&&redoStep(emptyHistory(),[])===null);
let big=emptyHistory();for(let i=0;i<130;i++)big=record(big,[String(i)]);
check('historie: nejvýš 100 kroků (nejstarší pryč)',big.past.length===100&&big.past[0][0]==='30'&&big.past[99][0]==='129');
// presety a výchozí vzhled nástrojů
const strongHigh={id:'p1',name:' Strong high ',tool:'hline',color:'bear',s:{ta:'middle',lw:2},text:'strong high'};
const chM15={id:'p2',name:'Kanál M15/M30',tool:'channel',color:'brand',tfs:['M30','M15']};
let pr=normalizePrefs({presets:[strongHigh,chM15],defaults:{long:{color:'bull',rr:3},trend:{color:'amber',s:{ls:'dashed'}}},junk:1});
check('presety: platné projdou, název ořezán, TF seřazené',pr.ok&&pr.prefs.presets[0].name==='Strong high'&&pr.prefs.presets[1].tfs.join()==='M15,M30'&&pr.prefs.defaults.long.rr===3&&!('junk' in pr.prefs),pr);
check('presety: jen poslané klíče',normalizePrefs({presets:[]}).ok&&!('defaults' in normalizePrefs({presets:[]}).prefs)&&!normalizePrefs({}).ok&&!normalizePrefs(null).ok&&!normalizePrefs([]).ok);
check('presety: max 50',normalizePrefs({presets:Array.from({length:MAX_PRESETS},(_,i)=>({...strongHigh,id:'p'+i}))}).ok&&!normalizePrefs({presets:Array.from({length:51},(_,i)=>({...strongHigh,id:'p'+i}))}).ok);
for(const [why,bad] of [['název prázdný',{...strongHigh,name:'  '}],['název > 40',{...strongHigh,name:'x'.repeat(41)}],['neznámý nástroj',{...strongHigh,tool:'circle'}],['špatná barva',{...strongHigh,color:'pink'}],['špatný styl',{...strongHigh,s:{lw:9}}],['text > 200',{...strongHigh,text:'x'.repeat(201)}],['TF mimo seznam',{...strongHigh,tfs:['H3']}],['TF duplicitní',{...strongHigh,tfs:['H1','H1']}],['TF prázdné',{...strongHigh,tfs:[]}],['špatné ID',{...strongHigh,id:'a b'}],['R:R mimo rozsah',{...strongHigh,tool:'long',rr:500}]])
 check('presety: odmítne '+why,!normalizePrefs({presets:[bad]}).ok);
check('presety: duplicitní ID',!normalizePrefs({presets:[strongHigh,strongHigh]}).ok);
check('presety: výchozí – neznámý nástroj / špatný vzhled',!normalizePrefs({defaults:{circle:{color:'brand'}}}).ok&&!normalizePrefs({defaults:{trend:{color:'x'}}}).ok&&!normalizePrefs({defaults:[]}).ok);
check('presety: R:R jen u pozic',!('rr' in normalizePrefs({defaults:{trend:{color:'brand',rr:2}}}).prefs.defaults.trend));
const lenient=parsePrefs({presets:[strongHigh,{...strongHigh,id:'p9',tool:'x'},{...strongHigh}],defaults:{trend:{color:'brand'},circle:{color:'brand'},rect:{color:'nope'}}});
check('presety: tolerantní načtení zahodí neplatné',lenient.presets.length===1&&Object.keys(lenient.defaults).join()==='trend'&&parsePrefs(null).presets.length===0&&parsePrefs('x').presets.length===0,lenient);
const hl={id:'n1',type:'hline',a:[{t:T,p:1.1}],color:'brand'};
const applied=applyLook(hl,pr.prefs.presets[0]);
check('vzhled: preset na novou čáru (barva, styl, text)',applied.color==='bear'&&applied.s.ta==='middle'&&applied.text==='strong high'&&applied.id==='n1'&&applied.a===hl.a&&parseDrawings([applied]).ok);
check('vzhled: kanál jen na M15/M30',applyLook({id:'c1',type:'channel',a:[{t:T,p:1},{t:T+1,p:2},{t:T,p:3}],color:'brand'},pr.prefs.presets[1]).tfs.join()==='M15,M30');
check('vzhled: bez vzhledu beze změny',applyLook(hl,null)===hl);
const lpos={id:'l1',type:'long',a:[{t:0,p:100},{t:5,p:90},{t:5,p:120}],color:'brand'};
check('vzhled: výchozí long s R:R 3 přepočítá cíl',applyLook(lpos,pr.prefs.defaults.long).a[2].p===130&&applyLook(lpos,pr.prefs.defaults.long).color==='bull');
check('vzhled: text kresby má přednost před textem presetu',applyLook({id:'t9',type:'text',a:[{t:T,p:1}],color:'fg',text:'můj'},{color:'bear',text:'strong high'}).text==='můj');
const lk=lookOf({...lpos,s:{op:.5},text:'pozn',tfs:['H1','H4']});
check('vzhled: z kresby (barva, styl, text, TF, R:R)',lk.color==='brand'&&lk.s.op===.5&&lk.text==='pozn'&&lk.tfs.join()==='H1,H4'&&lk.rr===2&&normalizePrefs({defaults:{long:lk}}).ok,lk);
check('vzhled: lookOf bez stylu a TF',JSON.stringify(lookOf(hl))==='{"color":"brand"}');
const prow=new Map();
const pdb={prepare(sql){const mk=params=>({bind:(...p)=>mk(p),
 async first(){if(/^SELECT data FROM drawing_prefs/.test(sql)){const v=prow.get(params[0]);return v?{data:v}:null}return null},
 async run(){if(/^INSERT INTO drawing_prefs/.test(sql)&&/ON DUPLICATE KEY UPDATE/.test(sql)){prow.set(params[0],params[1]);return {meta:{changes:1}}}return {meta:{changes:0}}}});return mk([])}};
check('úložiště presetů: prázdné',(await loadPrefs(pdb,'u1')).presets.length===0);
await savePrefs(pdb,'u1',{presets:pr.prefs.presets,defaults:{}},T);
check('úložiště presetů: per uživatel',(await loadPrefs(pdb,'u1')).presets.length===2&&(await loadPrefs(pdb,'u2')).presets.length===0);
prow.set('u3','{nejson');check('úložiště presetů: poškozený JSON → prázdné',(await loadPrefs(pdb,'u3')).presets.length===0);
// vlastní barvy
const cols=normalizePrefs({colors:['#AABBCC','#aabbcc','#112233']});
check('barvy: #RRGGBB, malá písmena, bez duplicit',cols.ok&&cols.prefs.colors.join()==='#aabbcc,#112233'&&!('presets' in cols.prefs),cols);
check('barvy: max 12',normalizePrefs({colors:Array.from({length:MAX_COLORS},(_,i)=>'#0000'+String(i).padStart(2,'0'))}).ok&&!normalizePrefs({colors:Array.from({length:13},(_,i)=>'#0000'+String(i).padStart(2,'0'))}).ok);
check('barvy: odmítne neplatné',!normalizePrefs({colors:['#abc']}).ok&&!normalizePrefs({colors:['red']}).ok&&!normalizePrefs({colors:'#aabbcc'}).ok&&!normalizePrefs({colors:[1]}).ok);
check('barvy: tolerantní načtení',parsePrefs({colors:['#AABBCC','x','#aabbcc']}).colors.join()==='#aabbcc'&&parsePrefs({}).colors.length===0);
check('barvy: styl a preset s vlastní barvou',parseDrawings([{...line,s:{bc:'#123456',tc:'#ABCDEF'}}]).drawings[0].s.tc==='#abcdef'&&normalizePrefs({presets:[{...strongHigh,color:'#123456'}]}).ok&&!parseDrawings([{...line,s:{tc:'#12345'}}]).ok);
check('barvy: colorOf',colorOf({brand:'#245bff',bull:'g'},'#123456')==='#123456'&&colorOf({brand:'#245bff',bull:'g'},'bull')==='g'&&isDrawColor('fg')&&!isDrawColor('#12'));
await savePrefs(pdb,'u4',{presets:[],defaults:{},colors:['#aabbcc']},T);
check('úložiště presetů: barvy',(await loadPrefs(pdb,'u4')).colors.join()==='#aabbcc');
// úchyty uprostřed hran (výška / šířka zvlášť)
const rc={id:'r',type:'rect',a:[{t:0,p:1},{t:10,p:2}],color:'bull'};
const rTop=moveEdge(rc,'top',{t:99,p:2.5});
check('hrana: obdélník nahoře – jen cena horní hrany, časy a dolní cena beze změny',rTop.a[1].p===2.5&&rTop.a[0].p===1&&rTop.a[0].t===0&&rTop.a[1].t===10&&rc.a[1].p===2,rTop.a);
const rBot=moveEdge({...rc,a:[{t:0,p:2},{t:10,p:1}]},'bottom',{t:99,p:0.5});
check('hrana: obdélník dole (obrácené rohy)',rBot.a[1].p===0.5&&rBot.a[0].p===2&&rBot.a[1].t===10,rBot.a);
const rPast=moveEdge(rc,'top',{t:5,p:0.2});
check('hrana: přetažení přes protější hranu jen převrátí',rPast.a[1].p===0.2&&rPast.a[0].p===1&&rPast.a[1].t===10,rPast.a);
const rL=moveEdge(rc,'left',{t:-5,p:9}),rR=moveEdge({...rc,a:[{t:10,p:1},{t:0,p:2}]},'right',{t:20,p:9});
check('hrana: obdélník vlevo/vpravo – jen čas',rL.a[0].t===-5&&rL.a[0].p===1&&rL.a[1].t===10&&rR.a[0].t===20&&rR.a[0].p===1&&rR.a[1].t===0,[rL.a,rR.a]);
const tr2={id:'tr',type:'trange',a:[{t:0,p:1},{t:10,p:1.5}],color:'brand'};
const trL=moveEdge(tr2,'left',{t:3,p:7}),trR=moveEdge(tr2,'right',{t:30,p:7});
check('hrana: časový rozsah vlevo/vpravo – ceny beze změny',trL.a[0].t===3&&trL.a[0].p===1&&trL.a[1].t===10&&trR.a[1].t===30&&trR.a[1].p===1.5&&trR.a[0].t===0,[trL.a,trR.a]);
check('hrana: časový rozsah nemá nahoře/dole, cenový nemá vlevo/vpravo',moveEdge(tr2,'top',{t:0,p:9})===tr2&&edgesOf('prange').join()==='top,bottom'&&edgesOf('trange').join()==='left,right'&&edgesOf('trend').length===0);
const chD={id:'c',type:'channel',a:[{t:0,p:1},{t:10,p:2},{t:5,p:3}],color:'brand'};
const chB=moveEdge(chD,'base',{t:77,p:2});
check('hrana: kanál – střed čáry posune čáru svisle se stejným sklonem',chB.a[0].p===1.5&&chB.a[1].p===2.5&&chB.a[0].t===0&&chB.a[1].t===10&&chB.a[2].p===3&&chB.a[2].t===5,chB.a);
const chP=moveEdge(chD,'parallel',{t:5,p:4});
check('hrana: kanál – rovnoběžka projde kurzorem, čára a–b beze změny',chP.a[2].p===4&&chP.a[0].p===1&&chP.a[1].p===2&&chP.a[1].t===10,chP.a);
const fbD={id:'f',type:'fib',a:[{t:0,p:100},{t:10,p:200}],color:'amber'};
const fbT=moveEdge(fbD,'top',{t:50,p:250});
check('hrana: fib nahoře – cena hladiny, časy beze změny',fbT.a[1].p===250&&fbT.a[0].p===100&&fbT.a[1].t===10&&fbT.a[0].t===0&&fibLevels(fbT.a[0],fbT.a[1])[0].price===250,fbT.a);
const posE={id:'p',type:'long',a:[{t:0,p:100},{t:10,p:98},{t:10,p:104}],color:'brand'};
const pR=moveEdge(posE,'right',{t:25,p:1}),pL=moveEdge(posE,'left',{t:-4,p:1});
check('hrana: pozice vpravo – konec boxu (SL i TP) jen v čase',pR.a[1].t===25&&pR.a[2].t===25&&pR.a[1].p===98&&pR.a[2].p===104&&pR.a[0].t===0&&pR.a[0].p===100,pR.a);
check('hrana: pozice vlevo – čas vstupu, ceny beze změny',pL.a[0].t===-4&&pL.a[0].p===100&&pL.a[1].t===10&&pL.a[2].t===10,pL.a);
const pT=moveEdge(posE,'top',{t:99,p:106}),pB=moveEdge(posE,'bottom',{t:99,p:97});
check('hrana: pozice nahoře/dole – cena TP/SL, časy beze změny',pT.a[2].p===106&&pT.a[2].t===10&&pT.a[1].p===98&&pB.a[1].p===97&&pB.a[1].t===10&&pB.a[2].p===104,[pT.a,pB.a]);
const rS={type:'rect',pts:[{x:10,y:10},{x:110,y:70}]};
const eh=edgeHandles(rS);
check('hrana: úchyty obdélníku uprostřed hran',eh.map(e=>e.edge+':'+e.pt.x+','+e.pt.y).join()==='top:60,10,bottom:60,70,left:10,40,right:110,40',eh);
check('hrana: malý obdélník bez úchytů hran, prodloužený bez bočního',edgeHandles({type:'rect',pts:[{x:10,y:10},{x:20,y:15}]}).length===0&&!edgeHandles({...rS,extR:true}).some(e=>e.edge==='right'));
check('hrana: zásah jen u vybrané kresby',hitShape(rS,{x:61,y:11},200,200,6,true)?.edge==='top'&&hitShape(rS,{x:61,y:11},200,200)?.part==='body'&&hitShape(rS,{x:11,y:11},200,200,6,true)?.part==='handle');
check('hrana: hitTest – vybraná pod jinou kresbou',hitTest([{id:'s',shape:rS},{id:'o',shape:{type:'rect',pts:[{x:0,y:0},{x:200,y:200}]}}],{x:110,y:41},200,200,6,'s')?.hit.edge==='right'&&hitTest([{id:'s',shape:rS},{id:'o',shape:{type:'rect',pts:[{x:0,y:0},{x:200,y:200}]}}],{x:110,y:41},200,200,6,null)?.id==='o');
const chS={type:'channel',pts:[{x:0,y:50},{x:100,y:50},{x:50,y:10}]};
check('hrana: kanál – středy obou čar',edgeHandles(chS).map(e=>e.edge+':'+e.pt.x+','+e.pt.y).join()==='base:50,50,parallel:50,10'&&hitShape(chS,{x:50,y:52},200,200,6,true)?.edge==='base');
const poS={type:'long',pts:[{x:10,y:50},{x:110,y:70},{x:110,y:10}]};
check('hrana: pozice – boční úchyty v zóně cíle, nahoře/dole TP/SL',edgeHandles(poS).map(e=>e.edge+':'+e.pt.x+','+e.pt.y).join()==='top:60,10,bottom:60,70,left:10,30,right:110,30');
check('hrana: kurzor',edgeCursor('top')==='ns-resize'&&edgeCursor('parallel')==='ns-resize'&&edgeCursor('left')==='ew-resize');
console.log(fails.length?`\n${fails.length} chyb`:'\nvše ok');
process.exit(fails.length?1:0);
