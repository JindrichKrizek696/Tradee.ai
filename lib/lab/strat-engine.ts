// Laboratoř · Strategie: obecný engine pravidlových strategií řízený definicí z DB (lib/lab/rules-def.ts). Čisté funkce,
// testy scripts/check-lab-strategies.mjs. Žádná konkrétní strategie v kódu – jen bloky (lib/lab/strat-blocks.ts) a mechanika obchodu.
//
// SIGNÁL: podmínky se vyhodnotí na zavření svíčky i (vyšší TF jen z uzavřených svíček, viz strat-blocks.ts). Strana long/short platí,
// když jsou splněné všechny 'required' podmínky; hodnocení = počet splněných 'optional'. Platí-li obě strany zároveň, signál se zahodí.
//
// PROVEDENÍ (na jednom místě):
//  • Limit: příkaz na úrovni podmínky, platí `validBars` svíček po signální. Open za úrovní = plnění za open (gap). Při plnění uvnitř
//    svíčky se v téže svíčce kontroluje jen SL (pořadí high/low neznáme – konzervativně), TP až od další; gap plnění kontroluje vše.
//  • Market-on-close: vstup za close signální svíčky, výstupy od další svíčky.
//  • Plnění = mid ± ½ výchozího spreadu backtestu (lib/backtest/rules.ts spreadPrice) × costs.spreadMult; R = (výstup − vstup)/(vstup − plnění SL)
//    → zásah původního SL = přesně −1 R na nohu; komise = costs.commissionR odečtená z R.
//  • Stop = úroveň (nebo vstup / signální svíčka) ∓ atrK × ATR ∓ pct % vzdálenosti vstup–úroveň, nejméně minAtrK × ATR.
//    Cíl = k R / protilehlý potvrzený swing / úroveň podmínky; R:R pod minRR → bez obchodu; překážka mezi vstupem a cílem blíž než
//    max(minRR, 1) R → bez obchodu.
//  • V jedné svíčce: gap přes SL/TP na open → výstup za open; SL i TP v rozsahu → SL (ambiguity 'conservative'; 'optimistic' = TP).
//    Částečný výstup pct % na TP1 (atR) a stop na BE platí od DALŠÍ svíčky; BE od +beAtR R také od další svíčky.
//  • Dvě (tři) nohy: riziko rozdělené podle share, společný stop; neplněná noha se zruší, když se pozice zavře nebo vyprší platnost.
//    Obě nohy na SL = −1 R celkem (strop rizika).
//  • Časový výstup: po N svíčkách na close; v daný místní čas = za open první svíčky od toho času. Konec dat = close poslední svíčky.
//  • Portfolio (jeden průchod časem přes všechny trhy, v každém čase: výstupy → plnění → zavření svíček): 1 pozice na trh, maxOpen,
//    max obchodů za den/týden (den podle filters.dayTz), stop-den po N ztrátách, denní/týdenní limit ztráty v R – ztráta se započte až
//    od chvíle, kdy byla známá (výstup uvnitř svíčky = konec svíčky). Vstupní okna seancí a zprávy se kontrolují v čase vstupu.
//  • In-sample / out-of-sample podle času vstupu: D1 IS 2015–2022, OOS od 2023 (data před 2015 jen na zahřátí); H1 posledních 30 % období.
//  • Hranice náhody: stejné vstupy (časy i ceny plnění), náhodný směr se zrcadleným stopem a cílem; medián nejlepšího OOS průměru R.
import {BLOCKS,DEFAULT_SESSIONS,defRuns,condLabel,type StrategyDef,type Condition,type Tf,type LevelKey,type SessionId,type SessionDef} from './rules-def.ts';
import * as B from './strat-blocks.ts';
import {spreadPrice,DEFAULT_RULES} from '../backtest/rules.ts';
import {MIN_OOS_TRADES,MIN_OOS_PF,IS_FROM,OOS_FROM,median} from './sweep-grid.ts';
import {zoned as zonedAt} from '../market-hours.ts';

export const STRAT_VERSION='strat-v1';
const DAY=B.DAY;
type Side=1|-1;

// ---- metriky (stejné jako Hledání prahů)
export type Seg={n:number;wins:number;sum:number;sum2:number;gw:number;gl:number;cum:number;peak:number;dd:number};
export const newSeg=():Seg=>({n:0,wins:0,sum:0,sum2:0,gw:0,gl:0,cum:0,peak:0,dd:0});
export function addSeg(s:Seg,r:number){s.n++;s.sum+=r;s.sum2+=r*r;if(r>0){s.wins++;s.gw+=r}else s.gl-=r;s.cum+=r;if(s.cum>s.peak)s.peak=s.cum;if(s.cum-s.peak<s.dd)s.dd=s.cum-s.peak}
export type SegMetrics={trades:number;winRate:number|null;avgR:number|null;totalR:number;pf:number|null;maxDd:number;expectancy:number|null};
const rd=(x:number,d=3)=>Math.round(x*10**d)/10**d;
export function segMetrics(s:Seg):SegMetrics{
 const n=s.n,avg=n?s.sum/n:null,wr=n?s.wins/n:null,avgWin=s.wins?s.gw/s.wins:0,avgLoss=n-s.wins?-s.gl/(n-s.wins):0;
 return {trades:n,winRate:wr===null?null:rd(wr*100,1),avgR:avg===null?null:rd(avg),totalR:rd(s.sum,2),pf:s.gl>0?rd(s.gw/s.gl):s.gw>0?99:null,maxDd:rd(s.dd,2),expectancy:wr===null?null:rd(wr*avgWin+(1-wr)*avgLoss)};
}
// rozptýlení malých seedů (1, 2, 3 …) a zahození prvního čísla – sousední seedy jinak dávají podobný začátek
export function seeded(seed:number){const r=mulberry32(Math.imul(seed^0x9E3779B9,2654435761)>>>0);r();return r}
export function mulberry32(seed:number){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}}

