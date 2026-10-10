// Kontrola backtestu (indikátory, pravidla, engine, metriky): node --experimental-strip-types scripts/check-backtest.mjs
import {sma,ema,rsi,atr,trueRange,highest,lowest} from '../lib/backtest/indicators.ts';
import {normalizeRules,rulesIssues,defaultSpread,spreadPrice,instrumentSpec,DEFAULT_RULES,DEFAULT_CONDITIONS} from '../lib/backtest/rules.ts';
import {runBacktest} from '../lib/backtest/engine.ts';
import {metrics,drawdownSeries} from '../lib/backtest/metrics.ts';
import {sessionOf} from '../lib/journal/analytics.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const near=(a,b,eps=1e-9)=>Math.abs(a-b)<=eps;
const arrEq=(a,b,eps=1e-9)=>a.length===b.length&&[...a].every((x,i)=>Number.isNaN(b[i])?Number.isNaN(x):near(x,b[i],eps));
const N=NaN;

// ---- indikátory (ručně spočtené hodnoty)
check('SMA(3)',arrEq(sma([1,2,3,4,5],3),[N,N,2,3,4]),[...sma([1,2,3,4,5],3)]);
check('SMA přes NaN (zahřívání se opakuje)',arrEq(sma([N,N,1,2,3],2),[N,N,N,1.5,2.5]),[...sma([N,N,1,2,3],2)]);
check('EMA(3): start SMA, k = 0,5',arrEq(ema([2,4,6,8,4],3),[N,N,4,6,5]),[...ema([2,4,6,8,4],3)]);
check('RSI(2) Wilder: 50 → 75 → 87,5',arrEq(rsi([1,2,1,2,3],2),[N,N,50,75,87.5]),[...rsi([1,2,1,2,3],2)]);
check('RSI: jen růst = 100, bez pohybu = 50',rsi([1,2,3],2)[2]===100&&rsi([1,1,1],2)[2]===50);
const H=[10,11,12,11],L=[8,9,9,10],C=[9,10,11,10];
check('true range',arrEq(trueRange(H,L,C),[2,2,3,1]),[...trueRange(H,L,C)]);
check('ATR(2) Wilder: 2 → 2,5 → 1,75',arrEq(atr(H,L,C,2),[N,2,2.5,1.75]),[...atr(H,L,C,2)]);
check('highest(3) / lowest(3) včetně aktuální',arrEq(highest([1,3,2,5,4],3),[N,N,3,5,5])&&arrEq(lowest([1,3,2,5,4],3),[N,N,1,2,2]));
check('highest(2) klesající řada',arrEq(highest([5,4,3,2],2),[N,5,4,3]));

