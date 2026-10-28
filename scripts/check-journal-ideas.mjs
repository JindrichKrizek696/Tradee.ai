// Kontrola etapy 1C (nápady s více vstupy, poctivé R a BE, limity seance, no-trade okna, režimy v metrikách): node --experimental-strip-types scripts/check-journal-ideas.mjs
import {readFileSync} from 'node:fs';
import {weightedEntry,ideaRisk,groupIdeas,capState,checkAddLeg,ideaSummary,parseWindow,isIdeaKey,IDEA_WINDOW_MIN} from '../lib/journal/ideas.ts';
import {originalRisk,rMultiple,partialR,breakEven,mergeCosts,costLines,grossOf,parseCosts,riskFromStop,UNKNOWN_R} from '../lib/journal/accounting.ts';
import {sessionState,sessionViolations,parseLimits,emptyLimits,lossStreak,sizeAfterLoss,stopWidening,hasLimits} from '../lib/journal/session.ts';
import {collisions,makeWindow,upcomingWindows} from '../lib/journal/news-window.ts';
import {metrics,byMode,modesIn,tradesCsv,curves,drawdownOf,excursionR,modeOf} from '../lib/journal/metrics.ts';
import {processComplete,processScore,parseProcess,PROCESS_QUESTIONS} from '../lib/journal/process.ts';
import {DEFAULT_FILTER,filterTrades} from '../lib/journal/stats.ts';
import {mtRowToTrade} from '../lib/journal/rows.ts';
import {validateContent,emptyContent} from '../lib/strategy/core.ts';
import {pragueDayStart} from '../lib/discipline/store.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const j=JSON.stringify,H=3600000,M=60000;

// ---- 1. nápad s více vstupy: vážený vstup a riziko do společného stopu
const fills=[{price:100,qty:2},{price:103,qty:1}];
check('vážený vstup 2 @ 100 + 1 @ 103 = 101',weightedEntry(fills)===101,weightedEntry(fills));
check('riziko se stopem 98 = 9 (ne prostý průměr 101,5 → 10,5)',ideaRisk(fills,98,'buy')===9&&(101.5-98)*3===10.5,ideaRisk(fills,98,'buy'));
check('riziko: hodnota bodu, sell, stop na špatné straně = null',ideaRisk(fills,98,'buy',10)===90&&ideaRisk([{price:100,qty:1}],103,'sell')===3&&ideaRisk(fills,101,'buy')===null&&ideaRisk(fills,null,'buy')===null&&weightedEntry([])===null);
const leg=(id,o)=>({id,tradeId:id,status:'closed',openTs:0,closeTs:1,price:100,qty:1,stop:98,riskPct:0.5,riskMoney:50,net:0,...o});
const sum=ideaSummary([leg('a',{price:100,qty:2,riskMoney:40,net:80,openTs:1}),leg('b',{price:103,qty:1,riskMoney:50,net:-20,openTs:2})],{capPct:null,stop:null});
check('souhrn nápadu: vážený vstup, společný stop z prvního vstupu, R z plánovaného rizika',sum.avgEntry===101&&sum.stop===98&&sum.plannedRisk===90&&sum.net===60&&sum.r===0.67&&sum.status==='closed',sum);
check('souhrn: otevřený vstup → bez R',ideaSummary([leg('a',{}),leg('b',{status:'open',net:null})]).r===null&&ideaSummary([leg('a',{}),leg('b',{status:'open',net:null})]).status==='open');

