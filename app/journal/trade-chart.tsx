'use client';
import {useEffect,useRef} from 'react';
import {createChart,CandlestickSeries,LineSeries,LineStyle,LineType,createSeriesMarkers,type UTCTimestamp} from 'lightweight-charts';
import {candles,levelSteps,tradeMarkers,snapper,type Bar} from '@/lib/journal/chart-data';
import type {JournalChange,JournalPosition} from '@/lib/journal/types';
const css=(name:string,fallback:string)=>getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback;
export function TradeChart({bars,position:p,changes}:{bars:Bar[];position:JournalPosition;changes:JournalChange[]}){
 const el=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!el.current||!bars.length)return;
  const theme=()=>{const line=css('--t-border','#e5e7eb');return {layout:{background:{color:'transparent'},textColor:css('--t-muted','#6b7280'),fontFamily:'inherit'},grid:{vertLines:{color:line},horzLines:{color:line}},rightPriceScale:{borderColor:line},timeScale:{borderColor:line,timeVisible:true,secondsVisible:false}}};
  const chart=createChart(el.current,{autoSize:true,...theme()});
  const data=candles(bars),snap=snapper(data.map(b=>b.time)),bull=css('--bull','#16a34a'),bear=css('--bear','#dc2626');
  const s=chart.addSeries(CandlestickSeries,{upColor:bull,downColor:bear,borderVisible:false,wickUpColor:bull,wickDownColor:bear});
  s.setData(data.map(b=>({...b,time:b.time as UTCTimestamp})));
  const close=p.close_ts??bars[bars.length-1][0];
  const steps=(color:string,title:string,pts:{time:number;value?:number}[])=>{const l=chart.addSeries(LineSeries,{color,lineWidth:2,lineType:LineType.WithSteps,title,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});l.setData(pts.map(x=>({...x,time:x.time as UTCTimestamp})))};
  steps(bear,'SL',levelSteps('sl',p.sl_initial,changes,p.open_ts,close,snap));
  steps(bull,'TP',levelSteps('tp',p.tp_initial,changes,p.open_ts,close,snap));
  s.createPriceLine({price:p.open_price,color:'#2563eb',lineStyle:LineStyle.Dashed,lineWidth:1,title:'Vstup',axisLabelVisible:true});
  if(p.mfe_price!==null)s.createPriceLine({price:p.mfe_price,color:bull,lineStyle:LineStyle.Dotted,lineWidth:1,title:'MFE',axisLabelVisible:false});
  if(p.mae_price!==null)s.createPriceLine({price:p.mae_price,color:bear,lineStyle:LineStyle.Dotted,lineWidth:1,title:'MAE',axisLabelVisible:false});
  createSeriesMarkers(s,tradeMarkers(p.side,changes,snap).map(m=>({...m,time:m.time as UTCTimestamp})));
  chart.timeScale().fitContent();
  // přepnutí světlý/tmavý režim
  const obs=new MutationObserver(()=>chart.applyOptions(theme()));obs.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class']});
  return()=>{obs.disconnect();chart.remove()};
 },[bars,p,changes]);
 return <div ref={el} className="j-chart" role="img" aria-label={`Graf obchodu ${p.symbol}: svíčky, vstup, výstupy, stop loss a take profit`}/>;
}
