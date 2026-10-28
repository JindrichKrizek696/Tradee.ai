// Kontrola seznamu trhů a předvoleb barev: node --experimental-strip-types scripts/check-market-view.mjs
import {toItem,topSignals,heatmapGroups,sortItems,filterItems,matchesQuery,matchesText,intensity,textOn,hexContrastOnWhite} from '../lib/market-view.ts';
import {palettes,getPalette,isPalette,DEFAULT_PALETTE} from '../lib/palettes.ts';
import {instruments,groups,assetNames,marketScore,isCommodity,technicalMethodText,isModelPair,TECH_FX} from '../lib/markets.ts';
import {pairs} from '../lib/score-engine.ts';
import {dataSource,sourceBadgeText,sourceTooltip,YAHOO_OVERRIDE} from '../lib/instrument-info.ts';
import {yahooSymbol} from '../lib/live.ts';
import {quoteSource} from '../lib/alerts/quotes.ts';
import {mapSymbol} from '../lib/checklists/core.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const it=(id,group,score,coverage=80,name=id)=>({id,name,group,score,trend:null,coverage,bias:''});
const items=[it('EUR/USD','fx',42),it('GBP/USD','fx',-71),it('USD/JPY','fx',null),it('AUD/USD','fx',12),it('USD','currency',-5),it('BTC-USD','crypto',88),it('AAPL','stock',0),it('NZD/USD','fx',-30),it('^NDX','index',55,80,'Nasdaq 100'),it('MSFT','stock',-12),it('TSLA','stock',-90)];

const row=(signal,trend)=>({id:'EUR/USD',name:'EUR/USD',group:'fx',r:{score:12,coverage:90,bias:'Bullish',parts:[{id:'trend',signal}],price:{trend}}});
check('toItem: trend z ceny, null když signál trendu chybí',toItem(row(0.5,0.3)).trend===1&&toItem(row(-1,-0.2)).trend===-1&&toItem(row(0,0)).trend===0&&toItem(row(null,0.4)).trend===null&&toItem(row(0.5,0.3)).score===12,[toItem(row(0.5,0.3)).trend,toItem(row(null,0.4)).trend]);
const t=topSignals(items);
check('top bullish: jen kladné, sestupně',t.bull.map(i=>i.id).join()==='BTC-USD,^NDX,EUR/USD,AUD/USD',t.bull.map(i=>i.id));
check('top bearish: jen záporné, od nejsilnějšího',t.bear.map(i=>i.id).join()==='TSLA,GBP/USD,NZD/USD,MSFT,USD',t.bear.map(i=>i.id));
check('top: limit 5 a bez null/0',topSignals(items,2).bull.length===2&&!t.bull.concat(t.bear).some(i=>i.score===null||i.score===0),null);
check('top: prázdný vstup',topSignals([]).bull.length===0&&topSignals([]).bear.length===0,null);

