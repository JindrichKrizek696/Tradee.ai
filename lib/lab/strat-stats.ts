// Laboratoř · Strategie – statistiky a podklady grafů z kompaktních záznamů obchodů běhu (VariantResult.tx, lib/lab/strat-engine.ts tradeRows).
// Čisté funkce bez závislostí na enginu (běží v prohlížeči i v testech scripts/check-lab-strategies.mjs). Všechno v R (1 R = původní riziko).
// Win = R > 0, jinak ztráta (stejně jako metriky enginu). Monte Carlo je deterministické podle seedu (mulberry32).
import type {TradeRows} from './strat-engine.ts';

export type Tx={market:string;side:1|-1;entryT:number;exitT:number;r:number;riskPct:number;pnlPct:number;bars:number;mae:number;mfe:number;reason:string;oos:boolean};
const REASONS=['sl','be','tp','time','end'];
const MIN=60000;
// rozbalení řádků; split = začátek OOS (ms) – úsek podle času vstupu (stejně jako evaluate v enginu)
export function decodeTx(tx:TradeRows|null|undefined,split:number):Tx[]{
 if(!tx||tx.v!==1||!Array.isArray(tx.rows))return [];
 return tx.rows.map(([m,side,e,x,r,rp,bars,mae,mfe,reason])=>({market:tx.markets[m]??'?',side:side>0?1:-1,entryT:e*MIN,exitT:x*MIN,r,riskPct:rp,pnlPct:r*rp,bars,mae,mfe,reason:REASONS[reason]??'end',oos:e*MIN>=split}));
}

const mean=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
// výběrová směrodatná odchylka (n − 1)
export function stdev(a:number[]):number|null{if(a.length<2)return null;const m=mean(a)!;return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1))}
// kvantil s lineární interpolací (q 0…1) nad SEŘAZENÝM polem
export function quantile(sorted:ArrayLike<number>,q:number):number|null{
 const n=sorted.length;if(!n)return null;const p=(n-1)*Math.min(1,Math.max(0,q)),lo=Math.floor(p),hi=Math.ceil(p);
 return sorted[lo]+(sorted[hi]-sorted[lo])*(p-lo);
}

// ---- série výher / proher
export function streaks(rs:number[]):{maxWins:number;maxLosses:number}{
 let w=0,l=0,mw=0,ml=0;for(const r of rs){if(r>0){w++;l=0}else{l++;w=0}if(w>mw)mw=w;if(l>ml)ml=l}
 return {maxWins:mw,maxLosses:ml};
}
// SQN (Van Tharp) = √min(n,100) × průměr R / směrodatná odchylka R; n < 2 nebo nulový rozptyl = null
export function sqn(rs:number[]):number|null{const s=stdev(rs);if(s===null||!(s>0))return null;return Math.sqrt(Math.min(rs.length,100))*mean(rs)!/s}
export type RStats={n:number;wins:number;losses:number;winRate:number|null;avgWin:number|null;avgLoss:number|null;payoff:number|null;expectancy:number|null;
 sd:number|null;sqn:number|null;totalR:number;maxWins:number;maxLosses:number};
// expectancy = win rate × průměrná výhra + (1 − win rate) × průměrná ztráta (= průměr R)
export function rStats(rs:number[]):RStats{
 const w=rs.filter(r=>r>0),l=rs.filter(r=>r<=0),n=rs.length,wr=n?w.length/n:null,aw=mean(w),al=mean(l);
 const exp=wr===null?null:wr*(aw??0)+(1-wr)*(al??0);
 return {n,wins:w.length,losses:l.length,winRate:wr===null?null:wr*100,avgWin:aw,avgLoss:al,payoff:aw!==null&&al!==null&&al<0?aw/-al:null,expectancy:exp,
  sd:stdev(rs),sqn:sqn(rs),totalR:rs.reduce((s,x)=>s+x,0),...streaks(rs)};
}