// ---- data
export type Ctx={cot?:B.CotSrc|null;news?:B.NewsFn|null;dxy?:B.Bar[]|null;extra?:Record<string,B.Bar[]|undefined>;d1?:Record<string,B.Bar[]|undefined>};
export type MarketIn={id:string;bars:B.Bar[]};
type TfData={s:B.Series;done:Int32Array};
export type PM={id:string;data:StrategyDef['data'];E:B.Series;tfs:Map<Tf,TfData>;cache:Map<string,B.Out>;hs:number};
export function prepare(id:string,raw:B.Bar[],data:StrategyDef['data']):PM{
 const bars=raw.filter(b=>b.o>0&&b.h>0&&b.l>0&&b.c>0).sort((a,b)=>a.t-b.t);
 const E=B.series(bars,data),tfs=new Map<Tf,TfData>(),id0=new Int32Array(bars.length).map((_,i)=>i);
 tfs.set(data,{s:E,done:id0});
 return {id,data,E,tfs,cache:new Map(),hs:bars.length?spreadPrice(id,bars[bars.length-1].c,DEFAULT_RULES)/2:0};
}
function tfData(pm:PM,tf:Tf):TfData{
 let x=pm.tfs.get(tf);if(x)return x;
 const base=Array.from({length:pm.E.n},(_,i)=>({t:pm.E.t[i],o:pm.E.o[i],h:pm.E.h[i],l:pm.E.l[i],c:pm.E.c[i]}));
 const a=B.aggregate(base,B.TF_MS[pm.data],B.tfKey(tf,pm.data));x={s:B.series(a.bars,tf),done:a.done};pm.tfs.set(tf,x);return x;
}
function mapOut(o:B.Out,done:Int32Array):B.Out{
 const n=done.length,keys=Object.keys(o.lvL),m=B.newOut(n,keys);if(o.unknown)m.unknown=new Uint8Array(n);
 for(let i=0;i<n;i++){const k=done[i];if(k<0){if(m.unknown)m.unknown[i]=1;continue}
  m.L[i]=o.L[k];m.S[i]=o.S[k];if(m.unknown)m.unknown[i]=o.unknown![k];
  for(const key of keys){(m.lvL as Record<string,Float64Array>)[key][i]=(o.lvL as Record<string,Float64Array>)[key][k];(m.lvS as Record<string,Float64Array>)[key][i]=(o.lvS as Record<string,Float64Array>)[key][k]}}
 return m;
}
export const sessionsOf=(def:StrategyDef):Record<SessionId,SessionDef>=>({...DEFAULT_SESSIONS,...def.filters.sessionDefs});
const tfOf=(def:StrategyDef,c:Condition):Tf=>c.tf==='context'||c.tf==='zone'||c.tf==='entry'?def.tf[c.tf]:c.tf;

