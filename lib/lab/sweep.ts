// Laboratoř · „Hledání prahů“ – historický sweep parametrů s ověřením mimo vzorek (čisté funkce, testy scripts/check-lab-sweep.mjs).
//
// SIGNÁL (jen technický kompozit, který jde zrekonstruovat zpětně – FUNDAMENTY HISTORICKY NEMÁME):
//  • trend −2…+2 (GMA50/GMA200, 3 hlasy – lib/lab/study.ts trendStates), COT koš −2…+2 (lab_cot, stejný vzorec jako skóre:
//    60 % net/OI + 40 % změna za 4 týdny, koš .25/.75), sezonalita koš −2…+2 (jen předchozí roky, koš .03/.1).
//  • skóre = Σ(wᵢ · sᵢ/2) / Σ(wᵢ dostupných) · 100 → −100…+100, váhy jako score-v3 pro tyto tři složky: trend 15, COT 15,
//    sezonalita 5 (renormalizace jen mezi nimi). Bez trendu (méně než 200 svíček) skóre není. Chybějící COT (indexy, Brent) nebo
//    sezonalita se vynechá a váhy se přepočtou.
//  • Sazby, inflace, zaměstnanost, HDP, PMI, maloobchod ani retail pozice NEJSOU historicky k dispozici → skóre v sweepu
//    NENÍ živé skóre Tradee. Živá simulace (S01…) ale obchoduje podle skutečného marketScore (FX = v3 s fundamenty).
//
// BEZ POHLEDU DO BUDOUCNA: signál svíčky i jen z dat známých při jejím zavření (study.ts), vstup až na open svíčky i+1.
//
// PROVEDENÍ (na jednom místě):
//  • Plnění = mid ± ½ výchozího spreadu backtestu (lib/backtest/rules.ts spreadPrice, zlato 0,30 USD, stříbro 0,03 USD).
//  • Riziko D = SL × ATR14 signální svíčky; zásah SL = −1 R přesně, TP = k R (plnění na úrovni), R-based P&L (1 % na obchod).
//  • Gap přes SL/TP na open → výstup za open. Svíčka zasáhne SL i TP → SL. Svíčka vstupu na open se kontroluje také.
//  • Pullback: limit na dotyk GMA20 (je-li mezi cenou a směrem proti signálu) nebo na 1 × ATR proti signálu – co je blíž;
//    platí 5 svíček. Gap přes limit = plnění za open. Při plnění limitem uvnitř svíčky se v té svíčce počítá jen SL (pořadí
//    high/low nevíme – konzervativně), TP až od další svíčky.
//  • Kontra: |skóre| ≥ práh A trend ±2 ve směru skóre A cena ≥ 2 × ATR od GMA50 ve směru trendu → obchod PROTI.
//  • Výstup signálem: na zavření, když skóre ve směru signálu klesne pod práh/2 → výstup na open další svíčky (bez TP).
//    Časový limit: po N držených svíčkách (včetně vstupní) → výstup na open další svíčky.
//  • Portfolio: nejvýš 5 otevřených pozic, 1 na trh; korelační limit = nejvýš 2 pozice se stejnou měnou ve stejném směru (FX
//    nohy) a nejvýš 2 v jedné skupině (kovy / ropa / indexy). Ochlazení: po ztrátovém obchodu 5 kalendářních dní bez vstupu na trhu.
//  • Pořadí v jednom dni: výstupy na open (naplánované, gapy) → vstupy na open (podle |skóre|) → plnění pullbacků →
//    SL/TP uvnitř svíčky → na zavření plánování výstupů a nových signálů.
//  • In-sample / out-of-sample podle data VSTUPU (jeden souvislý běh, ať portfolio nezačíná dvakrát od nuly).
import {atr} from '../backtest/indicators.ts';
import {spreadPrice,DEFAULT_RULES} from '../backtest/rules.ts';
import {computeSignals,type DBar,type StepFn} from './study.ts';

