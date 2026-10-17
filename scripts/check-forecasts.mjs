// Kontrola prognóz FX: node --experimental-strip-types scripts/check-forecasts.mjs
import {readFileSync} from 'node:fs';
import {parseTePage,orientTe,parseTeOverview,parseIngFx,buildTe,buildIng,crossValue,periodEnd,quarterOf,PAIRS,TE_PAGES,htmlText} from '../lib/forecasts/core.ts';
import {evaluate} from '../lib/forecasts/eval.ts';
let bad=0;const check=(n,ok,x)=>{console.log((ok?'ok   ':'FAIL ')+n+(ok?'':' → '+JSON.stringify(x)));if(!ok)bad++};
const near=(a,b,e=1e-9)=>Math.abs(a-b)<=e;
const fx=n=>readFileSync(new URL('./fixtures/'+n,import.meta.url),'utf8');
const te=Object.fromEntries(fx('te-currency.txt').split('### ').filter(Boolean).map(b=>[b.slice(0,b.indexOf('\n')),b.slice(b.indexOf('\n')+1)]));

// --- TE: text stránky měny
let x=parseTePage(te['euro-area']);
check('EUR/USD: kotace, aktuální, datum, čtvrtletí, 12 měsíců',x&&x.quote==='EUR/USD'&&x.current===1.1235&&x.asOf==='2026-10-16'&&x.q===1.13&&x.y12===1.14,x);
let o=orientTe(x,'EUR/USD');check('EUR/USD bez obrácení',o&&!o.inverted&&o.q===1.13,o);
x=parseTePage(te['japan']);check('USD/JPY: 157.9550 → 157.18 → 153.98',x&&x.quote==='USD/JPY'&&x.current===157.955&&x.q===157.18&&x.y12===153.98,x);
x=parseTePage(te['switzerland']);check('USD/CHF: „fell to“',x&&x.quote==='USD/CHF'&&x.current===0.8231&&x.q===0.82&&x.y12===0.8,x);
// obrácení orientace: stránka kotuje CHF/USD, Tradee drží USD/CHF
const inv=parseTePage('The CHF/USD exchange rate rose to 1.2500 on October 16, 2026, up 0.1% from the previous session. X is expected to trade at 1.25 by the end of this quarter, according to Y. Looking forward, we estimate it to trade at 1.00 in 12 months time.');
o=inv&&orientTe(inv,'USD/CHF');check('obrácená kotace CHF/USD → USD/CHF = 1/x',o&&o.inverted&&near(o.current,0.8)&&near(o.q,0.8)&&near(o.y12,1),o);
check('cizí kotace se odmítne',inv&&orientTe(inv,'EUR/GBP')===null);
check('stránka bez prognózy → null',parseTePage('The EUR/USD exchange rate rose to 1.1 on October 16, 2026.')===null);
check('stránky: 7 zemí, pár i orientace',TE_PAGES.length===7&&TE_PAGES.every(p=>PAIRS.includes(p.pair)));

// --- TE přehled (přesné čtvrtletní hodnoty)
const ov=parseTeOverview(fx('te-overview.txt'));
check('přehled: období Q4/26…Q3/27',ov&&ov.periods.join()==='2026-Q4,2027-Q1,2027-Q2,2027-Q3',ov&&ov.periods);
check('přehled: EURUSD, USDJPY, USDCHF',ov&&ov.symbols.EURUSD.f[0]===1.12784&&ov.symbols.USDJPY.f[3]===153.976423&&ov.symbols.USDCHF.last===0.82402&&ov.symbols.USDCHF.f.length===4,ov&&Object.keys(ov.symbols));

// --- ING: text tabulky
const t=parseIngFx(fx('ing-fx.txt'),2026);
check('ING: datum a období',t&&t.asOf==='2026-10-15'&&t.periods.join()==='2026-Q3,2026-Q4,2027-Q1,2027-Q2,2027-Q3,2027-Q4',t&&[t.asOf,t.periods]);
check('ING: EUR/USD a USD/JPY a EUR/CHF',t&&t.pairs['EUR/USD'].join()==='1.13,1.13,1.13,1.16,1.16,1.17'&&t.pairs['USD/JPY'][1]===158&&t.pairs['EUR/CHF'][1]===0.93,t&&t.pairs);
check('ING: GBP/USD, EUR/GBP, USD/CAD, AUD/USD, NZD/USD, EUR/JPY',t&&['GBP/USD','EUR/GBP','USD/CAD','AUD/USD','NZD/USD','EUR/JPY'].every(p=>t.pairs[p]?.length===6),t&&Object.keys(t.pairs));
check('ING: mimo G10 se nepletou (EUR/SEK má vlastní řádek)',t&&t.pairs['EUR/SEK'][0]===11.05,t&&t.pairs['EUR/SEK']);
check('ING: bez tabulky → null',parseIngFx('nic',2026)===null);

