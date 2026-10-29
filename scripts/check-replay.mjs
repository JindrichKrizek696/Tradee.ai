// Kontrola replaye (Etapa 3B): node --experimental-strip-types scripts/check-replay.mjs
// bez nahlížení do budoucna (oříznutí / změna budoucích svíček = stejný viditelný stav i výsledek), skládání rozpracované svíčky vyššího rámce,
// vyplnění příkazů vč. gapů / limitu / stopu, nejednoznačná svíčka, spread / komise / skluz / swap, prop simulátor, záznam přetočení
// ve validačním režimu, datové panely omezené hodinami (nejbližší ≤ hodiny), izolace uživatelů v DB a vyřazení replaye ze živých statistik.
import {readFileSync} from 'node:fs';
import {aggregate,visibleBars,visibleState,bucketStart,nextClose,closeAtOrBefore,prevClose,nextSessionOpen,TF_MS,tfAllowed} from '../lib/replay/clock.ts';
import {run,tryFill,checkExit,nightsBetween,parseOrder,PropTracker,rateAt} from '../lib/replay/engine.ts';
import {summarize,tradesCsv} from '../lib/replay/results.ts';
import {atOrBefore,cotAt,cotAvailableAt,eventAt,calendarAt,macroAt,currenciesOf} from '../lib/replay/panels.ts';
import {parseSessionInput,buildSpecs,accountRules,parseDecision,checkRewind} from '../lib/replay/core.ts';
import {listSessions,getSession,createSession,deleteSession,loadEvents,appendEvent,setClock,rewindSession,saveResults,loadTrades,exportToJournal,countSessions,barsBetween,nextCloses,snapshotFor} from '../lib/replay/store.ts';
import {emptyRules} from '../lib/risk/account.ts';
import {SEED} from '../lib/risk/instruments.ts';
import {nearestAtOrBefore} from '../lib/score/pit.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)?.slice(0,500)));if(!ok)fails.push(name)};
const j=x=>JSON.stringify(x);
const src=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const H=3600000,D=86400000;
const T0=Date.UTC(2025,2,3,0,0); // pondělí 3. 3. 2025 00:00 UTC
const near=(a,b,e=1e-9)=>Math.abs(a-b)<=e;

// ---------- svíčky: syntetická H1 řada (deterministická)
function series(n,start=T0,p0=1.1,seed=1){let p=p0,s=seed;const out=[];for(let i=0;i<n;i++){s=(s*16807)%2147483647;const d=((s%2001)-1000)/1e6;const o=p,c=Math.round((p+d)*1e5)/1e5,h=Math.max(o,c)+0.0004,l=Math.min(o,c)-0.0003;out.push({t:start+i*H,o,h:Math.round(h*1e5)/1e5,l:Math.round(l*1e5)/1e5,c,v:null});p=c}return out}
const A=series(24*12),B=series(24*12,T0,1.3,7);
{
 const clock=T0+5*D+7*H;
 const full=visibleState({'EUR/USD':A,'GBP/USD':B},'H1',['H1','H4','D1','W1'],clock);
 const cut=visibleState({'EUR/USD':A.filter(b=>b.t+H<=clock),'GBP/USD':B.filter(b=>b.t+H<=clock)},'H1',['H1','H4','D1','W1'],clock);
 const mutated=x=>x.map(b=>b.t+H>clock?{...b,o:9,h:9.5,l:0.1,c:5}:b);
 const changed=visibleState({'EUR/USD':mutated(A),'GBP/USD':mutated(B)},'H1',['H1','H4','D1','W1'],clock);
 check('bez look-ahead: oříznutí budoucích svíček = stejný viditelný stav',j(full)===j(cut));
 check('bez look-ahead: změna budoucích svíček nic nezmění',j(full)===j(changed));
 check('bez look-ahead: poslední viditelná H1 končí nejpozději v čase hodin',full['EUR/USD'].H1.at(-1).t+H<=clock&&full['EUR/USD'].H1.at(-1).t+H===clock);
 check('bez look-ahead: rozpracovaná svíčka nese partial',full['EUR/USD'].D1.at(-1).partial===true&&full['EUR/USD'].D1.at(-2).partial===false&&full['EUR/USD'].W1.at(-1).partial===true);
 // engine: příkaz a výsledek se nemění, když se změní budoucnost
 const spec=eurSpec();
 const evs=[{seq:1,clock:T0+2*D,kind:'order',data:{id:'o1',symbol:'EUR/USD',side:'long',type:'market',price:null,qty:1,sl:1.05,tp:1.2}}];
 const base={base:'H1',events:evs,exec:exec(),specs:{'EUR/USD':spec},account:{currency:'USD',balance:10000,rules:null},clock,start:T0};
 const r1=run({...base,bars:{'EUR/USD':A}}),r2=run({...base,bars:{'EUR/USD':mutated(A)}}),r3=run({...base,bars:{'EUR/USD':A.filter(b=>b.t+H<=clock)}});
 check('bez look-ahead: engine dává stejný výsledek s budoucími / změněnými / oříznutými svíčkami',j(r1)===j(r2)&&j(r1)===j(r3)&&r1.orders[0].status==='filled',{a:r1.orders,b:r2.orders});
}
function eurSpec(o={}){return {symbol:'EUR/USD',instrumentId:'EURUSD',tickSize:0.00001,tickValue:1,quote:'USD',base:'EUR',lotStep:0.01,minLot:0.01,spread:0.0001,commission:7,rate:1,...o}}
function exec(o={}){return {slippageTicks:0,swap:{on:false,long:0,short:0,tripleWed:true},ambiguity:'conservative',...o}}

