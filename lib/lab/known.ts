// Laboratoř · „Známé strategie“ – historický test klasických strategií stejným enginem jako „Hledání prahů“ (čisté funkce,
// testy scripts/check-lab-agents.mjs). Signály se počítají JEDNOU funkcí (knownSignals) pro historii i pro živé agenty (knownLive).
//
// BEZ POHLEDU DO BUDOUCNA:
//  • Signál svíčky i jen z dat do zavření svíčky i včetně (indikátory z lib/backtest/indicators.ts mají stejnou konvenci);
//    Donchian čte maximum/minimum PŘEDCHOZÍCH N svíček (i−N … i−1). Vstup až na open svíčky i+1.
//  • Měsíční rodiny (TSMOM, carry, sezonalita) se přepočítávají na zavření PRVNÍ svíčky nového měsíce (měsíc podle sweepDay).
//  • Sezonalita: jen celé měsíce z předchozích let (rok Y−N … Y−1), nikdy aktuální rok.
//  • COT: řádek platí od data reportu + COT_LAG_MS (úterý → následující pondělí 21:00 UTC), percentil jen z řádků do něj včetně.
//  • Sazby (carry): měsíční průměr měsíce M platí až od 1. dne měsíce M+2 (FRED/OECD vychází s měsíčním zpožděním).
//
// PROVEDENÍ (shodné se sweepem, lib/lab/sweep.ts): plnění mid ± ½ výchozího spreadu backtestu, riziko = SL × ATR14 signální svíčky,
// SL = −1 R přesně, gap přes SL = výstup za open, výstup signálem / časem na open další svíčky, bez take profitu. Portfolio:
// nejvýš 5 pozic, 1 na trh, korelační limit 2 na měnu a směr (FX nohy) a 2 na skupinu (kovy / ropa / indexy), bez ochlazení.
// In-sample 2015–2022 / out-of-sample od 2023 podle data vstupu. Hranice náhody = stejné časování s náhodným směrem každé epizody
// signálu (výstup se řídí původním signálem), nejlepší OOS průměr R rodiny, medián přes opakování.
import {sma,ema,rsi,atr,highest,lowest} from '../backtest/indicators.ts';
import {COT_LAG_MS,COT_MAX_AGE_MS} from '../backtest/context.ts';
import {sweepDay,mulberry32,median,newSeg,addSeg,segMetrics,type Seg,type SegMetrics,type SweepContext} from './sweep.ts';
import type {CotSource,StepFn} from './study.ts';
import {KNOWN_VERSION,KNOWN_FAMILIES,KNOWN_COMBOS,KNOWN_SIZE,KNOWN_MAX_OPEN,KNOWN_CAP,KNOWN_MIN_OOS_TRADES,KNOWN_MIN_OOS_PF,knownNeighbours,type KnownFamily,type KnownCombo,type KnownSet} from './known-grid.ts';
export * from './known-grid.ts';

const DAY=86400000;
const rd=(x:number,d=3)=>Math.round(x*10**d)/10**d;

// ---- měsíc svíčky (stejný obchodní den jako sweep)
export const monthOf=(t:number)=>{const d=new Date(sweepDay(t)*DAY);return d.getUTCFullYear()*12+d.getUTCMonth()};
export function monthStarts(t:ArrayLike<number>):Uint8Array{const n=t.length,o=new Uint8Array(n);for(let i=1;i<n;i++)if(monthOf(t[i])!==monthOf(t[i-1]))o[i]=1;return o}

