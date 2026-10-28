// Kontrola profilů účtů, registru instrumentů a kalkulačky pozice: node --experimental-strip-types scripts/check-risk.mjs
import {readFileSync} from 'node:fs';
import {positionSize,floorToStep,makeRate,sizeLine,stepDecimals} from '../lib/risk/size.ts';
import {SEED,applyOverride,parseOverride,findInstrument,instrumentsForMarket,defaultInstrumentFor,rowToInstrument,mergeInstruments,seedSql,cleanSymbol} from '../lib/risk/instruments.ts';
import {accountStatus,tradingDay,dayStartTs,tzOffset,normalizeRules,emptyRules,TEMPLATES,TEMPLATE_NOTE,rulesAt,balancePoints,parseProfileInput,isTimeZone} from '../lib/risk/account.ts';
import {riskPctOf,dailyLossPct,withProfile,fillRiskPct} from '../lib/risk/discipline.ts';
import {normalizeSettings,evaluate} from '../lib/discipline/rules.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const near=(a,b,e=1e-6)=>Math.abs(a-b)<=e;
const I=id=>SEED.find(i=>i.id===id);
const noFx=()=>null;
const spec=(id,ov)=>applyOverride(I(id),ov);

// ---- registr instrumentů
check('seed: 28 FX párů + USD/CZK',SEED.filter(i=>i.kind==='spot'&&i.unit==='lot').length===29&&!!I('USDCZK'));
check('seed: EURUSD lot 100 000, pip 0.0001, tick 0.00001 = 1 USD',I('EURUSD').contractSize===100000&&I('EURUSD').pip===0.0001&&I('EURUSD').tickSize===0.00001&&I('EURUSD').tickValue===1&&I('EURUSD').quote==='USD');
check('seed: USDJPY pip 0.01, tick 0.001 = 100 JPY',I('USDJPY').pip===0.01&&I('USDJPY').tickValue===100&&I('USDJPY').quote==='JPY');
check('seed: GBPJPY a EURGBP existují (základ podle pořadí měn)',!!I('GBPJPY')&&!!I('EURGBP')&&!I('GBPEUR')&&!!I('AUDNZD')&&!!I('CADCHF'));
check('seed: XAUUSD 100 oz, XAGUSD 5000 oz, proxy futures',I('XAUUSD').contractSize===100&&I('XAUUSD').tickValue/I('XAUUSD').tickSize===100&&I('XAGUSD').contractSize===5000&&I('XAGUSD').tickValue/I('XAGUSD').tickSize===5000&&I('XAUUSD').proxy&&I('XAUUSD').dataSymbol==='GC=F');
check('seed: US100/US500 1 USD za bod a lot, proxy indexu',I('US100').tickValue/I('US100').tickSize===1&&I('US500').tickValue/I('US500').tickSize===1&&I('US100').proxy&&I('US100').dataSymbol==='^NDX');
const futs={NQ:[0.25,5],MNQ:[0.25,0.5],ES:[0.25,12.5],MES:[0.25,1.25],GC:[0.1,10],MGC:[0.1,1],CL:[0.01,10]};
check('seed: futures tick a hodnota ticku',Object.entries(futs).every(([id,[t,v]])=>I(id).tickSize===t&&I(id).tickValue===v&&I(id).unit==='kontrakt'&&I(id).lotStep===1&&I(id).minLot===1),Object.keys(futs).map(id=>[id,I(id)?.tickSize,I(id)?.tickValue]));
check('seed: unikátní id, kladná čísla',new Set(SEED.map(i=>i.id)).size===SEED.length&&SEED.every(i=>i.tickSize>0&&i.tickValue>0&&i.lotStep>0&&i.minLot>0&&i.contractSize>0));
check('seed: schopnosti (COT u zlata, fundament u FX modelu, CZK bez)',I('XAUUSD').cot&&I('EURUSD').fundamentals&&I('EURUSD').cot&&!I('USDCZK').fundamentals&&!I('USDCZK').cot&&I('NQ').proxy&&!I('GC').proxy);
const mig=readFileSync(new URL('../drizzle/mariadb/0037_risk.sql',import.meta.url),'utf8');
check('migrace 0037: tabulky',['instruments','instrument_overrides','account_profiles','account_rule_versions'].every(t=>mig.includes('CREATE TABLE IF NOT EXISTS '+t+'(')));
check('migrace 0037: user_id u uživatelských tabulek',/account_profiles\([\s\S]*?user_id VARCHAR\(128\) NOT NULL/.test(mig)&&/instrument_overrides\([\s\S]*?user_id VARCHAR\(128\) NOT NULL/.test(mig)&&/account_rule_versions\([\s\S]*?user_id VARCHAR\(128\) NOT NULL/.test(mig));
check('migrace 0037: oddělovače příkazů',mig.split('--> statement-breakpoint').length===5);
check('migrace 0037: seed = SEED v kódu',mig.trim().endsWith(seedSql().trim()));
check('mapování symbolů brokera',findInstrument(SEED,'EURUSD.m')?.id==='EURUSD'&&findInstrument(SEED,'#XAUUSD')?.id==='XAUUSD'&&findInstrument(SEED,'GOLD')?.id==='XAUUSD'&&findInstrument(SEED,'NAS100.cash')?.id==='US100'&&findInstrument(SEED,'USTEC')?.id==='US100'&&findInstrument(SEED,'BRK-B')?.id==='BRK-B'&&findInstrument(SEED,'XYZ')===null&&findInstrument(SEED,'USDEUR')===null,[cleanSymbol('NAS100.cash')]);
check('trh → instrumenty (CFD první)',defaultInstrumentFor(SEED,'GC=F')?.id==='XAUUSD'&&instrumentsForMarket(SEED,'^NDX').map(i=>i.id).join()==='US100,NQ,MNQ'&&defaultInstrumentFor(SEED,'EUR/USD')?.id==='EURUSD'&&defaultInstrumentFor(SEED,'USD/CZK')?.id==='USDCZK'&&defaultInstrumentFor(SEED,'USD')===null);
const row={id:'XAUUSD',name:'Zlato',kind:'CFD',venue:'',quote_ccy:'USD',tick_size:0.01,tick_value:1,contract_size:100,lot_step:0.01,min_lot:0.01,pip:null,unit:'lot',sessions:'cme',data_symbol:'GC=F',market_id:'GC=F',proxy:1,has_volume:0,has_cot:1,has_fundamentals:0,aliases:'XAUUSD,GOLD'};
check('DB řádek → instrument, vadný řádek null',rowToInstrument(row)?.aliases.join()==='XAUUSD,GOLD'&&rowToInstrument(row)?.proxy===true&&rowToInstrument({...row,tick_size:0})===null&&rowToInstrument({...row,kind:'x'})===null);
check('DB přebije seed, zbytek doplní',mergeInstruments([{...rowToInstrument(row),tickValue:2}]).find(i=>i.id==='XAUUSD').tickValue===2&&mergeInstruments([]).length===SEED.length);
// přepis brokera
check('přepis: hodnoty a náklady',(()=>{const s=spec('XAUUSD',{tickValue:0.1,contractSize:10,commission:7});return s.tickValue===0.1&&s.contractSize===10&&s.commission===7&&s.spread===0&&s.overridden.includes('tickValue')})());
check('přepis: parse',parseOverride({tickValue:'0,5',commission:'',spread:0.2}).ok&&parseOverride({tickValue:'0,5'}).value.tickValue===0.5&&!parseOverride({tickValue:-1}).ok&&!parseOverride({commission:-1}).ok&&!parseOverride({minLot:0.001,lotStep:0.01}).ok&&!parseOverride(null).ok&&Object.keys(parseOverride({}).value).length===0);

// ---- kalkulačka: futures
const fx1=makeRate({});
const nq=spec('NQ',{commission:6});
const f1=positionSize({spec:nq,entry:20000,stop:19990,accountCcy:'USD',balance:50000,mode:'fixed',value:500,rate:fx1});
check('futures: 10 bodů = 40 ticků × 5 = 200 + náklady 6 = 206 / kontrakt',f1.ok&&f1.stopTicks===40&&f1.lossPerUnit===200&&f1.costPerUnit===6&&f1.riskPerUnit===206,f1);
check('futures: rozpočet 500 → 2 kontrakty, riziko 412',f1.ok&&f1.units===2&&f1.moneyAtRisk===412&&f1.unit==='kontrakt'&&f1.side==='long',f1);
const f2=positionSize({spec:nq,entry:20000,stop:19990,accountCcy:'USD',balance:50000,mode:'pct_dd',value:10,remainingDD:2000,rate:fx1});
check('futures: 10 % ze zbývajícího DD 2000 = 200 → pod 1 kontraktem → nelze',!f2.ok&&f2.code==='min_lot'&&near(f2.rawUnits,200/206)&&f2.riskAtMin===206,f2);
const f2b=positionSize({spec:spec('MNQ'),entry:20000,stop:19990,accountCcy:'USD',balance:50000,mode:'pct_dd',value:10,remainingDD:2000,rate:fx1});
check('futures: 10 % z DD 2000 = 200 → MNQ 10 bodů = 20 / kontrakt → 10 kontraktů',f2b.ok&&f2b.budget===200&&f2b.units===10&&f2b.moneyAtRisk===200,f2b);
check('režim % DD: bez DD a vyčerpaný DD',positionSize({spec:nq,entry:2,stop:1,accountCcy:'USD',balance:1,mode:'pct_dd',value:10,remainingDD:null,rate:fx1}).code==='dd'&&positionSize({spec:nq,entry:2,stop:1,accountCcy:'USD',balance:1,mode:'pct_dd',value:10,remainingDD:0,rate:fx1}).code==='dd');
// kovy CFD
const x1=positionSize({spec:spec('XAUUSD'),entry:2400,stop:2396,target:2412,accountCcy:'USD',balance:10000,mode:'fixed',value:200,rate:fx1});
check('kovy: pohyb 1 = 100 / lot, stop 4 = 400 / lot, limit 200 → 0,5 lotu',x1.ok&&x1.lossPerUnit===400&&x1.units===0.5&&x1.moneyAtRisk===200&&x1.unit==='lot',x1);
check('kovy: R:R 3 a zisk',x1.ok&&x1.rr===3&&x1.reward===600,x1);
const xs=positionSize({spec:spec('XAUUSD'),entry:2400,stop:2404,target:2390,accountCcy:'USD',balance:10000,mode:'fixed',value:200,rate:fx1});
check('kovy: short (stop nad vstupem)',xs.ok&&xs.side==='short'&&xs.units===0.5&&xs.rr===2.5,xs);
const xw=positionSize({spec:spec('XAUUSD'),entry:2400,stop:2396,target:2390,accountCcy:'USD',balance:10000,mode:'fixed',value:200,rate:fx1});
check('cíl na špatné straně → varování, R:R null',xw.ok&&xw.rr===null&&xw.warnings.some(w=>/špatné straně/.test(w)),xw);
// FX
const e1=positionSize({spec:spec('EURUSD'),entry:1.1,stop:1.098,accountCcy:'USD',balance:10000,mode:'pct',value:1,rate:fx1});
check('FX: EURUSD 1 % z 10 000 USD, stop 20 pipů → 0,5 lotu, pip 10 USD',e1.ok&&near(e1.stopTicks,200)&&e1.units===0.5&&e1.moneyAtRisk===100&&e1.pipValueAcc===10,e1);
const rates=makeRate({'USD/JPY':150,'USD/CZK':23,'EUR/USD':1.08});
const j1=positionSize({spec:spec('USDJPY'),entry:150,stop:149.7,accountCcy:'CZK',balance:250000,mode:'pct',value:1,rate:rates});
// 30 pipů × 1000 JPY (pip lotu) = 30 000 JPY / lot; JPY→CZK = 23/150 → 4600 CZK / lot; rozpočet 2500 CZK → 0,54 lotu
check('FX: USDJPY na účtu v CZK přes kurz (JPY→CZK křížem přes USD)',j1.ok&&near(j1.rate,23/150)&&j1.lossPerUnit===4600&&j1.units===0.54&&j1.moneyAtRisk===2484,j1);
const j2=positionSize({spec:spec('USDJPY'),entry:150,stop:149.7,accountCcy:'CZK',balance:250000,mode:'pct',value:1,rate:noFx});
check('FX: chybí kurz → nelze spočítat s důvodem',!j2.ok&&j2.code==='fx'&&j2.reason==='Nelze spočítat: chybí kurz JPY → CZK.',j2);
check('kurzy: přímý, obrácený, křížem, ECB záloha',near(rates('EUR','USD'),1.08)&&near(rates('USD','EUR'),1/1.08)&&near(rates('EUR','CZK'),1.08*23)&&rates('GBP','CZK')===null&&near(makeRate({},{USD:1.1,CZK:25})('USD','CZK'),25/1.1)&&makeRate({},{USD:1.1})('EUR','USD')===1.1&&rates('CZK','CZK')===1);
check('bez zůstatku v režimu % → nelze',positionSize({spec:spec('EURUSD'),entry:1.1,stop:1.09,accountCcy:'USD',balance:null,mode:'pct',value:1,rate:fx1}).code==='balance');
check('špatné vstupy',positionSize({spec:spec('EURUSD'),entry:1.1,stop:1.1,accountCcy:'USD',balance:1,mode:'pct',value:1,rate:fx1}).code==='input'&&positionSize({spec:spec('EURUSD'),entry:NaN,stop:1,accountCcy:'USD',balance:1,mode:'pct',value:1,rate:fx1}).code==='input'&&positionSize({spec:spec('EURUSD'),entry:1.1,stop:1.09,accountCcy:'USD',balance:1,mode:'pct',value:0,rate:fx1}).code==='input');
// zaokrouhlení dolů a minimální objem
check('loty: zaokrouhlení DOLŮ na krok',floorToStep(0.579,0.01)===0.57&&floorToStep(0.3,0.1)===0.3&&floorToStep(2.999,1)===2&&floorToStep(0.29999999999,0.01)===0.3&&floorToStep(0.0019,0.001)===0.001&&floorToStep(-1,0.01)===0&&stepDecimals(0.001)===3&&stepDecimals(1)===0);
const m1=positionSize({spec:spec('EURUSD'),entry:1.1,stop:1.09,accountCcy:'USD',balance:1000,mode:'pct',value:0.05,rate:fx1});
check('min. lot: 0,5 USD na 100 pipů → 0,0005 lotu → nelze obchodovat',!m1.ok&&m1.code==='min_lot'&&/minimum je 0,01/.test(m1.reason)&&m1.riskAtMin===10,m1);
const m2=positionSize({spec:spec('EURUSD',{lotStep:0.1,minLot:0.1}),entry:1.1,stop:1.098,accountCcy:'USD',balance:10000,mode:'pct',value:1.5,rate:fx1});
check('min. lot: krok 0,1 → 0,75 dolů na 0,7',m2.ok&&m2.units===0.7&&m2.moneyAtRisk===140,m2);
const sp=positionSize({spec:spec('EURUSD',{spread:0.0001,commission:7}),entry:1.1,stop:1.098,accountCcy:'USD',balance:10000,mode:'pct',value:1,rate:fx1});
check('náklady: spread 1 pip (10 USD) + komise 7 = 17 / lot',sp.ok&&sp.costPerUnit===17&&sp.riskPerUnit===217&&sp.units===0.46&&sp.moneyAtRisk===99.82,sp);
const dw=positionSize({spec:spec('EURUSD'),entry:1.1,stop:1.098,accountCcy:'USD',balance:10000,mode:'pct',value:1,remainingDaily:50,rate:fx1});
check('varování: riziko nad zbývající denní ztrátou',dw.ok&&dw.warnings.some(w=>/denní ztráta/.test(w)),dw);
check('text do grafu',sizeLine(e1,'USD')==='0,5 lotu · riziko 100 USD'&&sizeLine(f1,'USD')==='2 kontrakty · riziko 412 USD'&&sizeLine(j2,'CZK').startsWith('Nelze spočítat'),[sizeLine(e1,'USD'),sizeLine(f1,'USD')]);

// ---- obchodní den, reset a DST
const P='Europe/Prague',NY='America/New_York';
check('zóna: offset Praha zima/léto',tzOffset(Date.UTC(2026,0,15),P)===3600000&&tzOffset(Date.UTC(2026,6,15),P)===7200000&&isTimeZone(NY)&&!isTimeZone('Mars/Base'));
check('reset 00:00 Praha: 23:30 UTC v létě = další den',tradingDay(Date.UTC(2026,6,14,22,30),'00:00',P)==='2026-07-15'&&tradingDay(Date.UTC(2026,6,14,21,30),'00:00',P)==='2026-07-14');
check('reset 17:00 NY: 16:59 = včera, 17:00 = dnešní obchodní den',tradingDay(Date.UTC(2026,6,14,20,59),'17:00',NY)==='2026-07-13'&&tradingDay(Date.UTC(2026,6,14,21,0),'17:00',NY)==='2026-07-14');
check('reset 17:00 NY: začátek dne v létě 21:00 UTC, v zimě 22:00 UTC',dayStartTs(Date.UTC(2026,6,15,3,0),'17:00',NY)===Date.UTC(2026,6,14,21,0)&&dayStartTs(Date.UTC(2026,11,15,3,0),'17:00',NY)===Date.UTC(2026,11,14,22,0));
// DST: USA 1. 11. 2026, Evropa 25. 10. 2026 – týden, kdy je rozdíl NY–Praha jen 5 h
check('DST: Praha po přechodu (25. 10.) začíná den ve 23:00 UTC',dayStartTs(Date.UTC(2026,9,26,10),'00:00',P)===Date.UTC(2026,9,25,23)&&dayStartTs(Date.UTC(2026,9,25,10),'00:00',P)===Date.UTC(2026,9,24,22));
check('DST: NY 17:00 v týdnu rozdílných přechodů = 21:00 UTC, po 1. 11. 22:00 UTC',dayStartTs(Date.UTC(2026,9,28,12),'17:00',NY)===Date.UTC(2026,9,27,21)&&dayStartTs(Date.UTC(2026,10,2,12),'17:00',NY)===Date.UTC(2026,10,1,22));
check('DST: jarní přechod NY (8. 3.) – den 7. 3. 17:00 EST',dayStartTs(Date.UTC(2026,2,8,12),'17:00',NY)===Date.UTC(2026,2,7,22)&&dayStartTs(Date.UTC(2026,2,9,12),'17:00',NY)===Date.UTC(2026,2,8,21));
check('reset přes měsíc a rok',tradingDay(Date.UTC(2026,0,1,1),'02:00','UTC')==='2025-12-31');

// ---- stav účtu
const H=3600000,NOW=Date.UTC(2026,6,15,14,0); // 15. 7. 16:00 Praha
const R=(o={})=>normalizeRules({...emptyRules(),...o});
const daily=R({dailyLoss:{type:'pct',value:5,base:'dayStart',ref:'equity',reset:'00:00',tz:P}});
const pts=[{ts:Date.UTC(2026,6,14,12),balance:10200,equity:10200}];
const s1=accountStatus({rules:daily,start:10000,now:NOW,balance:10100,equity:10050,points:pts,trades:[]});
check('denní ztráta: 5 % ze zůstatku na začátku dne (10 200) = 510, použito 150 (equity)',s1.daily.limit===510&&s1.daily.dayStartBalance===10200&&s1.daily.used===150&&s1.daily.remaining===360,s1.daily);
check('denní ztráta: další reset o půlnoci Praha',s1.daily.resetAt===Date.UTC(2026,6,15,22),s1.daily);
const s1b=accountStatus({rules:R({dailyLoss:{type:'amount',value:500,base:'initial',ref:'balance',reset:'00:00',tz:P}}),start:10000,now:NOW,balance:9450,equity:9300,points:pts,trades:[]});
check('denní ztráta: částka, podle zůstatku, překročeno',s1b.daily.limit===500&&s1b.daily.used===750&&s1b.daily.remaining===-250&&s1b.breached.includes('daily'),s1b.daily);
const s1c=accountStatus({rules:R({dailyLoss:{type:'pct',value:5,base:'initial',ref:'equity',reset:'00:00',tz:P}}),start:10000,now:NOW,balance:10300,equity:10300,points:pts,trades:[]});
check('denní ztráta: zisk dne zvětší rezervu',s1c.daily.limit===500&&s1c.daily.used===-100&&s1c.daily.remaining===600,s1c.daily);
// drawdown statický a trailing
const stat=accountStatus({rules:R({drawdown:{type:'static',mode:'pct',value:10,ref:'equity',when:'intraday',lockAtStart:false}}),start:10000,now:NOW,balance:10500,equity:10400,points:[{ts:NOW-H,balance:11000,equity:11200}],trades:[]});
check('statický DD: dno 9000 bez ohledu na maximum',stat.drawdown.floor===9000&&stat.drawdown.remaining===1400&&stat.drawdown.peak===10000,stat.drawdown);
// den 14. 7.: přes den equity 10 800, na konci dne zůstatek 10 300; dnes (15. 7.) equity 10 100
const dayPts=[{ts:Date.UTC(2026,6,14,9),balance:10000,equity:10800},{ts:Date.UTC(2026,6,14,18),balance:10300,equity:10300},{ts:NOW-H,balance:10300,equity:10500}];
const tr=(when,ref,lock=false)=>accountStatus({rules:R({drawdown:{type:'trailing',mode:'amount',value:600,ref,when,lockAtStart:lock}}),start:10000,now:NOW,balance:10300,equity:10100,points:dayPts,trades:[]}).drawdown;
const tIntra=tr('intraday','equity'),tEod=tr('eod','balance'),tEodEq=tr('eod','equity');
check('trailing intraday (equity): vrchol 10 800 → dno 10 200, zbývá −100 = porušeno',tIntra.peak===10800&&tIntra.floor===10200&&tIntra.remaining===-100,tIntra);
check('trailing EOD (zůstatek): vrchol jen uzavřené dny 10 300 → dno 9 700, zbývá 600',tEod.peak===10300&&tEod.floor===9700&&tEod.remaining===600,tEod);
check('trailing EOD (equity): dnešní maximum 10 500 se nepočítá',tEodEq.peak===10300&&tEodEq.floor===9700&&tEodEq.remaining===400,tEodEq);
const tLock=accountStatus({rules:R({drawdown:{type:'trailing',mode:'amount',value:600,ref:'equity',when:'intraday',lockAtStart:true}}),start:10000,now:NOW,balance:11000,equity:11000,points:[{ts:NOW-H,balance:11000,equity:11000}],trades:[]}).drawdown;
check('trailing se zastaví na startu (lock)',tLock.peak===11000&&tLock.floor===10000&&tLock.remaining===1000,tLock);
// konzistence, cíl, obchodní dny
const trades=[{closeTs:Date.UTC(2026,6,13,10),pnl:300},{closeTs:Date.UTC(2026,6,14,10),pnl:500},{closeTs:Date.UTC(2026,6,14,12),pnl:100},{closeTs:Date.UTC(2026,6,15,10),pnl:-100}];
const cs=accountStatus({rules:R({consistency:{on:true,maxSharePct:40},profitTarget:{type:'pct',value:8},minTradingDays:4}),start:10000,now:NOW,balance:10800,equity:null,points:[],trades});
check('konzistence: nejlepší den 600 z 800 = 75 % > 40 % → potřeba celkem 1500',cs.consistency.bestDay===600&&cs.consistency.total===800&&cs.consistency.sharePct===75&&!cs.consistency.ok&&cs.consistency.needTotal===1500,cs.consistency);
check('cíl 8 % = 800 splněn; obchodní dny 3 z 4',cs.target.amount===800&&cs.target.done&&cs.tradingDays.count===3&&!cs.tradingDays.done,[cs.target,cs.tradingDays]);
const cs2=accountStatus({rules:R({consistency:{on:true,maxSharePct:40}}),start:10000,now:NOW,balance:9900,equity:null,points:[],trades:[{closeTs:NOW-H,pnl:-100}]});
check('konzistence: bez zisku platí',cs2.consistency.sharePct===null&&cs2.consistency.ok);
check('bez pravidel: jen zůstatek',(()=>{const s=accountStatus({rules:emptyRules(),start:1,now:NOW,balance:5,equity:null,points:[],trades:[]});return s.daily===null&&s.drawdown===null&&s.consistency===null&&s.target===null&&s.equity===5&&!s.breached.length})());
check('body zůstatku z obchodů',JSON.stringify(balancePoints(1000,[{closeTs:2,pnl:-50},{closeTs:1,pnl:100}]).map(p=>p.balance))==='[1100,1050]');
// pravidla, šablony, verze
check('šablony: prázdná + obecné challenge/funded, bez názvů firem',TEMPLATES.map(t=>t.id).join()==='empty,challenge_static,funded_trailing'&&TEMPLATES[1].label==='Challenge – statický DD'&&TEMPLATES[2].label==='Funded – trailing DD'&&/ověř u své firmy/.test(TEMPLATE_NOTE)&&TEMPLATES[2].rules.drawdown.type==='trailing');
check('normalizace pravidel: ořez, neznámé hodnoty, zóna',(()=>{const r=normalizeRules({dailyLoss:{type:'pct',value:500,reset:'25:00',tz:'Mars/Base'},drawdown:{type:'trailing',value:'6',when:'x'},maxRiskPct:'',minTradingDays:3.6});return r.dailyLoss.value===100&&r.dailyLoss.reset==='00:00'&&r.dailyLoss.tz==='Europe/Prague'&&r.drawdown.value===6&&r.drawdown.when==='eod'&&r.maxRiskPct===null&&r.minTradingDays===4})());
const v=[{effective:'2026-07-01',rules:R({maxRiskPct:1})},{effective:'2026-08-01',rules:R({maxRiskPct:0.5})}];
check('verze pravidel podle data účinnosti',rulesAt(v,'2026-07-20').maxRiskPct===1&&rulesAt(v,'2026-08-01').maxRiskPct===0.5&&rulesAt(v,'2026-06-01').maxRiskPct===1&&rulesAt([],'2026-01-01')===null);
const pin=parseProfileInput({name:'  Můj  účet ',currency:'USD',startBalance:'10000',kind:'challenge',rules:{maxRiskPct:1},linkId:'mta_x',startDate:'2026-07-01'},'2026-07-15',['USD','CZK']);
check('profil: vstup z API',pin.ok&&pin.value.name==='Můj účet'&&pin.value.startBalance===10000&&pin.value.kind==='challenge'&&pin.value.effective==='2026-07-15'&&pin.value.startDate==='2026-07-01'&&pin.value.linkId==='mta_x',pin);
check('profil: chyby',!parseProfileInput({name:'',currency:'USD',startBalance:1},'2026-07-15',['USD']).ok&&!parseProfileInput({name:'a',currency:'XXX',startBalance:1},'2026-07-15',['USD']).ok&&!parseProfileInput({name:'a',currency:'USD',startBalance:0},'2026-07-15',['USD']).ok&&!parseProfileInput({name:'a',currency:'USD',startBalance:1,feeChallenge:-5},'2026-07-15',['USD']).ok);

// ---- disciplína s profilem
check('riziko v %: z EA, jinak z profilu',riskPctOf(0.8,100,5000)===0.8&&riskPctOf(null,100,5000)===2&&riskPctOf(null,null,5000)===null&&riskPctOf(null,100,null)===null);
const dl=R({dailyLoss:{type:'amount',value:300,base:'dayStart',ref:'equity',reset:'00:00',tz:P},maxRiskPct:0.5});
check('denní limit profilu v %',dailyLossPct(dl,10000,12000)===2.5&&dailyLossPct(R({dailyLoss:{type:'pct',value:5,base:'initial',ref:'equity',reset:'00:00',tz:P}}),10000,8000)===6.25&&dailyLossPct(emptyRules(),1,1)===null);
const S=normalizeSettings({});
const wp=withProfile(S,dl,10000,12000);
check('pravidla + profil: přísnější hodnota, vypnuté zůstane vypnuté',wp.max_risk.value===0.5&&wp.max_daily_loss.value===2&&withProfile({...S,max_risk:{on:false,value:1}},dl,10000,12000).max_risk.on===false&&withProfile(S,null,1,1)===S&&withProfile(S,R({maxRiskPct:5}),1,1).max_risk.value===1);
// T212 obchod bez riskPct: 150 riziko na zůstatku profilu 10 000 = 1,5 % → porušení max_risk z profilu (1 %)
const t={id:'t1',accountId:'a',side:'buy',status:'closed',openTs:NOW,closeTs:NOW+H,openPrice:1,slInitial:0.9,tpInitial:null,riskPct:riskPctOf(null,150,10000),net:-150,closeReason:'sl',balanceStart:10000,slChanges:[],currencies:[]};
const on=normalizeSettings({});for(const k of Object.keys(on))on[k]={...on[k],on:k==='max_risk'};on.max_risk.value=2;
check('T212: riziko z profilu → porušení podle limitu profilu',evaluate(t,[t],withProfile(on,R({maxRiskPct:1}),10000,10000),[]).some(x=>x.rule==='max_risk')&&!evaluate(t,[t],on,[]).length);
const rows=[{account_id:'a',open_ts:10,close_ts:20,net:-100,risk_pct:null,risk_money:100},{account_id:'a',open_ts:30,close_ts:40,net:50,risk_pct:null,risk_money:99},{account_id:'b',open_ts:30,close_ts:40,net:0,risk_pct:null,risk_money:10},{account_id:'a',open_ts:50,close_ts:60,net:0,risk_pct:0.3,risk_money:1}];
const fr=fillRiskPct(rows,[{linkId:'a',start:10000,startTs:0}]);
check('deník: riziko v % z profilu (zůstatek před obchodem)',fr.find(r=>r.open_ts===10&&r.account_id==='a').risk_pct===1&&fr.find(r=>r.open_ts===30&&r.account_id==='a').risk_pct===1&&fr.find(r=>r.account_id==='b').risk_pct===null&&fr.find(r=>r.open_ts===50).risk_pct===0.3,fr);

// ---- zdroj: API routy jen pro přihlášené a mutace se sameOrigin, dotazy filtrují user_id
const src=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const routes=['app/api/risk/context/route.ts','app/api/risk/profiles/route.ts','app/api/risk/profiles/[id]/route.ts','app/api/risk/overrides/route.ts'];
check('API: identity() všude, sameOrigin u změn',routes.every(r=>/identity\(req\)/.test(src(r)))&&routes.slice(1).every(r=>(src(r).match(/export async function (POST|PUT|DELETE)/g)||[]).length===(src(r).match(/sameOrigin\(req\)/g)||[]).length));
const store=src('lib/risk/store.ts');
check('store: dotazy na profily, verze a přepisy mají user_id',(store.match(/FROM (account_profiles|account_rule_versions|instrument_overrides)[^`']*/g)||[]).every(q=>/user_id=\?/.test(q))&&(store.match(/(UPDATE|DELETE FROM) (account_profiles|account_rule_versions|instrument_overrides)[^`']*/g)||[]).every(q=>/user_id=\?|WHERE id=\?$/.test(q)),store.match(/FROM (account_profiles|account_rule_versions|instrument_overrides)[^`']*/g));
// důvěrnost: žádné názvy prop firem / kurzů v kódu a seedech
const all=['lib/risk/instruments.ts','lib/risk/account.ts','lib/risk/size.ts','drizzle/mariadb/0037_risk.sql','app/risk/position-calculator.tsx','app/risk/accounts-page.tsx'].map(p=>{try{return src(p)}catch{return ''}}).join('\n');
check('bez názvů prop firem',!/ftmo|topstep|apex|the5ers|funded ?next|myfundedfx|e8 ?funding|fundingpips/i.test(all));
console.log(fails.length?`\n${fails.length} FAIL`:'\nvše ok');
process.exit(fails.length?1:0);
