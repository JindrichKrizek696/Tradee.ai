// COT detail: řada pozic jedné kategorie, COT index (0–100 v rozpětí zvoleného okna), percentil a pásma indexu 20/80.
// Čistá logika; kontrola: node --experimental-strip-types scripts/check-season-cot.mjs
import type {CotContract} from './score-engine.ts';
import {cotPublished} from './cot-dates.ts';
export const COT_WINDOWS=[26,52,156] as const;
export type CotPoint={date:string;published:string;long:number;short:number;net:number;change:number|null;oi:number};
/** Řada vybrané kategorie (bez reportů, kde kategorie chybí), od nejstaršího. */
export function cotSeries(contract:CotContract|undefined,group:string):CotPoint[]{
 const h=(contract?.history||[]).filter(r=>r.groups[group]);
 return h.map((r,i)=>{const g=r.groups[group],p=h[i-1]?.groups[group];return {date:r.date,published:cotPublished(r.date),long:g.long,short:g.short,net:g.net,change:p?g.net-p.net:null,oi:r.openInterest}});
}
export type CotIndex={index:number|null;percentile:number|null;min:number;max:number;n:number;requested:number;short:boolean;low:number;high:number};
/** COT index = (net − min) / (max − min) × 100 v posledních `window` reportech (včetně aktuálního); percentil = podíl hodnot pod aktuální (shody napůl).
 *  short = k dispozici méně reportů, než okno chce (výsledek je z kratší historie). Pod 8 reporty se index nepočítá. */
export function cotIndex(points:CotPoint[],window:number,at=points.length-1):CotIndex{
 const slice=points.slice(Math.max(0,at-window+1),at+1),vals=slice.map(p=>p.net),n=vals.length;
 const cur=points[at]?.net,min=n?Math.min(...vals):0,max=n?Math.max(...vals):0;
 const ok=n>=8&&cur!==undefined;
 const index=!ok?null:max===min?50:100*(cur-min)/(max-min);
 const percentile=!ok?null:100*(vals.filter(v=>v<cur).length+.5*vals.filter(v=>v===cur).length)/n;
 return {index,percentile,min,max,n,requested:window,short:n<window,low:min+.2*(max-min),high:min+.8*(max-min)};
}
/** Klouzavý index pro graf: v každém bodě pásma 20/80 z okna končícího tímto bodem. */
export const cotBands=(points:CotPoint[],window:number)=>points.map((_,i)=>cotIndex(points,window,i));
/** Text snímku do poznámky scénáře. */
export function cotSnapshotText(o:{market:string;report:string;group:string;contract:string;p:CotPoint;idx:CotIndex}){
 const f=(n:number)=>(n>0?'+':'')+n.toLocaleString('cs-CZ',{maximumFractionDigits:0});
 return `[COT ${o.report} · ${o.market} · ${o.group}] pozice k ${o.p.date}, zveřejněno ${o.p.published} · ${o.contract}: long ${o.p.long.toLocaleString('cs-CZ')} / short ${o.p.short.toLocaleString('cs-CZ')} · net ${f(o.p.net)}${o.p.change===null?'':' (týden '+f(o.p.change)+')'} · COT index ${o.idx.index===null?'—':Math.round(o.idx.index)} a percentil ${o.idx.percentile===null?'—':Math.round(o.idx.percentile)} za ${o.idx.n} týdnů${o.idx.short?' (kratší historie než '+o.idx.requested+')':''}`;
}