// ---- sazby (carry): FRED CSV → krokové funkce podle dostupnosti
export type RateSeries={times:number[];vals:number[]};
export type RateSource=Record<string,RateSeries>;
// 3M mezibankovní sazby OECD (FRED, bez API klíče: fredgraph.csv?id=…)
export const FRED_RATES:Record<string,string>={USD:'IR3TIB01USM156N',EUR:'IR3TIB01EZM156N',GBP:'IR3TIB01GBM156N',JPY:'IR3TIB01JPM156N',CAD:'IR3TIB01CAM156N',AUD:'IR3TIB01AUM156N',NZD:'IR3TIB01NZM156N',CHF:'IR3TIB01CHM156N'};
export const RATE_MAX_AGE_MS=400*DAY; // poslední hodnota platí nejvýš ~13 měsíců (některé řady OECD končí dřív)
export function parseFredCsv(csv:string):{date:string;value:number}[]{
 return csv.split(/\r?\n/).slice(1).map(l=>l.split(',')).filter(x=>/^\d{4}-\d\d-\d\d$/.test(x[0])&&x[1]!==undefined&&x[1]!=='.'&&Number.isFinite(Number(x[1]))).map(x=>({date:x[0],value:Number(x[1])}));
}
// měsíc M (datum 1. dne M) je dostupný od 1. dne měsíce M+2
export function rateSeries(rows:{date:string;value:number}[]):RateSeries{
 const s=[...rows].sort((a,b)=>a.date<b.date?-1:1);
 return {times:s.map(r=>{const d=new Date(r.date+'T00:00:00Z');return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+2,1)}),vals:s.map(r=>r.value)};
}
export function rateAt(s:RateSeries|undefined,t:number):number|undefined{
 if(!s)return undefined;let lo=0,hi=s.times.length-1,a=-1;while(lo<=hi){const m=(lo+hi)>>1;if(s.times[m]<=t){a=m;lo=m+1}else hi=m-1}
 return a<0||t-s.times[a]>RATE_MAX_AGE_MS?undefined:s.vals[a];
}
export function rateDiff(src:RateSource|null|undefined,instrument:string,t:number):number|undefined{
 const m=instrument.match(/^([A-Z]{3})\/([A-Z]{3})$/);if(!m||!src)return undefined;
 const a=rateAt(src[m[1]],t),b=rateAt(src[m[2]],t);return a===undefined||b===undefined?undefined:a-b;
}

// ---- COT: čistá pozice spekulantů v % OI → percentil za 3 roky (156 týdnů, aspoň 104)
export const COT_PCT_WINDOW=156,COT_PCT_MIN=104;
type NetRow={date:string;time:number;v:number};
function netSeries(src:CotSource,k:string):NetRow[]|null{
 const x=src[k];if(!x||x.proxy)return null;
 const rows=[...x.rows].filter(r=>r.openInterest>0&&r.groups[x.group]&&Number.isFinite(r.groups[x.group].net)).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
 return rows.length?rows.map(r=>({date:r.date,time:Date.parse(r.date+'T00:00:00Z')+COT_LAG_MS,v:r.groups[x.group].net/r.openInterest*100})):null;
}
export function percentileSeries(vals:number[],window=COT_PCT_WINDOW,min=COT_PCT_MIN):(number|null)[]{
 return vals.map((v,k)=>{if(k+1<min)return null;const w=vals.slice(Math.max(0,k-window+1),k+1);let le=0;for(const x of w)if(x<=v)le++;return le/w.length*100});
}
// pár = základní − kotovaná měna (stejné datum reportu); s USD jen cizí měna (USD index je proxy), komodita = vlastní report
export function cotPctForInstrument(src:CotSource,instrument:string):StepFn|null{
 const m=instrument.match(/^([A-Z]{3})\/([A-Z]{3})$/);let rows:NetRow[]|null;
 if(!m)rows=netSeries(src,instrument);
 else{const [,b,q]=m;
  if(q==='USD')rows=netSeries(src,b);
  else if(b==='USD'){const r=netSeries(src,q);rows=r?r.map(x=>({...x,v:-x.v})):null}
  else{const A=netSeries(src,b),B=netSeries(src,q);if(!A||!B)return null;const bi=new Map(B.map(x=>[x.date,x]));rows=A.flatMap(x=>{const y=bi.get(x.date);return y?[{date:x.date,time:Math.max(x.time,y.time),v:x.v-y.v}]:[]})}}
 if(!rows||!rows.length)return null;
 const p=percentileSeries(rows.map(r=>r.v)),times:number[]=[],vals:number[]=[];
 rows.forEach((r,k)=>{if(p[k]!==null){times.push(r.time);vals.push(p[k]!)}});
 if(!times.length)return null;
 return t=>{let lo=0,hi=times.length-1,a=-1;while(lo<=hi){const mm=(lo+hi)>>1;if(times[mm]<=t){a=mm;lo=mm+1}else hi=mm-1}return a<0||t-times[a]>COT_MAX_AGE_MS?undefined:vals[a]};
}

