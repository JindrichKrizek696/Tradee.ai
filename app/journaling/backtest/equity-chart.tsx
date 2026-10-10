'use client';
// Equity křivka (nahoře) + drawdown v % (dole) na časové ose; víc řad = porovnání běhů.
// Najetím myší (prstem) se ukáže datum, hodnota a drawdown každé řady.
import {useId,useMemo,useState} from 'react';
import type {EquityPoint} from '@/lib/backtest/engine';
import {drawdownSeries} from '@/lib/backtest/metrics';
import {fmtNum} from '@/lib/journal/format';
export type Series={label:string;points:EquityPoint[];cls:'a'|'b';raw?:EquityPoint[]}; // raw = skutečná equity pro drawdown, když points jsou přepočtené (např. na %)
// poslední bod s t ≤ time (equity je schodovitá – mění se jen při uzavření obchodu)
function at<T extends {t:number}>(a:T[],time:number):T|null{let lo=0,hi=a.length-1,r=-1;while(lo<=hi){const m=(lo+hi)>>1;if(a[m].t<=time){r=m;lo=m+1}else hi=m-1}return r<0?null:a[r]}
export function EquityChart({series,fmt,base}:{series:Series[];fmt:(v:number)=>string;base?:number}){
 const gid=useId(),[hover,setHover]=useState<number|null>(null);
 const dds=useMemo(()=>series.map(s=>drawdownSeries(s.raw||s.points)),[series]);
 const all=series.flatMap(s=>s.points);
 if(all.length<2)return <p className="j-muted">Křivka potřebuje aspoň jeden uzavřený obchod.</p>;
 const W=600,H=170,DH=64,t0=Math.min(...all.map(p=>p.t)),t1=Math.max(...all.map(p=>p.t)),ts=(t1-t0)||1;
 const vals=all.map(p=>p.equity),lo=Math.min(...vals,base??Infinity),hi=Math.max(...vals,base??-Infinity),span=(hi-lo)||1;
 const ddMin=Math.min(-0.5,...dds.flatMap(d=>d.map(p=>p.ddPct)));
 const x=(t:number)=>(t-t0)/ts*W,y=(v:number)=>8+(hi-v)/span*(H-16),yd=(v:number)=>2+v/ddMin*(DH-4);
 // schodovitá cesta: vodorovně do času dalšího bodu, pak svisle
 const step=(pts:{t:number;v:number}[],fy:(v:number)=>number)=>pts.map((p,i)=>i?`H${x(p.t).toFixed(1)}V${fy(p.v).toFixed(1)}`:`M${x(p.t).toFixed(1)},${fy(p.v).toFixed(1)}`).join('')+`H${W}`;
 const time=hover===null?null:t0+hover*ts,hx=hover===null?0:hover*100;
 const pick=(e:React.PointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect();setHover(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)))};
 const first=series[0].points,one=series.length===1,endUp=one&&first[first.length-1].equity>=first[0].equity;
 return <div className="bt-chart" onPointerMove={pick} onPointerLeave={()=>setHover(null)}>
  <div className="bt-axis"><span>{fmt(hi)}</span><span>{fmt(lo)}</span></div>
  <svg className="bt-eq" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={one?`Equity od ${fmt(first[0].equity)} do ${fmt(first[first.length-1].equity)}`:'Porovnání equity dvou běhů'}>
   {one&&<defs><linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0" style={{stopColor:endUp?'var(--bull)':'var(--bear)',stopOpacity:.22}}/><stop offset="1" style={{stopColor:endUp?'var(--bull)':'var(--bear)',stopOpacity:.01}}/></linearGradient></defs>}
   {base!==undefined&&<line x1="0" x2={W} y1={y(base)} y2={y(base)} className="base"/>}
   {one&&<path d={step(first.map(p=>({t:p.t,v:p.equity})),y)+`V${H}H${x(first[0].t)}Z`} style={{fill:`url(#${gid})`}} className="area"/>}
   {series.map(s=><path key={s.cls} d={step(s.points.map(p=>({t:p.t,v:p.equity})),y)} className={'ln '+(one?endUp?'pos':'neg':s.cls)}/>)}
   {time!==null&&<line x1={x(time)} x2={x(time)} y1="0" y2={H} className="guide"/>}
  </svg>
  <div className="bt-ddlabel"><span>Drawdown</span><span>{fmtNum(ddMin,1)} %</span></div>
  <svg className="bt-dd" viewBox={`0 0 ${W} ${DH}`} preserveAspectRatio="none" aria-hidden="true">
   <line x1="0" x2={W} y1="2" y2="2" className="base"/>
   {dds.map((d,i)=><path key={series[i].cls} d={step(d.map(p=>({t:p.t,v:p.ddPct})),yd)+(one?`V2H${x(d[0].t)}Z`:'')} className={'dd '+(one?'one':series[i].cls)}/>)}
   {time!==null&&<line x1={x(time)} x2={x(time)} y1="0" y2={DH} className="guide"/>}
  </svg>
  <div className="bt-axis x"><span>{new Date(t0).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague'})}</span><span>{new Date(t1).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague'})}</span></div>
  {time!==null&&<div className="j-curvetip bt-tip" role="status" style={{left:hx+'%',transform:`translateX(${hx<18?'-12%':hx>82?'-88%':'-50%'})`}}>
   <b>{new Date(time).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague'})}</b>
   {series.map((s,i)=>{const p=at(s.points,time),d=at(dds[i],time);return p&&<span key={s.cls}>{!one&&<i className={'bt-dot '+s.cls}/>}{one?'Equity':s.label} <em>{fmt(p.equity)}</em>{d&&d.ddPct<0&&<em className="neg">{fmtNum(d.ddPct,1)} %</em>}</span>})}
  </div>}
 </div>;
}
