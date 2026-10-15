'use client';
// Graf trhu v detailu trhu: svíčky M1–MN (Yahoo / archiv přes /api/chart/candles), u krypta footprint M5/M15/H1 (Binance přes /api/chart/footprint), s vrstvami obchodů, otevřené pozice, zpráv, skóre a seancí a s kreslením (market-chart-draw).
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {AppWindow,Maximize2,Minimize2,X} from 'lucide-react';
import {createChart,CrosshairMode,CandlestickSeries,BarSeries,LineSeries,AreaSeries,HistogramSeries,LineStyle,createSeriesMarkers,type IChartApi,type ISeriesApi,type ISeriesMarkersPluginApi,type IPriceLine,type Logical,type MouseEventParams,type SeriesType,type Time,type UTCTimestamp} from 'lightweight-charts';
import {candles as toBars,chartTime} from '@/lib/journal/chart-data';
import {TF_SEC,SESSION_TFS,type ChartTf,withAlpha,newsLayer,newsMarkers,upcomingNews,eventCountry,newsReaction,type Reaction,tradeMarkers,sortMarkers,scoreBand,sessionBands,tradeResult,SESSION_COLORS,snapTo,type Marker} from '@/lib/chart/layers';
import type {PaperTrade,VariantId} from '@/lib/lab/paper';
import {SESSIONS} from '@/lib/journal/analytics';
import {scoreSeries,type HistoryLike} from '@/lib/dashboard';
import {relative,type CalendarEvent} from '@/lib/calendar';
import {forecastLine} from '@/lib/calendar-ff';
import {TFS,type Candle,type Tf} from '@/lib/chart/candles';
import type {ChartTrade} from '@/lib/chart/trades';
import {fmtMoney} from '@/lib/trades';
import {useOpenPositions} from './open-positions';
import {fmtPrice} from './live';
import {useChartDrawings} from './market-chart-draw';
import {CHART_TYPES,CHART_TYPE_LABELS,isChartType,seriesData,type ChartType} from '@/lib/chart/chart-types';
import {FP_TFS,fmtVol,fpSymbol,isFpTf,type FpCandle,type FpTf} from '@/lib/chart/footprint';
import {FootprintPrimitive,FP_DELTA_H,type FpPalette} from './chart-footprint';
import {NewsStripPrimitive} from './chart-news';
import './market-chart.css';

type Layers={trades:boolean;news:boolean;score:boolean;sessions:boolean;paper:boolean};
// Simulace z Laboratoře (jen vlastník): obchody virtuálního účtu na tomto trhu, otevřené přeceněné živou cenou
type PaperChartTrade=Omit<PaperTrade,'partsAtEntry'>&{mark:{price:number;r:number;pnlCzk:number}|null};
type Kind=ChartType|'footprint';
type PaperPick='all'|VariantId;
type Prefs={tf:Tf;layers:Layers;type:Kind;fpTf:FpTf;paperVariant:PaperPick};
type Fp={tick:number;map:Map<number,FpCandle>;pending:number;error?:string;symbol:string};
// at = kdy klient svíčky načetl (reakce trhu po zprávě nepočítá s tím, co ještě nemá)
type Loaded={status:'loading'|'ok'|'error'|'unsupported';candles:Candle[];stale:boolean;updated:number|null;message?:string;at?:number};
type Bar={time:number;open:number;high:number;low:number;close:number};
type Tip={x:number;y:number;flip:boolean;lines:string[];id?:string};
type Pop={id:string;x:number;y:number};
type Upcoming={event:CalendarEvent;t:number;logical:number};
const KEY='tradee.chart';
const DEFAULT:Prefs={tf:'H4',layers:{trades:true,news:true,score:true,sessions:true,paper:true},type:'candles',fpTf:'M15',paperVariant:'all'};
// varianty simulace A/B/C/D: barva značek a čar (A = barva značky, jako dřív)
const PAPER_PICKS:PaperPick[]=['all','A','B','C','D'];
const PAPER_COLORS:Partial<Record<VariantId,[string,string]>>&{A:[string,string]}={A:['--t-brand','#7c3aed'],B:['--t-fg-2','#64748b'],C:['--mc-paper-c','#d97706'],D:['--mc-paper-d','#0891b2']};
// denní a delší TF: popisky jen s datem, výřez podle délky svíčky
const dailyUp=(tf:ChartTf)=>tf==='D1'||tf==='W1'||tf==='MN',VIEW_BARS:Partial<Record<ChartTf,number>>={D1:180,W1:150,MN:60};
// barvu z CSS převést na #rrggbb / rgba() (kvůli průhlednosti)
let probe:CanvasRenderingContext2D|null=null;
function norm(c:string,fallback:string){try{probe??=document.createElement('canvas').getContext('2d');if(!probe)return c;probe.fillStyle=fallback;probe.fillStyle=c;return String(probe.fillStyle)}catch{return c}}
const LAYER_LABELS:[keyof Layers,string][]=[['trades','Obchody'],['news','Zprávy'],['score','Skóre'],['sessions','Seance'],['paper','Simulace']];
const paperR=(r:number)=>(r>0?'+':r<0?'−':'')+Math.abs(r).toLocaleString('cs-CZ',{maximumFractionDigits:2})+' R';
const paperKc=(v:number)=>(v>0?'+':v<0?'−':'')+Math.abs(Math.round(v)).toLocaleString('cs-CZ')+' Kč';
const PAPER_EXIT:Record<string,string>={sl:'SL',tp:'TP',time:'čas',signal:'signál',mean:'GMA50'};
// značky simulace: vstup = kosočtverec na ceně vstupu, výstup = kroužek s výsledkem v R
function paperMarkers(list:PaperChartTrade[],times:number[],sec:number,colorOf:(t:PaperChartTrade)=>string,c:{bull:string;bear:string}):Marker[]{
 const out:Marker[]=[];
 for(const t of list){
  const tag='Sim '+(t.variant??'A');
  const inT=snapTo(times,sec,chartTime(t.opened));if(inT!==null)out.push({time:inT,position:'atPriceMiddle',price:t.entry,shape:'square',color:colorOf(t),id:'p:'+t.id,text:tag+' '+(t.direction==='long'?'L':'S'),size:.7});
  if(t.closed!==null&&t.exit!==null){const outT=snapTo(times,sec,chartTime(t.closed));if(outT!==null)out.push({time:outT,position:'atPriceMiddle',price:t.exit,shape:'circle',color:(t.r??0)>=0?c.bull:c.bear,id:'p:'+t.id,text:tag+' '+paperR(t.r??0),size:.7})}
 }
 return out;
}
const css=(name:string,fallback:string)=>getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback;
const dark=()=>document.documentElement.dataset.theme==='dark';
function readPrefs():Prefs{try{const v=JSON.parse(localStorage.getItem(KEY)||'null');if(!v)return DEFAULT;return {tf:TFS.includes(v.tf)?v.tf:DEFAULT.tf,type:isChartType(v.type)||v.type==='footprint'?v.type:DEFAULT.type,fpTf:isFpTf(v.fpTf)?v.fpTf:DEFAULT.fpTf,layers:{...DEFAULT.layers,...Object.fromEntries(Object.entries(v.layers||{}).filter(([k,x])=>k in DEFAULT.layers&&typeof x==='boolean'))},paperVariant:PAPER_PICKS.includes(v.paperVariant)?v.paperVariant:'all'}}catch{return DEFAULT}}
// čas grafu je pražský čas zakódovaný jako UTC → formátovat v UTC
const barLabel=(t:number,tf:ChartTf)=>new Date(t*1000).toLocaleString('cs-CZ',{timeZone:'UTC',day:'numeric',month:'numeric',year:dailyUp(tf)?'numeric':undefined,...(dailyUp(tf)?{}:{hour:'2-digit',minute:'2-digit'} as const)});
const eventTime=(e:CalendarEvent)=>new Date(e.at).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',...(e.timeKnown?{hour:'2-digit',minute:'2-digit'} as const:{})})+(e.timeKnown?'':' · čas neupřesněn');
const scoreFmt=(v:number)=>(v>0?'+':'')+v.toLocaleString('cs-CZ',{maximumFractionDigits:1});
const pct=(a:number,b:number)=>{const v=(b-a)/a*100;return (v>0?'+':'')+v.toLocaleString('cs-CZ',{maximumFractionDigits:2})+' %'};
const precision=(v:number)=>Math.abs(v)<10?5:Math.abs(v)<1000?2:0;
const signed=(v:number,digits:number,min=0)=>(v>0?'+':v<0?'−':'')+Math.abs(v).toLocaleString('cs-CZ',{minimumFractionDigits:min,maximumFractionDigits:digits});
const impact=(e:CalendarEvent)=>e.signal>=3?'silná':'střední';
// hlavní cenová série podle typu grafu (kresby, značky a cenové čáry visí na ní)
function addPriceSeries(c:IChartApi,type:ChartType):ISeriesApi<SeriesType>{
 if(type==='bars')return c.addSeries(BarSeries,{thinBars:false});
 if(type==='line')return c.addSeries(LineSeries,{lineWidth:2});
 if(type==='area')return c.addSeries(AreaSeries,{lineWidth:2});
 return c.addSeries(CandlestickSeries,{borderVisible:type==='hollow'});
}
function seriesColors(type:ChartType,bull:string,bear:string,brand:string){
 if(type==='bars')return {upColor:bull,downColor:bear};
 if(type==='line')return {color:brand};
 if(type==='area')return {lineColor:brand,topColor:withAlpha(brand,.28),bottomColor:withAlpha(brand,.02)};
 if(type==='hollow')return {upColor:'rgba(0,0,0,0)',downColor:bear,borderUpColor:bull,borderDownColor:bear,wickUpColor:bull,wickDownColor:bear};
 return {upColor:bull,downColor:bear,wickUpColor:bull,wickDownColor:bear};
}

