// Laboratoř · „Předpovídá to cenu?“ – studie signálů nad historií D1 svíček (čisté funkce, testy scripts/check-lab.mjs).
//
// BEZ POHLEDU DO BUDOUCNA (look-ahead) – pravidla na jednom místě:
//  • Signál pro svíčku i se počítá jen z dat známých při ZAVŘENÍ svíčky i (čas tData = t_i + 1 den, stejně jako backtest engine).
//  • Trend: GMA50/GMA200 = průměr logaritmů close za posledních 50/200 svíček VČETNĚ i (stejná 3hlasá logika jako
//    scripts/refresh-score-data.py + lib/fundamentals/breakdown.ts trendRow): reference vs GMA50, vs GMA200, GMA50 vs GMA200.
//  • Sezonalita měsíce m v roce Y: jen měsíce m z let Y−10 … Y−1 (všechny celé skončily dřív než svíčka i); výnos měsíce =
//    log(poslední close měsíce / poslední close před měsícem) × 100; signál = seasonalStats (score-engine), skóre = bucket(.03,.1).
//  • COT: týdenní řádek platí až od data zveřejnění s konzervativní rezervou COT_LAG_MS (úterý + 6 dní 21:00 UTC); signál
//    = cotStats nad historií DO tohoto řádku včetně (60 % net/OI + 40 % změna za 4 týdny); pár jako cotPairSignal; skóre = bucket(.25,.75).
//    Starší než COT_MAX_AGE_MS = bez dat.
//  • Skóre Tradee: jen skutečně uložené snapshoty (score-history / score_snapshots) s časem ≤ tData, max. SCORE_MAX_AGE_MS staré.
//  • Budoucí výnos: z close svíčky i do close svíčky i+h (h = 1, 5, 20 obchodních dní), v % a v ATR(14) známém v i.
//    Svíčky bez i+h se do statistiky nepočítají.
// Statistika: překrývající se výnosy (h > 1) a korelované páry nadhodnocují t-stat; proto t počítá s n_eff = n / h
// (hrubá korekce překryvu); korelace mezi páry se nekoriguje – souhrn přes trhy ber jako orientační.
import {atr} from '../backtest/indicators.ts';
import {COT_LAG_MS,COT_MAX_AGE_MS,SCORE_MAX_AGE_MS} from '../backtest/context.ts';
import {seasonalStats,cotStats,type CotContract,type PriceData} from '../score-engine.ts';
import {bucket} from '../fundamentals/breakdown.ts';

export type DBar={t:number;o:number;h:number;l:number;c:number};
export const HORIZONS=[1,5,20] as const;
export type SignalId='trend'|'season'|'cot'|'score';
export const SIGNAL_LABELS:Record<SignalId,string>={trend:'Trend (GMA50/GMA200)',season:'Sezonalita měsíce',cot:'COT (spekulanti)',score:'Uložené skóre Tradee'};
export const BUCKETS=[-2,-1,0,1,2] as const;
export const BUCKET_LABELS:Record<SignalId,Record<number,string>>={
 trend:{'-2':'−2 (3 hlasy dolů)','-1':'−1 (2 : 1 dolů)','0':'0','1':'+1 (2 : 1 nahoru)','2':'+2 (3 hlasy nahoru)'},
 season:{'-2':'−2 (silně dolů)','-1':'−1','0':'0 (bez sezony)','1':'+1','2':'+2 (silně nahoru)'},
 cot:{'-2':'−2 (signál ≤ −0,75)','-1':'−1','0':'0 (|s| < 0,25)','1':'+1','2':'+2 (signál ≥ 0,75)'},
 score:{'-2':'≤ −30','-1':'−30 … −10','0':'−10 … +10','1':'+10 … +30','2':'≥ +30'},
};
const DAY=86400000;
const sign=(x:number)=>x>0?1:x<0?-1:0;
// den svíčky (Yahoo FX má D1 v 23:00 UTC předchozího dne → +12 h dá správné datum obchodního dne)
export const barDay=(t:number)=>new Date(t+12*3600000);

