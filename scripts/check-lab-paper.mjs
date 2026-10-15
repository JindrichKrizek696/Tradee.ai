// Kontrola Simulace v Laboratoři (výpočty, výstupy, limity, zprávy, jistota, idempotence, přístup): node --experimental-strip-types scripts/check-lab-paper.mjs
import {readFileSync} from 'node:fs';
import {paperStep,checkExit,rOf,pctOf,halfSpread,atrLast,tradingDays,paperConfidence,freshnessOf,markToMarket,legs,marketCurrencies,paperStats,paperSummaryMd,maxDrawdownPct,toPaperSignal,tradeId,PAPER_RULES_VERSION,
 PAPER_VARIANTS,VARIANT_IDS,marketGroup,gmaLast,trendLast,contraSetup,contraConfidence,sweepVariant,sweepRules,sweepEntryCheck,isVariantId,isSweepVariant,SWEEP_VARIANT_IDS} from '../lib/lab/paper.ts';
import {weeklySummary} from '../lib/lab/paper-weekly.ts';
import {isMissingLabTable} from '../lib/lab/core.ts';
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
 check('shrnutí pro AI: stav, pravidla, poznámky',md.includes('## Simulace 100 000 Kč')&&md.includes('Pravidla A (paper-v1)')&&md.includes('varianta A – Základní')&&md.includes('Proč X')&&md.includes('Výsledek Y')&&md.includes('posledních 3 uzavřených'));
 check('shrnutí bez startu',paperSummaryMd({started:null,stats:st,open:[],closed:[]}).includes('ještě neběžela'));
 const v3=toPaperSignal({score:40,coverage:80,alignment:70,method:'score-v3',parts:[{id:'rates',label:'Sazby',weight:15,value:2,signal:1,contribution:18.75,detail:'Fed',status:'ok'}]});
 const tech=toPaperSignal({score:70,coverage:100,alignment:100,method:'technical-v1.1',parts:[{id:'trend',label:'Trend',weight:70,signal:1,contribution:70,reason:'x'},{id:'seasonality',label:'Sezonalita',weight:30,signal:null,contribution:null,reason:'x'}]});
 check('převod skóre: v3 i technický model',v3.parts[0].value===2&&v3.parts[0].detail==='Fed'&&tech.parts[0].value===2&&tech.parts[1].status==='missing'&&tech.parts[0].detail==='');
}


