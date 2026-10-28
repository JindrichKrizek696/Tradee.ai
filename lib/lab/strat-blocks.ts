// Laboratoř · Strategie: obecné stavební bloky (čisté funkce, testy scripts/check-lab-strategies.mjs).
//
// BEZ POHLEDU DO BUDOUCNA – pravidla na jednom místě:
//  • Každá hodnota na indexu i používá jen svíčky 0..i (vyhodnocení na ZAVŘENÍ svíčky i). Useknutí budoucích svíček nesmí změnit minulost
//    (test v check-lab-strategies.mjs projde všechny bloky).
//  • Swing (fraktál N) na svíčce j je POTVRZENÝ až na svíčce j+N; do té doby o něm blok neví.
//  • Vyšší TF (H4/D1/W1/MN): svíčka vyššího TF se smí použít až když je UZAVŘENÁ – done[i] = poslední celá svíčka vyššího TF při zavření
//    svíčky i (zavření svíčky i patří do dalšího koše → koš je celý; jinak předchozí koš).
//  • COT platí až od času zveřejnění (available_at), sezonalita jen z předchozích let, zprávy jen v období, které kalendář pokrývá.
import {atr as atrW,ema as emaF,sma as smaF} from '../backtest/indicators.ts';
import {offset,zoned} from '../market-hours.ts';
import type {Tf,DataTf,SessionDef} from './rules-def.ts';

export type Bar={t:number;o:number;h:number;l:number;c:number};
export const H=3600000,DAY=86400000;
// délka svíčky pro „uzavřena do času T“ (t + ms ≤ T): u měsíce 31 dní, ať se měsíc nikdy nepoužije dřív, než skončí
export const TF_MS:Record<Tf,number>={H1:H,H4:4*H,D1:DAY,W1:7*DAY,MN:31*DAY};

// ---- časové zóny: posun po hodinách (přechody letního času jsou vždy na celé hodině UTC) – Intl je drahý, proto memo
const offMemo=new Map<string,number>();
export function tzOff(tz:string,t:number):number{
 const k=Math.floor(t/H),key=tz+'|'+k;let v=offMemo.get(key);
 if(v===undefined){if(offMemo.size>400000)offMemo.clear();v=offset(tz,k*H);offMemo.set(key,v)}
 return v;
}
export const localMin=(tz:string,t:number)=>{const x=t+tzOff(tz,t)*60000;return Math.floor((((x%DAY)+DAY)%DAY)/60000)};
export const localDay=(tz:string,t:number)=>Math.floor((t+tzOff(tz,t)*60000)/DAY);
export const hhmm=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3,5));

// ---- obchodní den svíčky: D1 z Yahoo (FX 22/23:00 UTC předchozího dne, futures ráno, indexy odpoledne) → +2 h;
// H1 → den FX končí v 17:00 New York (posun +7 h ⇒ 17:00 NY = půlnoc)
export const tradeDayD1=(t:number)=>Math.floor((t+2*H)/DAY);
export const tradeDayH1=(t:number)=>Math.floor((t+tzOff('America/New_York',t)*60000+7*H)/DAY);
export const tradeDayOf=(data:DataTf)=>data==='D1'?tradeDayD1:tradeDayH1;
// klíč koše vyššího TF z času svíčky základních dat
export function tfKey(tf:Tf,data:DataTf):(t:number)=>number{
 const day=tradeDayOf(data);
 if(tf==='H1')return t=>Math.floor(t/H);
 if(tf==='H4')return t=>Math.floor(t/(4*H));
 if(tf==='D1')return day;
 if(tf==='W1')return t=>Math.floor((day(t)+3)/7); // týden od pondělí (den 0 = čtvrtek 1. 1. 1970)
 return t=>{const d=new Date(day(t)*DAY);return d.getUTCFullYear()*12+d.getUTCMonth()};
}
export type Agg={bars:Bar[];bucket:Int32Array;done:Int32Array};
// agregace základních svíček do vyššího TF; done[i] = index poslední UZAVŘENÉ svíčky vyššího TF při zavření svíčky i (−1 = žádná)
export function aggregate(base:Bar[],baseMs:number,key:(t:number)=>number):Agg{
 const n=base.length,bars:Bar[]=[],bucket=new Int32Array(n),done=new Int32Array(n);let lastK=NaN;
 for(let i=0;i<n;i++){
  const b=base[i],k=key(b.t);
  if(k!==lastK){bars.push({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c});lastK=k}
  else{const x=bars[bars.length-1];if(b.h>x.h)x.h=b.h;if(b.l<x.l)x.l=b.l;x.c=b.c}
  bucket[i]=bars.length-1;
  done[i]=key(b.t+baseMs)!==k?bars.length-1:bars.length-2;
 }
 return {bars,bucket,done};
}

// ---- série s cache indikátorů
export type Series={tf:Tf;n:number;t:Float64Array;o:Float64Array;h:Float64Array;l:Float64Array;c:Float64Array;ms:number;get:<T>(k:string,make:()=>T)=>T};
export function series(bars:Bar[],tf:Tf):Series{
 const F=(f:(b:Bar)=>number)=>Float64Array.from(bars,f),cache=new Map<string,unknown>();
 return {tf,n:bars.length,t:F(b=>b.t),o:F(b=>b.o),h:F(b=>b.h),l:F(b=>b.l),c:F(b=>b.c),ms:TF_MS[tf],get:<T,>(k:string,make:()=>T)=>{let v=cache.get(k) as T|undefined;if(v===undefined){v=make();cache.set(k,v)}return v}};
}
export const atrOf=(s:Series,p=14)=>s.get('atr:'+p,()=>atrW(s.h,s.l,s.c,p));
export const emaOf=(s:Series,p:number)=>s.get('ema:'+p,()=>emaF(s.c,p));
export const smaOf=(s:Series,p:number)=>s.get('sma:'+p,()=>smaF(s.c,p));

