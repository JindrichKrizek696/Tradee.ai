// Replay: simulace exekuce nad historickými svíčkami (bid) – market / limit / stop, SL a TP, spread (ask = bid + spread),
// komise, skluz, swap za noc, pravidla gapu a nejednoznačná svíčka (SL i TP v jedné svíčce). Navíc prop simulátor:
// denní ztráta a drawdown (statický / trailing) podle pravidel profilu účtu – porušení ukončí seanci.
// Engine je deterministický: stejný záznam událostí + stejné svíčky = stejný výsledek (klient ukazuje průběh, server přepočítá při uložení).
// Čisté funkce – testy scripts/check-replay.mjs.
import type {Bar} from '../bars/yahoo.ts';
import {TF_MS,type BaseTf} from './clock.ts';
import {tradingDay,type Rules} from '../risk/account.ts';
export type Side='long'|'short';
export type OrderType='market'|'limit'|'stop';
export type Ambiguity='conservative'|'optimistic';
/** Specifikace trhu v replayi (snímek z registru instrumentů při založení seance). spread a komise jsou už finální. */
export type ReplaySpec={symbol:string;instrumentId:string;name?:string;unit?:'lot'|'kontrakt'|'ks';pip?:number|null;tickSize:number;tickValue:number;quote:string;base:string|null;lotStep:number;minLot:number;
 /** spread v ceně (ask = bid + spread) */spread:number;
 /** komise za lot tam i zpět v měně kotace */commission:number;
 /** kurz měna kotace → měna účtu (pevný z doby založení; přesný 1/cena, když je základní měna páru měnou účtu) */rate:number};
export type ExecConfig={slippageTicks:number;swap:{on:boolean;long:number;short:number;tripleWed:boolean};ambiguity:Ambiguity};
export type Account={currency:string;balance:number;rules:Rules|null};
export type OrderData={id:string;symbol:string;side:Side;type:OrderType;price:number|null;qty:number;sl:number|null;tp:number|null;decisionId?:string|null;plannedRisk?:number|null};
export type DecisionData={id:string;symbol:string;choice:'long'|'short'|'none';note:string;snapshot?:unknown};
export type EventKind='order'|'cancel'|'modify'|'close'|'decision'|'rewind'|'reset'|'note';
export type ReplayEvent={seq:number;clock:number;kind:EventKind;data:Record<string,unknown>;void?:boolean};
export type OrderState=OrderData&{status:'pending'|'filled'|'cancelled'|'rejected';placedAt:number;filledAt:number|null;fillPrice:number|null;reason:string|null};
export type ExitReason='sl'|'tp'|'manual'|'breach'|'open';
export type Trade={id:string;orderId:string;symbol:string;side:Side;qty:number;entryTs:number;entry:number;exitTs:number;exit:number;reason:ExitReason;sl:number|null;tp:number|null;
 gross:number;commission:number;swap:number;spreadCost:number;slippageCost:number;net:number;plannedRisk:number|null;r:number|null;ambiguous:boolean;gap:boolean;nights:number;decisionId:string|null};
type Pos={orderId:string;symbol:string;side:Side;qty:number;entryTs:number;entry:number;sl:number|null;tp:number|null;
 /** vstup uvnitř svíčky (limit/stop) – pořadí dotyků v téže svíčce neznáme */entryBar:number|null;entryType:OrderType;closeReq:boolean;ambiguous:boolean;gap:boolean;slipPrice:number;plannedRisk:number|null;decisionId:string|null};