const DAY=86400000;
import {SWEEP_VERSION,SWEEP_WEIGHTS,SWEEP_GRID,SWEEP_DIMS,SWEEP_SIZE,tpOf,PULLBACK_BARS,CONTRA_EXT,MAX_OPEN,CAP_PER_GROUP,COOLDOWN_DAYS,MIN_OOS_TRADES,MIN_OOS_PF,IS_FROM,OOS_FROM,comboAt,neighbours,median,type SweepSet,type SweepCombo} from './sweep-grid.ts';
export {SWEEP_VERSION,SWEEP_WEIGHTS,SWEEP_GRID,SWEEP_DIMS,SWEEP_SIZE,ENTRY_LABELS,EXIT_LABELS,SET_LABELS,tpOf,SWEEP_COMMODITIES,SWEEP_INDICES,PULLBACK_BARS,CONTRA_EXT,MAX_OPEN,CAP_PER_GROUP,COOLDOWN_DAYS,MIN_OOS_TRADES,MIN_OOS_PF,IS_FROM,OOS_FROM,comboAt,comboIndex,comboKey,normalizeCombo,neighbours,median} from './sweep-grid.ts';
export type {SweepEntry,SweepExit,SweepSet,SweepCombo,SweepDim} from './sweep-grid.ts';

// ---- skóre kompozitu
const bucketW=(v:number|null|undefined,w:number)=>v===null||v===undefined?null:[v,w] as const;
export function compositeScore(trend:number|null,cot:number|null,season:number|null):number|null{
 if(trend===null||trend===undefined)return null;
 let num=0,den=0;
 for(const p of [bucketW(trend,SWEEP_WEIGHTS.trend),bucketW(cot,SWEEP_WEIGHTS.cot),bucketW(season,SWEEP_WEIGHTS.season)])if(p){num+=p[1]*p[0]/2;den+=p[1]}
 return Math.round(num/den*1000)/10;
}

// ---- příprava trhu
// obchodní den svíčky: Yahoo D1 FX začíná 23:00/00:00 UTC, futures 04:00/05:00, US indexy 13:30/14:30 → +2 h dá datum obchodního dne
export const sweepDay=(t:number)=>Math.floor((t+2*3600000)/DAY);
export type SweepKind='fx'|'commodities'|'index';
export const kindOf=(id:string):SweepKind=>/^[A-Z]{3}\/[A-Z]{3}$/.test(id)?'fx':id.startsWith('^')?'index':'commodities';
const CORR_GROUP=(id:string)=>/^(GC|SI|PL|PA)=F$/.test(id)?0:/^(CL|BZ)=F$/.test(id)?1:id.startsWith('^')?2:-1; // kovy / ropa / indexy
export const corrGroup=(id:string):'metal'|'oil'|'index'|null=>{const g=CORR_GROUP(id);return g===0?'metal':g===1?'oil':g===2?'index':null};
export type SweepMarket={id:string;kind:SweepKind;hs:number;n:number;t:Float64Array;day:Int32Array;o:Float64Array;h:Float64Array;l:Float64Array;c:Float64Array;
 atr:Float64Array;g20:Float64Array;g50:Float64Array;trend:Float64Array;score:Float64Array;ext:Float64Array;cot:boolean};
function gma(c:Float64Array,n:number):Float64Array{
 const out=new Float64Array(c.length).fill(NaN);let s=0;
 for(let i=0;i<c.length;i++){s+=Math.log(c[i]);if(i>=n)s-=Math.log(c[i-n]);if(i>=n-1)out[i]=Math.exp(s/n)}
 return out;
}
export function prepareMarket(instrument:string,raw:DBar[],cot:StepFn|null):SweepMarket{
 const bars=[...raw].filter(b=>b.o>0&&b.h>0&&b.l>0&&b.c>0).sort((a,b)=>a.t-b.t),n=bars.length;
 const F=(f:(b:DBar)=>number)=>Float64Array.from(bars,f);
 const o=F(b=>b.o),h=F(b=>b.h),l=F(b=>b.l),c=F(b=>b.c);
 const sig=computeSignals(bars,cot,null),a=atr(h,l,c,14),g20=gma(c,20),g50=gma(c,50);
 const trend=new Float64Array(n).fill(NaN),score=new Float64Array(n).fill(NaN),ext=new Float64Array(n).fill(NaN);
 for(let i=0;i<n;i++){
  const t=sig.trend[i];if(t===null)continue;trend[i]=t;
  const s=compositeScore(t,sig.cot[i],sig.season[i]);if(s!==null)score[i]=s;
  if(t!==0&&a[i]>0&&g50[i]>0)ext[i]=Math.sign(t)*(c[i]-g50[i])/a[i];
 }
 const last=n?c[n-1]:1;
 return {id:instrument,kind:kindOf(instrument),hs:spreadPrice(instrument,last,DEFAULT_RULES)/2,n,t:F(b=>b.t),day:Int32Array.from(bars,b=>sweepDay(b.t)),o,h,l,c,atr:a,g20,g50,trend,score,ext,cot:!!cot};
}

