// Kontrola FX skóre v3: node --experimental-strip-types scripts/check-score-v3.mjs
import fs from 'node:fs';
import {scoreV3,WEIGHTS,COMPONENTS,MIN_COVERAGE,periodEnd,ageText} from '../lib/score/v3.ts';
import {ROWS} from '../lib/fundamentals/breakdown.ts';
import {marketScore} from '../lib/markets.ts';
import {cotPublished,cotDatesLabel,cotPositionsLabel,cotPublishedLabel} from '../lib/cot-dates.ts';
import {LIMITS} from '../lib/score/v3.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const part=(r,id)=>r.parts.find(p=>p.id===id);
const near=(a,b,eps=0.051)=>a!==null&&b!==null&&Math.abs(a-b)<eps;

// --- váhy ---
check('11 složek, váhy dávají 100 %',COMPONENTS.length===11&&Object.values(WEIGHTS).reduce((s,w)=>s+w,0)===100,WEIGHTS);
check('složky = řádky přehledu skóre',[...COMPONENTS].sort().join()===ROWS.map(r=>r.id).sort().join(),COMPONENTS);
check('váhy podle zadání',WEIGHTS.rates===15&&WEIGHTS.cot===15&&WEIGHTS.trend===15&&WEIGHTS.inflation===10&&WEIGHTS.employment===10&&WEIGHTS.gdp===8&&WEIGHTS.mpmi===6&&WEIGHTS.spmi===6&&WEIGHTS.retailSales===5&&WEIGHTS.seasonality===5&&WEIGHTS.retailPositions===5,WEIGHTS);
check('práh pozastavení 60 %',MIN_COVERAGE===60,MIN_COVERAGE);

// --- období a stáří ---
check('periodEnd: měsíc, kvartál, české názvy',periodEnd('2026-08').kind==='month'&&new Date(periodEnd('2026-08').end).toISOString().slice(0,10)==='2026-08-31'&&periodEnd('2026 Q2 · třetí odhad').kind==='quarter'&&new Date(periodEnd('2. čtvrtletí 2026').end).toISOString().slice(0,10)==='2026-06-30'&&new Date(periodEnd('3 měsíce do července 2026').end).toISOString().slice(0,10)==='2026-07-31'&&new Date(periodEnd('srpen 2026').end).toISOString().slice(0,10)==='2026-08-31'&&new Date(periodEnd('září 2026').end).toISOString().slice(0,10)==='2026-09-30'&&periodEnd('Neověřeno')===null,null);
check('ageText: hodiny / dny',ageText(5*3600000)==='5 h'&&ageText(6*86400000)==='6 dní'&&ageText(3*86400000)==='3 dny'&&ageText(null)===null,[ageText(5*3600000),ageText(6*86400000),ageText(3*86400000)]);

// --- fixtury (vše čerstvé k NOW) ---
const NOW=Date.parse('2026-10-12T12:00:00Z');
const fac=(decision,guidance,labor)=>({decision:{value:decision,reason:'',source:'s'},guidance:{value:guidance,reason:'',source:'s'},activity:{value:0,reason:'',source:'s'},labor:{value:labor,reason:'',source:'s'}});
const o=(value,period='2026-09',checkedAt='2026-10-10T00:00:00Z')=>({value,period,checkedAt,sourceUrl:'https://stat.test/'+period,note:''});
const mkData=()=>({schemaVersion:1,methodVersion:'t',checkedAt:'2026-10-12T06:00:00Z',reviewCadenceHours:4,staleAfterHours:36,horizon:'',coverageNote:'',
 sources:{s:{label:'Banka',url:'https://bank.test',publishedAt:null,checkedAt:'2026-10-12T06:00:00Z'}},
 currencies:{USD:{bank:'Fed',rate:'4 %',decisionDate:'2026-09-16',source:'s',facts:[],scenario:'',risk:'',factors:fac(1,1,0)},
  CAD:{bank:'BoC',rate:'2,25 %',decisionDate:'2026-09-02',source:'s',facts:[],scenario:'',risk:'',factors:fac(0,0,-1)},
  EUR:{bank:'ECB',rate:'2,5 %',decisionDate:'2026-09-10',source:'s',facts:[],scenario:'',risk:'',factors:fac(1,0,1)}},
 observations:{
  USD:{gdp:o('+0,6 % mezikvartálně','2026 Q2'),retailSales:o('+1,2 % meziměsíčně'),mpmi:o('S&P Global PMI 54,5'),spmi:o('S&P Global Services PMI 56,9'),inflation:o('CPI +3,4 % meziročně'),employment:o('NFP +29 000')},
  CAD:{gdp:o('+0,1 % mezikvartálně','2026 Q2'),retailSales:o('−0,7 % meziměsíčně'),mpmi:o('PMI 50,0'),spmi:o('51,0'),inflation:o('CPI +3,0 % meziročně')},
  EUR:{gdp:o('+0,1 % mezikvartálně','2026 Q2'),retailSales:o('+0,1 % meziměsíčně'),mpmi:o('49,0'),spmi:o('50,2'),inflation:o('HICP 3,8 % meziročně')}},
 pairObservations:{'USD/CAD':{retailPositions:o('Long 19 % / short 81 %','snímek','2026-10-12T08:00:00Z')},'CAD/USD':{retailPositions:o('Long 81 % / short 19 %','snímek','2026-10-12T08:00:00Z')},'EUR/USD':{retailPositions:o('Long 87 % / short 13 %','snímek','2026-10-12T08:00:00Z')}},
 events:[],institutions:[],changes:[],history:[]});
