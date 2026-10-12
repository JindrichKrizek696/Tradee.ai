// Kontrola Simulace v Laboratoři (výpočty, výstupy, limity, zprávy, jistota, idempotence, přístup): node --experimental-strip-types scripts/check-lab-paper.mjs
import {readFileSync} from 'node:fs';
import {paperStep,checkExit,rOf,pctOf,halfSpread,atrLast,tradingDays,paperConfidence,freshnessOf,markToMarket,legs,marketCurrencies,paperStats,paperSummaryMd,maxDrawdownPct,toPaperSignal,tradeId,PAPER_RULES_VERSION} from '../lib/lab/paper.ts';
import {labGate} from '../lib/lab/access.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const near=(a,b,e=1e-9)=>typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=e;
const H=3600000,DAY=86400000;
const NOW=Date.UTC(2026,9,13,10,0); // úterý 10:00 UTC

// ---- pomocné vstupy
const part=(id,contribution,value=Math.sign(contribution)*2,extra={})=>({id,label:id==='rates'?'Sazby':id==='cot'?'COT':id==='trend'?'Trend':id,weight:15,value,contribution,detail:id==='rates'?'Fed 3,75–4 % vs BoC 2,25 %':'',status:'ok',...extra});
const sig=(score,o={})=>({score,coverage:o.coverage??90,alignment:o.alignment??80,method:o.method??'score-v3',parts:o.parts??[part('rates',score>0?20:-20),part('cot',score>0?10:-10,1),part('trend',score>0?-5:5)]});
// 30 denních svíček s rozpětím 0,0100 → ATR14 = 0,0100
const d1=(p=1.1)=>Array.from({length:30},(_,i)=>({t:NOW-(30-i)*DAY,o:p,h:p+0.005,l:p-0.005,c:p}));
const quote=(price,age=5*60000)=>({price,marketTime:NOW-age});
const base={now:NOW,startEquity:100000,trades:[],news:[],h1:{},points:{}};