// ---- trend: −2…+2 nebo null (méně než 200 svíček)
export function trendScoreOf(t:number):number{return Math.abs(t)>=.99?2*Math.sign(t):t>0?1:t<0?-1:0}
export function trendStates(close:ArrayLike<number>):(number|null)[]{
 const n=close.length,out:(number|null)[]=new Array(n).fill(null),lc=new Float64Array(n);
 for(let i=0;i<n;i++)lc[i]=Math.log(close[i]);
 const cmp=(a:number,b:number)=>a>b?1:a<b?-1:0;
 for(let i=199;i<n;i++){
  let s50=0,s200=0;for(let k=i-199;k<=i;k++){s200+=lc[k];if(k>i-50)s50+=lc[k]} // přesný součet okna (bez driftu průběžných součtů)
  const g50=s50/50,g200=s200/200,last=lc[i];
  out[i]=trendScoreOf((cmp(last,g50)+cmp(last,g200)+cmp(g50,g200))/3);
 }
 return out;
}

// ---- sezonalita: tabulka měsíčních výnosů a signál jen z předchozích let
export function monthlyReturns(bars:DBar[]):Map<string,number>{
 const out=new Map<string,number>();let prevClose:number|null=null,curKey='',curClose=0;
 for(const b of bars){
  const d=barDay(b.t),key=d.getUTCFullYear()+'-'+(d.getUTCMonth()+1);
  if(key!==curKey){if(curKey&&prevClose!==null)out.set(curKey,(Math.log(curClose)-Math.log(prevClose))*100);if(curKey)prevClose=curClose;curKey=key}
  curClose=b.c;
 }
 // rozpracovaný poslední měsíc se nezapisuje (nebyl by celý) – a pro jeho vlastní rok se stejně nikdy nečte
 return out;
}
export function seasonStates(bars:DBar[]):{score:(number|null)[];signal:(number|null)[]}{
 const table=monthlyReturns(bars),memo=new Map<string,{score:number|null;signal:number|null}>();
 const score:(number|null)[]=[],signal:(number|null)[]=[];
 for(const b of bars){
  const d=barDay(b.t),Y=d.getUTCFullYear(),m=d.getUTCMonth()+1,key=Y+'-'+m;
  let v=memo.get(key);
  if(!v){
   const years=[] as {year:number;path:number[];logReturn:number}[];
   for(let y=Y-10;y<Y;y++){const r=table.get(y+'-'+m);if(r!==undefined)years.push({year:y,path:[],logReturn:r})}
   const s=seasonalStats({months:{[String(m)]:{years}}} as unknown as PriceData,m,10);
   v={signal:s.signal,score:s.signal===null?null:bucket(s.signal,.03,.1)};memo.set(key,v);
  }
  score.push(v.score);signal.push(v.signal);
 }
 return {score,signal};
}