// ---- pravidla
check('bod: EUR/USD 0,0001, USD/JPY 0,01, ^NDX 1',instrumentSpec('EUR/USD').pip===0.0001&&instrumentSpec('USD/JPY').pip===0.01&&instrumentSpec('^NDX').pip===1);
const ds=id=>{const d=defaultSpread(id);return d.group+':'+d.value+d.unit};
check('výchozí spread podle skupiny',[ds('EUR/USD'),ds('USD/JPY'),ds('EUR/JPY'),ds('EUR/GBP'),ds('XAUUSD'),ds('^GSPC'),ds('AAPL'),ds('BTC-USD')].join()==='fx_major:1pips,fx_major:1pips,fx_jpy:1.5pips,fx_other:2pips,metal:3pips,index:1points,stock:0.05pct,crypto:0.1pct',[ds('EUR/USD'),ds('EUR/JPY'),ds('XAUUSD'),ds('AAPL')]);
check('JPM není měnový index: akcie se spreadem 0,05 %, pip 1',ds('JPM')==='stock:0.05pct'&&instrumentSpec('JPM').group==='stock'&&instrumentSpec('USD').group==='index'&&near(spreadPrice('JPM',200,DEFAULT_RULES),0.1),ds('JPM'));
check('spread v ceně: EUR/USD 1 pip, EUR/JPY 1,5 × 0,01, AAPL 0,05 % z 200, přepis skupiny',near(spreadPrice('EUR/USD',1.1,DEFAULT_RULES),0.0001)&&near(spreadPrice('EUR/JPY',160,DEFAULT_RULES),0.015)&&near(spreadPrice('AAPL',200,DEFAULT_RULES),0.1)&&near(spreadPrice('EUR/USD',1.1,{costs:{commissionPct:0,spread:{fx_major:0.5}}}),0.00005));
const nr=normalizeRules({entry:[{type:'rsi',period:'7',op:'cross_up',value:130},{type:'nesmysl'},{type:'session',sessions:['london','xx']},{type:'weekday',days:['0',4,9]}],direction:'x',exit:{sl:{type:'pips',value:-5},tp:{type:'signal'},maxBars:'12'},sizing:{riskPct:2},costs:{commissionPct:5,spread:{fx_major:0.8,bad:3}}});
check('normalizeRules: ořez, neznámé pryč, výchozí',nr.entry.length===3&&nr.entry[0].period===7&&nr.entry[0].value===100&&nr.entry[1].sessions.join()==='london'&&nr.entry[2].days.join()==='0,4'&&nr.direction==='long'&&nr.exit.sl.type==='pips'&&nr.exit.sl.value===0.0001&&nr.exit.tp.type==='signal'&&nr.exit.maxBars===12&&nr.sizing.riskPct===2&&nr.sizing.capital===10000&&nr.costs.commissionPct===5&&JSON.stringify(nr.costs.spread)==='{"fx_major":0.8}',nr);
check('normalizeRules: idempotentní, prázdný vstup = výchozí',JSON.stringify(normalizeRules(nr))===JSON.stringify(nr)&&JSON.stringify(normalizeRules(null))===JSON.stringify(DEFAULT_RULES));
check('normalizeRules: všechny výchozí podmínky projdou beze změny',Object.values(DEFAULT_CONDITIONS).every(c=>JSON.stringify(normalizeRules({entry:[c]}).entry[0])===JSON.stringify(c)));
check('rulesIssues: prázdný vstup, rychlá ≥ pomalá',rulesIssues(DEFAULT_RULES).length===1&&rulesIssues(normalizeRules({entry:[{type:'ma_cross',fast:50,slow:20}]})).length===1&&rulesIssues(normalizeRules({entry:[DEFAULT_CONDITIONS.ma]})).length===0);