// ---- čísla obchodu
check('ATR14 z denních svíček',near(atrLast(d1(),NOW),0.01,1e-12),atrLast(d1(),NOW));
check('ATR bez dost svíček = null',atrLast(d1().slice(0,10),NOW)===null);
check('půl spreadu EUR/USD = 0,5 pipu',near(halfSpread('EUR/USD',1.1),0.00005,1e-12)&&near(halfSpread('EUR/JPY',150),0.0075,1e-12)&&near(halfSpread('USD/JPY',150),0.005,1e-12));
{const s=paperStep({...base,signals:{'EUR/USD':sig(62)},quotes:{'EUR/USD':quote(1.1)},d1:{'EUR/USD':d1()}});
 const t=s.opens[0];
 check('vstup long = cena + ½ spread, SL 1,5 ATR, TP 3 ATR',t&&near(t.entry,1.10005,1e-12)&&near(t.entry-t.sl,0.015,1e-12)&&near(t.tp-t.entry,0.03,1e-12),t);
 check('riziko 1 % equity',t.riskCzk===1000&&t.rulesVersion===PAPER_RULES_VERSION);
 check('R a P&L: TP = +2 R = +2 000 Kč',near(rOf(t,t.tp),2,1e-9)&&near(rOf(t,t.sl),-1,1e-9));
 check('% pohyb ceny',near(pctOf(t,t.tp),(t.tp-t.entry)/t.entry*100,1e-12));
 const m=markToMarket(t,1.1);check('přecenění: long prodává za mid − ½ spread',near(m.price,1.09995,1e-12)&&near(m.pnlCzk,rOf(t,1.09995)*1000,1e-9));
 check('poznámka „proč“ se složkami a čísly',t.why.includes('Sazby +2 (+20 b.; Fed 3,75–4 % vs BoC 2,25 %)')&&t.why.includes('COT +1 (+10 b.')&&t.why.includes('Rizika: Trend −2 (−5 b.')&&t.why.includes('jistota'),t.why);
 // short
 const s2=paperStep({...base,signals:{'EUR/USD':sig(-62)},quotes:{'EUR/USD':quote(1.1)},d1:{'EUR/USD':d1()}}),u=s2.opens[0];
 check('short: vstup = cena − ½ spread, SL nad, TP pod',u.direction==='short'&&near(u.entry,1.09995,1e-12)&&u.sl>u.entry&&u.tp<u.entry&&near(rOf(u,u.tp),2,1e-9)&&near(rOf(u,u.sl),-1,1e-9));
 // velikost rizika z aktuálního uzavřeného zůstatku
 const won={...t,id:'x',instrument:'GBP/USD',closed:NOW-3*DAY,exit:t.tp,exitReason:'tp',r:2,pnlCzk:2000,pct:1};
 const s3=paperStep({...base,trades:[won],signals:{'EUR/USD':sig(62)},quotes:{'EUR/USD':quote(1.1)},d1:{'EUR/USD':d1()}});
 check('riziko z aktuálního zůstatku (102 000 → 1 020 Kč)',s3.opens[0].riskCzk===1020&&s3.balance===102000,s3.opens[0]);

 // ---- výstupy
 const open={...t,opened:NOW-10*H};
 const bar=(t0,h,l)=>({t:t0,o:1.1,h,l,c:1.1});
 const both=checkExit(open,{now:NOW,h1:[bar(NOW-8*H,open.tp+0.001,open.sl-0.001)],quote:quote(1.1)});
 check('SL i TP v jedné svíčce → SL',both?.exitReason==='sl'&&both.exit===open.sl&&near(both.r,-1,1e-9)&&both.pnlCzk===-1000,both);
 const tp=checkExit(open,{now:NOW,h1:[bar(NOW-8*H,1.101,1.099),bar(NOW-7*H,open.tp+0.0001,1.1)],quote:quote(1.1)});
 check('TP podle H1 svíčky',tp?.exitReason==='tp'&&near(tp.r,2,1e-9)&&tp.pnlCzk===2000&&tp.closed===NOW-6*H,tp);
 const mid={...open,opened:NOW-10*H+20*60000},early=checkExit(mid,{now:NOW,h1:[bar(NOW-10*H,1.2,1.0)],quote:quote(1.1)});
 check('svíčka rozběhnutá před vstupem se nepočítá',early===null,early);
 const order=checkExit(open,{now:NOW,h1:[bar(NOW-5*H,open.tp+0.001,1.1)],points:[[NOW-6*H,open.sl-0.0001]],quote:quote(1.1)});
 check('dřívější zásah vyhrává (bod před svíčkou)',order?.exitReason==='sl',order);
 const live=checkExit(open,{now:NOW,quote:quote(open.sl-0.002)});
 check('SL podle živé ceny = cena SL',live?.exitReason==='sl'&&live.exit===open.sl,live);
 const sx=checkExit(open,{now:NOW,quote:quote(1.1),signal:sig(15)});
 check('signál: long pod +20 → výstup za mid − ½ spread',sx?.exitReason==='signal'&&near(sx.exit,1.09995,1e-12),sx);
 check('signál: +25 drží, otočení zavře',checkExit(open,{now:NOW,quote:quote(1.1),signal:sig(25)})===null&&checkExit(open,{now:NOW,quote:quote(1.1),signal:sig(-30)})?.exitReason==='signal');
 check('signál: short nad −20 zavře, −25 drží',checkExit({...u,opened:NOW-H},{now:NOW,quote:quote(1.1),signal:sig(-10)})?.exitReason==='signal'&&checkExit({...u,opened:NOW-H},{now:NOW,quote:quote(1.1),signal:sig(-25)})===null);
 check('signál bez skóre (pozastaveno) nezavírá',checkExit(open,{now:NOW,quote:quote(1.1),signal:sig(null)})===null);
 check('zavřený trh: signál ani čas nezavírá',checkExit(open,{now:NOW,quote:quote(1.1,3*H),signal:sig(5)})===null);
 check('obchodní dny: pá → po = 1, po → po = 5',tradingDays(Date.UTC(2026,9,9,12),Date.UTC(2026,9,12,9))===1&&tradingDays(Date.UTC(2026,9,5,12),Date.UTC(2026,9,12,9))===5);
 const old={...open,opened:Date.UTC(2026,8,29,10)};
 check('čas: po 10 obchodních dnech výstup',tradingDays(old.opened,NOW)===10&&checkExit(old,{now:NOW,quote:quote(1.1),signal:sig(60)})?.exitReason==='time'&&checkExit({...old,opened:Date.UTC(2026,8,30,10)},{now:NOW,quote:quote(1.1),signal:sig(60)})===null);
 // krok: výstup zapíše výsledek a uvolní místo, 24 h na stejný trh nevstupuje
 const st=paperStep({...base,trades:[open],signals:{'EUR/USD':sig(10,{parts:[part('rates',5,1),part('cot',10,1),part('trend',-5)]})},quotes:{'EUR/USD':quote(1.1)},d1:{'EUR/USD':d1()}});
 check('krok: výstup s poznámkou „výsledek“',st.closes.length===1&&st.closes[0].resultNote.includes('signál zeslábl')&&st.closes[0].resultNote.includes('Skóre při vstupu +62 → při výstupu +10')&&st.closes[0].resultNote.includes('Změny složek: Sazby +20 → +5 b. (−15)'),st.closes[0]?.resultNote);
 const re=paperStep({...base,trades:[{...open,closed:NOW-2*H,exit:1.1,exitReason:'signal',r:0,pnlCzk:0,pct:0}],signals:{'EUR/USD':sig(70)},quotes:{'EUR/USD':quote(1.1)},d1:{'EUR/USD':d1()}});
 check('24 h po uzavření na stejný trh nevstupuje',re.opens.length===0&&re.skipped[0].reason.includes('24 h'));

 // ---- idempotence: druhý běh se stejným stavem nic nezdvojí
 const first=paperStep({...base,signals:{'EUR/USD':sig(62),'GBP/USD':sig(55)},quotes:{'EUR/USD':quote(1.1),'GBP/USD':quote(1.3)},d1:{'EUR/USD':d1(),'GBP/USD':d1(1.3)}});
 const again=paperStep({...base,trades:first.opens,signals:{'EUR/USD':sig(62),'GBP/USD':sig(55)},quotes:{'EUR/USD':quote(1.1),'GBP/USD':quote(1.3)},d1:{'EUR/USD':d1(),'GBP/USD':d1(1.3)}});
 check('opakovaný běh: žádný duplicitní vstup',first.opens.length===2&&again.opens.length===0&&again.closes.length===0&&again.skipped.every(s=>s.reason==='pozice už je otevřená'));
 check('id vstupu = slot 15 min + trh (stejné v rámci slotu)',tradeId(NOW,'EUR/USD')===tradeId(NOW+14*60000,'EUR/USD')&&tradeId(NOW,'EUR/USD')!==tradeId(NOW+15*60000,'EUR/USD'));
 const det=paperStep({...base,signals:{'EUR/USD':sig(62),'GBP/USD':sig(55)},quotes:{'EUR/USD':quote(1.1),'GBP/USD':quote(1.3)},d1:{'EUR/USD':d1(),'GBP/USD':d1(1.3)}});
 check('deterministický výsledek',JSON.stringify(det)===JSON.stringify(first));
}

