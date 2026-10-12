// Kontrola Laboratoře (přístup, bez look-ahead, výnosy, statistika, pravidla): node --experimental-strip-types scripts/check-lab.mjs
import {labAllowed,labGate,labNotFound} from '../lib/lab/access.ts';
import {trendStates,trendScoreOf,seasonStates,monthlyReturns,cotSignalSeries,cotForInstrument,scoreForInstrument,computeSignals,forwardReturn,Acc,tStat,bucketStat,runStudy,barDay} from '../lib/lab/study.ts';
import {normalizeLabRule,labRuleIssues,labGateFor,toStrategyRules} from '../lib/lab/rules.ts';
import {validateLabNote,cleanTags,aiSummary,isMissingLabTable} from '../lib/lab/core.ts';
import {runBacktest} from '../lib/backtest/engine.ts';
import {COT_LAG_MS} from '../lib/backtest/context.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const near=(a,b,e=1e-9)=>a!==null&&b!==null&&Math.abs(a-b)<=e;

// ---- přístup: jen vlastník; admin (ne vlastník), člen i nepřihlášený → 404
const owner={id:'g:1',role:'admin',owner:true},admin={id:'g:2',role:'admin',owner:false},member={id:'g:3',role:'member',owner:false};
const U='https://tradee.eu/api/laborator';
check('vlastník projde',labAllowed(owner,U)&&labGate(owner,U)===owner);
check('admin (ne vlastník) → 404',!labAllowed(admin,U)&&labGate(admin,U) instanceof Response&&labGate(admin,U).status===404);
check('člen → 404',labGate(member,U) instanceof Response&&labGate(member,U).status===404);
check('nepřihlášený → 404',labGate(null,U).status===404&&labGate(undefined,U).status===404);
check('role admin bez owner příznaku nestačí',!labAllowed({id:'x',role:'admin',owner:false})&&!labAllowed({id:'x',role:'admin'}));
check('?as= cizí id → 404 i pro vlastníka',labGate(owner,U+'?as=g:2').status===404&&labAllowed(owner,U+'?as=g:1'));
check('admin s ?as=vlastník → 404',labGate(admin,U+'?as=g:1').status===404);
const nf=labNotFound();check('404 bez prozrazení',nf.status===404&&(await nf.json()).error==='Nenalezeno.'&&nf.headers.get('Cache-Control')==='no-store');

// ---- syntetická řada: pracovní dny od 2008, náhodná procházka se sezónním driftem (deterministický PRNG)
let seed=7;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648};
const bars=[];let p=1.2;
for(let t=Date.UTC(2008,0,1,23);bars.length<4200;t+=86400000){const wd=new Date(t+12*3600000).getUTCDay();if(wd===0||wd===6)continue;
 const m=new Date(t+12*3600000).getUTCMonth();const drift=m===2?.0012:m===8?-.0012:0;const o=p;p=p*Math.exp(drift+(rnd()-.5)*.012);
 bars.push({t,o,h:Math.max(o,p)*1.002,l:Math.min(o,p)*.998,c:p})}
const close=bars.map(b=>b.c);

// trend: ruční výpočet ve vybrané svíčce
const tr=trendStates(close);
{const i=3000,lc=close.map(Math.log),g50=lc.slice(i-49,i+1).reduce((a,b)=>a+b)/50,g200=lc.slice(i-199,i+1).reduce((a,b)=>a+b)/200,c=(a,b)=>a>b?1:a<b?-1:0;
 check('trend = 3 hlasy GMA50/GMA200',tr[i]===trendScoreOf((c(lc[i],g50)+c(lc[i],g200)+c(g50,g200))/3),tr[i]);}
check('trend: prvních 199 svíček bez hodnoty',tr.slice(0,199).every(v=>v===null)&&tr[199]!==null);
check('trend skóre z hlasů',trendScoreOf(1)===2&&trendScoreOf(-1)===-2&&trendScoreOf(1/3)===1&&trendScoreOf(-1/3)===-1&&trendScoreOf(0)===0);

