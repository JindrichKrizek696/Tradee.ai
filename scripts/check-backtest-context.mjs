// Kontrola kontextu backtestu a požadavku: node --experimental-strip-types scripts/check-backtest-context.mjs
import {scoreLookup,cotLookup,newsLookup,buildContext,COT_LAG_MS} from '../lib/backtest/context.ts';
import {parseRunRequest,warmupBars,planVsReality,thin} from '../lib/backtest/request.ts';
import {DEFAULT_RULES,normalizeRules} from '../lib/backtest/rules.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const H=3600000,D=24*H,T=s=>Date.parse(s);

// ---- skóre / síla: krokové, bez look-ahead
const hist={snapshots:[
 {at:'2026-09-02T12:00:00Z',scores:{'EUR/USD':{score:10},EUR:{score:4},USD:{score:-2}}},
 {at:'2026-09-01T12:00:00Z',scores:{'EUR/USD':{score:5},EUR:{score:1}}}, // neseřazeno
 {at:'2026-09-03T12:00:00Z',scores:{'EUR/USD':{score:null},EUR:{score:6}}},
]};
const sc=scoreLookup(hist);
check('skóre před prvním snapshotem = bez dat',sc('EUR/USD')(T('2026-09-01T11:59:59Z'))===undefined);
check('skóre přesně v čase snapshotu',sc('EUR/USD')(T('2026-09-01T12:00:00Z'))===5);
check('skóre mezi snapshoty = předchozí (ne budoucí)',sc('EUR/USD')(T('2026-09-02T11:00:00Z'))===5);
check('skóre po novém snapshotu',sc('EUR/USD')(T('2026-09-02T12:00:00Z'))===10);
check('skóre null v nejnovějším snapshotu = bez dat',sc('EUR/USD')(T('2026-09-03T13:00:00Z'))===undefined);
check('skóre starší než 72 h = bez dat',sc('EUR')(T('2026-09-03T12:00:00Z')+73*H)===undefined&&sc('EUR')(T('2026-09-03T12:00:00Z')+71*H)===6);
check('neznámý instrument = bez dat',sc('XYZ')(T('2026-09-02T00:00:00Z'))===undefined);
const ctx=buildContext({history:hist});
check('síla měny = skóre měnového indexu',ctx.strength('EUR',T('2026-09-02T13:00:00Z'))===4&&ctx.strength('USD',T('2026-09-02T13:00:00Z'))===-2);

// ---- COT: od zveřejnění (pátek 21:00 UTC po úterním datu), ne od data
const mk=(date,net)=>({date,openInterest:1000,groups:{leveraged:{net}}});
const market={cot:{
 EUR:{isProxy:false,history:[mk('2026-09-01',100),mk('2026-09-08',160),mk('2026-09-15',150)]},
 GBP:{isProxy:false,history:[mk('2026-09-01',10),mk('2026-09-08',30),mk('2026-09-15',20)]},
 JPY:{isProxy:false,history:[mk('2026-09-01',-5),mk('2026-09-08',-6)]},
 USD:{isProxy:true,history:[mk('2026-09-01',999),mk('2026-09-08',999)]},
}};
const cot=cotLookup(market);
const rel=d=>T(d+'T00:00:00Z')+COT_LAG_MS;
check('release = pondělí 21:00 UTC po úterním datu (konzervativně, i při svátku)',new Date(rel('2026-09-08')).toISOString()==='2026-09-14T21:00:00.000Z',new Date(rel('2026-09-08')).toISOString());
check('v den pozorování (úterý) ještě nic nevíme',cot('EUR/CAD',T('2026-09-08T12:00:00Z'))===undefined&&cot('EUR/USD',T('2026-09-08T12:00:00Z'))===undefined);
check('první řádek nemá změnu → bez dat i po zveřejnění',cot('EUR/USD',rel('2026-09-01')+H)===undefined);
check('pondělí 20:59 UTC: předchozí týden stále platí',cot('EUR/USD',rel('2026-09-08')-1)===undefined&&cot('EUR/USD',rel('2026-09-15')-1)?.net===160);
check('pondělí 21:00 UTC: nový řádek',cot('EUR/USD',rel('2026-09-08'))?.net===160&&cot('EUR/USD',rel('2026-09-08'))?.change===60);
check('COT mezi reporty drží poslední zveřejněný',cot('EUR/USD',rel('2026-09-08')+5*D)?.net===160);
check('COT starší než 14 dní bez nového řádku = bez dat',cot('EUR/USD',rel('2026-09-15')+15*D)===undefined&&cot('EUR/USD',rel('2026-09-15')+13*D)?.net===150);
check('USD/XXX má opačné znaménko',cot('USD/JPY',rel('2026-09-08'))?.net===6&&cot('USD/JPY',rel('2026-09-08'))?.change===-(-6-(-5)));
check('kříž = rozdíl base − quote',cot('EUR/GBP',rel('2026-09-08'))?.net===130&&cot('EUR/GBP',rel('2026-09-08'))?.change===60-20);
check('měnový index a ne-FX',cot('EUR',rel('2026-09-08'))?.net===160&&cot('^NDX',rel('2026-09-08'))===undefined&&cot('USD',rel('2026-09-08'))===undefined);

