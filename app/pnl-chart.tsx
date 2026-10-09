'use client';
import {useId,useState} from 'react';
import {fmtMoney,type Bucket} from '@/lib/trades';
export const GHOST:Bucket[]=[14,-6,22,9,-12,18,26,-4,12,30,-9,16,24,8].map((pnl,i,a)=>({label:'',pnl,future:false,cum:a.slice(0,i+1).reduce((s,x)=>s+x,0)}));
// Sloupec od nulové osy: zakulacený jen na vnějším konci (u nuly rovný).
export function barPath(x:number,y:number,w:number,h:number,up:boolean){const r=Math.min(4,w/3,h);return up?`M${x} ${y+h}V${y+r}Q${x} ${y} ${x+r} ${y}H${x+w-r}Q${x+w} ${y} ${x+w} ${y+r}V${y+h}Z`:`M${x} ${y}H${x+w}V${y+h-r}Q${x+w} ${y+h} ${x+w-r} ${y+h}H${x+r}Q${x} ${y+h} ${x} ${y+h-r}Z`}
// Denní (u roku měsíční) výsledek jako sloupce od nuly + kumulativní křivka s plochou k nule (nad nulou zelená, pod červená); ghost = zástupný graf pro prázdný stav.
// Najetím myší (nebo prstem) se ukáže výsledek a průběžný součet daného dne/měsíce.
export function PnlChart({buckets,ghost,currency='USD',title}:{buckets:Bucket[];ghost?:boolean;currency?:string;title?:(b:Bucket,i:number)=>string}){
 const id=useId(),[hover,setHover]=useState<number|null>(null),w=600,h=150,n=buckets.length,step=w/n,bw=Math.max(3,Math.min(22,step*.56));
 const cums=buckets.filter(b=>b.cum!==null).map(b=>b.cum as number),hi=Math.max(0,...cums),lo=Math.min(0,...cums),span=(hi-lo)||1,yl=(v:number)=>14+(hi-v)/span*(h-28),y0=yl(0);
 const k=(h*.42)/Math.max(1,...buckets.map(b=>Math.abs(b.pnl)));
 const pts=buckets.flatMap((b,i)=>b.cum===null?[]:[[i*step+step/2,yl(b.cum)] as [number,number]]);
 const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' '),last=pts.at(-1);
 const pick=(e:React.PointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect();setHover(Math.max(0,Math.min(n-1,Math.floor((e.clientX-r.left)/r.width*n))))};
 const hb=hover===null||ghost?null:buckets[hover],hx=hover===null?0:(hover+.5)/n*100;
 return <div className="d-pnlhover" onPointerMove={ghost?undefined:pick} onPointerLeave={()=>setHover(null)}>
  <svg className={'d-pnlchart'+(ghost?' ghost':'')} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
   <defs><linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" y2={h}><stop offset="0" style={{stopColor:'var(--bull)',stopOpacity:.26}}/><stop offset={y0/h} style={{stopColor:'var(--bull)',stopOpacity:.03}}/><stop offset={y0/h} style={{stopColor:'var(--bear)',stopOpacity:.03}}/><stop offset="1" style={{stopColor:'var(--bear)',stopOpacity:.26}}/></linearGradient></defs>
   {hb&&<rect x={hover!*step} y="0" width={step} height={h} className="d-pnl-band"/>}
   <line x1="0" x2={w} y1={y0} y2={y0} className="d-zero" vectorEffect="non-scaling-stroke"/>
   {buckets.map((b,i)=>{const x=i*step+(step-bw)/2;if(b.future||!b.pnl)return <rect key={i} x={x+bw/2-1.5} y={y0-1.5} width="3" height="3" rx="1.5" className="d-pnl-dot"/>;const hh=Math.max(2,b.pnl>0?Math.min(b.pnl*k,y0-4):Math.min(-b.pnl*k,h-y0-4));return <path key={i} d={barPath(x,b.pnl>0?y0-hh:y0,bw,hh,b.pnl>0)} className={b.pnl>0?'d-pnl-up':'d-pnl-down'}/>})}
   {pts.length>1&&<><path d={`${line} L${pts[pts.length-1][0]} ${y0} L${pts[0][0]} ${y0} Z`} fill={`url(#${id})`}/><path d={line} fill="none" className="d-pnl-line" vectorEffect="non-scaling-stroke"/></>}
   {last&&!ghost&&<circle cx={last[0]} cy={last[1]} r="4" className="d-pnl-end"/>}
  </svg>
  {hb&&<div className="d-pnltip" role="status" style={{left:hx+'%',transform:`translateX(${hx<18?'-12%':hx>82?'-88%':'-50%'})`}}>
   <b>{title?title(hb,hover!):hb.label}</b>
   {hb.future?<span>Ještě nenastalo</span>:<><span>Výsledek <em className={hb.pnl>0?'up':hb.pnl<0?'down':''}>{hb.pnl?fmtMoney(hb.pnl,currency):'bez obchodů'}</em></span>{hb.cum!==null&&<span>Celkem <em className={hb.cum>0?'up':hb.cum<0?'down':''}>{fmtMoney(hb.cum,currency)}</em></span>}</>}
  </div>}
 </div>;
}