// BEZ LOOK-AHEAD: hodnota v i se nezmění, když budoucnost (i+1…) úplně přepíšeme / useknem
const se=seasonStates(bars);
const idx=[250,700,1500,2600,2601,3333,4100];
let prefixOk=true,futureOk=true;
for(const i of idx){
 const cut=bars.slice(0,i+1),ts=trendStates(cut.map(b=>b.c)),ss=seasonStates(cut);
 if(ts[i]!==tr[i]||ss.score[i]!==se.score[i]||ss.signal[i]!==se.signal[i])prefixOk=false;
 const crazy=[...cut,...bars.slice(i+1).map((b,k)=>({...b,c:b.c*(k%2?3:.2),o:b.o*3,h:b.h*5,l:b.l*.1}))];
 const tc=trendStates(crazy.map(b=>b.c)),sc=seasonStates(crazy);
 if(tc[i]!==tr[i]||sc.score[i]!==se.score[i])futureOk=false;
}
check('trend + sezonalita: useknutá řada dá stejné hodnoty (prefix)',prefixOk);
check('trend + sezonalita: přepsaná budoucnost nic nezmění',futureOk);
// sezonalita roku Y nepoužije měsíc m roku Y: zvedneme březen 2020 → březnový signál 2020 stejný, 2021 jiný
{const mar2020=bars.findIndex(b=>barDay(b.t).getUTCFullYear()===2020&&barDay(b.t).getUTCMonth()===2),mar2021=bars.findIndex(b=>barDay(b.t).getUTCFullYear()===2021&&barDay(b.t).getUTCMonth()===2);
 const pumped=bars.map(b=>{const d=barDay(b.t);const k2=d.getUTCFullYear()===2020&&d.getUTCMonth()===2?1.5:d>barDay(bars[mar2020].t)&&!(d.getUTCFullYear()===2020&&d.getUTCMonth()===2)?(d.getUTCFullYear()>2020||d.getUTCMonth()>2?1.5:1):1;return {...b,c:b.c*k2,o:b.o*k2,h:b.h*k2,l:b.l*k2}});
 const sp=seasonStates(pumped);
 check('sezonalita: vlastní měsíc se nepočítá',sp.signal[mar2020+5]===se.signal[mar2020+5],[sp.signal[mar2020+5],se.signal[mar2020+5]]);
 check('sezonalita: příští rok už ano',sp.signal[mar2021+5]!==se.signal[mar2021+5]);}
check('sezonalita: prvních 5 let bez signálu',se.signal[0]===null&&se.signal[bars.findIndex(b=>barDay(b.t).getUTCFullYear()===2012)]===null);
{const mr=monthlyReturns(bars),m=mr.get('2010-3'),prev=bars.filter(b=>barDay(b.t)<new Date(Date.UTC(2010,2,1))).at(-1).c,end=bars.filter(b=>barDay(b.t)<new Date(Date.UTC(2010,3,1))).at(-1).c;
 check('měsíční výnos = log(konec/předchozí konec)×100',near(m,(Math.log(end)-Math.log(prev))*100,1e-9),m);}
check('sezónní drift se projeví (březen kladný)',se.score[bars.findIndex(b=>barDay(b.t).getUTCFullYear()===2019&&barDay(b.t).getUTCMonth()===2)]>0);

// COT: signál platí až po zveřejnění (úterý + COT_LAG), z historie jen do daného týdne
const week=(i)=>new Date(Date.UTC(2015,0,6)+i*7*86400000).toISOString().slice(0,10);
const cotRows=Array.from({length:80},(_,i)=>({date:week(i),openInterest:100000,groups:{leveraged:{long:30000+i*500,short:30000,net:i*500}}}));
const cs=cotSignalSeries(cotRows,'leveraged');
check('COT čas = datum + zpoždění',cs.times[0]===Date.parse(cs.dates[0]+'T00:00:00Z')+COT_LAG_MS);
const cs40=cotSignalSeries(cotRows.slice(0,41),'leveraged');
check('COT prefix: signál týdne nezávisí na pozdějších týdnech',cs40.signals.every((v,k)=>v===cs.signals[k]));
const src={EUR:{rows:cotRows,group:'leveraged'},USD:{rows:cotRows,group:'leveraged',proxy:true},GBP:{rows:cotRows.map(r=>({...r,groups:{leveraged:{long:30000,short:30000+r.groups.leveraged.net,net:-r.groups.leveraged.net}}})),group:'leveraged'}};
const eu=cotForInstrument(src,'EUR/USD'),ue=cotForInstrument(src,'USD/EUR'),eg=cotForInstrument(src,'EUR/GBP');
const t10=Date.parse(week(10)+'T00:00:00Z');
check('COT před zveřejněním neznámý',eu(t10+COT_LAG_MS-1)!==cs.signals[cs.dates.indexOf(week(10))]&&eu(t10+COT_LAG_MS)===cs.signals[cs.dates.indexOf(week(10))]);
check('COT USD/x obrácené znaménko, kříž = půl rozdílu',ue(t10+COT_LAG_MS)===-eu(t10+COT_LAG_MS)&&near(eg(t10+COT_LAG_MS),(eu(t10+COT_LAG_MS)-cotForInstrument(src,'GBP/USD')(t10+COT_LAG_MS))/2));
check('COT starý > 14 dní = bez dat',eu(Date.parse(week(79)+'T00:00:00Z')+COT_LAG_MS+15*86400000)===undefined);
check('COT USD index je proxy',cotForInstrument(src,'USD')===null);

