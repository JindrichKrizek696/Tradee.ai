// Kontrola přehledu skóre po složkách: node --experimental-strip-types scripts/check-breakdown.mjs
import fs from 'node:fs';
import {pairBreakdown,bucket,pctChange,pmiLevel,cotPairSignal,ROWS} from '../lib/fundamentals/breakdown.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const row=(b,id)=>b.rows.find(r=>r.id===id);

// --- parsování textových observací ---
check('pctChange q/q i „mezikvartálně“',pctChange('+2,2 % anualizovaně; +0,6 % mezikvartálně','qq')===0.6&&pctChange('+0,4 % q/q · reálný','qq')===0.4,null);
check('pctChange m/m se znaménkem −',pctChange('−0,7 % meziměsíčně; +5,1 % meziročně','mm')===-0.7&&pctChange('MHSI 0,0 % meziměsíčně','mm')===0,null);
check('pctChange y/y bere první meziroční údaj',pctChange('CPI +3,4 % meziročně; jádrová +2,4 %','yy')===3.4&&pctChange('1,0 % y/y · 0,0 % m/m','yy')===1,null);
check('pctChange: jiná perioda → null',pctChange('0,0 % meziměsíčně; předběžný srpen +0,2 %','qq')===null&&pctChange(null,'yy')===null,null);
check('pmiLevel čte úroveň, ne změnu ani procento',pmiLevel('ISM Manufacturing PMI 54,5; srpen 54,6')===54.5&&pmiLevel('53,1 · změna −1,2 bodu')===53.1&&pmiLevel('PSI 51,2 · změna +0,6 bodu')===51.2,[pmiLevel('53,1 · změna −1,2 bodu')]);
check('pmiLevel: slovní komentář / procento → null',pmiLevel('Výroba roste; přesná hodnota chybí.')===null&&pmiLevel('růst 55,0 % firem')===null&&pmiLevel(null)===null,null);
check('bucket prahy včetně hranic a plovoucí čárky',bucket(0.6-0.4,.2,.5)===1&&bucket(.5,.2,.5)===2&&bucket(-.19,.2,.5)===0&&bucket(-.2,.2,.5)===-1&&bucket(-3,.2,.5)===-2,[bucket(0.6-0.4,.2,.5)]);

// --- fixtury ---
const NOW=Date.parse('2026-10-11T12:00:00Z');
const fac=(decision,guidance,labor)=>({decision:{value:decision,reason:'',source:'s'},guidance:{value:guidance,reason:'',source:'s'},activity:{value:0,reason:'',source:'s'},labor:{value:labor,reason:'',source:'s'}});
const o=(value,period='2026-08')=>({value,period,checkedAt:'2026-10-01T00:00:00Z',sourceUrl:'https://example.test',note:''});
const data={schemaVersion:1,methodVersion:'t',checkedAt:'2026-10-10T00:00:00Z',reviewCadenceHours:4,staleAfterHours:36,horizon:'',coverageNote:'',
 sources:{s:{label:'S',url:'https://bank.test',publishedAt:null,checkedAt:'2026-10-10T00:00:00Z'}},
 currencies:{USD:{bank:'Fed',rate:'4 %',decisionDate:'2026-09-16',source:'s',facts:[],scenario:'',risk:'',factors:fac(1,1,0)},
  CAD:{bank:'BoC',rate:'2,25 %',decisionDate:'2026-09-02',source:'s',facts:[],scenario:'',risk:'',factors:fac(0,0,-1)},
  EUR:{bank:'ECB',rate:'2,5 %',decisionDate:'2026-09-10',source:'s',facts:[],scenario:'',risk:'',factors:fac(1,0,null)}},
 observations:{
  USD:{gdp:o('+2,2 % anualizovaně; +0,6 % mezikvartálně'),retailSales:o('+1,2 % meziměsíčně'),mpmi:o('ISM PMI 54,5'),spmi:o('ISM Services PMI 54,9'),inflation:o('CPI +3,4 % meziročně'),employment:o('NFP +29 000')},
  CAD:{gdp:o('0,0 % meziměsíčně'),retailSales:o('−0,7 % meziměsíčně'),mpmi:o(null),spmi:o('51,0'),inflation:o('CPI +3,0 % meziročně')},
  EUR:{gdp:o('+0,1 % mezikvartálně'),retailSales:o('+0,1 % meziměsíčně'),mpmi:o('Výroba roste'),spmi:o('50,2'),inflation:o('HICP 3,8 % meziročně')}},
 pairObservations:{'USD/CAD':{retailPositions:o('Long 19 % · short 81 %','snímek')},'EUR/USD':{retailPositions:o('Long 87 % / short 13 %','snímek')}},
 events:[],institutions:[],changes:[],history:[]};