// ---- fraktální swingy: high na j je swing, když je vyšší než N svíček před a ≥ N svíček po (shoda → dřívější); potvrzení na j+N
export type Swing={i:number;price:number;conf:number;high:boolean};
export function swings(h:ArrayLike<number>,l:ArrayLike<number>,N:number):Swing[]{
 const out:Swing[]=[],n=h.length;
 for(let j=N;j+N<n;j++){
  let hi=true,lo=true;
  for(let k=1;k<=N;k++){if(!(h[j]>h[j-k])||h[j]<h[j+k])hi=false;if(!(l[j]<l[j-k])||l[j]>l[j+k])lo=false;if(!hi&&!lo)break}
  if(hi)out.push({i:j,price:h[j],conf:j+N,high:true});
  if(lo)out.push({i:j,price:l[j],conf:j+N,high:false});
 }
 return out;
}
// stav struktury po svíčkách (jen potvrzené swingy): poslední a předposlední swing high/low, trend +1 (HH+HL) / −1 (LH+LL) / 0
export type Structure={hi:Float64Array;hiI:Int32Array;hi2:Float64Array;lo:Float64Array;loI:Int32Array;lo2:Float64Array;trend:Int8Array};
export function structure(s:Series,N:number):Structure{
 return s.get('struct:'+N,()=>{
  const n=s.n,sw=swings(s.h,s.l,N).sort((a,b)=>a.conf-b.conf||a.i-b.i);
  const hi=new Float64Array(n).fill(NaN),hi2=new Float64Array(n).fill(NaN),lo=new Float64Array(n).fill(NaN),lo2=new Float64Array(n).fill(NaN),hiI=new Int32Array(n).fill(-1),loI=new Int32Array(n).fill(-1),trend=new Int8Array(n);
  let a=NaN,a2=NaN,ai=-1,b=NaN,b2=NaN,bi=-1,k=0;
  for(let i=0;i<n;i++){
   while(k<sw.length&&sw[k].conf<=i){const w=sw[k++];if(w.high){a2=a;a=w.price;ai=w.i}else{b2=b;b=w.price;bi=w.i}}
   hi[i]=a;hi2[i]=a2;hiI[i]=ai;lo[i]=b;lo2[i]=b2;loI[i]=bi;
   trend[i]=a>a2&&b>b2?1:a<a2&&b<b2?-1:0;
  }
  return {hi,hiI,hi2,lo,loI,lo2,trend};
 });
}

// ---- výstup bloku po svíčkách: L/S = podmínka platí pro long/short; úrovně podle strany (NaN = není)
export type Levels=Partial<Record<'proximal'|'distal'|'mid'|'level'|'extreme'|'high'|'low',Float64Array>>;
export type Out={L:Uint8Array;S:Uint8Array;lvL:Levels;lvS:Levels;unknown?:Uint8Array}; // unknown = blok nemohl být vyhodnocen (chybí data) → bere se jako splněný, počítá se pokrytí
export function newOut(n:number,keys:string[]):Out{
 const mk=()=>Object.fromEntries(keys.map(k=>[k,new Float64Array(n).fill(NaN)])) as Levels;
 return {L:new Uint8Array(n),S:new Uint8Array(n),lvL:mk(),lvS:mk()};
}

// ---- trend ze swingů
export function trendSwing(s:Series,N:number):Out{
 const st=structure(s,N),o=newOut(s.n,['high','low']);
 for(let i=0;i<s.n;i++){o.L[i]=st.trend[i]>0?1:0;o.S[i]=st.trend[i]<0?1:0;o.lvL.high![i]=o.lvS.high![i]=st.hi[i];o.lvL.low![i]=o.lvS.low![i]=st.lo[i]}
 return o;
}
// ---- klouzavý průměr: cena nad/pod nebo sklon za slopeBars
export function maBlock(s:Series,p:{kind:string;period:number;mode:string;slopeBars:number}):Out{
 const m=p.kind==='sma'?smaOf(s,p.period):emaOf(s,p.period),o=newOut(s.n,['level']);
 for(let i=0;i<s.n;i++){
  if(Number.isNaN(m[i]))continue;
  if(p.mode==='slope'){const j=i-p.slopeBars;if(j<0||Number.isNaN(m[j]))continue;o.L[i]=m[i]>m[j]?1:0;o.S[i]=m[i]<m[j]?1:0}
  else{o.L[i]=s.c[i]>m[i]?1:0;o.S[i]=s.c[i]<m[i]?1:0}
  o.lvL.level![i]=o.lvS.level![i]=m[i];
 }
 return o;
}
// ---- volatilita: ATR vs SMA(ATR) × k (nesměrový)
export function atrRegime(s:Series,p:{period:number;avg:number;op:string;k:number}):Out{
 const a=atrOf(s,p.period),avg=s.get(`atravg:${p.period}:${p.avg}`,()=>smaF(a,p.avg)),o=newOut(s.n,[]);
 for(let i=0;i<s.n;i++){if(Number.isNaN(a[i])||Number.isNaN(avg[i]))continue;const ok=p.op==='above'?a[i]>avg[i]*p.k:a[i]<avg[i]*p.k;o.L[i]=o.S[i]=ok?1:0}
 return o;
}