const cot=(r,r0,isProxy=false,last='2026-10-06')=>({contract:'X',code:'1',isProxy,sourceUrl:'https://cftc.test',checkedAt:'2026-10-10T00:00:00Z',history:Array.from({length:40},(_,i)=>{const d=new Date(Date.parse(last)-(39-i)*7*86400000).toISOString().slice(0,10),ratio=i===39?r:r0;return {date:d,openInterest:1000,groups:{leveraged:{long:500+ratio*500,short:500-ratio*500,spread:0,net:ratio*1000}}}})});
const years=lr=>Array.from({length:10},(_,i)=>({year:2016+i,path:[0],logReturn:lr[i]}));
const price=(trend,lr,asOf='2026-10-09')=>({asOf,checkedAt:'2026-10-10T00:00:00Z',sourceUrl:'https://ecb.test',reference:1.42,gma50:1.4,gma200:1.39,trend,months:{'10':{years:years(lr)}},currentMonth:10,currentYear:2026,currentPath:[],pricePath:[]});
const up=[1,1,1,1,1,1,1,1,1,-0.5],neg=a=>a.map(x=>-x);
const mkMarket=()=>({cot:{CAD:cot(-0.2,-0.2),USD:cot(0.3,0.3,true),EUR:cot(0.1,0.05)},prices:{'USD/CAD':price(1,up),'CAD/USD':price(-1,neg(up)),'EUR/USD':price(-1/3,up.map(x=>x*0.01)),'USD/EUR':price(1/3,up.map(x=>-x*0.01)),'EUR/CAD':price(1,up),'CAD/EUR':price(-1,neg(up)),USD:price(1,up),CAD:price(-1,neg(up)),EUR:price(0,up.map(()=>0))},refresh:{attemptedAt:'',issues:[]}});
const data=mkData(),market=mkMarket();

// USD/CAD: COT +1, HDP +1 (0,5 p. b. < 0,8), Retail Sales +2 (1,9 p. b.), mPMI +1 (4,5 b. < 5), sPMI +2 (5,9 b.), Inflace 0 (0,4 p. b. < 0,5),
// Sazby +2, Zaměstnanost +1, Trend +2, Sezonalita +2, Retail pozice +2 (long 19 % kontrariánsky)
const r=scoreV3('USD/CAD',data,market,NOW);
const expect=(vals)=>{const ids=Object.keys(vals),W=ids.reduce((s,id)=>s+WEIGHTS[id],0);return ids.reduce((s,id)=>s+WEIGHTS[id]*vals[id]/2,0)/W*100};
const full={cot:1,gdp:1,retailSales:2,mpmi:1,spmi:2,inflation:0,rates:2,employment:1,trend:2,seasonality:2,retailPositions:2};
check('plná data: hodnoty složek −2…+2',COMPONENTS.every(id=>part(r,id).value===full[id]),r.parts.map(p=>[p.id,p.value,p.status,p.missingReason]));
check('plná data: pokrytí 100 %, 11/11',r.coverage===100&&r.available===11&&r.paused===null,[r.coverage,r.available,r.paused]);
check('skóre = Σ w·s/2 / Σw · 100',near(r.score,expect(full)),[r.score,expect(full)]);
check('součet příspěvků = skóre',near(r.parts.reduce((s,p)=>s+(p.contribution??0),0),r.score),[r.parts.map(p=>p.contribution),r.score]);
check('příspěvek = w·s/2 / Σw · 100',near(part(r,'rates').contribution,15)&&near(part(r,'cot').contribution,7.5),[part(r,'rates').contribution,part(r,'cot').contribution]);
check('metoda score-v3, model FX kompozit',r.method==='score-v3'&&r.model==='FX kompozit',[r.method,r.model]);
check('složka nese detail, stáří, okno a zdroj',r.parts.every(p=>p.detail&&p.window&&p.label&&p.weight>0)&&part(r,'cot').asOfLabel==='pozice k úterý 6. 10. · zveřejněno pátek 9. 10.'&&part(r,'cot').age==='3 dny'&&part(r,'cot').source==='https://cftc.test'&&/11 dní/.test(part(r,'cot').window)&&/200 dní/.test(part(r,'trend').window)&&/10/.test(part(r,'seasonality').window),[part(r,'cot').asOfLabel,part(r,'cot').age,part(r,'cot').source]);
check('shoda: všechny příspěvky kladné → 100 %',r.alignment===100&&r.bias==='Bullish',[r.alignment,r.bias]);

