// Backtest engine (čistá funkce, testy scripts/check-backtest.mjs).
//
// Model provádění (rozhodnutí, ať je to na jednom místě):
// - Podmínky se vyhodnocují na ZAVŘENÍ svíčky i z dat 0..i; vstup na OTEVŘENÍ svíčky i+1 (žádný look-ahead).
//   Data Tradee (skóre, síla, COT) se ptají k času tData = zavření signální svíčky (t + délka svíčky);
//   časové podmínky (seance, den, hodina) a zprávy k času vstupu tTime = otevření další svíčky (není-li, t + délka svíčky).
// - Úrovně SL/TP se počítají od open vstupní svíčky (mid ceny svíček): SL = body × pip | % ceny | × ATR(14) signální svíčky,
//   TP = R × vzdálenost SL | body | % | žádné ('signal' a 'none' nemají cenovou úroveň).
// - Spread: vstup i výstup horší o polovinu spreadu (long kupuje o +s/2, prodává o −s/2; short obráceně).
//   Procentní spread (akcie, krypto) se přepočte na cenu z open vstupní svíčky a drží se po celý obchod.
// - R = (výstupní plnění − vstupní plnění)/(vstupní plnění − plnění na SL), se znaménkem podle směru → zásah SL = přesně −1 R
//   (riziko zahrnuje i spread); komise = commissionPct % rizika → od R se odečte commissionPct/100.
// - Velikost: riziko = riskPct % AKTUÁLNÍ (realizované) equity v okamžiku vstupu; jedna equity pro všechny trhy, P&L = R × riziko.
// - V téže svíčce: gap přes SL/TP (open za úrovní) → výstup na open; jinak SL i TP v rozsahu svíčky → SL (konzervativně).
//   Svíčka vstupu se kontroluje na SL/TP také (vstup na open, pak high/low).
// - Na zavření: výstup 'signal' (TP = „když vstupní podmínky přestanou platit“, u směru podle skóre i změna znaménka),
//   pak časový limit 'time' (počet držených svíček včetně vstupní ≥ maxBars); oba na close. Poslední svíčka období → 'end'.
// - Jedna pozice na trh, trhy současně povoleny. Pro každý čas: nejdřív se otevřou čekající vstupy (equity před výstupy v tomto čase),
//   pak se zpracují svíčky (výstupy, signály) v pořadí trhů.
// - Equity bod po každém uzavřeném obchodu (bez přeceňování otevřených pozic) + počáteční bod v `from`.
// - Svíčky před `from` slouží jen k zahřátí indikátorů; obchoduje se na svíčkách s from ≤ t < to.
// - Data Tradee bez hodnoty (undefined) → podmínka nesplněná; pokrytí (první/poslední čas s daty) a varování česky.
// - exitT/entryT = čas otevření svíčky, ve které výstup/vstup proběhl.
import {sma,ema,rsi,atr,highest,lowest} from './indicators.ts';
import {normalizeRules,instrumentSpec,spreadPrice,CONDITION_LABELS,type Condition,type StrategyRules} from './rules.ts';
import {sessionOfHour} from '../journal/analytics.ts';
import {pragueHour} from '../journal/stats.ts';
import {pragueDate} from '../mt/trades.ts';
import {fmtDate} from '../journal/format.ts';

