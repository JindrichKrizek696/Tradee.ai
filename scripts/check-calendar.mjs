// Kontrola kalendáře bez prohlížeče: node --experimental-strip-types scripts/check-calendar.mjs
import {readFileSync} from 'node:fs';
import {mergeCalendar,filterEvents,defaultFilters,readFilters,flaggedMarkets,filterMarket,relative,upcomingCalendar,eventMarkets,sourceUrl} from '../lib/calendar.ts';
import {scoreV2} from '../lib/score-engine.ts';
const read=f=>JSON.parse(readFileSync(new URL('../data/'+f,import.meta.url),'utf8'));
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const now=Date.parse('2026-10-02T08:00:00Z');

const auto=[
 {id:'us-nfp-2026-10-02',at:'2026-10-02T12:30:00Z',timeKnown:true,title:'USA • zaměstnanost (NFP)',category:'macro',markets:['USD'],kind:'us-nfp',source:'https://bls',origin:'bls'},
 {id:'eia-oil-2026-10-07',at:'2026-10-07T14:30:00Z',timeKnown:true,title:'EIA • týdenní zásoby ropy',category:'commodity',markets:['OIL'],kind:'eia-oil',source:'https://eia',origin:'eia'},
 {id:'rig-count-2026-10-02',at:'2026-10-02T17:00:00Z',timeKnown:true,title:'Baker Hughes',category:'commodity',markets:['OIL'],kind:'rig-count',source:'https://bh',origin:'bakerhughes'},
 {id:'us-cpi-2026-10-14',at:'2026-10-14T12:30:00Z',timeKnown:true,title:'USA • CPI',category:'macro',markets:['USD'],kind:'us-cpi',source:'https://bls',origin:'bls'},
 {id:'us-ppi-2026-09-25',at:'2026-09-25T12:30:00Z',timeKnown:true,title:'USA • PPI',category:'macro',markets:['USD'],kind:'us-ppi',source:'https://bls',origin:'bls'},
];
const curated=[
 // starý záznam agenta: vlastní ID, currency+importance, bez kind → páruje se s us-nfp-2026-10-02
 {id:'us-jobs-sep',currency:'USD',at:'2026-10-02T12:30:00Z',title:'USA • zaměstnanost za září',source:'https://bls.gov/x',watch:'NFP a mzdy',timeKnown:true,importance:'vysoká',consensus:'+100 000',actual:null},
 // nový záznam agenta s ID skriptu: doplní sílu a poznámku, prázdné hodnoty nepřepisují
 {id:'us-cpi-2026-10-14',at:'2026-10-14T12:30:00Z',title:'USA • CPI za září',source:'',timeKnown:true,signal:3,watch:'Jádrová inflace',consensus:null},
 // čistě agentova událost
 {id:'eth-upgrade-2026-10-03',at:'2026-10-03T00:00:00Z',title:'Ethereum • upgrade',source:'https://eth',timeKnown:false,category:'crypto',markets:['ETH'],signal:3},
 // RBA ze staré struktury → centrální banka
 {id:'rba-oct',currency:'AUD',at:'2026-10-05T03:30:00Z',title:'RBA • rozhodnutí o sazbách',source:'https://rba',timeKnown:true,importance:'střední'},
];
const m=mergeCalendar(auto,curated);
const by=Object.fromEntries(m.map(e=>[e.id,e]));
check('párování starého záznamu podle typu a dne',!by['us-nfp-2026-10-02']&&by['us-jobs-sep']?.verified===true,Object.keys(by));
check('starý záznam převzal kind a VŠE',by['us-jobs-sep']?.kind==='us-nfp'&&by['us-jobs-sep']?.global===true,by['us-jobs-sep']);
check('starý záznam: importance → signal 3, currency → markets',by['us-jobs-sep']?.signal===3&&by['us-jobs-sep']?.markets.join()==='USD',by['us-jobs-sep']);
check('agent s ID skriptu: přednost + prázdný source nepřepíše',by['us-cpi-2026-10-14']?.title==='USA • CPI za září'&&by['us-cpi-2026-10-14']?.source==='https://bls'&&by['us-cpi-2026-10-14']?.verified,by['us-cpi-2026-10-14']);
check('skriptová událost: výchozí síla a ○',by['eia-oil-2026-10-07']?.signal===2&&by['eia-oil-2026-10-07']?.verified===false&&by['eia-oil-2026-10-07']?.global===false,by['eia-oil-2026-10-07']);
check('RBA → centrální banka, střední',by['rba-oct']?.category==='central-bank'&&by['rba-oct']?.signal===2,by['rba-oct']);
check('seřazeno podle času',m.every((e,i)=>!i||m[i-1].at<=e.at),m.map(e=>e.at));
check('počet po sloučení',m.length===7,m.length);