// renormalizace: bez COT CAD → COT chybí, váhy ostatních se přepočítají
const noCot={...mkMarket(),cot:{USD:cot(0.3,0.3,true),EUR:cot(0.1,0.05)}};
const rn=scoreV3('USD/CAD',data,noCot,NOW),{cot:_c,...rest}=full;
check('renormalizace: chybí COT → pokrytí 85 %, skóre ze zbytku',rn.coverage===85&&part(rn,'cot').value===null&&part(rn,'cot').contribution===null&&part(rn,'cot').status==='missing'&&near(rn.score,expect(rest)),[rn.coverage,rn.score,expect(rest)]);
check('renormalizace: součet příspěvků = skóre',near(rn.parts.reduce((s,p)=>s+(p.contribution??0),0),rn.score),null);

// < 60 % → null s výčtem chybějících
const thin=mkData();for(const c of ['USD','CAD'])thin.observations[c]={};thin.pairObservations={};
const thinM={...mkMarket(),cot:{}};
const rt=scoreV3('USD/CAD',thin,thinM,NOW);
check('dostupné váhy < 60 % → skóre null',rt.coverage<60&&rt.score===null&&rt.coverage===15+10+15+5,[rt.coverage,rt.score]);
check('pozastavení vypisuje, co chybí',/Pozastaveno – chybí podklady/.test(rt.paused)&&/COT/.test(rt.paused)&&/Inflace/.test(rt.paused)&&rt.missingParts.length===7&&rt.bias.startsWith('Pozastaveno'),rt.paused);
const edge=mkData();for(const c of ['USD','CAD']){edge.observations[c]={inflation:edge.observations[c].inflation}}; // sazby 15 + zaměstnanost 10 + trend 15 + sezonalita 5 + inflace 10 + retail pozice 5 = 60
const re=scoreV3('USD/CAD',edge,{...mkMarket(),cot:{}},NOW);
check('přesně 60 % → skóre se počítá',re.coverage===60&&re.score!==null,[re.coverage,re.score]);

// retail pozice kontrariánsky
const eu=scoreV3('EUR/USD',data,market,NOW);
check('retail long 87 % → −2, záporný příspěvek',part(eu,'retailPositions').value===-2&&part(eu,'retailPositions').contribution<0,part(eu,'retailPositions'));
check('retail long 19 % → +2',part(r,'retailPositions').value===2,part(r,'retailPositions'));