// ---- signály jedné rodiny nad svíčkami jednoho trhu
// ent[i] = +1/−1 vstupní signál na zavření i; exL/exS[i] = 1 → výstup longu / shortu (podle směru SIGNÁLU) na open i+1; str = síla (pořadí)
export type KnownBars={t:ArrayLike<number>;h:ArrayLike<number>;l:ArrayLike<number>;c:ArrayLike<number>};
export type KnownExtras={id:string;cotPct?:StepFn|null;rates?:RateSource|null};
export type KnownSig={ent:Int8Array;exL:Uint8Array;exS:Uint8Array;str:Float64Array};
export function knownSignals(family:KnownFamily,v:string,b:KnownBars,x:KnownExtras):KnownSig{
 const n=b.c.length,ent=new Int8Array(n),exL=new Uint8Array(n),exS=new Uint8Array(n),str=new Float64Array(n),c=b.c;
 const ok=(...a:number[])=>a.every(z=>Number.isFinite(z));
 if(family==='donchian'){
  const [N,M]=v.split('/').map(Number),hi=highest(b.h,N),lo=lowest(b.l,N),xh=highest(b.h,M),xl=lowest(b.l,M);
  for(let i=1;i<n;i++){
   if(ok(hi[i-1],lo[i-1])){if(c[i]>hi[i-1]){ent[i]=1;str[i]=(c[i]-hi[i-1])/c[i]}else if(c[i]<lo[i-1]){ent[i]=-1;str[i]=(lo[i-1]-c[i])/c[i]}}
   if(ok(xl[i-1])&&c[i]<xl[i-1])exL[i]=1;
   if(ok(xh[i-1])&&c[i]>xh[i-1])exS[i]=1;
  }
 }else if(family==='macross'){
  const [F,S]=v.split('/').map(Number),f=sma(c,F),s=sma(c,S);
  for(let i=1;i<n;i++){if(!ok(f[i],s[i],f[i-1],s[i-1]))continue;
   if(f[i]>s[i]&&f[i-1]<=s[i-1])ent[i]=1;else if(f[i]<s[i]&&f[i-1]>=s[i-1])ent[i]=-1;
   str[i]=Math.abs(f[i]-s[i])/s[i];if(f[i]<s[i])exL[i]=1;if(f[i]>s[i])exS[i]=1;
  }
 }else if(family==='tsmom'){
  const L=v==='6-1'?6:12,ms=monthStarts(b.t),skip=21,look=L*21;
  for(let i=look;i<n;i++){if(!ms[i])continue;const r=c[i-skip]/c[i-look]-1;if(!ok(r))continue;const d=r>0?1:r<0?-1:0;
   ent[i]=d;str[i]=Math.abs(r);exL[i]=d!==1?1:0;exS[i]=d!==-1?1:0}
 }else if(family==='rsi'){
  const r2=v==='rsi2',R=rsi(c,r2?2:14),m200=sma(c,200),m5=sma(c,5);
  for(let i=0;i<n;i++){if(!ok(R[i]))continue;
   if(ok(m200[i])){
    if(c[i]>m200[i]&&R[i]<(r2?10:30)){ent[i]=1;str[i]=(r2?10:30)-R[i]}
    else if(c[i]<m200[i]&&R[i]>(r2?90:70)){ent[i]=-1;str[i]=R[i]-(r2?90:70)}
   }
   if(r2){if(ok(m5[i])){if(c[i]>m5[i])exL[i]=1;if(c[i]<m5[i])exS[i]=1}}
   else{if(R[i]>50)exL[i]=1;if(R[i]<50)exS[i]=1}
  }
 }else if(family==='bollinger'){
  const k=Number(v.split('/')[1]),m=sma(c,20);
  for(let i=19;i<n;i++){if(!ok(m[i]))continue;let s=0;for(let j=i-19;j<=i;j++)s+=(c[j]-m[i])**2;const sd=Math.sqrt(s/20);if(!(sd>0))continue;
   if(c[i]<m[i]-k*sd){ent[i]=1;str[i]=(m[i]-c[i])/sd}else if(c[i]>m[i]+k*sd){ent[i]=-1;str[i]=(c[i]-m[i])/sd}
   if(c[i]>=m[i])exL[i]=1;if(c[i]<=m[i])exS[i]=1;
  }
 }else if(family==='keltner'){
  const mult=Number(v.split('/')[1]),e=ema(c,20),a=atr(b.h,b.l,c,20);
  for(let i=0;i<n;i++){if(!ok(e[i],a[i])||!(a[i]>0))continue;
   if(c[i]>e[i]+mult*a[i]){ent[i]=1;str[i]=(c[i]-e[i])/a[i]}else if(c[i]<e[i]-mult*a[i]){ent[i]=-1;str[i]=(e[i]-c[i])/a[i]}
   if(c[i]<e[i])exL[i]=1;if(c[i]>e[i])exS[i]=1;
  }
 }else if(family==='carry'){
  const thr=v==='diff2'?2:1,ms=monthStarts(b.t);
  for(let i=1;i<n;i++){if(!ms[i])continue;const d=rateDiff(x.rates,x.id,b.t[i]+DAY);
   if(d===undefined){exL[i]=1;exS[i]=1;continue}
   if(Math.abs(d)>=thr){ent[i]=d>0?1:-1;str[i]=Math.abs(d)}
   if(!(d>=thr/2))exL[i]=1;if(!(d<=-thr/2))exS[i]=1;
  }
 }else if(family==='cot'){
  const [hiP,loP]=v.split('/').map(Number);
  for(let i=0;i<n;i++){const p=x.cotPct?x.cotPct(b.t[i]+DAY):undefined;if(p===undefined)continue;
   if(p>=hiP){ent[i]=-1;str[i]=p-50}else if(p<=loP){ent[i]=1;str[i]=50-p}
   if(p>=50)exL[i]=1;if(p<=50)exS[i]=1;
  }
 }else if(family==='season'){
  const N=v==='15y'?15:10,ms=monthStarts(b.t);
  // měsíční log výnosy (celé měsíce): poslední close měsíce / poslední close předchozího měsíce
  const ret=new Map<number,number>();let prevClose=NaN,curM=-1,curClose=NaN;
  const done=new Int32Array(n).fill(-1); // done[i] = poslední měsíc, který je celý uzavřený před svíčkou i
  for(let i=0;i<n;i++){const mo=monthOf(b.t[i]);if(mo!==curM){if(curM>=0&&Number.isFinite(prevClose))ret.set(curM,Math.log(curClose/prevClose)*100);if(curM>=0)prevClose=curClose;curM=mo}curClose=c[i];done[i]=mo-1}
  for(let i=1;i<n;i++){if(!ms[i])continue;const mo=monthOf(b.t[i]),Y=Math.floor(mo/12),M=mo%12;
   const mean=new Array(12).fill(NaN);
   for(let mm=0;mm<12;mm++){let s=0,k=0;for(let y=Y-N;y<Y;y++){const key=y*12+mm;if(key>done[i])continue;const r=ret.get(key);if(r!==undefined){s+=r;k++}}if(k>=10)mean[mm]=s/k}
   if(!Number.isFinite(mean[M])){exL[i]=1;exS[i]=1;continue}
   const fin=mean.filter(Number.isFinite),best=Math.max(...fin),worst=Math.min(...fin);
   let d=0;if(mean[M]===best&&mean[M]>0)d=1;else if(mean[M]===worst&&mean[M]<0)d=-1;
   ent[i]=d;str[i]=Math.abs(mean[M]);exL[i]=d!==1?1:0;exS[i]=d!==-1?1:0;
  }
 }
 return {ent,exL,exS,str};
}

