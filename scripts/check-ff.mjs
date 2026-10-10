// Kontrola párování ForexFactory odhadů: node --experimental-strip-types scripts/check-ff.mjs
import {parseFF,matchFF,mergeFF,applyFF,forecastLine,conceptOf} from '../lib/calendar-ff.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const ev=(id,at,title,markets,kind,extra={})=>({id,at,timeKnown:true,title,category:'macro',markets,kind,signal:3,global:false,verified:false,source:'',...extra});

const raw=[
 {title:'CPI m/m',country:'USD',date:'2026-10-14T08:30:00-04:00',impact:'High',forecast:'0.3%',previous:'0.4%'},   // EDT = 12:30Z
 {title:'CPI y/y',country:'USD',date:'2026-10-14T08:30:00-04:00',impact:'High',forecast:'3.0%',previous:'2.9%'},
 {title:'Core CPI m/m',country:'USD',date:'2026-10-14T08:30:00-04:00',impact:'High',forecast:'0.3%',previous:'0.3%'},
 {title:'Non-Farm Employment Change',country:'USD',date:'2026-11-06T08:30:00-05:00',impact:'High',forecast:'100K',previous:'22K'}, // EST = 13:30Z
 {title:'Federal Funds Rate',country:'USD',date:'2026-10-28T14:00:00-04:00',impact:'High',forecast:'3.75%',previous:'4.00%'},
 {title:'FOMC Statement',country:'USD',date:'2026-10-28T14:00:00-04:00',impact:'High',forecast:'',previous:''},
 {title:'Main Refinancing Rate',country:'EUR',date:'2026-10-29T14:15:00+01:00',impact:'High',forecast:'2.15%',previous:'2.15%'},
 {title:'Cash Rate',country:'AUD',date:'2026-11-03T14:30:00+11:00',impact:'High',forecast:'3.60%',previous:'3.60%'},
 {title:'Manufacturing PMI',country:'GBP',date:'2026-10-01T09:30:00+01:00',impact:'Medium',forecast:'50.1',previous:'49.9'},
 {title:'Bank Holiday',country:'All',date:'2026-10-12T00:00:00-04:00',impact:'Holiday',forecast:'',previous:''},
 {title:'Broken',country:'USD',date:'nope',impact:'Low',forecast:'',previous:''},
];
const rows=parseFF(raw);
check('parseFF zahodí All a vadné datum',rows.length===9,rows.length);
check('parseFF převede offset do UTC (EDT)',rows[0].at==='2026-10-14T12:30:00Z',rows[0].at);
check('parseFF převede offset do UTC (EST)',rows.find(r=>r.title.startsWith('Non-Farm')).at==='2026-11-06T13:30:00Z');
check('parseFF převede offset +11',rows.find(r=>r.title==='Cash Rate').at==='2026-11-03T03:30:00Z');
check('parseFF prázdný řetězec → null',rows.find(r=>r.title==='FOMC Statement').forecast===null);
check('parseFF nepole → []',parseFF({}).length===0&&parseFF(null).length===0);

