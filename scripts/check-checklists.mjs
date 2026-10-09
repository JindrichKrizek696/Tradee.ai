// Kontrola checklistů: node --experimental-strip-types scripts/check-checklists.mjs
import {mapSymbol,applicable,snapshotFor,completion,completionGroup,validateChecklist,newItemId} from '../lib/checklists/core.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const IDS=['EUR/USD','USD/JPY','GBP/USD','USD','EUR','^NDX','^GSPC','BTC-USD','ETH-USD','AAPL','BRK-B','JPM'];
check('FX přímý',mapSymbol('EURUSD',IDS,{})==='EUR/USD'&&mapSymbol('eurusd.r',IDS,{})==='EUR/USD'&&mapSymbol('EURUSDm',IDS,{})==='EUR/USD');
check('FX obrácený',mapSymbol('USDEUR',IDS,{})==='EUR/USD'&&mapSymbol('JPYUSD',IDS,{})==='USD/JPY');
check('FX neexistující měna',mapSymbol('EURPLN',IDS,{})===null);
check('indexy',mapSymbol('NAS100',IDS,{})==='^NDX'&&mapSymbol('US100.cash',IDS,{})==='^NDX'&&mapSymbol('USTEC',IDS,{})==='^NDX'&&mapSymbol('US500',IDS,{})==='^GSPC'&&mapSymbol('SPX500',IDS,{})==='^GSPC');
check('krypto',mapSymbol('BTCUSD',IDS,{})==='BTC-USD'&&mapSymbol('BTCUSDT',IDS,{})==='BTC-USD'&&mapSymbol('ETHUSD.m',IDS,{})==='ETH-USD');
check('akcie',mapSymbol('AAPL',IDS,{})==='AAPL'&&mapSymbol('AAPL.US',IDS,{})==='AAPL'&&mapSymbol('#AAPL',IDS,{})==='AAPL'&&mapSymbol('BRK.B',IDS,{})==='BRK-B'&&mapSymbol('JPM.NYSE',IDS,{})==='JPM');
check('neznámé',mapSymbol('XAUUSD',IDS,{})===null&&mapSymbol('GER40',IDS,{})===null&&mapSymbol('',IDS,{})===null);
check('ruční přiřazení má přednost',mapSymbol('GER40',IDS,{GER40:'^GSPC'})==='^GSPC'&&mapSymbol('EURUSD',IDS,{EURUSD:''})===null);
check('ruční přiřazení: velikost písmen',mapSymbol('ger40.cash',IDS,{'GER40.CASH':'^NDX'})==='^NDX');
check('ruční zápis s lomítkem',mapSymbol('EUR/USD',IDS,{})==='EUR/USD'&&mapSymbol('eur/usd',IDS,{})==='EUR/USD');
const L=[{id:'c1',name:'Breakout',items:[{id:'a1',text:'Trend'},{id:'a2',text:'SL'}],markets:['EUR/USD','^NDX']},{id:'c2',name:'Riziko',items:[{id:'b1',text:'Max 1 %'}],markets:['EUR/USD']},{id:'c3',name:'Krypto',items:[{id:'d1',text:'X'}],markets:['BTC-USD']}];
check('platné checklisty',applicable(L,'EUR/USD').map(c=>c.id).join()==='c1,c2'&&applicable(L,'AAPL').length===0);
const snap=snapshotFor(L,'EUR/USD',{c1:['a2','zz'],c2:[]});
check('snímek: kopie textů a zaškrtnutí, neznámé id ignoruje',JSON.stringify(snap)===JSON.stringify([{checklistId:'c1',name:'Breakout',items:[{id:'a1',text:'Trend',checked:false},{id:'a2',text:'SL',checked:true}]},{checklistId:'c2',name:'Riziko',items:[{id:'b1',text:'Max 1 %',checked:false}]}]),snap);
check('snímek prázdný pro trh bez checklistů',snapshotFor(L,'AAPL',{}).length===0);
check('splnění',completion(snap)===1/3&&completion([])===null&&completion([{checklistId:'x',name:'x',items:[]}])===null);
check('skupiny',completionGroup(1)==='full'&&completionGroup(0.7)==='most'&&completionGroup(0.69)==='less'&&completionGroup(0)==='less'&&completionGroup(null)==='none');
const ok=validateChecklist({name:' Breakout ',items:[{id:'a1',text:' Trend '},{text:'Nový'}],markets:['EUR/USD','XXX','EUR/USD']},IDS);
check('validace: ořez, nové id, neznámé a duplicitní trhy pryč',typeof ok!=='string'&&ok.name==='Breakout'&&ok.items[0].text==='Trend'&&ok.items[1].id.length===8&&JSON.stringify(ok.markets)==='["EUR/USD"]',ok);
check('validace: chyby',typeof validateChecklist({name:'',items:[],markets:[]},IDS)==='string'&&typeof validateChecklist({name:'x'.repeat(61),items:[],markets:[]},IDS)==='string'&&typeof validateChecklist({name:'A',items:Array.from({length:31},(_,i)=>({text:'b'+i})),markets:[]},IDS)==='string'&&typeof validateChecklist({name:'A',items:[{text:''}],markets:[]},IDS)==='string'&&typeof validateChecklist({name:'A',items:[{text:'x'.repeat(121)}],markets:[]},IDS)==='string'&&typeof validateChecklist(null,IDS)==='string');
check('id bodu',/^[a-z0-9]{8}$/.test(newItemId())&&newItemId()!==newItemId());

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