// ---- engine: syntetické svíčky
const HR=3600000,T0=Date.UTC(2026,0,5,0,0); // pondělí 00:00 UTC
const tOf=i=>T0+i*HR;
// svíčky z close: o = předchozí close, h/l = max/min(o,c); over = {i:{o,h,l,c}} přepisuje jednotlivé svíčky
function mkBars(closes,over={}){
 return closes.map((c,i)=>{const o=i?closes[i-1]:c,b={t:tOf(i),o,h:Math.max(o,c),l:Math.min(o,c),c,...(over[i]||{})};b.h=Math.max(b.h,b.o,b.c);b.l=Math.min(b.l,b.o,b.c);return b});
}
const flat=(n,v)=>Array(n).fill(v);
const base=(o={})=>({...DEFAULT_RULES,costs:{commissionPct:0,spread:{index:0}},exit:{sl:{type:'pips',value:2},tp:{type:'r',value:2},maxBars:null},...o});
const run=(rules,markets,extra={})=>runBacktest({rules,markets,tf:'H1',from:T0,to:tOf(100000),capital:10000,...extra});
// SMA(2) × SMA(3): zavření 5 → kříží nahoru na svíčce 5, vstup na open svíčky 6 = 6
const crossUp=[5,5,5,5,5,6,...flat(30,6)];
const maX={type:'ma_cross',kind:'sma',fast:2,slow:3,dir:'up'};
{
 const r=run(base({entry:[maX]}),[{instrument:'^TST',bars:mkBars(crossUp,{9:{h:10.5}})}]),t=r.trades[0];
 check('SMA cross: jeden obchod, vstup na open další svíčky',r.trades.length===1&&t.entryT===tOf(6)&&t.entryPrice===6&&t.side==='long',r.trades);
 check('TP 2R: úroveň 10, výstup 10, +2 R, +200',t.sl===4&&t.tp===10&&t.exitT===tOf(9)&&t.exitPrice===10&&t.reason==='tp'&&t.r===2&&t.pnl===200&&t.risk===100&&t.bars===4,t);
 check('equity: start + po obchodu',r.equity.length===2&&r.equity[0].equity===10000&&r.equity[0].t===T0&&r.equity[1].equity===10200&&r.equity[1].t===tOf(9),r.equity);
 check('bez dat Tradee: žádné pokrytí ani varování',Object.keys(r.coverage).length===0&&r.warnings.length===0,r);
 check('po trzích',r.perMarket.length===1&&r.perMarket[0].trades===1&&r.perMarket[0].winRate===100&&r.perMarket[0].pnl===200&&r.perMarket[0].totalR===2,r.perMarket);
}
{
 const r=run(base({entry:[maX]}),[{instrument:'^TST',bars:mkBars(crossUp,{8:{l:3.9}})}]),t=r.trades[0];
 check('SL: výstup na úrovni 4, −1 R, −100',t.reason==='sl'&&t.exitPrice===4&&t.r===-1&&t.pnl===-100&&t.exitT===tOf(8),t);
}
{
 const r=run(base({entry:[maX]}),[{instrument:'^TST',bars:mkBars(crossUp,{8:{h:11,l:3}})}]),t=r.trades[0];
 check('SL i TP v téže svíčce → SL',t.reason==='sl'&&t.r===-1,t);
}
{
 const r=run(base({entry:[maX]}),[{instrument:'^TST',bars:mkBars(crossUp,{8:{o:3,h:3.5,l:2.5,c:3}})}]),t=r.trades[0];
 check('gap přes SL → výstup na open (3), −1,5 R',t.reason==='sl'&&t.exitPrice===3&&t.r===-1.5&&t.pnl===-150,t);
 const g=run(base({entry:[maX]}),[{instrument:'^TST',bars:mkBars(crossUp,{8:{o:11,h:12,l:10.5,c:11}})}]).trades[0];
 check('gap přes TP → výstup na open (11), +2,5 R',g.reason==='tp'&&g.exitPrice===11&&g.r===2.5,g);
}
{
 const r=run(base({entry:[maX],exit:{sl:{type:'pips',value:2},tp:{type:'r',value:2},maxBars:3}}),[{instrument:'^TST',bars:mkBars([...crossUp.slice(0,8),6.5,...flat(20,6.5)])}]),t=r.trades[0];
 check('časový limit 3 svíčky: výstup na close svíčky 8',t.reason==='time'&&t.exitT===tOf(8)&&t.exitPrice===6.5&&t.bars===3&&t.r===0.25,r.trades);
}
{
 // close nad SMA(3) → long; výstup, když close spadne pod SMA (na close svíčky)
 const cl=[5,5,5,5,5,6,7,8,8,7,6,5,5,5,5];
 const r=run(base({entry:[{type:'ma',kind:'sma',period:3,op:'above'}],exit:{sl:{type:'pips',value:3},tp:{type:'signal',value:0},maxBars:null}}),[{instrument:'^TST',bars:mkBars(cl)}]),t=r.trades[0];
 // SMA3: i5=5.33 (6>), i8=7.67 (8>), i9=7.67 (7<) → výstup na close 9 = 7
 check('výstup „podmínka neplatí“ na close',r.trades.length===1&&t.entryT===tOf(6)&&t.entryPrice===6&&t.reason==='signal'&&t.exitT===tOf(9)&&t.exitPrice===7&&t.tp===null&&near(t.r,1/3,1e-4),r.trades);
}
{
 const down=[10,10,10,10,10,9,...flat(10,9)];
 const r=run(base({direction:'short',entry:[{...maX,dir:'down'}],exit:{sl:{type:'pips',value:2},tp:{type:'r',value:1},maxBars:null}}),[{instrument:'^TST',bars:mkBars(down,{8:{l:6.9}})}]),t=r.trades[0];
 check('short: SL nad vstupem, TP pod, +1 R',t.side==='short'&&t.entryPrice===9&&t.sl===11&&t.tp===7&&t.exitPrice===7&&t.reason==='tp'&&t.r===1&&t.pnl===100,t);
 const s=run(base({direction:'short',entry:[{...maX,dir:'down'}]}),[{instrument:'^TST',bars:mkBars(down,{7:{h:11.2}})}]).trades[0];
 check('short: SL zasažen high',s.reason==='sl'&&s.exitPrice===11&&s.r===-1,s);
}
{
 // EUR/USD, 1 pip spread (výchozí major), SL 10 pipů, TP 2R, komise 5 % rizika
 const cl=[1.1,1.1,1.1,1.1,1.1,1.101,...flat(10,1.101)];
 const rules=base({entry:[maX],costs:{commissionPct:5,spread:{}},exit:{sl:{type:'pips',value:10},tp:{type:'r',value:2},maxBars:null}});
 const w=run(rules,[{instrument:'EUR/USD',bars:mkBars(cl,{9:{h:1.104}})}]).trades[0];
 const R=(1.10295-1.10105)/0.0011-0.05;
 check('spread: vstup o půl spreadu horší, TP plnění o půl spreadu horší',near(w.entryPrice,1.10105)&&near(w.tp,1.103)&&near(w.exitPrice,1.10295),w);
 check('spread + komise: R = 1,7273 − 0,05',near(w.r,R,1e-4)&&near(w.pnl,Math.round(w.r*100*100)/100),{r:w.r,R});
 const l=run(rules,[{instrument:'EUR/USD',bars:mkBars(cl,{8:{l:1.0995}})}]).trades[0];
 check('SL se spreadem = přesně −1 R, komise → −1,05 R, −105',near(l.exitPrice,1.09995)&&l.r===-1.05&&l.pnl===-105,l);
}
// kontext: skóre jen v zadaných časech (signál na svíčce i ↔ t = zavření svíčky i)
const sigCtx=(map,val=50)=>({score:(inst,t)=>{const i=Math.round((t-T0)/HR)-1;return (map[inst]||[]).includes(i)?val:0}});
const scoreUp={type:'score',op:'>',value:10,days:5};
{
 const A=mkBars(flat(20,6),{9:{h:10.5}}),B=mkBars(flat(20,6),{8:{l:3.5},13:{h:10.5}});
 const r=run(base({entry:[scoreUp]}),[{instrument:'^A',bars:A},{instrument:'^B',bars:B}],{context:sigCtx({'^A':[5],'^B':[6,10]})});
 const [b1,a1,b2]=r.trades;
 check('více trhů: 3 obchody seřazené podle výstupu',r.trades.length===3&&b1.instrument==='^B'&&a1.instrument==='^A'&&b2.instrument==='^B',r.trades);
 check('více trhů: pozice současně (A 6–9, B 7–8)',a1.entryT===tOf(6)&&b1.entryT===tOf(7)&&b1.exitT<a1.exitT);
 check('sdílená equity: riziko z aktuální equity (100, 100, 101)',a1.risk===100&&b1.risk===100&&b2.risk===101&&b2.pnl===202,r.trades);
 check('equity body: 10000 → 9900 → 10100 → 10302',r.equity.map(p=>p.equity).join()==='10000,9900,10100,10302',r.equity);
 check('po trzích A/B',r.perMarket[0].trades===1&&r.perMarket[1].trades===2&&r.perMarket[1].pnl===102&&r.perMarket[1].winRate===50,r.perMarket);
}
{
 // skóre má data jen od svíčky 20; dřív by signál byl, ale bez dat → nesplněno
 const ctx={score:(inst,t)=>{const i=Math.round((t-T0)/HR)-1;return i<20?undefined:(i===25?50:0)}};
 const r=run(base({entry:[scoreUp]}),[{instrument:'^TST',bars:mkBars(flat(40,6))}],{context:ctx});
 check('podmínka bez dat: obchod jen v pokrytí',r.trades.length===1&&r.trades[0].entryT===tOf(26),r.trades);
 const c=r.coverage.score;
 check('pokrytí: první/poslední čas, počty',c&&c.first===tOf(21)&&c.last===tOf(40)&&c.bars===40&&c.missing===20,c);
 check('varování s obdobím pokrytí (česky)',r.warnings.length===1&&r.warnings[0].startsWith('Skóre Tradee: data jsou jen od 5. 1. 2026 do 6. 1. 2026')&&r.warnings[0].includes('50 % svíček bez dat'),r.warnings);
 const none=run(base({entry:[scoreUp,{type:'no_news',minutes:30,minSignal:2}]}),[{instrument:'^TST',bars:mkBars(flat(10,6))}]);
 check('bez kontextu: nikdy nesplněno + varování pro skóre i zprávy',none.trades.length===0&&none.warnings.length===2&&none.warnings.every(w=>w.includes('nejsou žádná data'))&&none.coverage.news.missing===10,none.warnings);
 const news=run(base({entry:[{type:'no_news',minutes:30,minSignal:2}],exit:{sl:{type:'pips',value:2},tp:{type:'r',value:2},maxBars:1}}),[{instrument:'^TST',bars:mkBars(flat(6,6))}],{context:{news:(inst,t)=>t===tOf(3)}});
 check('no_news: zpráva u vstupu svíčky 3 → bez vstupu na 3',news.trades.map(t=>(t.entryT-T0)/HR).join()==='1,2,4,5',news.trades.map(t=>(t.entryT-T0)/HR));
}
{
 // breakout nahoru přes maximum PŘEDCHOZÍCH 3 svíček: svíčka 6 zavře na svém maximu 7 → vstup na 7
 const cl=[5,5,5,5,5,5,7,...flat(10,7)];
 const r=run(base({entry:[{type:'breakout',period:3,dir:'up'}],exit:{sl:{type:'pips',value:2},tp:{type:'r',value:2},maxBars:1}}),[{instrument:'^TST',bars:mkBars(cl,{6:{h:7}})}]);
 check('breakout bez look-ahead: signál na close svíčky 6 (aktuální high se nepočítá), vstup na open 7',r.trades.length===1&&r.trades[0].entryT===tOf(7)&&r.trades[0].entryPrice===7,r.trades);
}
{
 const r=run(base({direction:'score',entry:[{type:'score',op:'<',value:-10,days:5}]}),[{instrument:'^TST',bars:mkBars(flat(12,6),{8:{l:3.9}})}],{context:sigCtx({'^TST':[5]},-50)}),t=r.trades[0];
 check('směr podle skóre: záporné → short',r.trades.length===1&&t.side==='short'&&t.sl===8&&t.tp===2,r.trades);
}
{
 const r=run(base({entry:[{type:'session',sessions:['london']}],exit:{sl:{type:'pips',value:2},tp:{type:'r',value:2},maxBars:1}}),[{instrument:'^TST',bars:mkBars(flat(48,6))}]);
 check('seance Londýn: vstupy jen 08–13 Praha (5 svíček/den)',r.trades.length===10&&r.trades.every(t=>sessionOf(t.entryT)==='london'),r.trades.map(t=>new Date(t.entryT).toISOString()));
 const h=run(base({entry:[{type:'hour',from:22,to:2}],exit:{sl:{type:'pips',value:2},tp:{type:'r',value:2},maxBars:1}}),[{instrument:'^TST',bars:mkBars(flat(30,6))}]);
 check('hodina přes půlnoc 22–02 Praha',h.trades.map(t=>(t.entryT-T0)/HR).join()==='21,22,23,24',h.trades.map(t=>(t.entryT-T0)/HR));
}
{
 // from/to: svíčky před from jen zahřívají, poslední otevřená pozice → 'end'
 const r=runBacktest({rules:base({entry:[maX]}),markets:[{instrument:'^TST',bars:mkBars(crossUp)}],tf:'H1',from:tOf(3),to:tOf(12),capital:5000});
 const t=r.trades[0];
 check('období: konec → výstup end na close poslední svíčky, kapitál z inputu',r.trades.length===1&&t.reason==='end'&&t.exitT===tOf(11)&&t.risk===50&&r.equity[0].t===tOf(3)&&r.perMarket[0].bars===9,r);
 const e=runBacktest({rules:base({entry:[maX]}),markets:[{instrument:'^TST',bars:mkBars(crossUp)}],tf:'H1',from:tOf(50),to:tOf(60)});
 check('trh bez svíček v období → varování',e.trades.length===0&&e.warnings[0]==='^TST: ve zvoleném období nejsou žádné svíčky.',e.warnings);
}

