'use client';
// Kreslení v grafu trhu: nástroje ve skupinách, výběr a tažení kreseb, panel stylu, ukládání per uživatel × trh (/api/chart/drawings).
import {Fragment,useEffect,useLayoutEffect,useMemo,useRef,useState,type RefObject} from 'react';
import type {IChartApi,ISeriesApi,Logical,SeriesType} from 'lightweight-charts';
import {MousePointer2,TrendingUp,Minus,RectangleHorizontal,AlignVerticalDistributeCenter,Type,Ruler,Magnet,Eraser,Trash2,MoveUpRight,MoveRight,ArrowRightToLine,Waypoints,Brush,Equal,SquareArrowUp,SquareArrowDown,MoveVertical,MoveHorizontal,Pin,Settings2,EyeOff,GitFork,Grid3x3,Rows4,Undo2,Redo2} from 'lucide-react';
import {chartTime} from '@/lib/journal/chart-data';
import {TF_SEC,type ChartTf} from '@/lib/chart/layers';
import {COLOR_LABELS,DRAW_COLORS,DRAW_LABELS,MAX_DRAWINGS,RR_MAX,RR_MIN,isHex,type NamedColor,applyLook,emptyHistory,emptyPrefs,lookOf,parsePrefs,record,redoStep,rrOf,undoStep,withRR,MAX_PRESETS,MAX_PRESET_NAME,type DrawPrefs,type History,type Look,type Preset,MAX_PATH,MAX_TEXT,capsOf,firstTouch,fromChartTime,logicalOf,measure,measureLines,moveHandle,moveEdge,type Edge,newId,parseDrawings,pipSize,positionFrom,priceRangeLine,simplifyMax,snapPrice,styleOf,timeOfLogical,timeRangeLine,toggleTf,translate,visibleOn,type Anchor,type DrawColor,type DrawStyle,type DrawType,type Drawing,type Pt} from '@/lib/chart/drawings';
import {DrawingsPrimitive,type DrawPalette} from './chart-drawings';
import {fmtPrice} from './live';

export type Tool='cursor'|DrawType;
type Bar={time:number;open:number;high:number;low:number;close:number};
type Save='idle'|'saving'|'saved'|'error'|'loaderror';
type Drag={id:string;temp:boolean;part:'body'|'handle'|'edge';index:number;edge?:Edge;start:{l:number;p:number};orig:Drawing;cur:Drawing|null;x:number;y:number;rr:boolean};
// rozkreslená kresba: pevné body + poslední bod, který sleduje kurzor; štětec sbírá body tahu
type Draft={id:string;type:DrawType;color:DrawColor;pts:Anchor[];fixed:number;need:number;x:number;y:number;placed:boolean;lastDown:number;px?:Pt[];look:Look|null};
type Edit={x:number;y:number;anchor:Anchor;id?:string;text:string;look?:Look|null};
type Icon=typeof Minus;
const TOOL_META:Record<DrawType,{Icon:Icon;hint:string}>={
 trend:{Icon:TrendingUp,hint:'2 body'},ray:{Icon:MoveUpRight,hint:'z bodu A přes B doprava'},hline:{Icon:Minus,hint:'1 cena'},hray:{Icon:MoveRight,hint:'1 bod, doprava'},
 touch:{Icon:ArrowRightToLine,hint:'čára doprava do prvního dotyku ceny'},path:{Icon:Waypoints,hint:'body klikáním, dvojklik / Enter dokončí'},
 channel:{Icon:Equal,hint:'3 body'},fib:{Icon:AlignVerticalDistributeCenter,hint:'2 body'},rect:{Icon:RectangleHorizontal,hint:'2 rohy'},brush:{Icon:Brush,hint:'kresli tahem'},
 long:{Icon:SquareArrowUp,hint:'vstup a stop-loss'},short:{Icon:SquareArrowDown,hint:'vstup a stop-loss'},
 fibext:{Icon:Rows4,hint:'3 body: impuls a korekce'},pitchfork:{Icon:GitFork,hint:'3 body: počátek a dva vrcholy'},gann:{Icon:Grid3x3,hint:'2 rohy'},
 measure:{Icon:Ruler,hint:'2 body, neukládá se'},prange:{Icon:MoveVertical,hint:'2 body'},trange:{Icon:MoveHorizontal,hint:'2 body'},text:{Icon:Type,hint:'1 bod'},
};
export const TOOL_GROUPS:{id:string;label:string;tools:DrawType[]}[]=[
 {id:'lines',label:'Čáry',tools:['trend','ray','hline','hray','touch','path']},
 {id:'channels',label:'Kanály a vidle',tools:['channel','pitchfork']},
 {id:'fib',label:'Fibonacci a Gann',tools:['fib','fibext','gann']},
 {id:'shapes',label:'Tvary',tools:['rect','brush']},
 {id:'pos',label:'Pozice',tools:['long','short']},
 {id:'measure',label:'Měření',tools:['measure','prange','trange']},
 {id:'text',label:'Text',tools:['text']},
];
const LAST_KEY='tradee.chart.tools';
const ONE_CLICK=new Set<DrawType>(['hline','hray','touch']);
const needOf=(t:DrawType)=>t==='path'?MAX_PATH:t==='channel'||t==='fibext'||t==='pitchfork'?3:2;
const drawHint=(t:DrawType)=>ONE_CLICK.has(t)||t==='text'?'klikni do grafu':t==='brush'?'kresli tahem myši nebo prstu':t==='path'?'klikej body, dvojklik nebo Enter dokončí':t==='channel'?'klikni dva body čáry a třetí pro šířku kanálu':t==='fibext'?'klikni začátek a konec impulsu a pak bod korekce':t==='pitchfork'?'klikni počátek a pak dva vrcholy (horní a dolní)':t==='gann'?'klikni dva protilehlé rohy (nebo táhni)':t==='long'||t==='short'?'klikni vstup a pak stop-loss (nebo táhni), cíl se nastaví na R:R 2':'klikni na dva body (nebo táhni)';
const SAVE_TEXT:Record<Exclude<Save,'idle'>,string>={saving:'Ukládám kresby…',saved:'Uloženo',error:'Kresby se nepodařilo uložit',loaderror:'Kresby se nepodařilo načíst'};
const css=(name:string,fallback:string)=>getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback;
// barvu z CSS (i color-mix, var) převést na #rrggbb / rgba() přes plátno, aby šla průhlednost
let probe:CanvasRenderingContext2D|null=null;
function norm(c:string,fallback:string){try{probe??=document.createElement('canvas').getContext('2d');if(!probe)return c;probe.fillStyle=fallback;probe.fillStyle=c;return String(probe.fillStyle)}catch{return c}}
const MAC=typeof navigator!=='undefined'&&/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent);
const UNDO_KEY=MAC?'⌘Z':'Ctrl+Z',REDO_KEY=MAC?'⇧⌘Z':'Ctrl+Y';
const RR_CHIPS=[1,1.5,2,3];
const fmtRR=(v:number)=>String(Math.round(v*100)/100);
const editable=(t:EventTarget|null)=>t instanceof HTMLElement&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const touchLabel=(sec:number,tf:ChartTf)=>new Date(sec*1000).toLocaleString('cs-CZ',{timeZone:'UTC',day:'numeric',month:'numeric',...(tf==='D1'||tf==='W1'||tf==='MN'?{year:'numeric'}:{hour:'2-digit',minute:'2-digit'}) as Intl.DateTimeFormatOptions});