export type BtBar={t:number;o:number;h:number;l:number;c:number}; // kompatibilní s Bar z lib/bars/yahoo.ts
export type BtTf='H1'|'D1';
export type CotPoint={net:number;change:number}; // netto pozice spekulantů a její týdenní změna (platí od data zveřejnění)
// kontext s daty Tradee; každá funkce vrací hodnotu známou k času t, nebo undefined = bez dat
export type BacktestContext={
 score?:(instrument:string,t:number)=>number|undefined;
 strength?:(ccy:string,t:number)=>number|undefined;
 cot?:(instrument:string,t:number)=>CotPoint|undefined;
 news?:(instrument:string,t:number,minutes:number,minSignal:number)=>boolean|undefined; // true = v okně ±minutes je zpráva se signálem ≥ minSignal
};
export type BacktestInput={rules:StrategyRules;markets:{instrument:string;bars:BtBar[]}[];tf:BtTf;from:number;to:number;capital?:number;context?:BacktestContext};
export type ExitReason='sl'|'tp'|'signal'|'time'|'end';
export type Side='long'|'short';
export type BacktestTrade={instrument:string;side:Side;entryT:number;entryPrice:number;sl:number;tp:number|null;exitT:number;exitPrice:number;reason:ExitReason;r:number;pnl:number;risk:number;bars:number};
export type EquityPoint={t:number;equity:number};
export type MarketResult={instrument:string;bars:number;trades:number;wins:number;winRate:number|null;totalR:number;avgR:number|null;pnl:number};
export type DataKey='score'|'strength'|'cot'|'news';
export type CoverageInfo={first:number|null;last:number|null;bars:number;missing:number}; // bars = vyhodnocených svíček, missing = z toho bez dat
export type Coverage=Partial<Record<DataKey,CoverageInfo>>;
export type BacktestResult={trades:BacktestTrade[];equity:EquityPoint[];perMarket:MarketResult[];coverage:Coverage;warnings:string[]};

export const BAR_MS:Record<BtTf,number>={H1:3600000,D1:86400000};
const DAY=86400000;
// ceny do uložených obchodů na 6 platných číslic (R a P&L se počítají z nezaokrouhlených hodnot)
const sig6=(n:number)=>Number.isFinite(n)&&n!==0?Number(n.toPrecision(6)):n;
const r2=(n:number)=>Math.round(n*100)/100,r4=(n:number)=>Math.round(n*10000)/10000;
const DATA_LABEL:Record<DataKey,string>={score:CONDITION_LABELS.score,strength:CONDITION_LABELS.strength,cot:CONDITION_LABELS.cot,news:'Zprávy'};

// pražská hodina a den v týdnu – Intl je drahý, proto memo po hodinách (posun Prahy je vždy celé hodiny)
const hourMemo=new Map<number,number>(),wdMemo=new Map<number,number>();
function pragueH(t:number){const k=Math.floor(t/3600000);let v=hourMemo.get(k);if(v===undefined){v=pragueHour(k*3600000);hourMemo.set(k,v)}return v}
function pragueWd(t:number){const k=Math.floor(t/3600000);let v=wdMemo.get(k);if(v===undefined){v=(new Date(pragueDate(k*3600000)+'T12:00:00Z').getUTCDay()+6)%7;wdMemo.set(k,v)}return v}

type Track=(key:DataKey,has:boolean,t:number)=>void;
type Ev=(i:number,tData:number,tTime:number)=>boolean;
type Series={o:Float64Array;h:Float64Array;l:Float64Array;c:Float64Array;get:(key:string,make:()=>Float64Array)=>Float64Array};
const maOf=(s:Series,kind:'sma'|'ema',p:number)=>s.get(kind+':'+p,()=>kind==='sma'?sma(s.c,p):ema(s.c,p));
const atr14=(s:Series)=>s.get('atr:14',()=>atr(s.h,s.l,s.c,14));
const ok=(x:number)=>!Number.isNaN(x);