// ---- varianty A/B/C/D
{
 const V=PAPER_VARIANTS,ids=['EUR/USD','GC=F','BTC-USD','ETH-USD','^NDX','AAPL'];
 const px=id=>id==='GC=F'?2000:id.endsWith('-USD')?50000:id==='^NDX'?20000:id==='AAPL'?200:1.1;
 const quotes=Object.fromEntries(ids.map(id=>[id,quote(px(id))])),D=Object.fromEntries(ids.map(id=>[id,d1(px(id)).map(b=>({...b,h:b.c*1.01,l:b.c*0.99}))]));
 const signals={'EUR/USD':sig(60),'GC=F':sig(70),'BTC-USD':sig(80),'ETH-USD':sig(75),'^NDX':sig(55),'AAPL':sig(52)};
 const a=paperStep({...base,signals,quotes,d1:D,variant:V.A}),b=paperStep({...base,signals,quotes,d1:D,variant:V.B}),dd=paperStep({...base,signals,quotes,d1:D,variant:V.D});
 const noVar=paperStep({...base,signals,quotes,d1:D});
 check('A beze změny: stejný výsledek s i bez varianty, id i rules_version paper-v1',JSON.stringify(a)===JSON.stringify(noVar)&&a.opens.every(t=>t.rulesVersion==='paper-v1'&&t.variant===undefined&&t.id===tradeId(NOW,t.instrument)),a.opens.map(t=>t.id));
 check('A: všechny trhy (FX, komodity, krypto, indexy, akcie), max 5',a.opens.length===5&&a.opens.map(t=>t.instrument).join()==='BTC-USD,ETH-USD,GC=F,EUR/USD,^NDX',a.opens.map(t=>t.instrument));
 check('B: jen FX páry',b.opens.map(t=>t.instrument).join()==='EUR/USD'&&b.opens[0].rulesVersion==='paper-B-v1'&&b.opens[0].variant==='B'&&b.opens[0].id.startsWith('pB')&&b.skipped.length===0,b.opens);
 check('B: měnové indexy ani s FX skupinou ne',marketGroup('EUR')==='currency'&&marketGroup('EUR/USD')==='fx'&&marketGroup('GC=F')==='commodities'&&marketGroup('^NDX')==='index'&&marketGroup('BTC-USD')==='crypto'&&marketGroup('AAPL')==='stock'&&paperStep({...base,signals:{'USD':sig(80)},quotes:{'USD':quote(100)},d1:{'USD':d1(100)},variant:V.B}).opens.length===0);
 check('D: |skóre| ≥ 65 a nejvýš 1 krypto',dd.opens.map(t=>t.instrument).join()==='BTC-USD,GC=F'&&dd.skipped.some(x=>x.instrument==='ETH-USD'&&x.reason.startsWith('krypto'))&&!dd.skipped.some(x=>x.instrument==='EUR/USD')&&dd.opens.every(t=>t.rulesVersion==='paper-D-v1'),[dd.opens.map(t=>t.instrument),dd.skipped]);
 const openBtc={...dd.opens[0],opened:NOW-H};
 check('D: otevřené krypto blokuje další krypto i v dalším běhu',paperStep({...base,trades:[openBtc],signals:{'BTC-USD':sig(80),'ETH-USD':sig(90)},quotes,d1:D,variant:V.D}).skipped.find(x=>x.instrument==='ETH-USD')?.reason.startsWith('krypto')&&paperStep({...base,trades:[openBtc],signals:{'BTC-USD':sig(80),'ETH-USD':sig(90)},quotes,d1:D,variant:V.A}).opens.length===1);
 check('D: FX dál pokrytí ≥ 70 %',paperStep({...base,signals:{'EUR/USD':sig(80,{coverage:65})},quotes,d1:D,variant:V.D}).opens.length===0);
 check('id varianty: A beze změny, B/C/D s písmenem, různé',tradeId(NOW,'EUR/USD')===tradeId(NOW,'EUR/USD','A')&&new Set(VARIANT_IDS.map(v=>tradeId(NOW,'EUR/USD',v))).size===4);
 check('pravidla: verze a text u každé varianty',VARIANT_IDS.every(v=>V[v].rulesVersion.length<=20&&V[v].text.length>3)&&V.A.rulesVersion==='paper-v1'&&V.D.rules.minScore===65&&V.D.rules.maxCrypto===1&&V.B.rules.minScore===50&&V.B.rules.fxMinCoverage===70&&V.B.rules.fxMinAlignment===60);
}