// ---- 2. seskupení: okno od prvního vstupu, scénář, ruční přiřazení
const T0=Date.UTC(2026,9,5,8);
const g=(tradeId,o)=>({tradeId,accountId:'A',symbol:'EURUSD',side:'buy',openTs:T0,...o});
const list=[g('a',{}),g('b',{openTs:T0+3*H}),g('c',{openTs:T0+5*H}),g('d',{openTs:T0+H,side:'sell'}),g('e',{openTs:T0+H,accountId:'B'}),g('f',{openTs:T0+10*H,scenarioId:'sc1'}),g('h',{openTs:T0+30*H,scenarioId:'sc1'}),g('i',{openTs:T0+12*H}),g('k',{openTs:T0+2*H,manualIdea:'idea_x'})];
const m=groupIdeas(list);
check('okno 4 h: a + b spolu, c (5 h od prvního) zvlášť',m.a==='auto:a'&&m.b==='auto:a'&&m.c==='auto:c',m);
check('jiný směr / účet = jiný nápad',m.d==='auto:d'&&m.e==='auto:e');
check('propojení se scénářem: vstupy i po 20 h jsou jeden nápad',m.f==='sc:sc1:buy'&&m.h==='sc:sc1:buy');
check('obchod bez scénáře do 4 h po scénářovém se připojí',m.i==='sc:sc1:buy',m.i);
check('ruční přiřazení má přednost',m.k==='idea_x');
const m1=groupIdeas(list,60*M);
check('nastavitelné okno: 1 h rozdělí a / b',m1.a==='auto:a'&&m1.b==='auto:b',m1);
check('výchozí okno 240 min, validace okna',IDEA_WINDOW_MIN===240&&parseWindow('90')===90&&typeof parseWindow(2)==='string'&&typeof parseWindow(1.5)==='string'&&typeof parseWindow(99999)==='string');
check('klíče nápadů',isIdeaKey('auto:mt:mta_x:123')&&isIdeaKey('sc:sc_abc:sell')&&isIdeaKey('idea_'+'a'.repeat(24))&&!isIdeaKey('x')&&!isIdeaKey('sc:a:up'));

// ---- 3. limit rizika nápadu a rezervace čekajících vstupů
const L=(status,riskPct)=>({status,riskPct});
check('limit 1 %: 0,7 % + 0,3 % = 1 % projde',checkAddLeg(1,[L('open',0.7)],0.3).ok);
const bl=checkAddLeg(1,[L('open',0.7)],0.4);
check('limit 1 %: 0,7 % + 0,4 % se zablokuje se srozumitelnou zprávou',!bl.ok&&/překročil limit nápadu 1 %/.test(bl.message),bl);
const cs=capState(1,[L('open',0.7),L('pending',0.3),L('cancelled',0.5)]);
check('čekající limitní vstup rezervuje riziko, zrušený se nepočítá',cs.filled===0.7&&cs.pending===0.3&&cs.total===1&&cs.remaining===0&&!cs.over,cs);
check('rezervace blokuje další vstup',!checkAddLeg(1,[L('open',0.7),L('pending',0.3)],0.1).ok&&checkAddLeg(1,[L('open',0.7),L('cancelled',0.3)],0.3).ok);
check('uzavřený vstup se do plánovaného rizika počítá, nad limitem = over',capState(1,[L('closed',0.6),L('open',0.6)]).over&&capState(null,[L('open',5)]).remaining===null&&checkAddLeg(null,[],9).ok);

// ---- 4. R z původního rizika, ne z posunutého stopu
check('původní riziko: plán > první stop; posunutý stop se nepoužije',originalRisk({planned:null,firstStop:100})===100&&originalRisk({planned:80,firstStop:100})===80&&originalRisk({planned:null,firstStop:null})===null);
const firstStopRisk=riskFromStop('buy',100,98,50),movedStopRisk=riskFromStop('buy',100,99,50);
check('posunutý stop (98 → 99) nemění R: +150 = +1,5 R z rizika 100, ne +3 R',firstStopRisk===100&&movedStopRisk===50&&rMultiple(150,originalRisk({planned:null,firstStop:firstStopRisk}))===1.5);
const row={id:'A:1',account_id:'A',symbol:'EURUSD',side:'buy',open_ts:T0,close_ts:T0+H,volume_max:1,net:150,r_result:1.5,rr_planned:2,risk_pct:1,risk_money:100,mfe_money:200,mae_money:-50,tags:'',tags_manual:'',has_note:0,files:0,acc_currency:'USD',acc_name:'Demo',acc_login:'1'};
const tr=mtRowToTrade(row,'USD',{});
check('deník: R z rizika prvního stopu, MFE / MAE v R i v penězích',tr.r===1.5&&tr.mfeR===2&&tr.maeR===-0.5&&tr.mae===-50&&tr.mfe===200,tr);
check('bez stopu = neznámé R',rMultiple(100,null)===null&&UNKNOWN_R==='neznámé R');