// ---- simulace jedné kombinace nad kontextem sweepu (sjednocená osa dnů, sady trhů, nohy měn a skupiny)
export type KnownTrade={market:string;dir:1|-1;sig:1|-1;signalBar:number;entryBar:number;entryDay:number;entry:number;risk:number;exitBar:number;exitDay:number;exit:number;r:number;reason:'sl'|'signal'|'time'|'end'};
export type KnownSim={is:Seg;oos:Seg;all:Seg;trades?:KnownTrade[]};
const CCY_N=8;
export function simulateKnown(ctx:SweepContext,sigs:KnownSig[],p:{slAtr:number;hold:number;set:KnownSet},o:{flip?:Int8Array[]|null;trades?:boolean}={}):KnownSim{
 const M=ctx.markets,nm=M.length,row=ctx.rows[p.set],flip=o.flip??null;
 const pDir=new Int8Array(nm),pSig=new Int8Array(nm),pE=new Float64Array(nm),pD=new Float64Array(nm),pSl=new Float64Array(nm),pHeld=new Int32Array(nm),pNext=new Uint8Array(nm),pBar=new Int32Array(nm),pDay=new Int32Array(nm),pSigBar=new Int32Array(nm);
 const cDir=new Int8Array(nm),cSig=new Int8Array(nm),cStr=new Float64Array(nm),cAtr=new Float64Array(nm),cBar=new Int32Array(nm);
 const expo=new Int8Array(CCY_N*2),grpN=new Int8Array(3),is=newSeg(),oos=newSeg(),all=newSeg(),trades:KnownTrade[]|undefined=o.trades?[]:undefined;
 let open=0;const openL:number[]=[],candL:number[]=[],cand:number[]=[],tmp:number[]=[];
 const capOk=(m:number,dir:number)=>{if(open>=KNOWN_MAX_OPEN)return false;const a=ctx.legs[2*m];
  if(a>=0){const b=ctx.legs[2*m+1];return expo[a*2+(dir>0?1:0)]<KNOWN_CAP&&expo[b*2+(dir>0?0:1)]<KNOWN_CAP}
  const g=ctx.grp[m];return g<0||grpN[g]<KNOWN_CAP};
 const book=(m:number,dir:number,k:number)=>{open+=k;const a=ctx.legs[2*m];if(a>=0){const b=ctx.legs[2*m+1];expo[a*2+(dir>0?1:0)]+=k;expo[b*2+(dir>0?0:1)]+=k}else{const g=ctx.grp[m];if(g>=0)grpN[g]+=k}};
 const close=(m:number,fill:number,bar:number,day:number,reason:KnownTrade['reason'])=>{
  const dir=pDir[m],r=dir*(fill-pE[m])/pD[m];addSeg(pDay[m]<ctx.splitDay?is:oos,r);addSeg(all,r);
  if(trades)trades.push({market:M[m].id,dir:dir as 1|-1,sig:pSig[m] as 1|-1,signalBar:pSigBar[m],entryBar:pBar[m],entryDay:pDay[m],entry:pE[m],risk:pD[m],exitBar:bar,exitDay:day,exit:fill,r,reason});
  book(m,dir,-1);pDir[m]=0;pNext[m]=0;const i=openL.indexOf(m);if(i>=0)openL.splice(i,1);
 };
 const at=ctx.at,first=Math.max(0,ctx.startDay-ctx.minDay),last=ctx.endDay-ctx.minDay;
 for(let k=first;k<=last;k++){
  const s0=row.start[k],s1=row.start[k+1];if(s0===s1)continue;
  const day=k+ctx.minDay;
  // A) výstupy na open (naplánované, gap přes SL)
  if(openL.length){tmp.length=0;for(const m of openL)tmp.push(m);
   for(const m of tmp){const b=at[m][k];if(b<0)continue;const X=M[m],dir=pDir[m],op=X.o[b];
    if(pNext[m]){close(m,op-dir*X.hs,b,day,pHeld[m]>=p.hold?'time':'signal');continue}
    if(dir>0?op<=pSl[m]:op>=pSl[m])close(m,op-dir*X.hs,b,day,'sl');
   }}
  // B) vstupy na open podle síly signálu
  if(candL.length){cand.length=0;let w=0;for(const m of candL){if(at[m][k]>=0)cand.push(m);else candL[w++]=m}candL.length=w;
   if(cand.length>1)cand.sort((a,b)=>cStr[b]-cStr[a]||a-b);
   for(const m of cand){const dir=cDir[m];cDir[m]=0;if(pDir[m]||!capOk(m,dir))continue;const b=at[m][k],X=M[m],E=X.o[b]+dir*X.hs,D=p.slAtr*cAtr[m];
    pDir[m]=dir;pSig[m]=cSig[m];pE[m]=E;pD[m]=D;pSl[m]=E-dir*D+dir*X.hs;pHeld[m]=0;pNext[m]=0;pBar[m]=b;pDay[m]=day;pSigBar[m]=cBar[m];book(m,dir,1);
    let i=openL.length;openL.push(m);while(i>0&&openL[i-1]>m){openL[i]=openL[i-1];i--}openL[i]=m;
   }}
  // C) SL uvnitř svíčky (i ve svíčce vstupu)
  if(openL.length){tmp.length=0;for(const m of openL)tmp.push(m);for(const m of tmp){const b=at[m][k];if(b<0)continue;const X=M[m],dir=pDir[m];if(dir>0?X.l[b]<=pSl[m]:X.h[b]>=pSl[m])close(m,pSl[m]-dir*X.hs,b,day,'sl')}}
  if(day>=ctx.endDay)break;
  // D) zavření: plán výstupů, nové signály
  for(const m of openL){const b=at[m][k];if(b<0)continue;pHeld[m]++;const S=sigs[m];if(pHeld[m]>=p.hold||(pSig[m]>0?S.exL[b]:S.exS[b]))pNext[m]=1}
  for(let j=s0;j<s1;j++){const m=row.idx[j],b=at[m][k],S=sigs[m],e=S.ent[b];if(!e||cDir[m])continue;
   if(pDir[m]&&!(pNext[m]&&e!==pSig[m]))continue;
   const a=M[m].atr[b];if(!(a>0))continue;
   cDir[m]=e*(flip?flip[m][b]:1);cSig[m]=e;cStr[m]=S.str[b];cAtr[m]=a;cBar[m]=b;candL.push(m);
  }
 }
 for(let m=0;m<nm;m++)if(pDir[m]){const X=M[m];let b=X.n-1;while(b>0&&X.day[b]>ctx.endDay)b--;close(m,X.c[b]-pDir[m]*X.hs,b,X.day[b],'end')}
 return {is,oos,all,trades};
}
// náhodné směry: znaménko pro každou epizodu (souvislý úsek stejného nenulového signálu)
export function knownFlips(sigs:KnownSig[],seed:number):Int8Array[]{
 const rnd=mulberry32(seed);
 return sigs.map(s=>{const f=new Int8Array(s.ent.length);let prev=0,cur=1;for(let i=0;i<s.ent.length;i++){const e=s.ent[i];if(e&&e!==prev)cur=rnd()<.5?-1:1;prev=e;f[i]=cur}return f});
}