const shown=filterEvents(m,defaultFilters,now).map(e=>e.id);
check('výchozí filtr skryje sílu 1',!shown.includes('rig-count-2026-10-02')&&shown.includes('eia-oil-2026-10-07'),shown);
const noCats={...defaultFilters,categories:[]};
check('VŠE projde i bez skupin',filterEvents(m,noCats,now).map(e=>e.id).join()==='us-jobs-sep,us-cpi-2026-10-14',filterEvents(m,noCats,now).map(e=>e.id));
check('bez VŠE a bez skupin nic',filterEvents(m,{...noCats,showGlobal:false},now).length===0,filterEvents(m,{...noCats,showGlobal:false},now).length);
check('filtr trhu',filterEvents(m,{...defaultFilters,markets:['OIL'],showGlobal:false},now).map(e=>e.id).join()==='eia-oil-2026-10-07',filterEvents(m,{...defaultFilters,markets:['OIL'],showGlobal:false},now).map(e=>e.id));
check('skrýt proběhlé',!filterEvents(m,{...defaultFilters,hidePast:true},now).some(e=>e.id==='us-ppi-2026-09-25'),null);
check('ticker → Akcie',filterMarket('AAPL')==='STOCKS'&&filterMarket('OIL')==='OIL',[filterMarket('AAPL'),filterMarket('OIL')]);

check('readFilters: null',JSON.stringify(readFilters(null))===JSON.stringify(defaultFilters),readFilters(null));
check('readFilters: rozbitý JSON',JSON.stringify(readFilters('{nope'))===JSON.stringify(defaultFilters),readFilters('{nope'));
const rf=readFilters('{"categories":["macro","xxx"],"minSignal":7,"hidePast":true}');
check('readFilters: neznámé hodnoty zahodí',rf.categories.join()==='macro'&&rf.minSignal===2&&rf.hidePast===true&&rf.showGlobal===true,rf);

const fm=[...flaggedMarkets({'EUR/USD':'green','BTC-USD':'red','^NDX':'orange',AAPL:'none',USD:'green'})].sort().join();
check('vlaječky → trhy',fm==='BTC,EUR,INDEX,USD',fm);
check('relative',relative('2026-10-02T10:50:00Z',now)==='za 2 h 50 min'&&relative('2026-10-06T08:00:00Z',now)==='za 4 d'&&relative('2026-10-02T07:15:00Z',now)==='před 45 min',[relative('2026-10-02T10:50:00Z',now),relative('2026-10-06T08:00:00Z',now),relative('2026-10-02T07:15:00Z',now)]);
check('dashboard: síla ≥ 2 nebo VŠE',upcomingCalendar(m,now,5).map(e=>e.id).join()==='us-jobs-sep,eth-upgrade-2026-10-03,rba-oct,eia-oil-2026-10-07,us-cpi-2026-10-14',upcomingCalendar(m,now,5).map(e=>e.id));

