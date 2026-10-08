'use client';
import {useEffect,useState} from 'react';
import {liveState,sparkPath,type LiveQuote} from '@/lib/live';
import './live.css';
export type LiveData={updated:number|null;quotes:Record<string,LiveQuote>};
// Živá data trhů: při mountu, pak po 5 min a při návratu na kartu; chyby nechají poslední data
export function useLive():LiveData|null{
 const [live,setLive]=useState<LiveData|null>(null);
 useEffect(()=>{
  let dead=false;
  const load=async()=>{if(document.visibilityState!=='visible')return;try{const r=await fetch('/api/markets/live',{cache:'no-store'});if(!r.ok)return;const j=await r.json() as LiveData;if(!dead&&j&&j.quotes)setLive(j)}catch{}};
  load();const timer=setInterval(load,300000),vis=()=>{if(document.visibilityState==='visible')load()};
  document.addEventListener('visibilitychange',vis);
  return()=>{dead=true;clearInterval(timer);document.removeEventListener('visibilitychange',vis)};
 },[]);
 return live;
}
const tone=(pct:number)=>pct>0?'up':pct<0?'down':'flat';
export function Spark({points,changePct,width=72,height=22}:{points:[number,number][];changePct:number;width?:number;height?:number}){
 const d=sparkPath(points,width,height);if(!d)return null;
 return <svg className={'lv-spark '+tone(changePct)} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" style={{width,height}}><path d={d} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/></svg>;
}
export const fmtPct=(pct:number)=>(pct>0?'+':'')+pct.toLocaleString('cs-CZ',{minimumFractionDigits:2,maximumFractionDigits:2})+' %';
export function LiveChange({pct}:{pct:number}){return <span className={'lv-change '+tone(pct)}>{fmtPct(pct)}</span>}
const hhmm=(ms:number)=>new Date(ms).toLocaleTimeString('cs-CZ',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit'});
export function LiveBadge({live,quote,now}:{live:LiveData|null;quote:{marketTime:number}|null;now:number}){
 if(!live||!live.updated)return null;
 const s=liveState(live.updated,quote?quote.marketTime:null,now);
 const text=s==='live'?'živě':s==='delayed'?'zpožděno':'zavřeno'+(quote?' · poslední cena '+hhmm(quote.marketTime):'');
 return <span className={'lv-badge '+s} title={'Aktualizováno '+hhmm(live.updated)}><i/>{text}</span>;
}
const fmtPrice=(v:number)=>v.toLocaleString('cs-CZ',{maximumFractionDigits:Math.abs(v)<10?5:Math.abs(v)<1000?2:0});
// Graf dneška: průběh ceny, čára předchozího zavření, hover/dotyk s bublinou (vzor PnlChart)
export function IntradayChart({quote,currencyIndex}:{quote:LiveQuote;currencyIndex?:boolean}){
 const [hover,setHover]=useState<number|null>(null),w=600,h=160,pts=quote.points,n=pts.length;
 if(n<2)return null;
 const t0=pts[0][0],t1=pts[n-1][0],vals=pts.map(p=>p[1]).concat(quote.prevClose),hi=Math.max(...vals),lo=Math.min(...vals),span=(hi-lo)||1;
 const xs=(t:number)=>(t1===t0?0:(t-t0)/(t1-t0))*w,ys=(v:number)=>10+(hi-v)/span*(h-20),yp=ys(quote.prevClose);
 const line=pts.map((p,i)=>(i?'L':'M')+xs(p[0]).toFixed(1)+' '+ys(p[1]).toFixed(1)).join(' '),cls=tone(quote.changePct);
 const pick=(e:React.PointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect(),t=t0+Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*(t1-t0);let b=0;for(let i=1;i<n;i++)if(Math.abs(pts[i][0]-t)<Math.abs(pts[b][0]-t))b=i;setHover(b)};
 const hp=hover===null?null:pts[hover],hx=hp?xs(hp[0])/w*100:0,hy=hp?ys(hp[1])/h*100:0,hc=hp&&quote.prevClose?(hp[1]/quote.prevClose-1)*100:0;
 return <div className="lv-chartwrap" onPointerMove={pick} onPointerDown={pick} onPointerLeave={()=>setHover(null)} onPointerCancel={()=>setHover(null)}>
  <svg className={'lv-chart '+cls} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
   <line x1="0" x2={w} y1={yp} y2={yp} className="lv-prev" vectorEffect="non-scaling-stroke"/>
   <path d={`${line} L${xs(t1)} ${h} L0 ${h} Z`} className="lv-area"/>
   <path d={line} fill="none" className="lv-line" vectorEffect="non-scaling-stroke"/>
   {hp&&<line x1={xs(hp[0])} x2={xs(hp[0])} y1="0" y2={h} className="lv-guide" vectorEffect="non-scaling-stroke"/>}
  </svg>
  {hp&&<><i className={'lv-dot '+cls} style={{left:hx+'%',top:hy+'%'}}/><div className="lv-tip" role="status" style={{left:hx+'%',transform:`translateX(${hx<18?'-12%':hx>82?'-88%':'-50%'})`}}>
   <b>{hhmm(hp[0])}</b>{!currencyIndex&&<span>Cena <em>{fmtPrice(hp[1])}</em></span>}<span>Od zavření <em className={tone(hc)}>{fmtPct(hc)}</em></span>
  </div></>}
 </div>;
}
export {fmtPrice};