// skóre: jen snapshot s časem ≤ t a vybraná metoda
const snaps=[{at:1000,instrument:'EUR/USD',score:40,method:'score-v3'},{at:2000,instrument:'EUR/USD',score:-5,method:'score-v2.2'},{at:3000,instrument:'EUR/USD',score:9,method:'technical-v1.1'}];
const sf=scoreForInstrument(snaps,'EUR/USD',['score-v3','score-v2.2']);
check('skóre: krokově, bez budoucnosti a jen metody',sf(999)===undefined&&sf(1000)===40&&sf(2500)===-5&&sf(3500)===-5);

// výnosy
const fb=[{t:0,o:100,h:100,l:100,c:100},{t:1,o:100,h:110,l:100,c:110},{t:2,o:110,h:121,l:110,c:121}];
const fr=forwardReturn(fb,[2,2,2],0,1),fr2=forwardReturn(fb,[2,2,2],0,2);
check('výnos v % a v ATR',near(fr.pct,10)&&near(fr.atr,5)&&near(fr2.pct,21)&&near(fr2.atr,10.5));
check('bez svíčky i+h = null',forwardReturn(fb,[2,2,2],1,5)===null&&forwardReturn(fb,[NaN,2,2],0,1).atr===null);

// statistika koše
const a=new Acc();[1,2,-1,4].forEach(x=>a.add(x,x/2,1));const base=new Acc();[1,2,-1,4,0,-2].forEach(x=>base.add(x,null,0));
const bs=bucketStat('trend',2,a,base,1);
check('koš: n, průměr, hit, růst',bs.n===4&&near(bs.avgPct,1.5)&&near(bs.avgAtr,.75)&&bs.hit===75&&bs.upPct===75);
check('koš: rozdíl proti baseline',near(bs.excessPct,1.5-4/6,1e-4));
const sd=Math.sqrt(((1-1.5)**2+(2-1.5)**2+(-1-1.5)**2+(4-1.5)**2)/3);
check('t-stat (n/h)',near(bs.t,Math.round((1.5-4/6)/(sd/2)*100)/100)&&near(tStat(1.5,sd,4,4),1.5/sd,1e-9)&&tStat(1,0,5,1)===null);
check('koš 0 bez hit rate',bucketStat('trend',0,a,base,1).hit===null);

// studie: koše dají dohromady baseline, from/to se respektuje
const from=Date.UTC(2015,0,1),to=Date.UTC(2022,0,1);
const st=runStudy([{instrument:'EUR/USD',bars,cot:null,score:null}],from,to);
const trS=st.aggregate.find(s=>s.id==='trend');
check('studie: součet košů = baseline',trS.horizons.every(h=>h.buckets.reduce((s,b)=>s+b.n,0)===h.baseline.n)&&trS.horizons[0].baseline.n>1000);
check('studie: období',trS.from>=from&&trS.to<to);
check('studie: bez COT a skóre = prázdné',st.aggregate.find(s=>s.id==='cot').horizons[0].baseline.n===0);
check('studie: hrana = jen nenulové koše',trS.horizons[2].edge.n===trS.horizons[2].buckets.filter(b=>b.bucket!==0).reduce((s,b)=>s+b.n,0));