// COT: 40 týdnů historie, poslední net/OI = r, před 4 týdny r0
const cot=(r,r0,isProxy=false)=>({contract:'X',code:'1',isProxy,sourceUrl:'https://cftc.test',checkedAt:'2026-10-03T00:00:00Z',history:Array.from({length:40},(_,i)=>{const d=new Date(Date.parse('2026-09-29')-(39-i)*7*86400000).toISOString().slice(0,10),ratio=i===39?r:i<=35?r0:r0;return {date:d,openInterest:1000,groups:{leveraged:{long:500+ratio*500,short:500-ratio*500,spread:0,net:ratio*1000}}}})});
const years=(lr)=>Array.from({length:10},(_,i)=>({year:2016+i,path:[0],logReturn:lr[i]}));
const price=(trend,lr)=>({asOf:'2026-10-02',checkedAt:'2026-10-03T00:00:00Z',sourceUrl:'https://ecb.test',reference:1.42,gma50:1.4,gma200:1.39,trend,months:{'10':{years:years(lr)}},currentMonth:10,currentYear:2026,currentPath:[],pricePath:[]});
const up=[1,1,1,1,1,1,1,1,1,-0.5];
const market={cot:{CAD:cot(-0.2,-0.2),USD:cot(0.3,0.3,true),EUR:cot(0.1,0.05)},prices:{'USD/CAD':price(1,up),'CAD/USD':price(-1,up.map(x=>-x)),'EUR/USD':price(-1/3,up.map(x=>x*0.01))},refresh:{attemptedAt:'',issues:[]}};

const b=pairBreakdown('USD/CAD',data,market,NOW);
check('11 řádků ve stanoveném pořadí',b.rows.map(r=>r.id).join()===ROWS.map(r=>r.id).join()&&b.count===11,b.rows.map(r=>r.id));
check('štítky odpovídají zadání',b.rows.map(r=>r.label).join('|')==='COT|HDP|Sezonalita|Trend|Retail Sales|Retail pozice|mPMI (výroba)|sPMI (služby)|Úrokové sazby|Inflace|Zaměstnanost',b.rows.map(r=>r.label));
check('každý řádek má vysvětlení (i) a detail',b.rows.every(r=>r.info.length>20&&r.detail.length>5),null);
check('skóre jen −2…+2 nebo null',b.rows.every(r=>r.score===null||[-2,-1,0,1,2].includes(r.score)),b.rows.map(r=>r.score));
// COT: USD je proxy → rozhoduje CAD (signál −0,6·0,8 = −0,48) s obráceným znaménkem → +0,48 → +1
check('COT u páru s USD: signál cizí měny s obráceným znaménkem',row(b,'cot').score===1&&/CAD/.test(row(b,'cot').detail)&&/proxy/.test(row(b,'cot').detail),row(b,'cot'));
check('HDP: CAD jen měsíční → chybí data (nepřepočítává se)',row(b,'gdp').score===null&&/CAD/.test(row(b,'gdp').detail),row(b,'gdp'));
check('Retail Sales: +1,2 vs −0,7 → +2',row(b,'retailSales').score===2,row(b,'retailSales'));
check('mPMI: CAD bez hodnoty → null',row(b,'mpmi').score===null,row(b,'mpmi'));
check('sPMI: 54,9 vs 51,0 → +2',row(b,'spmi').score===2,row(b,'spmi'));
check('Inflace: 3,4 vs 3,0 → +1',row(b,'inflation').score===1,row(b,'inflation'));
check('Sazby: (1+1) − (0+0) → +2',row(b,'rates').score===2,row(b,'rates'));
check('Zaměstnanost: 0 − (−1) → +1',row(b,'employment').score===1,row(b,'employment'));
check('Trend: tři hlasy nahoru → +2',row(b,'trend').score===2,row(b,'trend'));
check('Sezonalita: 9/10 let růst → +2',row(b,'seasonality').score===2,row(b,'seasonality'));
check('Retail pozice: long 19 % → kontrariánsky +2',row(b,'retailPositions').score===2,row(b,'retailPositions'));
check('celkové skóre = součet dostupných, počet s daty',b.total===b.rows.reduce((s,r)=>s+(r.score??0),0)&&b.available===9&&b.total===15,[b.total,b.available]);