// ---- zprávy: jen plánovaný čas a signál, okno ±N min, mimo pokrytí kalendáře bez dat
const news=newsLookup([{at:T('2026-09-05T00:00:00Z'),currencies:['CHF'],signal:1},{at:T('2026-09-10T12:30:00Z'),currencies:['USD'],signal:3},{at:T('2026-09-12T08:00:00Z'),currencies:['EUR'],signal:1},{at:T('2026-09-20T00:00:00Z'),currencies:['JPY'],signal:3}]);
const m=60000;
check('před začátkem kalendáře = bez dat',news('EUR/USD',T('2026-09-01T00:00:00Z'),15,3)===undefined);
check('po konci kalendáře = bez dat',news('EUR/USD',T('2026-09-21T00:00:00Z'),15,3)===undefined);
check('v okně ±15 min před i po',news('EUR/USD',T('2026-09-10T12:30:00Z')-15*m,15,3)===true&&news('EUR/USD',T('2026-09-10T12:30:00Z')+15*m,15,3)===true);
check('těsně mimo okno',news('EUR/USD',T('2026-09-10T12:30:00Z')-15*m-1,15,3)===false&&news('EUR/USD',T('2026-09-10T12:30:00Z')+15*m+1,15,3)===false);
check('jiná měna se nepočítá, ne-FX počítá USD',news('EUR/GBP',T('2026-09-10T12:30:00Z'),15,3)===false&&news('^NDX',T('2026-09-10T12:30:00Z'),15,3)===true);
check('akcie JPM (tři písmena) není měnový index: USD zprávy ji ovlivní, EUR ne, COT nemá',news('JPM',T('2026-09-10T12:30:00Z'),15,3)===true&&news('JPM',T('2026-09-12T08:00:00Z'),15,1)===false&&cot('JPM',rel('2026-09-08'))===undefined);
check('měnový index USD/EUR bere jen zprávy své měny',news('EUR',T('2026-09-12T08:00:00Z'),15,1)===true&&news('EUR',T('2026-09-10T12:30:00Z'),15,3)===false);
check('okno přesahující kalendář = bez dat',news('EUR/USD',T('2026-09-05T00:00:00Z')+5*m,15,3)===undefined&&news('EUR/USD',T('2026-09-20T00:00:00Z')-5*m,15,3)===undefined&&news('EUR/USD',T('2026-09-05T00:00:00Z')+15*m,15,3)===false);
check('minSignal filtruje slabé zprávy',news('EUR/GBP',T('2026-09-12T08:00:00Z'),15,2)===false&&news('EUR/GBP',T('2026-09-12T08:00:00Z'),15,1)===true);

// ---- požadavek
const known=new Set(['EUR/USD','^NDX']),now=T('2026-10-10T00:00:00Z');
const ok={strategyId:'s1',markets:['EUR/USD'],tf:'H1',from:'2026-01-01',to:'2026-03-01'};
const thr=(b)=>{try{parseRunRequest(b,known,now);return null}catch(e){return e.message}};
check('platný požadavek',thr(ok)===null);
check('to jako datum je včetně celého dne',parseRunRequest({...ok,to:'2026-03-01'},known,now).to===T('2026-03-02T00:00:00Z'));
check('to se ořízne na dnešek',parseRunRequest({...ok,to:T('2030-01-01')},known,now).to===now);
check('H1 nad 2 roky se odmítne',/2 roky/.test(thr({...ok,from:'2024-01-01'})||''));
check('D1 nad 25 let se odmítne',/25 let/.test(thr({...ok,tf:'D1',from:'1990-01-01'})||''));
check('víc než 30 trhů',/30/.test(thr({...ok,markets:Array.from({length:31},(_,i)=>'M'+i)})||''));
check('neznámý trh, špatný TF, prázdné trhy, from ≥ to',!!thr({...ok,markets:['FOO']})&&!!thr({...ok,tf:'H4'})&&!!thr({...ok,markets:[]})&&!!thr({...ok,from:'2026-04-01'}));
check('kapitál a riziko mimo rozsah',!!thr({...ok,capital:5})&&!!thr({...ok,riskPct:0})&&!!thr({...ok,riskPct:150}));
check('duplicitní trhy se sloučí',parseRunRequest({...ok,markets:['EUR/USD','EUR/USD']},known,now).markets.length===1);
const r2=normalizeRules({...DEFAULT_RULES,entry:[{type:'ma_cross',kind:'ema',fast:20,slow:200,dir:'up'}]});
check('rezerva zahřátí = nejdelší perioda × 3 + 50',warmupBars(r2)===200*3+50&&warmupBars(DEFAULT_RULES)===14*3+50,[warmupBars(r2)]);

// ---- plán vs. realita
const trades=[{id:'a',closeTs:100,instrument:'EUR/USD',pnl:50,r:1},{id:'b',closeTs:200,instrument:'EUR/USD',pnl:-20,r:-0.5},{id:'c',closeTs:300,instrument:null,pnl:10,r:null},{id:'d',closeTs:999,instrument:null,pnl:5,r:1},{id:'e',closeTs:150,instrument:null,pnl:5,r:1}];
const rv={a:{strategyId:'s1'},b:{strategyId:'s1'},c:{strategyId:'s1'},d:{strategyId:'s1'},e:{strategyId:'s2'}};
const p=planVsReality(trades,rv,{b:[{},{}],c:[{}]},'s1',0,500,['EUR/USD'],'CZK');
check('plán vs. realita: jen strategie a období',p.trades===2&&p.wins===1&&p.winRate===50&&p.pnl===30&&p.otherMarkets===1,p);
check('plán vs. realita: R a porušení',p.avgR===0.25&&p.totalR===0.5&&p.withR===2&&p.violations===2&&p.tradesWithViolations===1,p);
check('plán vs. realita: prázdné',planVsReality([],{},{},'s1',0,1,[],'CZK').winRate===null);
check('thin zachová krajní body',(()=>{const a=Array.from({length:1000},(_,i)=>i),t=thin(a,10);return t.length===10&&t[0]===0&&t[9]===999})());

if(fails.length){console.log('\nSELHALO: '+fails.length);process.exit(1)}console.log('\nvše ok');