// ---------- vyšší rámec z uzavřených svíček
{
 const bars=[0,1,2,3,4,5].map(i=>({t:T0+i*H,o:10+i,h:20+i,l:5-i,c:11+i,v:1}));
 const h4=aggregate(bars,'H1','H4',T0+6*H);
 check('H4: první svíčka plná, druhá rozpracovaná ze 2 hodin',h4.length===2&&h4[0].partial===false&&h4[0].o===10&&h4[0].h===23&&h4[0].l===2&&h4[0].c===14&&h4[0].v===4&&h4[1].partial===true&&h4[1].t===T0+4*H&&h4[1].o===14&&h4[1].c===16&&h4[1].h===25&&h4[1].l===0,h4);
 const d1=aggregate(bars,'H1','D1',T0+3*H);
 check('D1 rozpracovaná jen z uzavřených H1 (3 svíčky)',d1.length===1&&d1[0].partial&&d1[0].c===13&&d1[0].h===22&&d1[0].l===3,d1);
 check('H4 svíčka je plná přesně v okamžiku konce koše',aggregate(bars,'H1','H4',T0+4*H)[0].partial===false&&aggregate(bars,'H1','H4',T0+4*H-1)[0].partial===true);
 check('W1 začíná v pondělí 00:00 UTC',bucketStart(T0+3*D+5*H,'W1')===T0&&bucketStart(T0-1,'W1')===T0-7*D);
 // denní FX svíčky Yahoo začínají ve 23:00 UTC předchozího dne → koš podle středu svíčky (pondělní svíčka z neděle 23:00 patří do nového týdne)
 const dd=[{t:T0-H,o:1,h:2,l:0.5,c:1.5,v:null},{t:T0+D-H,o:1.5,h:3,l:1,c:2,v:null}];
 const w=aggregate(dd,'D1','W1',T0+2*D);
 check('D1 → W1: pondělní svíčka z neděle 23:00 UTC patří do nového týdne',w.length===1&&w[0].t===T0&&w[0].o===1&&w[0].c===2&&w[0].partial,w);
 check('rámec musí být ≥ základní',tfAllowed('H1','H4')&&!tfAllowed('D1','H4')&&tfAllowed('D1','W1'));
 check('visibleBars: svíčka končící po hodinách není vidět',visibleBars(bars,'H1',T0+2*H+59*60000).length===2);
 check('nextClose / closeAtOrBefore / prevClose',nextClose(bars,'H1',T0+2*H)===T0+3*H&&nextClose(bars,'H1',T0+2*H,3)===T0+5*H&&nextClose(bars,'H1',T0+6*H)===null&&closeAtOrBefore(bars,'H1',T0+H,T0+4*H+30*60000)===T0+4*H&&prevClose(bars,'H1',T0+3*H,T0)===T0+2*H&&prevClose(bars,'H1',T0+H,T0)===T0);
 const lo=nextSessionOpen(Date.UTC(2025,2,7,12),'london');
 check('otevření seance přeskočí víkend (pá odpoledne → po 8:00 Londýn)',lo===Date.UTC(2025,2,10,8),new Date(lo).toISOString());
 check('otevření New York v létě 8:00 = 12:00 UTC',nextSessionOpen(Date.UTC(2025,6,1,3),'newyork')===Date.UTC(2025,6,1,12));
}

// ---------- vyplnění příkazů
{
 const b={t:T0,o:1.1,h:1.105,l:1.099,c:1.104,v:null},sp=0.0001,slip=0.00002;
 const m=tryFill({side:'long',type:'market',price:null},b,sp,slip),ms=tryFill({side:'short',type:'market',price:null},b,sp,slip);
 check('market long = ask otevření + skluz, short = bid otevření − skluz',near(m.price,1.10012)&&m.atOpen&&near(ms.price,1.09998),{m,ms});
 const l=tryFill({side:'long',type:'limit',price:1.0995},b,sp,slip);
 check('limit long: vyplnění na limitu uvnitř svíčky (ask low ≤ limit), bez skluzu',l&&near(l.price,1.0995)&&!l.atOpen&&!l.gap,l);
 check('limit long nevyplněn, když ask low > limit',tryFill({side:'long',type:'limit',price:1.0989},b,sp,slip)===null);
 const lg=tryFill({side:'long',type:'limit',price:1.0995},{...b,o:1.098,l:1.0975},sp,slip);
 check('limit long při gapu dolů: vyplnění na otevření (lepší cena)',lg&&near(lg.price,1.0981)&&lg.atOpen&&lg.gap,lg);
 const ls=tryFill({side:'short',type:'limit',price:1.104},b,sp,slip);
 check('limit short: bid high ≥ limit',ls&&near(ls.price,1.104)&&!ls.atOpen,ls);
 const st=tryFill({side:'long',type:'stop',price:1.102},b,sp,slip);
 check('stop long uvnitř svíčky: úroveň + skluz',st&&near(st.price,1.10202)&&!st.gap,st);
 const sg=tryFill({side:'long',type:'stop',price:1.102},{...b,o:1.103,h:1.106},sp,slip);
 check('stop long při gapu nahoru: otevření (ask) + skluz, gap',sg&&near(sg.price,1.10312)&&sg.gap&&sg.atOpen,sg);
 const ss=tryFill({side:'short',type:'stop',price:1.1},{...b,o:1.0995,l:1.098},sp,slip);
 check('stop short při gapu dolů: bid otevření − skluz',ss&&near(ss.price,1.09948)&&ss.gap,ss);
 check('stop short nevyplněn nad úrovní',tryFill({side:'short',type:'stop',price:1.098},b,sp,slip)===null);
 // výstupy
 const pos={side:'long',sl:1.095,tp:1.11};
 const gapSl=checkExit(pos,{t:T0,o:1.09,h:1.093,l:1.088,c:1.091},sp,slip,'conservative',null);
 check('gap přes SL: výstup na otevření − skluz (horší než SL), gap',gapSl.price!==null&&near(gapSl.price,1.08998)&&gapSl.reason==='sl'&&gapSl.gap,gapSl);
 const gapTp=checkExit(pos,{t:T0,o:1.115,h:1.12,l:1.114,c:1.118},sp,slip,'conservative',null);
 check('gap přes TP: výstup na otevření (lepší), bez skluzu',near(gapTp.price,1.115)&&gapTp.reason==='tp'&&gapTp.gap);
 const both={t:T0,o:1.1,h:1.112,l:1.094,c:1.1};
 const c=checkExit(pos,both,sp,slip,'conservative',null),o=checkExit(pos,both,sp,slip,'optimistic',null);
 check('SL i TP v jedné svíčce → nejednoznačné: konzervativně SL, optimisticky TP',c.reason==='sl'&&c.ambiguous&&near(c.price,1.09498)&&o.reason==='tp'&&o.ambiguous&&near(o.price,1.11),{c,o});
 const sh=checkExit({side:'short',sl:1.105,tp:1.095},{t:T0,o:1.1,h:1.1049,l:1.096,c:1.1},sp,0,'conservative',null);
 check('short: SL podle ask (bid high + spread ≥ SL), TP podle ask low',sh.reason==='sl'&&near(sh.price,1.105),sh);
 const shTp=checkExit({side:'short',sl:1.2,tp:1.095},{t:T0,o:1.1,h:1.101,l:1.0948,c:1.1},sp,0,'conservative',null);
 check('short TP: ask low (1.0949) ≤ TP',shTp.reason==='tp'&&near(shTp.price,1.095),shTp);
 const ent=checkExit(pos,{t:T0,o:1.1,h:1.111,l:1.099,c:1.1},sp,0,'conservative','limit');
 check('vstup limitem uvnitř svíčky a TP v téže svíčce → nejednoznačné, konzervativně neplatí',ent.price===null&&ent.ambiguous,ent);
 const entO=checkExit(pos,{t:T0,o:1.1,h:1.111,l:1.099,c:1.1},sp,0,'optimistic','limit');
 check('… optimisticky TP platí (označeno)',entO.price!==null&&entO.reason==='tp'&&entO.ambiguous,entO);
}