// ---- 5. částečné výstupy
check('polovina na +1 R, zbytek na BE → +0,5 R',partialR({side:'buy',entry:100,stop:98,exits:[{price:102,qty:1},{price:100,qty:1}]})===0.5);
check('sell: třetina na +2 R, zbytek na −1 R → 0 R',partialR({side:'sell',entry:100,stop:101,exits:[{price:98,qty:1},{price:101,qty:2}]})===0&&partialR({side:'buy',entry:100,stop:100,exits:[{price:1,qty:1}]})===null);

// ---- 6. cenový vs. účetní BE
const be=breakEven({side:'buy',entry:100,exit:100,net:-8,risk:100});
check('výstup na ceně vstupu s náklady 8 → čistý −8, „cenový BE“',be.kind==='price'&&be.label==='cenový BE'&&be.net===-8,be);
check('čistý výsledek ≈ 0 → „účetní BE“',breakEven({side:'buy',entry:100,exit:100.08,net:0.5,risk:100}).label==='účetní BE'&&breakEven({side:'buy',entry:100,exit:102,net:200,risk:100}).kind===null&&breakEven({side:null,entry:null,exit:null,net:null,risk:null}).kind===null);

// ---- 7. náklady
const c=mergeCosts({commission:-7,swap:-1,fee:0,spread:null,slippage:null},{spread:-3,commission:null});
const cl=costLines(c);
check('rozpad nákladů: ruční hodnota doplní, neznámé zůstanou neznámé',c.commission===-7&&c.spread===-3&&c.slippage===null&&cl.known===4&&cl.total===-11,c);
check('hrubý výsledek = čistý − komise − swap − poplatky',grossOf(-8,c)===0);
check('parse nákladů',j(parseCosts({spread:'-1,5',fee:''}))===j({spread:-1.5,fee:null})&&typeof parseCosts({swap:'x'})==='string'&&typeof parseCosts(null)==='string');

