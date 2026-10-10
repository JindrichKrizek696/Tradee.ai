'use client';
// Graf trhu v detailu trhu: svíčky H1/H4/D1 (Yahoo přes /api/chart/candles) s vrstvami obchodů, otevřené pozice, zpráv, skóre a seancí a s kreslením (market-chart-draw).
import {useEffect,useMemo,useRef,useState} from 'react';
import {createChart,CandlestickSeries,HistogramSeries,LineStyle,createSeriesMarkers,type IChartApi,type ISeriesApi,type ISeriesMarkersPluginApi,type IPriceLine,type MouseEventParams,type Time,type UTCTimestamp} from 'lightweight-charts';
import {candles as toBars} from '@/lib/journal/chart-data';
import {TF_SEC,newsLayer,newsMarkers,tradeMarkers,sortMarkers,scoreBand,sessionBands,tradeResult,SESSION_COLORS} from '@/lib/chart/layers';
import {SESSIONS} from '@/lib/journal/analytics';
import {scoreSeries,type HistoryLike} from '@/lib/dashboard';
import type {CalendarEvent} from '@/lib/calendar';
import type {Candle,Tf} from '@/lib/chart/candles';
import type {ChartTrade} from '@/lib/chart/trades';
import {fmtMoney} from '@/lib/trades';
import {useOpenPositions} from './open-positions';
import {fmtPrice} from './live';
import {useChartDrawings} from './market-chart-draw';
import './market-chart.css';

type Layers={trades:boolean;news:boolean;score:boolean;sessions:boolean};
type Prefs={tf:Tf;layers:Layers};
type Loaded={status:'loading'|'ok'|'error'|'unsupported';candles:Candle[];stale:boolean;updated:number|null;message?:string};
type Bar={time:number;open:number;high:number;low:number;close:number};
type Tip={x:number;y:number;flip:boolean;lines:string[]};
const KEY='tradee.chart',TFS:Tf[]=['H1','H4','D1'];
const DEFAULT:Prefs={tf:'H4',layers:{trades:true,news:true,score:true,sessions:true}};
const LAYER_LABELS:[keyof Layers,string][]=[['trades','Obchody'],['news','Zprávy'],['score','Skóre'],['sessions','Seance']];
const css=(name:string,fallback:string)=>getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback;
const dark=()=>document.documentElement.dataset.theme==='dark';
function readPrefs():Prefs{try{const v=JSON.parse(localStorage.getItem(KEY)||'null');if(!v)return DEFAULT;return {tf:TFS.includes(v.tf)?v.tf:DEFAULT.tf,layers:{...DEFAULT.layers,...Object.fromEntries(Object.entries(v.layers||{}).filter(([k,x])=>k in DEFAULT.layers&&typeof x==='boolean'))}}}catch{return DEFAULT}}
// čas grafu je pražský čas zakódovaný jako UTC → formátovat v UTC
const barLabel=(t:number,tf:Tf)=>new Date(t*1000).toLocaleString('cs-CZ',{timeZone:'UTC',day:'numeric',month:'numeric',year:tf==='D1'?'numeric':undefined,...(tf==='D1'?{}:{hour:'2-digit',minute:'2-digit'} as const)});
const eventTime=(e:CalendarEvent)=>new Date(e.at).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',...(e.timeKnown?{hour:'2-digit',minute:'2-digit'} as const:{})})+(e.timeKnown?'':' · čas neupřesněn');
const scoreFmt=(v:number)=>(v>0?'+':'')+v.toLocaleString('cs-CZ',{maximumFractionDigits:1});
const pct=(a:number,b:number)=>{const v=(b-a)/a*100;return (v>0?'+':'')+v.toLocaleString('cs-CZ',{maximumFractionDigits:2})+' %'};
const precision=(v:number)=>Math.abs(v)<10?5:Math.abs(v)<1000?2:0;