// jedna podmínka na sérii jejího TF (výstup zarovnaný na svíčky vstupního TF)
function blockOut(def:StrategyDef,c:Condition,pm:PM,ctx:Ctx,prev:Map<string,B.Out>):B.Out{
 // parametry jsou po validaci (rules-def.ts) úplné a správného typu
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const P=c.params as any,tf=tfOf(def,c),sess=sessionsOf(def);
 const key=JSON.stringify([c.block,c.params,c.block==='nested_zone'?[prev.get(String(c.params.inner)),prev.get(String(c.params.outer))].map(x=>x?'+':'-'):tf,JSON.stringify(def.filters.sessionDefs)]);
 if(c.block!=='nested_zone'){const hit=pm.cache.get(key);if(hit)return hit}
 const E=pm.E;let out:B.Out;
 if(c.block==='nested_zone'){
  const a=prev.get(String(c.params.inner)),b=prev.get(String(c.params.outer));
  return a&&b?B.nestedBlock(E.n,a,b,String(c.params.mode)):B.newOut(E.n,['proximal','distal','mid']);
 }
 const needs=BLOCKS[c.block].needs;
 if(needs){
  // bloky s externími daty vždy na vstupním TF (čas vyhodnocení = zavření svíčky vstupního TF)
  if(c.block==='news_blackout')out=B.newsBlock(E,pm.id,ctx.news??null,P);
  else if(c.block==='cot_index')out=B.cotBlock(E,ctx.cot?B.cotForMarket(ctx.cot,pm.id,P.weeks):null,P);
  else if(c.block==='seasonality'){const d1=pm.data==='D1'?Array.from({length:E.n},(_,i)=>({t:E.t[i],o:E.o[i],h:E.h[i],l:E.l[i],c:E.c[i]})):ctx.d1?.[pm.id]??[];out=B.seasonBlock(E,pm.data,d1,P)}
  else if(c.block==='dxy_trend'){const d=ctx.dxy?.length?B.series([...ctx.dxy].sort((a,b)=>a.t-b.t),pm.data):null;out=B.dxyBlock(E,d,pm.id,P)}
  else{ // rel_strength
   const ob=ctx.extra?.[String(c.params.other)],os=ob?.length?B.series([...ob].sort((a,b)=>a.t-b.t),pm.data):null;
   const anchor=c.params.session==='day'?B.dayAnchor(E,pm.data):B.sessionLevels(E,sess[c.params.session as SessionId]).curOpenT;
   out=os?B.relStrength(E,os,anchor,Number(c.params.min)):Object.assign(B.newOut(E.n,[]),{unknown:new Uint8Array(E.n).fill(1)});
  }
  pm.cache.set(key,out);return out;
 }
 const {s,done}=tfData(pm,tf);
 let raw:B.Out;
 switch(c.block){
  case 'trend_swing':raw=B.trendSwing(s,P.n);break;
  case 'ma':raw=B.maBlock(s,P);break;
  case 'atr_regime':raw=B.atrRegime(s,P);break;
  case 'zone':case 'order_block':raw=B.zoneBlock(s,s.get('zones:'+c.block+JSON.stringify([P.impulseK,P.atrPeriod,P.swingN,P.requireBreak,P.proximal,P.maxBase,P.baseBodyRatio,P.lookback]),()=>B.findZones(s,P,c.block==='zone'?'zone':'ob')),P);break;
  case 'premium_discount':raw=B.premiumDiscount(s,P);break;
  case 'fvg':raw=B.fvgBlock(s,P);break;
  case 'fib_band':raw=B.fibBand(s,P);break;
  case 'round_number':raw=B.roundNumber(s,P);break;
  case 'prev_day':{const x=B.prevDayLevels(s,pm.data);raw=B.levelUse(s,x.high,x.low,P.use,P.k,P.atrPeriod);break}
  case 'session_range':{const x=B.sessionLevels(s,sess[c.params.session as SessionId]);raw=B.levelUse(s,x.lastH,x.lastL,P.use,P.k,P.atrPeriod);break}
  case 'sweep':{const x=B.levelSource(s,String(c.params.level),pm.data,P.swingN,sess);raw=B.sweepSeries(s,x.hi,x.lo,P.lookback);break}
  case 'mss':{let sw:B.Out|null=null;if(c.params.requireSweep){const x=B.levelSource(s,String(c.params.sweepLevel),pm.data,P.swingN,sess);sw=B.sweepSeries(s,x.hi,x.lo,P.sweepLookback)}raw=B.mssBlock(s,P,sw);break}
  case 'engulfing':raw=B.patternBlock(s,P.lookback,(i,side)=>B.isEngulf(s,i,side,!!c.params.wicks));break;
  case 'pin_bar':raw=B.patternBlock(s,P.lookback,(i,side)=>B.isPin(s,i,side,P));break;
  default:raw=B.newOut(s.n,[]);
 }
 out=tf===pm.data?raw:mapOut(raw,done);
 pm.cache.set(key,out);return out;
}
export type Compiled={outs:B.Out[];req:number[];opt:number[];idx:Map<string,number>};
export function compile(def:StrategyDef,pm:PM,ctx:Ctx):Compiled{
 const outs:B.Out[]=[],byId=new Map<string,B.Out>(),idx=new Map<string,number>();
 def.conditions.forEach((c,k)=>{const o=blockOut(def,c,pm,ctx,byId);outs.push(o);byId.set(c.id,o);idx.set(c.id,k)});
 return {outs,req:def.conditions.map((c,k)=>c.role==='required'?k:-1).filter(k=>k>=0),opt:def.conditions.map((c,k)=>c.role==='optional'?k:-1).filter(k=>k>=0),idx};
}
// signál na svíčce i: strana (nebo 0), hodnocení a seznam splněných podmínek
export function signalAt(def:StrategyDef,cp:Compiled,i:number):{side:Side|0;rating:number;sat:number[];both:boolean}{
 // bez dat: zprávy mimo pokrytí kalendáře blok sám nastaví jako splněný (L/S = 1); COT, sezonalita, DXY a relativní síla bez dat NEPLATÍ
 const ok=(side:Side)=>cp.req.every(k=>(side>0?cp.outs[k].L:cp.outs[k].S)[i]===1);
 const L=def.entry.side!=='short'&&ok(1),S=def.entry.side!=='long'&&ok(-1);
 if(L&&S)return {side:0,rating:0,sat:[],both:true};
 if(!L&&!S)return {side:0,rating:0,sat:[],both:false};
 const side:Side=L?1:-1,sat=[...cp.req];let rating=0;
 for(const k of cp.opt)if((side>0?cp.outs[k].L:cp.outs[k].S)[i]===1&&cp.outs[k].unknown?.[i]!==1){rating++;sat.push(k)} // volitelná bez dat se do hodnocení nepočítá
 return {side,rating,sat:sat.sort((a,b)=>a-b),both:false};
}
const levelOf=(cp:Compiled,from:string,key:LevelKey,side:Side,i:number):number=>{
 const k=cp.idx.get(from);if(k===undefined)return NaN;const lv=(side>0?cp.outs[k].lvL:cp.outs[k].lvS)[key];return lv?lv[i]:NaN;
};
export function riskPctOf(def:StrategyDef,rating:number):number{let p=def.risk.basePct;for(const x of def.risk.byRating)if(rating>=x.min)p=x.pct;return p}