// ---- 8. limity seance a stavy
const day=pragueDayStart('2026-10-05'),now=day+15*H;
const T=(id,open,close,net)=>({id,openTs:open,closeTs:close,net});
const lim={...emptyLimits(),maxTrades:4,maxLosses:3,pauseAfterSl:2,reviewAfterSl:5,endTime:'21:00'};
const two=[T('1',day+9*H,day+10*H,-50),T('2',day+11*H,day+12*H,-40)];
const st=sessionState({limits:lim,trades:two,decisions:2,now,reviewedAt:null,dayStart:day});
check('2 SL dnes → pauza',st.state==='pause'&&st.counts.streakToday===2&&/pauza od 2/.test(st.reasons[0]),st);
check('bez ztrát → připraven, otevřená pozice → aktivní',sessionState({limits:lim,trades:[T('1',day+9*H,day+10*H,30)],decisions:1,now,reviewedAt:null,dayStart:day}).state==='ready'&&sessionState({limits:lim,trades:[T('1',day+14*H,null,null)],decisions:1,now,reviewedAt:null,dayStart:day}).state==='active');
const five=[1,2,3].map(i=>T('p'+i,day-30*H+i*H,day-29*H+i*H,-10)).concat(two);
const rv=sessionState({limits:lim,trades:five,decisions:2,now,reviewedAt:null,dayStart:day});
check('5 ztrát v řadě napříč dny → review',rv.state==='review'&&rv.counts.streak===5,rv);
check('po provedeném review už ne review (zůstává pauza dne)',sessionState({limits:lim,trades:five,decisions:2,now,reviewedAt:day-H,dayStart:day}).state==='pause');
check('zisk přeruší sérii, nula ne',lossStreak([T('a',0,1,-1),T('b',0,2,0),T('c',0,3,-1)])===2&&lossStreak([T('a',0,1,-1),T('b',0,2,5),T('c',0,3,-1)])===1);
check('limit obchodů, rozhodnutí a konec seance',sessionState({limits:{...emptyLimits(),maxDecisions:3},trades:[],decisions:3,now,reviewedAt:null,dayStart:day}).state==='pause'&&sessionState({limits:{...emptyLimits(),endTime:'14:00'},trades:[],decisions:0,now,reviewedAt:null,dayStart:day}).state==='pause'&&sessionState({limits:{...emptyLimits(),maxTrades:1},trades:[T('1',day+9*H,day+10*H,5)],decisions:1,now,reviewedAt:null,dayStart:day}).state==='pause');
const v=sessionViolations(lim,[...two,T('3',day+13*H,day+14*H,-10),T('4',day+20*H+30*M,null,null)]);
check('porušení: obchod během pauzy a po konci seance',v.some(x=>x.tradeId==='3'&&x.rule==='session_pause')&&v.some(x=>x.tradeId==='4'&&x.rule==='session_end')===false&&v.some(x=>x.tradeId==='4'&&x.rule==='session_losses')&&!v.some(x=>x.tradeId==='1'),v);
const late=sessionViolations({...emptyLimits(),endTime:'21:00'},[T('9',pragueDayStart('2026-10-05')+21*H+5*M,null,null)]);
check('porušení: vstup po konci seance (pražský čas)',late.length===1&&late[0].rule==='session_end'&&late[0].detail.at==='21:05',late);
check('porušení: obchod po sérii před review',sessionViolations({...emptyLimits(),reviewAfterSl:3},[T('a',0,H,-1),T('b',2*H,3*H,-1),T('c',4*H,5*H,-1),T('d',6*H,7*H,5)]).some(x=>x.tradeId==='d'&&x.rule==='session_review')&&!sessionViolations({...emptyLimits(),reviewAfterSl:3},[T('a',0,H,-1),T('b',2*H,3*H,-1),T('c',4*H,5*H,-1),T('d',6*H,7*H,5)],{reviews:[5*H+1]}).length);
check('parse limitů',parseLimits({maxTrades:'3',endTime:'16:30',newsMinImpact:2}).maxTrades===3&&parseLimits({newsMinImpact:2}).newsMinImpact===2&&typeof parseLimits({endTime:'25:00'})==='string'&&typeof parseLimits({maxTrades:0})==='string'&&!hasLimits(emptyLimits()));

// ---- 9. upozornění: větší pozice po ztrátě, posun stopu
const S=(id,o)=>({id,accountId:'A',openTs:0,closeTs:null,net:null,riskPct:0.5,volume:1,symbol:'EURUSD',...o});
const w=sizeAfterLoss([S('a',{openTs:0,closeTs:H,net:-50}),S('b',{openTs:2*H,riskPct:1})]);
check('po ztrátě vyšší riziko → upozornění (věcný text)',w.length===1&&w[0].tradeId==='b'&&w[0].text==='Po ztrátě vyšší riziko: 0,5 % → 1 %.'&&!/chyb|špatn|nesmysl/i.test(w[0].text),w);
check('po zisku / stejné riziko / jiný účet bez upozornění',!sizeAfterLoss([S('a',{closeTs:H,net:50}),S('b',{openTs:2*H,riskPct:1})]).length&&!sizeAfterLoss([S('a',{closeTs:H,net:-50}),S('b',{openTs:2*H,riskPct:0.5})]).length&&!sizeAfterLoss([S('a',{closeTs:H,net:-50}),S('b',{openTs:2*H,riskPct:1,accountId:'B'})]).length);
check('bez rizika v %: objem u stejného symbolu',sizeAfterLoss([S('a',{closeTs:H,net:-50,riskPct:null}),S('b',{openTs:2*H,riskPct:null,volume:2})]).length===1);
const sw=stopWidening('t','buy',[{ts:1,kind:'sl',old:null,new:98},{ts:2,kind:'sl',old:98,new:97.5},{ts:3,kind:'sl',old:97.5,new:99},{ts:4,kind:'tp',old:105,new:110},{ts:5,kind:'sl',old:99,new:null}]);
check('posun stopu dál od vstupu a zrušení stopu ze záznamu změn',sw.length===2&&sw[0].detail.from===98&&sw[0].detail.to===97.5&&sw[1].detail.to===null,sw);
check('sell: stop výš = dál',stopWidening('t','sell',[{ts:1,kind:'sl',old:101,new:102}]).length===1&&!stopWidening('t','sell',[{ts:1,kind:'sl',old:101,new:100}]).length);