// ---- zóny nabídky / poptávky a order blocky
export type Zone={id:number;side:1|-1;proximal:number;distal:number;created:number;baseFrom:number;baseTo:number};
export type ZoneStatus='fresh'|'touched'|'mitigated'|'invalidated';
export type ZoneParams={impulseK:number;atrPeriod:number;swingN:number;requireBreak:boolean;proximal:string;maxBase?:number;baseBodyRatio?:number;lookback?:number};
// impulz na svíčce i: tělo ≥ k × ATR(i) a (requireBreak) zavření za posledním potvrzeným swingem → zóna z base svíček (zone) nebo
// z poslední opačné svíčky (order block). Zóna je známá na zavření impulzní svíčky.
export function findZones(s:Series,p:ZoneParams,kind:'zone'|'ob'):Zone[]{
 const a=atrOf(s,p.atrPeriod),st=structure(s,p.swingN),out:Zone[]=[];
 for(let i=1;i<s.n;i++){
  const body=Math.abs(s.c[i]-s.o[i]);if(!(a[i]>0)||body<p.impulseK*a[i])continue;
  const side:1|-1=s.c[i]>s.o[i]?1:-1;
  if(p.requireBreak){const lvl=side>0?st.hi[i-1]:st.lo[i-1];if(Number.isNaN(lvl)||(side>0?!(s.c[i]>lvl):!(s.c[i]<lvl)))continue}
  let from=-1,to=-1;
  if(kind==='zone'){
   const maxB=p.maxBase??3,ratio=p.baseBodyRatio??.5;
   for(let j=i-1;j>=0&&i-j<=maxB;j--){const r=s.h[j]-s.l[j],bd=Math.abs(s.c[j]-s.o[j]);if(r>0&&bd<=ratio*r){from=j;if(to<0)to=j}else break}
   if(from<0)continue;
  }else{
   for(let j=i-1;j>=0&&i-j<=(p.lookback??3);j--)if(side>0?s.c[j]<s.o[j]:s.c[j]>s.o[j]){from=to=j;break}
   if(from<0)continue;
  }
  let prox=side>0?-Infinity:Infinity,dist=side>0?Infinity:-Infinity;
  for(let j=from;j<=to;j++){
   if(side>0){prox=Math.max(prox,p.proximal==='wick'?s.h[j]:Math.max(s.o[j],s.c[j]));dist=Math.min(dist,s.l[j])}
   else{prox=Math.min(prox,p.proximal==='wick'?s.l[j]:Math.min(s.o[j],s.c[j]));dist=Math.max(dist,s.h[j])}
  }
  if(side>0?!(prox>dist):!(prox<dist))continue;
  out.push({id:i,side,proximal:prox,distal:dist,created:i,baseFrom:from,baseTo:to});
 }
 return out;
}
// stav zóny při zavření svíčky i (sleduje svíčky created+1 … i): dotek = cena (knot / close podle mitigation) na proximální hraně,
// mitigace % = hloubka průniku do zóny, zneplatnění = close (nebo knot) za distální hranou
export type ZoneTrack={status:ZoneStatus;pct:number;touchedAt:number;invalidAt:number};
export function trackZone(z:Zone,s:Series,i:number,o:{mitigation:string;invalidate:string;maxMitigationPct:number}):ZoneTrack{
 let deep=-Infinity,touchedAt=-1,invalidAt=-1;const w=z.proximal-z.distal;
 for(let j=z.created+1;j<=i&&j<s.n;j++){
  const px=z.side>0?(o.mitigation==='close'?s.c[j]:s.l[j]):(o.mitigation==='close'?s.c[j]:s.h[j]);
  const pen=(z.proximal-px)/w; // >0 = uvnitř zóny (pro obě strany díky znaménku w)
  if(pen>=0&&touchedAt<0)touchedAt=j;
  if(pen>deep)deep=pen;
  const inv=z.side>0?(o.invalidate==='wick'?s.l[j]:s.c[j])<z.distal:(o.invalidate==='wick'?s.h[j]:s.c[j])>z.distal;
  if(inv){invalidAt=j;break}
 }
 const pct=Math.max(0,Math.min(100,deep*100));
 return {status:invalidAt>=0?'invalidated':touchedAt<0?'fresh':pct>=o.maxMitigationPct?'mitigated':'touched',pct:touchedAt<0?0:pct,touchedAt,invalidAt};
}
type ZoneSel={maxAge:number;status:string;mitigation:string;maxMitigationPct:number;invalidate:string;maxDistAtr:number;atrPeriod:number};
// výběr zóny na každé svíčce: nejbližší platná zóna ve směru (poptávka pod cenou → long, nabídka nad cenou → short)
export function zoneBlock(s:Series,zones:Zone[],p:ZoneSel):Out{
 const o=newOut(s.n,['proximal','distal','mid']),a=atrOf(s,p.atrPeriod);
 type Live={z:Zone;deep:number;touched:boolean;dead:boolean};
 const live:Live[]=[];let k=0;const sorted=[...zones].sort((x,y)=>x.created-y.created);
 for(let i=0;i<s.n;i++){
  // aktualizace stavu existujících zón svíčkou i (zóna vzniklá na i se svíčkou i nesleduje)
  for(const x of live){if(x.dead)continue;const z=x.z,w=z.proximal-z.distal;
   const px=z.side>0?(p.mitigation==='close'?s.c[i]:s.l[i]):(p.mitigation==='close'?s.c[i]:s.h[i]),pen=(z.proximal-px)/w;
   if(pen>=0)x.touched=true;if(pen>x.deep)x.deep=pen;
   if(z.side>0?(p.invalidate==='wick'?s.l[i]:s.c[i])<z.distal:(p.invalidate==='wick'?s.h[i]:s.c[i])>z.distal)x.dead=true}
  while(k<sorted.length&&sorted[k].created<=i)live.push({z:sorted[k++],deep:-Infinity,touched:false,dead:false});
  for(let q=live.length-1;q>=0;q--)if(live[q].dead||i-live[q].z.created>p.maxAge)live.splice(q,1);
  let bl:Zone|null=null,bs:Zone|null=null;
  for(const x of live){
   const z=x.z,pct=x.touched?Math.max(0,x.deep*100):0,mit=x.touched&&pct>=p.maxMitigationPct;
   const ok=p.status==='fresh'?!x.touched:p.status==='fresh_or_touched'?!mit:true;if(!ok)continue;
   if(p.maxDistAtr>0&&a[i]>0&&Math.abs(s.c[i]-z.proximal)>p.maxDistAtr*a[i])continue;
   if(z.side>0&&s.c[i]>=z.distal&&(!bl||z.proximal>bl.proximal))bl=z;
   if(z.side<0&&s.c[i]<=z.distal&&(!bs||z.proximal<bs.proximal))bs=z;
  }
  if(bl){o.L[i]=1;o.lvL.proximal![i]=bl.proximal;o.lvL.distal![i]=bl.distal;o.lvL.mid![i]=(bl.proximal+bl.distal)/2}
  if(bs){o.S[i]=1;o.lvS.proximal![i]=bs.proximal;o.lvS.distal![i]=bs.distal;o.lvS.mid![i]=(bs.proximal+bs.distal)/2}
 }
 return o;
}
// vnořená zóna: vnitřní (nižší TF) leží uvnitř vnější (vyšší TF) – contain = celá, overlap = překryv; úrovně = vnitřní zóna
export function nestedOk(inner:{proximal:number;distal:number},outer:{proximal:number;distal:number},mode:string):boolean{
 const iLo=Math.min(inner.proximal,inner.distal),iHi=Math.max(inner.proximal,inner.distal),oLo=Math.min(outer.proximal,outer.distal),oHi=Math.max(outer.proximal,outer.distal);
 if([iLo,iHi,oLo,oHi].some(Number.isNaN))return false;
 return mode==='overlap'?iLo<=oHi&&iHi>=oLo:iLo>=oLo&&iHi<=oHi;
}
export function nestedBlock(n:number,inner:Out,outer:Out,mode:string):Out{
 const o=newOut(n,['proximal','distal','mid']);
 for(const [side,io,oo,lv] of [[1,inner.lvL,outer.lvL,o.lvL],[-1,inner.lvS,outer.lvS,o.lvS]] as const){
  const A=side>0?inner.L:inner.S,B=side>0?outer.L:outer.S,R=side>0?o.L:o.S;
  for(let i=0;i<n;i++){
   if(!A[i]||!B[i])continue;
   const a={proximal:io.proximal![i],distal:io.distal![i]},b={proximal:oo.proximal![i],distal:oo.distal![i]};
   if(!nestedOk(a,b,mode))continue;
   R[i]=1;lv.proximal![i]=a.proximal;lv.distal![i]=a.distal;lv.mid![i]=(a.proximal+a.distal)/2;
  }
 }
 return o;
}

