// Metriky Statistik s vzorcem, počtem obchodů (N) a seznamem obchodů pro proklik; režimy živě / simulace / replay se nemíchají.
// Čisté funkce – testy scripts/check-journal-ideas.mjs.
import type {JournalTrade} from './types.ts';
const r2=(n:number)=>Math.round(n*100)/100;
export const MODES={live:'Živě',sim:'Simulace',replay:'Replay'} as const;
export type Mode=keyof typeof MODES;
export const isMode=(v:unknown):v is Mode=>typeof v==='string'&&v in MODES;
export const modeOf=(t:{mode?:Mode|null})=>t.mode??'live';
export const byMode=<T extends {mode?:Mode|null}>(list:T[],mode:Mode|'all')=>mode==='all'?list:list.filter(t=>modeOf(t)===mode);
export const modesIn=(list:{mode?:Mode|null}[])=>(Object.keys(MODES) as Mode[]).filter(m=>list.some(t=>modeOf(t)===m));
export type Metric={key:string;label:string;value:number|null;unit:'money'|'R'|'%'|'x';n:number;ids:string[];formula:string};
const byClose=(a:JournalTrade,b:JournalTrade)=>a.closeTs-b.closeTs||a.id.localeCompare(b.id);
/** Max. pokles z křivky (od nuly); vrací i obchody mezi vrcholem a dnem. */
export function drawdownOf(points:{id:string;value:number}[]):{dd:number;ids:string[]}{
 let peak=0,peakI=-1,dd=0,from=-1,to=-1;
 points.forEach((p,i)=>{if(p.value>peak){peak=p.value;peakI=i}if(peak-p.value>dd){dd=peak-p.value;from=peakI+1;to=i}});
 return {dd:r2(dd),ids:dd>0?[...new Set(points.slice(Math.max(0,from),to+1).map(p=>p.id))]:[]};
}
/** Křivka zůstatku = kumulace uzavřených výsledků; křivka equity navíc obsahuje nejhorší bod během obchodu (MAE), pokud je známý. */
export function curves(trades:JournalTrade[]){
 const s=[...trades].sort(byClose);let c=0;const bal:{id:string;value:number}[]=[],eq:{id:string;value:number}[]=[];
 for(const t of s){if(t.mae!==null&&t.mae!==undefined&&t.mae<0)eq.push({id:t.id,value:r2(c+t.mae)});c=r2(c+t.pnl);bal.push({id:t.id,value:c});eq.push({id:t.id,value:c})}
 return {balance:bal,equity:eq,hasMae:s.some(t=>t.mae!==null&&t.mae!==undefined)};
}
export function metrics(trades:JournalTrade[]):Metric[]{
 const all=trades.map(t=>t.id),wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0),withR=trades.filter(t=>t.r!==null);
 const gw=wins.reduce((a,t)=>a+t.pnl,0),gl=-losses.reduce((a,t)=>a+t.pnl,0),n=trades.length;
 const mfe=trades.filter(t=>t.mfeR!==null),mae=trades.filter(t=>t.maeR!==null),cv=curves(trades);
 const ddB=drawdownOf(cv.balance),ddE=cv.hasMae?drawdownOf(cv.equity):null;
 const avg=(l:JournalTrade[],f:(t:JournalTrade)=>number)=>l.length?r2(l.reduce((a,t)=>a+f(t),0)/l.length):null;
 return [
  {key:'pf',label:'Profit factor',value:gl>0?r2(gw/gl):null,unit:'x',n,ids:all,formula:'Součet zisků ÷ součet ztrát (v absolutní hodnotě). Bez ztrátového obchodu není definován.'},
  {key:'exp',label:'Expectancy',value:n?r2((gw-gl)/n):null,unit:'money',n,ids:all,formula:'Čistý výsledek všech obchodů ÷ počet obchodů (po nákladech).'},
  {key:'expR',label:'Expectancy v R',value:avg(withR,t=>t.r as number),unit:'R',n:withR.length,ids:withR.map(t=>t.id),formula:'Průměr R; R = čistý výsledek ÷ PŮVODNÍ plánované riziko (plán, jinak první stop). Posunutý stop se nepočítá. Obchody bez stopu mají neznámé R a nezapočítají se.'},
  {key:'win',label:'Win rate',value:n?r2(100*wins.length/n):null,unit:'%',n,ids:wins.map(t=>t.id),formula:'Obchody v zisku ÷ všechny obchody × 100. Nulový výsledek není výhra.'},
  {key:'avgWin',label:'Prům. zisk',value:avg(wins,t=>t.pnl),unit:'money',n:wins.length,ids:wins.map(t=>t.id),formula:'Součet zisků ÷ počet ziskových obchodů.'},
  {key:'avgLoss',label:'Prům. ztráta',value:avg(losses,t=>t.pnl),unit:'money',n:losses.length,ids:losses.map(t=>t.id),formula:'Součet ztrát ÷ počet ztrátových obchodů.'},
  {key:'mfe',label:'Prům. MFE',value:avg(mfe,t=>t.mfeR as number),unit:'R',n:mfe.length,ids:mfe.map(t=>t.id),formula:'Průměr největšího zisku během obchodu v R (z dat EA, jinak z H1 svíček trhu). Jen obchody, kde je známý.'},
  {key:'mae',label:'Prům. MAE',value:avg(mae,t=>t.maeR as number),unit:'R',n:mae.length,ids:mae.map(t=>t.id),formula:'Průměr největší ztráty během obchodu v R (z dat EA, jinak z H1 svíček trhu). Jen obchody, kde je známý.'},
  {key:'ddBal',label:'Max. DD (zůstatek)',value:n?-ddB.dd:null,unit:'money',n,ids:ddB.ids,formula:'Největší pokles kumulovaného uzavřeného výsledku od předchozího maxima (start = 0).'},
  {key:'ddEq',label:'Max. DD (equity)',value:ddE?-ddE.dd:null,unit:'money',n:trades.filter(t=>t.mae!==null&&t.mae!==undefined).length,ids:ddE?.ids??[],formula:'Jako DD ze zůstatku, ale s nejhorším bodem během každého obchodu (MAE). Souběžné pozice se sčítají jen přibližně.'},
 ];
}
const csvCell=(v:unknown)=>{const s=v===null||v===undefined?'':String(v);return /[",;\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
/** Export obchodů do CSV (oddělovač ;) včetně režimu, nápadu a R z původního rizika. */
export function tradesCsv(trades:JournalTrade[]):string{
 const head=['id','rezim','ucet','symbol','smer','otevreno','zavreno','vysledek','R','riziko_pct','napad'];
 const rows=trades.map(t=>[t.id,MODES[modeOf(t)],t.account,t.symbol,t.side??'',t.openTs?new Date(t.openTs).toISOString():'',new Date(t.closeTs).toISOString(),t.pnl,t.r??'',t.riskPct??'',t.ideaId??'']);
 return [head,...rows].map(r=>r.map(csvCell).join(';')).join('\n');
}
/** MFE / MAE v R z H1 svíček trhu (když chybí data z EA): nejlepší a nejhorší cena svíček, které překrývají dobu obchodu, vůči vstupu ÷ |vstup − původní stop|. Přibližné (H1, data trhu, ne brokera). */
export function excursionR(bars:{t:number;h:number;l:number}[],o:{side:'buy'|'sell';entry:number;stop:number|null;openTs:number;closeTs:number}):{mfeR:number;maeR:number}|null{
 if(o.stop===null)return null;const risk=Math.abs(o.entry-o.stop);if(!(risk>0))return null;
 const in_=bars.filter(b=>b.t+3600000>o.openTs&&b.t<o.closeTs);if(!in_.length)return null;
 const hi=Math.max(...in_.map(b=>b.h)),lo=Math.min(...in_.map(b=>b.l));
 const best=o.side==='buy'?hi-o.entry:o.entry-lo,worst=o.side==='buy'?lo-o.entry:o.entry-hi;
 return {mfeR:r2(Math.max(0,best)/risk),maeR:r2(Math.min(0,worst)/risk)};
}
