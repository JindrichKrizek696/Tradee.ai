// Kontrola historie kalendáře, filtrů a katalogu makro řad: node --experimental-strip-types scripts/check-calendar-hist.mjs
import {planUpsert,deriveActuals,refreshPlan,histId,parseValue,seriesPoints,feedState,readExtra,defaultExtra,filterExtra,impactOf,positionMarkets,ffOnlyEvents} from '../lib/calendar-hist.ts';
import {buildCatalog,SERIES} from '../lib/macro/catalog.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const H=3600000,D=24*H,T0=Date.parse('2026-10-01T12:30:00Z');
const row=(title,at,forecast,previous,currency='USD',impact='High')=>({at:new Date(at).toISOString().replace('.000Z','Z'),currency,title,impact,forecast,previous});

// ---- upsert a detekce změn
let r=planUpsert([],[row('CPI m/m',T0,'0.3%','0.4%'),row('Bank Holiday',T0,null,null,'USD','Holiday')],T0-5*D);
check('nová událost (svátek se neukládá)',r.events.length===1&&r.changes.length===0,r);
const e0=r.events[0];
check('id = hash měna+titul+první čas, stabilní',e0.id===histId('USD','CPI m/m',T0)&&/^ff_[0-9a-f]{16}$/.test(e0.id),e0.id);
check('first_seen a plánovaný čas',e0.firstSeen===T0-5*D&&e0.scheduledAt===T0&&e0.at===T0,e0);
r=planUpsert([e0],[row('CPI m/m',T0+H,'0.2%','0.4%')],T0-4*D);
check('posun času = tatáž událost + změna time',r.events.length===1&&r.events[0].id===e0.id&&r.events[0].at===T0+H&&r.events[0].scheduledAt===T0,r.events);
check('změny time a forecast (historie odhadu)',r.changes.map(c=>c.kind).join()==='time,forecast'&&r.changes[1].old==='0.3%'&&r.changes[1].new==='0.2%',r.changes);
const e1=r.events[0];
r=planUpsert([e1],[row('CPI m/m',T0+H,null,'0.4%')],T0-3*D);
check('prázdný odhad nepřepíše uložený',r.events[0].forecast==='0.2%'&&r.changes.length===0,r);
check('last_seen se posune',r.events[0].lastSeen===T0-3*D,r.events[0]);
r=planUpsert([e1],[row('CPI m/m',T0+30*D,'0.3%','0.2%')],T0);
check('o měsíc později = nové vydání, ne posun',r.events.length===1&&r.events[0].id!==e1.id&&r.changes.length===0,r);
// dva stejné tituly blízko sebe se nepárují křížem
const s1=planUpsert([],[row('FOMC Member Speaks',T0,null,null),row('FOMC Member Speaks',T0+5*H,null,null)],T0).events;
r=planUpsert(s1,[row('FOMC Member Speaks',T0,null,null),row('FOMC Member Speaks',T0+5*H,null,null)],T0+H);
check('dva stejné tituly v jednom dni zůstanou dvěma událostmi',r.events.length===2&&r.changes.length===0&&new Set(r.events.map(e=>e.id)).size===2,r);

// ---- odvozená skutečnost a revize
const sep=planUpsert([],[row('CPI m/m',T0-30*D,'0.2%','0.1%')],T0-35*D).events[0];
const oct={...e1};
let a=deriveActuals([sep,oct],T0+2*H);
check('skutečnost = previous dalšího vydání',a.events.length===1&&a.events[0].id===sep.id&&a.events[0].actual==='0.4%'&&a.events[0].actualFirst==='0.4%'&&a.changes[0].kind==='actual',a);
check('budoucí vydání bez skutečnosti',!a.events.some(e=>e.id===oct.id),a.events);
const sep2=a.events[0];
a=deriveActuals([sep2,{...oct,previous:'0.5%'}],T0+3*D);
check('pozdější jiné previous = revize, první hodnota zůstává',a.events[0].actual==='0.5%'&&a.events[0].actualFirst==='0.4%'&&a.changes[0].kind==='revision'&&a.changes[0].old==='0.4%'&&a.changes[0].new==='0.5%',a);
a=deriveActuals([{...sep2},{...oct}],T0+3*D);
check('stejná hodnota = žádná revize',a.events.length===0&&a.changes.length===0,a);
a=deriveActuals([{...sep,at:T0-250*D},{...oct}],T0+3*D);
check('příliš velký rozestup vydání se neodvozuje',a.events.length===0,a);
// jeden krok obnovy: upsert + odvození
const plan=refreshPlan([sep],[row('CPI m/m',T0,'0.3%','0.4%')],T0+H);
check('refreshPlan: nové vydání + skutečnost předchozího',plan.events.length===2&&plan.events.find(e=>e.id===sep.id)?.actual==='0.4%'&&plan.changes.some(c=>c.kind==='actual'),plan);

