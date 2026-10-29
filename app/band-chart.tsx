'use client';
// Malý SVG graf pro detaily (COT s pásmy indexu, historie ukazatele): čáry s mezerami (null), volitelné pásmo, odečet bodu pod grafem.
import {useState} from 'react';
import './analysis-detail.css';
export type BandLine={values:(number|null)[];label:string;color:string;dashed?:boolean;dots?:boolean};
const W=780,H=240,L=56,R=760,T=16,B=206;
export function BandChart({labels,lines,band,unit='',readout,ariaLabel}:{labels:string[];lines:BandLine[];band?:{low:number[];high:number[];label:string};unit?:string;readout?:(i:number)=>React.ReactNode;ariaLabel:string}){
 const n=Math.max(labels.length,1),[sel,setSel]=useState<number|null>(null);
 const vals=[...lines.flatMap(l=>l.values.filter((v):v is number=>v!==null&&Number.isFinite(v))),...(band?[...band.low,...band.high]:[])];
 if(!vals.length)return <p className="ad-empty">Pro graf zatím nejsou číselné hodnoty.</p>;
 const lo=Math.min(...vals),hi=Math.max(...vals),pad=(hi-lo||Math.abs(hi)||1)*.1,min=lo-pad,max=hi+pad;
 const x=(i:number)=>n===1?(L+R)/2:L+i/(n-1)*(R-L),y=(v:number)=>B-(v-min)/(max-min)*(B-T);
 const fmt=(v:number)=>v.toLocaleString('cs-CZ',{maximumFractionDigits:Math.abs(hi-lo)<5?2:0});
 const seg=(vs:(number|null)[])=>{const out:string[][]=[];let cur:string[]=[];vs.forEach((v,i)=>{if(v===null||!Number.isFinite(v)){if(cur.length)out.push(cur);cur=[]}else cur.push(`${x(i)},${y(v)}`)});if(cur.length)out.push(cur);return out};
 const pick=(e:React.MouseEvent<SVGSVGElement>)=>{const m=e.currentTarget.getScreenCTM();if(!m)return;const vx=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse()).x;setSel(Math.max(0,Math.min(n-1,Math.round((vx-L)/(R-L)*(n-1)))))};
 const key=(e:React.KeyboardEvent<SVGSVGElement>)=>{const d=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0;if(!d)return;e.preventDefault();setSel(s=>Math.max(0,Math.min(n-1,(s??n-1)+d)))};
 const a=sel??n-1;
 return <div className="ad-chart">
  <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} tabIndex={0} onMouseMove={pick} onClick={pick} onKeyDown={key}>
   {[min+pad,(min+max)/2,max-pad].map((v,i)=><g key={i}><line x1={L} x2={R} y1={y(v)} y2={y(v)} className="ad-grid"/><text x={L-6} y={y(v)+4} textAnchor="end" className="ad-axis">{fmt(v)}{unit}</text></g>)}
   {min<0&&max>0&&<line x1={L} x2={R} y1={y(0)} y2={y(0)} className="ad-zero"/>}
   {band&&<polygon className="ad-band" points={band.high.map((v,i)=>`${x(i)},${y(v)}`).join(' ')+' '+[...band.low].map((v,i)=>`${x(i)},${y(v)}`).reverse().join(' ')}/>}
   {lines.map(l=><g key={l.label}>{seg(l.values).map((p,k)=><polyline key={k} points={p.join(' ')} fill="none" stroke={l.color} strokeWidth="2.2" strokeDasharray={l.dashed?'5 4':undefined}/>)}{(l.dots||n<40)&&l.values.map((v,i)=>v===null?null:<circle key={i} cx={x(i)} cy={y(v)} r="2.8" fill={l.color}/>)}</g>)}
   <line x1={x(a)} x2={x(a)} y1={T} y2={B} className="ad-cursor"/>
   {labels.filter((_,i)=>i===0||i===n-1||i===Math.floor((n-1)/2)).map((t,i,arr)=><text key={i} x={arr.length===1?(L+R)/2:L+i/(arr.length-1)*(R-L)} y={H-10} textAnchor={arr.length===1?'middle':i===0?'start':i===arr.length-1?'end':'middle'} className="ad-axis">{t}</text>)}
  </svg>
  <div className="ad-legend">{lines.map(l=><span key={l.label}><i style={{background:l.color}}/>{l.label}</span>)}{band&&<span><i className="ad-band-key"/>{band.label}</span>}</div>
  <div className="ad-readout" aria-live="polite"><b>{labels[a]}</b>{readout?readout(a):lines.map(l=><span key={l.label}>{l.label}: <b>{l.values[a]===null||l.values[a]===undefined?'—':fmt(l.values[a] as number)+unit}</b></span>)}</div>
 </div>;
}