// ---- C (kontra): syntetické řady
{
 const V=PAPER_VARIANTS.C;
 // 260 denních svíček: stálý růst 0,2 %/den → trend +2 (cena nad GMA50 nad GMA200)
 const up=(n=260,g=0.002,p0=1)=>Array.from({length:n},(_,i)=>{const c=p0*Math.exp(g*i);return {t:NOW-(n-i)*DAY,o:c,h:c*1.003,l:c*0.997,c}});
 const down=(n=260)=>up(n,-0.002,2);
 const flat=(n=260)=>Array.from({length:n},(_,i)=>({t:NOW-(n-i)*DAY,o:1.1,h:1.102,l:1.098,c:1.1}));
 const U=up(),g=gmaLast(U,NOW),a=atrLast(U,NOW);
 check('C: trend +2 u rostoucí řady, −2 u klesající, <200 svíček null',trendLast(U,NOW)===2&&trendLast(down(),NOW)===-2&&trendLast(up(150),NOW)===null);
 check('C: GMA50 = geometrický průměr posledních 50 close',near(g,Math.exp(U.slice(-50).reduce((s,b)=>s+Math.log(b.c),0)/50),1e-12));
 const at=k=>g+k*a; // cena k × ATR nad GMA50
 const run=(price,cot,o={})=>paperStep({...base,signals:o.signals??{},quotes:{'EUR/USD':quote(price)},d1:{'EUR/USD':o.bars??U},cot:cot===undefined?{}:{'EUR/USD':cot},variant:V,trades:o.trades??[]});
 const s1=run(at(2.5),0.6),t=s1.opens[0];
 check('C: trend +2, natažení 2,5 ATR, COT +0,6 → short proti trendu',t?.direction==='short'&&t.rulesVersion==='paper-C-v1'&&t.variant==='C'&&t.id.startsWith('pC'),s1);
 check('C: SL 1,5 ATR nad vstupem, TP 3 ATR pod (2 R)',t&&near(t.sl-t.entry,1.5*a,1e-9)&&near(t.entry-t.tp,3*a,1e-9)&&near(rOf(t,t.tp),2,1e-9));
 check('C: jistota z natažení a COT (2,5 ATR, COT 0,6 → 54 %)',t?.confidence===54&&contraConfidence({extAtr:2.5,cot:0.6})===54&&contraConfidence({extAtr:2,cot:null})===40&&contraConfidence({extAtr:9,cot:-1})===100);
 check('C: poznámka „proč“ vysvětluje kontra s čísly',t&&t.why.includes('(kontra)')&&t.why.includes('2,5 × ATR14')&&t.why.includes('GMA50')&&t.why.includes('COT: spekulanti +0,6')&&t.why.includes('přeplněné')&&t.partsAtEntry.contra.trend===2,t?.why);
 check('C: natažení 1,9 ATR = bez vstupu',run(at(1.9),0.6).opens.length===0&&contraSetup(U,NOW,at(1.9),0.6).reason.includes('natažení'));
 check('C: COT slabý (+0,3) nebo proti trendu (−0,6) = bez vstupu',run(at(2.5),0.3).opens.length===0&&run(at(2.5),-0.6).opens.length===0);
 check('C: bez COT dat stačí trend a natažení (jistota bez COT složky)',run(at(2.5)).opens[0]?.confidence===contraConfidence({extAtr:2.5,cot:null}));
 const D=down(),gd=gmaLast(D,NOW),ad=atrLast(D,NOW);
 const s2=paperStep({...base,signals:{},quotes:{'EUR/USD':quote(gd-2.2*ad)},d1:{'EUR/USD':D},cot:{'EUR/USD':-0.8},variant:V});
 check('C: trend −2 a cena 2,2 ATR pod GMA50 → long',s2.opens[0]?.direction==='long'&&s2.opens[0].sl<s2.opens[0].entry,s2);
 check('C: bez trendu ±2 žádný vstup',run(1.2,0.9,{bars:flat()}).opens.length===0);
 check('C: skóre Tradee se pro vstup nepoužívá (silné skóre bez setupu nic)',run(at(1),undefined,{signals:{'EUR/USD':sig(90)}}).opens.length===0);
 const cr=paperStep({...base,signals:{},quotes:{'BTC-USD':quote(at(3)),'AAPL':quote(at(3)),'GC=F':quote(at(3)),'^NDX':quote(at(3))},d1:{'BTC-USD':U,'AAPL':U,'GC=F':U,'^NDX':U},variant:V});
 check('C: jen FX, komodity a indexy (krypto ani akcie ne)',cr.opens.map(x=>x.instrument).sort().join()==='GC=F,^NDX',cr.opens.map(x=>x.instrument));
 // výstupy
 const open={...t,opened:NOW-10*H};
 const ex=(price,o={})=>paperStep({...base,signals:o.signals??{},quotes:{'EUR/USD':quote(price)},d1:{'EUR/USD':U},variant:V,trades:[open]});
 const m=ex(g-0.0001);
 check('C: návrat ke GMA50 = výstup „mean“ za mid + ½ spreadu (short)',m.closes[0]?.exitReason==='mean'&&near(m.closes[0].exit,g-0.0001+halfSpread('EUR/USD',g-0.0001),1e-12)&&m.closes[0].r>0&&m.closes[0].resultNote.includes('vrátila k průměru'),m.closes[0]);
 check('C: nad GMA50 drží, slabé skóre výstup nespouští',ex(g+a,{signals:{'EUR/USD':sig(5)}}).closes.length===0);
 const sl=ex(open.sl+0.001);
 check('C: SL při pokračování trendu',sl.closes[0]?.exitReason==='sl'&&near(sl.closes[0].r,-1,1e-9)&&sl.closes[0].resultNote.includes('nevyšla'));
 const old={...open,opened:Date.UTC(2026,8,29,10)};
 check('C: po 10 obchodních dnech výstup čas',paperStep({...base,signals:{},quotes:{'EUR/USD':quote(g+a)},d1:{'EUR/USD':U},variant:V,trades:[old]}).closes[0]?.exitReason==='time');
 check('C: checkExit s GMA50 – long se zavře nad GMA50',checkExit({...s2.opens[0],opened:NOW-H},{now:NOW,quote:quote(gd+0.0001),gma50:gd})?.exitReason==='mean'&&checkExit({...s2.opens[0],opened:NOW-H},{now:NOW,quote:quote(gd-0.0001),gma50:gd})===null);
}