// ---- premium / discount: pozice close v rozsahu posledního potvrzeného swing high a swing low (0 = low, 1 = high)
export function pdPosition(close:number,hi:number,lo:number):number|null{return hi>lo?(close-lo)/(hi-lo):null}
export function premiumDiscount(s:Series,p:{swingN:number;discount:number;premium:number}):Out{
 const st=structure(s,p.swingN),o=newOut(s.n,['high','low','mid']);
 for(let i=0;i<s.n;i++){const x=pdPosition(s.c[i],st.hi[i],st.lo[i]);if(x===null)continue;
  o.L[i]=x<=p.discount?1:0;o.S[i]=x>=p.premium?1:0;
  for(const lv of [o.lvL,o.lvS]){lv.high![i]=st.hi[i];lv.low![i]=st.lo[i];lv.mid![i]=(st.hi[i]+st.lo[i])/2}}
 return o;
}
// ---- fair value gap: býčí na i, když low[i] > high[i−2] (mezera [high[i−2], low[i]]); vyplnění = průnik ceny do mezery
export type Gap={i:number;side:1|-1;top:number;bottom:number};
export function findFvgs(s:Series,minAtr:number,atrPeriod:number):Gap[]{
 const a=atrOf(s,atrPeriod),out:Gap[]=[];
 for(let i=2;i<s.n;i++){
  if(s.l[i]>s.h[i-2]&&(minAtr<=0||s.l[i]-s.h[i-2]>=minAtr*a[i]))out.push({i,side:1,top:s.l[i],bottom:s.h[i-2]});
  if(s.h[i]<s.l[i-2]&&(minAtr<=0||s.l[i-2]-s.h[i]>=minAtr*a[i]))out.push({i,side:-1,top:s.l[i-2],bottom:s.h[i]});
 }
 return out;
}
export function fvgBlock(s:Series,p:{minAtr:number;atrPeriod:number;maxAge:number;maxFillPct:number}):Out{
 const gaps=findFvgs(s,p.minAtr,p.atrPeriod),o=newOut(s.n,['proximal','distal','mid']);
 type G={g:Gap;fill:number};const live:G[]=[];let k=0;
 for(let i=0;i<s.n;i++){
  for(const x of live){const g=x.g,w=g.top-g.bottom;const f=g.side>0?(g.top-s.l[i])/w:(s.h[i]-g.bottom)/w;if(f>x.fill)x.fill=f}
  while(k<gaps.length&&gaps[k].i<=i)live.push({g:gaps[k++],fill:0});
  for(let q=live.length-1;q>=0;q--)if(i-live[q].g.i>p.maxAge||live[q].fill>=1)live.splice(q,1);
  let bl:Gap|null=null,bs:Gap|null=null;
  for(const x of live){if(x.fill*100>p.maxFillPct)continue;const g=x.g;if(g.side>0&&(!bl||g.i>bl.i))bl=g;if(g.side<0&&(!bs||g.i>bs.i))bs=g}
  if(bl){o.L[i]=1;o.lvL.proximal![i]=bl.top;o.lvL.distal![i]=bl.bottom;o.lvL.mid![i]=(bl.top+bl.bottom)/2}
  if(bs){o.S[i]=1;o.lvS.proximal![i]=bs.bottom;o.lvS.distal![i]=bs.top;o.lvS.mid![i]=(bs.top+bs.bottom)/2}
 }
 return o;
}
// ---- Fibonacci pásmo posledního impulzu: swing low → pozdější swing high (býčí) dává long pásmo high − x·(high − low), x ∈ [from, to]
export function fibLevel(hi:number,lo:number,x:number,up:boolean){return up?hi-x*(hi-lo):lo+x*(hi-lo)}
export function fibBand(s:Series,p:{swingN:number;from:number;to:number}):Out{
 const st=structure(s,p.swingN),o=newOut(s.n,['proximal','distal','mid','extreme']);
 for(let i=0;i<s.n;i++){
  const hi=st.hi[i],lo=st.lo[i];if(!(hi>lo))continue;
  const up=st.loI[i]<st.hiI[i],a=fibLevel(hi,lo,p.from,up),b=fibLevel(hi,lo,p.to,up),mid=fibLevel(hi,lo,(p.from+p.to)/2,up),c=s.c[i];
  const inBand=c<=Math.max(a,b)&&c>=Math.min(a,b);
  const lv=up?o.lvL:o.lvS;lv.proximal![i]=a;lv.distal![i]=b;lv.mid![i]=mid;lv.extreme![i]=up?lo:hi;
  if(inBand){if(up)o.L[i]=1;else o.S[i]=1}
 }
 return o;
}
// ---- kulatá čísla: nejbližší násobek kroku; platí, když je close do maxDistAtr × ATR
export const nearestRound=(price:number,step:number)=>Math.round(Math.round(price/step)*step*1e10)/1e10;
export function roundNumber(s:Series,p:{step:number;maxDistAtr:number;atrPeriod:number}):Out{
 const a=atrOf(s,p.atrPeriod),o=newOut(s.n,['level']);
 for(let i=0;i<s.n;i++){const L=nearestRound(s.c[i],p.step);o.lvL.level![i]=o.lvS.level![i]=L;if(a[i]>0&&Math.abs(s.c[i]-L)<=p.maxDistAtr*a[i])o.L[i]=o.S[i]=1}
 return o;
}