// ---- engine: ATR SL, procentní spread, den v týdnu, síla měn, COT
{
 // ATR(14) = 2 (každá svíčka h−l = 2) → SL = 1,5 × 2 = 3 pod vstupem 10
 const over={};for(let i=0;i<40;i++)over[i]={h:11,l:9};
 const t=run(base({entry:[scoreUp],exit:{sl:{type:'atr',value:1.5},tp:{type:'r',value:2},maxBars:null}}),[{instrument:'^TST',bars:mkBars(flat(40,10),over)}],{context:sigCtx({'^TST':[20]})}).trades[0];
 check('SL podle ATR: vzdálenost 1,5 × ATR = 3, TP 2R = 6',t&&t.entryPrice===10&&t.sl===7&&t.tp===16,t);
}
{
 const st=run(base({entry:[scoreUp],exit:{sl:{type:'pips',value:10},tp:{type:'r',value:2},maxBars:null}}),[{instrument:'AAPL',bars:mkBars(flat(30,200))}],{context:sigCtx({AAPL:[20]})}).trades[0];
 check('procentní spread akcie: 0,05 % z 200 → vstup 200,05, výstup 199,95',st&&near(st.entryPrice,200.05)&&near(st.exitPrice,199.95),st);
 const cr=run(base({entry:[scoreUp],exit:{sl:{type:'pct',value:2},tp:{type:'r',value:2},maxBars:null}}),[{instrument:'BTC-USD',bars:mkBars(flat(30,50000))}],{context:sigCtx({'BTC-USD':[20]})}).trades[0];
 check('procentní spread krypto: 0,1 % z 50 000 → vstup 50 025',cr&&near(cr.entryPrice,50025),cr);
}
{
 const bars=mkBars(flat(48,6)),wd=days=>run(base({entry:[{type:'weekday',days}],exit:{sl:{type:'pips',value:2},tp:{type:'r',value:2},maxBars:1}}),[{instrument:'^TST',bars}]).trades.map(t=>(t.entryT-T0)/HR);
 const mon=wd([0]),tue=wd([1]);
 check('den v týdnu: pondělí = 0 (T0 je pondělí; pražský den končí svíčkou 22)',mon.length>0&&mon[0]===1&&Math.max(...mon)===22&&tue[0]===23,{mon,tue});
}
{
 const eu=(strength,op='>',value=0)=>run(base({entry:[{type:'strength',op,value}],exit:{sl:{type:'pips',value:10},tp:{type:'r',value:2},maxBars:1}}),[{instrument:'EUR/USD',bars:mkBars(flat(30,1.1))}],{context:{strength:(c,t)=>strength[c]}}).trades.length;
 check('síla měn: base − quote (EUR 3, USD 1 → +2 > 0)',eu({EUR:3,USD:1})>0&&eu({EUR:1,USD:3})===0&&eu({EUR:1,USD:3},'<')>0&&eu({EUR:3,USD:1},'>',5)===0);
 check('síla měn bez dat jedné strany = bez obchodu',eu({EUR:3})===0&&eu({USD:1})===0);
}
{
 const ct=(cot,op,value=0)=>run(base({entry:[{type:'cot',op,value}],exit:{sl:{type:'pips',value:2},tp:{type:'r',value:2},maxBars:1}}),[{instrument:'^TST',bars:mkBars(flat(30,6))}],{context:{cot:()=>cot}}).trades.length;
 check('COT long/short podle znaménka netto pozice',ct({net:5,change:1},'long')>0&&ct({net:-5,change:1},'long')===0&&ct({net:-5,change:1},'short')>0&&ct({net:5,change:1},'short')===0);
 check('COT změna > / < hodnota, bez dat = bez obchodu',ct({net:5,change:10},'>',5)>0&&ct({net:5,change:3},'>',5)===0&&ct({net:5,change:3},'<',5)>0&&ct(undefined,'long')===0);
}