// ---- plán obchodu ze signálu (úrovně vstupu, stop, cíl, TP1) – sdílí backtest i živá simulace
export type Plan={side:Side;legs:{L:number;share:number}[];stop:number;target:number|null;tp1:number|null;risk:number;rr:number|null;rating:number;riskPct:number;sat:number[]};
export type PlanSkip={skip:string};
export function planAt(def:StrategyDef,pm:PM,cp:Compiled,i:number,side:Side,rating:number,sat:number[],entryOverride?:number):Plan|PlanSkip{
 const E=pm.E,a=B.atrOf(E,def.stop.atrPeriod)[i];
 if(rating<def.risk.minRating)return {skip:'hodnocení pod minimem'};
 let legs:{L:number;share:number}[];
 if(def.entry.type==='market_on_close')legs=[{L:entryOverride??E.c[i],share:1}];
 else if(def.entry.legs)legs=def.entry.legs.map(l=>({L:levelOf(cp,l.from,l.key,side,i),share:l.share}));
 else legs=[{L:levelOf(cp,def.entry.from!,def.entry.key,side,i),share:1}];
 if(legs.some(l=>!Number.isFinite(l.L)))return {skip:'chybí úroveň vstupu'};
 const avg=legs.reduce((s,l)=>s+l.L*l.share,0),first=legs[0].L;
 let ref:number;
 if(def.stop.from==='entry')ref=first;else if(def.stop.from==='signal_bar')ref=side>0?E.l[i]:E.h[i];else ref=levelOf(cp,def.stop.from,def.stop.key,side,i);
 if(!Number.isFinite(ref))return {skip:'chybí úroveň stopu'};
 if((def.stop.atrK>0||def.stop.minAtrK>0)&&!(a>0))return {skip:'chybí ATR'};
 let stop=ref-side*def.stop.atrK*(a||0);
 if(def.stop.pct>0)stop-=side*def.stop.pct/100*Math.abs(first-ref);
 if(def.stop.minAtrK>0){for(const l of legs)if(side*(l.L-stop)<def.stop.minAtrK*a)stop=l.L-side*def.stop.minAtrK*a}
 if(legs.some(l=>!(side*(l.L-stop)>0)))return {skip:'stop na špatné straně vstupu'};
 const risk=side*(avg-stop);
 let target:number|null;
 if(def.targets.type==='r')target=avg+side*def.targets.r*risk;
 else if(def.targets.type==='swing'){const st=B.structure(E,def.targets.swingN);target=side>0?st.hi[i]:st.lo[i];if(!Number.isFinite(target)||!(side*(target-avg)>0))return {skip:'chybí protilehlý swing'}}
 else{target=levelOf(cp,def.targets.from!,def.targets.key,side,i);if(!Number.isFinite(target)||!(side*(target-avg)>0))return {skip:'cíl na špatné straně'}}
 const rr=side*(target-avg)/risk;
 if(def.targets.minRR>0&&rr<def.targets.minRR)return {skip:'R:R pod minimem'};
 if(def.targets.obstacle){const ob=levelOf(cp,def.targets.obstacle.from,def.targets.obstacle.key,side,i);
  if(Number.isFinite(ob)&&side*(ob-avg)>0&&side*(target-ob)>0&&side*(ob-avg)/risk<Math.max(def.targets.minRR,1))return {skip:'překážka před cílem'}}
 const tp1=def.targets.partial?avg+side*def.targets.partial.atR*risk:null;
 return {side,legs,stop,target,tp1,risk,rr,rating,riskPct:riskPctOf(def,rating),sat};
}

// ---- portfolio limity (sdílí backtest i živá simulace)
export type HistTrade={entryT:number;knownAt:number|null;r:number|null};
export function dayKeys(tz:string,t:number){const d=B.localDay(tz,t);return {day:d,week:Math.floor((d+3)/7)}}
export function portfolioBlock(f:StrategyDef['filters'],hist:HistTrade[],T:number,openCount:number):string|null{
 if(openCount>=f.maxOpen)return `plno (${f.maxOpen} pozic)`;
 const k=dayKeys(f.dayTz,T);
 if(f.maxTradesPerDay!==null||f.maxTradesPerWeek!==null){let d=0,w=0;for(const h of hist){if(h.entryT>T)continue;const x=dayKeys(f.dayTz,h.entryT);if(x.day===k.day)d++;if(x.week===k.week)w++}
  if(f.maxTradesPerDay!==null&&d>=f.maxTradesPerDay)return `limit ${f.maxTradesPerDay} obchodů za den`;
  if(f.maxTradesPerWeek!==null&&w>=f.maxTradesPerWeek)return `limit ${f.maxTradesPerWeek} obchodů za týden`}
 if(f.stopAfterLosses!==null||f.dailyLossR!==null||f.weeklyLossR!==null){let losses=0,dr=0,wr=0;
  for(const h of hist){if(h.knownAt===null||h.r===null||h.knownAt>T)continue;const x=dayKeys(f.dayTz,h.knownAt);if(x.day===k.day){dr+=h.r;if(h.r<0)losses++}if(x.week===k.week)wr+=h.r}
  if(f.stopAfterLosses!==null&&losses>=f.stopAfterLosses)return `stop-den po ${f.stopAfterLosses} ztrátách`;
  if(f.dailyLossR!==null&&dr<=-f.dailyLossR)return `denní limit ztráty ${f.dailyLossR} R`;
  if(f.weeklyLossR!==null&&wr<=-f.weeklyLossR)return `týdenní limit ztráty ${f.weeklyLossR} R`}
 return null;
}
export function entryWindowOk(def:StrategyDef,t:number):boolean{
 if(!def.filters.sessions.length)return true;const s=sessionsOf(def);return def.filters.sessions.some(id=>B.inSession(t,s[id]));
}
// první okamžik ≥ from, kdy je v zóně tz místní čas `at` (časový výstup v daný čas)
export function clockDeadline(tz:string,at:string,from:number):number{
 const d=B.localDay(tz,from),min=B.hhmm(at);
 const mk=(dd:number)=>{const x=new Date(dd*DAY);return zonedAt(tz,x.getUTCFullYear(),x.getUTCMonth()+1,x.getUTCDate(),min)};
 let t=mk(d);if(t<=from)t=mk(d+1);return t;
}