// ---- kontext (sjednocená časová osa po kalendářních dnech)
export type SweepContext={markets:SweepMarket[];minDay:number;startDay:number;splitDay:number;endDay:number;
 at:Int32Array[];rows:Record<SweepSet,{start:Int32Array;idx:Int32Array}>;legs:Int32Array;grp:Int8Array;sig:Map<string,{start:Int32Array;m:Int32Array;b:Int32Array}>};
const CCY=['EUR','GBP','USD','JPY','CHF','CAD','AUD','NZD'];
export function buildContext(markets:SweepMarket[],o:{from?:string;split?:string;to?:number}={}):SweepContext{
 const d=(s:string)=>Math.floor(Date.parse(s+'T00:00:00Z')/DAY);
 const all=markets.filter(m=>m.n>0);
 let minDay=Infinity,maxDay=-Infinity;for(const m of all){minDay=Math.min(minDay,m.day[0]);maxDay=Math.max(maxDay,m.day[m.n-1])}
 if(!all.length){minDay=0;maxDay=0}
 const endDay=o.to!==undefined?Math.min(maxDay,Math.floor(o.to/DAY)):maxDay,span=maxDay-minDay+1;
 const at=all.map(m=>{const a=new Int32Array(span).fill(-1);for(let i=0;i<m.n;i++)a[m.day[i]-minDay]=i;return a});
 const rows={} as SweepContext['rows'];
 for(const set of SWEEP_GRID.set){
  const inSet=all.map(m=>set==='all'||(set==='fx'?m.kind==='fx':m.kind!=='fx'));
  const start=new Int32Array(span+1),tmp:number[]=[];
  for(let k=0;k<span;k++){start[k]=tmp.length;for(let m=0;m<all.length;m++)if(inSet[m]&&at[m][k]>=0)tmp.push(m)}
  start[span]=tmp.length;rows[set]={start,idx:Int32Array.from(tmp)};
 }
 const legs=new Int32Array(all.length*2).fill(-1),grp=new Int8Array(all.length).fill(-1);
 all.forEach((m,i)=>{const x=m.id.match(/^([A-Z]{3})\/([A-Z]{3})$/);if(x){legs[2*i]=CCY.indexOf(x[1]);legs[2*i+1]=CCY.indexOf(x[2])}else grp[i]=CORR_GROUP(m.id)});
 return {markets:all,minDay,startDay:d(o.from||IS_FROM),splitDay:d(o.split||OOS_FROM),endDay,at,rows,legs,grp,sig:new Map()};
}

// trhy s |skóre| ≥ práh po dnech (CSR: start[k]…start[k+1] → m, b), počítá se jednou na sadu a práh a drží v kontextu
export function signalRows(ctx:SweepContext,set:SweepSet,thr:number):{start:Int32Array;m:Int32Array;b:Int32Array}{
 const key=set+':'+thr,hit=ctx.sig.get(key);if(hit)return hit;
 const row=ctx.rows[set],span=row.start.length-1,start=new Int32Array(span+1),ms:number[]=[],bs:number[]=[];
 for(let k=0;k<span;k++){start[k]=ms.length;for(let j=row.start[k];j<row.start[k+1];j++){const m=row.idx[j],b=ctx.at[m][k],s=ctx.markets[m].score[b];if(s>=thr||s<=-thr){ms.push(m);bs.push(b)}}}
 start[span]=ms.length;
 const out={start,m:Int32Array.from(ms),b:Int32Array.from(bs)};ctx.sig.set(key,out);return out;
}