// ---- limity a expozice
{
 const ids=['EUR/USD','GBP/USD','AUD/USD','NZD/USD','EUR/JPY','GBP/JPY','GC=F','CL=F'];
 const signals=Object.fromEntries(ids.map((id,i)=>[id,sig(90-i)])),quotes=Object.fromEntries(ids.map(id=>[id,quote(id.includes('JPY')?150:id==='GC=F'?2000:1.1)])),D=Object.fromEntries(ids.map(id=>[id,d1(id.includes('JPY')?150:id==='GC=F'?2000:1.1)]));
 const s=paperStep({...base,signals,quotes,d1:D});
 check('max 2 pozice se stejnou měnou ve stejném směru (short USD)',s.opens.filter(t=>t.instrument.endsWith('/USD')).length===2&&s.skipped.some(x=>x.instrument==='AUD/USD'&&x.reason.includes('short USD')),s.skipped);
 check('max 5 otevřených pozic, pořadí podle |skóre|',s.opens.length===5&&s.opens[0].instrument==='EUR/USD'&&s.skipped.some(x=>x.reason.startsWith('plno')),s.opens.map(t=>t.instrument));
 check('expozice: long EUR/USD = +EUR −USD',JSON.stringify(legs('EUR/USD','long'))==='[["EUR",1],["USD",-1]]'&&legs('GC=F','long').length===0);
 const one=paperStep({...base,trades:s.opens,signals,quotes,d1:D});
 check('nejvýš 1 pozice na trh',one.opens.length===0);
 const fx=paperStep({...base,signals:{'EUR/USD':sig(70,{coverage:65}),'GBP/USD':sig(70,{alignment:55}),'GC=F':sig(70,{coverage:50,alignment:40,method:'technical-cot-v1'})},quotes,d1:D});
 check('FX: pokrytí ≥ 70 % a shoda ≥ 60 %, jiné trhy bez limitu',fx.opens.map(t=>t.instrument).join()==='GC=F',fx.skipped);
 const weak=paperStep({...base,signals:{'EUR/USD':sig(49.9)},quotes,d1:D});
 check('|skóre| < 50 = žádný vstup',weak.opens.length===0&&weak.skipped.length===0);
 const stale=paperStep({...base,signals:{'EUR/USD':sig(70)},quotes:{'EUR/USD':quote(1.1,2*H+1)},d1:D});
 check('cena starší než 2 h (víkend / zavřený trh) = žádný vstup',stale.opens.length===0&&stale.skipped[0].reason.includes('zavřený'));
 const noAtr=paperStep({...base,signals:{'EUR/USD':sig(70)},quotes,d1:{}});
 check('bez denních svíček žádný vstup',noAtr.opens.length===0&&noAtr.skipped[0].reason.includes('ATR'));
}