// ---- 10. no-trade okna kolem zpráv
const E=Date.UTC(2026,9,6,12,30),ev=[{at:E,title:'NFP',currencies:['USD'],signal:3},{at:E+2*H,title:'Retail',currencies:['USD'],signal:2},{at:E,title:'ECB',currencies:['EUR'],signal:3}];
const win=makeWindow(15,30,3,'Strategie A');
check('okno: 15 min před, 30 po, jen silné',j(win)===j({before:15,after:30,minImpact:3,source:'Strategie A'})&&makeWindow(null,null,3,'x')===null);
check('obchod 10 min před NFP koliduje, 20 min před ne',collisions({from:E-10*M,to:E-10*M},['USD','JPY'],ev,[win]).length===1&&!collisions({from:E-20*M,to:E-20*M},['USD','JPY'],ev,[win]).length);
check('obchod 25 min po koliduje, jiná měna ne',collisions({from:E+25*M,to:E+25*M},['USD'],ev,[win])[0].title==='NFP'&&!collisions({from:E,to:E},['JPY','GBP'],ev,[win]).length);
check('min. dopad: střední zpráva jen s minImpact 2',!collisions({from:E+2*H,to:E+2*H},['USD'],ev,[win]).length&&collisions({from:E+2*H,to:E+2*H},['USD'],ev,[makeWindow(15,30,2,'Účet')]).length===1);
check('scénář: interval platnosti zasahuje do okna',collisions({from:E-3*H,to:E-14*M},['EUR','USD'],ev,[win]).length===2&&!collisions({from:E-3*H,to:E-16*M},['EUR','USD'],ev,[win]).length);
const up=upcomingWindows(ev,new Set(['USD']),[win,makeWindow(60,0,3,'Účet')],E-5*H);
check('kalendář: okna pro sledované měny, stejná zpráva = jedno okno nejširší',up.length===1&&up[0].title==='NFP'&&up[0].start===E-60*M&&up[0].end===E+30*M&&up[0].sources.length===2,up);
const c2=validateContent({noTrade:{newsBefore:15,newsAfter:30,days:[],minImpact:2}},[]);
check('strategie: min. dopad v bloku Kdy neobchodovat (výchozí tvar beze změny)',c2.noTrade.minImpact===2&&!('minImpact' in validateContent({noTrade:{newsBefore:15,minImpact:3}},[]).noTrade)&&!('minImpact' in emptyContent().noTrade));