export function useChartDrawings({chart,series,ver,el,bars,tf,tfList,instrument,tick}:{chart:RefObject<IChartApi|null>;series:RefObject<ISeriesApi<SeriesType>|null>;ver:number;el:RefObject<HTMLDivElement|null>;bars:Bar[];tf:ChartTf;tfList:readonly ChartTf[];instrument:string;tick:number}){
 const [tool,setTool]=useState<Tool>('cursor');
 const [drawings,setDrawings]=useState<Drawing[]>([]),[temp,setTemp]=useState<Drawing|null>(null),[selected,setSelected]=useState<string|null>(null);
 const [magnet,setMagnet]=useState(false),[color,setColor]=useState<DrawColor>('brand');
 const [edit,setEdit]=useState<Edit|null>(null),[save,setSave]=useState<Save>('idle'),[saveError,setSaveError]=useState('');
 const [styleOpen,setStyleOpen]=useState(false),keepStyle=useRef(false);
 // výběr jiné kresby zavře panel stylu (otevírá se až tlačítkem); výjimka = klik na R:R pozice
 useEffect(()=>{if(keepStyle.current){keepStyle.current=false;return}setStyleOpen(false)},[selected]);
 const [last,setLast]=useState<Record<string,DrawType>>(()=>Object.fromEntries(TOOL_GROUPS.map(g=>[g.id,g.tools[0]])));
 const [menu,setMenu]=useState<{group:string;x:number;y:number}|null>(null);
 // aktuální stav pro handlery myši (registrují se jednou)
 // presety a výchozí vzhled nástrojů (načtou se jednou; při chybě platí vestavěné výchozí hodnoty)
 const [prefs,setPrefs]=useState<DrawPrefs>(emptyPrefs),[prefsState,setPrefsState]=useState<'loading'|'ok'|'loaderror'|'error'>('loading');
 const [presetSel,setPresetSel]=useState<Partial<Record<DrawType,string>>>({});
 const S=useRef({tool,drawings,temp,selected,magnet,color,bars,times:[] as number[],tf,instrument,prefs,presetSel});
 const times=useMemo(()=>bars.map(b=>b.time),[bars]);
 useLayoutEffect(()=>{S.current={tool,drawings,temp,selected,magnet,color,bars,times,tf,instrument,prefs,presetSel}});
 // vzhled nové kresby: zvolený preset nástroje, jinak uživatelův výchozí, jinak nic (vestavěné hodnoty)
 const lookFor=(t:DrawType):Look|null=>{const st=S.current,id=st.presetSel[t];return (id&&st.prefs.presets.find(p=>p.id===id&&p.tool===t))||st.prefs.defaults[t]||null};
 const draft=useRef<Draft|null>(null),drag=useRef<Drag|null>(null);
 const dirty=useRef(false),loaded=useRef<string|null>(null),pending=useRef<{instrument:string;drawings:Drawing[]}|null>(null);
 const menuRef=useRef<HTMLDivElement>(null);
 // historie úprav kreseb aktuálního trhu (Zpět / Znovu); group slučuje rychlé změny jednoho pole (psaní, posuvník) do jednoho kroku
 const hist=useRef<History<Drawing[]>>(emptyHistory()),lastGroup=useRef<{g:string;at:number}|null>(null);
 const [undoVer,setUndoVer]=useState(0),[canHist,setCanHist]=useState({undo:false,redo:false}),[rrFocus,setRrFocus]=useState<{id:string;n:number}|null>(null);

 // převody čas/cena ↔ pixely (logické indexy; mezi svíčkami a mimo rozsah interpolace po TF) a primitivum kreseb
 const [{conv,prim}]=useState(()=>{
  const conv={
   toL:(t:number)=>logicalOf(S.current.times,TF_SEC[S.current.tf],chartTime(t)),
   fromL:(l:number)=>fromChartTime(timeOfLogical(S.current.times,TF_SEC[S.current.tf],l)),
   axis(){const ts=chart.current?.timeScale();const x0=ts?.logicalToCoordinate(0 as Logical),x1=ts?.logicalToCoordinate(1 as Logical);return x0==null||x1==null||x1===x0?null:{x0,dx:x1-x0}},
  };
  const prim=new DrawingsPrimitive({
   project:a=>{const ax=conv.axis(),y=series.current?.priceToCoordinate(a.p);if(!ax||y==null||!S.current.times.length)return null;return {x:ax.x0+ax.dx*conv.toL(a.t),y}},
   price:fmtPrice,
   lines:d=>{
    const [a,b]=d.a;
    if(d.type==='prange')return [priceRangeLine(a,b,fmtPrice,pipSize(S.current.instrument))];
    if(d.type==='trange')return [timeRangeLine(a,b,conv.toL(a.t),conv.toL(b.t))];
    return measureLines(measure(a,b,conv.toL(a.t),conv.toL(b.t)),fmtPrice);
   },
   touch:d=>{
    const st=S.current,i=firstTouch(st.bars,conv.toL(d.a[0].t),d.a[0].p),ax=conv.axis();
    if(i===null||!ax)return {x:null,label:'netestováno'};
    return {x:ax.x0+ax.dx*i,label:'dotyk '+touchLabel(st.bars[i].time,st.tf)};
   },
  });
  return {conv,prim};
 });
 // bod pod kurzorem: logický index a cena; kotva = střed svíčky (+ magnet na O/H/L/C)
 const raw=(p:Pt)=>{const ax=conv.axis(),price=series.current?.coordinateToPrice(p.y);if(!ax||price==null)return null;return {l:(p.x-ax.x0)/ax.dx,p:price}};
 const anchorAt=(p:Pt):Anchor|null=>{const r=raw(p);if(!r)return null;const i=Math.round(r.l),bar=S.current.magnet?S.current.bars[i]:undefined;return {t:Math.round(conv.fromL(i)),p:bar?snapPrice(bar,r.p):r.p}};
 // volný bod (štětec): bez zaokrouhlení na svíčku
 const freeAt=(p:Pt):Anchor|null=>{const r=raw(p);return r?{t:Math.round(conv.fromL(r.l)),p:r.p}:null};

 // připojení primitiva k sérii svíček
 useEffect(()=>{const s=series.current,pr=prim;s?.attachPrimitive(pr);pr.update();return()=>{try{s?.detachPrimitive(pr)}catch{}}},[series,ver]);
 useEffect(()=>{const pr=prim;pr.drawings=drawings;pr.temp=temp;pr.selected=selected;pr.tf=tf;pr.update()},[drawings,temp,selected,times,tf]);
 // po přepnutí TF zrušit výběr kresby, která na něm není vidět
 useEffect(()=>{setSelected(id=>{const d=id?S.current.drawings.find(x=>x.id===id):null;return d&&!visibleOn(d,tf)?null:id})},[tf]);
 // barvy z palety a motivu (překreslit při změně)
 useEffect(()=>{
  const fg=css('--t-fg','#0b0c0e');
  const pal:DrawPalette={brand:norm(css('--t-brand','#245bff'),'#245bff'),bull:norm(css('--bull','#16a34a'),'#16a34a'),bear:norm(css('--bear','#dc2626'),'#dc2626'),amber:'#f59e0b',muted:norm(css('--t-muted','#6b7079'),'#6b7079'),fg:norm(fg,'#0b0c0e'),bg:norm(css('--t-surface','#ffffff'),'#ffffff'),text:norm(fg,'#0b0c0e')};
  prim.palette=pal;prim.update();
 },[tick]);
 // při kreslení graf neposouvat ani nezoomovat (tahy kreslí)
 useEffect(()=>{const c=chart.current;if(!c)return;const free=tool==='cursor';c.applyOptions({handleScroll:free,handleScale:free})},[tool,chart]);
 // poslední nástroj ve skupině (pamatuje si prohlížeč)
 useEffect(()=>{try{const v=JSON.parse(localStorage.getItem(LAST_KEY)||'null');if(v&&typeof v==='object')setLast(old=>({...old,...Object.fromEntries(TOOL_GROUPS.flatMap(g=>typeof v[g.id]==='string'&&g.tools.includes(v[g.id])?[[g.id,v[g.id] as DrawType]]:[]))}))}catch{}},[]);

 const commit=(next:Drawing[],group?:string)=>{
  const now=Date.now(),lg=lastGroup.current;
  if(!(group&&lg&&lg.g===group&&now-lg.at<1500))setHist(record(hist.current,S.current.drawings));
  lastGroup.current=group?{g:group,at:now}:null;
  dirty.current=true;setDrawings(next);
 };
 const setHist=(h:History<Drawing[]>)=>{hist.current=h;setCanHist(c=>c.undo===h.past.length>0&&c.redo===h.future.length>0?c:{undo:h.past.length>0,redo:h.future.length>0})};
 const restore=(v:Drawing[])=>{lastGroup.current=null;dirty.current=true;setDrawings(v);setUndoVer(n=>n+1);setSelected(id=>id&&(v.some(d=>d.id===id)||S.current.temp?.id===id)?id:null)};
 const undo=()=>{if(drag.current||draft.current)cancel();const r=undoStep(hist.current,S.current.drawings);if(!r)return;setHist(r.h);restore(r.value)};
 const redo=()=>{if(drag.current||draft.current)cancel();const r=redoStep(hist.current,S.current.drawings);if(!r)return;setHist(r.h);restore(r.value)};
 const build=(dr:Draft):Drawing=>applyLook({id:dr.id,type:dr.type,color:dr.color,a:(dr.type==='long'||dr.type==='short')?positionFrom(dr.type,dr.pts[0],dr.pts[1]??dr.pts[0]):dr.pts},dr.look);
 const finish=(d:Drawing)=>{
  draft.current=null;prim.draft=null;setTool('cursor');
  if(d.type==='measure'){setTemp(d);setSelected(d.id);return}
  if(S.current.drawings.length>=MAX_DRAWINGS){setSave('error');setSaveError(`Na jednom trhu může být nejvýš ${MAX_DRAWINGS} kreseb.`);prim.update();return}
  commit([...S.current.drawings,d]);setSelected(d.id);
 };
 const cancel=()=>{
  if(drag.current){drag.current=null;const pr=prim;pr.drawings=S.current.drawings;pr.temp=S.current.temp}
  draft.current=null;prim.draft=null;prim.update();setTool('cursor');
 };
 // lomená čára: dokončit bez bodu pod kurzorem
 const finishPath=()=>{const dr=draft.current;if(!dr||dr.type!=='path')return;const pts=dr.pts.slice(0,dr.fixed);if(pts.length>=2)finish({...build(dr),a:pts});else cancel()};
 const finishBrush=()=>{
  const dr=draft.current;if(!dr||dr.type!=='brush'||!dr.px)return;
  const idx=simplifyMax(dr.px),pts=idx.map(i=>dr.pts[i]);
  if(pts.length>=2)finish({...build(dr),a:pts});else cancel();
 };

 // myš a dotyk: zachytit dřív než graf (capture), aby kreslení a tažení kresby neposouvalo graf
 useEffect(()=>{
  const box=el.current;if(!box)return;
  const pos=(cx:number,cy:number):Pt=>{const r=box.getBoundingClientRect();return {x:cx-r.left,y:cy-r.top}};
  const inPane=(p:Pt)=>{const c=chart.current;if(!c)return false;const h=c.panes()[0]?.getHeight()??0;return p.x>=0&&p.x<=c.timeScale().width()&&p.y>=0&&p.y<=h};
  const point=(e:MouseEvent|TouchEvent)=>{const t='touches' in e?e.touches[0]??e.changedTouches[0]:e;return t?pos(t.clientX,t.clientY):null};
  const stop=(e:Event)=>{e.stopPropagation();if(e.cancelable)e.preventDefault()};
  const render=(dr:Draft)=>{prim.draft=build(dr);prim.update()};
  // Shift drží čáru vodorovně: bod převezme cenu referenčního bodu (předchozího / druhého konce)
  const shiftOf=(e?:MouseEvent|TouchEvent)=>!!e&&!('touches' in e)&&e.shiftKey;
  const level=(a:Anchor,ref:Anchor|undefined,on:boolean):Anchor=>on&&ref?{t:a.t,p:ref.p}:a;
  // Shift u obdélníku a mřížky = rovnoměrný tvar (čtverec v pixelech) jako v malování; u čar vodorovně
  const SQUARE=new Set(['rect','gann']);
  const lock=(type:string,a:Anchor,ref:Anchor|undefined,on:boolean,p:Pt):Anchor=>{
   if(!on||!ref)return a;if(!SQUARE.has(type))return level(a,ref,true);
   const ax=conv.axis(),ry=series.current?.priceToCoordinate(ref.p);if(!ax||ry==null)return a;const r={x:ax.x0+ax.dx*conv.toL(ref.t),y:ry};const dx=p.x-r.x,dy=p.y-r.y,sz=Math.max(Math.abs(dx),Math.abs(dy));
   return freeAt({x:r.x+(dx<0?-sz:sz),y:r.y+(dy<0?-sz:sz)})||a};
  // další bod rozkreslené kresby (klik nebo puštění po tahu)
  const advance=(dr:Draft,p:Pt,shift=false)=>{
   const a0=anchorAt(p);if(!a0)return;const a=lock(dr.type,a0,dr.fixed>0?dr.pts[dr.fixed-1]:undefined,shift,p);
   if(Math.hypot(p.x-dr.x,p.y-dr.y)<=3){dr.placed=false;return}
   dr.pts[dr.fixed]=a;dr.fixed++;
   if(dr.fixed>=dr.need){finish(build({...dr,pts:dr.pts.slice(0,dr.need)}));return}
   dr.pts=[...dr.pts.slice(0,dr.fixed),a];dr.x=p.x;dr.y=p.y;dr.placed=false;render(dr);
  };
  function down(e:MouseEvent|TouchEvent){
   if(!('touches' in e)&&e.button!==0)return;
   const p=point(e),st=S.current;if(!p||!inPane(p)||!st.times.length)return;
   const touch='touches' in e;
   const dr=draft.current;
   if(dr){
    stop(e);const now=Date.now();
    // dvojklik / dvojí ťuknutí dokončí lomenou čáru
    if(dr.type==='path'&&now-dr.lastDown<400&&Math.hypot(p.x-dr.x,p.y-dr.y)<12){finishPath();return}
    dr.lastDown=now;advance(dr,p,shiftOf(e));return;
   }
   if(st.tool!=='cursor'){
    stop(e);const a=st.tool==='brush'?freeAt(p):anchorAt(p);if(!a)return;
    const look=lookFor(st.tool);
    if(ONE_CLICK.has(st.tool)){finish(applyLook({id:newId(),type:st.tool,a:[a],color:st.color},look));return}
    if(st.tool==='text'){setTool('cursor');setEdit({x:p.x,y:p.y,anchor:a,text:look?.text||'',look});return}
    const d:Draft={id:newId(),type:st.tool,color:st.color,pts:st.tool==='brush'?[a]:[a,a],fixed:1,need:needOf(st.tool),x:p.x,y:p.y,placed:false,lastDown:Date.now(),px:st.tool==='brush'?[p]:undefined,look};
    draft.current=d;render(d);return;
   }
   const h=prim.hit(p,touch?14:6);
   if(h){
    stop(e);const isTemp=st.temp?.id===h.id,orig=isTemp?st.temp:st.drawings.find(d=>d.id===h.id);const r=raw(p);
    if(!orig||!r)return;
    if(st.selected!==h.id)setSelected(h.id);
    drag.current={id:h.id,temp:isTemp,part:h.hit.part,index:h.hit.part==='handle'?h.hit.index:0,edge:h.hit.part==='edge'?h.hit.edge:undefined,start:r,orig,cur:null,x:p.x,y:p.y,rr:h.hit.part==='body'&&prim.rrAt(p)===h.id};
    return;
   }
   if(st.selected!==null)setSelected(null);
   if(st.temp)setTemp(null);
  }
  function move(e:MouseEvent|TouchEvent){
   const p=point(e);if(!p)return;
   const dr=draft.current;
   if(dr){
    if('touches' in e&&e.cancelable)e.preventDefault();
    if(dr.type==='brush'){const lp=dr.px![dr.px!.length-1];if(Math.hypot(p.x-lp.x,p.y-lp.y)<2||dr.px!.length>=5000)return;const a=freeAt(p);if(!a)return;dr.px!.push(p);dr.pts.push(a);render(dr);return}
    const a0=anchorAt(p);if(!a0)return;const a=lock(dr.type,a0,dr.fixed>0?dr.pts[dr.fixed-1]:undefined,shiftOf(e),p);dr.pts[dr.pts.length-1]=a;if(Math.hypot(p.x-dr.x,p.y-dr.y)>3)dr.placed=true;render(dr);return;
   }
   const g=drag.current;if(!g)return;
   if('touches' in e&&e.cancelable)e.preventDefault();
   if(!g.cur&&Math.hypot(p.x-g.x,p.y-g.y)<3)return;
   let next:Drawing|null=null;
   if(g.part==='handle'){const a0=anchorAt(p);if(a0){const pts=g.orig.a,ref=pts.length>1?pts[g.index===0?1:g.index-1]:undefined;next=moveHandle(g.orig,g.index,lock(g.orig.type,a0,ref,shiftOf(e),p))}}
   // hrana: jen cena (nahoře/dole) nebo jen čas (vlevo/vpravo); Shift tu nic nemění
   else if(g.part==='edge'){const a0=anchorAt(p);if(a0&&g.edge)next=moveEdge(g.orig,g.edge,a0)}
   else{const r=raw(p);if(r)next=translate(g.orig,Math.round(r.l-g.start.l),r.p-g.start.p,conv.toL,t=>Math.round(conv.fromL(t)))}
   if(!next)return;g.cur=next;
   const pr=prim;
   if(g.temp)pr.temp=next;else pr.drawings=S.current.drawings.map(d=>d.id===g.id?next:d);
   pr.update();
  }
  function up(e:MouseEvent|TouchEvent){
   const dr=draft.current;
   // štětec končí puštěním; u ostatních tah (stisk–táhnout–pustit) přidá bod, klik nechá čekat na další
   if(dr){if(dr.type==='brush')finishBrush();else if(dr.placed){const p=point(e);if(p)advance(dr,p,shiftOf(e))}return}
   const g=drag.current;if(!g)return;drag.current=null;
   if(g.cur){if(g.temp)setTemp(g.cur);else commit(S.current.drawings.map(d=>d.id===g.id?g.cur!:d))}
   // klik (bez tažení) na popisek R:R otevře panel stylu se zadáním R:R
   else if(g.rr&&!g.temp){keepStyle.current=true;setTimeout(()=>{keepStyle.current=false},0);setStyleOpen(true);setRrFocus({id:g.id,n:Date.now()})}
  }
  const opt={capture:true,passive:false} as const;
  box.addEventListener('mousedown',down,opt);box.addEventListener('touchstart',down,opt);
  window.addEventListener('mousemove',move);window.addEventListener('touchmove',move,{passive:false});
  window.addEventListener('mouseup',up);window.addEventListener('touchend',up);window.addEventListener('touchcancel',up);
  return()=>{box.removeEventListener('mousedown',down,opt);box.removeEventListener('touchstart',down,opt);window.removeEventListener('mousemove',move);window.removeEventListener('touchmove',move);window.removeEventListener('mouseup',up);window.removeEventListener('touchend',up);window.removeEventListener('touchcancel',up)};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[el,chart]);

 const remove=(id:string)=>{if(S.current.temp?.id===id)setTemp(null);else commit(S.current.drawings.filter(d=>d.id!==id));setSelected(null)};
 // klávesy: Esc zruší, Enter dokončí lomenou čáru, Delete/Backspace smaže vybranou kresbu
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   if(editable(e.target))return;const st=S.current;
   const mod=e.metaKey||e.ctrlKey,k=e.key.toLowerCase();
   if(mod&&!e.altKey&&(k==='z'||(k==='y'&&e.ctrlKey&&!e.metaKey))){e.preventDefault();if(k==='y'||e.shiftKey)redo();else undo();return}
   if(e.key==='Enter'&&draft.current?.type==='path'){e.preventDefault();finishPath()}
   else if(e.key==='Escape'&&(st.tool!=='cursor'||draft.current||drag.current||st.selected||st.temp)){cancel();setSelected(null);setTemp(null)}
   else if((e.key==='Delete'||e.key==='Backspace')&&st.selected){e.preventDefault();remove(st.selected)}
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);

 // načtení kreseb trhu; při odchodu z trhu dořešit čekající uložení
 const send=(payload:{instrument:string;drawings:Drawing[]},keepalive=false)=>{
  if(pending.current!==payload)return;pending.current=null;
  if(payload.instrument===S.current.instrument)setSave('saving');
  const body=JSON.stringify({drawings:payload.drawings});
  // keepalive má limit 64 kB – větší data poslat normálně
  fetch('/api/chart/drawings?instrument='+encodeURIComponent(payload.instrument),{method:'PUT',headers:{'Content-Type':'application/json'},body,keepalive:keepalive&&body.length<60000}).then(async r=>{
   const j=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw new Error(j.error||'');
   if(payload.instrument===S.current.instrument&&!pending.current)setSave('saved');
  }).catch(e=>{if(payload.instrument===S.current.instrument){setSave('error');setSaveError(e instanceof Error?e.message:'')}});
 };
 const flush=()=>{if(pending.current)send(pending.current,true)};
 useEffect(()=>{
  const ac=new AbortController();loaded.current=null;dirty.current=false;setHist(emptyHistory());lastGroup.current=null;
  setDrawings([]);setTemp(null);setSelected(null);setEdit(null);setSave('idle');cancel();
  fetch('/api/chart/drawings?instrument='+encodeURIComponent(instrument),{signal:ac.signal,cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{drawings?:unknown}>:Promise.reject()).then(j=>{
   const r=parseDrawings(j.drawings??[]);loaded.current=instrument;
   // co uživatel stihl nakreslit během načítání, se přidá k uloženým
   setDrawings(old=>{const base=r.ok?r.drawings:[];if(!old.length)return base;dirty.current=true;return [...base,...old.filter(d=>!base.some(b=>b.id===d.id))].slice(0,MAX_DRAWINGS)});
  }).catch(()=>{if(!ac.signal.aborted)setSave('loaderror')});
  return()=>{ac.abort();flush()};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[instrument]);
 // uložení 800 ms po poslední změně
 useEffect(()=>{
  if(!dirty.current||loaded.current!==instrument)return;
  dirty.current=false;const payload={instrument,drawings};pending.current=payload;
  const t=setTimeout(()=>send(payload),800);return()=>clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[drawings]);
 useEffect(()=>{window.addEventListener('pagehide',flush);return()=>{window.removeEventListener('pagehide',flush);flush()}
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);

 // nabídka skupiny nástrojů: zavřít klikem mimo, posunem a změnou velikosti
 useEffect(()=>{
  if(!menu)return;
  const close=(e:Event)=>{if(e.type==='mousedown'&&(menuRef.current?.contains(e.target as Node)||(e.target as HTMLElement).closest?.('.mc-caret')))return;setMenu(null)};
  window.addEventListener('mousedown',close);window.addEventListener('resize',close);window.addEventListener('scroll',close,true);
  const first=menuRef.current?.querySelector<HTMLElement>('[aria-checked=true]')??menuRef.current?.querySelector<HTMLElement>('button');first?.focus();
  return()=>{window.removeEventListener('mousedown',close);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true)};
 },[menu]);

 // presety: načíst jednou na stránku; ukládat 500 ms po poslední změně (PUT jen presets a defaults)
 const prefsTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>{
  const ac=new AbortController();
  fetch('/api/chart/prefs',{signal:ac.signal,cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{prefs?:unknown}>:Promise.reject()).then(j=>{setPrefs(parsePrefs(j.prefs));setPrefsState('ok')}).catch(()=>{if(!ac.signal.aborted)setPrefsState('loaderror')});
  return()=>{ac.abort();if(prefsTimer.current)clearTimeout(prefsTimer.current)};
 },[]);
 const changePrefs=(next:DrawPrefs)=>{
  setPrefs(next);
  // bez načtených presetů neukládat (přepsaly by se uložené); změna platí jen do obnovení stránky
  if(prefsState==='loaderror'||prefsState==='loading')return;
  if(prefsTimer.current)clearTimeout(prefsTimer.current);
  prefsTimer.current=setTimeout(()=>{prefsTimer.current=null;
   fetch('/api/chart/prefs',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefs:{presets:next.presets,defaults:next.defaults}})}).then(r=>{if(!r.ok)throw Error();setPrefsState('ok')}).catch(()=>setPrefsState('error'));
  },500);
 };
 const presetsOf=(t:DrawType)=>prefs.presets.filter(p=>p.tool===t);
 const presetName=(t:Tool)=>{if(t==='cursor')return null;const id=presetSel[t];return id?prefs.presets.find(p=>p.id===id&&p.tool===t)?.name??null:null};
 const savePreset=(d:Drawing,name:string)=>{
  const n=name.trim().slice(0,MAX_PRESET_NAME);if(!n)return;
  const same=prefs.presets.find(p=>p.tool===d.type&&p.name.toLowerCase()===n.toLowerCase());
  const p:Preset={...lookOf(d),id:same?.id??newId(),name:n,tool:d.type};
  if(!same&&prefs.presets.length>=MAX_PRESETS)return;
  changePrefs({...prefs,presets:same?prefs.presets.map(x=>x.id===same.id?p:x):[...prefs.presets,p]});
 };
 const deletePreset=(id:string)=>{changePrefs({...prefs,presets:prefs.presets.filter(p=>p.id!==id)});setPresetSel(m=>Object.fromEntries(Object.entries(m).filter(([,v])=>v!==id)))};
 const setDefault=(d:Drawing)=>changePrefs({...prefs,defaults:{...prefs.defaults,[d.type]:lookOf(d)}});
 const resetDefault=(t:DrawType)=>{const defaults={...prefs.defaults};delete defaults[t];changePrefs({...prefs,defaults})};

 // úpravy vybrané kresby
 const current=selected?(temp?.id===selected?temp:drawings.find(d=>d.id===selected))??null:null;
 const patch=(p:Partial<Drawing>,group?:string)=>{if(!current)return;const next={...current,...p};for(const k of Object.keys(next))if((next as Record<string,unknown>)[k]===undefined)delete (next as Record<string,unknown>)[k];if(temp?.id===current.id)setTemp(next);else commit(drawings.map(d=>d.id===current.id?next:d),group&&group+':'+current.id)};
 const patchStyle=(p:Partial<DrawStyle>,group?:string)=>{if(!current)return;const s:DrawStyle={...current.s,...p};for(const k of Object.keys(s))if((s as Record<string,unknown>)[k]===undefined)delete (s as Record<string,unknown>)[k];patch({s:Object.keys(s).length?s:undefined},group)};
 const applyPreset=(p:Preset)=>{if(!current)return;const next=applyLook(current,p);if(temp?.id===current.id)setTemp(next);else commit(drawings.map(d=>d.id===current.id?next:d));setUndoVer(n=>n+1)};
 const pickColor=(c:DrawColor)=>{setColor(c);patch({color:c})};
 const pin=()=>{if(!temp)return;if(drawings.length>=MAX_DRAWINGS){setSave('error');setSaveError(`Na jednom trhu může být nejvýš ${MAX_DRAWINGS} kreseb.`);return}commit([...drawings,temp]);setTemp(null)};
 const saveText=(text:string)=>{
  const e=edit;setEdit(null);if(!e)return;const v=text.trim().slice(0,MAX_TEXT);
  if(e.id){if(v)commit(drawings.map(d=>d.id===e.id?{...d,text:v}:d));return}
  if(!v)return;if(drawings.length>=MAX_DRAWINGS){setSave('error');setSaveError(`Na jednom trhu může být nejvýš ${MAX_DRAWINGS} kreseb.`);return}
  const d:Drawing=applyLook({id:newId(),type:'text',a:[e.anchor],color,text:v},e.look);commit([...drawings,d]);setSelected(d.id);
 };
 const clearAll=()=>{if(!drawings.length&&!temp)return;if(!window.confirm(`Smazat všechny kresby na tomto trhu (${drawings.length})? Vrátit je půjde tlačítkem Zpět (${UNDO_KEY}).`))return;setTemp(null);setSelected(null);commit([])};
 // preset: undefined = ponechat zvolený, null = bez presetu, id = použít preset pro další kresby nástroje
 const pickTool=(t:Tool,preset?:string|null)=>{
  if(t!=='cursor'&&preset!==undefined)setPresetSel(m=>{const n={...m};if(preset)n[t]=preset;else delete n[t];return n});
  cancel();setEdit(null);setMenu(null);setTool(t===tool&&t!=='cursor'&&preset===undefined?'cursor':t);
  if(t!=='cursor'){setSelected(null);setTemp(null);const g=TOOL_GROUPS.find(x=>x.tools.includes(t));
   if(g&&last[g.id]!==t){const next={...last,[g.id]:t};setLast(next);try{localStorage.setItem(LAST_KEY,JSON.stringify(next))}catch{}}}
 };
 const openMenu=(group:string,btn:HTMLElement)=>{const r=btn.getBoundingClientRect(),narrow=window.innerWidth<=760;setMenu(m=>m?.group===group?null:{group,x:narrow?r.left:r.right+6,y:narrow?r.bottom+6:r.top})};

 const disabled=!bars.length;
 const toolBtn=(t:Tool,label:string,Icon:Icon,hint?:string)=><button type="button" className={'mc-tool'+(tool===t?' on':'')} aria-pressed={tool===t} aria-label={label} data-tip={label+(hint?' · '+hint:'')} disabled={disabled&&t!=='cursor'} onClick={()=>pickTool(t)}><Icon size={17} strokeWidth={1.8} aria-hidden/></button>;
 const menuGroup=menu?TOOL_GROUPS.find(g=>g.id===menu.group):null;
 const toolbar=<div className="mc-tools" role="toolbar" aria-label="Kreslení v grafu">
  {toolBtn('cursor','Kurzor',MousePointer2,'výběr a posun kreseb')}
  {TOOL_GROUPS.map(g=>{
   const active=g.tools.find(t=>t===tool),shown=active??last[g.id]??g.tools[0],{Icon,hint}=TOOL_META[shown],multi=g.tools.length>1||g.tools.some(t=>presetsOf(t).length>0),pn=presetName(shown);
   return <div key={g.id} className={'mc-group'+(active?' on':'')}>
    <button type="button" className={'mc-tool'+(active?' on':'')} aria-pressed={!!active} aria-label={g.label+': '+DRAW_LABELS[shown]+(pn?' (preset '+pn+')':'')} data-tip={DRAW_LABELS[shown]+(pn?' · preset „'+pn+'“':'')+' · '+hint} disabled={disabled}
     onClick={()=>pickTool(shown)} onKeyDown={e=>{if(multi&&(e.key==='ArrowRight'||e.key==='ArrowDown')){e.preventDefault();openMenu(g.id,e.currentTarget)}}}><Icon size={17} strokeWidth={1.8} aria-hidden/></button>
    {multi&&<button type="button" className="mc-caret" aria-label={'Další nástroje: '+g.label} aria-haspopup="menu" aria-expanded={menu?.group===g.id} disabled={disabled} onClick={e=>openMenu(g.id,e.currentTarget.previousElementSibling as HTMLElement)}/>}
   </div>;
  })}
  <span className="mc-tool-sep" aria-hidden/>
  <button type="button" className={'mc-tool'+(magnet?' on':'')} aria-pressed={magnet} aria-label="Magnet" data-tip={'Magnet · přichytit k O/H/L/C svíčky'+(magnet?' (zapnuto)':'')} onClick={()=>setMagnet(m=>!m)}><Magnet size={17} strokeWidth={1.8} aria-hidden/></button>
  <button type="button" className="mc-tool" aria-label="Zpět" aria-keyshortcuts="Control+Z Meta+Z" data-tip={'Zpět · '+UNDO_KEY} disabled={!canHist.undo} onClick={undo}><Undo2 size={17} strokeWidth={1.8} aria-hidden/></button>
  <button type="button" className="mc-tool" aria-label="Znovu" aria-keyshortcuts="Control+Y Control+Shift+Z Meta+Shift+Z" data-tip={'Znovu · '+REDO_KEY} disabled={!canHist.redo} onClick={redo}><Redo2 size={17} strokeWidth={1.8} aria-hidden/></button>
  <button type="button" className="mc-tool" aria-label="Smazat vše" data-tip="Smazat všechny kresby na trhu" disabled={!drawings.length&&!temp} onClick={clearAll}><Eraser size={17} strokeWidth={1.8} aria-hidden/></button>
  {menu&&menuGroup&&<div ref={menuRef} className="mc-menu" role="menu" aria-label={menuGroup.label} style={{left:menu.x,top:menu.y}}
   onKeyDown={e=>{
    const items=[...(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitemradio]')||[])],i=items.indexOf(document.activeElement as HTMLElement);
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}
    else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();setMenu(null)}
   }}>
   <div className="mc-menu-title">{menuGroup.label}</div>
   {menuGroup.tools.map(t=>{const {Icon,hint}=TOOL_META[t],ps=presetsOf(t),sel=presetSel[t];const cur=tool===t||(!menuGroup.tools.includes(tool as DrawType)&&last[menuGroup.id]===t);return <Fragment key={t}>
    <button type="button" role="menuitemradio" aria-checked={cur&&!sel} className={'mc-menu-item'+(tool===t&&!sel?' on':'')} onClick={()=>pickTool(t,null)}><Icon size={16} strokeWidth={1.8} aria-hidden/><span>{DRAW_LABELS[t]}</span><small>{hint}{prefs.defaults[t]?' · tvůj výchozí vzhled':''}</small></button>
    {ps.map(p=><button key={p.id} type="button" role="menuitemradio" aria-checked={cur&&sel===p.id} aria-label={DRAW_LABELS[t]+' – preset '+p.name} className={'mc-menu-item mc-menu-preset'+(tool===t&&sel===p.id?' on':'')} onClick={()=>pickTool(t,p.id)}><i className="mc-preset-dot" style={{background:swatchBg(p.color)}} aria-hidden/><span>{p.name}</span></button>)}
   </Fragment>})}
  </div>}
 </div>;

 const isTemp=!!current&&temp?.id===current.id,hidden=!!current&&!isTemp&&!visibleOn(current,tf);
 const overlay=<>
  {current&&!edit&&<div className="mc-sel" role="group" aria-label={'Vybraná kresba: '+DRAW_LABELS[current.type]}>
   <span className="mc-sel-name">{DRAW_LABELS[current.type]}{isTemp?' · dočasné':''}{hidden&&<span className="mc-sel-hidden"><EyeOff size={12} aria-hidden/> skryto na {tf}</span>}</span>
   {current.type!=='measure'&&<Swatches value={current.color} onPick={pickColor} label="Barva" custom={prefs.colors} add/>}
   {current.type!=='measure'&&<button type="button" className={'mc-tool sm'+(styleOpen?' on':'')} aria-expanded={styleOpen} aria-controls="mc-style" aria-label="Styl a text kresby" data-tip="Styl, text, viditelnost" onClick={()=>setStyleOpen(o=>!o)}><Settings2 size={15} aria-hidden/></button>}
   {isTemp&&<button type="button" className="mc-chip" onClick={pin}><Pin size={13} aria-hidden/> Připnout</button>}
   <button type="button" className="mc-tool sm danger" aria-label="Smazat kresbu" data-tip="Smazat (Delete)" onClick={()=>remove(current.id)}><Trash2 size={15} aria-hidden/></button>
   {styleOpen&&current.type!=='measure'&&<StylePanel key={current.id+':'+undoVer} d={current} tf={tf} tfList={tfList} onPatch={patch} onStyle={patchStyle} focusRR={rrFocus?.id===current.id?rrFocus.n:0} onFocusedRR={()=>setRrFocus(null)} colors={prefs.colors} presets={presetsOf(current.type)} hasDefault={!!prefs.defaults[current.type]} canSave={prefs.presets.length<MAX_PRESETS||presetsOf(current.type).length>0} prefsOk={prefsState==='ok'||prefsState==='error'} onSavePreset={n=>savePreset(current,n)} onDeletePreset={deletePreset} onApplyPreset={applyPreset} onSetDefault={()=>setDefault(current)} onResetDefault={()=>resetDefault(current.type)}/>}
  </div>}
  {edit&&<TextInput key={edit.id||edit.x+':'+edit.y} edit={edit} onDone={saveText} onCancel={()=>setEdit(null)}/>}
  {tool!=='cursor'&&<div className="mc-draw-hint" role="status">{DRAW_LABELS[tool]}{presetName(tool)?' · preset „'+presetName(tool)+'“':''}: {drawHint(tool)} · Esc zruší</div>}
 </>;
 const status=<>{save!=='idle'&&<span className={'mc-saved'+(save==='error'||save==='loaderror'?' err':'')} role="status">{SAVE_TEXT[save]}{save==='error'&&saveError?': '+saveError:''}</span>}
  {prefsState==='error'&&<span className="mc-saved err" role="status">Presety se nepodařilo uložit</span>}</>;
 return {toolbar,overlay,status,drawing:tool!=='cursor'};
}