// nadcházející zprávy za pravým okrajem grafu (šipka „+N“ v pásu zpráv)
const hiddenUp=(c:IChartApi,up:Upcoming[])=>{const ts=c.timeScale(),w=ts.width();return up.filter(u=>{const x=ts.logicalToCoordinate(u.logical as Logical);return x!==null&&x>w})};
const editable=(t:EventTarget|null)=>t instanceof HTMLElement&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
// TF z adresy (?tf=H1 u okna grafu otevřeného z aplikace) přebije uložený; u footprintu jeho TF
function withTf(p:Prefs,tf:string|undefined,fpOk:boolean):Prefs{
 if(!tf)return p;
 if(p.type==='footprint'&&fpOk)return isFpTf(tf)?{...p,fpTf:tf}:p;
 return (TFS as readonly string[]).includes(tf)?{...p,tf:tf as Tf}:p;
}
// samostatné okno grafu (např. na druhý monitor): /graf/<trh>?tf=…, jedno pojmenované okno na trh – další klik ho jen přepne a obnoví
const WIN='tradee-graf-',slugOf=(id:string)=>id.replace(/\//g,'-');
const noSub=()=>()=>{};
function openChartWindow(instrument:string,tf:ChartTf){
 const w=Math.max(640,Math.min(1440,screen.availWidth-40)),h=Math.max(480,Math.min(900,screen.availHeight-60));
 const left=Math.round(window.screenX+Math.max(0,(window.outerWidth-w)/2)+40),top=Math.round(window.screenY+Math.max(0,(window.outerHeight-h)/2)+20);
 const win=window.open('/graf/'+encodeURIComponent(slugOf(instrument))+'?tf='+tf,WIN+slugOf(instrument),`popup=yes,width=${w},height=${h},left=${left},top=${top}`);
 win?.focus();return !!win;
}

// fill = graf vyplní výšku rodiče (stránka /graf); jinak pevná výška (height); initialTf = TF z adresy stránky /graf
// owner = přihlášený je vlastník → vrstva Simulace (data z /api/laborator/paper; ostatní ji nevidí a nic nežádají)
export function MarketChart({instrument,name,history,method,events,height,headExtra,fill,initialTf,owner=false}:{instrument:string;name:string;history:HistoryLike;method:string;events:CalendarEvent[];height?:string;headExtra?:React.ReactNode;fill?:boolean;initialTf?:string;owner?:boolean}){
 const [prefs,setPrefs]=useState<Prefs>(DEFAULT),[ready,setReady]=useState(false);
 // okno grafu: v samotném okně téhož trhu tlačítko nedává smysl (otevřelo by znovu sebe); zablokované okno = hláška v patičce
 const winName=useSyncExternalStore(noSub,()=>window.name,()=>''),[blocked,setBlocked]=useState(false);
 // přes celou obrazovku jako TradingView: karta grafu přes celé okno (pevné rozvržení bez posouvání stránky), kde to jde, i celoobrazovkový režim prohlížeče
 const [fs,setFs]=useState(false),card=useRef<HTMLElement>(null),keys=useRef({fs:false,drawing:false,fill:false,pop:false});
 // zprávy z kalendáře: otevřený detail (klik na značku) a hodiny po minutě (proběhlá zpráva se přesune z pásu dole nad svíčky)
 const [pop,setPop]=useState<Pop|null>(null),[clock,setClock]=useState(()=>Date.now()),strip=useRef<NewsStripPrimitive|null>(null);
 const [data,setData]=useState<Loaded>({status:'loading',candles:[],stale:false,updated:null}),[reload,setReload]=useState(0);
 const [trades,setTrades]=useState<ChartTrade[]>([]),[tradesError,setTradesError]=useState(false),[paper,setPaper]=useState<PaperChartTrade[]>([]);
 const [hover,setHover]=useState<Bar|null>(null),[tip,setTip]=useState<Tip|null>(null),[tick,setTick]=useState(0),[ver,setVer]=useState(0);
 const [fp,setFp]=useState<Fp|null>(null),[fpMode,setFpMode]=useState(false);
 const {data:open}=useOpenPositions();
 const el=useRef<HTMLDivElement>(null),chart=useRef<IChartApi|null>(null),price=useRef<ISeriesApi<SeriesType>|null>(null),sess=useRef<ISeriesApi<'Histogram'>|null>(null),score=useRef<ISeriesApi<'Histogram'>|null>(null),markers=useRef<ISeriesMarkersPluginApi<Time>|null>(null),lines=useRef<IPriceLine[]>([]),keepRange=useRef<{from:number;to:number}|null>(null);
 // data pro handlery grafu (crosshair, klik) – mění se bez znovuvytvoření grafu
 const lookup=useRef<{bars:Map<number,Bar>;trades:Map<string,ChartTrade>;paper:Map<string,PaperChartTrade>;news:Map<string,CalendarEvent>;up:Upcoming[];last:number}>({bars:new Map(),trades:new Map(),paper:new Map(),news:new Map(),up:[],last:-1});
 const {layers}=prefs;
 // footprint jen u krypta (BTC, ETH, SOL); jinak se uložená volba chová jako svíčky
 const fpOk=!!fpSymbol(instrument),isFp=prefs.type==='footprint'&&fpOk,type:ChartType=prefs.type==='footprint'?'candles':prefs.type;
 const tf:ChartTf=isFp?prefs.fpTf:prefs.tf,tfButtons:readonly ChartTf[]=isFp?FP_TFS:TFS,tfList:readonly ChartTf[]=TFS,sessOk=SESSION_TFS.includes(tf);
 const [fpPrim]=useState(()=>new FootprintPrimitive(on=>setFpMode(on)));
 const polls=useRef(0),silent=useRef(false),fitted=useRef('');

 useEffect(()=>{setPrefs(withTf(readPrefs(),initialTf,!!fpSymbol(instrument)));setReady(true)},[initialTf,instrument]);
 const update=(p:Partial<Prefs>)=>setPrefs(old=>{const next={...old,...p};try{localStorage.setItem(KEY,JSON.stringify(next))}catch{}return next});
 const toggle=(k:keyof Layers)=>{if(k==='news')setPop(null);update({layers:{...layers,[k]:!layers[k]}})};

 // svíčky pro zvolený TF
 useEffect(()=>{
  if(!ready)return;const ac=new AbortController();
  const quiet=silent.current;silent.current=false;
  if(!quiet)setData(d=>({...d,status:'loading'}));
  if(isFp){
   // footprint: svíčky z Binance + hladiny; při chybě zůstane poslední cache
   fetch(`/api/chart/footprint?instrument=${encodeURIComponent(instrument)}&tf=${tf}`,{signal:ac.signal}).then(async r=>{
    const j=await r.json().catch(()=>({})) as {candles?:FpCandle[];tick?:number;pending?:number;stale?:boolean;updated?:number|null;error?:string;symbol?:string};
    if(!r.ok||!Array.isArray(j.candles))throw new Error(j.error||'');
    const list=j.candles;
    setFp({tick:j.tick||0,map:new Map(list.map(c=>[chartTime(c.t),c])),pending:j.pending||0,error:j.error,symbol:j.symbol||''});
    setData({status:list.length?'ok':'error',candles:list.map(c=>[c.t,c.o,c.h,c.l,c.c] as Candle),stale:!!j.stale,updated:j.updated??null,message:list.length?undefined:j.error||'Footprint zatím není k dispozici.',at:Date.now()});
   }).catch(e=>{if(ac.signal.aborted)return;if(quiet)return;setData({status:'error',candles:[],stale:false,updated:null,message:e instanceof Error&&e.message?e.message:'Footprint se nepodařilo načíst.'})});
   return()=>ac.abort();
  }
  setFp(null);
  fetch(`/api/chart/candles?instrument=${encodeURIComponent(instrument)}&tf=${tf}`,{signal:ac.signal}).then(async r=>{
   const j=await r.json().catch(()=>({})) as {candles?:Candle[];stale?:boolean;updated?:number|null;unsupported?:boolean;error?:string};
   if(j.unsupported){setData({status:'unsupported',candles:[],stale:false,updated:null});return}
   if(!r.ok||!Array.isArray(j.candles))throw new Error(j.error||'');
   setData({status:j.candles.length?'ok':'error',candles:j.candles,stale:!!j.stale,updated:j.updated??null,message:j.candles.length?undefined:j.error||'Pro tento trh zatím nejsou svíčky.',at:Date.now()});
  }).catch(e=>{if(!ac.signal.aborted)setData({status:'error',candles:[],stale:false,updated:null,message:e instanceof Error&&e.message?e.message:'Graf se nepodařilo načíst.'})});
  return()=>ac.abort();
 },[instrument,tf,isFp,ready,reload]);
 // footprint: obnovit živou svíčku každých 30 s; dokud se dopočítává historie, častěji (5 s, nejvýš 60×); jen ve viditelné záložce
 useEffect(()=>{
  if(!isFp||data.status!=='ok')return;
  const fast=(fp?.pending||0)>0&&polls.current<60;
  const go=()=>{if(fast)polls.current++;silent.current=true;setReload(n=>n+1)};
  const vis=()=>{if(document.visibilityState==='visible'){document.removeEventListener('visibilitychange',vis);go()}};
  const t=setTimeout(()=>{if(document.visibilityState==='hidden')document.addEventListener('visibilitychange',vis);else go()},fast?5000:30000);
  return()=>{clearTimeout(t);document.removeEventListener('visibilitychange',vis)};
 },[isFp,data,fp]);
 useEffect(()=>{polls.current=0},[instrument,tf,isFp]);
 // obchody uživatele na trhu (jednou na trh)
 useEffect(()=>{const ac=new AbortController();
  fetch('/api/chart/trades?instrument='+encodeURIComponent(instrument),{signal:ac.signal,cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{trades?:ChartTrade[]}>:Promise.reject()).then((j:{trades?:ChartTrade[]})=>{setTrades(j.trades||[]);setTradesError(false)}).catch(()=>{if(!ac.signal.aborted)setTradesError(true)});
  return()=>ac.abort()},[instrument]);
 // simulace z Laboratoře: jen vlastník (ostatní endpoint ani nevolají; API by jim stejně vrátilo 404)
 useEffect(()=>{if(!owner)return;const ac=new AbortController();
  fetch('/api/laborator/paper?instrument='+encodeURIComponent(instrument),{signal:ac.signal,cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{trades?:PaperChartTrade[]}>:Promise.reject()).then(j=>setPaper(j.trades||[])).catch(()=>{});
  return()=>{ac.abort();setPaper([])}},[instrument,owner]);

 // graf: vytvoří se jednou, data a vrstvy se nastavují v dalších efektech
 useEffect(()=>{
  if(!el.current)return;
  const c=createChart(el.current,{autoSize:true,localization:{locale:'cs-CZ'},crosshair:{mode:CrosshairMode.Normal},timeScale:{rightOffset:4,timeVisible:true,secondsVisible:false},rightPriceScale:{scaleMargins:{top:.12,bottom:.08}}});
  sess.current=c.addSeries(HistogramSeries,{priceScaleId:'sess',lastValueVisible:false,priceLineVisible:false,base:0});
  c.priceScale('sess').applyOptions({visible:false,scaleMargins:{top:0,bottom:0}});
  chart.current=c;
  const objectId=(p:MouseEventParams<Time>)=>{const id=p.hoveredInfo?.objectId??p.hoveredObjectId;return typeof id==='string'?id:null};
  c.subscribeCrosshairMove(p=>{
   const L=lookup.current;setHover(p.time!==undefined?L.bars.get(p.time as number)??null:null);
   const id=objectId(p);
   if(!id||!p.point){setTip(null);return}
   let text:string[]=[];
   if(id.startsWith('n:')){const e=L.news.get(id.slice(2)),now=Date.now();if(e){const country=eventCountry(e);text=[e.title,(country?country+' · ':'')+eventTime(e)+' · '+impact(e)+' zpráva'+(Date.parse(e.at)>now?' · '+relative(e.at,now):''),forecastLine(e),'Klikni pro detail a reakci trhu'].filter(Boolean)}}
   else if(id==='n+'){const hidden=hiddenUp(c,L.up);if(hidden.length)text=[(hidden.length===1?'Další zpráva':'Další zprávy ('+hidden.length+')')+' vpravo v budoucnosti',hidden[0].event.title+' · '+eventTime(hidden[0].event),'Klikni pro posun grafu na ni']}
   else if(id.startsWith('p:')){const t=L.paper.get(id.slice(2));if(t)text=['Simulace '+(t.variant??'A')+' · '+(t.direction==='long'?'Long':'Short')+' · jistota '+t.confidence+' %','Vstup '+fmtPrice(t.entry)+' · SL '+fmtPrice(t.sl)+' · TP '+(t.tp>0?fmtPrice(t.tp):'–'),t.closed!==null?'Výstup '+(t.exit!==null?fmtPrice(t.exit):'–')+' ('+(PAPER_EXIT[t.exitReason??'']??'')+') · '+paperR(t.r??0)+' · '+paperKc(t.pnlCzk??0):t.mark?'Teď '+paperR(t.mark.r)+' · '+paperKc(t.mark.pnlCzk):'Otevřená pozice','Klikni pro detail v Laboratoři']}
   else if(id.startsWith('t:')){const t=L.trades.get(id.slice(2));if(t)text=[(t.side==='buy'?'Buy':t.side==='sell'?'Sell':'Ruční obchod')+' · '+tradeResult(t)+(t.r!==null?' · '+fmtMoney(t.pnl,t.currency):''),(t.openPrice!==null?'Vstup '+fmtPrice(t.openPrice):'')+(t.closePrice!==null?' → výstup '+fmtPrice(t.closePrice):''),'Klikni pro detail v Deníku'].filter(Boolean)}
   const w=el.current?.clientWidth||0;setTip(text.length?{x:p.point.x,y:p.point.y,flip:p.point.x>w*.6,lines:text,id}:null);
  });
  // klik: obchod → Deník, zpráva → detail s reakcí trhu, šipka dalších zpráv → posun do budoucnosti, jinam → zavřít detail
  c.subscribeClick(p=>{
   const id=objectId(p);
   if(id?.startsWith('t:'))location.hash='journal/'+encodeURIComponent(id.slice(2));
   else if(id?.startsWith('p:'))location.href='/laborator#paper';
   else if(keys.current.drawing)return;
   else if(id?.startsWith('n:')&&p.point)setPop({id:id.slice(2),x:p.point.x,y:p.point.y});
   else if(id==='n+'){const L=lookup.current,ts=c.timeScale(),r=ts.getVisibleLogicalRange(),next=hiddenUp(c,L.up)[0];if(next)ts.scrollToPosition(next.logical-L.last+Math.max(6,Math.round((r?r.to-r.from:60)*.15)),true)}
   else setPop(null);
  });
  // světlý/tmavý režim a paleta (nastavuje se přes atributy a style na <html>)
  const obs=new MutationObserver(()=>setTick(n=>n+1));obs.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class','style']});
  return()=>{obs.disconnect();c.remove();chart.current=null;price.current=null;sess.current=null;score.current=null;markers.current=null;lines.current=[]};
 },[]);
 // cenová série podle typu grafu: při změně typu se vymění (kresby, značky a čáry se znovu připojí přes ver)
 useEffect(()=>{
  const c=chart.current;if(!c||!ready)return;
  const s=addPriceSeries(c,type);price.current=s;
  // footprint se připojí před značkami, aby značky zůstaly nad buňkami
  if(isFp)s.attachPrimitive(fpPrim);
  markers.current=createSeriesMarkers(s,[]);lines.current=[];
  // pás nadcházejících zpráv dole
  const st=strip.current??new NewsStripPrimitive();strip.current=st;s.attachPrimitive(st);
  setVer(v=>v+1);
  c.priceScale('right').applyOptions({scaleMargins:{top:.12,bottom:isFp?.12:.08}});
  return()=>{try{keepRange.current=c.timeScale().getVisibleLogicalRange();markers.current?.detach();s.detachPrimitive(st);if(isFp)s.detachPrimitive(fpPrim);c.removeSeries(s)}catch{}price.current=null;markers.current=null;lines.current=[]};
 },[type,isFp,ready,fpPrim]);

 const bars=useMemo(()=>toBars(data.candles),[data.candles]);
 const draw=useChartDrawings({chart,series:price,ver,el,bars,tf,tfList,instrument,tick});
 const times=useMemo(()=>bars.map(b=>b.time),[bars]);

 // celá obrazovka: zapnutí/vypnutí (režim prohlížeče jen jako bonus – když ho prohlížeč odmítne, zůstane karta přes celé okno)
 useLayoutEffect(()=>{keys.current={fs,drawing:draw.drawing,fill:!!fill,pop:!!pop}});
 const full=useCallback((on:boolean)=>{
  setFs(on);const box=card.current;
  if(on){if(box?.requestFullscreen&&!document.fullscreenElement)box.requestFullscreen().catch(()=>{})}
  else if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
 },[]);
 // zámek posouvání stránky; odchod z režimu prohlížeče (Esc prohlížeče) ukončí i režim karty
 useEffect(()=>{
  if(!fs)return;
  document.body.classList.add('mc-fs-lock');
  const left=()=>{if(!document.fullscreenElement)setFs(false)};
  document.addEventListener('fullscreenchange',left);
  return()=>{document.body.classList.remove('mc-fs-lock');document.removeEventListener('fullscreenchange',left)};
 },[fs]);
 // klávesy: F přepne celou obrazovku (myš nad grafem, fokus v něm, nebo stránka /graf), Esc nejdřív zavře detail zprávy, pak celou obrazovku – kreslení (aktivní nástroj, vybraná kresba) má s Esc přednost
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   const box=card.current,k=keys.current;
   if(!box||e.ctrlKey||e.metaKey||e.altKey||editable(e.target))return;
   // Esc spotřebované kreslením (defaultPrevented) celou obrazovku neukončí
   if(e.key==='Escape'){if(k.pop)setPop(null);else if(k.fs&&!e.defaultPrevented&&!k.drawing&&!box.querySelector('.mc-sel'))full(false)}
   else if(!e.defaultPrevented&&(e.key==='f'||e.key==='F')&&!e.repeat&&(k.fs||k.fill||box.matches(':hover')||box.contains(document.activeElement))){e.preventDefault();full(!k.fs)}
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[full]);
 const scores=useMemo(()=>scoreSeries(history,instrument,method,'all',Date.now()),[history,instrument,method]);
 // zprávy: proběhlé nad svíčkami (značky), nadcházející v pásu dole (primitivum)
 useEffect(()=>{const t=setInterval(()=>setClock(old=>{const now=Date.now();return events.some(e=>{const at=Date.parse(e.at);return at>old&&at<=now})?now:old}),60000);return()=>clearInterval(t)},[events]);
 const news=useMemo(()=>newsLayer(events,instrument,times,TF_SEC[tf],clock),[events,instrument,times,tf,clock]);
 const upcoming=useMemo(()=>upcomingNews(events,instrument,times,TF_SEC[tf],clock),[events,instrument,times,tf,clock]);
 // detail zprávy zavře klik mimo něj i mimo graf (klik do grafu řeší subscribeClick)
 useEffect(()=>{
  if(!pop)return;
  const down=(e:PointerEvent)=>{const t=e.target as Node;if(card.current?.querySelector('.mc-pop')?.contains(t)||el.current?.contains(t))return;setPop(null)};
  document.addEventListener('pointerdown',down);return()=>document.removeEventListener('pointerdown',down);
 },[pop]);
 useEffect(()=>{
  const st=strip.current;if(!st)return;
  const sel=pop&&layers.news?upcoming.find(u=>u.event.id===pop.id)??news.find(n=>n.event.id===pop.id):undefined;
  st.items=layers.news?upcoming.map(u=>({id:u.event.id,logical:u.logical,label:eventCountry(u.event)??'',strong:u.event.signal>=3})):[];
  st.selected=!sel?null:{logical:'logical' in sel?sel.logical:times.indexOf(sel.time),strong:sel.event.signal>=3};
  st.last=times.length-1;st.bottom=isFp&&fpMode?FP_DELTA_H:0;
  st.palette={high:norm(css('--mc-news-high','#dc2626'),'#dc2626'),mid:norm(css('--mc-news-mid','#d97706'),'#d97706'),bg:norm(css('--t-surface','#ffffff'),'#ffffff'),fg:norm(css('--t-fg','#0b0c0e'),'#0b0c0e')};
  lookup.current.up=layers.news?upcoming:[];lookup.current.last=times.length-1;
  st.update();
 },[upcoming,news,pop,layers.news,times,isFp,fpMode,tick,ver]);
 const scoreMap=useMemo(()=>new Map(scoreBand(scores,times,TF_SEC[tf],{bull:'#000',bear:'#000'}).flatMap(b=>b.value===undefined?[]:[[b.time,b.value] as const])),[scores,times,tf]);
 const positions=useMemo(()=>(open?.positions||[]).filter(p=>p.instrument===instrument),[open,instrument]);

 // osa času: u denních a delších TF jen data, u intraday i čas
 useEffect(()=>{chart.current?.applyOptions({timeScale:{timeVisible:!dailyUp(tf)}})},[tf]);
 // barvy a motiv
 useEffect(()=>{
  const c=chart.current,s=price.current;if(!c||!s)return;
  const line=css('--t-border','#e5e7eb'),bull=css('--bull','#16a34a'),bear=css('--bear','#dc2626'),brand=css('--t-brand','#245bff');
  c.applyOptions({layout:{background:{color:'transparent'},textColor:css('--t-muted','#6b7280'),fontFamily:'inherit',panes:{separatorColor:line}},grid:{vertLines:{color:line},horzLines:{color:line}},rightPriceScale:{borderColor:line},timeScale:{borderColor:line}});
  s.applyOptions(seriesColors(type,bull,bear,brand));
  const pal:FpPalette={bull:norm(bull,'#16a34a'),bear:norm(bear,'#dc2626'),bg:norm(css('--t-surface','#ffffff'),'#ffffff'),fg:norm(css('--t-fg','#0b0c0e'),'#0b0c0e'),muted:norm(css('--t-muted','#6b7079'),'#6b7079'),poc:'#f59e0b'};
  fpPrim.palette=pal;fpPrim.update();
 },[tick,ver,type,fpPrim]);
 // data footprintu do primitiva
 useEffect(()=>{fpPrim.data=isFp&&fp?fp.map:new Map();fpPrim.tick=fp?.tick||0;fpPrim.update()},[fp,isFp,fpPrim,ver]);

 // svíčky: při změně dat výřez na posledních ~150 svíček
 useEffect(()=>{
  const c=chart.current,s=price.current;if(!c||!s)return;
  const prec=bars.length?precision(bars[bars.length-1].close):2;
  s.applyOptions({priceFormat:{type:'price',precision:prec,minMove:1/10**prec}});
  s.setData(seriesData(bars,type).map(b=>({...b,time:b.time as UTCTimestamp})));
  lookup.current.bars=new Map(bars.map(b=>[b.time,b]));
  // po výměně série (typ grafu) zachovat výřez
  const keep=keepRange.current;keepRange.current=null;if(keep&&bars.length)c.timeScale().setVisibleLogicalRange(keep);
 },[bars,tf,type,ver]);
 // výřez na posledních ~150 svíček (footprint ~10) jen po načtení jiného trhu / TF / režimu, ne při obnově dat nebo přepnutí typu svíček
 useEffect(()=>{
  const c=chart.current,key=instrument+'|'+tf+'|'+isFp;if(!c||!bars.length||data.status!=='ok'||fitted.current===key)return;
  fitted.current=key;
  c.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-(isFp?10:VIEW_BARS[tf]??150)),to:bars.length+(isFp?1:3)});
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[bars]);

 // vrstvy
 useEffect(()=>{
  const c=chart.current,s=price.current,ss=sess.current,m=markers.current;if(!c||!s||!ss||!m)return;
  const bull=css('--bull','#16a34a'),bear=css('--bear','#dc2626'),sec=TF_SEC[tf];
  // seance (jen H1)
  ss.setData(layers.sessions&&sessOk?sessionBands(times,dark()?.13:.08).map(x=>({...x,time:x.time as UTCTimestamp})):[]);
  // značky obchodů a zpráv
  const pv=prefs.paperVariant,visibleTrades=layers.trades?trades:[],visiblePaper=owner&&layers.paper?paper.filter(t=>pv==='all'||(t.variant??'A')===pv):[];
  const simColor=(t:PaperChartTrade)=>{const [v,f]=PAPER_COLORS[t.variant??'A']??PAPER_COLORS.A;return css(v,f)};
  lookup.current.trades=new Map(visibleTrades.map(t=>[t.id,t]));
  lookup.current.paper=new Map(visiblePaper.map(t=>[t.id,t]));
  lookup.current.news=new Map(layers.news?[...news.map(n=>[n.event.id,n.event] as const),...upcoming.map(u=>[u.event.id,u.event] as const)]:[]);
  m.setMarkers(sortMarkers([...(layers.trades?tradeMarkers(visibleTrades,times,sec,{bull,bear}):[]),...paperMarkers(visiblePaper,times,sec,simColor,{bull,bear}),...(layers.news?newsMarkers(news,{high:css('--mc-news-high','#dc2626'),mid:css('--mc-news-mid','#d97706')}):[])]).map(x=>({...x,time:x.time as UTCTimestamp})));
  // otevřená pozice: vstup, SL, TP
  for(const l of lines.current)s.removePriceLine(l);lines.current=[];
  if(layers.trades&&open)for(const p of positions){
   const pnl=p.pnl===null?'':' · '+(p.converted?'':'≈ ')+fmtMoney(p.pnl,p.converted?open.currency:p.accountCurrency);
   lines.current.push(s.createPriceLine({price:p.openPrice,color:'#2563eb',lineStyle:LineStyle.Dashed,lineWidth:1,title:(p.side==='buy'?'Buy':'Sell')+pnl,axisLabelVisible:true}));
   if(p.sl!==null)lines.current.push(s.createPriceLine({price:p.sl,color:bear,lineStyle:LineStyle.Solid,lineWidth:1,title:'SL',axisLabelVisible:true}));
   if(p.tp!==null)lines.current.push(s.createPriceLine({price:p.tp,color:bull,lineStyle:LineStyle.Solid,lineWidth:1,title:'TP',axisLabelVisible:true}));
  }
  // otevřené pozice simulace: vstup, SL, TP (tečkovaně, ať se neplete se skutečnou pozicí)
  for(const t of visiblePaper)if(t.closed===null){
   lines.current.push(s.createPriceLine({price:t.entry,color:simColor(t),lineStyle:LineStyle.Dotted,lineWidth:1,title:'Sim '+(t.variant??'A')+' '+(t.direction==='long'?'long':'short')+(t.mark?' · '+paperR(t.mark.r):''),axisLabelVisible:true}));
   lines.current.push(s.createPriceLine({price:t.sl,color:bear,lineStyle:LineStyle.Dotted,lineWidth:1,title:'Sim '+(t.variant??'A')+' SL',axisLabelVisible:true}));
   if(t.tp>0)lines.current.push(s.createPriceLine({price:t.tp,color:bull,lineStyle:LineStyle.Dotted,lineWidth:1,title:'Sim '+(t.variant??'A')+' TP',axisLabelVisible:true})); // tp 0 = bez TP (varianta ze sweepu)
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
 },[times,tf,layers,trades,paper,prefs.paperVariant,owner,news,upcoming,positions,open,scores,tick,ver]);

 if(data.status==='unsupported')return null;
 const shown=hover??bars[bars.length-1]??null;
 const prev=shown?bars[bars.findIndex(b=>b.time===shown.time)-1]:undefined;
 const hoverNews=shown&&layers.news?news.filter(n=>n.time===shown.time).map(n=>n.event):[];
 const hoverScore=shown&&layers.score?scoreMap.get(shown.time)??null:null;
 const hoverFp=isFp&&shown?fp?.map.get(shown.time):undefined;
 const fpLine=hoverFp&&typeof hoverFp.d==='number'?`Δ ${hoverFp.d>0?'+':hoverFp.d<0?'−':''}${fmtVol(Math.abs(hoverFp.d))} · POC ${fmtPrice(hoverFp.poc??0)} · objem ${fmtVol(hoverFp.v)}${hoverFp.live?' · živá svíčka':''}`:isFp&&shown?'Footprint pro tuto svíčku se ještě dopočítává':'';
 const newsText=hoverNews.map(e=>e.title+(forecastLine(e)?' ('+forecastLine(e)+')':'')).join(' · '),line2=[fpLine,newsText].filter(Boolean).join(' · ');
 const loading=data.status==='loading',empty=data.status==='error'&&!bars.length;
 const popEvent=pop&&layers.news?events.find(e=>e.id===pop.id):undefined;
 return <section ref={card} className={'s-card mc'+(fill?' mc-fill':'')+(fs?' mc-fs':'')} aria-busy={loading}>
  <div className="mc-head">
   <div className="mc-title"><h2>Graf trhu</h2><p className="mc-ohlc" aria-live="off">{shown&&<><b>{barLabel(shown.time,tf)}</b>{type==='ha'&&<span className="mc-ha" title="Svíčky v grafu jsou Heikin-Ashi, hodnoty O H L C jsou skutečné ceny">HA</span>}<span>O <em>{fmtPrice(shown.open)}</em></span><span>H <em>{fmtPrice(shown.high)}</em></span><span>L <em>{fmtPrice(shown.low)}</em></span><span>C <em>{fmtPrice(shown.close)}</em></span>{prev&&<span className={shown.close>=prev.close?'up':'down'}>{pct(prev.close,shown.close)}</span>}{hoverScore!==null&&<span>Skóre <em className={hoverScore>=0?'up':'down'}>{scoreFmt(hoverScore)}</em></span>}</>}</p><p className="mc-news-line" title={line2||undefined}>{line2}</p></div>
   <div className="mc-controls">
    <select className="mc-chip mc-type" aria-label="Typ grafu" value={isFp?'footprint':type} onChange={e=>{const v=e.target.value;if(isChartType(v)||(v==='footprint'&&fpOk))update({type:v})}}>{CHART_TYPES.map(t=><option key={t} value={t}>{CHART_TYPE_LABELS[t]}</option>)}{fpOk&&<option value="footprint">Footprint</option>}</select>
    <select className="mc-chip mc-type mc-tfsel" aria-label="Časový rámec" value={tf} onChange={e=>{const v=e.target.value;update(isFp?(isFpTf(v)?{fpTf:v}:{}):{tf:v as Tf})}}>{tfButtons.map(t=><option key={t} value={t}>{t}</option>)}</select>
    <div className="mc-seg mc-tfseg" role="group" aria-label="Časový rámec">{tfButtons.map(t=><button key={t} type="button" className={'mc-chip'+(tf===t?' on':'')} aria-pressed={tf===t} onClick={()=>update(isFp?{fpTf:t as FpTf}:{tf:t as Tf})}>{t}</button>)}</div>
    <div className="mc-seg" role="group" aria-label="Vrstvy grafu">{LAYER_LABELS.filter(([k])=>k!=='paper'||owner).map(([k,label])=>{const off=k==='sessions'&&!sessOk;return <button key={k} type="button" className={'mc-chip'+(layers[k]&&!off?' on':'')} aria-pressed={layers[k]} disabled={off} title={off?'Seance se zobrazují jen na M1–H1':undefined} onClick={()=>toggle(k)}>{label}</button>})}</div>
    {owner&&layers.paper&&<select className="mc-chip mc-type" aria-label="Varianta simulace" title="Obchody které varianty simulace ukázat" value={prefs.paperVariant} onChange={e=>{const v=e.target.value as PaperPick;if(PAPER_PICKS.includes(v))update({paperVariant:v})}}>{PAPER_PICKS.map(v=><option key={v} value={v}>{v==='all'?'Sim: vše':'Sim '+v}</option>)}</select>}
    {headExtra}<button type="button" className="mc-chip mc-now" onClick={()=>chart.current?.timeScale().scrollToRealTime()} disabled={!bars.length}>Na současnost</button>
    {winName!==WIN+slugOf(instrument)&&<button type="button" className="mc-chip mc-icon" aria-label="Otevřít graf v novém okně" title="Otevřít v novém okně (např. na druhý monitor)" onClick={()=>setBlocked(!openChartWindow(instrument,tf))}><AppWindow size={14} aria-hidden/></button>}
    <button type="button" className={'mc-chip mc-icon'+(fs?' on':'')} aria-pressed={fs} aria-label={fs?'Zmenšit graf (Esc)':'Graf přes celou obrazovku (F)'} title={fs?'Zmenšit (Esc)':'Přes celou obrazovku (F)'} onClick={()=>full(!fs)}>{fs?<Minimize2 size={14} aria-hidden/>:<Maximize2 size={14} aria-hidden/>}</button>
   </div>
  </div>
  <div className="mc-body">
  {draw.toolbar}
  <div className="mc-wrap">
   <div ref={el} className="mc-chart" style={height?{'--mc-h':height} as React.CSSProperties:undefined} data-drawing={draw.drawing?'1':undefined} role="img" aria-label={`${isFp?'Footprint':CHART_TYPE_LABELS[type]} – graf ${name}, časový rámec ${tf}${layers.trades?', s tvými obchody':''}${layers.news?', se zprávami z kalendáře':''}${layers.score?', s pásem skóre Tradee':''}`}/>
   {loading&&<div className="mc-skeleton" aria-label="Načítám svíčky"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>}
   {empty&&<div className="mc-empty" role="status"><p>{data.message||'Ceny teď nejsou k dispozici.'}</p><button type="button" className="mc-chip" onClick={()=>setReload(n=>n+1)}>Zkusit znovu</button></div>}
   {tip&&!draw.drawing&&!(pop&&tip.id==='n:'+pop.id)&&<div className={'mc-tip'+(tip.flip?' flip':'')} style={{left:tip.x,top:tip.y}} role="tooltip">{tip.lines.map((l,i)=>i?<span key={i}>{l}</span>:<b key={i}>{l}</b>)}</div>}
   {isFp&&!fpMode&&bars.length>0&&!loading&&<div className="mc-fp-hint" role="status">Přibliž pro footprint</div>}
   {pop&&popEvent&&<NewsCard key={popEvent.id} e={popEvent} x={pop.x} y={pop.y} bars={bars} tf={tf} asOf={data.at??0} name={name} onClose={()=>setPop(null)} onFiner={tf==='M15'||tf==='M5'||tf==='M1'?undefined:()=>update(isFp?{fpTf:'M15'}:{tf:'M15'})}/>}
   {draw.overlay}
  </div>
  </div>
  <div className="mc-foot">
   {data.stale&&bars.length>0&&<span className="mc-stale" role="status">Ceny mohou být zpožděné{data.updated?' · stav '+new Date(data.updated).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):''}</span>}
   {tradesError&&layers.trades&&<span className="mc-stale">Obchody se nepodařilo načíst.</span>}
   {blocked&&<span className="mc-stale" role="status">Prohlížeč zablokoval nové okno – povol pro Tradee vyskakovací okna.</span>}
   {layers.news&&<span className="mc-legend mc-news-legend"><span><i className="mc-ndot high"/>silná zpráva</span><span><i className="mc-ndot mid"/>střední</span><span><i className="mc-nbadge">US</i>nadcházející dole · klik = detail a reakce trhu</span></span>}
   {layers.sessions&&sessOk&&<span className="mc-legend">{SESSIONS.filter(s=>s.key!=='off').map(s=><span key={s.key}><i className="mc-swatch" style={{background:SESSION_COLORS[s.key as keyof typeof SESSION_COLORS]}}/>{s.label}</span>)}</span>}
   {isFp&&fp?.error&&bars.length>0&&<span className="mc-stale" role="status">{fp.error} Zobrazuji poslední uložená data.</span>}
   {isFp&&<span className="mc-legend mc-fp-legend"><span><i className="mc-fp-cell"/>buňka = prodej × nákup (taker), barva podle delty, sytost podle objemu</span><span><i className="mc-fp-poc"/>POC</span><span><i className="mc-fp-imb"/>nerovnováha ≥ 3 : 1 (diagonálně)</span><span>Δ dole = delta svíčky{fp?.tick?' · krok '+fmtPrice(fp.tick):''}</span>{(fp?.pending||0)>0&&<span>Dopočítávám starší svíčky ({fp?.pending})…</span>}</span>}
   {draw.status}
   <span className="mc-src">{isFp?'Binance '+(fp?.symbol||'')+' · ':'Yahoo Finance · '}čas Praha · <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Grafy TradingView Lightweight Charts™</a></span>
  </div>
 </section>;
}