// ---- zprávy (±30 min, měny trhu)
{
 const run=(at,cur,id='EUR/USD')=>paperStep({...base,signals:{[id]:sig(70)},quotes:{[id]:quote(id==='CL=F'?80:1.1)},d1:{[id]:d1(id==='CL=F'?80:1.1)},news:[{at,currencies:cur}]});
 check('zpráva USD za 20 min blokuje EUR/USD',run(NOW+20*60000,['USD']).opens.length===0);
 check('zpráva před 30 min ještě blokuje, před 31 min už ne',run(NOW-30*60000,['EUR']).opens.length===0&&run(NOW-31*60000,['EUR']).opens.length===1);
 check('zpráva v jiné měně neblokuje',run(NOW+5*60000,['JPY']).opens.length===1);
 check('ropa: EIA (OIL) blokuje CL=F',run(NOW+10*60000,['OIL'],'CL=F').opens.length===0&&JSON.stringify(marketCurrencies('CL=F'))==='["OIL","USD"]'&&JSON.stringify(marketCurrencies('^NDX'))==='["USD"]');
}

// ---- jistota
{
 const vals=[];for(const score of [-150,-100,-50,0,50,100,150,NaN])for(const a of [-10,0,50,100,200])for(const c of [0,70,100,300])for(const f of [-1,0,.5,1,2])vals.push(paperConfidence({score,alignment:a,coverage:c,freshness:f}));
 check('jistota vždy celé číslo 0–100',vals.every(v=>Number.isInteger(v)&&v>=0&&v<=100));
 check('jistota: maximum 100, vzorec 50/20/15/15',paperConfidence({score:100,alignment:100,coverage:100,freshness:1})===100&&paperConfidence({score:-50,alignment:60,coverage:70,freshness:1})===Math.round(100*(.25+.12+.105+.15)));
 const parts=[part('rates',10,2,{weight:50}),part('cot',5,1,{weight:50,status:'stale'})];
 check('čerstvost: zastaralé váhy a stáří ceny',near(freshnessOf(parts,10*60000),.7*.5+.3)&&near(freshnessOf(parts,120*60000),.35)&&near(freshnessOf([part('rates',1)],67.5*60000),.7+.3*.5));
}