// ---- celý běh: všechny kombinace + hranice náhody po rodinách
export type KnownRow={i:number;combo:KnownCombo;is:SegMetrics;oos:SegMetrics;all:SegMetrics;nb:number|null;robust:boolean;beatsChance:boolean};
export type KnownFamilyResult={id:KnownFamily;label:string;desc:string;skipped:string|null;combos:number[];best:number|null;bestRobust:boolean;chance:{median:number|null;max:number|null;best:number[]}};
export type KnownResult={version:string;computedAt:string;from:string;split:string;to:string;rows:KnownRow[];families:KnownFamilyResult[];
 markets:{id:string;bars:number;cot:boolean}[];rates:{ccy:string;from:string|null;to:string|null}[];shuffles:number;seed:number;notes:string[];ms:number};
export type KnownData={sig:(family:KnownFamily,v:string)=>KnownSig[]|null};
export const isKnownRobust=(r:{is:SegMetrics;oos:SegMetrics;nb:number|null})=>(r.is.avgR??0)>0&&(r.oos.avgR??0)>0&&r.oos.trades>=KNOWN_MIN_OOS_TRADES&&(r.nb??-1)>0&&(r.oos.pf??0)>=KNOWN_MIN_OOS_PF;
export function runKnown(ctx:SweepContext,data:KnownData,o:{shuffles?:number;seed?:number;now?:number;skip?:Partial<Record<KnownFamily,string>>;rates?:KnownResult['rates'];onProgress?:(d:number,t:number)=>void}={}):KnownResult{
 const t0=Date.now(),reps=o.shuffles??20,seed=o.seed??42,rows:(KnownRow|null)[]=new Array(KNOWN_SIZE).fill(null),sigCache=new Map<string,KnownSig[]|null>();
 const sigOf=(f:KnownFamily,v:string)=>{const k=f+':'+v;if(!sigCache.has(k))sigCache.set(k,o.skip?.[f]?null:data.sig(f,v));return sigCache.get(k)!};
 let done=0;const total=KNOWN_SIZE*(1+reps);
 KNOWN_COMBOS.forEach((c,i)=>{const s=sigOf(c.family,c.v);if(s){const r=simulateKnown(ctx,s,c);rows[i]={i,combo:c,is:segMetrics(r.is),oos:segMetrics(r.oos),all:segMetrics(r.all),nb:null,robust:false,beatsChance:false}}o.onProgress?.(++done,total)});
 for(const r of rows)if(r){const v=[r.i,...knownNeighbours(r.i)].map(j=>rows[j]).filter((x):x is KnownRow=>!!x&&x.oos.trades>0).map(x=>x.oos.avgR!);const m=median(v);r.nb=m===null?null:rd(m);r.robust=isKnownRobust(r)}
 const families:KnownFamilyResult[]=KNOWN_FAMILIES.map(f=>{
  const combos=KNOWN_COMBOS.map((c,i)=>c.family===f.id?i:-1).filter(i=>i>=0&&rows[i]),best:number[]=[];
  for(let k=0;k<reps&&combos.length;k++){let b:number|null=null;const fs=new Map<string,Int8Array[]>();
   for(const i of combos){const c=KNOWN_COMBOS[i],s=sigOf(c.family,c.v)!;if(!fs.has(c.v))fs.set(c.v,knownFlips(s,seed+k*7919+KNOWN_FAMILIES.indexOf(f)*104729+f.v.indexOf(c.v)*31));
    const r=simulateKnown(ctx,s,c,{flip:fs.get(c.v)!});if(r.oos.n>=KNOWN_MIN_OOS_TRADES){const a=r.oos.sum/r.oos.n;if(b===null||a>b)b=a}o.onProgress?.(++done,total)}
   if(b!==null)best.push(rd(b))}
  const med=median(best),chance={median:med===null?null:rd(med),max:best.length?Math.max(...best):null,best};
  for(const i of combos){const r=rows[i]!;r.beatsChance=chance.median!==null&&(r.oos.avgR??-9)>chance.median&&r.oos.trades>=KNOWN_MIN_OOS_TRADES}
  // nejlepší: robustní podle OOS průměru R; když robustní není, nejlepší podle IS (výběr bez pohledu na OOS)
  const rob=combos.filter(i=>rows[i]!.robust).sort((a,b)=>(rows[b]!.oos.avgR??-9)-(rows[a]!.oos.avgR??-9)||a-b);
  const byIs=combos.filter(i=>rows[i]!.is.trades>=KNOWN_MIN_OOS_TRADES).sort((a,b)=>(rows[b]!.is.avgR??-9)-(rows[a]!.is.avgR??-9)||a-b);
  const pick=rob[0]??byIs[0]??combos[0]??null;
  return {id:f.id,label:f.label,desc:f.desc,skipped:o.skip?.[f.id]??null,combos,best:pick,bestRobust:pick!==null&&rows[pick]!.robust,chance};
 });
 const iso=(d:number)=>new Date(d*DAY).toISOString().slice(0,10);
 return {version:KNOWN_VERSION,computedAt:new Date(o.now??Date.now()).toISOString(),from:iso(ctx.startDay),split:iso(ctx.splitDay),to:iso(ctx.endDay),
  rows:rows.filter((r):r is KnownRow=>!!r),families,markets:ctx.markets.map(m=>({id:m.id,bars:m.n,cot:m.cot})),rates:o.rates??[],shuffles:reps,seed,notes:KNOWN_NOTES,ms:Date.now()-t0};
}
export const KNOWN_NOTES=[
 'Stejný engine a náklady jako „Hledání prahů“: vstup na open dne po signálu, spread podle výchozích hodnot backtestu, SL = −1 R, gap přes SL = plnění za open, výstupy signálem / časem na open další svíčky. Bez take profitu.',
 'Portfolio: nejvýš 5 pozic, 1 na trh, korelační limit 2 pozice na měnu a směr a 2 na skupinu (kovy / ropa / indexy). Pořadí vstupů podle síly signálu.',
 `In-sample 2015–2022, out-of-sample od 2023 (podle data vstupu). Robustní = IS i OOS průměr R > 0, OOS aspoň ${KNOWN_MIN_OOS_TRADES} obchodů, medián OOS sousedů (±1 krok varianty, SL, držení) > 0 a OOS PF ≥ ${KNOWN_MIN_OOS_PF}.`,
 'Hranice náhody po rodinách: stejné časování s náhodným směrem každé epizody signálu (výstup podle původního signálu), nejlepší OOS průměr R rodiny, medián přes opakování. „Nad náhodou“ = OOS průměr R nad tímto mediánem.',
 'Carry nepočítá swapy (úrokový výnos) – měří jen cenu. COT jen pro trhy s reportem (28 párů přes 7 měn, zlato, stříbro, ropa WTI). Sezonalita potřebuje aspoň 10 let historie měsíce.',
];