const h=heatmapGroups(items,{fx:'FX páry',currency:'Měnové indexy',index:'Akciové indexy',crypto:'Krypto',stock:'Akcie'});
check('heatmapa: pořadí skupin',h.map(g=>g.group).join()==='fx,currency,index,crypto,stock',h.map(g=>g.group));
check('heatmapa: fx sestupně, null na konci',h[0].items.map(i=>i.id).join()==='EUR/USD,AUD/USD,NZD/USD,GBP/USD,USD/JPY',h[0].items.map(i=>i.id));
const hc=heatmapGroups([...items,it('GC=F','commodities',-20,100,'Zlato · XAU/USD'),it('CL=F','commodities',40,100,'Ropa WTI')],groups);
check('heatmapa: komodity mezi indexy a kryptem, sestupně',hc.map(g=>g.group).join()==='fx,currency,index,commodities,crypto,stock'&&hc[3].label==='Komodity'&&hc[3].items.map(i=>i.id).join()==='CL=F,GC=F',hc.map(g=>g.group));
// komodity v lib/markets.ts: skupina, názvy, hledání
const com=instruments.filter(i=>i.group==='commodities');
check('komodity: 4 futures trhy ve skupině Komodity',com.map(i=>i.id).join()==='GC=F,SI=F,CL=F,BZ=F'&&groups.commodities==='Komodity'&&com.every(i=>isCommodity(i.id)&&assetNames[i.id])&&!isCommodity('BTC-USD'),com);
check('komodity: hledání xauusd, zlato, wti, brent',matchesQuery(it('GC=F','commodities',0,0,'Zlato · XAU/USD'),'xauusd')&&matchesQuery(it('GC=F','commodities',0,0,'Zlato · XAU/USD'),'zlato')&&matchesQuery(it('CL=F','commodities',0,0,'Ropa WTI'),'wti')&&matchesQuery(it('BZ=F','commodities',0,0,'Ropa Brent'),'brent'),null);
{// skóre komodit: technický model + COT (managed money); Brent bez COT
 const NOW=Date.parse('2026-10-12T12:00:00Z'),day=d=>new Date(NOW-d*86400000).toISOString().slice(0,10);
 const price={asOf:day(1),checkedAt:new Date(NOW-3600000).toISOString(),sourceUrl:'',reference:1,gma50:1,gma200:1,trend:1,months:{},currentMonth:10,currentYear:2026,currentPath:[],pricePath:[]};
 const rows=Array.from({length:30},(_,i)=>({date:day(7*(29-i)+6),openInterest:1000,groups:{managedMoney:{long:300,short:100,spread:0,net:200-(29-i)*2}}}));
 const ct={contract:'GOLD',code:'088691',isProxy:false,sourceUrl:'',checkedAt:new Date(NOW-3600000).toISOString(),history:rows};
 const M={prices:{'GC=F':price,'BZ=F':price},cot:{},legacy:{'GC=F':ct},refresh:{attemptedAt:'',issues:[]}};
 const g=marketScore({},M,'GC=F',NOW),b=marketScore({},M,'BZ=F',NOW),stale=marketScore({},{...M,legacy:{'GC=F':{...ct,checkedAt:new Date(NOW-3*86400000).toISOString()}}},'GC=F',NOW);
 const cot=g.parts.find(p=>p.id==='cot');
 check('komodity: zlato = trend 50 + COT 30 + sezonalita 20',g.method==='technical-cot-v1'&&g.parts.map(p=>p.id+p.weight).join()==='trend50,cot30,seasonality20'&&cot.signal>0&&Math.abs(g.score-(50+30*cot.signal))<0.11&&g.coverage===80,g.parts);
 check('komodity: COT starší než 48 h kontroly se nezapočítá',stale.parts.find(p=>p.id==='cot').signal===null&&stale.score===50,stale.parts);
 check('komodity: Brent bez COT = technický model 70/30',b.method==='technical-v1.1'&&b.parts.map(p=>p.id+p.weight).join()==='trend70,seasonality30'&&b.score===70,b.parts);
 check('komodity: text výpočtu zmiňuje COT jen u trhů s kontraktem',/COT/.test(technicalMethodText('GC=F'))&&/managed money/.test(technicalMethodText('CL=F'))&&!/30 %/.test(technicalMethodText('BZ=F').replace('sezonalita 30 %',''))&&technicalMethodText('AAPL').startsWith('Technický model: denní trend 70 %'),null);
}
check('heatmapa: prázdné skupiny vynechá',heatmapGroups([it('A','fx',1)],{}).length===1,null);

check('řazení skóre sestupně, null na konci',sortItems(items,'score',-1).map(i=>i.score).slice(-1)[0]===null&&sortItems(items,'score',-1)[0].id==='BTC-USD',sortItems(items,'score',-1).map(i=>i.id));
check('řazení skóre vzestupně, null pořád na konci',sortItems(items,'score',1)[0].id==='TSLA'&&sortItems(items,'score',1).slice(-1)[0].score===null,sortItems(items,'score',1).map(i=>i.id));
check('řazení podle názvu',sortItems(items,'name',1)[0].id==='AAPL',sortItems(items,'name',1).map(i=>i.id));

check('hledání ignoruje lomítko a velikost',matchesQuery(it('EUR/USD','fx',1),'eurusd')&&matchesQuery(it('EUR/USD','fx',1),'eur/u')&&!matchesQuery(it('EUR/USD','fx',1),'gbp'),null);
check('hledání bez lomítka/pomlčky: eurusd, eur usd, btcusd, sp500',matchesText('EUR/USD EUR/USD','eurusd')&&matchesText('EUR/USD','eur usd')&&matchesText('BTC-USD Bitcoin','btcusd')&&matchesText('^GSPC S&P 500','s&p500')&&!matchesText('EUR/USD','gbp'),null);
check('filtr silné ≥ |40|',filterItems(items,{query:'',score:'strong',flag:'all'},{}).map(i=>i.id).join()==='EUR/USD,GBP/USD,BTC-USD,^NDX,TSLA',filterItems(items,{query:'',score:'strong',flag:'all'},{}).map(i=>i.id));
check('filtr bez skóre',filterItems(items,{query:'',score:'missing',flag:'all'},{}).map(i=>i.id).join()==='USD/JPY',null);
check('filtr vlaječky (none = bez vlaječky)',filterItems(items,{query:'',score:'all',flag:'green'},{'EUR/USD':'green'}).map(i=>i.id).join()==='EUR/USD'&&filterItems(items,{query:'',score:'all',flag:'none'},{'EUR/USD':'green'}).length===items.length-1,null);