// ---- COT: krokové funkce podle času zveřejnění
export type CotRowIn={date:string;openInterest:number;groups:Record<string,{long:number;short:number;spread?:number;net:number}>};
export type StepFn=(t:number)=>number|undefined;
function stepOf(times:number[],vals:number[],maxAge:number):StepFn{
 return t=>{let lo=0,hi=times.length-1,a=-1;while(lo<=hi){const m=(lo+hi)>>1;if(times[m]<=t){a=m;lo=m+1}else hi=m-1}
  return a<0||t-times[a]>maxAge?undefined:vals[a]};
}
// signál jedné měny/komodity: cotStats nad historií jen do daného řádku (prefix) → nic z pozdějších týdnů
export function cotSignalSeries(rows:CotRowIn[],group:string):{times:number[];dates:string[];signals:number[]}{
 const sorted=[...rows].filter(r=>Number.isFinite(Date.parse(r.date))).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
 const times:number[]=[],dates:string[]=[],signals:number[]=[];
 for(let k=0;k<sorted.length;k++){
  const s=cotStats({history:sorted.slice(Math.max(0,k-60),k+1)} as unknown as CotContract,group); // 52 týdnů percentilu + 4 týdny změny stačí
  if(!s||s.signal===null||s.last.date!==sorted[k].date)continue;
  times.push(Date.parse(sorted[k].date+'T00:00:00Z')+COT_LAG_MS);dates.push(sorted[k].date);signals.push(s.signal);
 }
 return {times,dates,signals};
}
export type CotSource={[market:string]:{rows:CotRowIn[];group:string;proxy?:boolean}};
// signál trhu: FX pár podle cotPairSignal (USD index je proxy → u páru s USD rozhoduje cizí měna, kříž = půl rozdílu
// a obě měny musí mít report se stejným datem), komodita = vlastní report (managed money)
export function cotForInstrument(src:CotSource,instrument:string):StepFn|null{
 const one=(k:string)=>{const x=src[k];if(!x||x.proxy)return null;const s=cotSignalSeries(x.rows,x.group);return s.times.length?s:null};
 const m=instrument.match(/^([A-Z]{3})\/([A-Z]{3})$/);
 if(!m){const s=one(instrument);return s?stepOf(s.times,s.signals,COT_MAX_AGE_MS):null}
 const [,base,quote]=m;
 if(quote==='USD'){const s=one(base);return s?stepOf(s.times,s.signals,COT_MAX_AGE_MS):null}
 if(base==='USD'){const s=one(quote);return s?stepOf(s.times,s.signals.map(v=>-v),COT_MAX_AGE_MS):null}
 const a=one(base),b=one(quote);if(!a||!b)return null;
 const bi=new Map(b.dates.map((d,i)=>[d,i])),times:number[]=[],vals:number[]=[];
 a.dates.forEach((d,i)=>{const j=bi.get(d);if(j!==undefined){times.push(Math.max(a.times[i],b.times[j]));vals.push((a.signals[i]-b.signals[j])/2)}});
 return times.length?stepOf(times,vals,COT_MAX_AGE_MS):null;
}

// ---- uložené skóre: snapshoty {at, instrument, score, method}
export type ScoreSnap={at:number;instrument:string;score:number;method:string};
export function scoreBucket(v:number):number{return v>=30?2:v>=10?1:v<=-30?-2:v<=-10?-1:0}
export function scoreForInstrument(snaps:ScoreSnap[],instrument:string,methods:string[]|null):StepFn|null{
 const mine=snaps.filter(s=>s.instrument===instrument&&Number.isFinite(s.score)&&Number.isFinite(s.at)&&(!methods||methods.includes(s.method))).sort((a,b)=>a.at-b.at);
 return mine.length?stepOf(mine.map(s=>s.at),mine.map(s=>s.score),SCORE_MAX_AGE_MS):null;
}

// ---- signály po svíčkách (sdílí studie i tester pravidel)
export type Signals={trend:(number|null)[];season:(number|null)[];seasonSignal:(number|null)[];cot:(number|null)[];cotSignal:(number|null)[];score:(number|null)[];scoreValue:(number|null)[];atr:Float64Array};
export function computeSignals(bars:DBar[],cot:StepFn|null,score:StepFn|null):Signals{
 const n=bars.length,c=bars.map(b=>b.c),tr=trendStates(c),se=seasonStates(bars);
 const cotSignal:(number|null)[]=[],cotB:(number|null)[]=[],scoreValue:(number|null)[]=[],scoreB:(number|null)[]=[];
 for(let i=0;i<n;i++){
  const tData=bars[i].t+DAY;
  const cs=cot?cot(tData):undefined;cotSignal.push(cs===undefined?null:cs);cotB.push(cs===undefined?null:bucket(cs,.25,.75));
  const sv=score?score(tData):undefined;scoreValue.push(sv===undefined?null:sv);scoreB.push(sv===undefined?null:scoreBucket(sv));
 }
 return {trend:tr,season:se.score,seasonSignal:se.signal,cot:cotB,cotSignal,score:scoreB,scoreValue,atr:atr(bars.map(b=>b.h),bars.map(b=>b.l),c,14)};
}