// ---- varianty ze sweepu (S01…S20)
{
 const C=(o={})=>({threshold:50,entry:'immediate',slAtr:1,exit:'tp2',hold:5,corrCap:false,cooldown:false,set:'fx',...o});
 check('S: id S01…S20, max 20, jiné ne',SWEEP_VARIANT_IDS.length===20&&isVariantId('S01')&&isVariantId('S20')&&isSweepVariant('S07')&&!isVariantId('S21')&&!isVariantId('S1')&&!isVariantId('X')&&isVariantId('A'));
 const V=sweepVariant('S01',C()),R=V.rules;
 check('S: pravidla z kombinace (práh, SL, TP v ATR = R × SL, držení, výstup signálem jen bez TP)',V.kind==='sweep'&&R.minScore===50&&R.slAtr===1&&R.tpAtr===2&&R.maxTradingDays===5&&R.signalExit===false&&R.exitScore===25&&R.fxMinCoverage===0&&V.rulesVersion==='sweep-S01-v1'&&V.rulesVersion.length<=20&&V.text.some(t=>t.includes('fundamenty')),R);
 const s1=sweepRules(C({exit:'signal',corrCap:true,cooldown:true,slAtr:1.5,entry:'contra'}));
 check('S: bez TP, korelační limit, ochlazení 5 dní, kontra 2 ATR',s1.tpAtr===0&&s1.signalExit===true&&s1.maxPerCurrencyDir===2&&s1.maxPerGroup===2&&s1.lossCooldownMs===5*DAY&&s1.minExtAtr===2&&s1.entryMode==='contra');
 const run=(V,o={})=>paperStep({...base,signals:o.signals??{'EUR/USD':sig(62)},quotes:o.quotes??{'EUR/USD':quote(1.1)},d1:o.d1??{'EUR/USD':d1()},variant:V,trades:o.trades??[]});
 const t=run(V).opens[0];
 check('S: okamžitý vstup, SL 1 ATR, TP 2 R, id s variantou',t&&t.variant==='S01'&&t.id.startsWith('pS01')&&near(t.entry-t.sl,0.01,1e-12)&&near(rOf(t,t.tp),2,1e-9)&&t.rulesVersion==='sweep-S01-v1'&&t.why.includes('Plán (S01, práh 50)'),t);
 check('S: pod prahem nic, jen trhy sady (FX sada bez zlata)',run(sweepVariant('S01',C({threshold:70}))).opens.length===0&&run(V,{signals:{'GC=F':sig(80)},quotes:{'GC=F':quote(2000)},d1:{'GC=F':d1(2000)}}).opens.length===0);
 const nt=run(sweepVariant('S02',C({exit:'signal'}))).opens[0];
 check('S: bez TP → tp 0, TP se nikdy nezasáhne',nt.tp===0&&checkExit({...nt,opened:NOW-10*H},{now:NOW,h1:[{t:NOW-8*H,o:1.1,h:5,l:1.1,c:1.1}],quote:quote(1.1),signal:sig(60),rules:sweepRules(C({exit:'signal'}))})===null);
 const RS=sweepRules(C({exit:'signal'})),op={...nt,opened:NOW-H};
 check('S: výstup signálem pod práh/2 (25), TP varianta signálem nekončí',checkExit(op,{now:NOW,quote:quote(1.1),signal:sig(24),rules:RS})?.exitReason==='signal'&&checkExit(op,{now:NOW,quote:quote(1.1),signal:sig(26),rules:RS})===null&&checkExit({...t,opened:NOW-H},{now:NOW,quote:quote(1.1),signal:sig(5),rules:R})===null);
 check('S kontra: výstup podle směru PŮVODNÍHO signálu (short proti skóre +)',checkExit({...op,direction:'short',sl:1.2},{now:NOW,quote:quote(1.1),signal:sig(24),rules:RS,signalSign:-1})?.exitReason==='signal'&&checkExit({...op,direction:'short',sl:1.2},{now:NOW,quote:quote(1.1),signal:sig(60),rules:RS,signalSign:-1})===null);
 // pullback: GMA20 / 1 ATR proti signálu z dokončených svíček
 const pb=sweepEntryCheck('pullback',d1(),NOW,1.1,60,RS);
 check('S pullback: limit = GMA20 (= close) když není pod cenou → close − 1 ATR',pb.ok===false&&near(pb.level,1.09,1e-9)&&pb.reason.includes('čeká'),pb);
 check('S pullback: cena na limitu → vstup long; short zrcadlově',sweepEntryCheck('pullback',d1(),NOW,1.0899,60,RS).ok&&sweepEntryCheck('pullback',d1(),NOW,1.1101,-60,RS).ok&&sweepEntryCheck('pullback',d1(),NOW,1.1101,-60,RS).direction==='short');
 const PV=sweepVariant('S03',C({entry:'pullback'}));
 check('S pullback v kroku: čeká / vstoupí',run(PV).opens.length===0&&run(PV).skipped[0].reason.startsWith('pullback')&&run(PV,{quotes:{'EUR/USD':quote(1.0895)}}).opens.length===1);
 // kontra: trend +2 a natažení
 const up=Array.from({length:260},(_,i)=>{const c=Math.exp(0.002*i);return {t:NOW-(260-i)*DAY,o:c,h:c*1.003,l:c*0.997,c}}),g=gmaLast(up,NOW),a=atrLast(up,NOW);
 const KV=sweepVariant('S04',C({entry:'contra'}));
 const k=run(KV,{d1:{'EUR/USD':up},quotes:{'EUR/USD':quote(g+2.5*a)},signals:{'EUR/USD':sig(60)}});
 check('S kontra: skóre +60, trend +2, 2,5 ATR nad GMA50 → short',k.opens[0]?.direction==='short'&&k.opens[0].partsAtEntry.contra?.trend===2&&k.opens[0].why.includes('Kontra (S04)'),k);
 check('S kontra: skóre proti trendu nebo malé natažení → nic',run(KV,{d1:{'EUR/USD':up},quotes:{'EUR/USD':quote(g+2.5*a)},signals:{'EUR/USD':sig(-60)}}).opens.length===0&&run(KV,{d1:{'EUR/USD':up},quotes:{'EUR/USD':quote(g+a)},signals:{'EUR/USD':sig(60)}}).opens.length===0);
 // ochlazení po ztrátě, korelační limit
 const loss={...t,id:'l',closed:NOW-3*DAY,exit:t.sl,exitReason:'sl',r:-1,pnlCzk:-1000,pct:-1};
 const CV=sweepVariant('S05',C({cooldown:true}));
 check('S: ochlazení 5 dní po ztrátě (bez ochlazení po 24 h vstup)',run(CV,{trades:[loss]}).skipped[0]?.reason.startsWith('ochlazení')&&run(V,{trades:[loss]}).opens.length===1&&run(CV,{trades:[{...loss,closed:NOW-6*DAY}]}).opens.length===1);
 const ids=['EUR/USD','EUR/JPY','EUR/GBP'],q=Object.fromEntries(ids.map(id=>[id,quote(id.includes('JPY')?150:1.1)])),dd=Object.fromEntries(ids.map(id=>[id,d1(id.includes('JPY')?150:1.1)])),sg=Object.fromEntries(ids.map((id,i)=>[id,sig(70-i)]));
 check('S: korelační limit 2 na měnu a směr; bez limitu 3',run(sweepVariant('S06',C({corrCap:true})),{signals:sg,quotes:q,d1:dd}).opens.length===2&&run(V,{signals:sg,quotes:q,d1:dd}).opens.length===3);
 const gm=['GC=F','SI=F','CL=F'],gq=Object.fromEntries(gm.map(id=>[id,quote(100)])),gd=Object.fromEntries(gm.map(id=>[id,d1(100)])),gs=Object.fromEntries(gm.map((id,i)=>[id,sig(80-i)]));
 check('S: skupina kovy nejvýš 2 (zlato, stříbro + ropa)',run(sweepVariant('S07',C({corrCap:true,set:'ci'})),{signals:{...gs,'PL=F':sig(90)},quotes:{...gq,'PL=F':quote(100)},d1:{...gd,'PL=F':d1(100)}}).opens.map(x=>x.instrument).sort().join()==='CL=F,GC=F,SI=F');
 const w=weeklySummary([{id:'S01',name:'Hned 50',started:NOW-2*DAY,startEquity:100000,stats:paperStats([],100000,0,[]),equity:[],trades:[],open:[]}],NOW);
 check('S: týdenní souhrn s názvem varianty ze sweepu',w.md.includes('S01 – Hned 50'));
}