// ---------- engine: spread, komise, skluz, R
{
 const bars=[{t:T0,o:1.1,h:1.105,l:1.099,c:1.104,v:null},{t:T0+H,o:1.104,h:1.1101,l:1.103,c:1.11,v:null},{t:T0+2*H,o:1.11,h:1.111,l:1.109,c:1.11,v:null}];
 const ev=[{seq:1,clock:T0,kind:'order',data:{id:'o1',symbol:'EUR/USD',side:'long',type:'market',price:null,qty:1,sl:1.095,tp:1.11}}];
 const r=run({bars:{'EUR/USD':bars},base:'H1',events:ev,exec:exec(),specs:{'EUR/USD':eurSpec()},account:{currency:'USD',balance:10000,rules:null},clock:T0+3*H,start:T0});
 const t=r.trades[0];
 check('market long: vstup na ask (1.1001), výstup TP 1.1100',t&&near(t.entry,1.1001)&&near(t.exit,1.11)&&t.reason==='tp',t);
 check('P&L: hrubě 990, komise 7, čistě 983, spread 10 USD, R = 983 / 510',t.gross===990&&t.commission===7&&t.net===983&&t.spreadCost===10&&t.plannedRisk===510&&t.r===1.93,t);
 check('zůstatek po obchodu',r.balance===10983&&r.equity===10983&&r.open.length===0);
 const rs=run({bars:{'EUR/USD':bars},base:'H1',events:ev,exec:exec({slippageTicks:10}),specs:{'EUR/USD':eurSpec()},account:{currency:'USD',balance:10000,rules:null},clock:T0+3*H,start:T0});
 check('skluz 10 ticků: vstup 1.1002, náklad skluzu 10 USD',near(rs.trades[0].entry,1.1002)&&rs.trades[0].slippageCost===10&&rs.trades[0].net===973,rs.trades[0]);
 const jpy={...eurSpec(),symbol:'USD/JPY',instrumentId:'USDJPY',tickSize:0.001,tickValue:1,quote:'JPY',base:'USD',spread:0,commission:0,rate:0.0067};
 check('kurz: základní měna = měna účtu → 1/cena (přesně), jinak pevný',near(rateAt(jpy,150,'USD'),1/150)&&rateAt(jpy,150,'EUR')===0.0067&&rateAt(eurSpec(),1.1,'USD')===1);
 // ruční zavření na otevření další svíčky (bid − skluz)
 const ev2=[...ev.map(e=>({...e,data:{...e.data,tp:null}})),{seq:2,clock:T0+H,kind:'close',data:{orderId:'o1'}}];
 const rc=run({bars:{'EUR/USD':bars},base:'H1',events:ev2,exec:exec(),specs:{'EUR/USD':eurSpec()},account:{currency:'USD',balance:10000,rules:null},clock:T0+3*H,start:T0});
 check('ruční zavření: na otevření další svíčky',rc.trades[0].reason==='manual'&&near(rc.trades[0].exit,1.104)&&rc.trades[0].exitTs===T0+H,rc.trades[0]);
 // zrušení čekajícího limitu
 const ev3=[{seq:1,clock:T0,kind:'order',data:{id:'o2',symbol:'EUR/USD',side:'long',type:'limit',price:1.05,qty:1,sl:1.04,tp:null}},{seq:2,clock:T0+H,kind:'cancel',data:{orderId:'o2'}}];
 const rz=run({bars:{'EUR/USD':bars},base:'H1',events:ev3,exec:exec(),specs:{'EUR/USD':eurSpec()},account:{currency:'USD',balance:10000,rules:null},clock:T0+3*H,start:T0});
 check('zrušený limit zůstane v příkazech jako cancelled',rz.orders[0].status==='cancelled'&&!rz.trades.length);
 // zneplatněné události (přetočení) se nepočítají
 const rv=run({bars:{'EUR/USD':bars},base:'H1',events:ev.map(e=>({...e,void:true})),exec:exec(),specs:{'EUR/USD':eurSpec()},account:{currency:'USD',balance:10000,rules:null},clock:T0+3*H,start:T0});
 check('zneplatněné události se do výsledku nepočítají',!rv.orders.length&&!rv.trades.length);
 // gap přes SL v engine
 const gb=[{t:T0,o:1.1,h:1.101,l:1.099,c:1.1,v:null},{t:T0+H,o:1.09,h:1.091,l:1.089,c:1.09,v:null}];
 const rg=run({bars:{'EUR/USD':gb},base:'H1',events:[{seq:1,clock:T0,kind:'order',data:{id:'o1',symbol:'EUR/USD',side:'long',type:'market',price:null,qty:1,sl:1.095,tp:null}}],exec:exec(),specs:{'EUR/USD':eurSpec()},account:{currency:'USD',balance:10000,rules:null},clock:T0+2*H,start:T0});
 check('engine: gap přes SL → výstup na otevření 1.0900, příznak gap',near(rg.trades[0].exit,1.09)&&rg.trades[0].gap&&rg.trades[0].reason==='sl',rg.trades[0]);
 // nejednoznačná svíčka v engine
 const ab=[{t:T0,o:1.1,h:1.101,l:1.099,c:1.1,v:null},{t:T0+H,o:1.1,h:1.115,l:1.09,c:1.1,v:null}];
 const ra=run({bars:{'EUR/USD':ab},base:'H1',events:ev,exec:exec(),specs:{'EUR/USD':eurSpec()},account:{currency:'USD',balance:10000,rules:null},clock:T0+2*H,start:T0});
 const ro=run({bars:{'EUR/USD':ab},base:'H1',events:ev,exec:exec({ambiguity:'optimistic'}),specs:{'EUR/USD':eurSpec()},account:{currency:'USD',balance:10000,rules:null},clock:T0+2*H,start:T0});
 check('engine: nejednoznačná svíčka označená, politika rozhodne SL / TP',ra.trades[0].ambiguous&&ra.trades[0].reason==='sl'&&ro.trades[0].ambiguous&&ro.trades[0].reason==='tp');
 const sm=summarize(ra.trades,ev,10000,null,'learn');
 check('výsledky: počet nejednoznačných',sm.ambiguous===1&&sm.n===1);
 // swap
 check('swap: noci přes rollover 21:00 UTC, středa 3×, víkend nic',nightsBetween(T0,T0+D,false)===1&&nightsBetween(T0,T0+3*D,true)===5&&nightsBetween(Date.UTC(2025,2,8,0),Date.UTC(2025,2,9,23),true)===0&&nightsBetween(T0+22*H,T0+D,false)===0);
 const swapBars=[{t:T0,o:1.1,h:1.101,l:1.099,c:1.1,v:null},{t:T0+2*D,o:1.1,h:1.101,l:1.099,c:1.1,v:null}];
 const rsw=run({bars:{'EUR/USD':swapBars},base:'H1',events:[ev[0],{seq:2,clock:T0+H,kind:'close',data:{orderId:'o1'}}],exec:exec({swap:{on:true,long:-5,short:2,tripleWed:true}}),specs:{'EUR/USD':eurSpec({commission:0})},account:{currency:'USD',balance:10000,rules:null},clock:T0+2*D+H,start:T0});
 check('swap: 2 noci × −5 USD × 1 lot',rsw.trades[0].nights===2&&rsw.trades[0].swap===-10,rsw.trades[0]);
}