// ---- úrovně: předchozí den (poslední celý obchodní den PŘED dnem svíčky i) a seance
export function prevDayLevels(s:Series,data:DataTf):{high:Float64Array;low:Float64Array}{
 return s.get('pd:'+data,()=>{
  const day=tradeDayOf(data),n=s.n,high=new Float64Array(n).fill(NaN),low=new Float64Array(n).fill(NaN);
  let cur=NaN,ch=-Infinity,cl=Infinity,ph=NaN,pl=NaN;
  for(let i=0;i<n;i++){const d=day(s.t[i]);if(d!==cur){if(!Number.isNaN(cur)){ph=ch;pl=cl}cur=d;ch=-Infinity;cl=Infinity}
   high[i]=ph;low[i]=pl;if(s.h[i]>ch)ch=s.h[i];if(s.l[i]<cl)cl=s.l[i]}
  return {high,low};
 });
}
// seance: svíčka patří do seance, když její ZAČÁTEK leží v [from, to) místního času; výskyt = místní datum začátku seance.
// last* = poslední UZAVŘENÁ seance při zavření svíčky i (zavření svíčky dosáhlo konce seance, nebo už běží svíčka mimo ni); cur* = běžící
export function inSession(t:number,d:SessionDef):boolean{const m=localMin(d.tz,t),a=hhmm(d.from),b=hhmm(d.to);return a<b?m>=a&&m<b:m>=a||m<b}
export function sessionKey(t:number,d:SessionDef):number{const m=localMin(d.tz,t),a=hhmm(d.from),b=hhmm(d.to),day=localDay(d.tz,t);return a<b?day:m>=a?day:day-1}
export type SessionLv={lastH:Float64Array;lastL:Float64Array;curH:Float64Array;curL:Float64Array;curOpenT:Float64Array;curOpenI:Int32Array};
export function sessionLevels(s:Series,d:SessionDef):SessionLv{
 return s.get(`sess:${d.tz}:${d.from}:${d.to}`,()=>{
  const n=s.n,lastH=new Float64Array(n).fill(NaN),lastL=new Float64Array(n).fill(NaN),curH=new Float64Array(n).fill(NaN),curL=new Float64Array(n).fill(NaN),curOpenT=new Float64Array(n).fill(NaN),curOpenI=new Int32Array(n).fill(-1);
  let ck=NaN,ch=NaN,cl=NaN,oi=-1,lh=NaN,ll=NaN,active=false;
  for(let i=0;i<n;i++){
   const t=s.t[i],ins=inSession(t,d);
   if(ins){const k=sessionKey(t,d);if(!active||k!==ck){if(active){lh=ch;ll=cl}ck=k;ch=s.h[i];cl=s.l[i];oi=i;active=true}else{if(s.h[i]>ch)ch=s.h[i];if(s.l[i]<cl)cl=s.l[i]}}
   else if(active){lh=ch;ll=cl;active=false}
   if(active){curH[i]=ch;curL[i]=cl;curOpenI[i]=oi;curOpenT[i]=s.t[oi];
    const end=t+s.ms;if(!inSession(end,d)||sessionKey(end,d)!==ck){lh=ch;ll=cl;active=false}} // zavření svíčky = konec seance
   lastH[i]=lh;lastL[i]=ll;
  }
  return {lastH,lastL,curH,curL,curOpenT,curOpenI};
 });
}
// použití úrovně: break = close za úrovní (long nad high), near = do k × ATR od úrovně (long u low, short u high), inside = mezi low a high
export function levelUse(s:Series,hi:Float64Array,lo:Float64Array,use:string,k:number,atrPeriod:number):Out{
 const a=atrOf(s,atrPeriod),o=newOut(s.n,['high','low']);
 for(let i=0;i<s.n;i++){
  const H_=hi[i],L_=lo[i],c=s.c[i];if(Number.isNaN(H_)||Number.isNaN(L_))continue;
  o.lvL.high![i]=o.lvS.high![i]=H_;o.lvL.low![i]=o.lvS.low![i]=L_;
  if(use==='break'){o.L[i]=c>H_?1:0;o.S[i]=c<L_?1:0}
  else if(use==='near'){if(a[i]>0){o.L[i]=Math.abs(c-L_)<=k*a[i]?1:0;o.S[i]=Math.abs(c-H_)<=k*a[i]?1:0}}
  else o.L[i]=o.S[i]=c<=H_&&c>=L_?1:0;
 }
 return o;
}
// zdroj úrovně pro sweep (low strana pro long, high strana pro short) na svíčce i
export function levelSource(s:Series,src:string,data:DataTf,swingN:number,sessions:Record<string,SessionDef>):{hi:Float64Array;lo:Float64Array}{
 if(src==='prev_day'){const x=prevDayLevels(s,data);return {hi:x.high,lo:x.low}}
 if(src==='swing'){const st=structure(s,swingN);return {hi:st.hi,lo:st.lo}}
 const x=sessionLevels(s,sessions[src]);return {hi:x.lastH,lo:x.lastL};
}
// ---- vybrání likvidity: v posledních `lookback` svíčkách (včetně i) knot pod úrovní (long) a close svíčky i zpět nad ní
export function sweepSeries(s:Series,hi:Float64Array,lo:Float64Array,lookback:number):Out{
 const o=newOut(s.n,['level','extreme']);
 for(let i=0;i<s.n;i++){
  for(let j=i;j>=0&&i-j<lookback;j--){
   const L=lo[j];if(!o.L[i]&&!Number.isNaN(L)&&s.l[j]<L&&s.c[i]>L){let ex=Infinity;for(let q=j;q<=i;q++)ex=Math.min(ex,s.l[q]);o.L[i]=1;o.lvL.level![i]=L;o.lvL.extreme![i]=ex}
   const Hh=hi[j];if(!o.S[i]&&!Number.isNaN(Hh)&&s.h[j]>Hh&&s.c[i]<Hh){let ex=-Infinity;for(let q=j;q<=i;q++)ex=Math.max(ex,s.h[q]);o.S[i]=1;o.lvS.level![i]=Hh;o.lvS.extreme![i]=ex}
  }
 }
 return o;
}
// ---- změna struktury (MSS) s displacementem: svíčka j zavře nad posledním potvrzeným swing high (long) s tělem ≥ k × ATR;
// requireSweep = do `within` svíček před j (včetně) proběhlo vybrání likvidity na stejné straně; MSS musí být v posledních `lookback` svíčkách
export function mssBlock(s:Series,p:{swingN:number;displacementK:number;atrPeriod:number;requireSweep:boolean;within:number;lookback:number},sw:Out|null):Out{
 const st=structure(s,p.swingN),a=atrOf(s,p.atrPeriod),o=newOut(s.n,['level','extreme','mid']);
 const evL=new Int32Array(s.n).fill(-1),evS=new Int32Array(s.n).fill(-1),exL=new Float64Array(s.n).fill(NaN),exS=new Float64Array(s.n).fill(NaN),lvLv=new Float64Array(s.n).fill(NaN),lvSv=new Float64Array(s.n).fill(NaN);
 for(let j=1;j<s.n;j++){
  const body=Math.abs(s.c[j]-s.o[j]);if(!(a[j]>0)||body<p.displacementK*a[j])continue;
  for(const side of [1,-1] as const){
   const lvl=side>0?st.hi[j-1]:st.lo[j-1];if(Number.isNaN(lvl))continue;
   if(side>0?!(s.c[j]>lvl&&s.c[j-1]<=lvl):!(s.c[j]<lvl&&s.c[j-1]>=lvl))continue;
   let ex=NaN;
   if(p.requireSweep){if(!sw)continue;let found=-1;for(let q=j;q>=0&&j-q<p.within;q--)if((side>0?sw.L:sw.S)[q]){found=q;break}if(found<0)continue;
    ex=side>0?Infinity:-Infinity;for(let q=found;q<=j;q++)ex=side>0?Math.min(ex,s.l[q]):Math.max(ex,s.h[q])}
   else{ex=side>0?Infinity:-Infinity;for(let q=Math.max(0,j-p.within+1);q<=j;q++)ex=side>0?Math.min(ex,s.l[q]):Math.max(ex,s.h[q])}
   if(side>0){evL[j]=j;exL[j]=ex;lvLv[j]=lvl}else{evS[j]=j;exS[j]=ex;lvSv[j]=lvl}
  }
 }
 for(let i=0;i<s.n;i++)for(let j=i;j>=0&&i-j<p.lookback;j--){
  if(!o.L[i]&&evL[j]>=0){o.L[i]=1;o.lvL.level![i]=lvLv[j];o.lvL.extreme![i]=exL[j];o.lvL.mid![i]=(lvLv[j]+exL[j])/2}
  if(!o.S[i]&&evS[j]>=0){o.S[i]=1;o.lvS.level![i]=lvSv[j];o.lvS.extreme![i]=exS[j];o.lvS.mid![i]=(lvSv[j]+exS[j])/2}
 }
 return o;
}
// ---- svíčkové formace (na svíčce i nebo v posledních `lookback` svíčkách)
// pohlcení: býčí = svíčka i bílá, i−1 černá, tělo i pokrývá tělo i−1 (wicks = i celý rozsah)
export function isEngulf(s:Series,i:number,side:1|-1,wicks:boolean):boolean{
 if(i<1)return false;const o=s.o,c=s.c;
 if(side>0){if(!(c[i]>o[i]&&c[i-1]<o[i-1]))return false;return c[i]>=o[i-1]&&o[i]<=c[i-1]&&(!wicks||(s.h[i]>=s.h[i-1]&&s.l[i]<=s.l[i-1]))}
 if(!(c[i]<o[i]&&c[i-1]>o[i-1]))return false;return c[i]<=o[i-1]&&o[i]>=c[i-1]&&(!wicks||(s.h[i]>=s.h[i-1]&&s.l[i]<=s.l[i-1]));
}
// pin bar: býčí = spodní knot ≥ wickRatio × rozsah, tělo ≤ bodyRatio × rozsah, close v horní části (≥ closePos rozsahu od low)
export function isPin(s:Series,i:number,side:1|-1,p:{wickRatio:number;bodyRatio:number;closePos:number}):boolean{
 const r=s.h[i]-s.l[i];if(!(r>0))return false;const body=Math.abs(s.c[i]-s.o[i]);if(body>p.bodyRatio*r)return false;
 if(side>0){const w=Math.min(s.o[i],s.c[i])-s.l[i];return w>=p.wickRatio*r&&(s.c[i]-s.l[i])/r>=p.closePos}
 const w=s.h[i]-Math.max(s.o[i],s.c[i]);return w>=p.wickRatio*r&&(s.h[i]-s.c[i])/r>=p.closePos;
}
export function patternBlock(s:Series,lookback:number,test:(i:number,side:1|-1)=>boolean):Out{
 const o=newOut(s.n,['level','extreme']);
 for(let i=0;i<s.n;i++)for(let j=i;j>=0&&i-j<lookback;j--){
  if(!o.L[i]&&test(j,1)){o.L[i]=1;o.lvL.level![i]=s.c[j];o.lvL.extreme![i]=Math.min(s.l[j],j>0?s.l[j-1]:s.l[j])}
  if(!o.S[i]&&test(j,-1)){o.S[i]=1;o.lvS.level![i]=s.c[j];o.lvS.extreme![i]=Math.max(s.h[j],j>0?s.h[j-1]:s.h[j])}
 }
 return o;
}