const inv=pairBreakdown('CAD/USD',data,market,NOW);
const sym=['cot','retailSales','spmi','inflation','rates','employment','trend','seasonality'];
check('obrácený pár obrací znaménka složek',sym.every(id=>row(inv,id).score===-row(b,id).score),sym.map(id=>[id,row(b,id).score,row(inv,id).score]));
check('retail pozice jen pro přesně tento pár (CAD/USD nemá → null)',row(inv,'retailPositions').score===null,row(inv,'retailPositions'));

const e=pairBreakdown('EUR/USD',data,market,NOW);
check('Retail pozice long 87 % → −2',row(e,'retailPositions').score===-2,row(e,'retailPositions'));
check('Trend ⅓ dolů → −1',row(e,'trend').score===-1,row(e,'trend'));
check('Zaměstnanost: chybějící hodnocení banky → null, nedopočítává se',row(e,'employment').score===null,row(e,'employment'));
check('mPMI: slovní komentář bez čísla → null',row(e,'mpmi').score===null,row(e,'mpmi'));
check('HDP: 0,1 vs 0,6 → −2',row(e,'gdp').score===-2,row(e,'gdp'));

const noCot={...market,cot:{...market.cot,CAD:undefined}};
check('chybějící COT → null',row(pairBreakdown('USD/CAD',data,noCot,NOW),'cot').score===null,null);
const crossM={...market,cot:{...market.cot}};
check('křížový COT jen při stejném datu reportu',cotPairSignal(crossM,'EUR','CAD')!==null&&Math.abs(cotPairSignal(crossM,'EUR','CAD').signal-(cotPairSignal(crossM,'EUR','USD').signal-cotPairSignal(crossM,'CAD','USD').signal)/2)<1e-9,null);
const noPrice={...market,prices:{}};const np=pairBreakdown('USD/CAD',data,noPrice,NOW);
check('bez cen: trend i sezonalita null',row(np,'trend').score===null&&row(np,'seasonality').score===null,null);
check('neplatné vstupy → null',pairBreakdown('USD/USD',data,market,NOW)===null&&pairBreakdown('USD/XYZ',data,market,NOW)===null&&pairBreakdown('AAPL',data,market,NOW)===null,null);

// --- reálná data: žádná výjimka, rozsahy, symetrie všech párů ---
const D=JSON.parse(fs.readFileSync(new URL('../data/fundamentals.json',import.meta.url))),core=JSON.parse(fs.readFileSync(new URL('../data/score-market.json',import.meta.url))),ex=JSON.parse(fs.readFileSync(new URL('../data/expanded-market.json',import.meta.url)));
const M={...core,prices:{...core.prices,...ex.prices}},cc=Object.keys(D.currencies);let n=0,bad=[];
for(const a of cc)for(const q of cc){if(a===q)continue;const x=pairBreakdown(a+'/'+q,D,M,NOW),y=pairBreakdown(q+'/'+a,D,M,NOW);n++;
 if(!x||x.rows.some(r=>r.score!==null&&![-2,-1,0,1,2].includes(r.score))||Math.abs(x.total)>2*x.available)bad.push(a+'/'+q);
 for(const id of ['cot','gdp','retailSales','mpmi','spmi','rates','inflation','employment','trend'])if((row(x,id).score??0)!==-(row(y,id).score??0))bad.push(a+'/'+q+':'+id);}
check(`reálná data: ${n} párů, rozsahy a symetrie`,bad.length===0,bad.slice(0,10));

if(fails.length){console.log(`\n${fails.length} FAIL`);process.exit(1)}
console.log('\nPASS: přehled skóre po složkách');