// zastaralé složky
const staleD=mkData();staleD.pairObservations['USD/CAD'].retailPositions.checkedAt='2026-10-10T10:00:00Z'; // 50 h
staleD.observations.USD.inflation.period='2026-07'; // konec 31. 7. → 73 dní (ještě OK)
staleD.observations.USD.retailSales.period='2026-06'; // konec 30. 6. → 104 dní > 75
staleD.observations.CAD.gdp.period='2026 Q1'; // konec 31. 3. → 195 dní > 140
const staleM={...mkMarket(),cot:{...mkMarket().cot,CAD:cot(-0.2,-0.2,false,'2026-09-29')}}; // 13 dní
staleM.prices['USD/CAD']=price(1,up,'2026-10-01'); // 11 dní > 7
const rs=scoreV3('USD/CAD',staleD,staleM,NOW);
const st=id=>part(rs,id);
check('COT starší 11 dní → zastaralé, nezapočteno',st('cot').status==='stale'&&st('cot').stale&&st('cot').missingReason==='zastaralé'&&st('cot').value===null&&st('cot').contribution===null&&st('cot').age==='10 dní',st('cot')); // 13 dní od pozic = 10 dní od zveřejnění
check('retail pozice starší 48 h → zastaralé',st('retailPositions').status==='stale',st('retailPositions'));
check('měsíční makro > 75 dní → zastaralé, 73 dní ještě platí',st('retailSales').status==='stale'&&st('inflation').status==='ok',[st('retailSales').status,st('inflation').status]);
check('čtvrtletní HDP > 140 dní → zastaralé',st('gdp').status==='stale',st('gdp'));
check('trend starší 7 dní → zastaralé',st('trend').status==='stale',st('trend'));
check('zastaralé se nezapočítává do pokrytí',rs.coverage===100-15-5-5-8-15&&rs.missingParts.some(x=>/COT \(zastaralé\)/.test(x)),[rs.coverage,rs.missingParts]);
const oldSrc=mkData();oldSrc.sources.s.checkedAt='2026-10-10T20:00:00Z'; // 40 h > 36 h
const ro=scoreV3('USD/CAD',oldSrc,market,NOW);
check('sazby a zaměstnanost: ověření banky > 36 h → zastaralé',part(ro,'rates').status==='stale'&&part(ro,'employment').status==='stale'&&ro.coverage===75,[part(ro,'rates').status,ro.coverage]);
const fut=mkMarket();fut.cot.CAD=cot(-0.2,-0.2,false,'2026-10-13');
check('report z budoucnosti se nepoužije',part(scoreV3('USD/CAD',data,fut,NOW),'cot').status!=='ok',null);
// --- COT: datum pozic (úterý) a zveřejnění (pátek = +3 dny); stáří od zveřejnění, okno stejné jako dřív (11 dní od pozic)
check('COT: zveřejnění = úterý + 3 dny (pátek), i přes konec měsíce',cotPublished('2026-10-06')==='2026-10-09'&&cotPublished('2026-09-29')==='2026-10-02'&&cotPublished('2026-12-29')==='2027-01-01',[cotPublished('2026-10-06'),cotPublished('2026-12-29')]);
check('COT: popisky „pozice k úterý D. M.“ a „zveřejněno pátek D. M.“',cotPositionsLabel('2026-10-06')==='pozice k úterý 6. 10.'&&cotPublishedLabel('2026-10-06')==='zveřejněno pátek 9. 10.'&&cotDatesLabel('2026-10-20T00:00:00')==='pozice k úterý 20. 10. · zveřejněno pátek 23. 10.',cotDatesLabel('2026-10-06'));
check('COT: limit 8 dní od zveřejnění = 11 dní od data pozic',LIMITS.cot===8*86400000,LIMITS.cot);
{const DAYMS=86400000,base=Date.parse('2026-10-06T00:00:00Z'),at=t=>part(scoreV3('USD/CAD',data,mkMarket(),t),'cot').status;
 const mk=last=>{const m=mkMarket();m.cot.CAD=cot(-0.2,-0.2,false,last);return m},st2=t=>part(scoreV3('USD/CAD',data,mk('2026-10-06'),t),'cot');
 check('COT: hranice stáří beze změny (11 dní od pozic ok, o minutu víc zastaralé)',st2(base+11*DAYMS).status==='ok'&&st2(base+11*DAYMS+60000).status==='stale'&&at(NOW)==='ok',[st2(base+11*DAYMS).status,st2(base+11*DAYMS+60000).status]);
 check('COT: hodnota skóre se změnou počítání stáří nemění',near(part(scoreV3('USD/CAD',data,mkMarket(),NOW),'cot').contribution,7.5),part(scoreV3('USD/CAD',data,mkMarket(),NOW),'cot').contribution);}

// symetrie
const inv=scoreV3('CAD/USD',data,market,NOW);
check('obrácený pár → přesně opačné skóre',inv.score===-r.score&&inv.coverage===r.coverage,[r.score,inv.score]);
check('obrácený pár → opačné příspěvky',COMPONENTS.every(id=>(part(inv,id).contribution??0)===-(part(r,id).contribution??0)),r.parts.map(p=>[p.id,p.contribution,part(inv,p.id).contribution]));
const invN=scoreV3('CAD/USD',data,noCot,NOW);
check('symetrie i po renormalizaci',invN.score===-rn.score,[rn.score,invN.score]);

