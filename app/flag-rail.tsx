'use client';
import {useEffect,useMemo,useState} from 'react';
import {plural} from '@/lib/journal/format';
import {fmtMoney} from '@/lib/trades';
import type {OpenPosition} from '@/lib/positions/open';
import type {OpenData} from './open-positions';
const tone=(n:number|null)=>!n?'':n>0?'up':'down';
const vol=(v:number)=>v.toLocaleString('cs-CZ',{maximumFractionDigits:2});
export type MarketPos={count:number;sides:string;pnl:string;sum:number|null;stale:boolean};

// Otevřené pozice seskupené podle trhu (instrument z mapSymbol): strana + objem, plovoucí P&L po měnách, „EA neběží“ jen když neposílají všechny
export function byMarket(data:OpenData|null):Map<string,MarketPos>{
 const g=new Map<string,OpenPosition[]>(),out=new Map<string,MarketPos>();
 for(const p of data?.positions||[])if(p.instrument)g.set(p.instrument,[...(g.get(p.instrument)||[]),p]);
 for(const [id,list] of g){
  const fresh=list.filter(p=>!p.stale),sides=(['buy','sell'] as const).map(s=>{const v=list.filter(p=>p.side===s).reduce((a,p)=>a+p.volume,0);return v?s+' '+vol(v):''}).filter(Boolean).join(' / ');
  const sums=new Map<string,[number,boolean]>();
  for(const p of fresh)if(p.pnl!==null){const cur=p.converted?data!.currency:p.accountCurrency,x=sums.get(cur)||[0,p.converted];sums.set(cur,[x[0]+p.pnl,x[1]])}
  const parts=[...sums].map(([cur,[n,conv]])=>(conv?'':'≈ ')+fmtMoney(Math.round(n*100)/100,cur));
  const sum=sums.size?[...sums.values()].reduce((a,[n])=>a+n,0):null;
  out.set(id,{count:list.length,sides,pnl:parts.join(' + '),sum,stale:!fresh.length});
 }
 return out;
}
// Souhrn pro sbalenou lištu: počet označených trhů v obchodě a znaménko součtu plovoucího P&L
export function railSummary(flagged:string[],pos:Map<string,MarketPos>){
 const hit=flagged.filter(id=>pos.has(id)),sum=hit.reduce((a,id)=>a+(pos.get(id)!.sum||0),0);
 return {n:hit.length,tone:hit.every(id=>pos.get(id)!.sum===null)?'':tone(Math.round(sum*100))};
}
export const inTradeText=(n:number,total:number)=>`V obchodě ${n} z ${total} ${plural(total,['označeného','označených','označených'])}`;

// Checklist: postup „splněno/celkem“ za trh, načítá se líně až při rozbalení lišty a po sbalení se zahodí
export type Progress={done:number;total:number}|null;
export function useChecklistProgress(ids:string[],active:boolean){
 const [map,setMap]=useState<Record<string,Progress>>({}),key=ids.join('|');
 useEffect(()=>{
  if(!active){setMap({});return}
  let live=true;
  Promise.all(ids.map(async id=>{
   try{
    const r=await fetch('/api/checklists/state?instrument='+encodeURIComponent(id),{cache:'no-store'});if(!r.ok)return [id,null] as const;
    const j=await r.json() as {checklists:{id:string;items:{id:string}[]}[];state:Record<string,string[]>};
    const lists=j.checklists||[],total=lists.reduce((a,l)=>a+l.items.length,0);
    if(!total)return [id,null] as const;
    const done=lists.reduce((a,l)=>{const on=new Set(j.state?.[l.id]||[]);return a+l.items.filter(i=>on.has(i.id)).length},0);
    return [id,{done,total}] as const;
   }catch{return [id,null] as const}
  })).then(rs=>{if(live)setMap(Object.fromEntries(rs))});
  return()=>{live=false}},[active,key]);// eslint-disable-line react-hooks/exhaustive-deps
 return map;
}
// Pod 1200 px jsou lišty karty pod obsahem (vždy rozbalené)
export function useNarrow(){
 const [n,setN]=useState(false);
 useEffect(()=>{const m=window.matchMedia('(max-width:1199px)'),f=()=>setN(m.matches);f();m.addEventListener('change',f);return()=>m.removeEventListener('change',f)},[]);
 return n;
}
export function PositionLine({p}:{p?:MarketPos}){
 if(!p)return <small className="d-fl-pos none">bez pozice</small>;
 return <small className="d-fl-pos"><i className="d-fl-live" aria-hidden="true"/>{p.sides}{p.stale?<em className="d-fl-stale"> · EA neběží</em>:p.pnl&&<> · <b className={tone(p.sum)}>{p.pnl}</b></>}</small>;
}
export const useMarkets=(data:OpenData|null)=>useMemo(()=>byMarket(data),[data]);