// ---- migrace 0027: varianta A jako výchozí, existující řádky zůstanou A
{
 const sql=readFileSync(new URL('../drizzle/mariadb/0027_lab_paper_variants.sql',import.meta.url),'utf8');
 const tables=['lab_paper_accounts','lab_paper_trades','lab_paper_equity','lab_paper_log'];
 check('migrace: variant VARCHAR(4) NOT NULL DEFAULT \'A\' u všech 4 tabulek',tables.every(t=>new RegExp(`ALTER TABLE ${t} ADD COLUMN variant VARCHAR\\(4\\) NOT NULL DEFAULT 'A'`).test(sql)));
 check('migrace: existující řádky = A',tables.every(t=>sql.includes(`UPDATE ${t} SET variant='A'`)));
 check('migrace: klíče s variantou',/lab_paper_accounts DROP PRIMARY KEY, ADD PRIMARY KEY\(user_id,variant\)/.test(sql)&&/lab_paper_equity DROP PRIMARY KEY, ADD PRIMARY KEY\(user_id,variant,at\)/.test(sql)&&/INDEX lab_paper_trades_user\(user_id,variant,closed\)/.test(sql)&&/INDEX lab_paper_log_user\(user_id,variant,at\)/.test(sql));
 const stm=sql.split('--> statement-breakpoint').map(x=>x.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n').trim()).filter(Boolean);
 check('migrace: jeden příkaz mezi breakpointy',stm.length===12&&stm.every(x=>(x.match(/;/g)||[]).length===1&&x.endsWith(';')),stm.length);
 check('chybí migrace 0027 (Unknown column variant) = 503 jako chybějící tabulka',isMissingLabTable({errno:1054,message:"Unknown column 'variant' in 'where clause'"})&&!isMissingLabTable({errno:1054,message:"Unknown column 'foo' in 'field list'"}));
 const store=readFileSync(new URL('../lib/lab/paper-store.ts',import.meta.url),'utf8');
 check('store: všechny dotazy na lab_paper_* filtrují user_id',store.includes("const where=['user_id=?']")&&[...store.matchAll(/(?:FROM|UPDATE|INTO) (lab_paper_\w+)[^'`]*/g)].every(m=>/user_id/.test(m[0])||m[0].includes('${where.join')),[...store.matchAll(/(?:FROM|UPDATE|INTO) (lab_paper_\w+)[^'`]*/g)].map(m=>m[0]).filter(x=>!/user_id/.test(x)));
}

// ---- týdenní souhrn (čistá funkce)
{
 const W=7*DAY,mk=(o)=>({id:'t',instrument:'EUR/USD',direction:'long',opened:NOW-3*DAY,entry:1.1,sl:1.09,tp:1.12,riskCzk:1000,confidence:70,scoreAtEntry:60,partsAtEntry:{method:'score-v3',coverage:90,alignment:80,freshness:1,atr:.01,parts:[]},why:'Proč <b>&',closed:null,exit:null,exitReason:null,r:null,pnlCzk:null,pct:null,scoreAtExit:null,resultNote:null,rulesVersion:'paper-v1',...o});
 const trades=[mk({id:'w1',closed:NOW-2*DAY,exit:1.12,exitReason:'tp',r:2,pnlCzk:2000,why:'Proč nejlepší'}),mk({id:'w2',instrument:'GBP/USD',closed:NOW-DAY,exit:1.09,exitReason:'sl',r:-1,pnlCzk:-1000,why:'Proč nejhorší'}),
  mk({id:'old',opened:NOW-20*DAY,closed:NOW-10*DAY,exit:1.12,exitReason:'tp',r:2,pnlCzk:2000}),mk({id:'o1',instrument:'GC=F',opened:NOW-DAY})];
 const st=paperStats(trades,100000,500,[]);
 const eq=[{t:NOW-W-DAY,equity:101000},{t:NOW-W+DAY,equity:101500}];
 const s=weeklySummary([{id:'A',started:NOW-30*DAY,startEquity:100000,stats:st,equity:eq,trades,open:[{...trades[3],mark:{price:2010,r:.5,pnlCzk:500}}]},
  {id:'C',started:NOW-2*DAY,startEquity:100000,stats:paperStats([],100000,-200,[]),equity:[{t:NOW-DAY,equity:99800}],trades:[],open:[]},
  {id:'B',started:null,startEquity:100000,stats:paperStats([],100000,0,[]),equity:[],trades:[],open:[]}],NOW);
 const A=s.variants[0],C=s.variants[1];
 check('týden: P&L = equity teď − equity na začátku týdne',A.weekStartEquity===101000&&A.equity===103500&&A.weekPnl===2500&&near(A.weekPct,2.48,1e-9)&&A.totalPnl===3500&&A.totalPct===3.5,A);
 check('týden: účet začal během týdne → od startu',C.weekStartEquity===100000&&C.weekPnl===-200&&C.totalPnl===-200,C);
 check('týden: otevřené / uzavřené za týden, nejlepší a nejhorší',A.opened.map(t=>t.id).join()==='w1,w2,o1'&&A.closed.map(t=>t.id).join()==='w1,w2'&&A.best.id==='w1'&&A.worst.id==='w2');
 check('týden: text a e-mail s „proč“, R a otevřenými pozicemi',s.text.includes('Nejlepší: EUR/USD long +2 R')&&s.text.includes('Proč nejhorší')&&s.text.includes('GC=F long od')&&s.html.includes('Proč nejlepší')&&s.md.includes('**B – Jen FX**: ještě neběží'));
 check('týden: push krátký, předmět s % variant',s.pushBody.length<=180&&/^A \+2\s500 Kč \(\+2,48 %\) · C −200 Kč \(−0,2 %\) · B –$/.test(s.pushBody)&&s.subject.includes('A +2,48 %')&&s.subject.includes('C −0,2 %')&&!s.subject.includes('B '),[s.pushBody,s.subject]);
 const esc=weeklySummary([{id:'A',started:NOW-30*DAY,startEquity:100000,stats:st,equity:eq,trades:[mk({id:'x',closed:NOW-DAY,exit:1.12,exitReason:'tp',r:2,pnlCzk:2000,why:'Proč <b>&'})],open:[]}],NOW);
 check('týden: HTML escapuje poznámky',esc.html.includes('Proč &lt;b&gt;&amp;')&&!esc.html.includes('<b>&'));
 const src=readFileSync(new URL('./lab-paper-weekly.mjs',import.meta.url),'utf8');
 check('týdenní skript: jen vlastník (mail na OWNER_EMAIL, push jen jeho odběry, --dry nic neposílá)',(src.match(/to:\[/g)||[]).length===1&&src.includes('to:[ownerEmail]')&&/FROM push_subscriptions WHERE user_id=\?'\)\.bind\(uid\)/.test(src)&&src.indexOf('if(dry){')<src.indexOf('api.resend.com')&&src.indexOf('if(dry){')<src.indexOf('sendNotification')&&src.includes("timeZone:'Europe/Prague'"));
}

// ---- přístup: nové routy jen pro vlastníka (404 i pro admina), graf žádá data jen jako vlastník
{
 const U='https://tradee.eu/api/laborator/paper';
 check('/api/laborator/paper: admin, člen i nepřihlášený → 404',[{id:'a',role:'admin',owner:false},{id:'m',role:'member',owner:false},null].every(u=>labGate(u,U).status===404)&&labGate({id:'o',role:'admin',owner:true},U+'?instrument=EUR%2FUSD').id==='o');
 const src=readFileSync(new URL('../app/api/laborator/paper/route.ts',import.meta.url),'utf8');
 const handlers=src.split(/export async function /).slice(1);
 check('route: každý handler začíná labUser (404)',handlers.length===2&&handlers.every(h=>/^(GET|POST)\(req:Request\)\{try\{const u=await labUser\(req\);if\(u instanceof Response\)return u;/.test(h)));
 check('route: reset / odebrání jen sameOrigin + potvrzení',/POST[\s\S]*sameOrigin\(req\)[\s\S]*sec-fetch-site[\s\S]*confirm!=='RESTART'[\s\S]*confirm!=='ODEBRAT'/.test(src));
 const chart=readFileSync(new URL('../app/market-chart.tsx',import.meta.url),'utf8');
 const fetches=[...chart.matchAll(/fetch\('\/api\/laborator\/paper/g)].length,guard=/if\(!owner\)return;[\s\S]{0,200}\/api\/laborator\/paper/.test(chart);
 check('graf: data simulace jen pro vlastníka',fetches===1&&guard);
}

if(fails.length){console.log(`\n${fails.length} kontrol selhalo`);process.exit(1)}
console.log('\nVšechny kontroly Simulace prošly.');
