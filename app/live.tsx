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