// ---- křivka v R, drawdown pod vodou a nejdelší drawdown
export type CurvePt={t:number;cum:number};
export function equityR(tx:Pick<Tx,'exitT'|'r'>[]):CurvePt[]{let c=0;return [...tx].sort((a,b)=>a.exitT-b.exitT).map(t=>({t:t.exitT,cum:c+=t.r}))}
// drawdown = kumulativní R − dosavadní maximum (start 0 se počítá jako maximum)
export function underwater(pts:CurvePt[]):{t:number;dd:number}[]{let pk=0;return pts.map(p=>{pk=Math.max(pk,p.cum);return {t:p.t,dd:p.cum-pk}})}
export function maxDrawdown(rs:ArrayLike<number>):number{let c=0,pk=0,dd=0;for(let i=0;i<rs.length;i++){c+=rs[i];if(c>pk)pk=c;if(c-pk<dd)dd=c-pk}return dd}
// nejdelší období pod předchozím maximem: počet obchodů a délka v čase (od obchodu s maximem do obchodu, který ho překonal / vyrovnal, nebo do konce)
export function ddDuration(pts:CurvePt[]):{trades:number;ms:number;from:number|null;to:number|null;recovered:boolean}{
 let best={trades:0,ms:0,from:null as number|null,to:null as number|null,recovered:true};
 if(!pts.length)return best;
 let pk=0,pkIdx=-1,pkT=pts[0].t,under=false;
 const end=(k:number,rec:boolean)=>{const n=k-pkIdx,ms=pts[k].t-pkT;if(n>best.trades||(n===best.trades&&ms>best.ms))best={trades:n,ms,from:pkT,to:pts[k].t,recovered:rec}};
 for(let k=0;k<pts.length;k++){const p=pts[k];
  if(p.cum>=pk){if(under)end(k,true);under=false;pk=p.cum;pkIdx=k;pkT=p.t}else under=true;
 }
 if(under)end(pts.length-1,false);
 return best;
}

// ---- histogramy a percentily
export type Bin={lo:number;hi:number;n:number};
// koše pevné šířky zarovnané na násobky šířky (0,5 R: …, [−0,5; 0), [0; 0,5), …), prázdné koše mezi min a max zůstávají
export function histogram(vals:number[],width=.5):Bin[]{
 const v=vals.filter(Number.isFinite);if(!v.length)return [];
 const k=(x:number)=>Math.floor(x/width+1e-9),lo=Math.min(...v.map(k)),hi=Math.max(...v.map(k)),out:Bin[]=[];
 for(let i=lo;i<=hi;i++)out.push({lo:i*width,hi:(i+1)*width,n:0});
 for(const x of v)out[k(x)-lo].n++;
 return out;
}
// percentil hodnoty x mezi vals: podíl menších + polovina shodných (0–100)
export function percentileOf(vals:number[],x:number):number|null{if(!vals.length)return null;let lt=0,eq=0;for(const v of vals){if(v<x)lt++;else if(v===x)eq++}return (lt+eq/2)/vals.length*100}

// ---- měsíce a roky (podle času výstupu, UTC)
export type MonthRow={year:number;months:(number|null)[];counts:number[];total:number;trades:number};
export function monthly(tx:Pick<Tx,'exitT'|'r'>[]):MonthRow[]{
 const by=new Map<number,MonthRow>();
 for(const t of tx){const d=new Date(t.exitT),y=d.getUTCFullYear(),m=d.getUTCMonth();
  let row=by.get(y);if(!row){row={year:y,months:Array(12).fill(null),counts:Array(12).fill(0),total:0,trades:0};by.set(y,row)}
  row.months[m]=(row.months[m]??0)+t.r;row.counts[m]++;row.total+=t.r;row.trades++}
 return [...by.values()].sort((a,b)=>a.year-b.year);
}

