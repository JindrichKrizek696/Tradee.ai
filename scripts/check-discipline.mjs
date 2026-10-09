// Kontrola pravidel disciplíny: node --experimental-strip-types scripts/check-discipline.mjs
import {RULES,normalizeSettings,evaluate,currenciesOf} from '../lib/discipline/rules.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const M=60000,H=3600000,T0=Date.UTC(2026,9,9,8,0,0);
let seq=0;
const tr=(o={})=>({id:'t'+(++seq),accountId:'a1',side:'buy',status:'closed',openTs:T0,closeTs:T0+H,openPrice:1.1,slInitial:1.09,tpInitial:null,riskPct:0.5,net:10,closeReason:'sl',balanceStart:10000,slChanges:[],currencies:['EUR','USD'],...o});
const S=normalizeSettings({});
const on=(...ids)=>{const s=normalizeSettings({});for(const r of RULES)s[r.id]={...s[r.id],on:ids.includes(r.id)};return s};
const ev=(t,day,s=S,news=[])=>evaluate(t,day??[t],s,news);
const has=(v,id)=>v.find(x=>x.rule===id);
// RULES
check('RULES: výchozí hodnoty',JSON.stringify(RULES.map(r=>[r.id,r.def.on,r.def.value,r.min??null,r.max??null,r.needsReason]))===JSON.stringify([['sl_required',true,null,null,null,false],['max_risk',true,1,0.1,20,false],['max_trades_day',true,3,1,50,false],['stop_after_losses',true,2,1,20,false],['max_daily_loss',true,2,0.1,50,false],['no_early_close',true,null,null,null,true],['no_sl_widen',true,null,null,null,true],['no_news',false,null,null,null,false]]),RULES);
check('RULES: texty a jednotky',RULES.every(r=>r.label&&r.help)&&RULES.find(r=>r.id==='max_risk').unit==='%'&&RULES.find(r=>r.id==='max_trades_day').unit==='×'&&RULES.find(r=>r.id==='sl_required').unit===null);
// sl_required
check('sl_required: null ano',!!has(ev(tr({slInitial:null}),null,on('sl_required')),'sl_required')&&JSON.stringify(has(ev(tr({slInitial:null}),null,on('sl_required')),'sl_required').detail)==='{}');
check('sl_required: 1.1 ne',ev(tr({slInitial:1.1}),null,on('sl_required')).length===0);
// max_risk
check('max_risk: 1.0 ne',ev(tr({riskPct:1}),null,on('max_risk')).length===0);
const r1=ev(tr({riskPct:1.01}),null,on('max_risk'));
check('max_risk: 1.01 ano + detail',r1.length===1&&r1[0].detail.riskPct===1.01&&r1[0].detail.limit===1,r1);
check('max_risk: bez riskPct ne',ev(tr({riskPct:null}),null,on('max_risk')).length===0);
// max_trades_day
const d4=[0,1,2,3].map(i=>tr({openTs:T0+i*H,closeTs:null,status:'open'}));
check('max_trades_day: 3. ne',ev(d4[2],d4,on('max_trades_day')).length===0);
const v4=ev(d4[3],d4,on('max_trades_day'));
check('max_trades_day: 4. ano + detail',v4.length===1&&v4[0].detail.n===4&&v4[0].detail.limit===3,v4);
// stop_after_losses
const mk=(nets)=>{const d=nets.map((net,i)=>tr({openTs:T0+i*H,closeTs:T0+i*H+30*M,net}));const t=tr({openTs:T0+nets.length*H,closeTs:null,status:'open'});return [t,[...d,t]]};
let [t,d]=mk([-5,-5]);const sl1=ev(t,d,on('stop_after_losses'));
check('stop_after_losses: dvě ztráty pak obchod ano',sl1.length===1&&sl1[0].detail.losses===2&&sl1[0].detail.limit===2,sl1);
[t,d]=mk([-5,10,-5]);check('stop_after_losses: ztráta-zisk-ztráta ne',ev(t,d,on('stop_after_losses')).length===0);
[t,d]=mk([-5,0,-5]);check('stop_after_losses: nula řadu přeruší',ev(t,d,on('stop_after_losses')).length===0);
[t,d]=mk([10,-5,-5,-5]);check('stop_after_losses: 3 ztráty po zisku ano',ev(t,d,on('stop_after_losses'))[0]?.detail.losses===3);
{const a=tr({openTs:T0,closeTs:T0+10*M,net:-5}),b=tr({openTs:T0+H,closeTs:T0+3*H,net:-5}),c=tr({openTs:T0+2*H,closeTs:null,status:'open'});
 check('stop_after_losses: ztráta uzavřená až po vstupu t se nepočítá',ev(c,[a,b,c],on('stop_after_losses')).length===0);
 const b2=tr({openTs:T0+H,closeTs:T0+90*M,net:-5});check('stop_after_losses: pořadí podle closeTs',ev(c,[a,b2,c],on('stop_after_losses')).length===1)}