check('intenzita',intensity(null)===0&&intensity(0)===0.15&&intensity(70)===1&&intensity(-100)===1&&Math.abs(intensity(35)-0.575)<1e-9,[intensity(null),intensity(0),intensity(70),intensity(35)]);
check('text na sytě zelené je bílý, na bledé tmavý',textOn('#16a34a',1)==='#fff'&&textOn('#16a34a',0.15)==='#141518',[textOn('#16a34a',1),textOn('#16a34a',0.15)]);
check('text na sytě žluté a křiklavě zelené je tmavý, na černé bílý',textOn('#eab308',1)==='#141518'&&textOn('#00d664',1)==='#141518'&&textOn('#17191e',0.6)==='#fff',[textOn('#eab308',1),textOn('#00d664',1),textOn('#17191e',0.6)]);

check('výchozí předvolba je zelená/červená',DEFAULT_PALETTE==='green-red'&&getPalette(undefined).id==='green-red'&&getPalette('nesmysl').id==='green-red',getPalette('nesmysl').id);
check('isPalette',isPalette('neon-pink')&&!isPalette('x')&&!isPalette(3),null);
check('10 předvoleb s unikátním id',palettes.length===10&&new Set(palettes.map(p=>p.id)).size===10,palettes.map(p=>p.id));
const hex=/^#[0-9a-f]{6}$/;
check('barvy předvoleb jsou hex a v tmavém motivu se liší bull/bear',palettes.every(p=>[p.bull,p.bear,p.bullText,p.bearText,p.dark?.bull??p.bull,p.dark?.bear??p.bear].every(c=>hex.test(c))&&(p.dark?.bull??p.bull)!==(p.dark?.bear??p.bear)),null);
check('černá se v tmavém motivu otočí na bílou',palettes.filter(p=>p.bear==='#17191e').every(p=>p.dark?.bear==='#f4f4f5'),null);
const low=palettes.flatMap(p=>[[p.id+' bullText',hexContrastOnWhite(p.bullText)],[p.id+' bearText',hexContrastOnWhite(p.bearText)]]).filter(([,c])=>c<4.5);
check('textové odstíny mají kontrast ≥ 4,5 na bílé',low.length===0,low);

// --- identita instrumentů: poctivé názvy a zdroj dat (symboly se nemění)
check('názvy: zlato/stříbro/ropa = futures se symbolem, indexy = index',assetNames['GC=F']==='Zlato (futures GC=F)'&&assetNames['SI=F']==='Stříbro (futures SI=F)'&&assetNames['CL=F']==='Ropa WTI (futures CL=F)'&&assetNames['BZ=F']==='Ropa Brent (futures BZ=F)'&&assetNames['^NDX']==='Nasdaq 100 (index)'&&assetNames['^GSPC']==='S&P 500 (index)'&&!Object.values(assetNames).some(n=>/XAU\/USD|XAG\/USD/.test(n)),null);
check('zdroj dat zlata: COMEX futures GC=F (Yahoo), liší se od spotu/CFD',sourceBadgeText('GC=F')==='Data: COMEX futures GC=F (Yahoo), cena se liší od spotu/CFD u brokera'&&dataSource('GC=F').type==='futures'&&dataSource('SI=F').short==='COMEX futures SI=F (Yahoo)'&&dataSource('CL=F').short.startsWith('NYMEX futures CL=F')&&dataSource('BZ=F').type==='futures',sourceBadgeText('GC=F'));
check('zdroj dat indexů: ^NDX = index Nasdaq 100, ne NQ/US100',dataSource('^NDX').type==='index'&&/ne futures NQ ani CFD US100/.test(dataSource('^NDX').note)&&/ne futures ES/.test(dataSource('^GSPC').note)&&/^Data: index Nasdaq 100 \^NDX/.test(sourceBadgeText('^NDX')),dataSource('^NDX'));
check('zdroj dat: tooltip má poskytovatele, symbol, typ a zpoždění',['Poskytovatel: Yahoo Finance','Symbol: GC=F','Typ: futures','Zpoždění:'].every(x=>sourceTooltip('GC=F').includes(x))&&sourceTooltip('USD/CZK').includes('Symbol: CZK=X'),sourceTooltip('GC=F'));
check('zdroj dat pro každý trh v seznamu',instruments.every(i=>dataSource(i.id)),instruments.filter(i=>!dataSource(i.id)).map(i=>i.id));
check('aliasy v hledání trhů: nq/us100 → Nasdaq, xauusd/gold → zlato, dxy → USD index',matchesQuery(it('^NDX','index',0,0,'Nasdaq 100 (index)'),'nq')&&matchesQuery(it('^NDX','index',0,0,'Nasdaq 100 (index)'),'US100')&&matchesQuery(it('GC=F','commodities',0,0,'Zlato (futures GC=F)'),'xauusd')&&matchesQuery(it('GC=F','commodities',0,0,'Zlato (futures GC=F)'),'gold')&&matchesQuery(it('USD','currency',0,0,'USD · měnový index'),'dxy')&&!matchesQuery(it('EUR/USD','fx',0),'dxy')&&!matchesQuery(it('^GSPC','index',0,0,'S&P 500 (index)'),'nq'),null);
check('aliasy v MarketPickeru (matchesText „id název“)',matchesText('^NDX Nasdaq 100 (index)','tech100')&&matchesText('BZ=F Ropa Brent (futures BZ=F)','ukoil')&&matchesText('USD/CZK USD/CZK','usdczk')&&!matchesText('CL=F Ropa WTI (futures CL=F)','ukoil'),null);