// podmínka → vyhodnocovač podle indexu (indikátory předpočítané jednou na trh, sdílená cache podle klíče)
function compile(c:Condition,inst:string,s:Series,ctx:BacktestContext,track:Track):Ev{
 const C=s.c;
 switch(c.type){
  case 'ma':{const m=maOf(s,c.kind,c.period);return i=>ok(m[i])&&(c.op==='above'?C[i]>m[i]:C[i]<m[i])}
  case 'ma_cross':{const f=maOf(s,c.kind,c.fast),w=maOf(s,c.kind,c.slow);
   return i=>i>0&&ok(f[i-1])&&ok(w[i-1])&&ok(f[i])&&ok(w[i])&&(c.dir==='up'?f[i-1]<=w[i-1]&&f[i]>w[i]:f[i-1]>=w[i-1]&&f[i]<w[i])}
  case 'breakout':{const e=c.dir==='up'?s.get('hh:'+c.period,()=>highest(s.h,c.period)):s.get('ll:'+c.period,()=>lowest(s.l,c.period));
   return i=>i>0&&ok(e[i-1])&&(c.dir==='up'?C[i]>e[i-1]:C[i]<e[i-1])} // jen předchozích N svíček
  case 'ma_distance':{const m=maOf(s,c.kind,c.period),a=atr14(s);
   return i=>{if(!ok(m[i])||!ok(a[i])||a[i]<=0)return false;const d=(C[i]-m[i])/a[i];return c.op==='>'?d>c.value:d<c.value}}
  case 'rsi':{const r=s.get('rsi:'+c.period,()=>rsi(C,c.period)),v=c.value;
   if(c.op==='>')return i=>ok(r[i])&&r[i]>v;
   if(c.op==='<')return i=>ok(r[i])&&r[i]<v;
   if(c.op==='cross_up')return i=>i>0&&ok(r[i-1])&&ok(r[i])&&r[i-1]<v&&r[i]>=v;
   return i=>i>0&&ok(r[i-1])&&ok(r[i])&&r[i-1]>v&&r[i]<=v}
  case 'change':return i=>{if(i<c.bars||!(C[i-c.bars]>0))return false;const p=(C[i]/C[i-c.bars]-1)*100;return c.op==='>'?p>c.value:p<c.value};
  case 'atr':{const a=atr14(s),avg=s.get('atrAvg:14:'+c.period,()=>sma(a,c.period));
   return i=>ok(a[i])&&ok(avg[i])&&(c.op==='above'?a[i]>avg[i]*c.k:a[i]<avg[i]*c.k)}
  case 'session':{const set=new Set(c.sessions);return (i,_d,t)=>set.has(sessionOfHour(pragueH(t)))}
  case 'weekday':{const set=new Set(c.days);return (i,_d,t)=>set.has(pragueWd(t))}
  case 'hour':return (i,_d,t)=>{const h=pragueH(t);return c.from<c.to?h>=c.from&&h<c.to:h>=c.from||h<c.to};
  case 'score':return (i,t)=>{
   const v=ctx.score?.(inst,t);
   if(c.op==='>'||c.op==='<'){track('score',v!==undefined,t);return v!==undefined&&(c.op==='>'?v>c.value:v<c.value)}
   const p=v===undefined?undefined:ctx.score?.(inst,t-c.days*DAY),has=v!==undefined&&p!==undefined;track('score',has,t);
   return has&&(c.op==='rising'?v>p:v<p)};
  case 'strength':{const sp=instrumentSpec(inst);return (i,t)=>{
   const b=sp.base&&ctx.strength?ctx.strength(sp.base,t):undefined,q=b!==undefined&&sp.quote&&ctx.strength?ctx.strength(sp.quote,t):undefined;
   const has=b!==undefined&&q!==undefined;track('strength',has,t);if(!has)return false;const d=b-q;return c.op==='>'?d>c.value:d<c.value}}
  case 'cot':return (i,t)=>{const v=ctx.cot?.(inst,t);track('cot',v!==undefined,t);if(!v)return false;
   return c.op==='long'?v.net>0:c.op==='short'?v.net<0:c.op==='>'?v.change>c.value:v.change<c.value};
  case 'no_news':return (i,_d,t)=>{const v=ctx.news?.(inst,t,c.minutes,c.minSignal);track('news',v!==undefined,t);return v===false};
 }
}

type Pos={side:Side;entryIdx:number;entryT:number;fill:number;sl:number;tp:number|null;half:number;riskUnit:number;risk:number};
type Mk={inst:string;bars:BtBar[];start:number;end:number;ptr:number;s:Series;conds:Ev[];pos:Pos|null;pending:{side:Side;sig:number}|null;res:MarketResult};

