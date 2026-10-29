// Laboratoř · Strategie: obecný engine pravidlových strategií řízený definicí z DB (lib/lab/rules-def.ts). Čisté funkce,
// testy scripts/check-lab-strategies.mjs. Žádná konkrétní strategie v kódu – jen bloky (lib/lab/strat-blocks.ts) a mechanika obchodu.
//
// SIGNÁL: podmínky se vyhodnotí na zavření svíčky i (vyšší TF jen z uzavřených svíček, viz strat-blocks.ts). Strana long/short platí,
// když jsou splněné všechny 'required' podmínky mimo skupiny a z každé skupiny NEBO aspoň jedna; hodnocení = počet splněných 'optional'
// ('info' = jen zdroj úrovní). Platí-li obě strany zároveň, signál se zahodí. Backtest i živí agenti R… (liveSetups → lib/lab/paper.ts)
// používají stejné signalAt + planAt.
//
// PROVEDENÍ (na jednom místě):
//  • Limit: příkaz na úrovni podmínky, platí `validBars` svíček po signální. Open za úrovní = plnění za open (gap). Při plnění uvnitř
//    svíčky se v téže svíčce kontroluje jen SL (pořadí high/low neznáme – konzervativně), TP až od další; gap plnění kontroluje vše.
//  • Market-on-close: vstup za close signální svíčky, výstupy od další svíčky.
//  • Plnění = mid ± ½ výchozího spreadu backtestu (lib/backtest/rules.ts spreadPrice) × costs.spreadMult; R = (výstup − vstup)/(vstup − plnění SL)
//    → zásah původního SL = přesně −1 R na nohu; komise = costs.commissionR odečtená z R.
//  • Stop = úroveň (nebo vstup / signální svíčka) ∓ atrK × ATR ∓ pct % vzdálenosti vstup–úroveň, nejméně minAtrK × ATR.
//    Cíl = k R / protilehlý potvrzený swing / úroveň podmínky / proximální hrana nejbližší protilehlé zóny (fallback k R / swing / bez obchodu); R:R pod minRR → bez obchodu; překážka mezi vstupem a cílem blíž než
//    max(minRR, 1) R → bez obchodu.
//  • V jedné svíčce: gap přes SL/TP na open → výstup za open; SL i TP v rozsahu → SL (ambiguity 'conservative'; 'optimistic' = TP).
//    Částečný výstup pct % na TP1 (atR) a stop na BE platí od DALŠÍ svíčky; BE od +beAtR R také od další svíčky.
//  • Dvě (tři) nohy: riziko rozdělené podle share, společný stop; neplněná noha se zruší, když se pozice zavře nebo vyprší platnost.
//    Obě nohy na SL = −1 R celkem (strop rizika). Smíšené nohy: noha market_on_close se plní za close PRVNÍ svíčky (od signální, do
//    cancelAfterBars) s platnou podmínkou `when` (jeden pokus: blok oknem / zprávou nebo close za stopem / cílem = noha propadne); plánovaná
//    úroveň MOC nohy pro průměr, R a cíl = close signální svíčky. cancelAtTp1 = neplněná noha se zruší po částečném výstupu.
//  • Úrovňová matematika (stop / cíl / TP1 = min/max úrovní, zapsáno pro long, short zrcadlově) viz rules-def.ts; TP1 na úrovni, která
//    neleží mezi vstupem a cílem → atR, jinak bez částečného výstupu. Překážka 'between' = cokoli mezi vstupem a cílem.
//  • Časový výstup: po N svíčkách na close; v daný místní čas = za open první svíčky od toho času. Konec dat = close poslední svíčky.
//  • Portfolio (jeden průchod časem přes všechny trhy, v každém čase: výstupy → plnění → zavření svíček): 1 pozice na trh, maxOpen,
//    max obchodů za den/týden (den podle filters.dayTz), stop-den po N ztrátách, denní/týdenní limit ztráty v R – ztráta se započte až
//    od chvíle, kdy byla známá (výstup uvnitř svíčky = konec svíčky). Vstupní okna seancí a zprávy se kontrolují v čase vstupu.
//  • In-sample / out-of-sample podle času vstupu: D1 IS 2015–2022, OOS od 2023 (data před 2015 jen na zahřátí); H1 posledních 30 % období.
//  • Hranice náhody: stejné vstupy (časy i ceny plnění), náhodný směr se zrcadleným stopem a cílem; medián nejlepšího OOS průměru R.
import {BLOCKS,DEFAULT_SESSIONS,defRuns,condLabel,groupsOf,groupMarkets,type StrategyDef,type Condition,type Tf,type LevelKey,type SessionId,type SessionDef,type BlockId,type Role,type LevelExpr} from './rules-def.ts';
import * as B from './strat-blocks.ts';
import {spreadPrice,DEFAULT_RULES} from '../backtest/rules.ts';
import {MIN_OOS_TRADES,MIN_OOS_PF,IS_FROM,OOS_FROM,median} from './sweep-grid.ts';
import {zoned as zonedAt} from '../market-hours.ts';

export const STRAT_VERSION='strat-v3'; // v2: ATR bez gapů (auto), statistiky zón při 1. dotyku, skupiny NEBO, cíl zóna; v3: nové bloky a možnosti (staré definice beze změny)
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
 const n=done.length,keys=Object.keys(o.lvL),m=B.newOut(n,keys,!!o.tL);if(o.unknown)m.unknown=new Uint8Array(n);if(o.stats)m.stats=o.stats;
 for(let i=0;i<n;i++){const k=done[i];if(k<0){if(m.unknown)m.unknown[i]=1;continue}
  m.L[i]=o.L[k];m.S[i]=o.S[k];if(m.unknown)m.unknown[i]=o.unknown![k];if(m.tL){m.tL[i]=o.tL![k];m.tS![i]=o.tS![k]}
  for(const key of keys){(m.lvL as Record<string,Float64Array>)[key][i]=(o.lvL as Record<string,Float64Array>)[key][k];(m.lvS as Record<string,Float64Array>)[key][i]=(o.lvS as Record<string,Float64Array>)[key][k]}}
 if(o.zones){const zl:B.ZRef[][]=new Array(n),zs:B.ZRef[][]=new Array(n);for(let i=0;i<n;i++){const k=done[i];zl[i]=k<0?B.NO_ZONES:o.zones.L[k]??B.NO_ZONES;zs[i]=k<0?B.NO_ZONES:o.zones.S[k]??B.NO_ZONES}m.zones={L:zl,S:zs}}
 if(o.nums){m.nums={};for(const [key,arr] of Object.entries(o.nums)){const a=new Float64Array(n).fill(NaN);for(let i=0;i<n;i++){const k=done[i];if(k>=0)a[i]=arr[k]}m.nums[key]=a}}
 return m;
}
export const sessionsOf=(def:StrategyDef):Record<SessionId,SessionDef>=>({...DEFAULT_SESSIONS,...def.filters.sessionDefs});
const tfRef=(def:StrategyDef,r:string):Tf=>r==='context'||r==='zone'||r==='entry'?def.tf[r]:r as Tf;
const tfOf=(def:StrategyDef,c:Condition):Tf=>tfRef(def,c.tf);

