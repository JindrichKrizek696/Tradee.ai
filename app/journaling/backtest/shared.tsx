'use client';
// Sdílené typy a pomocníci záložky Backtest (tvary odpovědí /api/backtest, formátování, číselné pole).
import {createContext,useContext,useEffect,useId,useState} from 'react';
import type {StrategyRules,Condition} from '@/lib/backtest/rules';
import type {BacktestTrade,EquityPoint,MarketResult,Coverage,BtTf,ExitReason} from '@/lib/backtest/engine';
import type {BacktestSummary} from '@/lib/backtest/metrics';
import type {PlanVsReality} from '@/lib/backtest/request';
import {SESSIONS,WEEKDAYS} from '@/lib/journal/analytics';
import {fmtNum,fmtDate} from '@/lib/journal/format';
export type RunParams={markets:string[];tf:BtTf;from:number;to:number;capital:number;riskPct:number;barMs:number;rules:StrategyRules};
export type RunResult={trades:BacktestTrade[];truncated:boolean;equity:EquityPoint[];perMarket:MarketResult[];coverage:Coverage;warnings:string[];plan:PlanVsReality};
export type RunRow={id:string;strategyId:string;created:string;params:RunParams;summary:BacktestSummary};
export type Run=RunRow&{result:RunResult};
export type Strategy={id:string;name:string;archived:boolean};
export const CUR='USD';
export async function call<T>(url:string,method='GET',body?:unknown):Promise<T>{
 let r:Response;
 try{r=await fetch(url,{method,cache:'no-store',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})}
 catch{throw Error('Spojení se nepodařilo. Zkontroluj připojení a zkus to znovu.')}
 const j=await r.json().catch(()=>({})) as {error?:string};
 if(!r.ok)throw Error(j.error||(r.status>=500?'Server teď neodpovídá správně. Zkus to za chvíli znovu.':'Akce se nepovedla.'));
 return j as T;
}
// datum „YYYY-MM-DD HH:MM:SS“ (UTC z DB) → ms
export const sqlMs=(s:string)=>Date.parse(s.replace(' ','T')+'Z');
const dIso=(ms:number)=>new Date(ms).toISOString().slice(0,10);
// `to` je vyjma (konec období), proto −1 ms
export const fmtPeriod=(from:number,to:number)=>`${fmtDate(dIso(from))} – ${fmtDate(dIso(to-1))}`;
export const fmtPct=(n:number|null,d=1,sign=false)=>n===null?'–':(sign&&n>0?'+':'')+fmtNum(n,d)+' %';
export const fmtPf=(s:BacktestSummary)=>s.profitFactor!==null?fmtNum(s.profitFactor,2):s.wins>0?'∞':'–';
export const tone=(n:number|null)=>n===null||n===0?'':n>0?'pos':'neg';
export const REASONS:Record<ExitReason,string>={sl:'Stop loss',tp:'Take profit',signal:'Podmínky neplatí',time:'Časový limit',end:'Konec období'};
export const marketsText=(m:string[])=>m.length<=3?m.join(', '):`${m.slice(0,2).join(', ')} + ${m.length-2} další`;
const ma=(k:string,p:number)=>`${k.toUpperCase()} ${p}`;
// krátký popis podmínky (seznam běhů, porovnání)
export function condText(c:Condition):string{
 switch(c.type){
  case 'score':return c.op==='rising'||c.op==='falling'?`Skóre ${c.op==='rising'?'roste':'klesá'} (${c.days} d)`:`Skóre ${c.op} ${fmtNum(c.value,1)}`;
  case 'strength':return `Síla měn ${c.op} ${fmtNum(c.value,1)}`;
  case 'cot':return c.op==='long'?'COT net long':c.op==='short'?'COT net short':`COT změna ${c.op} ${fmtNum(c.value,0)}`;
  case 'ma':return `Cena ${c.op==='above'?'nad':'pod'} ${ma(c.kind,c.period)}`;
  case 'ma_cross':return `${c.kind.toUpperCase()} ${c.fast}×${c.slow} ${c.dir==='up'?'↑':'↓'}`;
  case 'breakout':return `Průraz ${c.dir==='up'?'max':'min'} ${c.period}`;
  case 'ma_distance':return `Vzd. od ${ma(c.kind,c.period)} ${c.op} ${fmtNum(c.value,2)} ATR`;
  case 'rsi':return `RSI ${c.period} ${c.op==='cross_up'?'↗':c.op==='cross_down'?'↘':c.op} ${fmtNum(c.value,0)}`;
  case 'change':return `Změna ${c.bars} sv. ${c.op} ${fmtNum(c.value,2)} %`;
  case 'atr':return `ATR ${c.op==='above'?'nad':'pod'} ${fmtNum(c.k,1)}× prům. ${c.period}`;
  case 'session':return 'Seance: '+(c.sessions.map(s=>SESSIONS.find(x=>x.key===s)?.label).join(', ')||'–');
  case 'weekday':return 'Dny: '+(c.days.map(d=>WEEKDAYS[d]).join(', ')||'–');
  case 'hour':return `Hodina ${c.from}–${c.to}`;
  case 'no_news':return `Bez zpráv ±${c.minutes} min (≥ ${c.minSignal})`;
 }
}
export const rulesText=(r:StrategyRules)=>r.entry.map(condText).join(' · ')||'bez podmínek';
// neplatná číselná pole hlásí rodiči (id pole, je neplatné) – záložka podle toho zablokuje spuštění
export const InvalidCtx=createContext<((id:string,bad:boolean)=>void)|null>(null);
// číselné pole: drží rozepsaný text (čárka i tečka), ven pošle jen platné číslo; prázdné → null (když allowEmpty)
export function NumInput({value,onChange,min,max,step,allowEmpty,label,placeholder,disabled,wide}:{value:number|null;wide?:boolean;onChange:(v:number|null)=>void;min?:number;max?:number;step?:number;allowEmpty?:boolean;label:string;placeholder?:string;disabled?:boolean}){
 const [text,setText]=useState(value===null?'':String(value).replace('.',',')),id=useId(),report=useContext(InvalidCtx);
 useEffect(()=>{setText(t=>{const n=Number(t.replace(',','.'));return (t.trim()===''&&value===null)||(t.trim()!==''&&n===value)?t:value===null?'':String(value).replace('.',',')})},[value]);
 const n=Number(text.replace(',','.')),bad=text.trim()===''?!allowEmpty:!Number.isFinite(n)||(min!==undefined&&n<min)||(max!==undefined&&n>max);
 useEffect(()=>{report?.(id,bad)},[report,id,bad]);
 useEffect(()=>()=>report?.(id,false),[report,id]);
 return <input type="text" inputMode="decimal" className={'bt-num'+(wide?' wide':'')+(bad?' bad':'')} value={text} aria-label={label} aria-invalid={bad||undefined} placeholder={placeholder} disabled={disabled} data-step={step}
  onChange={e=>{const t=e.target.value;setText(t);if(t.trim()===''){if(allowEmpty)onChange(null);return}const v=Number(t.replace(',','.'));if(Number.isFinite(v)&&(min===undefined||v>=min)&&(max===undefined||v<=max))onChange(v)}}/>;
}
