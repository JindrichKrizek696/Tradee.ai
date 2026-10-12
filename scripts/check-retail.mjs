// Kontrola rozboru maloobchodu z oficiálních zdrojů: node --experimental-strip-types scripts/check-retail.mjs
import {changeFromLevels,lastChange,parseCsv,parseFredCsv,parseEurostat,parseOns,parseStatcan,parseSdmxCsv,parseMeti,retailPeriodEnd} from '../lib/macro/retail.ts';
let bad=0;const check=(n,ok,x)=>{console.log((ok?'ok   ':'FAIL ')+n+(ok?'':' → '+JSON.stringify(x)));if(!ok)bad++};

// m/m z úrovní (FRED RSAFS: 729538 → 737763 = +1,13 %; předtím 732898 → 729538 = −0,46 %)
let c=changeFromLevels([['2026-08',737763],['2026-06',732898],['2026-07',729538]]);
check('m/m z úrovní, neseřazené vstupy',c&&c.value===1.13&&c.previous===-0.46&&c.period==='2026-08',c);
check('m/m: jeden bod / nuly → null',changeFromLevels([['2026-08',1]])===null&&changeFromLevels([['2026-07',0],['2026-08',5]])===null);
c=changeFromLevels([['2026 Q1',128.0354],['2026 Q2',127.3558],['2025 Q4',123.7]]);
check('q/q z indexu, čtvrtletí se řadí',c&&c.period==='2026 Q2'&&c.value===-0.53,c);
c=lastChange([['2026-08',0],['2026-06',0.9],['2026-07',1.1]]);
check('lastChange bere poslední a předposlední',c&&c.value===0&&c.previous===1.1&&c.period==='2026-08',c);

check('CSV s uvozovkami',JSON.stringify(parseCsv('a,b\n"x, y","1"\r\n2,3\n'))===JSON.stringify([{a:'x, y',b:'1'},{a:'2',b:'3'}]));
check('FRED CSV',JSON.stringify(parseFredCsv('observation_date,RSAFS\n2026-07-01,729538\n2026-08-01,737763\n'))===JSON.stringify([['2026-07',729538],['2026-08',737763]]));
check('FRED: HTML místo CSV → []',parseFredCsv('<html><script></script></html>').length===0);
const es={value:{'0':0.3,'1':-0.6,'2':0.1},dimension:{time:{category:{index:{'2026-06':0,'2026-07':1,'2026-08':2}}}}};
c=lastChange(parseEurostat(es));check('Eurostat JSON-stat',c&&c.value===0.1&&c.previous===-0.6&&c.period==='2026-08',c);
check('Eurostat: chybějící hodnota se vynechá',parseEurostat({value:{'0':1},dimension:{time:{category:{index:{'2026-07':0,'2026-08':1}}}}}).length===1);
const ons=parseOns({description:{releaseDate:'2026-09-17T23:00:00.000Z'},months:[{date:'2026 JUN',value:'103.7'},{date:'2026 JUL',value:'103.1'},{date:'2026 AUG',value:'103.6'}]});
c=changeFromLevels(ons.points);check('ONS index → m/m',c&&c.period==='2026-08'&&c.value===0.48&&c.previous===-0.58&&ons.releasedAt==='2026-09-17T23:00:00.000Z',[c,ons]);
const sc=parseStatcan([{status:'SUCCESS',object:{vectorDataPoint:[{refPer:'2026-06-01',value:74245528,releaseTime:'2026-09-24T08:30'},{refPer:'2026-07-01',value:73696547,releaseTime:'2026-09-24T08:30'}]}}]);
c=changeFromLevels(sc.points);check('StatCan WDS',c&&c.value===-0.74&&c.period==='2026-07'&&sc.releasedAt==='2026-09-24T08:30',[c,sc]);
check('StatCan FAILED → []',parseStatcan([{status:'FAILED',object:{}}]).points.length===0);
const abs='DATAFLOW,MEASURE,CATEGORY,PRICE_ADJUSTMENT,TSEST,STATE,FREQ,TIME_PERIOD,OBS_VALUE\nABS:HSI_M(1.6.0),8,TOT,CUR,20,AUS,M,2026-07,1.1\nABS:HSI_M(1.6.0),8,TOT,CUR,20,AUS,M,2026-08,0\nABS:HSI_M(1.6.0),8,TOT,CUR,20,AUS,M,2026-01,0.3\nABS:HSI_M(1.6.0),8,TOT,CUR,30,AUS,M,2026-09,9\n';
c=lastChange(parseSdmxCsv(abs,{TSEST:'20',STATE:'AUS'}));check('ABS SDMX CSV (neseřazené, filtr SA)',c&&c.value===0&&c.previous===1.1&&c.period==='2026-08',c);
const oecd='DATAFLOW,REF_AREA,FREQ,MEASURE,TIME_PERIOD,OBS_VALUE\nX,NZL,Q,TOVM,2026-Q1,128.0354\nX,NZL,Q,TOVM,2026-Q2,127.3558\nX,CHE,M,TOVM,2026-08,112.7066\nX,CHE,M,TOVM,2026-07,112.2731\n';
check('OECD SDMX: čtvrtletí jako „YYYY Qn“',changeFromLevels(parseSdmxCsv(oecd,{REF_AREA:'NZL',FREQ:'Q'}))?.period==='2026 Q2'&&changeFromLevels(parseSdmxCsv(oecd,{REF_AREA:'CHE',FREQ:'M'}))?.value===0.39);
const meti=[['商業販売額'],[null,'Commercial Sales','Retail'],[null,'The percentage change …','Seasonal adjustment indices percentage change from the previous month　(C.Y.2020=100)'],
 ['2026000406','2026年4～6月',1.9],['2026000707','2026年7月',2.1],['2026000808','2026年8月',-1.2],['2026000909','2026年9月','***']];
c=lastChange(parseMeti(meti));check('METI: sloupec podle hlavičky, jen měsíce, *** se vynechá',c&&c.value===-1.2&&c.previous===2.1&&c.period==='2026-08',c);
check('METI: bez hlavičky → []',parseMeti([['2026000808','x',1]]).length===0);
check('konec období',retailPeriodEnd('2026-08')===Date.UTC(2026,8,0,23,59,59)&&retailPeriodEnd('2026 Q2')===Date.UTC(2026,6,0,23,59,59)&&Number.isNaN(retailPeriodEnd('srpen')));

if(bad){console.log(`\n${bad} FAIL`);process.exit(1)}
console.log('\nPASS: maloobchod z oficiálních zdrojů');
