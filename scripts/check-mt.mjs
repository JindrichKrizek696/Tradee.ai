// Kontrola MetaTrader synchronizace: node --experimental-strip-types scripts/check-mt.mjs
import {isKeyFormat,hashKey,generateKey} from '../lib/mt/keys.ts';
import {parseBatch,snapshotEvents,MAX_EVENTS} from '../lib/mt/protocol.ts';
import {buildPositions,extractTags} from '../lib/mt/build.ts';
import {makeRates,rateOn,convert} from '../lib/fx.ts';
import {mtTradesToCalendar,pragueDate} from '../lib/mt/trades.ts';
import * as S from './fixtures/mt/sequences.mjs';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};

// --- klíče
const k=await generateKey();
check('klíč: formát tk_ + 43 znaků',isKeyFormat(k.key)&&k.key.length===46,k.key);
check('klíč: prefix = prvních 9 znaků',k.prefix===k.key.slice(0,9),k.prefix);
check('klíč: hash = sha256 hex',k.hash===await hashKey(k.key)&&/^[0-9a-f]{64}$/.test(k.hash),k.hash);
check('klíč: dva klíče se liší',(await generateKey()).key!==k.key);
check('klíč: špatné formáty',!isKeyFormat('tk_short')&&!isKeyFormat('xx_'+'a'.repeat(43))&&!isKeyFormat('tk_'+'a'.repeat(42)+'!'));
check('klíč: hash známého vstupu',await hashKey('abc')==='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

// --- protokol
const account={platform:'mt5',login:'12345678',server:'ICMarketsSC-Demo',company:'Raw Trading',currency:'usd',leverage:500,mode:'demo',name:'',ea:'1.0.0'};
const deal={id:'d:1001',type:'deal',ts:1791370000123,deal:'1001',position:'5001',order:'7001',symbol:'EURUSD',side:'buy',entry:'in',volume:0.5,price:1.1,commission:-2.5,swap:0,fee:0,profit:0,magic:0,comment:'#breakout test',reason:'client',dealType:'trade',sl:1.095,tp:1.11,digits:5,point:0.00001,tickSize:0.00001,tickValue:1,spread:8,priceRequested:1.09998,balance:10000};
const ok=parseBatch({v:1,account,events:[deal]});
check('protokol: platná dávka',ok.ok&&ok.batch.events.length===1&&ok.batch.account.currency==='USD',ok);
check('protokol: login jako číslo projde',parseBatch({v:1,account:{...account,login:12345678},events:[]}).ok);
check('protokol: chybějící volitelná čísla = 0',(()=>{const r=parseBatch({v:1,account,events:[{...deal,fee:undefined,spread:null}]});return r.ok&&r.batch.events[0].fee===0&&r.batch.events[0].spread===0})());
check('protokol: špatná verze',!parseBatch({v:2,account,events:[]}).ok);
check('protokol: neznámý typ',!parseBatch({v:1,account,events:[{...deal,type:'hack'}]}).ok);
check('protokol: NaN/Infinity',!parseBatch({v:1,account,events:[{...deal,price:Number.NaN}]}).ok&&!parseBatch({v:1,account,events:[{...deal,price:Infinity}]}).ok);
check('protokol: řetězec místo čísla',!parseBatch({v:1,account,events:[{...deal,volume:'0.5'}]}).ok);
check('protokol: dlouhý symbol',!parseBatch({v:1,account,events:[{...deal,symbol:'X'.repeat(33)}]}).ok);
check('protokol: dlouhý komentář',!parseBatch({v:1,account,events:[{...deal,comment:'c'.repeat(65)}]}).ok);
check('protokol: špatný entry',!parseBatch({v:1,account,events:[{...deal,entry:'sideways'}]}).ok);
check('protokol: čas mimo rozsah',!parseBatch({v:1,account,events:[{...deal,ts:5}]}).ok);
check('protokol: id se zakázanými znaky',!parseBatch({v:1,account,events:[{...deal,id:'d:1 OR 1=1'}]}).ok);
check(`protokol: ${MAX_EVENTS+1} událostí`,!parseBatch({v:1,account,events:Array.from({length:MAX_EVENTS+1},(_,i)=>({...deal,id:'d:'+i}))}).ok);
check('protokol: chybí login',!parseBatch({v:1,account:{...account,login:''},events:[]}).ok);
check('protokol: chyba říká index',(()=>{const r=parseBatch({v:1,account,events:[deal,{...deal,id:'d:2',price:'x'}]});return !r.ok&&r.error.includes('events[1]')})());
check('protokol: balance deal bez symbolu projde',parseBatch({v:1,account,events:[{...deal,id:'d:9',symbol:'',dealType:'balance',position:'0'}]}).ok);
const snap={ts:1791370120000,balance:10000,equity:10012.5,margin:110,positions:[{position:'5001',symbol:'EURUSD',side:'buy',volume:0.5,priceOpen:1.1,priceCurrent:1.1003,sl:1.095,tp:1.11,profit:15,swap:0,mfePrice:1.1005,maePrice:1.0998,mfeMoney:25,maeMoney:-10,spread:8,openTs:1791370000123}]};
const ws=parseBatch({v:1,account,events:[],snapshot:snap});
check('protokol: snapshot projde',ws.ok&&ws.batch.snapshot.positions.length===1,ws);
const se=snapshotEvents(snap);
check('protokol: snapshotEvents → position_state',se.length===1&&se[0].type==='position_state'&&se[0].id==='p:5001:1791370120000'&&se[0].ts===snap.ts&&se[0].mfeMoney===25,se);
check('protokol: ctrl char v komentáři',!parseBatch({v:1,account,events:[{...deal,comment:'a\u0000b'}]}).ok);
check('protokol: __proto__ z JSON inertní',(()=>{const r=parseBatch(JSON.parse('{"v":1,"account":'+JSON.stringify(account)+',"events":[{"__proto__":{"type":"deal"},"id":"d:5","type":"deal","ts":1791370000123}]}'));return !r.ok&&({}).type===undefined})());
check('protokol: obrovské magic clamped',(()=>{const r=parseBatch({v:1,account,events:[{...deal,magic:18446744073709551615}]});return r.ok&&r.batch.events[0].magic===9e18})());
check('protokol: ticket delší než 40',!parseBatch({v:1,account,events:[{...deal,position:'9'.repeat(41)}]}).ok);
check('protokol: ticket 40 znaků ok',parseBatch({v:1,account,events:[{...deal,position:'9'.repeat(40)}]}).ok);
check(`protokol: přesně ${MAX_EVENTS} událostí`,parseBatch({v:1,account,events:Array.from({length:MAX_EVENTS},(_,i)=>({...deal,id:'d:'+i}))}).ok);
check('protokol: pole místo objektu events',!parseBatch({v:1,account,events:[[1,2]]}).ok);
check('protokol: pole místo objektu account',!parseBatch({v:1,account:[],events:[]}).ok);
// údaje účtu se upraví, dávku neodmítnou
const acc=(over)=>{const r=parseBatch({v:1,account:{...account,...over},events:[deal]});return r.ok?r.batch.account:r};
check("protokol: měna účtu 'US$' → 'US'",acc({currency:'US$'}).currency==='US',acc({currency:'US$'}));
check("protokol: mode 'weird' → 'real'",acc({mode:'weird'}).mode==='real',acc({mode:'weird'}));
check('protokol: firma 70 znaků → 64',acc({company:'C'.repeat(70)}).company==='C'.repeat(64),acc({company:'C'.repeat(70)}));
check('protokol: páka Infinity/NaN → 0, ctrl char ve jménu se odstraní',acc({leverage:Infinity}).leverage===0&&acc({leverage:Number.NaN}).leverage===0&&acc({name:'a\u0001b'}).name==='ab');
check('protokol: neznámá platforma dál neprojde',!parseBatch({v:1,account:{...account,platform:'mt6'},events:[]}).ok);

// --- skládání pozic
const one=(ev)=>{const b=buildPositions('acc1',ev);return b.length===1?b[0]:null};
const near=(a,b,e=1e-9)=>a!==null&&Math.abs(a-b)<e;
let b=one(S.buyTp);
check('build: buy TP – uzavřená, čistý výsledek',b&&b.position.status==='closed'&&b.position.net===993&&b.position.close_reason==='tp'&&b.position.id==='acc1:100',b?.position);
check('build: buy TP – riziko, R:R, R',b&&b.position.risk_money===500&&b.position.risk_pct===5&&b.position.rr_planned===2&&near(b.position.r_result,1.99),b?.position);
check('build: buy TP – spread a slippage',b&&b.position.spread_entry===8&&b.position.slippage_points===2,b?.position);
check('build: buy TP – tagy z komentáře',b&&b.position.tags==='breakout,london',b?.position.tags);
check('build: buy TP – časová osa open/close',b&&b.changes.map(c=>c.kind).join()==='open,close',b?.changes);
b=one(S.sellSl);
check('build: sell SL',b&&b.position.side==='sell'&&b.position.net===-250&&b.position.close_reason==='sl'&&b.position.r_result===-1,b?.position);
b=one(S.trailing);
check('build: trailing – 3× SL a 1× TP v ose',b&&b.changes.map(c=>c.kind).join()==='open,sl,sl,sl,tp,close',b?.changes.map(c=>c.kind));
check('build: trailing – počáteční a poslední SL/TP',b&&b.position.sl_initial===1.095&&b.position.sl_last===1.102&&b.position.tp_initial===null&&b.position.tp_last===1.12,b?.position);
check('build: trailing – hodnoty v ose',b&&b.changes[1].old_value===1.095&&b.changes[1].new_value===1.098&&b.changes[4].old_value===null&&b.changes[4].new_value===1.12,b?.changes);
b=one(S.partial);
check('build: částečné uzavření',b&&b.changes.map(c=>c.kind).join()==='open,partial_close,close'&&b.position.volume_max===2&&near(b.position.close_price_avg,1.1075)&&b.position.net===1500,b?.position);
b=one(S.scaleIn);
check('build: přidání – vážený vstup a add',b&&near(b.position.open_price,1.15)&&b.position.volume_max===2&&b.changes[1].kind==='add',b?.position);
const rev=buildPositions('acc1',S.reversal);
check('build: inout – dvě pozice',rev.length===2&&rev[0].position.ticket==='600'&&rev[0].position.status==='closed'&&rev[1].position.ticket==='600:r1'&&rev[1].position.side==='sell'&&rev[1].position.volume_max===1&&rev[1].position.status==='closed',rev.map(r=>r.position));
check('build: inout – peníze dealu otočení patří zavírané části',rev[0].position.net===500&&rev[1].position.net===500,rev.map(r=>r.position.net));
b=one(S.mt4Chain);
check('build: MT4 řetězec – vstupy ve stejném čase se slučují (bez add)',b&&b.position.volume_max===1&&b.changes.map(c=>c.kind).join()==='open,partial_close,close'&&b.changes[0].volume===1,b?.changes);
b=one(S.states);
check('build: MFE/MAE ze stavů',b&&b.position.mfe_money===50&&b.position.mfe_price===1.1005&&b.position.mae_money===-25&&b.position.mae_price===1.09975,b?.position);
check('build: mezera > 10 min → mfe_partial',b&&b.position.mfe_partial===1,b?.position.mfe_partial);
check('build: bez SL → bez rizika a R',b&&b.position.risk_money===null&&b.position.r_result===null&&b.position.rr_planned===null,b?.position);
check('build: bez mezery → mfe_partial 0',one([S.deal(30,S.T0,{position:'31',side:'buy',entry:'in',volume:1,price:1}),S.state(31,S.T0+120_000,{}),S.deal(32,S.T0+240_000,{position:'31',side:'sell',entry:'out',volume:1,price:1})])?.position.mfe_partial===0);
b=one(S.lateSl);
check('build: SL do 10 s po vstupu = počáteční',b&&b.position.sl_initial===1.099&&b.position.risk_money===100&&b.position.risk_pct===2,b?.position);
check('build: SL po 10 s není počáteční',one([S.deal(40,S.T0,{position:'41',side:'buy',entry:'in',volume:1,price:1.1}),S.mod(41,S.T0+20_000,{slNew:1.09})])?.position.sl_initial===null);
const shuffled=[...S.trailing].reverse(),dup=[...S.trailing,S.trailing[2],S.trailing[0]];
check('build: přeházené a duplicitní události → stejný výsledek',JSON.stringify(buildPositions('acc1',shuffled))===JSON.stringify(buildPositions('acc1',S.trailing))&&JSON.stringify(buildPositions('acc1',dup))===JSON.stringify(buildPositions('acc1',S.trailing)));
const open=one([S.deal(50,S.T0,{position:'51',side:'buy',entry:'in',volume:1,price:1.1})]);
check('build: jen vstup → otevřená pozice',open&&open.position.status==='open'&&open.position.close_ts===null&&open.position.net===0,open?.position);
check('build: výstup bez vstupu → nic',buildPositions('acc1',[S.deal(60,S.T0,{position:'61',side:'sell',entry:'out',volume:1,price:1})]).length===0);
check('build: balance deal se ignoruje',buildPositions('acc1',[S.deal(70,S.T0,{position:'0',symbol:'',dealType:'balance',entry:'in',volume:0,price:0,profit:5000})]).length===0);
check('tagy: unikátní, malá písmena, diakritika, min. 2 znaky',JSON.stringify(extractTags('#Breakout #breakout #Průraz #a x'))==='["breakout","průraz"]',extractTags('#Breakout #breakout #Průraz #a x'));

// --- skládání pozic: oprava kolo 1
const kinds=(x)=>x?.changes.map(c=>c.kind).join();
b=one(S.sameTsIdOrder);
check('build: stejný ts, id d:9 / d:10 → uzavřená',b&&b.position.status==='closed'&&kinds(b)==='open,close',b);
b=one(S.mt4Ids);
check('build: stejný ts, d4:1000:in / d4:999:out → open,close',b&&b.position.status==='closed'&&kinds(b)==='open,close',b);
b=one(S.mt4Earlier);
check('build: in dřív než out s id d:999:out / d:1000:in',b&&b.position.status==='closed'&&kinds(b)==='open,close',b);
const ro=buildPositions('acc1',S.reopen);
check('build: znovuotevření po uzavření → unikátní id',ro.length===2&&ro[0].position.id==='acc1:5'&&ro[1].position.id==='acc1:5:r1'&&ro.every(x=>x.position.status==='closed'),ro.map(x=>x.position.id));
b=one(S.outBy);
check('build: out_by zavírá pozici',b&&b.position.status==='closed'&&b.position.close_reason==='client',b?.position);
b=one(S.slWrongSide);
check('build: SL na ziskové straně → bez rizika, R a R:R',b&&b.position.sl_initial===1.2&&b.position.risk_money===null&&b.position.risk_pct===null&&b.position.r_result===null&&b.position.rr_planned===null,b?.position);
b=one(S.beSl);
check('build: SL na vstupní ceně → bez rizika',b&&b.position.sl_initial===1.1&&b.position.risk_money===null&&b.position.r_result===null,b?.position);
b=one(S.partialAdd);
check('build: partial, add, close',b&&kinds(b)==='open,partial_close,add,close'&&b.position.volume_max===3&&b.position.status==='closed',b);

// --- oprava kolo 2: position_state, posun hodin
check('protokol: position_state bez openTs projde a zůstane position_state',(()=>{const st={id:'p:5001:1791370120000',type:'position_state',ts:1791370120000,position:'5001',symbol:'EURUSD',side:'buy',volume:0,priceOpen:0,priceCurrent:0,sl:1.095,tp:0,profit:0,swap:0,mfePrice:1.1005,maePrice:1.0997,mfeMoney:50,maeMoney:-25,spread:8};const r=parseBatch({v:1,account,events:[st]});return r.ok&&r.batch.events[0].type==='position_state'&&r.batch.events[0].mfeMoney===50})());
b=one([S.mod(81,S.T0-3000,{slNew:1.099}),S.deal(80,S.T0,{position:'81',side:'buy',entry:'in',volume:1,price:1.1,tickSize:0.00001,tickValue:1,balance:10000})]);
check('build: modify 3 s před vstupem (posun hodin) → počáteční SL',b&&b.position.sl_initial===1.099&&kinds(b)==='open,sl'&&b.changes[1].ts===S.T0,b);
check('build: modify 30 s před vstupem se zahodí',one([S.mod(83,S.T0-30000,{slNew:1.099}),S.deal(82,S.T0,{position:'83',side:'buy',entry:'in',volume:1,price:1.1})])?.position.sl_last===null);

// --- měny
const rates=makeRates([{date:'2026-10-01',currency:'USD',per_eur:1.10},{date:'2026-10-06',currency:'USD',per_eur:1.20},{date:'2026-10-06',currency:'CZK',per_eur:24},{date:'2026-10-01',currency:'CZK',per_eur:25}]);
check('fx: EUR = 1',rateOn(rates,'EUR','2026-10-05')===1);
check('fx: poslední kurz ≤ datum',rateOn(rates,'USD','2026-10-05')===1.10&&rateOn(rates,'USD','2026-10-07')===1.20);
check('fx: datum před prvním kurzem → první dostupný',rateOn(rates,'USD','2020-01-01')===1.10);
check('fx: neznámá měna → null',rateOn(rates,'XYZ','2026-10-06')===null);
check('fx: USD → CZK',convert(120,'USD','CZK','2026-10-06',rates)===2400);
check('fx: stejná měna beze změny',convert(-12.345,'USD','USD','2026-10-06',rates)===-12.345);
check('fx: neznámá → null',convert(10,'XYZ','USD','2026-10-06',rates)===null);
check('fx: centový účet USC → USD',convert(500,'USC','USD','2026-10-06',rates)===5);
check('fx: centový účet USC → CZK',convert(500,'USC','CZK','2026-10-06',rates)===100);
// --- MT obchody v kalendáři
const late=Date.UTC(2026,9,6,22,30);   // 6. 10. 22:30 UTC = 7. 10. 00:30 v Praze
check('kalendář: den uzavření podle Prahy',pragueDate(late)==='2026-10-07',pragueDate(late));
const mtRows=[{id:'acc1:100',ticket:'100',symbol:'EURUSD',net:120,close_ts:Date.UTC(2026,9,6,12),tags:'breakout',tags_manual:'',note:null,acc_currency:'USD',acc_name:'',acc_login:'87654321'},
 {id:'acc2:7',ticket:'7',symbol:'XAUUSD',net:500,close_ts:Date.UTC(2026,9,6,12),tags:'',tags_manual:'',note:'test',acc_currency:'XYZ',acc_name:'Cent',acc_login:'1'}];
const cal=mtTradesToCalendar(mtRows,'CZK',rates);
check('kalendář: převod do měny souhrnu',cal[0].pnl===2400&&cal[0].converted===true&&cal[0].net===120&&cal[0].accountCurrency==='USD'&&cal[0].source==='mt'&&cal[0].id==='mt:acc1:100',cal[0]);
check('kalendář: štítek účtu bez názvu = poslední 4 číslice',cal[0].account==='••••4321',cal[0].account);
check('kalendář: neznámá měna → původní hodnota, converted false',cal[1].pnl===500&&cal[1].converted===false&&cal[1].account==='Cent',cal[1]);
check('kalendář: centový účet USC → CZK (souhrn)',(()=>{const c=mtTradesToCalendar([{...mtRows[0],id:'acc3:1',net:500,acc_currency:'USC'}],'CZK',rates)[0];return c.pnl===100&&c.converted===true})(),mtTradesToCalendar([{...mtRows[0],net:500,acc_currency:'USC'}],'CZK',rates)[0]);
check('kalendář: poznámka = tagy + note',cal[0].note==='#breakout'&&cal[1].note==='test',[cal[0].note,cal[1].note]);

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
