// Kontrola vyhledávání: node --experimental-strip-types scripts/check-search.mjs
import {fold,words,score,rank,highlight,currencyWords} from '../lib/search.ts';
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
if(fails.length){console.log(`\n${fails.length} FAIL`);process.exit(1)}console.log('\nCHECK OK');