// --- USD/CZK: FX trh jen s technickým modelem, mimo 8měnový model
const czk=instruments.find(i=>i.id==='USD/CZK');
check('USD/CZK je ve skupině FX páry, model:false',czk&&czk.group==='fx'&&czk.model===false&&TECH_FX.includes('USD/CZK'),czk);
check('28 párů modelu beze změny, USD/CZK mezi nimi není',pairs.length===28&&!pairs.includes('USD/CZK')&&!isModelPair('USD/CZK')&&isModelPair('EUR/USD')&&instruments.filter(i=>i.group==='fx'&&i.model).length===28,pairs.length);
check('měnové indexy jen z 8 měn (CZK není)',instruments.filter(i=>i.group==='currency').map(i=>i.id).join()==='USD,EUR,GBP,CHF,JPY,CAD,AUD,NZD',null);
check('vesmír Laboratoře (model:true, bez měnových indexů) beze změny a bez CZK',instruments.filter(i=>i.group!=='currency'&&i.model).length===instruments.length-8-1&&!instruments.filter(i=>i.model).some(i=>i.id.includes('CZK')),null);
check('USD/CZK: Yahoo CZK=X všude (živé ceny, svíčky, alerty)',YAHOO_OVERRIDE['USD/CZK']==='CZK=X'&&yahooSymbol('USD/CZK',['USD','EUR'])==='CZK=X'&&quoteSource('USD/CZK').symbol==='CZK=X'&&yahooSymbol('EUR/USD',['USD'])==='EURUSD=X'&&quoteSource('EUR/USD').symbol==='EURUSD=X',[yahooSymbol('USD/CZK',[]),quoteSource('USD/CZK')]);
check('USD/CZK: deník/MT symbol USDCZK i CZKUSD se namapuje',mapSymbol('USDCZK',instruments.map(i=>i.id),{})==='USD/CZK'&&mapSymbol('USDCZK.m',instruments.map(i=>i.id),{})==='USD/CZK'&&mapSymbol('USD/CZK',instruments.map(i=>i.id),{})==='USD/CZK',mapSymbol('USDCZK',instruments.map(i=>i.id),{}));
{const NOW=Date.parse('2026-10-12T12:00:00Z'),day=d=>new Date(NOW-d*86400000).toISOString().slice(0,10);
 const price={asOf:day(1),checkedAt:new Date(NOW-3600000).toISOString(),sourceUrl:'',reference:22,gma50:22,gma200:22,trend:-1,months:{},currentMonth:10,currentYear:2026,currentPath:[],pricePath:[]};
 const r=marketScore({currencies:{USD:{},EUR:{}}},{prices:{'USD/CZK':price},cot:{},legacy:{},refresh:{attemptedAt:'',issues:[]}},'USD/CZK',NOW);
 check('USD/CZK: technický model (trend 70 + sezonalita 30), bez fundamentu',r.method==='technical-v1.1'&&r.parts.map(p=>p.id+p.weight).join()==='trend70,seasonality30'&&r.score===-70&&/bez fundamentu/.test(r.model)&&/CZK není v 8měnovém modelu/.test(technicalMethodText('USD/CZK')),[r.method,r.model,r.score]);
 const none=marketScore({currencies:{}},{prices:{},cot:{},legacy:{},refresh:{attemptedAt:'',issues:[]}},'USD/CZK',NOW);
 check('USD/CZK bez ceny → skóre null, žádná výjimka ze skóre v3',none.score===null&&none.method==='technical-v1.1',none.score);}

console.log(fails.length?'CHECK FAILED':'CHECK OK');
if(fails.length)process.exitCode=1;
