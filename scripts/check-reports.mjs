// Kontrola logiky stránky Reporty: node --experimental-strip-types scripts/check-reports.mjs
import {readFileSync} from 'node:fs';
import {stance,mood,nextMeeting,parseRetail,upcoming,isMeeting} from '../lib/reports.ts';
const data=JSON.parse(readFileSync(new URL('../data/fundamentals.json',import.meta.url),'utf8'));
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const now=Date.parse('2026-10-05T10:00:00Z');
const f=(...v)=>Object.fromEntries(['decision','guidance','activity','labor'].map((id,i)=>[id,{value:v[i],reason:'',source:''}]));

check('stance: 1/0/-1/null',stance(1).label==='Jestřábí'&&stance(0).label==='Neutrální'&&stance(-1).label==='Holubičí'&&stance(null).label==='Neověřeno',[stance(1),stance(null)]);
check('nálada: součet faktorů',mood(f(1,1,1,0)).label==='Jestřábí'&&mood(f(1,0,0,0)).label==='Mírně jestřábí'&&mood(f(0,0,1,-1)).label==='Neutrální'&&mood(f(-1,0,0,0)).label==='Mírně holubičí'&&mood(f(-1,-1,0,0)).label==='Holubičí',[mood(f(1,1,1,0)),mood(f(1,0,0,0))]);
check('nálada: chybějící faktor = neověřeno, ne nula',mood(f(1,null,1,1)).label==='Neověřeno'&&mood(f(1,null,1,1)).score===null,mood(f(1,null,1,1)));

const events=[
 {id:'a',currency:'AUD',at:'2026-09-29T04:30:00Z',title:'RBA • rozhodnutí o sazbách',source:'x',timeKnown:true},
 {id:'b',currency:'AUD',at:'2026-11-03T03:30:00Z',title:'RBA • rozhodnutí o sazbách',source:'x',timeKnown:true},
 {id:'c',currency:'AUD',at:'2026-10-20T01:30:00Z',title:'Austrálie • CPI za září',source:'x',timeKnown:true},
 {id:'d',currency:'USD',at:'2026-10-28T12:00:00Z',title:'FOMC • závěr zasedání 27.–28. října',source:'x',timeKnown:true},
 {id:'e',currency:'NZD',at:'2026-10-28T01:00:00Z',title:'RBNZ • rozhodnutí OCR',source:'x',timeKnown:true},
];
check('příští zasedání: budoucí rozhodnutí banky, ne makro data',nextMeeting(events,'AUD',now)?.id==='b',nextMeeting(events,'AUD',now));
check('příští zasedání: FOMC a OCR',nextMeeting(events,'USD',now)?.id==='d'&&nextMeeting(events,'NZD',now)?.id==='e',null);
check('příští zasedání: žádné → undefined',nextMeeting(events,'CHF',now)===undefined,null);
check('nadcházející: jen budoucí, seřazené',upcoming(events,now).map(e=>e.id).join()==='c,e,d,b',upcoming(events,now).map(e=>e.id));
check('nadcházející: proběhlá událost do 3 h zůstává',upcoming([{...events[0],at:'2026-10-05T08:30:00Z'}],now).length===1,null);

check('rozhodnutí banky vs. makro data',isMeeting(events[1])&&isMeeting(events[3])&&isMeeting(events[4])&&!isMeeting(events[2]),events.map(isMeeting));
check('retail: long/short s lomítkem',JSON.stringify(parseRetail('Long 87 % / short 13 %'))==='{"long":87,"short":13}',parseRetail('Long 87 % / short 13 %'));
check('retail: s tečkou a desetinnou čárkou',JSON.stringify(parseRetail('Long 72,5 % · short 27,5 %'))==='{"long":72.5,"short":27.5}',parseRetail('Long 72,5 % · short 27,5 %'));
check('retail: neznámý formát → null',parseRetail('Neověřeno')===null,null);

const banks=Object.entries(data.currencies);
check('reálná data: 8 bank, každá má náladu',banks.length===8&&banks.every(([,b])=>mood(b.factors).label),banks.map(([c,b])=>[c,mood(b.factors).label]));
const retail=Object.values(data.pairObservations||{}).map(o=>o.retailPositions?.value).filter(Boolean);
check('reálná data: všechny retail hodnoty jdou rozparsovat',retail.every(v=>parseRetail(v)),retail.filter(v=>!parseRetail(v)));
check('reálná data: příští zasedání u RBNZ, BoC, Fedu, ECB, BoJ',['NZD','CAD','USD','EUR','JPY'].every(c=>nextMeeting(data.events,c,now)),['NZD','CAD','USD','EUR','JPY'].map(c=>[c,nextMeeting(data.events,c,now)?.title]));

if(fails.length){console.log(`\n${fails.length} FAIL`);process.exit(1)}console.log('\nPASS');