// ---- metriky
{
 const tr=[200,-100,-100,300].map((pnl,i)=>({instrument:'X',side:'long',entryT:i,entryPrice:1,sl:0,tp:null,exitT:i+1,exitPrice:1,reason:'tp',r:pnl/100,pnl,risk:100,bars:1}));
 const eq=[{t:0,equity:10000},{t:1,equity:10200},{t:2,equity:10100},{t:3,equity:10000},{t:4,equity:10300}];
 const m=metrics(tr,eq,10000);
 check('metriky: počty, win rate, P&L, R',m.trades===4&&m.wins===2&&m.losses===2&&m.winRate===50&&m.netPnl===300&&m.netPct===3&&m.finalEquity===10300&&m.avgR===0.75&&m.totalR===3&&m.expectancy===75,m);
 check('metriky: profit factor, průměrná výhra/ztráta, série',m.profitFactor===2.5&&m.avgWin===250&&m.avgLoss===-100&&m.longestLosingStreak===2,m);
 check('metriky: max drawdown 200 = 1,96 % z vrcholu 10200',m.maxDrawdown===200&&m.maxDrawdownPct===1.96,m);
 const z=metrics([],[{t:0,equity:10000}],10000);
 check('metriky: bez obchodů',z.trades===0&&z.winRate===null&&z.avgR===null&&z.profitFactor===null&&z.maxDrawdown===0&&z.finalEquity===10000,z);
 check('drawdown řada',drawdownSeries(eq).map(p=>p.dd).join()==='0,0,-100,-200,0',drawdownSeries(eq));
}