// ---- budoucí výnos
export function forwardReturn(bars:DBar[],atrArr:ArrayLike<number>,i:number,h:number):{pct:number;atr:number|null}|null{
 if(i<0||i+h>=bars.length)return null;
 const c0=bars[i].c,c1=bars[i+h].c;if(!(c0>0)||!(c1>0))return null;
 const a=atrArr[i];return {pct:(c1/c0-1)*100,atr:Number.isFinite(a)&&a>0?(c1-c0)/a:null};
}

// ---- statistika košů
export class Acc{
 n=0;s=0;ss=0;sa=0;na=0;hits=0;up=0;
 add(pct:number,atrR:number|null,dir:number){this.n++;this.s+=pct;this.ss+=pct*pct;if(atrR!==null){this.sa+=atrR;this.na++}if(pct>0)this.up++;if(dir!==0&&sign(pct)===dir)this.hits++}
 merge(o:Acc){this.n+=o.n;this.s+=o.s;this.ss+=o.ss;this.sa+=o.sa;this.na+=o.na;this.hits+=o.hits;this.up+=o.up;return this}
 get mean(){return this.n?this.s/this.n:null}
 get sd(){if(this.n<2)return null;const m=this.s/this.n;return Math.sqrt(Math.max(0,(this.ss-this.n*m*m)/(this.n-1)))}
}
const r=(x:number|null,d=3)=>x===null||!Number.isFinite(x)?null:Math.round(x*10**d)/10**d;
export type BucketStat={bucket:number;label:string;n:number;avgPct:number|null;avgAtr:number|null;hit:number|null;upPct:number|null;excessPct:number|null;t:number|null};
export type EdgeStat={n:number;avgPct:number|null;avgAtr:number|null;hit:number|null;t:number|null};
export type HorizonStat={h:number;baseline:{n:number;avgPct:number|null;upPct:number|null};buckets:BucketStat[];edge:EdgeStat};
export type SignalStat={id:SignalId;label:string;from:number|null;to:number|null;horizons:HorizonStat[]};
// t-stat rozdílu průměru koše proti baseline s hrubou korekcí překryvu (n_eff = n/h)
export function tStat(mean:number|null,sd:number|null,n:number,h:number,base=0):number|null{
 if(mean===null||sd===null||!(sd>0)||n<2)return null;const ne=Math.max(1,n/h);return (mean-base)/(sd/Math.sqrt(ne));
}
export function bucketStat(id:SignalId,b:number,a:Acc,base:Acc,h:number):BucketStat{
 const m=a.mean,bm=base.mean;
 return {bucket:b,label:BUCKET_LABELS[id][b],n:a.n,avgPct:r(m,4),avgAtr:a.na?r(a.sa/a.na,3):null,hit:a.n&&b!==0?r(100*a.hits/a.n,1):null,upPct:a.n?r(100*a.up/a.n,1):null,
  excessPct:m!==null&&bm!==null?r(m-bm,4):null,t:r(tStat(m,a.sd,a.n,h,bm??0),2)};
}
export function edgeStat(a:Acc,h:number):EdgeStat{return {n:a.n,avgPct:r(a.mean,4),avgAtr:a.na?r(a.sa/a.na,3):null,hit:a.n?r(100*a.hits/a.n,1):null,t:r(tStat(a.mean,a.sd,a.n,h),2)}}