// ---- statistiky, shrnutí, převod skóre
{
 const t=(r,pnl,closed)=>({id:'t'+closed,instrument:'EUR/USD',direction:'long',opened:closed-DAY,entry:1,sl:.99,tp:1.02,riskCzk:1000,confidence:70,scoreAtEntry:60,partsAtEntry:{method:'score-v3',coverage:90,alignment:80,freshness:1,atr:.01,parts:[]},why:'Proč X',closed,exit:1,exitReason:r>0?'tp':'sl',r,pnlCzk:pnl,pct:0,scoreAtExit:20,resultNote:'Výsledek Y',rulesVersion:PAPER_RULES_VERSION});
 const tr=[t(2,2000,NOW-3*DAY),t(-1,-1000,NOW-2*DAY),t(-1,-1000,NOW-DAY)];
 const st=paperStats(tr,100000,500,[{t:NOW-3*DAY,equity:102000},{t:NOW-2*DAY,equity:101000},{t:NOW-DAY,equity:100000}]);
 check('statistiky: equity, výnos, win rate, průměr R',st.balance===100000&&st.equity===100500&&st.returnPct===.5&&st.winRate===33.3&&st.avgR===0&&st.trades===3,st);
 check('max. drawdown',near(st.maxDrawdownPct,-1.96,1e-9)&&maxDrawdownPct([{t:0,equity:100},{t:1,equity:80},{t:2,equity:120}])===-20,st.maxDrawdownPct);
 const md=paperSummaryMd({started:NOW-5*DAY,stats:st,open:[],closed:tr});
 check('shrnutí pro AI: stav, pravidla, poznámky',md.includes('## Simulace 100 000 Kč')&&md.includes('Pravidla v1')&&md.includes('Proč X')&&md.includes('Výsledek Y')&&md.includes('Posledních 3 uzavřených'));
 check('shrnutí bez startu',paperSummaryMd({started:null,stats:st,open:[],closed:[]}).includes('ještě neběžela'));
 const v3=toPaperSignal({score:40,coverage:80,alignment:70,method:'score-v3',parts:[{id:'rates',label:'Sazby',weight:15,value:2,signal:1,contribution:18.75,detail:'Fed',status:'ok'}]});
 const tech=toPaperSignal({score:70,coverage:100,alignment:100,method:'technical-v1.1',parts:[{id:'trend',label:'Trend',weight:70,signal:1,contribution:70,reason:'x'},{id:'seasonality',label:'Sezonalita',weight:30,signal:null,contribution:null,reason:'x'}]});
 check('převod skóre: v3 i technický model',v3.parts[0].value===2&&v3.parts[0].detail==='Fed'&&tech.parts[0].value===2&&tech.parts[1].status==='missing'&&tech.parts[0].detail==='');
}

// ---- přístup: nové routy jen pro vlastníka (404 i pro admina), graf žádá data jen jako vlastník
{
 const U='https://tradee.eu/api/laborator/paper';
 check('/api/laborator/paper: admin, člen i nepřihlášený → 404',[{id:'a',role:'admin',owner:false},{id:'m',role:'member',owner:false},null].every(u=>labGate(u,U).status===404)&&labGate({id:'o',role:'admin',owner:true},U+'?instrument=EUR%2FUSD').id==='o');
 const src=readFileSync(new URL('../app/api/laborator/paper/route.ts',import.meta.url),'utf8');
 const handlers=src.split(/export async function /).slice(1);
 check('route: každý handler začíná labUser (404)',handlers.length===2&&handlers.every(h=>/^(GET|POST)\(req:Request\)\{try\{const u=await labUser\(req\);if\(u instanceof Response\)return u;/.test(h)));
 check('route: reset jen sameOrigin + potvrzení',/POST[\s\S]*sameOrigin\(req\)[\s\S]*sec-fetch-site[\s\S]*confirm!=='RESTART'/.test(src));
 const chart=readFileSync(new URL('../app/market-chart.tsx',import.meta.url),'utf8');
 const fetches=[...chart.matchAll(/fetch\('\/api\/laborator\/paper/g)].length,guard=/if\(!owner\)return;[\s\S]{0,200}\/api\/laborator\/paper/.test(chart);
 check('graf: data simulace jen pro vlastníka',fetches===1&&guard);
}

if(fails.length){console.log(`\n${fails.length} kontrol selhalo`);process.exit(1)}
console.log('\nVšechny kontroly Simulace prošly.');