// ---- metriky segmentu
export type Seg={n:number;wins:number;sum:number;sum2:number;gw:number;gl:number;cum:number;peak:number;dd:number;aw:number;al:number};
const newSeg=():Seg=>({n:0,wins:0,sum:0,sum2:0,gw:0,gl:0,cum:0,peak:0,dd:0,aw:0,al:0});
function addSeg(s:Seg,r:number){s.n++;s.sum+=r;s.sum2+=r*r;if(r>0){s.wins++;s.gw+=r}else s.gl-=r;s.cum+=r;if(s.cum>s.peak)s.peak=s.cum;if(s.cum-s.peak<s.dd)s.dd=s.cum-s.peak}
export type SegMetrics={trades:number;winRate:number|null;avgR:number|null;totalR:number;pf:number|null;maxDd:number;sharpe:number|null;expectancy:number|null};
const rd=(x:number,d=3)=>Math.round(x*10**d)/10**d;
export function segMetrics(s:Seg):SegMetrics{
 const n=s.n,avg=n?s.sum/n:null,sd=n>1?Math.sqrt(Math.max(0,(s.sum2-n*(s.sum/n)**2)/(n-1))):null;
 const wr=n?s.wins/n:null,avgWin=s.wins?s.gw/s.wins:0,avgLoss=n-s.wins?-s.gl/(n-s.wins):0;
 return {trades:n,winRate:wr===null?null:rd(wr*100,1),avgR:avg===null?null:rd(avg),totalR:rd(s.sum,2),pf:s.gl>0?rd(s.gw/s.gl):s.gw>0?99:null,maxDd:rd(s.dd,2),
  sharpe:avg!==null&&sd&&sd>0?rd(avg/sd):null,expectancy:wr===null?null:rd(wr*avgWin+(1-wr)*avgLoss)};
}