export type PropState={daily:{limit:number;used:number;remaining:number}|null;drawdown:{limit:number;floor:number;peak:number;remaining:number}|null;target:{amount:number;progress:number;done:boolean}|null};
export type Breach={reason:'daily'|'drawdown';ts:number;value:number;limit:number};
export type EquityPoint={ts:number;balance:number;equity:number;worst:number};
export type RunResult={orders:OrderState[];open:(Pos&{unrealized:number})[];trades:Trade[];balance:number;equity:number;points:EquityPoint[];breach:Breach|null;prop:PropState|null;lastPrice:Record<string,number>};
const r2=(n:number)=>Math.round(n*100)/100;
const fin=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const dirOf=(s:Side)=>s==='long'?1:-1;
/** Kurz pro přepočet zisku: když je základní měna páru měnou účtu, přesně 1/cena výstupu; jinak pevný kurz specifikace. */
export const rateAt=(spec:ReplaySpec,price:number,accountCcy:string)=>spec.quote===accountCcy?1:spec.base===accountCcy&&price>0?1/price:spec.rate;
/** Peníze za pohyb ceny o `dist` při objemu qty (v měně účtu). */
export const moneyFor=(spec:ReplaySpec,dist:number,qty:number,rate:number)=>dist/spec.tickSize*spec.tickValue*qty*rate;
// ---- swap: přechod přes rollover 21:00 UTC (≈ 17:00 New York) v pracovní dny; ve středu volitelně trojnásobek (víkend)
export const ROLLOVER_UTC_H=21;
export function nightsBetween(a:number,b:number,tripleWed:boolean):number{
 let n=0;const D=86400000;
 for(let d=Math.floor(a/D)*D;d<=b;d+=D){const r=d+ROLLOVER_UTC_H*3600000;if(r<=a||r>b)continue;const wd=new Date(r).getUTCDay();if(wd===0||wd===6)continue;n+=tripleWed&&wd===3?3:1}
 return n;
}
// ---- prop simulátor (inkrementálně, stejné významy jako lib/risk/account.ts accountStatus)
export class PropTracker{
 rules:Rules;start:number;day='';dsBal:number;peak:number;lastVal:number;prevBal:number;breach:Breach|null=null;state:PropState|null=null;
 constructor(rules:Rules,start:number){this.rules=rules;this.start=start;this.dsBal=start;this.peak=start;this.lastVal=start;this.prevBal=start}
 get active(){const R=this.rules;return R.dailyLoss.type!=='none'&&R.dailyLoss.value>0||R.drawdown.type!=='none'&&R.drawdown.value>0||R.profitTarget.type!=='none'&&R.profitTarget.value>0}
 /** bod: čas, zůstatek, equity na konci svíčky a nejhorší equity uvnitř svíčky */
 point(ts:number,balance:number,equity:number,worst:number):Breach|null{
  if(this.breach)return this.breach;
  const R=this.rules,dl=R.dailyLoss,dd=R.drawdown,day=tradingDay(ts,dl.reset,dl.tz);
  if(day!==this.day){
   if(this.day&&dd.type==='trailing'&&dd.when==='eod')this.peak=Math.max(this.peak,this.lastVal);
   this.dsBal=this.day?this.prevBal:this.start;this.day=day;
  }
  let daily:PropState['daily']=null,drawdown:PropState['drawdown']=null,target:PropState['target']=null;
  if(dl.type!=='none'&&dl.value>0){
   const limit=dl.type==='amount'?dl.value:(dl.base==='initial'?this.start:this.dsBal)*dl.value/100,cur=dl.ref==='equity'?worst:balance,used=r2(this.dsBal-cur);
   daily={limit:r2(limit),used,remaining:r2(limit-used)};
   if(daily.remaining<=0)this.breach={reason:'daily',ts,value:r2(cur),limit:r2(limit)};
  }
  if(dd.type!=='none'&&dd.value>0){
   const limit=dd.mode==='amount'?dd.value:this.start*dd.value/100,cur=dd.ref==='equity'?worst:balance,refClose=dd.ref==='equity'?equity:balance;
   if(dd.type==='trailing'&&dd.when==='intraday')this.peak=Math.max(this.peak,refClose);
   let floor=dd.type==='static'?this.start-limit:this.peak-limit;if(dd.type==='trailing'&&dd.lockAtStart)floor=Math.min(floor,this.start);
   drawdown={limit:r2(limit),floor:r2(floor),peak:r2(dd.type==='static'?this.start:this.peak),remaining:r2(cur-floor)};
   if(drawdown.remaining<=0&&!this.breach)this.breach={reason:'drawdown',ts,value:r2(cur),limit:r2(limit)};
   this.lastVal=refClose;
  }
  if(R.profitTarget.type!=='none'&&R.profitTarget.value>0){const amount=R.profitTarget.type==='amount'?R.profitTarget.value:this.start*R.profitTarget.value/100,progress=r2(balance-this.start);target={amount:r2(amount),progress,done:progress>=amount}}
  this.prevBal=balance;this.state={daily,drawdown,target};
  return this.breach;
 }
}
// ---- vyplnění příkazů a výstupy v jedné svíčce
export type Fill={price:number;atOpen:boolean;gap:boolean;slip:number};
/** Vyplnění čekajícího příkazu ve svíčce (bid OHLC); null = nevyplněno. Market se vyplní na otevření další svíčky. */
export function tryFill(o:{side:Side;type:OrderType;price:number|null},b:Bar,spread:number,slip:number):Fill|null{
 const askO=b.o+spread,askH=b.h+spread,askL=b.l+spread;
 if(o.type==='market')return o.side==='long'?{price:askO+slip,atOpen:true,gap:false,slip}:{price:b.o-slip,atOpen:true,gap:false,slip};
 const P=o.price as number;
 if(o.type==='limit'){
  if(o.side==='long'){if(askL>P)return null;return askO<=P?{price:askO,atOpen:true,gap:askO<P,slip:0}:{price:P,atOpen:false,gap:false,slip:0}}
  if(b.h<P)return null;return b.o>=P?{price:b.o,atOpen:true,gap:b.o>P,slip:0}:{price:P,atOpen:false,gap:false,slip:0};
 }
 // stop: gap přes úroveň → vyplnění na otevření (horší cena) + skluz
 if(o.side==='long'){if(askH<P)return null;return askO>=P?{price:askO+slip,atOpen:true,gap:askO>P,slip}:{price:P+slip,atOpen:false,gap:false,slip}}
 if(b.l>P)return null;return b.o<=P?{price:b.o-slip,atOpen:true,gap:b.o<P,slip}:{price:P-slip,atOpen:false,gap:false,slip};
}
export type Exit={price:number;reason:'sl'|'tp';gap:boolean;ambiguous:boolean;slip:number}|{price:null;ambiguous:boolean};
/** Výstup otevřené pozice ve svíčce. entryIntrabar = pozice vznikla uvnitř této svíčky limitem/stopem (pořadí dotyků neznáme). */
export function checkExit(p:{side:Side;sl:number|null;tp:number|null},b:Bar,spread:number,slip:number,policy:Ambiguity,entryIntrabar:OrderType|null):Exit{
 const long=p.side==='long',o=long?b.o:b.o+spread,hi=long?b.h:b.h+spread,lo=long?b.l:b.l+spread;
 const SL=p.sl,TP=p.tp;
 if(!entryIntrabar){
  // gap: svíčka otevřela za stopem → výstup na otevření (+ skluz); za cílem → na otevření (lepší cena, limit)
  if(SL!==null&&(long?o<=SL:o>=SL))return {price:long?o-slip:o+slip,reason:'sl',gap:true,ambiguous:false,slip};
  if(TP!==null&&(long?o>=TP:o<=TP))return {price:o,reason:'tp',gap:true,ambiguous:false,slip:0};
 }
 const slHit=SL!==null&&(long?lo<=SL:hi>=SL),tpHit=TP!==null&&(long?hi>=TP:lo<=TP);
 const sl:Exit={price:long?(SL as number)-slip:(SL as number)+slip,reason:'sl',gap:false,ambiguous:false,slip},tp:Exit={price:TP as number,reason:'tp',gap:false,ambiguous:false,slip:0};
 const amb=(e:Exit):Exit=>({...e,ambiguous:true});
 if(slHit&&tpHit)return policy==='conservative'?amb(sl):amb(tp);
 if(!entryIntrabar){if(slHit)return sl;if(tpHit)return tp;return {price:null,ambiguous:false}}
 // vstup uvnitř svíčky: limit → cena šla přes vstup směrem ke stopu (SL jistý, TP nejistý); stop → směrem k cíli (TP jistý, SL nejistý)
 if(slHit){if(entryIntrabar==='limit')return sl;return policy==='conservative'?amb(sl):{price:null,ambiguous:true}}
 if(tpHit){if(entryIntrabar==='stop')return tp;return policy==='optimistic'?amb(tp):{price:null,ambiguous:true}}
 return {price:null,ambiguous:false};
}
// ---- validace dat událostí (z klienta)
const SIDES=['long','short'],TYPES=['market','limit','stop'];
export function parseOrder(raw:unknown,specs:Record<string,ReplaySpec>,id:string):OrderData|string{
 const o=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 const symbol=String(o.symbol||''),spec=specs[symbol];if(!spec)return 'Neznámý trh.';
 if(!SIDES.includes(String(o.side)))return 'Vyber long nebo short.';
 if(!TYPES.includes(String(o.type)))return 'Neznámý typ příkazu.';
 const n=(v:unknown)=>v===null||v===undefined||v===''?null:Number(v);
 const side=o.side as Side,type=o.type as OrderType,price=type==='market'?null:n(o.price),qty=Number(o.qty),sl=n(o.sl),tp=n(o.tp);
 if(type!=='market'&&(!fin(price)||price<=0))return 'Zadej cenu limitu / stopu.';
 if(!fin(qty)||qty<=0||qty>1e6)return 'Objem musí být kladné číslo.';
 if(qty<spec.minLot-1e-12)return `Objem je pod minimem (${spec.minLot}).`;
 for(const [v,w] of [[sl,'Stop loss'],[tp,'Take profit']] as const)if(v!==null&&(!fin(v)||v<=0))return w+' musí být kladné číslo.';
 if(type!=='market'&&sl!==null&&(side==='long'?sl>=(price as number):sl<=(price as number)))return 'Stop loss musí být na ztrátové straně vstupu.';
 if(type!=='market'&&tp!==null&&(side==='long'?tp<=(price as number):tp>=(price as number)))return 'Take profit musí být na ziskové straně vstupu.';
 const pr=n(o.plannedRisk);
 return {id,symbol,side,type,price,qty,sl,tp,decisionId:typeof o.decisionId==='string'&&/^[\w-]{1,40}$/.test(o.decisionId)?o.decisionId:null,plannedRisk:pr!==null&&fin(pr)&&pr>0?r2(pr):null};
}
// ---- hlavní běh
export type RunInput={bars:Record<string,Bar[]>;base:BaseTf;events:ReplayEvent[];exec:ExecConfig;specs:Record<string,ReplaySpec>;account:Account;clock:number;start:number};
export function run(i:RunInput):RunResult{
 const ms=TF_MS[i.base],acc=i.account.currency;
 const evs=i.events.filter(e=>!e.void&&e.clock<=i.clock).sort((a,b)=>a.seq-b.seq);
 const timeline:{s:string;b:Bar}[]=[];
 for(const s of Object.keys(i.bars).sort())for(const b of i.bars[s])if(b.t>=i.start&&b.t+ms<=i.clock)timeline.push({s,b});
 timeline.sort((a,b)=>a.b.t-b.b.t||(a.s<b.s?-1:1));
 const orders:OrderState[]=[],pos:Pos[]=[],trades:Trade[]=[],points:EquityPoint[]=[],last:Record<string,number>={};
 for(const s of Object.keys(i.bars)){const pre=i.bars[s].filter(b=>b.t+ms<=i.start);if(pre.length)last[s]=pre[pre.length-1].c}
 const prop=i.account.rules?new PropTracker(i.account.rules,i.account.balance):null,useProp=!!prop?.active;
 let balance=i.account.balance,ei=0,breach:Breach|null=null;
 const slipOf=(s:string)=>i.exec.slippageTicks>0?i.exec.slippageTicks*i.specs[s].tickSize:0;
 const close=(p:Pos,price:number,ts:number,reason:ExitReason,extra:{gap?:boolean;ambiguous?:boolean;slip?:number}={})=>{
  const spec=i.specs[p.symbol],rate=rateAt(spec,price,acc),d=dirOf(p.side);
  const gross=r2(moneyFor(spec,(price-p.entry)*d,p.qty,rate)),commission=r2(spec.commission*p.qty*rate);
  const nights=i.exec.swap.on?nightsBetween(p.entryTs,ts,i.exec.swap.tripleWed):0,swap=r2(nights*(p.side==='long'?i.exec.swap.long:i.exec.swap.short)*p.qty);
  const net=r2(gross-commission+swap),spreadCost=r2(moneyFor(spec,spec.spread,p.qty,rate)),slippageCost=r2(moneyFor(spec,p.slipPrice+(extra.slip||0),p.qty,rate));
  const pr=p.plannedRisk&&p.plannedRisk>0?p.plannedRisk:null;
  trades.push({id:'t'+(trades.length+1),orderId:p.orderId,symbol:p.symbol,side:p.side,qty:p.qty,entryTs:p.entryTs,entry:p.entry,exitTs:ts,exit:price,reason,sl:p.sl,tp:p.tp,gross,commission,swap,spreadCost,slippageCost,net,plannedRisk:pr,r:pr?Math.round(net/pr*100)/100:null,ambiguous:p.ambiguous||!!extra.ambiguous,gap:p.gap||!!extra.gap,nights,decisionId:p.decisionId});
  balance=r2(balance+net);pos.splice(pos.indexOf(p),1);
 };
 const unreal=(p:Pos,price:number)=>{const spec=i.specs[p.symbol],ex=p.side==='long'?price:price+spec.spread;return moneyFor(spec,(ex-p.entry)*dirOf(p.side),p.qty,rateAt(spec,ex,acc))};
 const apply=(e:ReplayEvent)=>{
  const d=e.data;
  if(e.kind==='order'){const o=parseOrder(d,i.specs,String(d.id||'o'+e.seq));
   if(typeof o==='string'){orders.push({...(d as unknown as OrderData),id:String(d.id||'o'+e.seq),status:'rejected',placedAt:e.clock,filledAt:null,fillPrice:null,reason:o});return}
   orders.push({...o,status:'pending',placedAt:e.clock,filledAt:null,fillPrice:null,reason:null})}
  else if(e.kind==='cancel'){const o=orders.find(x=>x.id===d.orderId&&x.status==='pending');if(o){o.status='cancelled';o.reason='zrušeno'}}
  else if(e.kind==='modify'){
   const n=(v:unknown)=>v===null||v===''?null:Number(v);
   const o=orders.find(x=>x.id===d.orderId&&x.status==='pending'),p=pos.find(x=>x.orderId===d.orderId);
   for(const t of [o,p])if(t){if('sl' in d){const v=n(d.sl);if(v===null||fin(v)&&v>0)t.sl=v}if('tp' in d){const v=n(d.tp);if(v===null||fin(v)&&v>0)t.tp=v}}
  }
  else if(e.kind==='close'){const p=pos.find(x=>x.orderId===d.orderId);if(p)p.closeReq=true;else{const o=orders.find(x=>x.id===d.orderId&&x.status==='pending');if(o){o.status='cancelled';o.reason='zrušeno'}}}
 };
 for(const {s,b} of timeline){
  if(breach)break;
  while(ei<evs.length&&evs[ei].clock<=b.t)apply(evs[ei++]);
  const spec=i.specs[s];if(!spec){last[s]=b.c;continue}
  const slip=slipOf(s);
  // 1) ruční zavření na otevření svíčky
  for(const p of pos.filter(p=>p.symbol===s&&p.closeReq))close(p,p.side==='long'?b.o-slip:b.o+spec.spread+slip,b.t,'manual',{slip});
  // 2) čekající příkazy
  for(const o of orders.filter(o=>o.symbol===s&&o.status==='pending')){
   const f=tryFill(o,b,spec.spread,slip);if(!f)continue;
   o.status='filled';o.filledAt=b.t;o.fillPrice=f.price;
   const ref=o.type==='market'?f.price:(o.price as number),rate=rateAt(spec,ref,acc);
   const planned=o.plannedRisk??(o.sl!==null?r2(moneyFor(spec,Math.abs(ref-o.sl),o.qty,rate)):null);
   pos.push({orderId:o.id,symbol:s,side:o.side,qty:o.qty,entryTs:b.t,entry:f.price,sl:o.sl,tp:o.tp,entryBar:f.atOpen?null:b.t,entryType:o.type,closeReq:false,ambiguous:false,gap:f.gap,slipPrice:f.slip,plannedRisk:planned,decisionId:o.decisionId??null});
  }
  // 3) SL / TP
  for(const p of pos.filter(p=>p.symbol===s)){
   const x=checkExit(p,b,spec.spread,slip,i.exec.ambiguity,p.entryBar===b.t?p.entryType:null);
   if(x.ambiguous)p.ambiguous=true;
   if(x.price!==null)close(p,x.price,b.t,x.reason,{gap:x.gap,ambiguous:x.ambiguous,slip:x.slip});
  }
  last[s]=b.c;
  // 4) equity a prop pravidla (nejhorší equity uvnitř svíčky pro tento trh, ostatní na posledních cenách)
  let eq=balance,worst=balance;
  for(const p of pos){const lp=last[p.symbol];if(lp===undefined)continue;const u=unreal(p,lp);eq+=u;
   worst+=p.symbol===s?unreal(p,p.side==='long'?b.l:b.h):u}
  points.push({ts:b.t+ms,balance,equity:r2(eq),worst:r2(worst)});
  if(useProp&&prop){const br=prop.point(b.t+ms,balance,r2(eq),r2(worst));
   if(br){breach=br;for(const p of [...pos]){const lp=last[p.symbol]??p.entry;close(p,p.side==='long'?lp:lp+i.specs[p.symbol].spread,b.t,'breach')}
    for(const o of orders)if(o.status==='pending'){o.status='cancelled';o.reason='porušení pravidel'}}}
 }
 if(!breach)while(ei<evs.length)apply(evs[ei++]);
 const open=pos.map(p=>({...p,unrealized:r2(last[p.symbol]===undefined?0:unreal(p,last[p.symbol]))}));
 return {orders,open,trades,balance,equity:r2(balance+open.reduce((a,p)=>a+p.unrealized,0)),points,breach,prop:useProp?prop!.state:null,lastPrice:last};
}