// jedna podmínka na sérii jejího TF (výstup zarovnaný na svíčky vstupního TF)
function blockOut(def:StrategyDef,c:Condition,pm:PM,ctx:Ctx,prev:Map<string,B.Out>):B.Out{
 // parametry jsou po validaci (rules-def.ts) úplné a správného typu
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const P=c.params as any,tf=tfOf(def,c),sess=sessionsOf(def);
 const key=JSON.stringify([c.block,c.params,c.block==='nested_zone'?[prev.get(String(c.params.inner)),prev.get(String(c.params.outer))].map(x=>x?'+':'-'):tf,JSON.stringify(def.filters.sessionDefs)]);
 const derived=c.block==='nested_zone'||c.block==='retracement_between'; // z výstupů jiných podmínek – necachuje se
 if(!derived){const hit=pm.cache.get(key);if(hit)return hit}
 const E=pm.E;let out:B.Out;
 if(c.block==='nested_zone'){
  const a=prev.get(String(c.params.inner)),b=prev.get(String(c.params.outer));
  return a&&b?B.nestedBlock(E.n,a,b,B.nestedMode(String(c.params.mode),c.params.containment as string|undefined),String(c.params.pairs??'nearest')):B.newOut(E.n,['proximal','distal','mid']);
 }
 if(c.block==='retracement_between'){
  const a=prev.get(String(c.params.a)),b=prev.get(String(c.params.b));
  return a&&b?B.retraceBetween(E,a,String(c.params.aKey),b,String(c.params.bKey),P):B.newOut(E.n,['level','proximal','distal','mid','extreme'],true);
 }
 // denní bias z předchozích dnů: ze svíček dat (D−1 / D−2 jen z uzavřených dnů); htf_trend = trend ze swingů na TF podmínky
 if(c.block==='daily_bias'&&P.mode!=='htf_trend'){out=B.dailyBias(E,B.dayKeyOf(pm.data,String(P.dayTz??''),String(P.dayStart??'')),P.mode,P.insidePct);pm.cache.set(key,out);return out}
 const needs=BLOCKS[c.block].needs;
 if(needs){
  // bloky s externími daty vždy na vstupním TF (čas vyhodnocení = zavření svíčky vstupního TF)
  if(c.block==='news_blackout')out=B.newsBlock(E,pm.id,ctx.news??null,P);
  else if(c.block==='cot_index')out=B.cotBlock(E,ctx.cot?B.cotForMarket(ctx.cot,pm.id,P.weeks):null,P);
  else if(c.block==='seasonality'){const d1=pm.data==='D1'?Array.from({length:E.n},(_,i)=>({t:E.t[i],o:E.o[i],h:E.h[i],l:E.l[i],c:E.c[i]})):ctx.d1?.[pm.id]??[];out=B.seasonBlock(E,pm.data,d1,P)}
  else if(c.block==='dxy_trend'){const d=ctx.dxy?.length?B.series([...ctx.dxy].sort((a,b)=>a.t-b.t),pm.data):null;out=B.dxyBlock(E,d,pm.id,P)}
  else if(c.block==='rs_best'){
   const others=groupMarkets(c.params.group).filter(id=>id!==pm.id).map(id=>ctx.extra?.[id]).filter((b):b is B.Bar[]=>!!b?.length).map(b=>B.series([...b].sort((x,y)=>x.t-y.t),pm.data));
   const anchor=c.params.session==='day'?B.dayAnchor(E,pm.data):B.sessionLevels(E,sess[c.params.session as SessionId]).curOpenT;
   out=B.rsBest(E,others,anchor,Number(c.params.minLead));
  }
  else{ // rel_strength
   const ob=ctx.extra?.[String(c.params.other)],os=ob?.length?B.series([...ob].sort((a,b)=>a.t-b.t),pm.data):null;
   const anchor=c.params.session==='day'?B.dayAnchor(E,pm.data):B.sessionLevels(E,sess[c.params.session as SessionId]).curOpenT;
   out=os?B.relStrength(E,os,anchor,Number(c.params.min)):Object.assign(B.newOut(E.n,[]),{unknown:new Uint8Array(E.n).fill(1)});
  }
  pm.cache.set(key,out);return out;
 }
 // premium/discount s rozsahem z jiného TF než vyhodnocení: počítá se rovnou na svíčkách vstupního TF (jen uzavřené svíčky obou TF)
 if(c.block==='premium_discount'){
  const rTf=!P.rangeTf||P.rangeTf==='same'?tf:tfRef(def,P.rangeTf),eTf=!P.evalTf||P.evalTf==='same'?tf:tfRef(def,P.evalTf);
  if(rTf!==eTf){const r=tfData(pm,rTf),e=tfData(pm,eTf),sc=B.swingCount(r.s,P.swingN);
   out=B.premiumDiscountX(E.n,e.s.c,e.done,B.structure(r.s,P.swingN),r.done,P);out.stats={swingHighs:sc.highs,swingLows:sc.lows};
   pm.cache.set(key,out);return out}
  if(rTf!==tf){const {s,done}=tfData(pm,rTf),raw=B.premiumDiscount(s,P);out=rTf===pm.data?raw:mapOut(raw,done);pm.cache.set(key,out);return out}
 }
 const {s,done}=tfData(pm,tf);
 let raw:B.Out;
 switch(c.block){
  case 'trend_swing':raw=B.trendSwing(s,P.n);break;
  case 'ma':raw=B.maBlock(s,P);break;
  case 'atr_regime':raw=B.atrRegime(s,P);break;
  case 'zone':case 'order_block':{const Z={...P,atrMode:B.resolveAtrMode(P.atrMode,tf,pm.data)};
   raw=B.zoneBlock(s,s.get('zones:'+c.block+JSON.stringify([Z.impulseK,Z.atrPeriod,Z.swingN,Z.requireBreak,Z.proximal,Z.maxBase,Z.baseBodyRatio,Z.lookback,Z.atrMode]),()=>B.findZones(s,Z,c.block==='zone'?'zone':'ob')),Z);break}
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
  case 'daily_bias':{raw=B.trendSwing(s,P.swingN);const m=new Float64Array(s.n);for(let i=0;i<s.n;i++)m[i]=(raw.lvL.high![i]+raw.lvL.low![i])/2;raw.lvL.mid=m;raw.lvS.mid=m;break} // htf_trend (ostatní režimy výše)
  case 'sr_cluster':raw=B.srCluster(s,P);break;
  case 'candle_trigger':{const a=B.atrOf(s,P.atrPeriod);raw=B.patternBlock(s,P.lookback,(i,side)=>B.isTrigger(s,a,i,side,P));break}
  default:raw=B.newOut(s.n,[]);
 }
 out=tf===pm.data?raw:mapOut(raw,done);
 pm.cache.set(key,out);return out;
}
// req = všechny povinné podmínky (i členové skupin); units = povinné jednotky v pořadí definice: [k] = samostatná podmínka,
// [k1,k2…] = skupina NEBO (stačí jeden člen); groups = id skupiny → členové
export type Compiled={outs:B.Out[];req:number[];opt:number[];idx:Map<string,number>;units?:number[][];groups?:Map<string,number[]>};
export function compile(def:StrategyDef,pm:PM,ctx:Ctx):Compiled{
 const outs:B.Out[]=[],byId=new Map<string,B.Out>(),idx=new Map<string,number>();
 def.conditions.forEach((c,k)=>{const o=blockOut(def,c,pm,ctx,byId);outs.push(o);byId.set(c.id,o);idx.set(c.id,k)});
 const req=def.conditions.map((c,k)=>c.role==='required'?k:-1).filter(k=>k>=0),groups=groupsOf(def.conditions);
 return {outs,req,opt:def.conditions.map((c,k)=>c.role==='optional'?k:-1).filter(k=>k>=0),idx,units:unitsOf(def,req),groups};
}
function unitsOf(def:StrategyDef,req:number[]):number[][]{
 const g=groupsOf(def.conditions),out:number[][]=[],seen=new Set<string>();
 for(const k of req){const id=def.conditions[k].group;if(!id){out.push([k]);continue}if(seen.has(id))continue;seen.add(id);out.push(g.get(id)!)}
 return out;
}
const unitsOfCp=(def:StrategyDef,cp:Compiled)=>cp.units??unitsOf(def,cp.req);
const passes=(cp:Compiled,k:number,side:Side,i:number)=>(side>0?cp.outs[k].L:cp.outs[k].S)[i]===1;
// signál na svíčce i: strana (nebo 0), hodnocení a seznam splněných podmínek (u skupin NEBO jen splnění členové)
export function signalAt(def:StrategyDef,cp:Compiled,i:number):{side:Side|0;rating:number;sat:number[];both:boolean}{
 // bez dat: zprávy mimo pokrytí kalendáře blok sám nastaví jako splněný (L/S = 1); COT, sezonalita, DXY a relativní síla bez dat NEPLATÍ
 const units=unitsOfCp(def,cp);
 const ok=(side:Side)=>units.every(u=>u.some(k=>passes(cp,k,side,i)));
 const L=def.entry.side!=='short'&&ok(1),S=def.entry.side!=='long'&&ok(-1);
 if(L&&S)return {side:0,rating:0,sat:[],both:true};
 if(!L&&!S)return {side:0,rating:0,sat:[],both:false};
 const side:Side=L?1:-1,sat=units.flatMap(u=>u.length===1?u:u.filter(k=>passes(cp,k,side,i)));let rating=0;
 for(const k of cp.opt)if((side>0?cp.outs[k].L:cp.outs[k].S)[i]===1&&cp.outs[k].unknown?.[i]!==1){rating++;sat.push(k)} // volitelná bez dat se do hodnocení nepočítá
 return {side,rating,sat:sat.sort((a,b)=>a-b),both:false};
}
// úroveň podmínky, nebo skupiny NEBO (= první splněný člen skupiny v pořadí definice)
const levelOf=(cp:Compiled,from:string,key:LevelKey,side:Side,i:number):number=>{
 let k=cp.idx.get(from);
 if(k===undefined){const g=cp.groups?.get(from);if(!g)return NaN;k=g.find(q=>passes(cp,q,side,i));if(k===undefined)return NaN}
 const lv=(side>0?cp.outs[k].lvL:cp.outs[k].lvS)[key];return lv?lv[i]:NaN;
};
// cíl „zóna“: proximální hrana nejbližší protilehlé aktivní zóny podmínky `from` za vstupem (long → nabídka nad vstupem, short → poptávka pod)
export function zoneTarget(cp:Compiled,from:string,side:Side,avg:number,i:number):number|null{
 const k=cp.idx.get(from);if(k===undefined)return null;const z=cp.outs[k].zones;if(!z)return null;
 let best:number|null=null;for(const x of (side>0?z.S:z.L)[i]??B.NO_ZONES){const d=side*(x.proximal-avg);if(d>0&&(best===null||d<side*(best-avg)))best=x.proximal}
 return best;
}
export const SKIP_NO_ZONE='chybí cílová zóna';
// úrovňová matematika: zapsáno pro long, short zrcadlově (min ↔ max, posuny ATR / % opačně). base = vstup pro offsetPct a {r};
// sigBar = úroveň signální svíčky (low long / high short); need 'all' = chybějící úroveň → NaN
export function evalExpr(cp:Compiled,ex:Pick<LevelExpr,'op'|'of'|'offsetAtr'|'offsetPct'|'need'>,side:Side,i:number,a:number,base:{entry:number;sigBar:number;avg:number;risk:number|null}):number{
 const vals:number[]=[];
 for(const t of ex.of){let v:number;
  if('r' in t)v=base.risk===null?NaN:base.avg+side*t.r*base.risk;
  else if(t.from==='entry')v=base.entry;else if(t.from==='signal_bar')v=base.sigBar;else v=levelOf(cp,t.from,t.key,side,i);
  if(t.offsetAtr)v+=side*t.offsetAtr*a;
  if(Number.isFinite(v))vals.push(v);else if(ex.need!=='any')return NaN}
 if(!vals.length)return NaN;
 const lo=(ex.op==='min')===(side>0);let v=lo?Math.min(...vals):Math.max(...vals);
 if(ex.offsetAtr)v+=side*ex.offsetAtr*a;
 if(ex.offsetPct)v+=side*ex.offsetPct/100*Math.abs(base.avg-v);
 return v;
}
const exprNeedsAtr=(ex:Pick<LevelExpr,'of'|'offsetAtr'>)=>!!ex.offsetAtr||ex.of.some(t=>!!t.offsetAtr);
// všechny protilehlé úrovně podmínky (u bloků se seznamem zón / shluků každá protilehlá zóna), pro překážku 'between'
function oppositeLevels(cp:Compiled,from:string,key:LevelKey,side:Side,i:number):number[]{
 const out=[levelOf(cp,from,key,side,i)],k=cp.idx.get(from),z=k===undefined?undefined:cp.outs[k].zones;
 if(z)for(const x of (side>0?z.S:z.L)[i]??B.NO_ZONES)out.push(x.proximal);
 return out.filter(Number.isFinite);
}
export function riskPctOf(def:StrategyDef,rating:number):number{let p=def.risk.basePct;for(const x of def.risk.byRating)if(rating>=x.min)p=x.pct;return p}