// ---- simulace (jeden průchod časem přes trhy)
export type Trade={market:string;side:Side;sigT:number;entryT:number;exitT:number;r:number;reason:'sl'|'be'|'tp'|'time'|'end';rating:number;riskPct:number;legs:number;partial:boolean};
type Leg={L:number;share:number;filled:boolean;fill:number;mid:number};
type Pos={side:Side;fillSide:Side;sig:number;sigT:number;legs:Leg[];stop:number;orig:number;target:number|null;tp1:number|null;risk:number;entryIdx:number;entryT:number;
 partialDone:boolean;pendingBE:boolean;rating:number;riskPct:number;partR:number;deadline:number;active:boolean;expires:number;type:'limit'|'market_on_close';h:HistTrade|null};
export type SimOut={trades:Trade[];skips:Record<string,number>;signals:number;unknown:Record<string,number>};
export type SimOpts={flipSeed?:number|null;to?:number};
export function simulate(def:StrategyDef,pms:PM[],cps:Compiled[],ctx:Ctx,o:SimOpts={}):SimOut{
 const trades:Trade[]=[],skips:Record<string,number>={},hist:HistTrade[]=[],unknown:Record<string,number>={};
 const skip=(r:string)=>{skips[r]=(skips[r]||0)+1};let signals=0;
 const rnd=o.flipSeed!=null?seeded(o.flipSeed):null,cost=def.costs.spreadMult,commR=def.costs.commissionR,cons=def.management.ambiguity==='conservative';
 const pos:(Pos|null)[]=pms.map(()=>null),ptr=pms.map(()=>0);let openCount=0;
 const newsF=def.filters.news;
 const newsBlocked=(pm:PM,t:number)=>!!newsF&&ctx.news?.(pm.id,t,newsF.minutes,newsF.minSignal)===true;
 const close=(m:number,mid:number,exitT:number,knownAt:number,reason:Trade['reason'])=>{
  const p=pos[m]!,pm=pms[m],hs=pm.hs*cost,side=p.side;
  let r=p.partR;const rem=p.partialDone?1-(def.targets.partial!.pct/100):1;
  for(const l of p.legs)if(l.filled){const ru=side*(l.fill-(p.orig-side*hs));r+=l.share*rem*side*((mid-side*hs)-l.fill)/ru}
  const filledShare=p.legs.reduce((s,l)=>s+(l.filled?l.share:0),0);r-=commR*filledShare;
  trades.push({market:pm.id,side,sigT:p.sigT,entryT:p.entryT,exitT,r,reason,rating:p.rating,riskPct:p.riskPct,legs:p.legs.filter(l=>l.filled).length,partial:p.partialDone});
  if(p.h){p.h.knownAt=knownAt;p.h.r=r}openCount--;pos[m]=null;
 };
 const partial=(m:number,mid:number)=>{const p=pos[m]!,hs=pms[m].hs*cost,side=p.side,pct=def.targets.partial!.pct/100;
  for(const l of p.legs)if(l.filled){const ru=side*(l.fill-(p.orig-side*hs));p.partR+=l.share*pct*side*((mid-side*hs)-l.fill)/ru}
  p.partialDone=true;if(def.targets.partial!.moveToBE)p.pendingBE=true};
 const be=(p:Pos)=>{const f=p.legs.filter(l=>l.filled),sh=f.reduce((s,l)=>s+l.share,0);return f.reduce((s,l)=>s+l.mid*l.share,0)/sh};
 const fillLeg=(m:number,l:Leg,mid:number)=>{const p=pos[m]!,hs=pms[m].hs*cost;l.filled=true;l.mid=mid;l.fill=mid+p.side*hs};
 // výstupy na svíčce i (u pozice z této svíčky jen SL – voláno zvlášť)
 const exits=(m:number,i:number)=>{
  const p=pos[m]!,E=pms[m].E,t=E.t[i],side=p.side;
  if(p.pendingBE){p.stop=be(p);p.pendingBE=false}
  if(p.deadline&&t>=p.deadline){close(m,E.o[i],t,t,'time');return}
  const st=p.stop,beR=st!==p.orig?'be':'sl';
  // gap na open
  if(side>0?E.o[i]<=st:E.o[i]>=st){close(m,E.o[i],t,t,beR);return}
  if(p.target!==null&&(side>0?E.o[i]>=p.target:E.o[i]<=p.target)){close(m,E.o[i],t,t,'tp');return}
  if(p.tp1!==null&&!p.partialDone&&(side>0?E.o[i]>=p.tp1:E.o[i]<=p.tp1))partial(m,E.o[i]);
  const hitSl=side>0?E.l[i]<=st:E.h[i]>=st,hitTp=p.target!==null&&(side>0?E.h[i]>=p.target:E.l[i]<=p.target),hitTp1=p.tp1!==null&&!p.partialDone&&(side>0?E.h[i]>=p.tp1:E.l[i]<=p.tp1);
  if(hitSl&&(cons||!(hitTp||hitTp1))){close(m,st,t,t+E.ms,beR);return}
  if(hitTp1)partial(m,p.tp1!);
  if(hitTp){close(m,p.target!,t,t+E.ms,'tp');return}
  if(hitSl){close(m,st,t,t+E.ms,beR);return} // optimistic: TP1 dřív, pak SL
  if(def.management.beAtR&&p.stop===p.orig&&!p.pendingBE){const lvl=be(p)+side*def.management.beAtR*p.risk;if(side>0?E.h[i]>=lvl:E.l[i]<=lvl)p.pendingBE=true}
 };
 const atClose=(m:number,i:number)=>{
  const p=pos[m];if(!p||!p.active)return;const E=pms[m].E;
  const held=p.type==='market_on_close'?i-p.entryIdx:i-p.entryIdx+1;
  if(def.management.timeExitBars&&held>=def.management.timeExitBars){close(m,E.c[i],E.t[i],E.t[i]+E.ms,'time');return}
  if(def.management.beAtR&&p.stop===p.orig&&!p.pendingBE){const lvl=be(p)+p.side*def.management.beAtR*p.risk;if(p.side>0?E.h[i]>=lvl:E.l[i]<=lvl)p.pendingBE=true}
 };
 const open=(m:number,p:Pos,T:number,mid:number,legIdx:number,i:number)=>{
  p.active=true;p.entryIdx=i;p.entryT=T;openCount++;fillLeg(m,p.legs[legIdx],mid);
  p.h={entryT:T,knownAt:null,r:null};hist.push(p.h); // vstup se počítá do limitů hned, výsledek až po zavření
  p.deadline=def.management.timeExitClock?clockDeadline(def.management.timeExitClock.tz,def.management.timeExitClock.at,T):0;
 };
 // pending/aktivní pozice v jednom objektu: active=false = čeká limitní příkaz
 const fills=(m:number,i:number)=>{
  const p=pos[m];if(!p||p.type!=='limit')return;const E=pms[m].E,t=E.t[i],fs=p.fillSide;
  if(i>p.expires){if(!p.active){pos[m]=null;skip('limit vypršel')}return}
  for(const [k,l] of p.legs.entries()){
   if(l.filled)continue;
   const atOpen=fs>0?E.o[i]<=l.L:E.o[i]>=l.L,touch=atOpen||(fs>0?E.l[i]<=l.L:E.h[i]>=l.L);if(!touch)continue;
   if(!p.active){
    if(!entryWindowOk(def,t)||newsBlocked(pms[m],t)){skip('mimo vstupní okno / zprávy');continue}
    const blk=portfolioBlock(def.filters,hist,t,openCount);if(blk){skip(blk);pos[m]=null;return}
    open(m,p,t,atOpen?E.o[i]:l.L,k,i);
    if(rnd)mirror(m,p);
    // v téže svíčce jen SL (gap plnění = celá svíčka)
    if(atOpen)exits(m,i);else{const st=p.stop;if(p.side>0?E.l[i]<=st:E.h[i]>=st){if(cons){close(m,st,t,t+E.ms,'sl');return}}}
    if(!pos[m])return;
   }else{fillLeg(m,l,atOpen?E.o[i]:l.L)}
  }
 };
 // náhoda: směr obchodu náhodný (stejný čas a cena vstupu), stop a cíl zrcadlené kolem plánovaného vstupu
 const mirror=(m:number,p:Pos)=>{
  if(rnd!()<.5)return;
  const avg=p.legs.reduce((x,l)=>x+l.L*l.share,0),hs=pms[m].hs*cost;
  p.side=(-p.fillSide) as Side;p.stop=p.orig=2*avg-p.stop;
  if(p.target!==null)p.target=2*avg-p.target;if(p.tp1!==null)p.tp1=2*avg-p.tp1;
  for(const l of p.legs)if(l.filled)l.fill=l.mid+p.side*hs;
 };
 const signal=(m:number,i:number)=>{
  const pm=pms[m],cp=cps[m],E=pm.E;if(pos[m])return;
  const sg=signalAt(def,cp,i);if(sg.both){skip('obě strany zároveň');return}if(!sg.side)return;
  signals++;
  for(const k of sg.sat){const u=cp.outs[k].unknown;if(u?.[i]){const id=def.conditions[k].block;unknown[id]=(unknown[id]||0)+1}}
  const pl=planAt(def,pm,cp,i,sg.side,sg.rating,sg.sat);if('skip' in pl){skip(pl.skip);return}
  const T=E.t[i]+E.ms;
  const p:Pos={side:pl.side,fillSide:pl.side,sig:i,sigT:T,legs:pl.legs.map(l=>({L:l.L,share:l.share,filled:false,fill:NaN,mid:NaN})),stop:pl.stop,orig:pl.stop,target:pl.target,tp1:pl.tp1,risk:pl.risk,
   entryIdx:-1,entryT:NaN,partialDone:false,pendingBE:false,rating:pl.rating,riskPct:pl.riskPct,partR:0,deadline:0,active:false,expires:i+def.entry.validBars,type:def.entry.type,h:null};
  if(def.entry.type==='market_on_close'){
   if(!entryWindowOk(def,T)||newsBlocked(pm,T)){skip('mimo vstupní okno / zprávy');return}
   const blk=portfolioBlock(def.filters,hist,T,openCount);if(blk){skip(blk);return}
   pos[m]=p;open(m,p,T,E.c[i],0,i);if(rnd)mirror(m,p);
  }else pos[m]=p;
 };
 const until=o.to??Infinity;
 for(;;){
  let T=Infinity;for(let m=0;m<pms.length;m++){const q=ptr[m];if(q<pms[m].E.n&&pms[m].E.t[q]<T)T=pms[m].E.t[q]}
  if(T===Infinity||T>=until)break;
  const now:number[]=[];for(let m=0;m<pms.length;m++)if(ptr[m]<pms[m].E.n&&pms[m].E.t[ptr[m]]===T)now.push(m);
  for(const m of now){const p=pos[m];if(p&&p.active)exits(m,ptr[m])}
  for(const m of now)fills(m,ptr[m]);
  for(const m of now){atClose(m,ptr[m]);signal(m,ptr[m]);ptr[m]++}
 }
 for(let m=0;m<pms.length;m++){const p=pos[m];if(!p)continue;if(!p.active){pos[m]=null;continue}const E=pms[m].E,i=Math.min(E.n,ptr[m])-1;close(m,E.c[i],E.t[i],E.t[i]+E.ms,'end')}
 trades.sort((a,b)=>a.exitT-b.exitT||a.entryT-b.entryT);
 return {trades,skips,signals,unknown};
}