// ---------- prop simulátor
{
 const rules=emptyRules();rules.dailyLoss={type:'amount',value:300,base:'dayStart',ref:'equity',reset:'00:00',tz:'UTC'};
 const bars=[{t:T0,o:1.1,h:1.101,l:1.0999,c:1.1,v:null},{t:T0+H,o:1.1,h:1.1001,l:1.096,c:1.098,v:null},{t:T0+2*H,o:1.098,h:1.12,l:1.097,c:1.12,v:null}];
 const ev=[{seq:1,clock:T0,kind:'order',data:{id:'o1',symbol:'EUR/USD',side:'long',type:'market',price:null,qty:1,sl:null,tp:null}},{seq:2,clock:T0+2*H,kind:'order',data:{id:'o2',symbol:'EUR/USD',side:'long',type:'market',price:null,qty:1,sl:null,tp:null}}];
 const r=run({bars:{'EUR/USD':bars},base:'H1',events:ev,exec:exec(),specs:{'EUR/USD':eurSpec({commission:0})},account:{currency:'USD',balance:10000,rules},clock:T0+3*H,start:T0});
 check('prop: denní ztráta 300 (nejhorší equity uvnitř svíčky −410) → porušení',r.breach&&r.breach.reason==='daily'&&r.breach.ts===T0+2*H,r.breach);
 check('prop: porušení zavře pozice (důvod breach) a další události se ignorují',r.trades.length===1&&r.trades[0].reason==='breach'&&!r.orders.some(o=>o.id==='o2'&&o.status==='filled'),r.orders);
 const s=summarize(r.trades,ev,10000,r.breach,'validate');
 check('prop: výsledky uvedou porušení pravidla',s.breaches.length===1&&s.breaches[0].reason==='daily');
 const rules2=emptyRules();rules2.drawdown={type:'static',mode:'pct',value:5,ref:'balance',when:'intraday',lockAtStart:false};
 const p=new PropTracker(rules2,10000);
 check('prop: statický DD 5 % podle zůstatku',p.point(T0,9600,9600,9500)===null&&p.point(T0+H,9500,9500,9400)?.reason==='drawdown');
 const rules3=emptyRules();rules3.drawdown={type:'trailing',mode:'amount',value:500,ref:'equity',when:'intraday',lockAtStart:true};
 const q=new PropTracker(rules3,10000);q.point(T0,10000,10400,10300);
 check('prop: trailing intraday – hranice se posune s vrcholem (10 400 − 500)',q.point(T0+H,10000,9950,9950)===null&&q.state.drawdown.floor===9900&&q.point(T0+2*H,10000,9900,9890)?.reason==='drawdown',q.state);
 const q2=new PropTracker(rules3,10000);q2.point(T0,10000,11000,11000);
 check('prop: trailing se zastaví na startu (lockAtStart)',q2.state.drawdown.floor===10000);
 const rules4=emptyRules();rules4.dailyLoss={type:'pct',value:5,base:'dayStart',ref:'balance',reset:'00:00',tz:'UTC'};
 const q3=new PropTracker(rules4,10000);q3.point(T0+H,10400,10400,10400);
 check('prop: denní limit se počítá od zůstatku na začátku dne',q3.point(T0+D+H,9950,9950,9950)===null&&q3.state.daily.limit===520&&q3.point(T0+D+2*H,9870,9870,9870)?.reason==='daily',q3.state);
}