// ---- výkon: 28 trhů × 12 000 H1 svíček (jen výpis času)
{
 let seed=1;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
 const markets=Array.from({length:28},(_,k)=>{let p=1+k*0.1;return {instrument:'EUR/USD',bars:Array.from({length:12000},(_,i)=>{const o=p,c=o*(1+(rnd()-0.5)*0.004),h=Math.max(o,c)*(1+rnd()*0.001),l=Math.min(o,c)*(1-rnd()*0.001);p=c;return {t:T0+i*HR,o,h,l,c,v:null}})}});
 const rules=normalizeRules({entry:[{type:'ma_cross',kind:'ema',fast:20,slow:50,dir:'up'},{type:'rsi',period:14,op:'>',value:50},{type:'atr',period:100,op:'above',k:0.8},{type:'session',sessions:['london','overlap','ny']},{type:'ma',kind:'sma',period:200,op:'above'}],exit:{sl:{type:'atr',value:1.5},tp:{type:'r',value:2},maxBars:48}});
 const t0=performance.now(),r=runBacktest({rules,markets,tf:'H1',from:T0,to:T0+12000*HR}),ms=performance.now()-t0,m=metrics(r.trades,r.equity,10000);
 console.log(`info výkon: 28 × 12 000 svíček za ${Math.round(ms)} ms (${r.trades.length} obchodů, čistý P&L ${m.netPnl})`);
 check('výkon: běh doběhne a obchoduje',r.trades.length>0&&r.equity.length===r.trades.length+1);
}
if(fails.length){console.log('\n'+fails.length+' selhalo');process.exit(1)}console.log('\nvše ok');
