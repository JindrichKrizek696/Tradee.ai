// Kontrola MetaTrader synchronizace: node --experimental-strip-types scripts/check-mt.mjs
import {isKeyFormat,hashKey,generateKey} from '../lib/mt/keys.ts';
import {parseBatch,snapshotEvents,MAX_EVENTS} from '../lib/mt/protocol.ts';
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

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