// detail zprávy po kliku na značku: země, síla, čas, hodnoty (skutečnost / odhad / předchozí) a jak se trh po zprávě pohnul – z načtených svíček aktuálního TF (lib/chart/layers newsReaction)
function reactionText(r:Reaction,tf:ChartTf,now:number){
 if(r.status==='future')return 'zatím neproběhlo';
 if(r.status==='coarse')return 'na '+tf+' nelze změřit';
 if(r.status==='unknown')return 'čas zprávy neupřesněn';
 if(r.status==='nodata')return 'mimo načtené svíčky';
 return (r.end??0)>chartTime(now)?'ještě běží':'chybí novější svíčky';
}
function NewsCard({e,x,y,bars,tf,asOf,name,onClose,onFiner}:{e:CalendarEvent;x:number;y:number;bars:Bar[];tf:ChartTf;asOf:number;name:string;onClose:()=>void;onFiner?:()=>void}){
 const ref=useRef<HTMLDivElement>(null),[now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(t)},[]);
 const rx=useMemo(()=>newsReaction(bars,e,TF_SEC[tf],now,Math.min(asOf,now)),[bars,e,tf,now,asOf]);
 // vedle místa kliku, celý uvnitř grafu
 useLayoutEffect(()=>{
  const box=ref.current,host=box?.parentElement;if(!box||!host)return;
  const W=host.clientWidth,H=host.clientHeight,w=box.offsetWidth,h=box.offsetHeight,left=x+14+w<=W-4?x+14:x-14-w;
  box.style.left=Math.max(4,Math.min(left,W-w-4))+'px';box.style.top=Math.max(4,Math.min(y-24,H-h-4))+'px';
 });
 const country=eventCountry(e),strong=e.signal>=3,future=Date.parse(e.at)>now,prec=bars.length?precision(bars[bars.length-1].close):2;
 const vals=([['Skutečnost',e.actual],['Odhad',e.consensus||e.forecast],['Předchozí',e.previous]] as const).filter(([,v])=>v);
 const first=rx.find(r=>r.status==='ok'),coarse=rx.some(r=>r.status==='coarse'),recent=Date.parse(e.at)>now-55*86400000;
 return <div ref={ref} className="mc-pop" role="dialog" aria-label={'Zpráva: '+e.title}>
  <div className="mc-pop-head">{country&&<span className={'mc-cc '+(strong?'high':'mid')}>{country}</span>}<b>{e.title}</b><button type="button" className="mc-pop-x" aria-label="Zavřít detail zprávy" title="Zavřít (Esc)" onClick={onClose}><X size={14} aria-hidden/></button></div>
  <p className="mc-pop-meta"><span className={'mc-imp '+(strong?'high':'mid')}>{strong?'Silná':'Střední'} zpráva</span><span>{eventTime(e)}</span><span>{relative(e.at,now)}</span></p>
  {vals.length>0&&<dl className="mc-pop-vals">{vals.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
  <p className="mc-pop-sub">Jak se {name} po zprávě pohnul <span>· {tf}</span></p>
  <table className="mc-pop-table">
   <thead><tr><th scope="col">Po</th><th scope="col">Změna</th><th scope="col">%</th><th scope="col" title="Nejvyšší minus nejnižší cena od zprávy do konce doby">Rozpětí</th></tr></thead>
   <tbody>{rx.map(r=>{const tone=r.change===undefined||r.change===0?'':r.change>0?'up':'down';return <tr key={r.key}><th scope="row">{r.label}</th>{r.status==='ok'&&r.change!==undefined?<><td className={tone}>{signed(r.change,prec)}</td><td className={tone}>{r.pct===undefined?'–':signed(r.pct,2,2)+' %'}</td><td>{((r.high??0)-(r.low??0)).toLocaleString('cs-CZ',{maximumFractionDigits:prec})}</td></>:<td colSpan={3} className="mc-pop-na">{reactionText(r,tf,now)}</td>}</tr>})}</tbody>
  </table>
  {future?<p className="mc-pop-note">Reakce trhu se dopočítá po zveřejnění zprávy.</p>:first?<p className="mc-pop-note">Měřeno od otevření svíčky {barLabel(first.start??0,tf)} ({fmtPrice(first.from??0)}) do zavření svíčky na konci doby.</p>:null}
  {!future&&coarse&&onFiner&&recent&&<button type="button" className="mc-chip mc-pop-tf" onClick={onFiner}>Přesněji na M15</button>}
 </div>;
}