// ---- simulace jedné kombinace
export type SweepTrade={market:string;dir:1|-1;signalBar:number;entryBar:number;entryDay:number;entry:number;risk:number;exitBar:number;exitDay:number;exit:number;r:number;reason:'sl'|'tp'|'signal'|'time'|'end'};
export type SimResult={is:Seg;oos:Seg;all:Seg;trades?:SweepTrade[]};
export function simulate(ctx:SweepContext,p:SweepCombo,o:{flip?:Int8Array[]|null;trades?:boolean}={}):SimResult{
 const M=ctx.markets,nm=M.length,row=ctx.rows[p.set],flip=o.flip??null,tp=tpOf(p.exit),sigExit=p.exit==='signal',half=p.threshold/2;
 const pDir=new Int8Array(nm),pE=new Float64Array(nm),pD=new Float64Array(nm),pSl=new Float64Array(nm),pTp=new Float64Array(nm),pSig=new Int8Array(nm),pHeld=new Int32Array(nm),pNext=new Uint8Array(nm),pBar=new Int32Array(nm),pDay=new Int32Array(nm),pSigBar=new Int32Array(nm),pLim=new Uint8Array(nm);
 const cDir=new Int8Array(nm),cSig=new Int8Array(nm),cScore=new Float64Array(nm),cAtr=new Float64Array(nm),cBar=new Int32Array(nm);
 const wDir=new Int8Array(nm),wSig=new Int8Array(nm),wLvl=new Float64Array(nm),wLeft=new Int8Array(nm),wScore=new Float64Array(nm),wAtr=new Float64Array(nm),wBar=new Int32Array(nm);
 const cool=new Int32Array(nm).fill(-2147483648),expo=new Int8Array(CCY.length*2),grpN=new Int8Array(3);
 const is=newSeg(),oos=newSeg(),all=newSeg(),trades:SweepTrade[]|undefined=o.trades?[]:undefined;
 let open=0;
 const capOk=(m:number,dir:number)=>{
  if(open>=MAX_OPEN)return false;
  if(!p.corrCap)return true;
  const a=ctx.legs[2*m];
  if(a>=0){const b=ctx.legs[2*m+1];if(expo[a*2+(dir>0?1:0)]>=CAP_PER_GROUP||expo[b*2+(dir>0?0:1)]>=CAP_PER_GROUP)return false;return true}
  const g=ctx.grp[m];return g<0||grpN[g]<CAP_PER_GROUP;
 };
 const book=(m:number,dir:number,k:number)=>{open+=k;const a=ctx.legs[2*m];if(a>=0){const b=ctx.legs[2*m+1];expo[a*2+(dir>0?1:0)]+=k;expo[b*2+(dir>0?0:1)]+=k}else{const g=ctx.grp[m];if(g>=0)grpN[g]+=k}};
 const openPos=(m:number,dir:number,mid:number,atrV:number,sig:number,bar:number,day:number,sigBar:number,limit:boolean)=>{
  const hs=M[m].hs,E=mid+dir*hs,D=p.slAtr*atrV;
  pDir[m]=dir;pE[m]=E;pD[m]=D;pSl[m]=E-dir*D+dir*hs;pTp[m]=tp===null?NaN:E+dir*tp*D+dir*hs;pSig[m]=sig;pHeld[m]=0;pNext[m]=0;pBar[m]=bar;pDay[m]=day;pSigBar[m]=sigBar;pLim[m]=limit?1:0;
  book(m,dir,1);ins(openL,m);
 };
 const close=(m:number,fill:number,bar:number,day:number,reason:SweepTrade['reason'])=>{
  const dir=pDir[m],r=dir*(fill-pE[m])/pD[m];
  addSeg(pDay[m]<ctx.splitDay?is:oos,r);addSeg(all,r);
  if(trades)trades.push({market:M[m].id,dir:dir as 1|-1,signalBar:pSigBar[m],entryBar:pBar[m],entryDay:pDay[m],entry:pE[m],risk:pD[m],exitBar:bar,exitDay:day,exit:fill,r,reason});
  if(p.cooldown&&r<0)cool[m]=day+COOLDOWN_DAYS;
  book(m,dir,-1);pDir[m]=0;pNext[m]=0;del(openL,m);
 };
 // SL/TP uvnitř svíčky (SL dřív); tpOk=false u plnění limitem v této svíčce
 const intrabar=(m:number,b:number,day:number,tpOk:boolean)=>{
  const X=M[m],dir=pDir[m],hs=X.hs;
  if(dir>0?X.l[b]<=pSl[m]:X.h[b]>=pSl[m]){close(m,pSl[m]-dir*hs,b,day,'sl');return}
  if(tpOk&&tp!==null&&(dir>0?X.h[b]>=pTp[m]:X.l[b]<=pTp[m]))close(m,pTp[m]-dir*hs,b,day,'tp');
 };
 // seznamy aktivních trhů (vzestupně podle indexu = stejné pořadí jako průchod dnem) – den se neprochází celý
 const openL:number[]=[],candL:number[]=[],waitL:number[]=[],cand:number[]=[],tmp:number[]=[];
 const ins=(a:number[],m:number)=>{let i=a.length;a.push(m);while(i>0&&a[i-1]>m){a[i]=a[i-1];i--}a[i]=m};
 const del=(a:number[],m:number)=>{const i=a.indexOf(m);if(i>=0)a.splice(i,1)};
 const sig=signalRows(ctx,p.set,p.threshold);
 const at=ctx.at,first=Math.max(0,ctx.startDay-ctx.minDay),last=ctx.endDay-ctx.minDay;
 for(let k=first;k<=last;k++){
  const s0=row.start[k],s1=row.start[k+1];if(s0===s1)continue;
  const day=k+ctx.minDay;
  // A) výstupy na open: naplánované (signál/čas) a gapy přes SL/TP
  if(openL.length){tmp.length=0;for(const m of openL)tmp.push(m);
   for(const m of tmp){const b=at[m][k];if(b<0)continue;const X=M[m],dir=pDir[m],op=X.o[b];
    if(pNext[m]){close(m,op-dir*X.hs,b,day,pHeld[m]>=p.hold?'time':'signal');continue}
    if(dir>0?op<=pSl[m]:op>=pSl[m]){close(m,op-dir*X.hs,b,day,'sl');continue}
    if(tp!==null&&(dir>0?op>=pTp[m]:op<=pTp[m]))close(m,op-dir*X.hs,b,day,'tp');
   }}
  // B) vstupy na open (signál z předchozího zavření), pořadí podle |skóre|
  if(candL.length){cand.length=0;let w=0;for(const m of candL){if(at[m][k]>=0)cand.push(m);else candL[w++]=m}candL.length=w;
   if(open>=MAX_OPEN)for(const m of cand)cDir[m]=0; // plno: všechny dnešní vstupy propadnou
   else{if(cand.length>1)cand.sort((a,b)=>cScore[b]-cScore[a]||a-b);
    for(const m of cand){const dir=cDir[m];cDir[m]=0;if(pDir[m]||!capOk(m,dir))continue;const b=at[m][k];openPos(m,dir,M[m].o[b],cAtr[m],cSig[m],b,day,cBar[m],false);intrabar(m,b,day,true)}}}
  // C) pullback: plnění limitu (gap = open)
  if(waitL.length){cand.length=0;let w=0;for(const m of waitL){if(at[m][k]>=0)cand.push(m);else waitL[w++]=m}waitL.length=w;
   if(cand.length>1&&open<MAX_OPEN)cand.sort((a,b)=>wScore[b]-wScore[a]||a-b);
   for(const m of cand){const X=M[m],b=at[m][k],dir=wDir[m],L=wLvl[m];
    const atOpen=dir>0?X.o[b]<=L:X.o[b]>=L,touch=atOpen||(dir>0?X.l[b]<=L:X.h[b]>=L);
    if(!touch){if(--wLeft[m]<=0)wDir[m]=0;else waitL.push(m);continue}
    wDir[m]=0;if(pDir[m]||!capOk(m,dir))continue;
    openPos(m,dir,atOpen?X.o[b]:L,wAtr[m],wSig[m],b,day,wBar[m],!atOpen);intrabar(m,b,day,atOpen);
   }}
  // D) SL/TP uvnitř svíčky u pozic z dřívějška
  if(openL.length){tmp.length=0;for(const m of openL)tmp.push(m);for(const m of tmp){const b=at[m][k];if(b>=0&&pBar[m]!==b)intrabar(m,b,day,true)}}
  // E) zavření: plán výstupů u otevřených, nové signály (jen trhy s |skóre| ≥ práh – předpočítané)
  if(day>=ctx.endDay)break;
  for(const m of openL){const b=at[m][k];if(b<0)continue;pHeld[m]++;if(pHeld[m]>=p.hold)pNext[m]=1;else if(sigExit){const s=M[m].score[b];if(s===s&&pSig[m]*s<half)pNext[m]=1}}
  for(let j=sig.start[k],j1=sig.start[k+1];j<j1;j++){const m=sig.m[j];
   if(pDir[m]||wDir[m]||cDir[m]||day<cool[m])continue;
   const X=M[m],b=sig.b[j],s=X.score[b],a=X.atr[b];if(!(a>0))continue;
   const sd=s>0?1:-1,f=flip?flip[m][b]:1;
   if(p.entry==='immediate'){cDir[m]=sd*f;cSig[m]=sd;cScore[m]=sd*s;cAtr[m]=a;cBar[m]=b;candL.push(m)}
   else if(p.entry==='contra'){if(X.trend[b]===2*sd&&X.ext[b]>=CONTRA_EXT){cDir[m]=-sd*f;cSig[m]=sd;cScore[m]=sd*s;cAtr[m]=a;cBar[m]=b;candL.push(m)}}
   else{const dir=sd*f,ref=X.c[b],g=X.g20[b];let L=ref-dir*a;if(g===g&&(dir>0?g<ref&&g>L:g>ref&&g<L))L=g;
    wDir[m]=dir;wSig[m]=sd;wLvl[m]=L;wLeft[m]=PULLBACK_BARS;wScore[m]=sd*s;wAtr[m]=a;wBar[m]=b;waitL.push(m)}
  }
 }
 // otevřené na konci období: za poslední close do endDay
 for(let m=0;m<nm;m++)if(pDir[m]){const X=M[m];let b=X.n-1;while(b>0&&X.day[b]>ctx.endDay)b--;close(m,X.c[b]-pDir[m]*X.hs,b,X.day[b],'end')}
 return {is,oos,all,trades};
}

