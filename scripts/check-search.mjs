// Kontrola vyhledávání: node --experimental-strip-types scripts/check-search.mjs
import {fold,words,score,rank,highlight,currencyWords,resolveAlias,aliasWords,suggestAliases} from '../lib/search.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const titles=r=>r.map(x=>x.title);

check('fold: bez diakritiky, stejná délka',fold('Kalendář Řízení')==='kalendar rizeni'&&fold('Kalendář').length==='Kalendář'.length);
check('words: dělí lomítka a tečky',JSON.stringify(words('EUR/USD · 17.10.2026'))==='["eur","usd","17","10","2026"]',words('EUR/USD · 17.10.2026'));
check('diakritika i velikost písmen',score({title:'Kalendář'},'kalendar')>0&&score({title:'Kalendář'},'KALENDÁŘ')>0);
check('eurusd najde EUR/USD',score({title:'EUR/USD'},'eurusd')>0&&score({title:'EUR/USD'},'eur usd')>0&&score({title:'EUR/USD'},'EUR/USD')===100);
check('začátek slova, ne střed',score({title:'Nastavení'},'stav')===0||score({title:'Nastavení'},'stav')<score({title:'Stav účtu'},'stav'));
check('víc slov v libovolném pořadí',score({title:'Max. denní ztráta'},'ztráta denní')>0);
check('shoda jen v klíčových slovech',score({title:'GBP/JPY',keywords:currencyWords('GBP/JPY')},'libra')>0&&score({title:'GBP/JPY',keywords:currencyWords('GBP/JPY')},'jen')>0);
check('nic nesedí → 0',score({title:'Zlato'},'bitcoin')===0&&score({title:'Zlato'},'')===0);
check('krátký střed slova nestačí (šum)',score({title:'Ropa Brent',subtitle:'Komodity'},'en')===0);
const items=[{title:'USD/JPY'},{title:'USD · měnový index'},{title:'EUR/USD'},{title:'Dashboard'},{title:'USD/CAD'}];
check('pořadí: přesný začátek před obsahem',titles(rank(items,'usd'))[0].startsWith('USD')&&titles(rank(items,'usd')).indexOf('EUR/USD')>titles(rank(items,'usd')).indexOf('USD/JPY'),titles(rank(items,'usd')));
check('pořadí: přesná shoda první',titles(rank([{title:'Zlato · futures'},{title:'Zlato'}],'zlato'))[0]==='Zlato');
check('boost posune výš',titles(rank([{title:'Kalendář obchodů'},{title:'Kalendář',boost:5}],'kal'))[0]==='Kalendář');
check('limit',rank(items,'u',2).length<=2);
const trades=[{title:'EURUSD Sell',d:3},{title:'EURUSD Buy',d:2},{title:'EURUSD Sell',d:1}];
check('byDate: drží pořadí zdroje',JSON.stringify(rank(trades,'eurusd',9,true).map(x=>x.d))==='[3,2,1]'&&rank(trades,'eurusd')[0].d===2);
const h=highlight('Řízení rizika','rizik');
check('zvýraznění s diakritikou',JSON.stringify(h)==='[{"t":"Řízení ","hit":false},{"t":"rizik","hit":true},{"t":"a","hit":false}]',h);
const h2=highlight('EUR/USD','usd');
check('zvýraznění od začátku slova',h2.some(x=>x.hit&&x.t==='USD'),h2);
// --- aliasy trhů (brokeři, futures kořeny, tickery)
const to=q=>resolveAlias(q)?.id??null;
check('alias Nasdaq 100: NQ NAS100 US100 USTEC TECH100',['NQ','nas100','US100','ustec','Tech 100','tech100'].every(q=>to(q)==='^NDX'),['NQ','nas100','US100','ustec','tech100'].map(to));
check('alias S&P 500: ES SPX US500 SP500',['ES','spx','US500','sp500','S&P 500'].every(q=>to(q)==='^GSPC'),['ES','spx','US500','sp500','S&P 500'].map(to));
check('alias zlato/stříbro: GOLD XAUUSD GC / SILVER XAGUSD SI',['gold','XAUUSD','xau/usd','GC'].every(q=>to(q)==='GC=F')&&['silver','XAGUSD','SI'].every(q=>to(q)==='SI=F'),null);
check('alias ropa: WTI USOIL CL / BRENT UKOIL BZ',['wti','USOIL','CL'].every(q=>to(q)==='CL=F')&&['brent','UKOIL','bz'].every(q=>to(q)==='BZ=F'),null);
check('alias krypto a DXY: BTC XBT ETH DXY',to('btc')==='BTC-USD'&&to('XBT')==='BTC-USD'&&to('eth')==='ETH-USD'&&to('DXY')==='USD',[to('btc'),to('XBT'),to('eth'),to('DXY')]);
check('alias USDCZK → USD/CZK',to('usdczk')==='USD/CZK'&&to('usd/czk')==='USD/CZK',to('usdczk'));
check('futures kořen NQ/ES → nápověda, že Tradee má index',/NQ \(futures\) Tradee nemá – zobrazujeme index Nasdaq 100 \(\^NDX\)/.test(resolveAlias('nq').hint)&&/ES \(futures\)/.test(resolveAlias('ES').hint)&&!resolveAlias('nas100').hint&&!resolveAlias('gold').hint,resolveAlias('nq'));
check('žádný alias pro běžná slova a prázdný dotaz',to('')===null&&to('kalendář')===null&&to('eurusd')===null,null);
check('aliasová slova do klíčových slov trhu',/\bnq\b/.test(aliasWords('^NDX'))&&/\bus100\b/.test(aliasWords('^NDX'))&&/\bxauusd\b/.test(aliasWords('GC=F'))&&aliasWords('AAPL')==='',aliasWords('^NDX'));
check('hledání přes klíčová slova najde zlato na „xauusd“ a Nasdaq na „us100“',score({title:'Zlato (futures GC=F)',keywords:'GC=F '+aliasWords('GC=F')},'xauusd')>0&&score({title:'Nasdaq 100 (index)',keywords:'^NDX '+aliasWords('^NDX')},'us100')>0,null);
const sg=suggestAliases('nas10'),sg2=suggestAliases('xauusdd'),sg3=suggestAliases('us50');
check('prázdný výsledek: nejbližší aliasy (začátek i překlep)',sg[0]?.id==='^NDX'&&sg2[0]?.id==='GC=F'&&sg3[0]?.id==='^GSPC'&&suggestAliases('x').length===0&&suggestAliases('qqqqqqqq').length===0,[sg,sg2,sg3]);
check('návrhy: každý trh nejvýš jednou, max. 3',new Set(suggestAliases('us').map(s=>s.id)).size===suggestAliases('us').length&&suggestAliases('us').length<=3,suggestAliases('us'));

if(fails.length){console.log(`\n${fails.length} FAIL`);process.exit(1)}console.log('\nCHECK OK');
