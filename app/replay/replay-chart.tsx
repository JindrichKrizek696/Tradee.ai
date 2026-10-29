'use client';
// Graf replaye (vlastní, nezávislý na hlavním grafu): svíčky jednoho rámce do simulačních hodin, rozpracovaná svíčka vyššího rámce
// šedě, čáry vstupu / SL / TP otevřených pozic a čekajících příkazů, značky vstupů a výstupů.
import {useEffect,useRef} from 'react';
import {createChart,CandlestickSeries,LineStyle,createSeriesMarkers,type IChartApi,type ISeriesApi,type IPriceLine,type ISeriesMarkersPluginApi,type UTCTimestamp,type SeriesMarker,type Time} from 'lightweight-charts';
import type {Candle} from '@/lib/replay/clock';
export type ChartLine={price:number;title:string;kind:'entry'|'sl'|'tp'|'order'};
export type ChartMark={t:number;side:'long'|'short';kind:'in'|'out';text:string};
const css=(name:string,fallback:string)=>typeof document==='undefined'?fallback:getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback;
const PARTIAL='rgba(148,163,184,0.55)';
export function precisionOf(prices:number[]):number{
 let p=2;for(const x of prices.slice(-200)){const s=String(x);const i=s.indexOf('.');if(i>=0)p=Math.max(p,Math.min(6,s.length-i-1))}return p;
}
const prague=(sec:number)=>new Date(sec*1000).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',year:'2-digit',hour:'2-digit',minute:'2-digit'});
export function ReplayChart({candles,lines,marks,label,snap}:{candles:Candle[];lines:ChartLine[];marks:ChartMark[];label:string;snap:(t:number)=>number}){
 const el=useRef<HTMLDivElement>(null),chart=useRef<IChartApi|null>(null),series=useRef<ISeriesApi<'Candlestick'>|null>(null),pl=useRef<IPriceLine[]>([]),mk=useRef<ISeriesMarkersPluginApi<Time>|null>(null),fitted=useRef(false);
 useEffect(()=>{
  if(!el.current)return;
  const theme=()=>{const line=css('--t-border','#e5e7eb');return {layout:{background:{color:'transparent'},textColor:css('--t-muted','#6b7280'),fontFamily:'inherit'},grid:{vertLines:{color:line},horzLines:{color:line}},rightPriceScale:{borderColor:line},timeScale:{borderColor:line,timeVisible:true,secondsVisible:false,rightOffset:6}}};
  const c=createChart(el.current,{autoSize:true,...theme(),localization:{locale:'cs-CZ',timeFormatter:(t:number)=>prague(t)}});
  const bull=css('--bull','#16a34a'),bear=css('--bear','#dc2626');
  const s=c.addSeries(CandlestickSeries,{upColor:bull,downColor:bear,borderVisible:false,wickUpColor:bull,wickDownColor:bear});
  chart.current=c;series.current=s;mk.current=createSeriesMarkers(s,[]);fitted.current=false;
  const recolor=()=>{const b=css('--bull','#16a34a'),r=css('--bear','#dc2626');c.applyOptions(theme());s.applyOptions({upColor:b,downColor:r,wickUpColor:b,wickDownColor:r})};
  const obs=new MutationObserver(recolor);obs.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class','style']});
  return()=>{obs.disconnect();c.remove();chart.current=null;series.current=null;mk.current=null;pl.current=[]};
 },[]);
 useEffect(()=>{
  const s=series.current;if(!s)return;
  const prec=precisionOf(candles.map(c=>c.c));s.applyOptions({priceFormat:{type:'price',precision:prec,minMove:1/10**prec}});
  s.setData(candles.map(c=>({time:Math.floor(c.t/1000) as UTCTimestamp,open:c.o,high:c.h,low:c.l,close:c.c,...(c.partial?{color:PARTIAL,wickColor:PARTIAL,borderColor:PARTIAL}:{})})));
  if(!fitted.current&&candles.length){chart.current?.timeScale().setVisibleLogicalRange({from:Math.max(0,candles.length-120),to:candles.length+6});fitted.current=true}
 },[candles]);
 useEffect(()=>{
  const s=series.current;if(!s)return;
  for(const l of pl.current)s.removePriceLine(l);
  const col={entry:'#2563eb',sl:css('--bear','#dc2626'),tp:css('--bull','#16a34a'),order:'#a855f7'};
  pl.current=lines.map(l=>s.createPriceLine({price:l.price,color:col[l.kind],lineStyle:l.kind==='entry'?LineStyle.Solid:LineStyle.Dashed,lineWidth:1,title:l.title,axisLabelVisible:true}));
 },[lines]);
 useEffect(()=>{
  const times=new Set(candles.map(c=>Math.floor(c.t/1000)));
  const m:SeriesMarker<Time>[]=marks.map(x=>({time:Math.floor(snap(x.t)/1000) as UTCTimestamp,position:((x.kind==='in')===(x.side==='long')?'belowBar':'aboveBar') as 'belowBar'|'aboveBar',color:x.kind==='in'?'#2563eb':'#64748b',shape:(x.kind==='in'?(x.side==='long'?'arrowUp':'arrowDown'):'circle') as 'arrowUp'|'arrowDown'|'circle',text:x.text}))
   .filter(x=>times.has(x.time as number)).sort((a,b)=>(a.time as number)-(b.time as number));
  mk.current?.setMarkers(m);
 },[marks,candles,snap]);
 return <div ref={el} className="rp-chart" role="img" aria-label={label}/>;
}