// --- převod do 28 párů
const ing=buildIng(t,'u','2026-10-18');
check('ING: 28 párů, jen období od aktuálního čtvrtletí (4Q26…3Q27)',Object.keys(ing).length===28&&ing['EUR/USD'].q1.period==='2026-Q4'&&ing['EUR/USD'].q4.period==='2027-Q3'&&ing['EUR/USD'].q1.value===1.13,Object.keys(ing).length);
check('ING: přímé kotace nejsou derived (EUR/JPY, EUR/GBP, USD/JPY)',!ing['EUR/JPY'].derived&&!ing['EUR/GBP'].derived&&!ing['USD/JPY'].derived&&ing['EUR/JPY'].q1.value===179);
check('ING: GBP/JPY = GBP/USD × USD/JPY a derived',near(ing['GBP/JPY'].q1.value,1.35*158,1e-3)&&ing['GBP/JPY'].derived===true,ing['GBP/JPY']);
check('ING: USD/CHF = EUR/CHF ÷ EUR/USD (derived)',near(ing['USD/CHF'].q1.value,0.93/1.13,1e-4)&&ing['USD/CHF'].derived,ing['USD/CHF']);
check('ING: AUD/NZD = AUD/USD ÷ NZD/USD',near(ing['AUD/NZD'].q1.value,0.70/0.57,1e-4),ing['AUD/NZD']);
const cv=crossValue('JPY/EUR',{'EUR/JPY':180});check('crossValue: obrácený pár bez derived',cv&&near(cv.value,1/180)&&!cv.derived,cv);
check('CAD/JPY přes USD',near(crossValue('CAD/JPY',{'USD/CAD':1.4,'USD/JPY':154}).value,154/1.4)&&crossValue('CAD/JPY',{'USD/CAD':1.4,'USD/JPY':154}).derived);
check('chybí podklad → null',crossValue('EUR/GBP',{'EUR/USD':1.1})===null);

const majors=Object.fromEntries(TE_PAGES.map(p=>[p.pair,{current:{ 'EUR/USD':1.12,'GBP/USD':1.33,'USD/JPY':158,'USD/CHF':0.82,'USD/CAD':1.41,'AUD/USD':0.69,'NZD/USD':0.565}[p.pair],q:{ 'EUR/USD':1.13,'GBP/USD':1.34,'USD/JPY':157,'USD/CHF':0.82,'USD/CAD':1.41,'AUD/USD':0.70,'NZD/USD':0.57}[p.pair],y12:1.1,asOf:'2026-10-16',url:'u/'+p.path}]));
const bt=buildTe(majors,ov,'2026-10-18','o');
check('TE: 28 párů, major s y12, kříž bez y12 a derived',Object.keys(bt).length===28&&bt['EUR/USD'].y12&&!bt['EUR/GBP'].y12&&bt['EUR/GBP'].derived&&!bt['EUR/USD'].derived,Object.keys(bt).length);
check('TE: EUR/USD q z přehledu (přesně), období 2026-Q4',bt['EUR/USD'].q.value===1.12784&&bt['EUR/USD'].q.period==='2026-Q4'&&bt['EUR/USD'].quarters.length===4);
const btNoOv=buildTe(majors,null,'2026-10-18','o');check('TE bez přehledu: q z textu, období z data',btNoOv['EUR/USD'].q.value===1.13&&btNoOv['EUR/USD'].q.period==='2026-Q4'&&!btNoOv['EUR/USD'].quarters);
check('periodEnd / quarterOf',periodEnd('2026-Q4')==='2026-12-31'&&periodEnd('2027-Q1')==='2027-03-31'&&periodEnd('2026-Q2')==='2026-06-30'&&quarterOf('2026-10-18')==='2026-Q4'&&quarterOf('2027-03-31')==='2027-Q1');
check('htmlText: tagy a entity',htmlText('<td>a&nbsp;b</td><script>x</script><p>c</p>')==='a b c');

// --- vyhodnocení
const prices={'EUR/USD':{'2026-12-31':1.15,'2026-09-30':1.08},'USD/JPY':{'2026-12-31':150}};
const priceAt=(p,d)=>prices[p]?.[d]??null;
const S=(source,pair,horizonEnd,value,spot)=>({source,pair,madeAt:'2026-10-01',horizonEnd,value,spot});
const st=evaluate([
 S('te','EUR/USD','2026-12-31',1.12,1.10), // míří nahoru, realita 1.15 → zásah
 S('te','USD/JPY','2026-12-31',158,155),   // míří nahoru, realita 150 (pod spotem) → minutí
 S('te','EUR/USD','2027-03-31',1.20,1.10), // budoucnost → čeká
 S('ing','EUR/USD','2026-09-30',1.05,1.10), // míří dolů, realita 1.08 (pod spotem) → zásah
 S('ing','EUR/GBP','2026-12-31',0.85,0.84), // bez ceny → čeká
 S('ing','EUR/USD','2026-12-31',1.10,1.10), // beze změny → bez směru
],priceAt,'2026-12-31');
const te_=st.find(s=>s.source==='te'),ig=st.find(s=>s.source==='ing');
check('eval: te – 3 snímky, 2 vyhodnoceny, 1 čeká',te_.total===3&&te_.resolved===2&&te_.pending===1,te_);
check('eval: te – hit rate 1/2',te_.directional===2&&te_.hits===1&&te_.hitRate===0.5,te_);
check('eval: te – průměrná chyba a vychýlení',near(te_.mape,(Math.abs(1.12/1.15-1)*100+Math.abs(158/150-1)*100)/2,1e-9)&&near(te_.bias,((1.12/1.15-1)*100+(158/150-1)*100)/2,1e-9),te_);
check('eval: ing – 1 zásah, nulová prognóza bez směru, chybějící cena čeká',ig.resolved===2&&ig.directional===1&&ig.hits===1&&ig.pending===1&&ig.hitRate===1,ig);
check('eval: rozpad po párech',te_.byPair.find(p=>p.pair==='EUR/USD').hitRate===1&&te_.byPair.find(p=>p.pair==='USD/JPY').hitRate===0,te_.byPair);
check('eval: prázdný vstup',evaluate([],priceAt,'2026-12-31').length===0);
check('eval: nic nevyhodnoceno → hitRate null',evaluate([S('te','EUR/USD','2027-03-31',1.2,1.1)],priceAt,'2026-12-31')[0].hitRate===null);
console.log(bad?`\n${bad} chyb`:'\nvše v pořádku');process.exit(bad?1:0);