// ---------- výsledky, přetočení a validace
{
 const tr=(id,net,r,exitTs)=>({id,orderId:id,symbol:'EUR/USD',side:'long',qty:1,entryTs:exitTs-H,entry:1,exitTs,exit:1,reason:'tp',sl:null,tp:null,gross:net,commission:0,swap:0,spreadCost:0,slippageCost:0,net,plannedRisk:100,r,ambiguous:false,gap:false,nights:0,decisionId:null});
 const trades=[tr('a',200,2,T0+H),tr('b',-100,-1,T0+2*H),tr('c',-100,-1,T0+3*H),tr('d',300,3,T0+4*H)];
 const ev=[{seq:1,clock:T0,kind:'decision',data:{choice:'long'}},{seq:2,clock:T0,kind:'decision',data:{choice:'none'}},{seq:3,clock:T0+H,kind:'decision',data:{choice:'none'},void:true},{seq:4,clock:T0,kind:'rewind',data:{from:T0+2*H,to:T0}}];
 const s=summarize(trades,ev,10000,null,'validate');
 check('výsledky: P&L, PF, očekávaná hodnota, R, max DD',s.pnl===300&&s.pf===2.5&&s.expectancy===75&&s.totalR===3&&s.avgR===0.75&&s.maxDD===200&&s.winRate===50&&s.endBalance===10300,s);
 check('výsledky: rozhodnutí vč. bez obchodu (zneplatněná se nepočítají)',s.decisions.long===1&&s.decisions.none===1&&s.decisions.total===2,s.decisions);
 check('validační režim: přetočení se zapíše a seance není čistá',s.integrity.rewinds===1&&s.integrity.ok===false);
 check('výukový režim: přetočení nevadí',summarize(trades,ev,10000,null,'learn').integrity.ok===true);
 check('checkRewind: jen zpět a ne před start',checkRewind(T0+H,T0+2*H,T0)===T0+H&&typeof checkRewind(T0+3*H,T0+2*H,T0)==='string'&&checkRewind(T0-5*H,T0+2*H,T0)===T0);
 const csv=tradesCsv(trades);
 check('CSV obchodů',csv.split('\n').length===5&&csv.startsWith('id;trh;směr'));
}

// ---------- datové panely omezené hodinami
{
 const snaps=[{at:'2025-03-01T10:00:00.000Z',v:1},{at:'2025-03-02T10:00:00.000Z',v:2},{at:'2025-03-04T10:00:00.000Z',v:3}];
 const t=Date.parse('2025-03-03T00:00:00Z');
 check('skóre: nejbližší snímek ≤ hodiny (ne pozdější)',atOrBefore(snaps,t,x=>Date.parse(x.at)).v===2&&nearestAtOrBefore(snaps,t).v===2&&atOrBefore(snaps,Date.parse('2025-02-01'),x=>Date.parse(x.at))===null);
 const hist=[{date:'2025-02-25',openInterest:100,groups:{leveraged:{long:10,short:5,net:5}}},{date:'2025-03-04',openInterest:100,groups:{leveraged:{long:20,short:5,net:15}}}];
 // report k úterý 4. 3. se zveřejní v pátek 7. 3. 15:30 ET → dostupný od 7. 3. 21:00 UTC
 const fri=Date.UTC(2025,2,7,21);
 check('COT podle data zveřejnění: v pátek odpoledne ještě starý report',cotAt('EUR',hist,fri-1).date==='2025-02-25'&&cotAt('EUR',hist,fri).date==='2025-03-04'&&cotAt('EUR',hist,fri).change===10&&cotAvailableAt('2025-03-04')===fri);
 check('COT: před prvním zveřejněním nic',cotAt('EUR',hist,Date.UTC(2025,1,26))===null);
 const at=Date.UTC(2025,2,5,13,30),e={id:'ff_1',currency:'USD',title:'CPI m/m',impact:'High',scheduledAt:at-D,at,firstSeen:at-5*D,lastSeen:at+D,forecast:'0.3%',previous:'0.2%',actual:'0.5%',actualFirst:'0.4%',actualAt:at+30*D};
 const ch=[{eventId:'ff_1',kind:'time',old:new Date(at-D).toISOString(),new:new Date(at).toISOString(),seenAt:at-2*D},{eventId:'ff_1',kind:'forecast',old:'0.2%',new:'0.3%',seenAt:at-H},{eventId:'ff_1',kind:'revision',old:'0.4%',new:'0.5%',seenAt:at+20*D}];
 const before=eventAt(e,ch,at-3*D),justBefore=eventAt(e,ch,at-30*60000),after=eventAt(e,ch,at+H),late=eventAt(e,ch,at+25*D);
 check('kalendář: termín, jak byl známý (posun zachycený později → starý termín)',before.at===at-D&&before.timeMovedLater&&justBefore.at===at,{before,justBefore});
 check('kalendář: odhad jen se změnami zachycenými do hodin',before.forecast==='0.2%'&&justBefore.forecast==='0.3%');
 check('kalendář: skutečnost až po vydání, první hodnota; revize až po zachycení',justBefore.actual===null&&!justBefore.released&&after.actual==='0.4%'&&late.actual==='0.5%',{after,late});
 check('kalendář: událost zachycená až po hodinách → odhad neznámý',eventAt({...e,firstSeen:at+D},[],at-H).forecast===null&&eventAt({...e,firstSeen:at+D},[],at-H).lateCapture);
 const cal=calendarAt([e,{...e,id:'ff_2',title:'NFP',at:at+2*D,scheduledAt:at+2*D},{...e,id:'ff_3',currency:'JPY'}],ch,at+H,['USD','EUR']);
 check('kalendář panel: vydané / nadcházející, jen měny seance',cal.past.length===1&&cal.past[0].id==='ff_1'&&cal.next.length===1&&cal.next[0].id==='ff_2'&&cal.next[0].actual===null,cal);
 const mac=macroAt([e,{...e,id:'ff_4',at:at+10*D}],ch,at+H,['USD']);
 check('makro: jen hodnoty vydané do hodin',mac.length===1&&mac[0].id==='ff_1'&&mac[0].actual==='0.4%',mac);
 check('měny seance',j(currenciesOf(['EUR/USD','GBP/JPY','GC=F']))==='["EUR","USD","GBP","JPY"]');
}