// vzorek barvy: vestavěné přes proměnné motivu, vlastní #rrggbb přímo
const swatchBg=(c:DrawColor)=>isHex(c)?c:'var(--mc-c-'+c+')';
const colorName=(c:DrawColor)=>isHex(c)?'vlastní '+c.toUpperCase():COLOR_LABELS[c as NamedColor];
function Swatches({value,onPick,label,custom=[],add=false}:{value:DrawColor;onPick:(c:DrawColor)=>void;label:string;custom?:string[];add?:boolean}){
 const list:DrawColor[]=[...DRAW_COLORS,...custom.filter(isHex)];
 return <span className="mc-swatches" role="group" aria-label={label}>{list.map(c=><button key={c} type="button" className={'mc-swatch-btn'+(value===c?' on':'')} data-c={isHex(c)?undefined:c} style={isHex(c)?{background:c}:undefined} aria-label={label+': '+colorName(c)} aria-pressed={value===c} title={colorName(c)} onClick={()=>onPick(c)}/>)}
  {add&&<a className="mc-swatch-add" href="/nastaveni#barvy" aria-label="Přidat vlastní barvu v Nastavení" title="Vlastní barvy (Nastavení)">+</a>}</span>;
}
function Seg<T extends string|number>({value,options,onPick,label}:{value:T;options:[T,string][];onPick:(v:T)=>void;label:string}){
 return <span className="mc-seg-sm" role="group" aria-label={label}>{options.map(([v,l])=><button key={String(v)} type="button" className={value===v?'on':''} aria-pressed={value===v} onClick={()=>onPick(v)}>{l}</button>)}</span>;
}
// panel stylu vybrané kresby: text/poznámka, čára, průhlednost, výplň, okraj, prodloužení, riziko, viditelnost na TF
type PresetProps={colors:string[];presets:Preset[];hasDefault:boolean;canSave:boolean;prefsOk:boolean;onSavePreset:(name:string)=>void;onDeletePreset:(id:string)=>void;onApplyPreset:(p:Preset)=>void;onSetDefault:()=>void;onResetDefault:()=>void};
function StylePanel({d,tf,tfList:TF_LIST,onPatch,onStyle,focusRR,onFocusedRR,...pp}:{d:Drawing;tf:ChartTf;tfList:readonly ChartTf[];onPatch:(p:Partial<Drawing>,group?:string)=>void;onStyle:(p:Partial<DrawStyle>,group?:string)=>void;focusRR:number;onFocusedRR:()=>void}&PresetProps){
 const st=styleOf(d),caps=capsOf(d.type),isText=d.type==='text',pos=d.type==='long'||d.type==='short'?d.type:null;
 const [text,setText]=useState(d.text||''),[risk,setRisk]=useState(st.risk===null?'':String(st.risk));
 const changeText=(v:string)=>{setText(v);if(isText){if(v.trim())onPatch({text:v.slice(0,MAX_TEXT)},'text')}else onPatch({text:v.trim()?v.slice(0,MAX_TEXT):undefined},'text')};
 const changeRisk=(v:string)=>{setRisk(v);const n=Number(v.replace(',','.'));onStyle({risk:v.trim()&&Number.isFinite(n)&&n>=0&&n<=1e9?n:undefined},'risk')};
 // R:R pozice: zadání přepočítá cíl ze vstupu a stopu; tažení cíle v grafu číslo aktualizuje (pokud se zrovna nepíše)
 const rrNow=pos?rrOf(d.a):0,[rr,setRr]=useState(fmtRR(rrNow)),rrRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(document.activeElement!==rrRef.current)setRr(fmtRR(rrNow))},[rrNow]);
 useEffect(()=>{if(!focusRR)return;rrRef.current?.focus();rrRef.current?.select();onFocusedRR()},[focusRR,onFocusedRR]);
 const changeRR=(v:string,group?:string)=>{setRr(v);const n=Number(v.replace(',','.'));if(pos&&v.trim()&&Number.isFinite(n)&&n>=RR_MIN&&n<=RR_MAX)onPatch({a:withRR(pos,d.a,n)},group)};
 return <div id="mc-style" className="mc-style" role="group" aria-label="Styl kresby" onKeyDown={e=>{if(e.key==='Escape')e.stopPropagation()}}>
  <label className="mc-row mc-row-text"><span>{isText?'Text':'Poznámka'}</span><input type="text" value={text} maxLength={MAX_TEXT} placeholder={isText?'Text kresby…':'Text k nákresu…'} onChange={e=>changeText(e.target.value)}/></label>
  {(isText||text.trim())&&<>
   <div className="mc-row"><span>Umístění</span><Seg label="Umístění textu" value={st.ta} options={[['top','Nahoře'],['middle','Uprostřed'],['bottom','Dole']]} onPick={v=>onStyle({ta:v})}/></div>
   <div className="mc-row"><span>Velikost</span><Seg label="Velikost textu" value={st.ts} options={[['S','S'],['M','M'],['L','L'],['XL','XL']]} onPick={v=>onStyle({ts:v})}/></div>
   <div className="mc-row"><span>Barva textu</span><Swatches value={st.tc} onPick={c=>onStyle({tc:c})} label="Barva textu" custom={pp.colors}/></div>
  </>}
  {caps.line&&<div className="mc-row"><span>Čára</span><Seg label="Tloušťka čáry" value={st.lw} options={[[1,'S'],[2,'M'],[3,'L'],[4,'XL']]} onPick={v=>onStyle({lw:v})}/><Seg label="Styl čáry" value={st.ls} options={[['solid','Plná'],['dashed','Čárky'],['dotted','Tečky']]} onPick={v=>onStyle({ls:v})}/></div>}
  <label className="mc-row"><span>Průhlednost</span><input type="range" min={10} max={100} step={5} value={Math.round(st.op*100)} aria-valuetext={Math.round(st.op*100)+' %'} onChange={e=>onStyle({op:Number(e.target.value)/100},'op')}/><em>{Math.round(st.op*100)} %</em></label>
  {(caps.fill||caps.border)&&<div className="mc-row">
   {caps.fill&&<label className="mc-check"><input type="checkbox" checked={st.fill} onChange={e=>onStyle({fill:e.target.checked})}/>Pozadí</label>}
   {caps.border&&<label className="mc-check"><input type="checkbox" checked={st.border} onChange={e=>onStyle({border:e.target.checked})}/>Okraj</label>}
   {caps.border&&st.border&&<Swatches value={st.bc} onPick={c=>onStyle({bc:c})} label="Barva okraje" custom={pp.colors}/>}
  </div>}
  {caps.extend&&<div className="mc-row"><span>Prodloužit</span>
   <label className="mc-check"><input type="checkbox" checked={st.extL} onChange={e=>onStyle({extL:e.target.checked})}/>Doleva</label>
   <label className="mc-check"><input type="checkbox" checked={st.extR} onChange={e=>onStyle({extR:e.target.checked})}/>Doprava</label>
  </div>}
  {pos&&<div className="mc-row"><label className="mc-row-label" htmlFor="mc-rr">R:R</label>
   <input id="mc-rr" ref={rrRef} type="number" inputMode="decimal" min={RR_MIN} max={RR_MAX} step={0.1} value={rr} aria-describedby="mc-rr-hint" onChange={e=>changeRR(e.target.value,'rr')} onBlur={()=>setRr(fmtRR(rrOf(d.a)))}/>
   <span className="mc-seg-sm" role="group" aria-label="Rychlá volba R:R">{RR_CHIPS.map(v=><button key={v} type="button" className={Math.abs(rrNow-v)<.005?'on':''} aria-pressed={Math.abs(rrNow-v)<.005} onClick={()=>changeRR(String(v))}>{v.toLocaleString('cs-CZ')}</button>)}</span>
   <small id="mc-rr-hint" className="mc-hint">cíl se přepočítá ze vstupu a stopu ({RR_MIN.toLocaleString('cs-CZ')}–{RR_MAX})</small>
  </div>}
  {caps.risk&&<label className="mc-row"><span>Riziko</span><input type="text" inputMode="decimal" value={risk} placeholder="částka (volitelné)" onChange={e=>changeRisk(e.target.value)}/></label>}
  <div className="mc-row" role="group" aria-label="Viditelnost na časových rámcích"><span>Vidět na</span>
   {TF_LIST.map(t=>{const on=visibleOn(d,t),only=on&&(d.tfs?.length===1||TF_LIST.length===1);return <label key={t} className={'mc-check'+(t===tf?' cur':'')}><input type="checkbox" checked={on} disabled={only} title={only?'Aspoň jeden časový rámec':undefined} onChange={()=>onPatch({tfs:toggleTf(d.tfs,t,TF_LIST)})}/>{t}</label>})}
  </div>
  <PresetRow d={d} {...pp}/>
 </div>;
}
// presety v panelu stylu: použít / smazat preset nástroje, uložit vzhled jako preset, nastavit nebo obnovit výchozí vzhled nástroje
function PresetRow({d,presets,hasDefault,canSave,prefsOk,onSavePreset,onDeletePreset,onApplyPreset,onSetDefault,onResetDefault}:{d:Drawing}&PresetProps){
 const [naming,setNaming]=useState(false),[name,setName]=useState(''),[note,setNote]=useState('');
 const tool=DRAW_LABELS[d.type].toLowerCase(),inputRef=useRef<HTMLInputElement>(null),openRef=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(naming)inputRef.current?.focus()},[naming]);
 const done=(msg:string)=>{setNote(msg);setTimeout(()=>setNote(''),2500)};
 const submit=()=>{const n=name.trim();if(!n)return;onSavePreset(n);setNaming(false);setName('');done(presets.some(p=>p.name.toLowerCase()===n.toLowerCase())?'Preset přepsán':'Preset uložen');setTimeout(()=>openRef.current?.focus())};
 const close=()=>{setNaming(false);setName('');setTimeout(()=>openRef.current?.focus())};
 return <>
  {presets.length>0&&<div className="mc-row" role="group" aria-label="Presety nástroje"><span>Presety</span>
   {presets.map(p=><span key={p.id} className="mc-preset"><button type="button" title={'Použít preset na tuto kresbu'} onClick={()=>{onApplyPreset(p)}}><i className="mc-preset-dot" style={{background:swatchBg(p.color)}} aria-hidden/>{p.name}</button><button type="button" className="mc-preset-x" aria-label={'Smazat preset '+p.name} title="Smazat preset" onClick={()=>onDeletePreset(p.id)}>×</button></span>)}
  </div>}
  <div className="mc-row mc-row-actions">
   {naming?<span className="mc-preset-name" role="group" aria-label="Název nového presetu">
     <input ref={inputRef} type="text" value={name} maxLength={MAX_PRESET_NAME} placeholder="Název presetu, např. Strong high" aria-label="Název presetu" onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();submit()}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}}}/>
     <button type="button" className="mc-chip" disabled={!name.trim()} onClick={submit}>Uložit</button>
     <button type="button" className="mc-chip" onClick={close}>Zrušit</button>
    </span>
    :<button ref={openRef} type="button" className="mc-chip" disabled={!canSave} title={canSave?'Uloží barvu, styl, text a viditelnost jako pojmenovaný preset':`Nejvýš ${MAX_PRESETS} presetů`} onClick={()=>setNaming(true)}>Uložit jako preset…</button>}
   <button type="button" className="mc-chip" title={'Každá nová kresba nástroje '+tool+' dostane tento vzhled'} onClick={()=>{onSetDefault();done('Nastaveno jako výchozí')}}>Nastavit jako výchozí pro {tool}</button>
   {hasDefault&&<button type="button" className="mc-chip" title={'Nové kresby nástroje '+tool+' budou mít původní vzhled'} onClick={()=>{onResetDefault();done('Výchozí vzhled obnoven')}}>Obnovit výchozí</button>}
   <span className="mc-note" role="status" aria-live="polite">{note||(!prefsOk?'Presety se nepodařilo načíst – změny platí jen do obnovení stránky.':'')}</span>
  </div>
 </>;
}

function TextInput({edit,onDone,onCancel}:{edit:Edit;onDone:(v:string)=>void;onCancel:()=>void}){
 const [v,setV]=useState(edit.text),done=useRef(false);
 const end=(ok:boolean)=>{if(done.current)return;done.current=true;if(ok)onDone(v);else onCancel()};
 return <input className="mc-text-input" style={{left:edit.x,top:edit.y}} autoFocus maxLength={MAX_TEXT} value={v} placeholder="Text kresby…" aria-label="Text kresby"
  onChange={e=>setV(e.target.value)} onBlur={()=>end(true)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();end(true)}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();end(false)}}}/>;
}