// ---- náhodné směry (hranice náhody): deterministický PRNG, náhodné znaménko pro každou epizodu signálu (souvislý úsek
// se stejným znaménkem skóre) – časování vstupů i výstupů zůstane, jen směr obchodu je náhodný
export function mulberry32(seed:number){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}}
export function flipsFor(ctx:SweepContext,seed:number):Int8Array[]{
 const rnd=mulberry32(seed);
 return ctx.markets.map(m=>{const f=new Int8Array(m.n);let prev=0,cur=1;for(let i=0;i<m.n;i++){const s=m.score[i],sg=s>0?1:s<0?-1:0;if(sg!==prev){cur=rnd()<.5?-1:1;prev=sg}f[i]=cur}return f});
}

// ---- celý sweep
export const ROW_FIELDS=['isN','isWin','isAvg','isTot','isPf','isDd','isSh','isExp','oosN','oosWin','oosAvg','oosTot','oosPf','oosDd','oosSh','oosExp','allN','allAvg','allTot','allPf','allDd','nb','robust'] as const;
export type SweepRow=(number|null)[];
export type ChanceBaseline={reps:number;seed:number;best:number[];median:number|null;max:number|null;n:number};
export type SweepResult={version:string;computedAt:string;from:string;split:string;to:string;grid:typeof SWEEP_GRID;dims:readonly string[];fields:readonly string[];rows:SweepRow[];
 markets:{id:string;kind:SweepKind;bars:number;cot:boolean;from:string|null}[];chance:ChanceBaseline|null;robust:number[];notes:string[];ms:number};