// ---- živý signál pro agenty (stejná funkce jako historie): jen DOKONČENÉ denní svíčky (t + 1 den ≤ now)
export type LiveBar={t:number;o?:number;h:number;l:number;c:number};
export type KnownLive={dir:-1|0|1;str:number;exitLong:boolean;exitShort:boolean;atr:number|null;barT:number|null;bars:number};
export function knownLive(family:KnownFamily,v:string,bars:LiveBar[],now:number,x:KnownExtras,sinceT?:number):KnownLive{
 const b=[...bars].filter(z=>z.t+DAY<=now&&z.c>0&&z.h>0&&z.l>0).sort((a,c)=>a.t-c.t),n=b.length;
 if(n<2)return {dir:0,str:0,exitLong:false,exitShort:false,atr:null,barT:null,bars:n};
 const arr={t:b.map(z=>z.t),h:b.map(z=>z.h),l:b.map(z=>z.l),c:b.map(z=>z.c)},s=knownSignals(family,v,arr,x),a=atr(arr.h,arr.l,arr.c,14),L=n-1;
 // výstup: příznak na kterékoli dokončené svíčce, která se zavřela po vstupu (sinceT = čas vstupu)
 let exitLong=false,exitShort=false;
 for(let i=L;i>=0&&(sinceT===undefined?i===L:b[i].t+DAY>sinceT);i--){if(s.exL[i])exitLong=true;if(s.exS[i])exitShort=true}
 return {dir:s.ent[L] as -1|0|1,str:s.str[L],exitLong,exitShort,atr:Number.isFinite(a[L])&&a[L]>0?a[L]:null,barT:b[L].t,bars:n};
}
// kolik denní historie rodina potřebuje živě (dny kalendáře)
export const knownHistoryDays=(f:KnownFamily)=>f==='season'?17*366:f==='tsmom'||f==='macross'||f==='rsi'?560:f==='cot'||f==='carry'?120:200;