export function MarketChart({instrument,name,history,method,events,height,headExtra}:{instrument:string;name:string;history:HistoryLike;method:string;events:CalendarEvent[];height?:string;headExtra?:React.ReactNode}){
 const [prefs,setPrefs]=useState<Prefs>(DEFAULT),[ready,setReady]=useState(false);
 const [data,setData]=useState<Loaded>({status:'loading',candles:[],stale:false,updated:null}),[reload,setReload]=useState(0);
 const [trades,setTrades]=useState<ChartTrade[]>([]),[tradesError,setTradesError]=useState(false);
 const [hover,setHover]=useState<Bar|null>(null),[tip,setTip]=useState<Tip|null>(null),[tick,setTick]=useState(0);
 const {data:open}=useOpenPositions();
 const el=useRef<HTMLDivElement>(null),chart=useRef<IChartApi|null>(null),price=useRef<ISeriesApi<'Candlestick'>|null>(null),sess=useRef<ISeriesApi<'Histogram'>|null>(null),score=useRef<ISeriesApi<'Histogram'>|null>(null),markers=useRef<ISeriesMarkersPluginApi<Time>|null>(null),lines=useRef<IPriceLine[]>([]);
 // data pro handlery grafu (crosshair, klik) – mění se bez znovuvytvoření grafu
 const lookup=useRef<{bars:Map<number,Bar>;trades:Map<string,ChartTrade>;news:Map<string,CalendarEvent>}>({bars:new Map(),trades:new Map(),news:new Map()});
 const {tf,layers}=prefs;

 useEffect(()=>{setPrefs(readPrefs());setReady(true)},[]);
 const update=(p:Partial<Prefs>)=>setPrefs(old=>{const next={...old,...p};try{localStorage.setItem(KEY,JSON.stringify(next))}catch{}return next});
 const toggle=(k:keyof Layers)=>update({layers:{...layers,[k]:!layers[k]}});

 // svíčky pro zvolený TF
 useEffect(()=>{
  if(!ready)return;const ac=new AbortController();
  setData(d=>({...d,status:'loading'}));
  fetch(`/api/chart/candles?instrument=${encodeURIComponent(instrument)}&tf=${tf}`,{signal:ac.signal}).then(async r=>{
   const j=await r.json().catch(()=>({})) as {candles?:Candle[];stale?:boolean;updated?:number|null;unsupported?:boolean;error?:string};
   if(j.unsupported){setData({status:'unsupported',candles:[],stale:false,updated:null});return}
   if(!r.ok||!Array.isArray(j.candles))throw new Error(j.error||'');
   setData({status:j.candles.length?'ok':'error',candles:j.candles,stale:!!j.stale,updated:j.updated??null,message:j.candles.length?undefined:j.error||'Pro tento trh zatím nejsou svíčky.'});
  }).catch(e=>{if(!ac.signal.aborted)setData({status:'error',candles:[],stale:false,updated:null,message:e instanceof Error&&e.message?e.message:'Graf se nepodařilo načíst.'})});
  return()=>ac.abort();
 },[instrument,tf,ready,reload]);
 // obchody uživatele na trhu (jednou na trh)
 useEffect(()=>{const ac=new AbortController();
  fetch('/api/chart/trades?instrument='+encodeURIComponent(instrument),{signal:ac.signal,cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{trades?:ChartTrade[]}>:Promise.reject()).then((j:{trades?:ChartTrade[]})=>{setTrades(j.trades||[]);setTradesError(false)}).catch(()=>{if(!ac.signal.aborted)setTradesError(true)});
  return()=>ac.abort()},[instrument]);

 // graf: vytvoří se jednou, data a vrstvy se nastavují v dalších efektech
 useEffect(()=>{
  if(!el.current)return;
  const c=createChart(el.current,{autoSize:true,localization:{locale:'cs-CZ'},timeScale:{rightOffset:4,timeVisible:true,secondsVisible:false},rightPriceScale:{scaleMargins:{top:.12,bottom:.08}}});
  sess.current=c.addSeries(HistogramSeries,{priceScaleId:'sess',lastValueVisible:false,priceLineVisible:false,base:0});
  c.priceScale('sess').applyOptions({visible:false,scaleMargins:{top:0,bottom:0}});
  price.current=c.addSeries(CandlestickSeries,{borderVisible:false});
  markers.current=createSeriesMarkers(price.current,[]);
  chart.current=c;
  const objectId=(p:MouseEventParams<Time>)=>{const id=p.hoveredInfo?.objectId??p.hoveredObjectId;return typeof id==='string'?id:null};
  c.subscribeCrosshairMove(p=>{
   const L=lookup.current;setHover(p.time!==undefined?L.bars.get(p.time as number)??null:null);
   const id=objectId(p);
   if(!id||!p.point){setTip(null);return}
   let text:string[]=[];
   if(id.startsWith('n:')){const e=L.news.get(id.slice(2));if(e)text=[e.title,eventTime(e)+(e.signal>=3?' · silný signál':'')]}
   else if(id.startsWith('t:')){const t=L.trades.get(id.slice(2));if(t)text=[(t.side==='buy'?'Buy':t.side==='sell'?'Sell':'Ruční obchod')+' · '+tradeResult(t)+(t.r!==null?' · '+fmtMoney(t.pnl,t.currency):''),(t.openPrice!==null?'Vstup '+fmtPrice(t.openPrice):'')+(t.closePrice!==null?' → výstup '+fmtPrice(t.closePrice):''),'Klikni pro detail v Deníku'].filter(Boolean)}
   const w=el.current?.clientWidth||0;setTip(text.length?{x:p.point.x,y:p.point.y,flip:p.point.x>w*.6,lines:text}:null);
  });
  c.subscribeClick(p=>{const id=objectId(p);if(id?.startsWith('t:'))location.hash='journal/'+encodeURIComponent(id.slice(2))});
  // světlý/tmavý režim a paleta (nastavuje se přes atributy a style na <html>)
  const obs=new MutationObserver(()=>setTick(n=>n+1));obs.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class','style']});
  return()=>{obs.disconnect();c.remove();chart.current=null;price.current=null;sess.current=null;score.current=null;markers.current=null;lines.current=[]};
 },[]);

 const bars=useMemo(()=>toBars(data.candles),[data.candles]);
 const draw=useChartDrawings({chart,series:price,el,bars,tf,instrument,tick});
 const times=useMemo(()=>bars.map(b=>b.time),[bars]);
 const scores=useMemo(()=>scoreSeries(history,instrument,method,'all',Date.now()),[history,instrument,method]);
 const news=useMemo(()=>newsLayer(events,instrument,times,TF_SEC[tf]),[events,instrument,times,tf]);
 const scoreMap=useMemo(()=>new Map(scoreBand(scores,times,TF_SEC[tf],{bull:'#000',bear:'#000'}).flatMap(b=>b.value===undefined?[]:[[b.time,b.value] as const])),[scores,times,tf]);
 const positions=useMemo(()=>(open?.positions||[]).filter(p=>p.instrument===instrument),[open,instrument]);

 // barvy a motiv
 useEffect(()=>{
  const c=chart.current,s=price.current;if(!c||!s)return;
  const line=css('--t-border','#e5e7eb'),bull=css('--bull','#16a34a'),bear=css('--bear','#dc2626');
  c.applyOptions({layout:{background:{color:'transparent'},textColor:css('--t-muted','#6b7280'),fontFamily:'inherit',panes:{separatorColor:line}},grid:{vertLines:{color:line},horzLines:{color:line}},rightPriceScale:{borderColor:line},timeScale:{borderColor:line}});
  s.applyOptions({upColor:bull,downColor:bear,wickUpColor:bull,wickDownColor:bear});
 },[tick]);

 // svíčky: při změně dat výřez na posledních ~150 svíček
 useEffect(()=>{
  const c=chart.current,s=price.current;if(!c||!s)return;
  const prec=bars.length?precision(bars[bars.length-1].close):2;
  s.applyOptions({priceFormat:{type:'price',precision:prec,minMove:1/10**prec}});
  s.setData(bars.map(b=>({...b,time:b.time as UTCTimestamp})));
  lookup.current.bars=new Map(bars.map(b=>[b.time,b]));
  if(bars.length)c.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-(tf==='D1'?180:150)),to:bars.length+3});
 },[bars,tf]);

 // vrstvy
 useEffect(()=>{
  const c=chart.current,s=price.current,ss=sess.current,m=markers.current;if(!c||!s||!ss||!m)return;
  const bull=css('--bull','#16a34a'),bear=css('--bear','#dc2626'),sec=TF_SEC[tf];
  // seance (jen H1)
  ss.setData(layers.sessions&&tf==='H1'?sessionBands(times,dark()?.13:.08).map(x=>({...x,time:x.time as UTCTimestamp})):[]);
  // značky obchodů a zpráv
  const visibleTrades=layers.trades?trades:[];
  lookup.current.trades=new Map(visibleTrades.map(t=>[t.id,t]));
  lookup.current.news=new Map(layers.news?news.map(n=>[n.event.id,n.event]):[]);
  m.setMarkers(sortMarkers([...(layers.trades?tradeMarkers(visibleTrades,times,sec,{bull,bear}):[]),...(layers.news?newsMarkers(news,{strong:css('--t-brand','#245bff'),normal:css('--t-muted','#6b7079')}):[])]).map(x=>({...x,time:x.time as UTCTimestamp})));
  // otevřená pozice: vstup, SL, TP
  for(const l of lines.current)s.removePriceLine(l);lines.current=[];
  if(layers.trades&&open)for(const p of positions){
   const pnl=p.pnl===null?'':' · '+(p.converted?'':'≈ ')+fmtMoney(p.pnl,p.converted?open.currency:p.accountCurrency);
   lines.current.push(s.createPriceLine({price:p.openPrice,color:'#2563eb',lineStyle:LineStyle.Dashed,lineWidth:1,title:(p.side==='buy'?'Buy':'Sell')+pnl,axisLabelVisible:true}));
   if(p.sl!==null)lines.current.push(s.createPriceLine({price:p.sl,color:bear,lineStyle:LineStyle.Solid,lineWidth:1,title:'SL',axisLabelVisible:true}));
   if(p.tp!==null)lines.current.push(s.createPriceLine({price:p.tp,color:bull,lineStyle:LineStyle.Solid,lineWidth:1,title:'TP',axisLabelVisible:true}));
  }
  // pás skóre v samostatném panelu pod cenou
  const band=layers.score?scoreBand(scores,times,sec,{bull,bear}):[];
  if(band.some(b=>b.value!==undefined)){
   if(!score.current){
    score.current=c.addSeries(HistogramSeries,{priceFormat:{type:'custom',formatter:(v:number)=>scoreFmt(v),minMove:1},lastValueVisible:false,priceLineVisible:false,base:0,autoscaleInfoProvider:()=>({priceRange:{minValue:-100,maxValue:100}})},1);
    const panes=c.panes();panes[0]?.setStretchFactor(5);panes[1]?.setStretchFactor(1);
   }
   score.current.setData(band.map(x=>({...x,time:x.time as UTCTimestamp})));
  }else if(score.current){c.removeSeries(score.current);score.current=null}
 },[times,tf,layers,trades,news,positions,open,scores,tick]);

 if(data.status==='unsupported')return null;
 const shown=hover??bars[bars.length-1]??null;
 const prev=shown?bars[bars.findIndex(b=>b.time===shown.time)-1]:undefined;
 const hoverNews=shown&&layers.news?news.filter(n=>n.time===shown.time).map(n=>n.event):[];
 const hoverScore=shown&&layers.score?scoreMap.get(shown.time)??null:null;
 const loading=data.status==='loading',empty=data.status==='error'&&!bars.length;
 return <section className="s-card mc" aria-busy={loading}>
  <div className="mc-head">
   <div className="mc-title"><h2>Graf trhu</h2><p className="mc-ohlc" aria-live="off">{shown&&<><b>{barLabel(shown.time,tf)}</b><span>O <em>{fmtPrice(shown.open)}</em></span><span>H <em>{fmtPrice(shown.high)}</em></span><span>L <em>{fmtPrice(shown.low)}</em></span><span>C <em>{fmtPrice(shown.close)}</em></span>{prev&&<span className={shown.close>=prev.close?'up':'down'}>{pct(prev.close,shown.close)}</span>}{hoverScore!==null&&<span>Skóre <em className={hoverScore>=0?'up':'down'}>{scoreFmt(hoverScore)}</em></span>}</>}</p><p className="mc-news-line" title={hoverNews.map(e=>e.title).join(' · ')||undefined}>{hoverNews.map(e=>e.title).join(' · ')}</p></div>
   <div className="mc-controls">
    <div className="mc-seg" role="group" aria-label="Časový rámec">{TFS.map(t=><button key={t} type="button" className={'mc-chip'+(tf===t?' on':'')} aria-pressed={tf===t} onClick={()=>update({tf:t})}>{t}</button>)}</div>
    <div className="mc-seg" role="group" aria-label="Vrstvy grafu">{LAYER_LABELS.map(([k,label])=>{const off=k==='sessions'&&tf!=='H1';return <button key={k} type="button" className={'mc-chip'+(layers[k]&&!off?' on':'')} aria-pressed={layers[k]} disabled={off} title={off?'Seance se zobrazují jen na H1':undefined} onClick={()=>toggle(k)}>{label}</button>})}</div>
    {headExtra}<button type="button" className="mc-chip mc-now" onClick={()=>chart.current?.timeScale().scrollToRealTime()} disabled={!bars.length}>Na současnost</button>
   </div>
  </div>
  <div className="mc-body">
  {draw.toolbar}
  <div className="mc-wrap">
   <div ref={el} className="mc-chart" style={height?{'--mc-h':height} as React.CSSProperties:undefined} data-drawing={draw.drawing?'1':undefined} role="img" aria-label={`Svíčkový graf ${name}, časový rámec ${tf}${layers.trades?', s tvými obchody':''}${layers.news?', se zprávami z kalendáře':''}${layers.score?', s pásem skóre Tradee':''}`}/>
   {loading&&<div className="mc-skeleton" aria-label="Načítám svíčky"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>}
   {empty&&<div className="mc-empty" role="status"><p>{data.message||'Ceny teď nejsou k dispozici.'}</p><button type="button" className="mc-chip" onClick={()=>setReload(n=>n+1)}>Zkusit znovu</button></div>}
   {tip&&!draw.drawing&&<div className={'mc-tip'+(tip.flip?' flip':'')} style={{left:tip.x,top:tip.y}} role="tooltip">{tip.lines.map((l,i)=>i?<span key={i}>{l}</span>:<b key={i}>{l}</b>)}</div>}
   {draw.overlay}
  </div>
  </div>
  <div className="mc-foot">
   {data.stale&&bars.length>0&&<span className="mc-stale" role="status">Ceny mohou být zpožděné{data.updated?' · stav '+new Date(data.updated).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):''}</span>}
   {tradesError&&layers.trades&&<span className="mc-stale">Obchody se nepodařilo načíst.</span>}
   {layers.news&&<span className="mc-legend"><i className="mc-dot strong"/>silná zpráva <i className="mc-dot"/>střední</span>}
   {layers.sessions&&tf==='H1'&&<span className="mc-legend">{SESSIONS.filter(s=>s.key!=='off').map(s=><span key={s.key}><i className="mc-swatch" style={{background:SESSION_COLORS[s.key as keyof typeof SESSION_COLORS]}}/>{s.label}</span>)}</span>}
   {draw.status}
   <span className="mc-src">Yahoo Finance · čas Praha · <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Grafy TradingView Lightweight Charts™</a></span>
  </div>
 </section>;
}