type SigAcc={from:number|null;to:number|null;h:Map<number,{base:Acc;b:Map<number,Acc>;edge:Acc}>};
const newSigAcc=():SigAcc=>({from:null,to:null,h:new Map(HORIZONS.map(h=>[h,{base:new Acc(),b:new Map(BUCKETS.map(b=>[b,new Acc()])),edge:new Acc()}]))});
function mergeSig(into:SigAcc,x:SigAcc){
 if(x.from!==null)into.from=into.from===null?x.from:Math.min(into.from,x.from);
 if(x.to!==null)into.to=into.to===null?x.to:Math.max(into.to,x.to);
 for(const [h,v] of x.h){const t=into.h.get(h)!;t.base.merge(v.base);t.edge.merge(v.edge);for(const [b,a] of v.b)t.b.get(b)!.merge(a)}
}
function finish(id:SignalId,s:SigAcc):SignalStat{
 return {id,label:SIGNAL_LABELS[id],from:s.from,to:s.to,horizons:HORIZONS.map(h=>{const v=s.h.get(h)!;
  return {h,baseline:{n:v.base.n,avgPct:r(v.base.mean,4),upPct:v.base.n?r(100*v.base.up/v.base.n,1):null},buckets:BUCKETS.map(b=>bucketStat(id,b,v.b.get(b)!,v.base,h)),edge:edgeStat(v.edge,h)}})};
}
const SIGNALS:SignalId[]=['trend','season','cot','score'];
// akumulace jednoho trhu: svíčky s from ≤ t < to, signál známý v i, výnos do i+h
export function accumulate(bars:DBar[],sig:Signals,from:number,to:number):Record<SignalId,SigAcc>{
 const out={trend:newSigAcc(),season:newSigAcc(),cot:newSigAcc(),score:newSigAcc()};
 for(let i=0;i<bars.length;i++){
  const t=bars[i].t;if(t<from||t>=to)continue;
  for(const id of SIGNALS){
   const v=sig[id][i];if(v===null||v===undefined)continue;
   const A=out[id];let any=false;
   for(const h of HORIZONS){
    const f=forwardReturn(bars,sig.atr,i,h);if(!f)continue;any=true;
    const H=A.h.get(h)!,dir=sign(v);
    H.base.add(f.pct,f.atr,0);H.b.get(v)!.add(f.pct,f.atr,dir);
    if(dir!==0)H.edge.add(f.pct*dir,f.atr===null?null:f.atr*dir,1); // směrový výnos: kladný = signál měl pravdu
   }
   if(any){if(A.from===null)A.from=t;A.to=t}
  }
 }
 return out;
}

export type StudyMarketIn={instrument:string;bars:DBar[];cot:StepFn|null;score:StepFn|null};
export type StudyResult={from:number;to:number;computedAt:string;markets:string[];aggregate:SignalStat[];perMarket:{instrument:string;bars:number;signals:SignalStat[]}[];notes:string[]};
export function runStudy(markets:StudyMarketIn[],from:number,to:number,now=Date.now()):StudyResult{
 const agg={trend:newSigAcc(),season:newSigAcc(),cot:newSigAcc(),score:newSigAcc()},perMarket:StudyResult['perMarket']=[];
 for(const m of markets){
  const bars=[...m.bars].sort((a,b)=>a.t-b.t),sig=computeSignals(bars,m.cot,m.score),acc=accumulate(bars,sig,from,to);
  for(const id of SIGNALS)mergeSig(agg[id],acc[id]);
  perMarket.push({instrument:m.instrument,bars:bars.filter(b=>b.t>=from&&b.t<to).length,signals:SIGNALS.map(id=>finish(id,acc[id]))});
 }
 const notes=['Signál se počítá na zavření svíčky jen z tehdy známých dat; výnos od close i do close i+h.',
  'Hit rate = podíl případů, kdy znaménko budoucího výnosu souhlasí se znaménkem koše (u koše 0 se neuvádí; „růst“ = podíl kladných).',
  'Baseline = všechny svíčky, kde měl signál hodnotu (stejné období) – rozdíl proti ní ukazuje přidanou hodnotu signálu.',
  't-stat používá n/h (překrývající se výnosy); páry jsou mezi sebou korelované, souhrn proto ber jako orientační.'];
 return {from,to,computedAt:new Date(now).toISOString(),markets:markets.map(m=>m.instrument),aggregate:SIGNALS.map(id=>finish(id,agg[id])),perMarket,notes};
}