// ---------- vstup seance a specifikace
{
 const ids=new Set(['EUR/USD','GC=F','USD/JPY']),now=Date.UTC(2026,9,1);
 const v=parseSessionInput({symbols:['EUR/USD','XXX','EUR/USD'],start:'2025-03-03T08:00:00Z',baseTf:'H1',tfs:['H1','D1','M5'],mode:'validate',decideN:'5',exec:{spreadMode:'fixed',spreadTicks:12,commission:7,slippageTicks:2,ambiguity:'optimistic'},account:{source:'template',templateId:'challenge_static',balance:'100000',currency:'USD'}},ids,['USD','EUR'],now);
 check('vstup: trhy bez duplicit a neznámých, rámce ≥ základní, režim, N',typeof v==='object'&&j(v.symbols)==='["EUR/USD"]'&&j(v.tfs)==='["H1","D1"]'&&v.mode==='validate'&&v.decideN===5&&v.exec.ambiguity==='optimistic'&&v.account.balance===100000,v);
 check('vstup: chyby',typeof parseSessionInput({symbols:[]},ids,['USD'],now)==='string'&&typeof parseSessionInput({symbols:['EUR/USD'],start:'2030-01-01'},ids,['USD'],now)==='string'&&typeof parseSessionInput({symbols:['EUR/USD'],start:'2025-01-01',account:{currency:'USD',balance:0}},ids,['USD'],now)==='string'&&typeof parseSessionInput({symbols:['EUR/USD','GC=F','USD/JPY','A','B'].map(x=>x),start:'2025-01-01',account:{currency:'USD',balance:1}},new Set(['EUR/USD','GC=F','USD/JPY','A','B']),['USD'],now)==='string');
 const r=accountRules(v.account,null);
 check('pravidla replay účtu ze šablony (challenge: denní 5 %, statický DD 10 %)',r.dailyLoss.value===5&&r.drawdown.type==='static'&&r.drawdown.value===10);
 const rate=(a,b)=>a==='JPY'&&b==='USD'?0.0067:a==='USD'&&b==='EUR'?0.9:null;
 const sp=buildSpecs(['EUR/USD','USD/JPY','GC=F'],SEED,{XAUUSD:{spread:0.3,commission:5}},{...v.exec,spreadMode:'registry',commissionMode:'registry'},rate,'USD');
 check('specifikace: registr instrumentů (spread z přepisu účtu, jinak pevný v ticích)',typeof sp==='object'&&near(sp.specs['EUR/USD'].spread,0.00012)&&sp.specs['GC=F'].instrumentId==='XAUUSD'&&sp.specs['GC=F'].spread===0.3&&sp.specs['GC=F'].commission===5&&sp.specs['EUR/USD'].commission===7&&sp.specs['USD/JPY'].rate===0.0067&&sp.specs['USD/JPY'].base==='USD'&&sp.notes.some(n=>n.includes('proxy')),sp);
 check('specifikace: chybějící kurz = chyba',typeof buildSpecs(['EUR/USD'],SEED,{},v.exec,()=>null,'CZK')==='string');
 const spec={'EUR/USD':eurSpec()};
 check('příkaz: validace (min. objem, strana SL/TP u limitu)',typeof parseOrder({symbol:'EUR/USD',side:'long',type:'market',qty:1},spec,'o1')==='object'&&typeof parseOrder({symbol:'EUR/USD',side:'long',type:'market',qty:0.001},spec,'o1')==='string'&&typeof parseOrder({symbol:'EUR/USD',side:'long',type:'limit',price:1.1,sl:1.2,qty:1},spec,'o1')==='string'&&typeof parseOrder({symbol:'EUR/USD',side:'short',type:'stop',price:1.1,tp:1.2,qty:1},spec,'o1')==='string'&&typeof parseOrder({symbol:'X',side:'long',type:'market',qty:1},spec,'o1')==='string');
 const dec=parseDecision({symbol:'EUR/USD',choice:'none',note:' čekám ',states:{abcdefgh:'met',bad:'met',ijklmnop:'x'}},['EUR/USD']);
 check('rozhodnutí: bez obchodu, tří-stavové stavy',dec.choice==='none'&&dec.note==='čekám'&&j(dec.states)==='{"abcdefgh":"met"}'&&typeof parseDecision({symbol:'EUR/USD',choice:'maybe'},['EUR/USD'])==='string');
}