const segRow=(s:Seg):SweepRow=>{const m=segMetrics(s);return [m.trades,m.winRate,m.avgR,m.totalR,m.pf,m.maxDd,m.sharpe,m.expectancy]};
export const F=Object.fromEntries(ROW_FIELDS.map((k,i)=>[k,i])) as Record<typeof ROW_FIELDS[number],number>;
export function isRobust(r:SweepRow):boolean{
 const v=(k:keyof typeof F)=>r[F[k]] as number|null;
 return (v('isAvg')??0)>0&&(v('oosAvg')??0)>0&&(v('oosN')??0)>=MIN_OOS_TRADES&&(v('nb')??-1)>0&&(v('oosPf')??0)>=MIN_OOS_PF;
}
// mediánový OOS průměr R kombinace a jejích sousedů (jen kombinace s aspoň jedním OOS obchodem)
export function neighbourhood(rows:SweepRow[],i:number):number|null{
 const v=[i,...neighbours(i)].map(j=>rows[j]).filter(r=>r&&(r[F.oosN] as number)>0).map(r=>r[F.oosAvg] as number);
 const m=median(v);return m===null?null:rd(m);
}
export function bestOos(sims:{oos:Seg}[]):number|null{
 let best:number|null=null;for(const s of sims)if(s.oos.n>=MIN_OOS_TRADES){const a=s.oos.sum/s.oos.n;if(best===null||a>best)best=a}
 return best===null?null:rd(best);
}
// části sweepu zvlášť (runner je umí pustit paralelně ve worker_threads; výsledek je stejný jako runSweep)
export function gridRows(ctx:SweepContext,idx:number[],onEach?:()=>void):[number,SweepRow][]{
 return idx.map(i=>{const s=simulate(ctx,comboAt(i));onEach?.();return [i,[...segRow(s.is),...segRow(s.oos),...segRow(s.all).filter((_,k)=>k===0||k===2||k===3||k===4||k===5),null,0]]});
}
export const shuffleSeed=(seed:number,k:number)=>seed+k*7919;
export function shuffleBest(ctx:SweepContext,seed:number,idx:number[],onEach?:()=>void):number|null{
 const flip=flipsFor(ctx,seed),sims:{oos:Seg}[]=[];
 for(const i of idx){sims.push(simulate(ctx,comboAt(i),{flip}));onEach?.()}
 return bestOos(sims);
}
export function finishSweep(ctx:SweepContext,parts:[number,SweepRow][],o:{idx:number[];reps:number;seed:number;best:(number|null)[];t0:number;now?:number}):SweepResult{
 const rows:SweepRow[]=new Array(SWEEP_SIZE).fill(null);for(const [i,r] of parts)rows[i]=r;
 for(const i of o.idx){const r=rows[i]!;r[F.nb]=neighbourhood(rows,i);r[F.robust]=isRobust(r)?1:0}
 const best=o.best.filter((b):b is number=>b!==null);
 const chance:ChanceBaseline|null=o.reps>0?{reps:o.reps,seed:o.seed,best,median:median(best),max:best.length?Math.max(...best):null,n:o.idx.length}:null;
 const robust=o.idx.filter(i=>rows[i]![F.robust]===1).sort((a,b)=>(rows[b]![F.oosAvg] as number)-(rows[a]![F.oosAvg] as number)||a-b);
 const iso=(d:number)=>new Date(d*DAY).toISOString().slice(0,10);
 return {version:SWEEP_VERSION,computedAt:new Date(o.now??Date.now()).toISOString(),from:iso(ctx.startDay),split:iso(ctx.splitDay),to:iso(ctx.endDay),grid:SWEEP_GRID,dims:SWEEP_DIMS,fields:ROW_FIELDS,rows,
  markets:ctx.markets.map(m=>({id:m.id,kind:m.kind,bars:m.n,cot:m.cot,from:m.n?new Date(m.t[0]).toISOString().slice(0,10):null})),chance,robust,notes:SWEEP_NOTES,ms:Date.now()-o.t0};
}
export function runSweep(ctx:SweepContext,o:{shuffles?:number;seed?:number;onProgress?:(done:number,total:number,phase:string)=>void;now?:number;combos?:number[]}={}):SweepResult{
 const t0=Date.now(),idx=o.combos??Array.from({length:SWEEP_SIZE},(_,i)=>i),reps=o.shuffles??20,seed=o.seed??42,total=idx.length*(1+reps);
 let done=0,phase='grid';const tick=()=>{if(++done%250===0)o.onProgress?.(done,total,phase)};
 const parts=gridRows(ctx,idx,tick),best:(number|null)[]=[];
 for(let k=0;k<reps;k++){phase='shuffle '+(k+1);best.push(shuffleBest(ctx,shuffleSeed(seed,k),idx,tick))}
 return finishSweep(ctx,parts,{idx,reps,seed,best,t0,now:o.now});
}
export const SWEEP_NOTES=[
 'Signál = technický kompozit: trend (GMA50/GMA200), COT spekulantů a sezonalita s vahami 15 : 15 : 5 (jako ve score-v3), přepočteno na −100…+100. Fundamenty (sazby, inflace, makro, retail) historicky NEMÁME – sweep je proto test technické části skóre, ne celého skóre Tradee.',
 'In-sample 2015–2022, out-of-sample od 2023 (podle data vstupu, jeden souvislý běh portfolia). Vstup na open dne po signálu, spread podle výchozích hodnot backtestu (zlato 0,30 USD, stříbro 0,03 USD), SL/TP ve stejné svíčce = SL, gap = plnění za open.',
 `Robustní = IS průměr R > 0, OOS průměr R > 0, OOS aspoň ${MIN_OOS_TRADES} obchodů, medián OOS průměru R kombinace a jejích sousedů (±1 krok v prahu, SL, TP a držení) > 0 a OOS profit factor ≥ ${MIN_OOS_PF}.`,
 'Hranice náhody: celý grid se přepočítá s náhodnými směry obchodů (náhodné znaménko pro každou epizodu signálu, stejné časování) a vezme se nejlepší OOS průměr R. Medián přes opakování = co „najde“ samotné hledání v šumu. Kombinace pod touto hranicí mohou být jen štěstí.',
 'Živá simulace (varianty S01…) používá skutečné skóre Tradee (FX = score-v3 i s fundamenty, ostatní technický model) – prahy se proto chovají jinak než v historii.',
];