export function runBacktest(input:BacktestInput):BacktestResult{
 const rules=normalizeRules(input.rules),ctx=input.context||{},barMs=BAR_MS[input.tf]||BAR_MS.H1;
 const capital=input.capital??rules.sizing.capital,from=input.from,to=input.to,warnings:string[]=[];
 const coverage:Coverage={};
 const track:Track=(key,has,t)=>{const c=coverage[key]||(coverage[key]={first:null,last:null,bars:0,missing:0});c.bars++;
  if(has){if(c.first===null||t<c.first)c.first=t;if(c.last===null||t>c.last)c.last=t}else c.missing++};
 const trades:BacktestTrade[]=[],equityPts:EquityPoint[]=[{t:from,equity:capital}];
 let equity=capital,broke=false;
 const {sl:slRule,tp:tpRule,maxBars}=rules.exit,commR=rules.costs.commissionPct/100,riskPct=rules.sizing.riskPct/100;
 if(!rules.entry.length)warnings.push('Strategie nemá žádnou vstupní podmínku – žádné obchody.');

 const mks:Mk[]=[];
 for(const m of input.markets){
  let bars=m.bars;for(let i=1;i<bars.length;i++)if(bars[i].t<bars[i-1].t){bars=[...bars].sort((a,b)=>a.t-b.t);break}
  const n=bars.length,o=new Float64Array(n),h=new Float64Array(n),l=new Float64Array(n),c=new Float64Array(n);
  for(let i=0;i<n;i++){const b=bars[i];o[i]=b.o;h[i]=b.h;l[i]=b.l;c[i]=b.c}
  const cache=new Map<string,Float64Array>();
  const s:Series={o,h,l,c,get:(k,make)=>{let v=cache.get(k);if(!v){v=make();cache.set(k,v)}return v}};
  let start=0;while(start<n&&bars[start].t<from)start++;
  let end=start;while(end<n&&bars[end].t<to)end++;
  const res:MarketResult={instrument:m.instrument,bars:end-start,trades:0,wins:0,winRate:null,totalR:0,avgR:null,pnl:0};
  if(end===start)warnings.push(`${m.instrument}: ve zvoleném období nejsou žádné svíčky.`);
  if(slRule.type==='atr')atr14(s);
  mks.push({inst:m.instrument,bars,start,end,ptr:start,s,conds:rules.entry.map(cd=>compile(cd,m.instrument,s,ctx,track)),pos:null,pending:null,res});
 }

 // směr pro svíčku i (null = bez obchodu); u 'score' podle znaménka skóre k času tData
 const sideAt=(mk:Mk,tData:number):Side|null=>{
  if(rules.direction!=='score')return rules.direction;
  const v=ctx.score?.(mk.inst,tData);track('score',v!==undefined,tData);
  return v===undefined||v===0?null:v>0?'long':'short';
 };
 const close=(mk:Mk,i:number,mid:number,reason:ExitReason)=>{
  const p=mk.pos!,dir=p.side==='long'?1:-1,fill=mid-dir*p.half;
  const r=r4(dir*(fill-p.fill)/p.riskUnit-commR),pnl=r2(r*p.risk);
  trades.push({instrument:mk.inst,side:p.side,entryT:p.entryT,entryPrice:sig6(p.fill),sl:sig6(p.sl),tp:p.tp===null?null:sig6(p.tp),exitT:mk.bars[i].t,exitPrice:sig6(fill),reason,r,pnl,risk:r2(p.risk),bars:i-p.entryIdx+1});
  equity=r2(equity+pnl);equityPts.push({t:mk.bars[i].t,equity});
  mk.res.trades++;if(pnl>0)mk.res.wins++;mk.res.totalR+=r;mk.res.pnl+=pnl;
  if(equity<=0&&!broke){broke=true;warnings.push('Účet klesl na nulu – další obchody se neotevírají.')}
  mk.pos=null;
 };
 const open=(mk:Mk,i:number)=>{
  const pd=mk.pending!;mk.pending=null;
  if(broke||equity<=0)return;
  const b=mk.bars[i],o=b.o,spec=instrumentSpec(mk.inst),dir=pd.side==='long'?1:-1;
  const slDist=slRule.type==='pips'?slRule.value*spec.pip:slRule.type==='pct'?slRule.value/100*o:slRule.value*atr14(mk.s)[pd.sig];
  if(!(slDist>0))return; // ATR ještě není (zahřívání)
  const tpDist=tpRule.type==='r'?tpRule.value*slDist:tpRule.type==='pips'?tpRule.value*spec.pip:tpRule.type==='pct'?tpRule.value/100*o:null;
  const half=spreadPrice(mk.inst,o,rules)/2,fill=o+dir*half;
  mk.pos={side:pd.side,entryIdx:i,entryT:b.t,fill,sl:o-dir*slDist,tp:tpDist===null?null:o+dir*tpDist,half,riskUnit:slDist+2*half,risk:equity*riskPct};
 };
 const step=(mk:Mk,i:number)=>{
  const b=mk.bars[i],last=i===mk.end-1,tData=b.t+barMs,tTime=last?tData:mk.bars[i+1].t;
  let p=mk.pos;
  if(p){
   const L=p.side==='long';
   if(p.entryIdx<i&&(L?b.o<=p.sl:b.o>=p.sl))close(mk,i,b.o,'sl'); // gap přes SL
   else if(p.entryIdx<i&&p.tp!==null&&(L?b.o>=p.tp:b.o<=p.tp))close(mk,i,b.o,'tp'); // gap přes TP
   else if(L?b.l<=p.sl:b.h>=p.sl)close(mk,i,p.sl,'sl'); // SL má přednost před TP v téže svíčce
   else if(p.tp!==null&&(L?b.h>=p.tp:b.l<=p.tp))close(mk,i,p.tp,'tp');
  }
  // vstupní podmínky na zavření svíčky (vyhodnocují se všechny – kvůli pokrytí dat)
  let all=mk.conds.length>0;for(const ev of mk.conds)if(!ev(i,tData,tTime))all=false;
  const sd=rules.direction==='score'?sideAt(mk,tData):rules.direction,side=all?sd:null;
  p=mk.pos;
  if(p){
   if(tpRule.type==='signal'&&side!==p.side)close(mk,i,b.c,'signal');
   else if(maxBars!==null&&i-p.entryIdx+1>=maxBars)close(mk,i,b.c,'time');
  }
  if(mk.pos&&last)close(mk,i,b.c,'end');
  if(!mk.pos&&!last&&side)mk.pending={side,sig:i};
 };

 // časová osa přes všechny trhy (k-cestné slévání po ukazatelích)
 for(;;){
  let T=Infinity;for(const mk of mks)if(mk.ptr<mk.end&&mk.bars[mk.ptr].t<T)T=mk.bars[mk.ptr].t;
  if(T===Infinity)break;
  for(const mk of mks)if(mk.ptr<mk.end&&mk.bars[mk.ptr].t===T&&mk.pending)open(mk,mk.ptr);
  for(const mk of mks)if(mk.ptr<mk.end&&mk.bars[mk.ptr].t===T){step(mk,mk.ptr);mk.ptr++}
 }

 for(const mk of mks){const x=mk.res;x.totalR=r4(x.totalR);x.pnl=r2(x.pnl);x.winRate=x.trades?r2(100*x.wins/x.trades):null;x.avgR=x.trades?r4(x.totalR/x.trades):null}
 for(const k of Object.keys(coverage) as DataKey[]){
  const c=coverage[k]!;if(!c.missing)continue;
  if(c.first===null)warnings.push(`${DATA_LABEL[k]}: pro zvolené trhy a období nejsou žádná data – podmínka nikdy neplatí.`);
  else warnings.push(`${DATA_LABEL[k]}: data jsou jen od ${fmtDate(pragueDate(c.first))} do ${fmtDate(pragueDate(c.last as number))}; mimo ně podmínka neplatí (${Math.round(100*c.missing/c.bars)} % svíček bez dat).`);
 }
 trades.sort((a,b)=>a.exitT-b.exitT||a.entryT-b.entryT);
 return {trades,equity:equityPts,perMarket:mks.map(m=>m.res),coverage,warnings};
}