// max_daily_loss
{const lossTrade=(net)=>tr({openTs:T0,closeTs:T0+H,net});const t2=tr({openTs:T0+2*H,closeTs:null,status:'open'});
 const a=ev(t2,[lossTrade(-200),t2],on('max_daily_loss'));
 check('max_daily_loss: -200 z 10000 ano + detail',a.length===1&&a[0].detail.lossPct===2&&a[0].detail.limit===2,a);
 check('max_daily_loss: -199 ne',ev(t2,[lossTrade(-199),t2],on('max_daily_loss')).length===0);
 check('max_daily_loss: součet více obchodů',ev(t2,[lossTrade(-150),lossTrade(-50),t2],on('max_daily_loss')).length===1);
 const nb=tr({openTs:T0+2*H,closeTs:null,status:'open',balanceStart:null});
 check('max_daily_loss: bez balanceStart ne',ev(nb,[lossTrade(-500),nb],on('max_daily_loss')).length===0);
 const late=tr({openTs:T0,closeTs:T0+3*H,net:-500});
 check('max_daily_loss: ztráta uzavřená po vstupu se nepočítá',ev(t2,[late,t2],on('max_daily_loss')).length===0)}
// no_early_close
{const c1=ev(tr({closeReason:'client',slInitial:1.09}),null,on('no_early_close'));
 check('no_early_close: client se SL ano + needsReason',c1.length===1&&c1[0].needsReason===true&&c1[0].detail.closeReason==='client',c1);
 check('no_early_close: sl/tp/so ne',['sl','tp','so'].every(r=>ev(tr({closeReason:r}),null,on('no_early_close')).length===0));
 check('no_early_close: client bez SL i TP ne',ev(tr({closeReason:'client',slInitial:null,tpInitial:null}),null,on('no_early_close')).length===0);
 check('no_early_close: client jen s TP ano',ev(tr({closeReason:'client',slInitial:null,tpInitial:1.2}),null,on('no_early_close')).length===1);
 check('no_early_close: SL nastaven až změnou ano',ev(tr({closeReason:'client',slInitial:null,slChanges:[{ts:T0+5*M,old:null,new:1.09}]}),null,on('no_early_close')).length===1);
 check('no_early_close: otevřená pozice ne',ev(tr({status:'open',closeTs:null,closeReason:null}),null,on('no_early_close')).length===0)}
// no_sl_widen
{const w=(side,old,nw,extra={})=>ev(tr({side,slChanges:[{ts:T0+M,old:old,new:nw}],...extra}),null,on('no_sl_widen'));
 const b=w('buy',1.09,1.08);
 check('no_sl_widen: buy 1.09→1.08 ano + detail',b.length===1&&b[0].needsReason&&b[0].detail.from===1.09&&b[0].detail.to===1.08&&b[0].detail.ts===T0+M,b);
 check('no_sl_widen: buy 1.09→1.095 ne',w('buy',1.09,1.095).length===0);
 check('no_sl_widen: sell 1.12→1.13 ano',w('sell',1.12,1.13).length===1);
 check('no_sl_widen: sell 1.12→1.11 ne',w('sell',1.12,1.11).length===0);
 check('no_sl_widen: první nastavení (old null) ne',w('buy',null,1.08).length===0&&w('buy',1.09,null).length===0);
 const f=ev(tr({side:'buy',slChanges:[{ts:1,old:1.09,new:1.1},{ts:2,old:1.1,new:1.05},{ts:3,old:1.05,new:1.0}]}),null,on('no_sl_widen'));
 check('no_sl_widen: vrací první rozšíření',f.length===1&&f[0].detail.ts===2,f)}