// měnový index
const ix=scoreV3('USD',data,market,NOW);
check('měnový index: skóre, retail pozice se nesleduje',ix.quote===undefined&&ix.others.length===2&&part(ix,'retailPositions').status==='missing'&&ix.coverage===95&&ix.score!==null,[ix.coverage,ix.score,part(ix,'retailPositions')]);
check('měnový index: složka = průměr párů',near(part(ix,'rates').value,(part(r,'rates').value+part(scoreV3('USD/EUR',data,market,NOW),'rates').value)/2,1e-9),[part(ix,'rates').value]);

// neplatné vstupy, marketScore
let threw=0;for(const x of ['EUR/EUR','EUR/ABC','A/B/C'])try{scoreV3(x,data,market,NOW)}catch{threw++}
check('neplatný instrument → výjimka',threw===3,threw);
check('marketScore: FX → score-v3, akcie → technický model',marketScore(data,market,'USD/CAD',NOW).method==='score-v3'&&marketScore(data,market,'USD',NOW).method==='score-v3'&&marketScore(data,{...market,prices:{...market.prices,AAPL:price(1,up)}},'AAPL',NOW).method==='technical-v1.1',null);

// zdroj makra: Trading Economics / oficiální statistika → období a odkaz ze zdroje
{const d=mkData();d.tePmi={updated:'',currencies:{CAD:{spmi:{value:48.3,previous:46.8,period:'2026-09',fetchedAt:'2026-10-12T00:00:00Z',url:'https://tradingeconomics.com/canada/services-pmi',publisher:'S&P Global',series:''}}}};
 d.retailOfficial={updated:'',currencies:{USD:{value:1.13,previous:-0.46,unit:'%',kind:'m/m',period:'2026-08',fetchedAt:'2026-10-12T00:00:00Z',source:'FRED/Census',series:'',url:'https://fred.stlouisfed.org/series/RSAFS'}}};
 const x=scoreV3('USD/CAD',d,market,NOW),sp=part(x,'spmi'),rs=part(x,'retailSales');
 check('v3: sPMI z TE – období, odkaz a štítek zdroje',sp.status==='ok'&&/CAD 2026-09/.test(sp.asOfLabel)&&sp.sources.some(s=>s.url==='https://tradingeconomics.com/canada/services-pmi'&&/Trading Economics/.test(s.label))&&/Trading Economics/.test(sp.detail),sp);
 check('v3: maloobchod z oficiální statistiky – odkaz = url zdroje',rs.status==='ok'&&rs.source==='https://fred.stlouisfed.org/series/RSAFS'&&/USD 2026-08/.test(rs.asOfLabel)&&/FRED\/Census/.test(rs.detail),rs);
}

// --- reálná data: žádná výjimka, rozsahy, symetrie (retail pozice jsou vzorek konkrétního páru → bez nich) ---
const read=n=>JSON.parse(fs.readFileSync(new URL('../data/'+n,import.meta.url)));
const D={...read('fundamentals.json'),ffMacro:read('ff-macro.json'),tePmi:read('te-pmi.json'),retailOfficial:read('retail-official.json')},core=read('score-market.json'),ex=read('expanded-market.json'),M={...core,prices:{...core.prices,...ex.prices}};
const Dn={...D,pairObservations:Object.fromEntries(Object.entries(D.pairObservations||{}).map(([k,v])=>[k,{...v,retailPositions:undefined}]))};
const cc=Object.keys(D.currencies);let bad=[],n=0;
for(const T of [Date.now(),Date.parse(core.refresh.attemptedAt)+3600000,Date.parse(D.checkedAt)+3600000])for(const a of cc){
 const ix=scoreV3(a,D,M,T);if(ix.score!==null&&Math.abs(ix.score)>100)bad.push(a);
 for(const q of cc){if(a===q)continue;n++;const x=scoreV3(a+'/'+q,Dn,M,T),y=scoreV3(q+'/'+a,Dn,M,T);
  if(x.score!==null&&(Math.abs(x.score)>100||!near(x.parts.reduce((s,p)=>s+(p.contribution??0),0),x.score,0.06)))bad.push(a+'/'+q+' rozsah');
  if(x.score!==(y.score===null?null:-y.score||0)||x.coverage!==y.coverage)bad.push(a+'/'+q+` symetrie ${x.score} ${y.score}`);}}
check(`reálná data: ${n} výpočtů párů ve 3 časech, rozsahy a symetrie`,bad.length===0,bad.slice(0,10));

if(fails.length){console.log(`\n${fails.length} FAIL`);process.exit(1)}
console.log('\nvše ok: skóre v3');