// ---- 11. metriky: režimy, N, vzorce, proklik
const mk=(id,pnl,o)=>({id,source:'mt',accountId:'A',account:'A',symbol:'EURUSD',instrument:null,side:'buy',openTs:T0,closeTs:T0+H,date:'2026-10-05',volume:1,net:pnl,accountCurrency:'USD',pnl,converted:true,r:pnl/100,rr:null,riskPct:1,mfeR:null,maeR:null,holdMs:H,tags:[],hasNote:false,files:0,checklist:null,...o});
const all=[mk('l1',100,{closeTs:T0+H}),mk('l2',-50,{closeTs:T0+2*H,mae:-80}),mk('l3',200,{closeTs:T0+3*H,r:null}),mk('s1',-500,{mode:'sim',closeTs:T0+4*H}),mk('r1',300,{mode:'replay',closeTs:T0+5*H})];
check('režimy: výchozí live, filtr deníku a metriky je nemíchají',modeOf({})==='live'&&byMode(all,'live').length===3&&byMode(all,'sim').length===1&&j(modesIn(all))==='["live","sim","replay"]'&&filterTrades(all,{...DEFAULT_FILTER,mode:'sim'},T0).map(t=>t.id).join()==='s1'&&filterTrades(all,DEFAULT_FILTER,T0).length===5);
const ms=metrics(byMode(all,'live')),M_=k=>ms.find(x=>x.key===k);
check('PF, expectancy, win rate s N a vzorcem',M_('pf').value===6&&M_('exp').value===83.33&&M_('win').value===66.67&&M_('win').n===3&&M_('win').ids.join()==='l1,l3'&&ms.every(x=>x.formula.length>20));
check('expectancy v R jen z obchodů se známým R (N = 2)',M_('expR').value===0.25&&M_('expR').n===2&&M_('expR').ids.join()==='l1,l2');
check('průměrný zisk / ztráta s N',M_('avgWin').value===150&&M_('avgWin').n===2&&M_('avgLoss').value===-50&&M_('avgLoss').n===1);
check('max DD ze zůstatku vs. z equity (MAE)',M_('ddBal').value===-50&&M_('ddBal').ids.join()==='l2'&&M_('ddEq').value===-80&&M_('ddEq').n===1,[M_('ddBal'),M_('ddEq')]);
check('sim se nepřimíchá do živých metrik',metrics(byMode(all,'sim')).find(x=>x.key==='exp').value===-500&&M_('exp').n===3);
check('MFE / MAE bez dat = null, N 0',M_('mfe').value===null&&M_('mfe').n===0);
check('drawdown: obchody mezi vrcholem a dnem',j(drawdownOf([{id:'a',value:10},{id:'b',value:4},{id:'c',value:-2},{id:'d',value:20}]))===j({dd:12,ids:['b','c']})&&curves([]).hasMae===false);
const csv=tradesCsv(all);
check('export CSV s režimem',csv.split('\n')[0].startsWith('id;rezim')&&csv.includes('s1;Simulace')&&csv.includes('r1;Replay')&&csv.includes('l1;Živě'));
const bars=[{t:T0,h:101,l:99.5},{t:T0+H,h:103,l:100.5},{t:T0+5*H,h:200,l:1}];
check('MFE / MAE z H1 svíček (bez dat EA)',j(excursionR(bars,{side:'buy',entry:100,stop:98,openTs:T0+10*M,closeTs:T0+2*H}))===j({mfeR:1.5,maeR:-0.25})&&excursionR(bars,{side:'buy',entry:100,stop:null,openTs:T0,closeTs:T0+H})===null);

// ---- 12. hodnocení procesu před výsledkem
const ans=Object.fromEntries(PROCESS_QUESTIONS.map(q=>[q.id,'yes']));
check('výsledek se ukáže až po zodpovězení všech otázek',!processComplete({plan:'yes'})&&processComplete(ans)&&processScore({...ans,size:'no',state:'partly'})===70&&processScore({plan:'yes'})===null);
check('parse procesu',typeof parseProcess({answers:{plan:'maybe'}})==='string'&&typeof parseProcess({rating:7})==='string'&&parseProcess({answers:{plan:'no'},rating:3}).rating===3);

// ---- 13. migrace 0038
const mig=readFileSync(new URL('../drizzle/mariadb/0038_journal_ideas.sql',import.meta.url),'utf8');
const tables=['journal_settings','ideas','idea_legs','trade_meta','trade_changes','trade_costs','trade_process','session_limits','session_reviews'];
check('migrace 0038: tabulky',tables.every(t=>mig.includes('CREATE TABLE IF NOT EXISTS '+t+'(')));
check('migrace 0038: user_id všude',tables.every(t=>new RegExp('CREATE TABLE IF NOT EXISTS '+t+'\\([\\s\\S]*?user_id VARCHAR\\(128\\) NOT NULL').test(mig)));
check('migrace 0038: oddělovače příkazů',mig.split('--> statement-breakpoint').length===tables.length);
check('migrace 0035 se nepoužívá',!readFileSync(new URL('../drizzle/mariadb/0038_journal_ideas.sql',import.meta.url),'utf8').includes('0035'));

if(fails.length){console.log(`\n${fails.length} kontrol selhalo`);process.exit(1)}
console.log('\nVše v pořádku.');