// no_news
{const open=T0+10*H;const t3=tr({openTs:open,currencies:['EUR','USD']});
 const nw=(off,cur)=>[{at:open-off,currencies:cur}];
 const a=ev(t3,[t3],on('no_news'),nw(14*M,['USD']));
 check('no_news: USD 14 min před ano + detail',a.length===1&&a[0].detail.at===open-14*M,a);
 check('no_news: 16 min před ne',ev(t3,[t3],on('no_news'),nw(16*M,['USD'])).length===0);
 check('no_news: přesně 15 min ano',ev(t3,[t3],on('no_news'),nw(15*M,['USD'])).length===1);
 check('no_news: 10 min po ano',ev(t3,[t3],on('no_news'),nw(-10*M,['EUR'])).length===1);
 check('no_news: GBP ne',ev(t3,[t3],on('no_news'),nw(5*M,['GBP'])).length===0);
 check('no_news: instrument bez měn ne',ev(tr({openTs:open,currencies:[]}),null,on('no_news'),nw(5*M,['USD'])).length===0)}
// vypnutá pravidla
{const bad=tr({slInitial:null,riskPct:9,closeReason:'client',slChanges:[{ts:1,old:1.09,new:1.05}]});
 check('vypnutá pravidla nevrací nic',ev(bad,[bad],on(),[{at:bad.openTs,currencies:['USD']}]).length===0);
 check('výchozí nastavení najde víc porušení',ev(bad,[bad]).map(v=>v.rule).join()==='sl_required,max_risk,no_early_close,no_sl_widen')}
// normalizeSettings
{const d=normalizeSettings(undefined);
 check('normalize: výchozí z ničeho',d.max_risk.on===true&&d.max_risk.value===1&&d.no_news.on===false&&d.sl_required.value===null&&Object.keys(d).length===8,d);
 const n=normalizeSettings({max_risk:{on:false,value:5},max_trades_day:{value:999},max_daily_loss:{value:0},stop_after_losses:{on:'ano',value:'x'},bogus:{on:true,value:1},sl_required:{on:false,value:7}});
 check('normalize: zachová platné, ořízne meze',n.max_risk.on===false&&n.max_risk.value===5&&n.max_trades_day.value===50&&n.max_trades_day.on===true&&n.max_daily_loss.value===0.1,n);
 check('normalize: nesmysl → výchozí',n.stop_after_losses.on===true&&n.stop_after_losses.value===2,n.stop_after_losses);
 check('normalize: neznámý klíč pryč, value u pravidla bez hodnoty null',!('bogus' in n)&&n.sl_required.on===false&&n.sl_required.value===null,n);
 check('normalize: nesmyslný vstup',JSON.stringify(normalizeSettings('x'))===JSON.stringify(d)&&JSON.stringify(normalizeSettings([1]))===JSON.stringify(d)&&normalizeSettings({max_risk:{value:NaN}}).max_risk.value===1&&normalizeSettings({max_risk:null}).max_risk.value===1)}
// currenciesOf
check('currenciesOf: FX',JSON.stringify(currenciesOf('EURUSD'))==='["EUR","USD"]'&&JSON.stringify(currenciesOf('EURUSD.m'))==='["EUR","USD"]'&&JSON.stringify(currenciesOf('#GBPJPY'))==='["GBP","JPY"]'&&JSON.stringify(currenciesOf('eurusd-ecn'))==='["EUR","USD"]');
check('currenciesOf: XAUUSD',JSON.stringify(currenciesOf('XAUUSD'))==='["XAU","USD"]');
check('currenciesOf: ostatní prázdné',currenciesOf('US500').length===0&&currenciesOf('').length===0&&currenciesOf('BTCUSDT').length===0&&currenciesOf('AAPL').length===0);

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