// ---- plán obchodu ze signálu (úrovně vstupu, stop, cíl, TP1) – sdílí backtest i živá simulace
export type Plan={side:Side;legs:{L:number;share:number}[];stop:number;ref:number;target:number|null;tp1:number|null;risk:number;rr:number|null;rating:number;riskPct:number;sat:number[];
 targetFallback?:'r'|'swing'}; // cíl zóna nenalezen / pod minRR → použitý fallback
export type PlanSkip={skip:string};
export function planAt(def:StrategyDef,pm:PM,cp:Compiled,i:number,side:Side,rating:number,sat:number[],entryOverride?:number):Plan|PlanSkip{
 const E=pm.E,a=B.atrOf(E,def.stop.atrPeriod)[i];
 if(rating<def.risk.minRating)return {skip:SKIP_RATING};
 let legs:{L:number;share:number}[];
 if(def.entry.type==='market_on_close')legs=[{L:entryOverride??E.c[i],share:1}];
 else if(def.entry.legs)legs=def.entry.legs.map(l=>({L:l.type==='market_on_close'?E.c[i]:levelOf(cp,l.from,l.key,side,i),share:l.share})); // MOC noha: plán = close signální svíčky
 else legs=[{L:levelOf(cp,def.entry.from!,def.entry.key,side,i),share:1}];
 if(legs.some(l=>!Number.isFinite(l.L)))return {skip:'chybí úroveň vstupu'};
 const avg=legs.reduce((s,l)=>s+l.L*l.share,0),first=legs[0].L;
 let ref:number;const sx=def.stop.from==='expr'&&def.stop.of?def.stop as LevelExpr:null;
 if(sx&&exprNeedsAtr(sx)&&!(a>0))return {skip:'chybí ATR'};
 if(sx)ref=evalExpr(cp,sx,side,i,a,{entry:first,sigBar:side>0?E.l[i]:E.h[i],avg,risk:null});
 else if(def.stop.from==='entry')ref=first;else if(def.stop.from==='signal_bar')ref=side>0?E.l[i]:E.h[i];else ref=levelOf(cp,def.stop.from,def.stop.key,side,i);
 if(!Number.isFinite(ref))return {skip:'chybí úroveň stopu'};
 if((def.stop.atrK>0||def.stop.minAtrK>0)&&!(a>0))return {skip:'chybí ATR'};
 let stop=ref-side*def.stop.atrK*(a||0);
 if(def.stop.pct>0)stop-=side*def.stop.pct/100*Math.abs(first-ref);
 if(def.stop.minAtrK>0){for(const l of legs)if(side*(l.L-stop)<def.stop.minAtrK*a)stop=l.L-side*def.stop.minAtrK*a}
 if(legs.some(l=>!(side*(l.L-stop)>0)))return {skip:'stop na špatné straně vstupu'};
 const risk=side*(avg-stop);
 let target:number|null=null,ttype:'r'|'swing'|'level'|'zone'|'expr'=def.targets.type,fallback=false;
 if(ttype==='zone'){
  // nejbližší protilehlá zóna; chybí-li nebo je R:R pod minRR → fallback (none = bez obchodu)
  const z=zoneTarget(cp,def.targets.from!,side,avg,i),fb=def.targets.fallback??'none';
  if(z!==null&&!(def.targets.minRR>0&&side*(z-avg)/risk<def.targets.minRR))target=z;
  else if(fb==='none')return {skip:z===null?SKIP_NO_ZONE:SKIP_RR};
  else{ttype=fb;fallback=true;target=null}
 }
 if(ttype==='r')target=avg+side*def.targets.r*risk;
 else if(ttype==='swing'){const st=B.structure(E,def.targets.swingN);target=side>0?st.hi[i]:st.lo[i];if(!Number.isFinite(target)||!(side*(target-avg)>0))return {skip:'chybí protilehlý swing'}}
 else if(ttype==='level'){target=levelOf(cp,def.targets.from!,def.targets.key,side,i);if(!Number.isFinite(target)||!(side*(target-avg)>0))return {skip:'cíl na špatné straně'}}
 else if(ttype==='expr'){const tx=def.targets as LevelExpr;if(exprNeedsAtr(tx)&&!(a>0))return {skip:'chybí ATR'};
  target=evalExpr(cp,tx,side,i,a,{entry:avg,sigBar:side>0?E.h[i]:E.l[i],avg,risk});if(!Number.isFinite(target)||!(side*(target-avg)>0))return {skip:'cíl na špatné straně'}}
 if(target===null)return {skip:SKIP_NO_ZONE};
 const rr=side*(target-avg)/risk;
 if(def.targets.minRR>0&&rr<def.targets.minRR)return {skip:SKIP_RR};
 if(def.targets.obstacle){const O=def.targets.obstacle,tg=target;
  if(O.mode==='between'){if(oppositeLevels(cp,O.from,O.key,side,i).some(ob=>side*(ob-avg)>0&&side*(tg-ob)>0))return {skip:SKIP_OBSTACLE}}
  else{const ob=levelOf(cp,O.from,O.key,side,i);
   if(Number.isFinite(ob)&&side*(ob-avg)>0&&side*(target-ob)>0&&side*(ob-avg)/risk<Math.max(def.targets.minRR,1))return {skip:SKIP_OBSTACLE}}}
 // TP1: úroveň (mezi vstupem a cílem), jinak atR, jinak bez částečného výstupu
 const P1=def.targets.partial;let tp1:number|null=null;
 if(P1){if(P1.level&&(!exprNeedsAtr(P1.level)||a>0)){const v=evalExpr(cp,P1.level,side,i,a,{entry:avg,sigBar:side>0?E.h[i]:E.l[i],avg,risk});if(Number.isFinite(v)&&side*(v-avg)>0&&side*(target-v)>0)tp1=v}
  if(tp1===null&&P1.atR!==null)tp1=avg+side*P1.atR*risk}
 return {side,legs,stop,ref,target,tp1,risk,rr,rating,riskPct:riskPctOf(def,rating),sat,...(fallback?{targetFallback:ttype as 'r'|'swing'}:{})};
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

// ---- stopa obchodu: která podmínka dala jakou úroveň a kdy (čas události bloku), plánovaný vstup / stop / cíl – pro ukázkové obchody v grafu.
// Jen id podmínek, názvy bloků, ceny a časy – žádné parametry definice.
export type TraceCond={id:string;block:BlockId;role:Role;t:number|null;lv:Partial<Record<LevelKey,number>>;n?:Record<string,number>}; // n = nečenové hodnoty (počty dotyků)
export type Trace={sigBarT:number;legs:{L:number;share:number;from:string|null;key:LevelKey|null}[];stop:{price:number;ref:number;from:string;key:LevelKey|null};
 target:{price:number|null;type:string;from:string|null;key:LevelKey|null;fallback?:string};tp1:number|null;conds:TraceCond[]};
export function traceOf(def:StrategyDef,cp:Compiled,i:number,pl:Plan,sigBarT:number):Trace{
 const side=pl.side;
 const conds=pl.sat.map(k=>{const c=def.conditions[k],o=cp.outs[k],lv:Partial<Record<LevelKey,number>>={};
  for(const [key,arr] of Object.entries(side>0?o.lvL:o.lvS)){const v=arr?.[i];if(v!==undefined&&Number.isFinite(v))lv[key as LevelKey]=v}
  const tt=(side>0?o.tL:o.tS)?.[i],nn:Record<string,number>={};for(const [key,arr] of Object.entries(o.nums??{})){const v=arr[i];if(Number.isFinite(v))nn[key]=v}
  return {id:c.id,block:c.block,role:c.role,t:tt!==undefined&&Number.isFinite(tt)?tt:null,lv,...(Object.keys(nn).length?{n:nn}:{})}});
 const e=def.entry,legs=e.type==='market_on_close'?[{L:pl.legs[0].L,share:1,from:null,key:null}]
  :e.legs?pl.legs.map((l,q)=>{const d=e.legs![q];return d.type==='market_on_close'?{L:l.L,share:l.share,from:null,key:null}:{L:l.L,share:l.share,from:d.from,key:d.key}}):[{L:pl.legs[0].L,share:1,from:e.from,key:e.key}];
 const special=def.stop.from==='entry'||def.stop.from==='signal_bar'||def.stop.from==='expr',lvlT=(def.targets.type==='level'||def.targets.type==='zone')&&!pl.targetFallback;
 return {sigBarT,legs,stop:{price:pl.stop,ref:pl.ref,from:def.stop.from,key:special?null:def.stop.key},
  target:{price:pl.target,type:def.targets.type,from:lvlT?def.targets.from:null,key:lvlT?def.targets.key:null,...(pl.targetFallback?{fallback:pl.targetFallback}:{})},tp1:pl.tp1,conds};
}

// ---- fáze vstupu (diagnostika): co se stalo se svíčkami, kde platily všechny povinné podmínky. Součty (test check-lab-strategies.mjs):
//  allRequired = both + busy + setups;  setups = skipRating + skipRR + skipObstacle + skipLevel + placed;
//  market_on_close: placed = opened + blockSession + blockNews + blockFull + blockTrades + blockLoss;
//  limit: placed = opened + expired + pendingAtEnd + blockFull + blockTrades + blockLoss (blockSession / blockNews = dotyky limitu mimo okno, příkaz dál čeká).
export type Stages={bars:number;allRequired:number;both:number;busy:number;setups:number;skipRating:number;skipRR:number;skipObstacle:number;skipLevel:number;placed:number;
 blockSession:number;blockNews:number;blockFull:number;blockTrades:number;blockLoss:number;expired:number;pendingAtEnd:number;opened:number};
export const STAGE_KEYS:(keyof Stages)[]=['bars','allRequired','both','busy','setups','skipRating','skipRR','skipObstacle','skipLevel','placed','blockSession','blockNews','blockFull','blockTrades','blockLoss','expired','pendingAtEnd','opened'];
export const newStages=():Stages=>Object.fromEntries(STAGE_KEYS.map(k=>[k,0])) as Stages;
export const SKIP_RATING='hodnocení pod minimem',SKIP_RR='R:R pod minimem',SKIP_OBSTACLE='překážka před cílem';
const planSkipKey=(m:string):keyof Stages=>m===SKIP_RR?'skipRR':m===SKIP_OBSTACLE?'skipObstacle':m===SKIP_RATING?'skipRating':'skipLevel'; // chybí cílová zóna → skipLevel
// portfolioBlock → druh: plno (maxOpen), limit počtu obchodů, ztrátové stopky (stop-den, denní / týdenní limit ztráty)
export const blockKind=(m:string):'blockFull'|'blockTrades'|'blockLoss'=>m.startsWith('plno')?'blockFull':m.startsWith('limit')?'blockTrades':'blockLoss';

// ---- simulace (jeden průchod časem přes trhy)
export type Trade={market:string;side:Side;sigT:number;entryT:number;exitT:number;r:number;reason:'sl'|'be'|'tp'|'time'|'end';rating:number;riskPct:number;legs:number;partial:boolean;
 entry?:number;stop?:number;target?:number|null;exit?:number;trace?:Trace}; // entry = průměr plněných nohou (mid), stop = původní stop, exit = mid výstupu
// moc = noha market_on_close (when = index podmínky potvrzení, −1 = bez), spent = pokus proběhl; cancelAfter = poslední svíčka (od signální) pro plnění
type Leg={L:number;share:number;filled:boolean;fill:number;mid:number;moc:boolean;when:number;spent:boolean;cancelAfter:number;cancelAtTp1:boolean};
type Pos={side:Side;fillSide:Side;sig:number;sigT:number;legs:Leg[];stop:number;orig:number;target:number|null;tp1:number|null;risk:number;entryIdx:number;entryT:number;
 partialDone:boolean;pendingBE:boolean;rating:number;riskPct:number;partR:number;deadline:number;active:boolean;expires:number;type:'limit'|'market_on_close';h:HistTrade|null;
 inWin:boolean;trace:Trace|null;atClose?:boolean}; // atClose = pozici otevřela MOC noha (držení se počítá jako u market_on_close)
export type SimOut={trades:Trade[];skips:Record<string,number>;signals:number;unknown:Record<string,number>;stages?:Stages[]};
// diagFrom = sbírat fáze vstupu pro signální svíčky od tohoto času (null/undefined = bez diagnostiky); trace = stopa u každého obchodu
export type SimOpts={flipSeed?:number|null;to?:number;diagFrom?:number|null;trace?:boolean};
export function simulate(def:StrategyDef,pms:PM[],cps:Compiled[],ctx:Ctx,o:SimOpts={}):SimOut{
 const trades:Trade[]=[],skips:Record<string,number>={},hist:HistTrade[]=[],unknown:Record<string,number>={};
 const stages=o.diagFrom!=null?pms.map(()=>newStages()):null,diagFrom=o.diagFrom??Infinity;
 const st=(m:number,p:Pos|null,k:keyof Stages)=>{if(stages&&p?.inWin)stages[m][k]++};
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
  const entry=p.legs.reduce((s,l)=>s+(l.filled?l.mid*l.share:0),0)/filledShare;
  const t:Trade={market:pm.id,side,sigT:p.sigT,entryT:p.entryT,exitT,r,reason,rating:p.rating,riskPct:p.riskPct,legs:p.legs.filter(l=>l.filled).length,partial:p.partialDone,entry,stop:p.orig,target:p.target,exit:mid};
  if(p.trace)t.trace=p.trace;trades.push(t);
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
  const held=p.type==='market_on_close'||p.atClose?i-p.entryIdx:i-p.entryIdx+1;
  if(def.management.timeExitBars&&held>=def.management.timeExitBars){close(m,E.c[i],E.t[i],E.t[i]+E.ms,'time');return}
  if(def.management.beAtR&&p.stop===p.orig&&!p.pendingBE){const lvl=be(p)+p.side*def.management.beAtR*p.risk;if(p.side>0?E.h[i]>=lvl:E.l[i]<=lvl)p.pendingBE=true}
 };
 const open=(m:number,p:Pos,T:number,mid:number,legIdx:number,i:number)=>{
  p.active=true;p.entryIdx=i;p.entryT=T;openCount++;fillLeg(m,p.legs[legIdx],mid);st(m,p,'opened');
  p.h={entryT:T,knownAt:null,r:null};hist.push(p.h); // vstup se počítá do limitů hned, výsledek až po zavření
  p.deadline=def.management.timeExitClock?clockDeadline(def.management.timeExitClock.tz,def.management.timeExitClock.at,T):0;
 };
 // pending/aktivní pozice v jednom objektu: active=false = čeká limitní příkaz
 const fills=(m:number,i:number)=>{
  const p=pos[m];if(!p||p.type!=='limit')return;const E=pms[m].E,t=E.t[i],fs=p.fillSide;
  if(i>p.expires){if(!p.active){st(m,p,'expired');pos[m]=null;skip('limit vypršel')}return}
  for(const [k,l] of p.legs.entries()){
   if(l.filled||l.moc)continue;
   if(i-p.sig>l.cancelAfter||(l.cancelAtTp1&&p.partialDone))continue; // zrušená noha
   const atOpen=fs>0?E.o[i]<=l.L:E.o[i]>=l.L,touch=atOpen||(fs>0?E.l[i]<=l.L:E.h[i]>=l.L);if(!touch)continue;
   if(!p.active){
    const win=entryWindowOk(def,t);if(!win||newsBlocked(pms[m],t)){skip('mimo vstupní okno / zprávy');st(m,p,win?'blockNews':'blockSession');continue}
    const blk=portfolioBlock(def.filters,hist,t,openCount);if(blk){skip(blk);st(m,p,blockKind(blk));pos[m]=null;return}
    open(m,p,t,atOpen?E.o[i]:l.L,k,i);
    if(rnd)mirror(m,p);
    // v téže svíčce jen SL (gap plnění = celá svíčka)
    if(atOpen)exits(m,i);else{const st=p.stop;if(p.side>0?E.l[i]<=st:E.h[i]>=st){if(cons){close(m,st,t,t+E.ms,'sl');return}}}
    if(!pos[m])return;
   }else{fillLeg(m,l,atOpen?E.o[i]:l.L)}
  }
 };
 // MOC nohy na zavření svíčky i: první svíčka s platným potvrzením (jeden pokus); první plnění otevírá pozici (okno, zprávy, portfolio)
 const mocCheck=(m:number,i:number)=>{
  const p=pos[m];if(!p||p.type!=='limit'||i>p.expires)return;const E=pms[m].E,cp=cps[m],T=E.t[i]+E.ms;
  for(const [k,l] of p.legs.entries()){
   if(!l.moc||l.filled||l.spent||i-p.sig>l.cancelAfter||(l.cancelAtTp1&&p.partialDone))continue;
   if(l.when>=0&&!passes(cp,l.when,p.fillSide,i))continue;
   l.spent=true;const c=E.c[i];
   if(!(p.side*(c-p.stop)>0)||(p.target!==null&&!(p.side*(p.target-c)>0))){skip('MOC noha: close za stopem / cílem');continue}
   if(!p.active){
    const win=entryWindowOk(def,T);if(!win||newsBlocked(pms[m],T)){skip('mimo vstupní okno / zprávy');st(m,p,win?'blockNews':'blockSession');continue}
    const blk=portfolioBlock(def.filters,hist,T,openCount);if(blk){skip(blk);st(m,p,blockKind(blk));pos[m]=null;return}
    p.atClose=true;open(m,p,T,c,k,i);if(rnd)mirror(m,p);
   }else fillLeg(m,l,c);
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
  const pm=pms[m],cp=cps[m],E=pm.E,D=stages&&E.t[i]>=diagFrom?stages[m]:null;
  if(D)D.bars++;
  if(pos[m]){if(D){const sg=signalAt(def,cp,i);if(sg.side||sg.both){D.allRequired++;D.busy++}}return}
  const sg=signalAt(def,cp,i);if(sg.both){skip('obě strany zároveň');if(D){D.allRequired++;D.both++}return}if(!sg.side)return;
  signals++;if(D){D.allRequired++;D.setups++}
  for(const k of sg.sat){const u=cp.outs[k].unknown;if(u?.[i]){const id=def.conditions[k].block;unknown[id]=(unknown[id]||0)+1}}
  const pl=planAt(def,pm,cp,i,sg.side,sg.rating,sg.sat);if('skip' in pl){skip(pl.skip);if(D)D[planSkipKey(pl.skip)]++;return}
  if(D)D.placed++;
  const T=E.t[i]+E.ms;
  const p:Pos={side:pl.side,fillSide:pl.side,sig:i,sigT:T,legs:pl.legs.map((l,q)=>{const d=def.entry.legs?.[q];return {L:l.L,share:l.share,filled:false,fill:NaN,mid:NaN,moc:d?.type==='market_on_close',
    when:d?.when?cp.idx.get(d.when)??-1:-1,spent:false,cancelAfter:d?.cancelAfterBars??def.entry.validBars,cancelAtTp1:!!d?.cancelAtTp1}}),stop:pl.stop,orig:pl.stop,target:pl.target,tp1:pl.tp1,risk:pl.risk,
   entryIdx:-1,entryT:NaN,partialDone:false,pendingBE:false,rating:pl.rating,riskPct:pl.riskPct,partR:0,deadline:0,active:false,expires:i+def.entry.validBars,type:def.entry.type,h:null,
   inWin:!!D,trace:o.trace?traceOf(def,cp,i,pl,E.t[i]):null};
  if(def.entry.type==='market_on_close'){
   const win=entryWindowOk(def,T);if(!win||newsBlocked(pm,T)){skip('mimo vstupní okno / zprávy');st(m,p,win?'blockNews':'blockSession');return}
   const blk=portfolioBlock(def.filters,hist,T,openCount);if(blk){skip(blk);st(m,p,blockKind(blk));return}
   pos[m]=p;open(m,p,T,E.c[i],0,i);if(rnd)mirror(m,p);
  }else{pos[m]=p;mocCheck(m,i)}
 };
 const until=o.to??Infinity;
 for(;;){
  let T=Infinity;for(let m=0;m<pms.length;m++){const q=ptr[m];if(q<pms[m].E.n&&pms[m].E.t[q]<T)T=pms[m].E.t[q]}
  if(T===Infinity||T>=until)break;
  const now:number[]=[];for(let m=0;m<pms.length;m++)if(ptr[m]<pms[m].E.n&&pms[m].E.t[ptr[m]]===T)now.push(m);
  for(const m of now){const p=pos[m];if(p&&p.active)exits(m,ptr[m])}
  for(const m of now)fills(m,ptr[m]);
  for(const m of now){atClose(m,ptr[m]);const p=pos[m];if(p&&p.sig<ptr[m])mocCheck(m,ptr[m]);signal(m,ptr[m]);ptr[m]++}
 }
 for(let m=0;m<pms.length;m++){const p=pos[m];if(!p)continue;if(!p.active){st(m,p,'pendingAtEnd');pos[m]=null;continue}const E=pms[m].E,i=Math.min(E.n,ptr[m])-1;close(m,E.c[i],E.t[i],E.t[i]+E.ms,'end')}
 trades.sort((a,b)=>a.exitT-b.exitT||a.entryT-b.entryT);
 return stages?{trades,skips,signals,unknown,stages}:{trades,skips,signals,unknown};
}

// ---- diagnostika podmínek (čistá funkce nad zkompilovanými výstupy bloků) – „trychtýř“ v pořadí definice:
//  true = svíček, kdy podmínka platí (long nebo short podle entry.side), onsets = začátky souvislých úseků platnosti,
//  funnel[k] = svíček, kdy pro některou stranu platí všechny POVINNÉ podmínky až po k-tou (cond1 ∧ … ∧ condk),
//  firstFail[k] = svíček, kdy k-tá povinná podmínka byla PRVNÍ nesplněná (u lepší strany) = úzké hrdlo.
//  Skupina NEBO je v trychtýři JEDEN krok (na místě prvního člena): funnel/firstFail má skupina (groups[]), členové mají funnel/firstFail null
//  a pole group; true/onsets skupiny = svíčky, kdy platí aspoň jeden člen.
//  Součet: bars = Σ firstFail (podmínky + skupiny) + allRequired; funnel poslední povinné jednotky = allRequired. Volitelné / info podmínky
//  trychtýř neovlivňují (funnel/firstFail = null). stats = diagnostika detektoru bloku za celou historii (zóny / swingy / sweepy / MSS / FVG …).
export type CondDiag={id:string;block:BlockId;role:Role;tf:Tf;trueL:number;trueS:number;true:number;onsets:number;unknown:number;
 funnel:number|null;firstFail:number|null;stats:Record<string,number>|null;group?:string};
export type GroupDiag={id:string;members:string[];trueL:number;trueS:number;true:number;onsets:number;funnel:number;firstFail:number};
export type FunnelOut={bars:number;allRequired:number;conds:CondDiag[];groups:GroupDiag[]};
export function condFunnel(def:StrategyDef,cp:Compiled,pm:PM,from=-Infinity):FunnelOut{
 const E=pm.E,K=def.conditions.length,useL=def.entry.side!=='short',useS=def.entry.side!=='long';
 const units=unitsOfCp(def,cp),isGroup=(u:number[])=>u.length>1||!!def.conditions[u[0]].group;
 const conds:CondDiag[]=def.conditions.map((c,k)=>({id:c.id,block:c.block,role:c.role,tf:tfOf(def,c),trueL:0,trueS:0,true:0,onsets:0,unknown:0,
  funnel:c.role==='required'&&!c.group?0:null,firstFail:c.role==='required'&&!c.group?0:null,stats:cp.outs[k].stats?{...cp.outs[k].stats}:null,...(c.group?{group:c.group}:{})}));
 const gUnits=units.filter(isGroup),groups:GroupDiag[]=gUnits.map(u=>({id:def.conditions[u[0]].group??def.conditions[u[0]].id,members:u.map(k=>def.conditions[k].id),trueL:0,trueS:0,true:0,onsets:0,funnel:0,firstFail:0}));
 const gOf=new Map(gUnits.map((u,q)=>[u,groups[q]]));const gPrev=new Uint8Array(groups.length);
 let bars=0,all=0;const prev=new Uint8Array(K);
 for(let i=0;i<E.n;i++){
  const cur=new Uint8Array(K);
  for(let k=0;k<K;k++){const o=cp.outs[k],l=useL&&o.L[i]===1,s=useS&&o.S[i]===1;cur[k]=l||s?1:0;
   if(E.t[i]<from)continue;const d=conds[k];if(l)d.trueL++;if(s)d.trueS++;if(cur[k]){d.true++;if(!prev[k])d.onsets++}if(o.unknown?.[i])d.unknown++}
  prev.set(cur);
  gUnits.forEach((u,q)=>{const l=useL&&u.some(k=>cur[k]&&cp.outs[k].L[i]===1),s=useS&&u.some(k=>cur[k]&&cp.outs[k].S[i]===1),on=l||s?1:0;
   if(E.t[i]>=from){const g=groups[q];if(l)g.trueL++;if(s)g.trueS++;if(on){g.true++;if(!gPrev[q])g.onsets++}}gPrev[q]=on});
  if(E.t[i]<from)continue;bars++;
  let best=0;
  for(const side of [1,-1] as const){if(side>0?!useL:!useS)continue;let q=0;for(;q<units.length;q++){if(!units[q].some(k=>passes(cp,k,side,i)))break}if(q>best)best=q}
  const at=(u:number[]):{funnel:number|null;firstFail:number|null}=>gOf.get(u)??conds[u[0]];
  for(let q=0;q<best;q++)at(units[q]).funnel!++;
  if(best<units.length)at(units[best]).firstFail!++;else all++;
 }
 return {bars,allRequired:all,conds,groups};
}
export type MarketDiag={id:string;bars:number;allRequired:number;conds:CondDiag[];groups?:GroupDiag[];stages:Stages}; // groups chybí u starších výsledků
export type StratDiag={from:string;entryType:'limit'|'market_on_close';total:Omit<MarketDiag,'id'>;markets:MarketDiag[]};
const addRec=(a:Record<string,number>,b:Record<string,number>)=>{for(const [k,v] of Object.entries(b))a[k]=(a[k]||0)+v};
export function mergeDiag(ms:Omit<MarketDiag,'id'>[]):Omit<MarketDiag,'id'>{
 const out:Omit<MarketDiag,'id'>={bars:0,allRequired:0,conds:[],groups:[],stages:newStages()};
 for(const m of ms){out.bars+=m.bars;out.allRequired+=m.allRequired;addRec(out.stages,m.stages);
  (m.groups??[]).forEach((g,k)=>{const o=out.groups![k];if(!o){out.groups![k]={...g,members:[...g.members]};return}for(const f of ['trueL','trueS','true','onsets','funnel','firstFail'] as const)o[f]+=g[f]});
  m.conds.forEach((c,k)=>{const o=out.conds[k];if(!o){out.conds[k]={...c,stats:c.stats?{...c.stats}:null};return}
   for(const f of ['trueL','trueS','true','onsets','unknown'] as const)o[f]+=c[f];
   if(o.funnel!==null)o.funnel+=c.funnel!;if(o.firstFail!==null)o.firstFail+=c.firstFail!;
   if(c.stats){if(!o.stats)o.stats={};addRec(o.stats,c.stats)}})}
 return out;
}
export function buildDiag(def:StrategyDef,pms:PM[],cps:Compiled[],stages:Stages[],from:number):StratDiag{
 const markets=pms.map((pm,m)=>({id:pm.id,...condFunnel(def,cps[m],pm,from),stages:stages[m]}));
 return {from:Number.isFinite(from)?new Date(from).toISOString().slice(0,10):'',entryType:def.entry.type,total:mergeDiag(markets),markets};
}
// ukázkové obchody: rovnoměrně z IS a OOS (polovina z každého, zbytek doplní druhý úsek)
export type SampleTrade=Trade&{seg:'is'|'oos'};
export function pickSamples(trades:Trade[],split:number,max=50):SampleTrade[]{
 const is=trades.filter(t=>t.entryT<split),oos=trades.filter(t=>t.entryT>=split);
 const even=<T,>(a:T[],k:number)=>{if(k>=a.length)return [...a];const out:T[]=[];for(let q=0;q<k;q++)out.push(a[Math.floor(q*a.length/k)]);return out};
 const ko=Math.min(oos.length,max-Math.min(is.length,Math.ceil(max/2))),ki=Math.min(is.length,max-ko);
 return [...even(is,ki).map(t=>({...t,seg:'is' as const})),...even(oos,ko).map(t=>({...t,seg:'oos' as const}))];
}

// ---- vyhodnocení: IS / OOS, trhy, křivka, varianty, hranice náhody, robustnost
export type Metrics3={is:SegMetrics;oos:SegMetrics;all:SegMetrics};
export type VariantResult={name:string;metrics:Metrics3;nb:number|null;robust:boolean;returnPct:number;maxDdPct:number;
 perMarket:({id:string}&Metrics3)[];equity:[number,number][];skips:Record<string,number>;signals:number;unknown:Record<string,number>;trades:Trade[];
 diag?:StratDiag;samples?:SampleTrade[]}; // diag a samples chybí u výsledků spočítaných před diagnostikou
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
export type RunOpts={shuffles?:number;seed?:number;now?:number;keepTrades?:number;samples?:number;onProgress?:(msg:string)=>void};
export function runStrategy(def:StrategyDef,markets:MarketIn[],ctx:Ctx,o:RunOpts={}):StrategyRunResult{
 const t0=Date.now(),warnings:string[]=[],notes:string[]=[];
 const runs=defRuns(def),pms=markets.filter(m=>m.bars.length).map(m=>prepare(m.id,m.bars,def.data));
 for(const m of def.markets)if(!pms.some(p=>p.id===m))warnings.push(`${m}: v archivu nejsou svíčky ${def.data} – trh se netestuje.`);
 const sp=splitOf(def.data,pms),ids=pms.map(p=>p.id);
 const sims=runs.map(r=>{const cps=pms.map(pm=>compile(r.def,pm,ctx)),sim=simulate(r.def,pms,cps,ctx,{diagFrom:sp.from,trace:true});
  return {r,cps,sim,diag:buildDiag(r.def,pms,cps,sim.stages!,sp.from)}});
 o.onProgress?.(`varianty: ${sims.length}`);
 const evals=sims.map(x=>({...evaluate(x.sim.trades,ids,sp.from,sp.split),x}));
 const oosAvgs=evals.filter(e=>e.metrics.oos.trades>0).map(e=>e.metrics.oos.avgR as number),nb=median(oosAvgs);
 const keep=o.keepTrades??400;
 const variants:VariantResult[]=evals.map(e=>({name:e.x.r.name,metrics:e.metrics,nb:nb===null?null:rd(nb),robust:isRobustRun(e.metrics,nb),returnPct:e.returnPct,maxDdPct:e.maxDdPct,perMarket:e.perMarket,
  equity:e.equity,skips:e.x.sim.skips,signals:e.x.sim.signals,unknown:e.x.sim.unknown,trades:e.trades.slice(-keep).map(t=>{const c={...t};delete c.trace;return c}),
  diag:e.x.diag,samples:pickSamples(e.trades,sp.split,o.samples??50)}));
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

// ---- smíšené nohy v živé simulaci – stejná pravidla jako mocCheck / fills v simulate (dokončené svíčky sig … last)
function liveLegs(def:StrategyDef,cp:Compiled,E:B.Series,i:number,last:number,pl:Plan):LiveLeg[]{
 const side=pl.side,dl=def.entry.legs!,hit=(j:number,L:number)=>side>0?E.l[j]<=L:E.h[j]>=L;
 // první dotyk limitní nohy (≈ otevření pozice) a po něm zásah TP1 (≈ částečný výstup) – pro cancelAtTp1
 let f=-1;for(let j=i+1;j<=last&&f<0;j++)if(pl.legs.some((l,q)=>dl[q].type!=='market_on_close'&&j-i<=(dl[q].cancelAfterBars??def.entry.validBars)&&hit(j,l.L)))f=j;
 const tp1At=(j:number)=>{if(pl.tp1===null||f<0)return false;for(let q=f+1;q<=j;q++)if(side>0?E.h[q]>=pl.tp1:E.l[q]<=pl.tp1)return true;return false};
 return pl.legs.map((l,q)=>{const d=dl[q],N=d.cancelAfterBars??def.entry.validBars;
  if(d.type!=='market_on_close'){let touched=false;for(let j=i+1;j<=Math.min(last,i+N);j++)if(hit(j,l.L)){touched=true;break}return {L:l.L,share:l.share,...(touched?{touched}:{})}}
  const w=d.when?cp.idx.get(d.when)??-1:-1;let ready=false;
  for(let j=i;j<=Math.min(last,i+N);j++){if(d.cancelAtTp1&&tp1At(j))break;if(w>=0&&!passes(cp,w,side,j))continue;
   const c=E.c[j];ready=j===last&&side*(c-pl.stop)>0&&(pl.target===null||side*(pl.target-c)>0);break}
  return {L:l.L,share:l.share,type:'market_on_close' as const,ready};
 });
}
// ---- živá simulace (agenti R…): nastavení z DOKONČENÝCH svíček do času now
// smíšené nohy: type 'market_on_close' + ready = potvrzení přišlo PRÁVĚ na poslední dokončené svíčce (vstup teď za trh; dřív = propadlo),
// touched = limitní noha už byla na dokončených svíčkách dosažena (pozdě se nevstupuje; první vstup nastavení pak už ne)
export type LiveLeg={L:number;share:number;type?:'market_on_close';ready?:boolean;touched?:boolean};
export type LiveSetup={key:string;side:Side;type:'limit'|'market_on_close';sigT:number;legs:LiveLeg[];stop:number;target:number|null;tp1:number|null;
 risk:number;rating:number;riskPct:number;sat:string[];expiresT:number};
export function liveSetups(def:StrategyDef,id:string,bars:B.Bar[],ctx:Ctx,now:number):LiveSetup[]{
 const ms=B.TF_MS[def.data],done=bars.filter(b=>b.t+ms<=now);if(done.length<20)return [];
 const pm=prepare(id,done,def.data),cp=compile(def,pm,ctx),E=pm.E,last=E.n-1,out:LiveSetup[]=[];
 const win=def.entry.type==='limit'?def.entry.validBars:1;
 for(let i=Math.max(0,last-win+1);i<=last;i++){
  const sg=signalAt(def,cp,i);if(!sg.side)continue;
  const pl=planAt(def,pm,cp,i,sg.side,sg.rating,sg.sat);if('skip' in pl)continue;
  // limit, kterého cena po signálu už dosáhla na dokončených svíčkách, je propadlý (nevstupuje se pozdě)
  const mixed=def.entry.legs?.some(l=>l.type==='market_on_close');let legs:LiveLeg[]=pl.legs;
  if(def.entry.type==='limit'&&!mixed){let touched=false;for(let j=i+1;j<=last;j++)if(pl.legs.some(l=>sg.side>0?E.l[j]<=l.L:E.h[j]>=l.L)){touched=true;break}if(touched)continue}
  else if(mixed)legs=liveLegs(def,cp,E,i,last,pl);
  out.push({key:`${E.t[i]}:${sg.side}`,side:pl.side,type:def.entry.type,sigT:E.t[i]+ms,legs,stop:pl.stop,target:pl.target,tp1:pl.tp1,risk:pl.risk,rating:pl.rating,riskPct:pl.riskPct,
   sat:pl.sat.map(k=>condLabel(def.conditions[k],def)+(def.conditions[k].role==='optional'?' · volitelná':'')),expiresT:E.t[i]+ms+win*ms});
 }
 // u stejné strany jen nejnovější nastavení
 const seen=new Set<number>();return out.reverse().filter(s=>{if(seen.has(s.side))return false;seen.add(s.side);return true});
}
export const ruleOptionalCount=(def:StrategyDef)=>def.conditions.filter(c=>c.role==='optional').length;