const events=[
 ev('us-cpi-2026-10-14','2026-10-14T12:30:00Z','USA • CPI',['USD'],'us-cpi'),
 ev('us-nfp-2026-11-06','2026-11-06T13:30:00Z','USA • zaměstnanost (NFP)',['USD'],'us-nfp'),
 ev('fomc-2026-10-28','2026-10-28T18:00:00Z','FOMC • rozhodnutí o sazbách',['USD'],'fomc'),
 ev('ecb-2026-10-29','2026-10-29T13:15:00Z','ECB • rozhodnutí o sazbách',['EUR'],'ecb-rates'),
 ev('rba','2026-11-03T03:30:00Z','RBA Interest Rate Decision',['AUD']),
 ev('gbp-pmi','2026-10-01T08:30:00Z','UK Manufacturing PMI',['GBP']),
 ev('wrongcur','2026-10-14T12:30:00Z','USA • CPI',['EUR'],'us-cpi'),
 ev('offtime','2026-10-14T13:30:00Z','USA • CPI',['USD'],'us-cpi'),
 ev('nomatch','2026-10-14T12:30:00Z','Něco úplně jiného',['USD']),
 ev('notime','2026-10-14T00:00:00Z','USA • CPI',['USD'],'us-cpi',{timeKnown:false}),
];
const m=matchFF(events,rows);
check('CPI: dvojznačnost m/m × y/y × core → y/y headline',m['us-cpi-2026-10-14']?.ffTitle==='CPI y/y'&&m['us-cpi-2026-10-14'].forecast==='3.0%',m['us-cpi-2026-10-14']);
check('NFP (zimní čas -05:00)',m['us-nfp-2026-11-06']?.forecast==='100K'&&m['us-nfp-2026-11-06'].previous==='22K',m['us-nfp-2026-11-06']);
check('FOMC → Federal Funds Rate, ne Statement',m['fomc-2026-10-28']?.ffTitle==='Federal Funds Rate',m['fomc-2026-10-28']);
check('ECB → Main Refinancing Rate',m['ecb-2026-10-29']?.forecast==='2.15%',m['ecb-2026-10-29']);
check('RBA podle tokenů/aliasu (Cash Rate)',m['rba']?.forecast==='3.60%',m['rba']);
check('PMI GBP',m['gbp-pmi']?.forecast==='50.1',m['gbp-pmi']);
check('jiná měna se nepáruje',!m['wrongcur'],m['wrongcur']);
check('čas mimo 10 min se nepáruje',!m['offtime'],m['offtime']);
check('neznámý titulek bez shody',!m['nomatch'],m['nomatch']);
check('neověřený čas se nepáruje',!m['notime'],m['notime']);
check('FOMC statement nemá hodnoty → nikdy není shoda',!Object.values(m).some(x=>x.ffTitle==='FOMC Statement'));
// 18:00Z by FOMC neprošel (19:00Z? zimní/letní), ověř explicitně
const dst=matchFF([ev('f2','2026-10-28T18:00:00Z','Federal Funds Rate',['USD'])],rows),dst2=matchFF([ev('f3','2026-10-28T18:05:00Z','Federal Funds Rate',['USD'])],rows);
check('Federal Funds Rate 18:00Z = 14:00 EDT',!!dst.f2&&!!dst2.f3,[dst,dst2]);
const winter=matchFF([ev('f4','2026-10-28T19:00:00Z','Federal Funds Rate',['USD'])],rows);
check('špatný offset (1 h) se nepáruje',!winter.f4,winter);
check('alias: Core CPI ≠ CPI',conceptOf('Core CPI m/m')==='core-cpi'&&conceptOf('CPI y/y')==='cpi');
check('alias: ISM Manufacturing PMI ≠ PMI',conceptOf('ISM Manufacturing PMI')==='ism-mfg'&&conceptOf('Manufacturing PMI')==='pmi-mfg');
check('alias: FOMC minutes není sazba',conceptOf('FOMC Meeting Minutes')===null);
check('alias: Official Bank Rate',conceptOf('Official Bank Rate')==='rate'&&conceptOf('Unemployment Rate')==='unemployment');

// applyFF nepřebíjí vlastní data
const own=ev('own','2026-10-14T12:30:00Z','USA • CPI',['USD'],'us-cpi',{consensus:'+3,1 %',previous:'2,8 %',actual:'3,2 %'});
const ap=applyFF([own,events[0]],matchFF([own,events[0]],rows));
check('applyFF nepřepíše consensus/previous/actual',ap[0].consensus==='+3,1 %'&&ap[0].previous==='2,8 %'&&ap[0].actual==='3,2 %'&&ap[0].forecast==='3.0%',ap[0]);
check('applyFF doplní previous',ap[1].previous==='2.9%'&&ap[1].forecast==='3.0%',ap[1]);
check('forecastLine',forecastLine(ap[0])==='Odhad +3,1 % · Předchozí 2,8 % · Skutečnost 3,2 %'&&forecastLine(ap[1])==='Odhad 3.0% · Předchozí 2.9%'&&forecastLine({})==='',forecastLine(ap[0]));

// mergeFF
const now=Date.parse('2026-10-14T00:00:00Z');
const a=parseFF([{title:'X',country:'USD',date:'2026-10-14T08:30:00-04:00',impact:'High',forecast:'1',previous:'2'},{title:'Old',country:'USD',date:'2026-09-01T08:30:00-04:00',impact:'Low',forecast:'1',previous:'2'}]);
const b=parseFF([{title:'X',country:'USD',date:'2026-10-14T08:30:00-04:00',impact:'High',forecast:'',previous:'3'}]);
const mg=mergeFF(a,b,now);
check('mergeFF klíč currency+title+at, prázdná nepřepíše, staré >3 týdny pryč',mg.length===1&&mg[0].forecast==='1'&&mg[0].previous==='3',mg);

console.log(fails.length?`\n${fails.length} selhání`:'\nvše ok');process.exit(fails.length?1:0);