// pravidla
const r=normalizeLabRule({markets:['EUR/USD','XXX'],conds:[{type:'trend',op:'>=',value:9},{type:'nope'}],tech:[{type:'score',op:'>',value:1,days:1},{type:'rsi',period:14,op:'<',value:30}],direction:'trend',sl:1,tp:{type:'none'},hold:20},new Set(['EUR/USD']));
check('pravidlo: normalizace',r.markets.join()==='EUR/USD'&&r.conds.length===1&&r.conds[0].value===2&&r.tech.length===1&&r.tech[0].type==='rsi'&&r.direction==='trend');
check('pravidlo: problémy',labRuleIssues({...r,tp:{type:'none',value:0},hold:null}).length===1&&labRuleIssues(r).length===0&&labRuleIssues({...r,markets:[]}).length===1);
const sr=toStrategyRules(r);check('pravidlo → engine',sr.exit.sl.type==='atr'&&sr.exit.sl.value===1&&sr.exit.maxBars===20&&sr.exit.tp.type==='none');
const sig=computeSignals(bars,null,null),g=labGateFor({...r,tech:[],conds:[{type:'trend',op:'>=',value:1}],direction:'trend'},sig);
check('gate: trend ≥ 1 → long, jinak nic',sig.trend.every((v,i)=>g(i)===(v!==null&&v>=1?'long':false)));
const g2=labGateFor({...r,conds:[],direction:'trend'},sig);
check('gate: směr podle trendu',sig.trend.every((v,i)=>g2(i)===(v===null||v===0?false:v>0?'long':'short')));
// engine s gate: vstup jen tam, kde gate povolí (na open další svíčky), směr z gate
const rr={...r,tech:[],conds:[{type:'trend',op:'<=',value:-2}],direction:'long',hold:5,tp:{type:'none',value:0}};
const bt=runBacktest({rules:toStrategyRules(rr),markets:[{instrument:'EUR/USD',bars}],tf:'D1',from,to,capital:10000,gate:(inst,b)=>labGateFor(rr,computeSignals(b,null,null))});
const okEntries=bt.trades.every(t=>{const i=bars.findIndex(b=>b.t===t.entryT);return i>0&&sig.trend[i-1]===-2});
check('engine + gate: vstup po signální svíčce',bt.trades.length>5&&okEntries&&bt.trades.every(t=>t.side==='long'&&t.bars<=5));
const bt0=runBacktest({rules:toStrategyRules(rr),markets:[{instrument:'EUR/USD',bars}],tf:'D1',from,to,capital:10000});
check('engine bez gate a podmínek = žádné obchody (beze změny chování)',bt0.trades.length===0&&bt0.warnings.some(w=>w.includes('žádnou vstupní podmínku')));

// poznámky a shrnutí
check('poznámka: validace','error' in validateLabNote({title:' '})&&validateLabNote({title:'A',body:'x',tags:'#cot, trend ,cot'}).tags.join()==='cot,trend');
check('tagy: max 12, bez duplicit',cleanTags(Array.from({length:20},(_,i)=>'t'+i)).length===12&&cleanTags(['A','a']).length===1);
const md=aiSummary([{id:'1',title:'COT nápad',body:'Text',tags:['cot'],created:'2026-10-01T00:00:00Z',updated:'2026-10-02T00:00:00Z'}],[{id:'r',name:'Trend long',rule:r,summary:{trades:10,winRate:60,avgR:.2,profitFactor:1.4,maxDrawdownPct:5},created:'',updated:''}],st);
check('shrnutí pro AI: poznámky, pravidla, studie',md.includes('### COT nápad')&&md.includes('#cot')&&md.includes('### Trend long')&&md.includes('10 obchodů')&&md.includes('Trend (GMA50/GMA200)'));
check('chybějící tabulka',isMissingLabTable({code:'ER_NO_SUCH_TABLE'})&&isMissingLabTable({message:"Table 'x.lab_notes' doesn't exist"})&&!isMissingLabTable(new Error('x')));

if(fails.length){console.log(`\n${fails.length} kontrol selhalo`);process.exit(1)}
console.log('\nVšechny kontroly Laboratoře prošly.');
