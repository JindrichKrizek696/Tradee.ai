'use client';
// Prognózy FX páru (Trading Economics, ING Think) – jen informace, žádný signál Tradee. Data: data/forecasts.json (scripts/refresh-forecasts.mjs).
import {changePct,digits,type Forecasts,type Pt} from '@/lib/forecasts/core';
import './forecast-card.css';
const nf=(v:number,d:number)=>v.toLocaleString('cs-CZ',{minimumFractionDigits:d,maximumFractionDigits:d});
const periodLabel=(p:string)=>p.replace(/^(\d{4})-Q(\d)$/,'Q$2 $1');
const day=(iso:string)=>new Date(iso+'T12:00:00Z').toLocaleDateString('cs-CZ');
function Row({pair,label,value,spot}:{pair:string;label:string;value:number;spot:number|null}){
 const c=spot?changePct(value,spot):null;
 return <div className="fc-row"><span>{label}</span><b>{nf(value,digits(pair))}</b><em className={c===null?'':c>0?'positive':c<0?'negative':'neutral'}>{c===null?'–':(c>0?'+':c<0?'−':'')+nf(Math.abs(c),2)+' %'}</em></div>;
}
export default function ForecastCard({pair,forecasts,spot}:{pair:string;forecasts?:Forecasts;spot?:number|null}){
 const f=forecasts?.pairs?.[pair];if(!f||(!f.te&&!f.ing))return null;
 const te=f.te,ing=f.ing,ref=spot??te?.current??null;
 const teRows:{label:string;pt:Pt|{value:number}}[]=[];
 if(te?.q)teRows.push({label:'Konec čtvrtletí ('+periodLabel(te.q.period)+')',pt:te.q});
 if(te?.y12)teRows.push({label:'Za 12 měsíců',pt:te.y12});
 if(te?.quarters&&!te.y12)te.quarters.slice(1).forEach(q=>teRows.push({label:'Konec '+periodLabel(q.period),pt:q}));
 const ingRows=ing?([ing.q1,ing.q2,ing.q3,ing.q4].filter(Boolean) as Pt[]):[];
 const derived=!!(te?.derived||ing?.derived);
 return <section className="s-card fc-card" aria-label="Prognózy">
  <div className="s-card-head" style={{marginBottom:0}}><h2>Prognózy</h2>{derived&&<span className="s-badge" title="Hodnoty páru jsou přepočtem z kotací zdroje přes USD, zdroj je pro tento pár sám nezveřejňuje.">přepočet přes USD</span>}</div>
  <div className="fc-grid">
   {te&&teRows.length>0&&<div><h3>Trading Economics</h3>{teRows.map(r=><Row key={r.label} pair={pair} label={r.label} value={r.pt.value} spot={ref}/>)}<small className="fc-meta">{te.asOf?'k '+day(te.asOf)+' · ':''}<a href={te.url} target="_blank" rel="noreferrer">zdroj</a></small></div>}
   {ing&&ingRows.length>0&&<div><h3>ING Think</h3>{ingRows.map(r=><Row key={r.period} pair={pair} label={'Konec '+periodLabel(r.period)} value={r.value} spot={ref}/>)}<small className="fc-meta">k {day(ing.asOf)} · <a href={ing.url} target="_blank" rel="noreferrer">zdroj</a></small></div>}
  </div>
  <p className="s-note fc-note">Změna je proti aktuální ceně{ref?' ('+nf(ref,digits(pair))+')':''}. Prognózy bank a modelů nejsou signál Tradee; jejich přesnost sledujeme v Laboratoři.</p>
 </section>;
}