// ---------- DB: izolace uživatelů, přetočení, uložení výsledků a Deník
function fakeDb(rows={}){
 const log=[];
 const db={log,prepare(sql){const make=p=>({bind:(...x)=>make(x),
  async run(){log.push({sql,p});return {success:true,meta:{changes:1,last_row_id:1}}},
  async first(){log.push({sql,p});if(/COALESCE\(MAX\(seq\)/.test(sql))return {s:3,n:3};if(/FROM replay_sessions WHERE id=\?/.test(sql))return rows.session??null;if(/COUNT\(\*\) AS n FROM replay_sessions/.test(sql))return {n:2};return null},
  async all(){log.push({sql,p});if(/FROM replay_events/.test(sql))return {results:rows.events??[]};if(/FROM replay_trades/.test(sql))return {results:rows.trades??[]};if(/FROM market_bars/.test(sql))return {results:rows.bars??[]};if(/FROM replay_sessions/.test(sql))return {results:rows.session?[rows.session]:[]};return {results:[]}}});return make([])}};
 return db;
}
{
 const cfg={exec:exec(),execInput:{},specs:{'EUR/USD':eurSpec()},account:{currency:'USD',balance:10000,rules:null,name:'Replay',source:'template',templateId:'empty',profileId:null},strategy:null,notes:[]};
 const srow={id:'rp_1',name:'Test',mode:'validate',status:'active',symbols:'["EUR/USD"]',base_tf:'H1',tfs:'["H1","H4"]',start_ts:T0,clock:T0+3*H,decide_n:null,reveal_until:null,rewinds:0,resets:0,config:JSON.stringify(cfg),results:null,journaled:0,created:'2026-10-01 10:00:00',updated:'2026-10-01 10:00:00',ended_at:null};
 const bars=[{t:T0,o:1.1,h:1.105,l:1.099,c:1.104,v:null},{t:T0+H,o:1.104,h:1.1101,l:1.103,c:1.11,v:null},{t:T0+2*H,o:1.11,h:1.111,l:1.109,c:1.11,v:null}];
 const evRows=[{seq:1,clock:T0,kind:'order',data:JSON.stringify({id:'o1',symbol:'EUR/USD',side:'long',type:'market',price:null,qty:1,sl:1.095,tp:1.11}),void:0},{seq:2,clock:T0,kind:'decision',data:JSON.stringify({id:'d1',symbol:'EUR/USD',choice:'long',snapshot:{strategyId:'str_1',versionId:'v1_str_1',model:null,items:[]}}),void:0}];
 const trRow={session_id:'rp_1',id:'t1',user_id:'u1',order_id:'o1',symbol:'EUR/USD',side:'long',qty:1,entry_ts:T0,entry_price:1.1001,exit_ts:T0+H,exit_price:1.11,exit_reason:'tp',sl:1.095,tp:1.11,gross:990,commission:7,swap:0,spread_cost:10,slippage_cost:0,net:983,planned_risk:610,r:1.61,ambiguous:0,gap:0,decision_id:null,plan_snapshot:JSON.stringify({strategyId:'str_1',versionId:'v1_str_1',model:null}),journal_trade_id:null};
 const D1=fakeDb({session:srow,events:evRows,trades:[trRow],bars});
 const s=await getSession(D1,'u1','rp_1');
 check('getSession: config a hodiny',s&&s.clock===T0+3*H&&s.config.specs['EUR/USD'].tickSize===0.00001&&s.mode==='validate');
 await listSessions(D1,'u1');await countSessions(D1,'u1');
 await createSession(D1,'u1',{name:'X',symbols:['EUR/USD'],start:T0,baseTf:'H1',tfs:['H1'],mode:'learn',decideN:3,exec:{},account:{},strategyId:null,versionId:null},cfg);
 const evs=await loadEvents(D1,'u1','rp_1');
 await appendEvent(D1,'u1','rp_1',T0+3*H,'order',{id:'o9'});
 await setClock(D1,'u1','rp_1',T0+4*H,null);
 const before=D1.log.length;
 await rewindSession(D1,'u1',s,T0+H,'rewind');
 const rw=D1.log.slice(before);
 check('přetočení: zneplatní pozdější události (kromě rewind/reset), zapíše rewind a zvýší počitadlo',rw.some(l=>/UPDATE replay_events SET void=1[\s\S]*clock>\?[\s\S]*NOT IN \('rewind','reset'\)/.test(l.sql)&&l.p[2]===T0+H)&&rw.some(l=>/INSERT INTO replay_events/.test(l.sql)&&l.p[4]==='rewind'&&l.p[5]===j({from:T0+3*H,to:T0+H}))&&rw.some(l=>/rewinds=rewinds\+1/.test(l.sql)),rw.map(l=>l.sql.slice(0,90)));
 const b2=D1.log.length;await rewindSession(D1,'u1',s,T0,'reset');
 check('reset: zneplatní vše od startu a zvýší resets',D1.log.slice(b2).some(l=>/clock>=\?/.test(l.sql)&&l.p[2]===T0)&&D1.log.slice(b2).some(l=>/resets=resets\+1/.test(l.sql)));
 const saved=await saveResults(D1,'u1',s,{'EUR/USD':bars},evs,true);
 check('uložení: přepočet ze záznamu událostí, obchod se snímkem checklistu',saved.res.trades.length===1&&saved.status==='ended'&&D1.log.some(l=>/INSERT IGNORE INTO replay_trades/.test(l.sql)&&String(l.p[25]).includes('v1_str_1')),saved.summary);
 check('snímek checklistu: z rozhodnutí stejného směru před vstupem',snapshotFor(saved.res.trades[0],evs)?.versionId==='v1_str_1');
 const tr=await loadTrades(D1,'u1','rp_1');
 const b3=D1.log.length,n=await exportToJournal(D1,'u1',{...s,status:'ended'});
 const jl=D1.log.slice(b3);
 check('Deník: ruční zápis + trade_meta s režimem replay + plán strategie',n===1&&tr.length===1&&jl.some(l=>/INSERT INTO trades\(/.test(l.sql)&&l.p[1]==='u1'&&l.p[3]==='EUR/USD'&&l.p[4]===983)&&jl.some(l=>/INSERT INTO trade_meta[\s\S]*'replay'/.test(l.sql)&&/^man:rp/.test(l.p[1]))&&jl.some(l=>/INSERT INTO trade_plans/.test(l.sql)&&l.p[3]==='v1_str_1'),jl.map(l=>l.sql.slice(0,70)));
 await barsBetween(D1,'EUR/USD','H1',T0,T0+3*H);await nextCloses(D1,'EUR/USD','H1',T0,5);
 await deleteSession(D1,'u1','rp_1');
 const MY=/replay_(sessions|events|orders|trades)/;
 const bad=D1.log.filter(l=>MY.test(l.sql)&&!/^INSERT/.test(l.sql)&&!(/user_id=\?/.test(l.sql)&&l.p.includes('u1')));
 check('izolace: každý SELECT/UPDATE/DELETE nad replay_* filtruje user_id přihlášeného',bad.length===0&&D1.log.length>20,bad.map(l=>l.sql.slice(0,120)));
 const ins=D1.log.filter(l=>MY.test(l.sql)&&/^INSERT/.test(l.sql));
 check('izolace: každý INSERT do replay_* zapisuje user_id',ins.length>3&&ins.every(l=>l.p.includes('u1')),ins.map(l=>l.sql.slice(0,60)));
 const bq=D1.log.filter(l=>/FROM market_bars/.test(l.sql));
 check('svíčky: dotazy do archivu jen do hodin (t < hodiny − délka + 1)',bq.some(l=>/t>=\? AND t<\?/.test(l.sql)&&l.p[3]===T0+3*H-H+1),bq.map(l=>l.p));
}
// stejné svíčky z jednoho velkého a z postupných dotazů (oprava otevření denních FX svíček potřebuje předchozí svíčku)
{
 const daily=Array.from({length:30},(_,i)=>({t:T0-D-H+i*D,o:1+i/100,h:1.1+i/100,l:0.9+i/100,c:1.005+i/100,v:null}));
 const db={prepare(sql){const make=p=>({bind:(...x)=>make(x),async all(){const [inst,tf,from,to]=p;return {results:daily.filter(b=>b.t>=from&&b.t<to)}}});return make([])}};
 const all=await barsBetween(db,'EUR/USD','D1',T0-2*D,T0+28*D);
 const parts=[...await barsBetween(db,'EUR/USD','D1',T0-2*D,T0+10*D),...await barsBetween(db,'EUR/USD','D1',T0+10*D,T0+28*D)];
 check('svíčky po částech = jeden dotaz (i s opravou otevření D1 FX)',j(all)===j(parts)&&all.length>20&&all[5].o===daily[4].c,{a:all.slice(0,3),b:parts.slice(0,3)});
}

// ---------- API, migrace, živé statistiky, důvěrnost
{
 const routes=['app/api/replay/sessions/route.ts','app/api/replay/sessions/[id]/route.ts','app/api/replay/sessions/[id]/panels/route.ts','app/api/replay/sessions/[id]/export/route.ts'];
 check('API: identity() všude, sameOrigin u každé změny',routes.every(r=>/identity\(req\)/.test(src(r)))&&routes.every(r=>(src(r).match(/export async function (POST|PUT|PATCH|DELETE)/g)||[]).length===(src(r).match(/sameOrigin\(req\)/g)||[]).length));
 const panels=src('app/api/replay/sessions/[id]/panels/route.ts');
 check('API panely: čas bere ze seance (s.clock), ne z dotazu',/const clock=s\.clock/.test(panels)&&!/searchParams/.test(panels));
 const act=src('app/api/replay/sessions/[id]/route.ts');
 check('API: posun hodin respektuje „rozhodni, pak odkryj“ a validace vyžaduje potvrzení přetočení',/s\.revealUntil<=s\.clock/.test(act)&&/s\.mode==='validate'&&b\.confirm!==true/.test(act)&&/appendEvent\(d,u\.id,id,s\.clock/.test(act));
 const mig=src('drizzle/mariadb/0042_replay.sql');
 check('migrace 0042: 4 tabulky s user_id a oddělovače',['replay_sessions','replay_events','replay_orders','replay_trades'].every(t=>new RegExp('CREATE TABLE IF NOT EXISTS '+t+'\\([\\s\\S]*?user_id VARCHAR\\(128\\) NOT NULL').test(mig))&&mig.split('--> statement-breakpoint').length===4);
 const ex=/m\.mode='replay'/;
 check('živé statistiky: replay vyřazen z /api/trades, stavu profilu účtu a dashboardu',ex.test(src('app/api/trades/route.ts'))&&ex.test(src('lib/risk/store.ts'))&&/mode!=='replay'/.test(src('app/my-trading.tsx'))&&/mode!=='replay'/.test(src('app/discipline-tile.tsx')));
 const all=['lib/replay/clock.ts','lib/replay/engine.ts','lib/replay/core.ts','lib/replay/results.ts','lib/replay/panels.ts','lib/replay/store.ts','app/replay/replay-page.tsx','app/replay/replay-session.tsx','app/replay/replay-setup.tsx','drizzle/mariadb/0042_replay.sql'].map(p=>{try{return src(p)}catch{return ''}}).join('\n');
 check('důvěrnost: bez názvů prop firem a kurzů',!/ftmo|topstep|apex|the5ers|funded ?next|myfundedfx|e8 ?funding|fundingpips|mentor/i.test(all));
 check('replay stránka existuje a nepoužívá hlavní graf',/ReplaySession|ReplaySetup/.test(src('app/replay/replay-page.tsx'))&&!/market-chart|chart-page/.test(all));
}
if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}
console.log('\nvše ok');
