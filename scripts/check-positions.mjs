// Kontrola otevřených pozic: node --experimental-strip-types scripts/check-positions.mjs
import {levelBar,isStale,rMultiple,summarize,currentRisk,slInProfit,riskSummary,maxPositionRisk} from '../lib/positions/open.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
let b=levelBar('buy',1.10,1.11,1.09,1.12);
check('pruh buy',eq(b,{sl:0,tp:100,entry:33.33,price:66.67}),b);
b=levelBar('sell',1.10,1.09,1.12,1.08);
check('pruh sell: SL vlevo, TP vpravo',eq(b,{sl:0,tp:100,entry:50,price:75}),b);
b=levelBar('buy',1.10,1.11,null,null);
check('pruh bez SL/TP',eq(b,{sl:null,tp:null,entry:0,price:100}),b);
check('pruh: vstup = cena bez SL/TP → null',levelBar('buy',1.10,1.10,null,null)===null&&levelBar('sell',1.10,null,null,null)===null);
b=levelBar('sell',1.10,1.11,null,null);
check('pruh sell bez SL/TP: ztráta vlevo',eq(b,{sl:null,tp:null,entry:100,price:0}),b);
const now=Date.UTC(2026,9,9,12);
check('isStale',!isStale(now-9*60_000,now)&&isStale(now-11*60_000,now)&&isStale(null,now));
check('rMultiple',rMultiple(100,50)===2&&rMultiple(100,null)===null&&rMultiple(100,0)===null&&rMultiple(null,50)===null&&rMultiple(-25,50)===-0.5&&rMultiple(10,30)===0.33);
const P=(o)=>({id:'a:1',accountId:'a',account:'A',symbol:'EURUSD',instrument:'EUR/USD',side:'buy',volume:1,openPrice:1.1,price:1.11,sl:1.09,tp:null,profit:0,accountCurrency:'USD',pnl:0,converted:true,riskMoney:null,risk:null,slInProfit:false,r:null,openTs:0,updated:now,stale:false,...o});
let s=summarize([P({pnl:100,riskMoney:50}),P({pnl:-30,riskMoney:20,sl:null}),P({pnl:null,sl:null})]);
check('summarize',eq(s,{count:3,pnl:70,converted:true,risk:70,noSl:2}),s);
s=summarize([P({pnl:100}),P({pnl:50,converted:false})]);
check('summarize: nepřevedená jen označí',eq(s,{count:2,pnl:100,converted:false,risk:0,noSl:0}),s);
s=summarize([]);
check('summarize prázdné',eq(s,{count:0,pnl:0,converted:true,risk:0,noSl:0}),s);
// aktuální riziko
const R=(o)=>currentRisk({side:'buy',open:1.1,sl:1.09,volume:2,tickSize:0.00001,tickValue:1,...o});
check('riziko buy: |open−sl|/tick×tickValue×objem',R({})===2000,R({}));
check('riziko sell',R({side:'sell',sl:1.11})===2000,R({side:'sell',sl:1.11}));
check('riziko bez SL = null',R({sl:null})===null);
check('riziko SL v zisku (buy) = 0',R({sl:1.105})===0&&R({sl:1.1})===0);
check('riziko SL v zisku (sell) = 0',R({side:'sell',sl:1.095})===0&&R({side:'sell',sl:1.1})===0);
check('slInProfit',slInProfit('buy',1.1,1.1)&&!slInProfit('buy',1.1,1.09)&&!slInProfit('sell',1.1,null));
check('riziko po částečném zavření (menší objem)',R({volume:1})===1000);
check('fallback: škáluje počáteční riziko',currentRisk({side:'buy',open:1.1,sl:1.095,volume:1,riskInitial:2000,slInitial:1.09,volumeMax:2})===500,currentRisk({side:'buy',open:1.1,sl:1.095,volume:1,riskInitial:2000,slInitial:1.09,volumeMax:2}));
check('fallback bez dat = null',currentRisk({side:'buy',open:1.1,sl:1.09,volume:1})===null);
// souhrn po účtech
{const list=[P({id:'a:1',accountId:'a',risk:300,riskMoney:300,profit:50,pnl:50}),P({id:'a:2',accountId:'a',sl:null,risk:null,riskMoney:null,profit:-10,pnl:-10}),P({id:'b:1',accountId:'b',risk:100,riskMoney:110,slInProfit:true,profit:5,pnl:5.5,symbol:'GBPUSD'})];
 const acc=[{id:'a',name:'A',currency:'USD',equity:10000,equityConv:10000},{id:'b',name:'B',currency:'EUR',equity:5000,equityConv:5500},{id:'c',name:'C',currency:'USD',equity:null,equityConv:null}];
 const r=riskSummary(list,acc);
 check('riskSummary účet A',r.accounts[0].risk===300&&r.accounts[0].riskPct===3&&r.accounts[0].count===2&&r.accounts[0].noSl===1&&r.accounts[0].floating===40,r.accounts[0]);
 check('riskSummary prázdný účet zůstane',r.accounts.length===3&&r.accounts[2].count===0&&r.accounts[2].riskPct===null,r.accounts[2]);
 check('riskSummary celkem',eq(r.total,{equity:15500,risk:410,riskPct:2.65,count:3,noSl:1,slInProfit:1,floating:45.5}),r.total);
 check('maxPosition',r.maxPosition.id==='a:1'&&r.maxPosition.riskPct===3,r.maxPosition);
 check('maxPosition bez pozic = null',maxPositionRisk([],()=>1000)===null)}
if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