// ---- rozpady
export type Group={key:string;label:string;order:number;trades:number;wins:number;winRate:number;avgR:number;totalR:number};
export function breakdown<T extends Pick<Tx,'r'>>(tx:T[],keyOf:(t:T)=>{key:string;label:string;order?:number}|null):Group[]{
 const m=new Map<string,Group>();
 for(const t of tx){const k=keyOf(t);if(!k)continue;let g=m.get(k.key);if(!g){g={key:k.key,label:k.label,order:k.order??0,trades:0,wins:0,winRate:0,avgR:0,totalR:0};m.set(k.key,g)}
  g.trades++;if(t.r>0)g.wins++;g.totalR+=t.r}
 for(const g of m.values()){g.winRate=g.wins/g.trades*100;g.avgR=g.totalR/g.trades}
 return [...m.values()].sort((a,b)=>a.order-b.order||a.label.localeCompare(b.label,'cs'));
}
const fmts=new Map<string,Intl.DateTimeFormat>();
// místní čas v časovém pásmu: {wd 0 = pondělí … 6 = neděle, min = minut od půlnoci}
export function localClock(tz:string,t:number):{wd:number;min:number}{
 let f=fmts.get(tz);if(!f){f=new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});fmts.set(tz,f)}
 const p=Object.fromEntries(f.formatToParts(new Date(t)).map(x=>[x.type,x.value]));
 return {wd:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(p.weekday),min:Number(p.hour)%24*60+Number(p.minute)};
}
export type SessionWin={id:string;label:string;tz:string;from:string;to:string};
// výchozí seance jako v definicích (lib/lab/rules-def.ts DEFAULT_SESSIONS)
export const SESSIONS:SessionWin[]=[{id:'asia',label:'Asie',tz:'Asia/Tokyo',from:'09:00',to:'18:00'},{id:'london',label:'Londýn',tz:'Europe/London',from:'08:00',to:'17:00'},{id:'ny',label:'New York',tz:'America/New_York',from:'08:00',to:'17:00'}];
const hm=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3,5));
// seance vstupu: všechny seance, do kterých čas padne (překryv = „Londýn + New York“), jinak „mimo seance“
export function sessionOf(t:number,sessions=SESSIONS):{key:string;label:string;order:number}{
 const hit=sessions.map((s,i)=>({s,i})).filter(({s})=>{const c=localClock(s.tz,t);if(c.wd>4)return false;const a=hm(s.from),b=hm(s.to);return a<=b?c.min>=a&&c.min<b:c.min>=a||c.min<b});
 if(!hit.length)return {key:'off',label:'mimo seance',order:99};
 return {key:hit.map(h=>h.s.id).join('+'),label:hit.map(h=>h.s.label).join(' + '),order:hit[0].i*10+hit.length};
}
export const WEEKDAYS=['pondělí','úterý','středa','čtvrtek','pátek','sobota','neděle'];
// obchodní den: New York 17:00 = začátek dalšího dne (jako FX); den vstupu podle něj
export function tradingDay(t:number):number{return localClock('America/New_York',t+7*3600000).wd}
export function hourPrague(t:number):number{return Math.floor(localClock('Europe/Prague',t).min/60)}
export const HOLD_BUCKETS:[number,number,string][]=[[0,1,'1 svíčka'],[2,3,'2–3'],[4,6,'4–6'],[7,12,'7–12'],[13,24,'13–24'],[25,48,'25–48'],[49,Infinity,'49 a víc']];
export function holdBucket(bars:number):{key:string;label:string;order:number}{const i=HOLD_BUCKETS.findIndex(([a,b])=>bars>=a&&bars<=b);const k=i<0?HOLD_BUCKETS.length-1:i;return {key:'h'+k,label:HOLD_BUCKETS[k][2],order:k}}

// ---- klouzavá expectancy (průměr R posledních `w` obchodů; první bod po w obchodech)
export function rolling(rs:number[],w=20):(number|null)[]{
 const out:(number|null)[]=[];let s=0;for(let i=0;i<rs.length;i++){s+=rs[i];if(i>=w)s-=rs[i-w];out.push(i>=w-1?s/w:null)}return out;
}

// ---- Monte Carlo: přeházené pořadí obchodů (Fisher–Yates, seed) → pásma 5 / 50 / 95 % kumulativního R a rozdělení max. drawdownu
export function mulberry32(seed:number){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}}
export type MonteCarlo={runs:number;seed:number;idx:number[];p5:number[];p50:number[];p95:number[];dd:number[];ddP:{p5:number;p50:number;p95:number}|null;final:{p5:number;p50:number;p95:number}|null};
export function monteCarlo(rs:number[],o:{runs?:number;seed?:number;points?:number}={}):MonteCarlo{
 const runs=o.runs??1000,seed=o.seed??1,n=rs.length,P=Math.min(n,o.points??160);
 const idx=P?Array.from({length:P},(_,k)=>Math.round((k+1)*n/P)-1):[];
 if(!n)return {runs,seed,idx,p5:[],p50:[],p95:[],dd:[],ddP:null,final:null};
 const rnd=mulberry32(seed),a=Float64Array.from(rs),at=new Float64Array(runs*P),dd=new Float64Array(runs);
 for(let k=0;k<runs;k++){
  for(let i=n-1;i>0;i--){const j=Math.floor(rnd()*(i+1)),x=a[i];a[i]=a[j];a[j]=x}
  let c=0,pk=0,m=0,q=0;for(let i=0;i<n;i++){c+=a[i];if(c>pk)pk=c;if(c-pk<m)m=c-pk;if(q<P&&idx[q]===i)at[k*P+q++]=c}
  dd[k]=m;
 }
 const col=new Float64Array(runs),p5:number[]=[],p50:number[]=[],p95:number[]=[];
 for(let q=0;q<P;q++){for(let k=0;k<runs;k++)col[k]=at[k*P+q];col.sort();p5.push(quantile(col,.05)!);p50.push(quantile(col,.5)!);p95.push(quantile(col,.95)!)}
 const ds=Float64Array.from(dd).sort();
 return {runs,seed,idx,p5,p50,p95,dd:Array.from(dd),ddP:{p5:quantile(ds,.05)!,p50:quantile(ds,.5)!,p95:quantile(ds,.95)!},final:{p5:p5[P-1],p50:p50[P-1],p95:p95[P-1]}};
}