// ---- vyhodnocení: IS / OOS, trhy, křivka, varianty, hranice náhody, robustnost
export type Metrics3={is:SegMetrics;oos:SegMetrics;all:SegMetrics};
export type VariantResult={name:string;metrics:Metrics3;nb:number|null;robust:boolean;returnPct:number;maxDdPct:number;
 perMarket:({id:string}&Metrics3)[];equity:[number,number][];skips:Record<string,number>;signals:number;unknown:Record<string,number>;trades:Trade[]};
export type StrategyRunResult={version:string;defName:string;defVersion:number;data:'D1'|'H1';computedAt:string;from:string;split:string;to:string;splitRule:string;
 markets:{id:string;bars:number;from:string|null;to:string|null}[];variants:VariantResult[];chance:{reps:number;seed:number;values:number[];median:number|null;max:number|null}|null;
 robustRule:string;notes:string[];warnings:string[];ms:number};
const isoD=(t:number)=>new Date(t).toISOString().slice(0,10);
export function splitOf(data:'D1'|'H1',pms:PM[]):{from:number;split:number;to:number;rule:string}{
 let lo=Infinity,hi=-Infinity;for(const p of pms)if(p.E.n){lo=Math.min(lo,p.E.t[0]);hi=Math.max(hi,p.E.t[p.E.n-1])}
 if(lo===Infinity){lo=0;hi=0}
 if(data==='D1')return {from:Date.parse(IS_FROM+'T00:00:00Z'),split:Date.parse(OOS_FROM+'T00:00:00Z'),to:hi,rule:`IS ${IS_FROM.slice(0,4)}–${Number(OOS_FROM.slice(0,4))-1}, OOS od ${OOS_FROM.slice(0,4)} (D1)`};
 // H1: historie je krátká (~2 roky) → OOS = posledních 30 % období (první měsíc slouží k zahřátí indikátorů)
 const from=lo+30*DAY,split=from+Math.floor((hi-from)*.7);
 return {from,split,to:hi,rule:'H1: IS prvních 70 % období, OOS posledních 30 % (krátká historie H1)'};
}
export function evaluate(trades:Trade[],ids:string[],from:number,split:number){
 const is=newSeg(),oos=newSeg(),all=newSeg(),per=new Map(ids.map(id=>[id,{is:newSeg(),oos:newSeg(),all:newSeg()}]));
 let eq=100,peak=100,dd=0;const curve:[number,number][]=[];
 const ts=trades.filter(t=>t.entryT>=from);
 for(const t of ts){
  const s=t.entryT<split?is:oos;addSeg(s,t.r);addSeg(all,t.r);
  const pm=per.get(t.market);if(pm){addSeg(t.entryT<split?pm.is:pm.oos,t.r);addSeg(pm.all,t.r)}
  eq*=1+t.r*t.riskPct/100;peak=Math.max(peak,eq);dd=Math.min(dd,(eq-peak)/peak*100);curve.push([t.exitT,rd(eq,3)]);
 }
 const step=Math.max(1,Math.ceil(curve.length/400)),eqOut=curve.filter((_,i)=>i%step===0||i===curve.length-1);
 return {metrics:{is:segMetrics(is),oos:segMetrics(oos),all:segMetrics(all)},perMarket:[...per].map(([id,x])=>({id,is:segMetrics(x.is),oos:segMetrics(x.oos),all:segMetrics(x.all)})),
  equity:eqOut,returnPct:rd(eq-100,2),maxDdPct:rd(-dd,2),trades:ts};
}
export function isRobustRun(m:Metrics3,nb:number|null):boolean{
 return (m.is.avgR??0)>0&&(m.oos.avgR??0)>0&&m.oos.trades>=MIN_OOS_TRADES&&(nb??-1)>0&&(m.oos.pf??0)>=MIN_OOS_PF;
}
export const ROBUST_RULE=`Robustní = IS průměr R > 0, OOS průměr R > 0, OOS aspoň ${MIN_OOS_TRADES} obchodů, medián OOS průměru R základu a variant > 0 a OOS profit factor ≥ ${MIN_OOS_PF} (stejná pravidla jako Hledání prahů).`;
export type RunOpts={shuffles?:number;seed?:number;now?:number;keepTrades?:number;onProgress?:(msg:string)=>void};
export function runStrategy(def:StrategyDef,markets:MarketIn[],ctx:Ctx,o:RunOpts={}):StrategyRunResult{
 const t0=Date.now(),warnings:string[]=[],notes:string[]=[];
 const runs=defRuns(def),pms=markets.filter(m=>m.bars.length).map(m=>prepare(m.id,m.bars,def.data));
 for(const m of def.markets)if(!pms.some(p=>p.id===m))warnings.push(`${m}: v archivu nejsou svíčky ${def.data} – trh se netestuje.`);
 const sp=splitOf(def.data,pms),ids=pms.map(p=>p.id);
 const sims=runs.map(r=>{const cps=pms.map(pm=>compile(r.def,pm,ctx));return {r,cps,sim:simulate(r.def,pms,cps,ctx)}});
 o.onProgress?.(`varianty: ${sims.length}`);
 const evals=sims.map(x=>({...evaluate(x.sim.trades,ids,sp.from,sp.split),x}));
 const oosAvgs=evals.filter(e=>e.metrics.oos.trades>0).map(e=>e.metrics.oos.avgR as number),nb=median(oosAvgs);
 const keep=o.keepTrades??400;
 const variants:VariantResult[]=evals.map(e=>({name:e.x.r.name,metrics:e.metrics,nb:nb===null?null:rd(nb),robust:isRobustRun(e.metrics,nb),returnPct:e.returnPct,maxDdPct:e.maxDdPct,perMarket:e.perMarket,
  equity:e.equity,skips:e.x.sim.skips,signals:e.x.sim.signals,unknown:e.x.sim.unknown,trades:e.trades.slice(-keep)}));
 // hranice náhody: nejlepší OOS průměr R přes základ a varianty s náhodnými směry
 const reps=o.shuffles??20,seed=o.seed??42,vals:number[]=[];
 for(let k=0;k<reps;k++){
  let best:number|null=null;
  sims.forEach((x,vi)=>{const s=simulate(x.r.def,pms,x.cps,ctx,{flipSeed:seed+k*7919+vi*104729});const e=evaluate(s.trades,ids,sp.from,sp.split);if(e.metrics.oos.trades>0&&(best===null||(e.metrics.oos.avgR as number)>best))best=e.metrics.oos.avgR})
  if(best!==null)vals.push(best);
  o.onProgress?.(`náhoda ${k+1}/${reps}`);
 }
 // pokrytí zpráv (kalendář nemá dlouhou historii)
 const usesNews=def.filters.news||def.conditions.some(c=>c.block==='news_blackout');
 if(usesNews){const u=variants[0].unknown.news_blackout||0;notes.push('Filtr zpráv se vyhodnocuje jen v období, které uložený kalendář pokrývá (historie kalendáře se sbírá teprve od jeho spuštění); mimo něj filtr neblokuje'+(u?` – ${u} signálů bez dat o zprávách.`:'.'))}
 if(def.conditions.some(c=>c.block==='cot_index'))notes.push('COT se používá až od času zveřejnění (available_at; jinak pátek 15:30 New York po úterním datu reportu).');
 if(def.conditions.some(c=>c.block==='dxy_trend'))notes.push('Dolarový index: DX-Y.NYB z archivu, jinak syntetický index z FX párů (váhy DXY bez SEK).');
 if(def.data==='H1')notes.push('Data H1 jsou v archivu jen asi 2 roky – výsledky mají méně obchodů a OOS je posledních 30 % období.');
 notes.push('Hranice náhody: stejné vstupy (čas i cena), náhodný směr se zrcadleným stopem a cílem; medián nejlepšího OOS průměru R přes základ a varianty.');
 return {version:STRAT_VERSION,defName:def.name,defVersion:def.version,data:def.data,computedAt:new Date(o.now??Date.now()).toISOString(),from:isoD(sp.from),split:isoD(sp.split),to:isoD(sp.to||0),splitRule:sp.rule,
  markets:pms.map(p=>({id:p.id,bars:p.E.n,from:p.E.n?isoD(p.E.t[0]):null,to:p.E.n?isoD(p.E.t[p.E.n-1]):null})),variants,
  chance:reps>0?{reps,seed,values:vals,median:vals.length?rd(median(vals)!):null,max:vals.length?rd(Math.max(...vals)):null}:null,robustRule:ROBUST_RULE,notes,warnings,ms:Date.now()-t0};
}
export type RunSummary={variants:number;robust:number;is:SegMetrics;oos:SegMetrics;chance:number|null;markets:number;from:string;split:string;to:string;ms:number};
export function runSummary(r:StrategyRunResult):RunSummary{
 const b=r.variants[0];return {variants:r.variants.length,robust:r.variants.filter(v=>v.robust).length,is:b.metrics.is,oos:b.metrics.oos,chance:r.chance?.median??null,markets:r.markets.length,from:r.from,split:r.split,to:r.to,ms:r.ms};
}