// C1: source agenta je klíč do fundamentals.sources, ne URL.
const srcs={'bls-cal':{url:'https://www.bls.gov/schedule/'}};
const k=mergeCalendar([auto[0]],[{...curated[0],source:'bls-cal'}],srcs).find(e=>e.id==='us-jobs-sep');
check('C1: klíč zdroje → URL ze sources',k?.source==='https://www.bls.gov/schedule/',k?.source);
const k2=mergeCalendar([auto[0]],[{...curated[0],source:'neznamy-klic'}],srcs).find(e=>e.id==='us-jobs-sep');
check('C1: neznámý klíč nepřepíše URL skriptu',k2?.source==='https://bls',k2?.source);
check('C1: sourceUrl bez platné URL vrací null',sourceUrl('bls-cal')===null&&sourceUrl('https://www.bls.gov/x')==='bls.gov',[sourceUrl('bls-cal'),sourceUrl('https://www.bls.gov/x')]);
// I1: nové záznamy mají markets místo currency – staré pohledy je nesmí ztratit.
check('I1: eventMarkets spojí currency i markets',eventMarkets({currency:'USD',markets:['EUR']}).join()==='USD,EUR'&&eventMarkets({markets:['JPY']}).join()==='JPY',[eventMarkets({currency:'USD',markets:['EUR']}),eventMarkets({markets:['JPY']})]);
{const f=read('fundamentals.json'),core=read('score-market.json'),exp=read('expanded-market.json');const market={...core,prices:{...core.prices,...exp.prices},legacy:exp.legacy,refresh:{attemptedAt:exp.refresh.attemptedAt,issues:[]}};
 const t=Date.parse('2026-10-02T08:00:00Z');const ev={id:'x-eur-2026-10-03',at:'2026-10-03T08:00:00Z',title:'Eurozóna • test',source:'',timeKnown:true,markets:['EUR'],signal:2};
 const r=scoreV2({...f,events:[ev]},market,'EUR/USD',t);check('I1: score-engine 72 h vidí událost jen s markets',r.events.some(e=>e.id===ev.id),r.events.map(e=>e.id));}
// I3: fallbacky agenta nepřebijí lepší data skriptu.
const i3=mergeCalendar([auto[1]],[{id:'eia-oil-2026-10-07',at:'2026-10-07T00:00:00Z',title:'EIA • ropa',source:'',timeKnown:false,signal:3}]).find(e=>e.id==='eia-oil-2026-10-07');
check('I3: kategorie a trhy skriptu zůstanou',i3?.category==='commodity'&&i3?.markets.join()==='OIL',i3);
check('I3: neověřený čas agenta nepřepíše přesný čas skriptu',i3?.at==='2026-10-07T14:30:00Z'&&i3?.timeKnown===true&&i3?.signal===3,i3);
const i3b=mergeCalendar([auto[3]],[{id:'us-cpi-2026-10-14',at:'2026-10-14T12:31:00Z',title:'USA • CPI',source:'',timeKnown:true}]).find(e=>e.id==='us-cpi-2026-10-14');
check('I3: ověřený čas agenta má přednost',i3b?.at==='2026-10-14T12:31:00Z',i3b?.at);

// Skutečná data z repa: žádná duplicita mezi skriptem a agentem.
const real=mergeCalendar(read('calendar.json').events,read('fundamentals.json').events,read('fundamentals.json').sources);
check('C1: reálná data – každý zdroj je URL nebo prázdný',real.every(e=>!e.source||/^https?:\/\//.test(e.source)),real.filter(e=>e.source&&!/^https?:/.test(e.source)).map(e=>e.id+':'+e.source));
const keys=real.map(e=>(e.kind??e.id)+'@'+e.at.slice(0,10));
check('reálná data bez duplicit',new Set(keys).size===keys.length,keys.filter((k,i)=>keys.indexOf(k)!==i));
console.log('reálně',real.length,'událostí,',real.filter(e=>e.verified).length,'ověřených');
console.log(fails.length?'CHECK FAILED':'CHECK OK');
if(fails.length)process.exitCode=1;