// ---- MAE / MFE: postřehy (jen čísla z obchodů, žádná doporučení parametrů definice)
export type MaeInsight={id:string;text:string;share:number|null};
export function maeMfeInsights(tx:Pick<Tx,'r'|'mae'|'mfe'>[],o:{deep?:number;giveBack?:number}={}):MaeInsight[]{
 const deep=o.deep??.8,give=o.giveBack??1,W=tx.filter(t=>t.r>0),L=tx.filter(t=>t.r<=0),out:MaeInsight[]=[];
 const pc=(a:number,b:number)=>b?a/b*100:null,f=(x:number)=>x.toLocaleString('cs-CZ',{maximumFractionDigits:1});
 if(W.length){const k=W.filter(t=>t.mae>=deep).length,s=pc(k,W.length)!;
  out.push({id:'deepWinners',share:s,text:`${f(s)} % výherních obchodů (${k} z ${W.length}) šlo nejdřív aspoň −${f(deep)} R proti pozici.`});
  const ms=W.map(t=>t.mae).sort((a,b)=>a-b),q90=quantile(ms,.9)!;
  out.push({id:'winnerMae90',share:null,text:`90 % výher mělo MAE do ${f(q90)} R – stop těsnější než ${f(q90)} R by vyhodil aspoň desetinu výher.`});
 }
 if(L.length){const k=L.filter(t=>t.mfe>=give).length,s=pc(k,L.length)!;
  out.push({id:'lostRunners',share:s,text:`${f(s)} % ztrát (${k} z ${L.length}) bylo nejdřív aspoň +${f(give)} R v zisku – kandidát na posun stopu na BE nebo částečný výstup.`});
  const half=L.filter(t=>t.mfe<.2).length,s2=pc(half,L.length)!;
  out.push({id:'neverWorked',share:s2,text:`${f(s2)} % ztrát se nikdy nedostalo ani na +0,2 R (vstup hned proti).`});
 }
 if(W.length){const capt=W.filter(t=>t.mfe>0).map(t=>t.r/t.mfe),m=mean(capt);
  if(m!==null)out.push({id:'capture',share:m*100,text:`Výhry v průměru vybraly ${f(m*100)} % svého největšího zisku (R / MFE).`});
 }
 return out;
}

// ---- příbuzné definice podle názvu: „název“, „název-volna“, „název-prisna“ (přípona za posledním „-“)
const baseOf=(s:string)=>{const i=s.lastIndexOf('-');return i>0?s.slice(0,i):null};
export function siblingNames(name:string,names:string[]):string[]{
 const b=baseOf(name);
 return [...new Set(names)].filter(n=>n!==name&&(n.startsWith(name+'-')&&!n.slice(name.length+1).includes('-')||b!==null&&(n===b||baseOf(n)===b))).sort((a,c)=>a.localeCompare(c,'cs'));
}

// ---- živá simulace vs backtest: odchylka průměru R ve směrodatných chybách backtestu
export type Drift={n:number;avgR:number|null;winRate:number|null;diffR:number|null;diffWin:number|null;z:number|null;level:'few'|'ok'|'watch'|'off'};
export function drift(live:number[],bt:{avgR:number|null;winRate:number|null;sd:number|null},minN=5):Drift{
 const n=live.length,avg=mean(live),wr=n?live.filter(r=>r>0).length/n*100:null;
 const diffR=avg!==null&&bt.avgR!==null?avg-bt.avgR:null,diffWin=wr!==null&&bt.winRate!==null?wr-bt.winRate:null;
 const z=diffR!==null&&bt.sd&&n?diffR/(bt.sd/Math.sqrt(n)):null;
 const level=n<minN||z===null?'few':Math.abs(z)<1?'ok':Math.abs(z)<2?'watch':'off';
 return {n,avgR:avg,winRate:wr,diffR,diffWin,z,level};
}

// ---- zmenšení křivky na nejvýš `max` bodů (poslední bod vždy)
export function thin<T>(a:T[],max=300):T[]{if(a.length<=max)return a;const step=a.length/max,out:T[]=[];for(let k=0;k<max-1;k++)out.push(a[Math.floor(k*step)]);out.push(a[a.length-1]);return out}