// ---- řada pro graf
const pts=seriesPoints([{...sep2,actual:'0.5%',actualFirst:'0.4%'},{...oct}]);
check('seriesPoints: čísla, revize, posun času',pts[0].actual===0.5&&pts[0].actualFirst===0.4&&pts[0].revised===true&&pts[1].timeMoved===true&&pts[1].actual===null&&pts[1].forecast===0.2&&pts[0].unit==='%',pts);
check('parseValue: K a záporné',JSON.stringify(parseValue('-12.5K'))==='{"value":-12.5,"unit":"K"}'&&parseValue('n/a')===null&&parseValue(null)===null,parseValue('-12.5K'));

// ---- stav zdroje
const now=T0;
check('feed ok',feedState({attemptedAt:now-H,okAt:now-H,error:null},null,now)==='ok',null);
check('feed nedostupné po chybě (data zůstávají)',feedState({attemptedAt:now-H,okAt:now-5*H,error:'HTTP 503'},null,now)==='unavailable',null);
check('feed zastaralý',feedState({attemptedAt:now-10*H,okAt:now-10*H,error:null},null,now)==='stale'&&feedState(null,now-7*H,now)==='stale'&&feedState(null,now-2*H,now)==='ok',null);

// ---- filtry
const ev=(id,signal,markets,ff)=>({id,at:'2026-10-01T12:30:00Z',timeKnown:true,title:id,category:'macro',markets,signal,global:false,verified:false,source:'',...(ff?{ff:{title:id,currency:markets[0],at:'2026-10-01T12:30:00Z',impact:ff}}:{})});
const list=[ev('a',3,['USD'],'Medium'),ev('b',3,['EUR']),ev('c',1,['JPY'],'Low'),ev('d',2,['OIL'])];
check('dopad z FF má přednost před silou',impactOf(list[0])==='Medium'&&impactOf(list[1])==='High'&&impactOf(list[3])==='Medium',null);
check('filtr dopadu',filterExtra(list,{...defaultExtra,impacts:['High']},new Set(),new Set()).map(e=>e.id).join()==='b',null);
const watch=new Set(['EUR']),pos=positionMarkets(['USD/JPY','CL=F',null]);
check('trhy pozic (pár i komodita)',pos.has('USD')&&pos.has('JPY')&&pos.has('OIL'),[...pos]);
check('jen sledované',filterExtra(list,{...defaultExtra,mine:'watch'},watch,pos).map(e=>e.id).join()==='b',null);
check('jen otevřené pozice',filterExtra(list,{...defaultExtra,mine:'positions'},watch,pos).map(e=>e.id).join()==='a,c,d',null);
check('sledované nebo pozice',filterExtra(list,{...defaultExtra,mine:'either'},watch,pos).length===4,null);
check('readExtra: rozbité → výchozí',JSON.stringify(readExtra('{x'))===JSON.stringify(defaultExtra)&&JSON.stringify(readExtra(null))===JSON.stringify(defaultExtra),readExtra('{x'));
check('readExtra: neznámé hodnoty zahodí',JSON.stringify(readExtra({impacts:['Low','Huge'],mine:'nope',ffAll:true}))==='{"impacts":["Low"],"mine":"all","ffAll":true}',readExtra({impacts:['Low','Huge'],mine:'nope',ffAll:true}));
const only=ffOnlyEvents([row('Unemployment Claims',T0,'220K','218K','USD','Medium'),row('CPI m/m',T0,'0.3%','0.4%'),row('Bank Holiday',T0,null,null,'USD','Holiday')],new Set(['USD|CPI m/m|'+new Date(T0).toISOString().replace('.000Z','Z')]));
check('události jen z FF: bez spárovaných a svátků',only.length===1&&only[0].markets[0]==='USD'&&only[0].signal===2&&only[0].ff.impact==='Medium',only);