// ---- zarovnání jiné řady podle času: index poslední svíčky, která byla při čase T UZAVŘENÁ (t + ms ≤ T); −1 = žádná
export function closedAt(times:ArrayLike<number>,ms:number,T:number):number{
 let lo=0,hi=times.length-1,a=-1;while(lo<=hi){const m=(lo+hi)>>1;if(times[m]+ms<=T){a=m;lo=m+1}else hi=m-1}return a;
}
// ---- relativní síla: výkon trhu minus výkon jiného trhu od otevření aktuální seance (nebo obchodního dne), v %
export function relStrength(s:Series,other:Series,anchorT:Float64Array,min:number):Out{
 const o=newOut(s.n,[]);
 for(let i=0;i<s.n;i++){
  const T=s.t[i]+s.ms,a=anchorT[i];if(Number.isNaN(a))continue;
  const j=closedAt(other.t,other.ms,T);if(j<0)continue;
  const ai=closedAt(s.t,0,a+1),aj=closedAt(other.t,0,a+1); // svíčka, která v čase kotvy začala (open kotvy)
  if(ai<0||aj<0||other.t[aj]<a-other.ms||!(s.o[ai]>0)||!(other.o[aj]>0))continue;
  const rs=(s.c[i]/s.o[ai]-1)*100-(other.c[j]/other.o[aj]-1)*100;
  o.L[i]=rs>=min&&rs>0?1:0;o.S[i]=rs<=-min&&rs<0?1:0;
 }
 return o;
}
export function dayAnchor(s:Series,data:DataTf):Float64Array{
 return s.get('dayanchor:'+data,()=>{const day=tradeDayOf(data),out=new Float64Array(s.n).fill(NaN);let cur=NaN,a=NaN;for(let i=0;i<s.n;i++){const d=day(s.t[i]);if(d!==cur){cur=d;a=s.t[i]}out[i]=a}return out});
}

