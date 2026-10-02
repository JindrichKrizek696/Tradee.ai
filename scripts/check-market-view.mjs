// Kontrola seznamu trhů a předvoleb barev: node --experimental-strip-types scripts/check-market-view.mjs
import {toItem,topSignals,heatmapGroups,sortItems,filterItems,matchesQuery,intensity,textOn,hexContrastOnWhite} from '../lib/market-view.ts';
import {palettes,getPalette,isPalette,DEFAULT_PALETTE} from '../lib/palettes.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const it=(id,group,score,coverage=80,name=id)=>({id,name,group,score,trend:null,coverage,bias:''});
const items=[it('EUR/USD','fx',42),it('GBP/USD','fx',-71),it('USD/JPY','fx',null),it('AUD/USD','fx',12),it('USD','currency',-5),it('BTC-USD','crypto',88),it('AAPL','stock',0),it('NZD/USD','fx',-30),it('^NDX','index',55,80,'Nasdaq 100'),it('MSFT','stock',-12),it('TSLA','stock',-90)];

const t=topSignals(items);
check('top bullish: jen kladné, sestupně',t.bull.map(i=>i.id).join()==='BTC-USD,^NDX,EUR/USD,AUD/USD',t.bull.map(i=>i.id));
check('top bearish: jen záporné, od nejsilnějšího',t.bear.map(i=>i.id).join()==='TSLA,GBP/USD,NZD/USD,MSFT,USD',t.bear.map(i=>i.id));
check('top: limit 5 a bez null/0',topSignals(items,2).bull.length===2&&!t.bull.concat(t.bear).some(i=>i.score===null||i.score===0),null);
check('top: prázdný vstup',topSignals([]).bull.length===0&&topSignals([]).bear.length===0,null);

const h=heatmapGroups(items,{fx:'FX páry',currency:'Měnové indexy',index:'Akciové indexy',crypto:'Krypto',stock:'Akcie'});
check('heatmapa: pořadí skupin',h.map(g=>g.group).join()==='fx,currency,index,crypto,stock',h.map(g=>g.group));
check('heatmapa: fx sestupně, null na konci',h[0].items.map(i=>i.id).join()==='EUR/USD,AUD/USD,NZD/USD,GBP/USD,USD/JPY',h[0].items.map(i=>i.id));
check('heatmapa: prázdné skupiny vynechá',heatmapGroups([it('A','fx',1)],{}).length===1,null);

check('řazení skóre sestupně, null na konci',sortItems(items,'score',-1).map(i=>i.score).slice(-1)[0]===null&&sortItems(items,'score',-1)[0].id==='BTC-USD',sortItems(items,'score',-1).map(i=>i.id));
check('řazení skóre vzestupně, null pořád na konci',sortItems(items,'score',1)[0].id==='TSLA'&&sortItems(items,'score',1).slice(-1)[0].score===null,sortItems(items,'score',1).map(i=>i.id));
check('řazení podle názvu',sortItems(items,'name',1)[0].id==='AAPL',sortItems(items,'name',1).map(i=>i.id));

check('hledání ignoruje lomítko a velikost',matchesQuery(it('EUR/USD','fx',1),'eurusd')&&matchesQuery(it('EUR/USD','fx',1),'eur/u')&&!matchesQuery(it('EUR/USD','fx',1),'gbp'),null);
check('filtr silné ≥ |40|',filterItems(items,{query:'',score:'strong',flag:'all'},{}).map(i=>i.id).join()==='EUR/USD,GBP/USD,BTC-USD,^NDX,TSLA',filterItems(items,{query:'',score:'strong',flag:'all'},{}).map(i=>i.id));
check('filtr bez skóre',filterItems(items,{query:'',score:'missing',flag:'all'},{}).map(i=>i.id).join()==='USD/JPY',null);
check('filtr vlaječky (none = bez vlaječky)',filterItems(items,{query:'',score:'all',flag:'green'},{'EUR/USD':'green'}).map(i=>i.id).join()==='EUR/USD'&&filterItems(items,{query:'',score:'all',flag:'none'},{'EUR/USD':'green'}).length===items.length-1,null);

check('intenzita',intensity(null)===0&&intensity(0)===0.15&&intensity(70)===1&&intensity(-100)===1&&Math.abs(intensity(35)-0.575)<1e-9,[intensity(null),intensity(0),intensity(70),intensity(35)]);
check('text na sytě zelené je bílý, na bledé tmavý',textOn('#16a34a',1)==='#fff'&&textOn('#16a34a',0.15)==='#141518',[textOn('#16a34a',1),textOn('#16a34a',0.15)]);
check('text na sytě žluté a křiklavě zelené je tmavý, na černé bílý',textOn('#eab308',1)==='#141518'&&textOn('#00d664',1)==='#141518'&&textOn('#17191e',0.6)==='#fff',[textOn('#eab308',1),textOn('#00d664',1),textOn('#17191e',0.6)]);

check('výchozí předvolba je zelená/červená',DEFAULT_PALETTE==='green-red'&&getPalette(undefined).id==='green-red'&&getPalette('nesmysl').id==='green-red',getPalette('nesmysl').id);
check('isPalette',isPalette('neon-pink')&&!isPalette('x')&&!isPalette(3),null);
check('5 předvoleb s unikátním id',palettes.length===5&&new Set(palettes.map(p=>p.id)).size===5,palettes.map(p=>p.id));
const low=palettes.flatMap(p=>[[p.id+' bullText',hexContrastOnWhite(p.bullText)],[p.id+' bearText',hexContrastOnWhite(p.bearText)]]).filter(([,c])=>c<4.5);
check('textové odstíny mají kontrast ≥ 4,5 na bílé',low.length===0,low);

console.log(fails.length?'CHECK FAILED':'CHECK OK');
if(fails.length)process.exitCode=1;