// ---- katalog makro řad
const N=Date.parse('2026-10-20T00:00:00Z');
const ffRows=[row('CPI m/m','2026-09-11T12:30:00Z','0.3%','0.2%'),row('CPI m/m','2026-10-14T12:30:00Z','0.2%','0.4%'),row('CPI m/m','2026-11-13T13:30:00Z','0.3%','0.3%'),
 row('Unemployment Rate','2026-10-02T12:30:00Z','4.3%','4.3%'),row('Retail Sales m/m','2026-10-15T12:30:00Z','0.4%','1.1%')];
const cat=buildCatalog({ffRows,tePmi:{updated:'',currencies:{EUR:{mpmi:{value:52.9,previous:52.7,period:'2026-09',fetchedAt:'',url:'https://te/x',publisher:'HCOB',series:'Euro Area Manufacturing PMI'}}}},
 retail:{updated:'',currencies:{USD:{value:0.8,previous:1.3,unit:'%',kind:'m/m',period:'2026-09',releasedAt:'2026-10-15T08:30:00-04:00',fetchedAt:'',source:'Census',series:'Advance retail',url:'https://census'}}},
 observations:{USD:{rates:{value:'3,75–4,00 %',period:'2026-09-17',sourceUrl:'https://fed'}}}},N);
const g=id=>cat.find(c=>c.id===id);
const cpi=g('USD-cpi-m-m');
check('katalog: y/y a m/m jsou samostatné položky',!!g('USD-cpi-y-y')&&!!cpi&&SERIES.filter(s=>s.currency==='USD'&&s.concept==='cpi').length===2,SERIES.filter(s=>s.currency==='USD').map(s=>s.id));
check('katalog: skutečnost odvozená z dalšího vydání',cpi.last?.value==='0.3%'&&cpi.last.basis==='derived'&&cpi.last.releasedAt===Date.parse('2026-10-14T12:30:00Z'),cpi.last);
check('katalog: příští vydání z FF',cpi.next?.at===Date.parse('2026-11-13T13:30:00Z')&&cpi.next.forecast==='0.3%',cpi.next);
const un=g('USD-mira-nezamestnanosti-uroven');
check('katalog: bez dalšího vydání = previous u posledního vydání',un.last?.value==='4.3%'&&un.last.basis==='previous',un.last);
check('katalog: oficiální maloobchod má přednost',g('USD-maloobchodni-trzby-m-m').last?.basis==='official'&&g('USD-maloobchodni-trzby-m-m').last.period==='2026-09',g('USD-maloobchodni-trzby-m-m').last);
check('katalog: PMI z TE s vydavatelem',g('EUR-pmi-vyroba-hcob-index').last?.value==='52,9'&&/HCOB/.test(g('EUR-pmi-vyroba-hcob-index').last.source),g('EUR-pmi-vyroba-hcob-index').last);
check('katalog: sazba z ověřeného údaje',g('USD-fed-funds-horni-mez-uroven').last?.basis==='observation',g('USD-fed-funds-horni-mez-uroven').last);
const hist=[{id:'h1',currency:'USD',title:'CPI m/m',impact:'High',scheduledAt:Date.parse('2026-09-11T12:30:00Z'),at:Date.parse('2026-09-11T12:30:00Z'),firstSeen:0,lastSeen:0,forecast:'0.3%',previous:'0.2%',actual:'0.4%',actualFirst:'0.3%',actualAt:0}];
const cr=buildCatalog({ffRows:ffRows.filter(r=>r.at!=='2026-10-14T12:30:00Z'&&r.at!=='2026-11-13T13:30:00Z'),hist},N).find(c=>c.id==='USD-cpi-m-m');
check('katalog: revize z historie',cr.last?.value==='0.4%'&&cr.revision==='Revidováno z 0.3% na 0.4%.',cr);
check('katalog: každá položka má vydavatele, jednotku, SA/NSA, frekvenci a odkaz',SERIES.every(s=>s.publisher&&s.unit&&s.sa&&s.freq&&/^https:\/\//.test(s.url))&&new Set(SERIES.map(s=>s.id)).size===SERIES.length,SERIES.filter(s=>!s.url));
check('katalog: 8 měn',new Set(SERIES.map(s=>s.currency)).size===8,null);

console.log(fails.length?`\n${fails.length} CHYB`:'\nVše v pořádku.');
if(fails.length)process.exit(1);