// ---- živá simulace (agenti R…): nastavení z DOKONČENÝCH svíček do času now
export type LiveSetup={key:string;side:Side;type:'limit'|'market_on_close';sigT:number;legs:{L:number;share:number}[];stop:number;target:number|null;tp1:number|null;
 risk:number;rating:number;riskPct:number;sat:string[];expiresT:number};
export function liveSetups(def:StrategyDef,id:string,bars:B.Bar[],ctx:Ctx,now:number):LiveSetup[]{
 const ms=B.TF_MS[def.data],done=bars.filter(b=>b.t+ms<=now);if(done.length<20)return [];
 const pm=prepare(id,done,def.data),cp=compile(def,pm,ctx),E=pm.E,last=E.n-1,out:LiveSetup[]=[];
 const win=def.entry.type==='limit'?def.entry.validBars:1;
 for(let i=Math.max(0,last-win+1);i<=last;i++){
  const sg=signalAt(def,cp,i);if(!sg.side)continue;
  const pl=planAt(def,pm,cp,i,sg.side,sg.rating,sg.sat);if('skip' in pl)continue;
  // limit, kterého cena po signálu už dosáhla na dokončených svíčkách, je propadlý (nevstupuje se pozdě)
  if(def.entry.type==='limit'){let touched=false;for(let j=i+1;j<=last;j++)if(pl.legs.some(l=>sg.side>0?E.l[j]<=l.L:E.h[j]>=l.L)){touched=true;break}if(touched)continue}
  out.push({key:`${E.t[i]}:${sg.side}`,side:pl.side,type:def.entry.type,sigT:E.t[i]+ms,legs:pl.legs,stop:pl.stop,target:pl.target,tp1:pl.tp1,risk:pl.risk,rating:pl.rating,riskPct:pl.riskPct,
   sat:pl.sat.map(k=>condLabel(def.conditions[k],def)+(def.conditions[k].role==='optional'?' · volitelná':'')),expiresT:E.t[i]+ms+win*ms});
 }
 // u stejné strany jen nejnovější nastavení
 const seen=new Set<number>();return out.reverse().filter(s=>{if(seen.has(s.side))return false;seen.add(s.side);return true});
}
export const ruleOptionalCount=(def:StrategyDef)=>def.conditions.filter(c=>c.role==='optional').length;