// ---- zprávy: true = v okně ±minutes je zpráva se signálem ≥ minSignal v měnách trhu; undefined = kalendář okno nepokrývá
export type NewsItem={at:number;currencies:string[];signal:number};
export type NewsFn=(instrument:string,t:number,minutes:number,minSignal:number)=>boolean|undefined;
export function newsBlock(s:Series,inst:string,news:NewsFn|null,p:{minutes:number;minSignal:number}):Out{
 const o=newOut(s.n,[]);o.unknown=new Uint8Array(s.n);
 for(let i=0;i<s.n;i++){const v=news?news(inst,s.t[i]+s.ms,p.minutes,p.minSignal):undefined;if(v===undefined){o.unknown[i]=1;o.L[i]=o.S[i]=1}else if(!v)o.L[i]=o.S[i]=1}
 return o;
}

// ---- COT index: (net − min) / (max − min) × 100 za posledních N týdnů, jen z řádků zveřejněných do času T (available_at)
export type CotRow={date:string;availableAt:number;net:number};
export const COT_STALE_MS=14*DAY;
// zveřejnění CFTC: pátek po úterním datu reportu 15:30 New York (úterý + 3 dny); přesnější hodnota z DB (available_at) má přednost
export function cotAvailableAt(date:string):number{const [y,m,d]=date.slice(0,10).split('-').map(Number);const t=new Date(Date.UTC(y,m-1,d+3));return zoned('America/New_York',t.getUTCFullYear(),t.getUTCMonth()+1,t.getUTCDate(),15*60+30)}
export function cotIndexFn(rows:CotRow[],weeks:number):(T:number)=>number|undefined{
 const r=[...rows].filter(x=>Number.isFinite(x.availableAt)&&Number.isFinite(x.net)).sort((a,b)=>a.availableAt-b.availableAt||(a.date<b.date?-1:1));
 const times=r.map(x=>x.availableAt);
 return T=>{const k=closedAt(times,0,T);if(k<0||T-times[k]>COT_STALE_MS||k+1<Math.min(weeks,8))return undefined;
  let mn=Infinity,mx=-Infinity;for(let q=Math.max(0,k-weeks+1);q<=k;q++){mn=Math.min(mn,r[q].net);mx=Math.max(mx,r[q].net)}
  return mx>mn?(r[k].net-mn)/(mx-mn)*100:50};
}
// trh → index: komodita / měna vlastní řada; FX pár = (base − quote + 100)/2, USD strana chybí (proxy) → druhá měna (u USD báze obráceně)
export type CotSrc=Record<string,CotRow[]>;
export function cotForMarket(src:CotSrc,inst:string,weeks:number):((T:number)=>number|undefined)|null{
 const one=(k:string)=>src[k]?.length?cotIndexFn(src[k],weeks):null,m=inst.match(/^([A-Z]{3})\/([A-Z]{3})$/);
 if(!m)return one(inst);
 const a=m[1]==='USD'?null:one(m[1]),b=m[2]==='USD'?null:one(m[2]);
 if(a&&b)return T=>{const x=a(T),y=b(T);return x===undefined||y===undefined?undefined:(x-y+100)/2};
 if(a)return a;if(b)return T=>{const y=b(T);return y===undefined?undefined:100-y};
 return null;
}
export function cotBlock(s:Series,fn:((T:number)=>number|undefined)|null,p:{low:number;high:number;mode:string}):Out{
 const o=newOut(s.n,[]);o.unknown=new Uint8Array(s.n);
 for(let i=0;i<s.n;i++){const v=fn?fn(s.t[i]+s.ms):undefined;if(v===undefined){o.unknown[i]=1;continue}
  const up=v>=p.high,dn=v<=p.low;if(p.mode==='trend'){o.L[i]=up?1:0;o.S[i]=dn?1:0}else{o.L[i]=dn?1:0;o.S[i]=up?1:0}}
 return o;
}
// ---- sezonalita: výnos kalendářního měsíce (log close/close, %) z předchozích `years` let; nikdy aktuální rok
export function monthTable(d1:Bar[]):Map<number,number>{
 const out=new Map<number,number>();let prev=NaN,key=NaN,last=NaN;
 for(const b of d1){const d=new Date(tradeDayD1(b.t)*DAY),k=d.getUTCFullYear()*12+d.getUTCMonth();if(k!==key){if(!Number.isNaN(key)&&!Number.isNaN(prev))out.set(key,(Math.log(last)-Math.log(prev))*100);if(!Number.isNaN(key))prev=last;key=k}last=b.c}
 return out; // rozpracovaný poslední měsíc se nezapisuje
}
export function seasonStat(table:Map<number,number>,y:number,m:number,years:number):{avg:number;hit:number;n:number}|null{
 const v:number[]=[];for(let k=y-years;k<y;k++){const r=table.get(k*12+m);if(r!==undefined)v.push(r)}
 if(v.length<Math.min(3,years))return null;
 const avg=v.reduce((a,b)=>a+b,0)/v.length,up=v.filter(x=>x>0).length/v.length;return {avg,hit:avg>=0?up:1-up,n:v.length};
}
export function seasonBlock(s:Series,data:DataTf,d1:Bar[],p:{years:number;minAvg:number;minHit:number}):Out{
 const day=tradeDayOf(data),table=monthTable(d1),o=newOut(s.n,[]);o.unknown=new Uint8Array(s.n);
 // tabulka je ze svíček celé historie, ale měsíc m roku Y čte jen roky < Y (ty skončily dřív než svíčka i)
 for(let i=0;i<s.n;i++){const d=new Date(day(s.t[i])*DAY),st=seasonStat(table,d.getUTCFullYear(),d.getUTCMonth(),p.years);
  if(!st){o.unknown[i]=1;continue}
  if(st.avg>p.minAvg&&st.avg>0&&st.hit>=p.minHit)o.L[i]=1;if(st.avg<-p.minAvg&&st.avg<0&&st.hit>=p.minHit)o.S[i]=1}
 return o;
}
// ---- dolarový index: close nad EMA(period) = rostoucí dolar; vztah k trhu: auto = XXX/USD a trhy v USD obráceně, USD/XXX přímo
export function dxyRelation(inst:string,rel:string):1|-1|0{
 if(rel==='direct')return 1;if(rel==='inverse')return -1;
 const m=inst.match(/^([A-Z]{3})\/([A-Z]{3})$/);if(m)return m[1]==='USD'?1:m[2]==='USD'?-1:0;
 return -1; // kovy, ropa, indexy, krypto kotované v USD
}
export function dxyBlock(s:Series,dxy:Series|null,inst:string,p:{period:number;relation:string}):Out{
 const o=newOut(s.n,[]);o.unknown=new Uint8Array(s.n);const rel=dxyRelation(inst,p.relation);
 if(!dxy||rel===0){o.unknown.fill(1);return o}
 const e=emaOf(dxy,p.period);
 for(let i=0;i<s.n;i++){const j=closedAt(dxy.t,dxy.ms,s.t[i]+s.ms);if(j<0||Number.isNaN(e[j])){o.unknown[i]=1;continue}
  const up=dxy.c[j]>e[j]?1:dxy.c[j]<e[j]?-1:0;if(!up)continue;if(up*rel>0)o.L[i]=1;else o.S[i]=1}
 return o;
}
// syntetický dolarový index z FX párů (váhy DXY bez SEK, přepočtené): použije se, když v archivu chybí DX-Y.NYB
export const DXY_WEIGHTS:[string,number][]=[['EUR/USD',-.576],['USD/JPY',.136],['GBP/USD',-.119],['USD/CAD',.091],['USD/CHF',.036]];
export function syntheticDxy(byPair:Record<string,Bar[]|undefined>):Bar[]{
 const ws=DXY_WEIGHTS.filter(([p])=>byPair[p]?.length);if(ws.length<3)return [];
 const maps=ws.map(([p])=>new Map(byPair[p]!.map(b=>[b.t,b]))),times=[...maps[0].keys()].filter(t=>maps.every(m=>m.has(t))).sort((a,b)=>a-b);
 const val=(t:number,k:'o'|'c')=>Math.exp(ws.reduce((s,[,w],q)=>s+w*Math.log(maps[q].get(t)![k]),0))*50;
 return times.map(t=>{const o=val(t,'o'),c=val(t,'c');return {t,o,c,h:Math.max(o,c),l:Math.min(o,c)}});
}
