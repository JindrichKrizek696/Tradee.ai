'use client';
// Kreslení v grafu trhu: nástroje ve skupinách, výběr a tažení kreseb, panel stylu, ukládání per uživatel × trh (/api/chart/drawings).
import {useEffect,useLayoutEffect,useMemo,useRef,useState,type RefObject} from 'react';
import type {IChartApi,ISeriesApi,Logical,SeriesType} from 'lightweight-charts';
import {MousePointer2,TrendingUp,Minus,RectangleHorizontal,AlignVerticalDistributeCenter,Type,Ruler,Magnet,Eraser,Trash2,MoveUpRight,MoveRight,ArrowRightToLine,Waypoints,Brush,Equal,SquareArrowUp,SquareArrowDown,MoveVertical,MoveHorizontal,Pin,Settings2,EyeOff,GitFork,Grid3x3,Rows4} from 'lucide-react';
import {chartTime} from '@/lib/journal/chart-data';
import {TF_SEC,type ChartTf} from '@/lib/chart/layers';
import {COLOR_LABELS,DRAW_COLORS,DRAW_LABELS,MAX_DRAWINGS,MAX_PATH,MAX_TEXT,capsOf,firstTouch,fromChartTime,logicalOf,measure,measureLines,moveHandle,newId,parseDrawings,pipSize,positionFrom,priceRangeLine,simplifyMax,snapPrice,styleOf,timeOfLogical,timeRangeLine,toggleTf,translate,visibleOn,type Anchor,type DrawColor,type DrawStyle,type DrawType,type Drawing,type Pt} from '@/lib/chart/drawings';
import {DrawingsPrimitive,type DrawPalette} from './chart-drawings';
import {fmtPrice} from './live';

export type Tool='cursor'|DrawType;
type Bar={time:number;open:number;high:number;low:number;close:number};
type Save='idle'|'saving'|'saved'|'error'|'loaderror';
type Drag={id:string;temp:boolean;part:'body'|'handle';index:number;start:{l:number;p:number};orig:Drawing;cur:Drawing|null;x:number;y:number};
// rozkreslená kresba: pevné body + poslední bod, který sleduje kurzor; štětec sbírá body tahu
type Draft={id:string;type:DrawType;color:DrawColor;pts:Anchor[];fixed:number;need:number;x:number;y:number;placed:boolean;lastDown:number;px?:Pt[]};
type Edit={x:number;y:number;anchor:Anchor;id?:string;text:string};
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
const editable=(t:EventTarget|null)=>t instanceof HTMLElement&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const touchLabel=(sec:number,tf:ChartTf)=>new Date(sec*1000).toLocaleString('cs-CZ',{timeZone:'UTC',day:'numeric',month:'numeric',...(tf==='D1'?{year:'numeric'}:{hour:'2-digit',minute:'2-digit'}) as Intl.DateTimeFormatOptions});

export function useChartDrawings({chart,series,ver,el,bars,tf,tfList,instrument,tick}:{chart:RefObject<IChartApi|null>;series:RefObject<ISeriesApi<SeriesType>|null>;ver:number;el:RefObject<HTMLDivElement|null>;bars:Bar[];tf:ChartTf;tfList:readonly ChartTf[];instrument:string;tick:number}){
 const [tool,setTool]=useState<Tool>('cursor');
 const [drawings,setDrawings]=useState<Drawing[]>([]),[temp,setTemp]=useState<Drawing|null>(null),[selected,setSelected]=useState<string|null>(null);
 const [magnet,setMagnet]=useState(false),[color,setColor]=useState<DrawColor>('brand');
 const [edit,setEdit]=useState<Edit|null>(null),[save,setSave]=useState<Save>('idle'),[saveError,setSaveError]=useState('');
 const [styleOpen,setStyleOpen]=useState(false);
 const [last,setLast]=useState<Record<string,DrawType>>(()=>Object.fromEntries(TOOL_GROUPS.map(g=>[g.id,g.tools[0]])));
 const [menu,setMenu]=useState<{group:string;x:number;y:number}|null>(null);
 // aktuální stav pro handlery myši (registrují se jednou)
 const S=useRef({tool,drawings,temp,selected,magnet,color,bars,times:[] as number[],tf,instrument});
 const times=useMemo(()=>bars.map(b=>b.time),[bars]);
 useLayoutEffect(()=>{S.current={tool,drawings,temp,selected,magnet,color,bars,times,tf,instrument}});
 const draft=useRef<Draft|null>(null),drag=useRef<Drag|null>(null);
 const dirty=useRef(false),loaded=useRef<string|null>(null),pending=useRef<{instrument:string;drawings:Drawing[]}|null>(null);
 const menuRef=useRef<HTMLDivElement>(null);

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

 const commit=(next:Drawing[])=>{dirty.current=true;setDrawings(next)};
 const build=(dr:Draft):Drawing=>({id:dr.id,type:dr.type,color:dr.color,a:(dr.type==='long'||dr.type==='short')?positionFrom(dr.type,dr.pts[0],dr.pts[1]??dr.pts[0]):dr.pts});
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
  // další bod rozkreslené kresby (klik nebo puštění po tahu)
  const advance=(dr:Draft,p:Pt)=>{
   const a=anchorAt(p);if(!a)return;
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
    dr.lastDown=now;advance(dr,p);return;
   }
   if(st.tool!=='cursor'){
    stop(e);const a=st.tool==='brush'?freeAt(p):anchorAt(p);if(!a)return;
    if(ONE_CLICK.has(st.tool)){finish({id:newId(),type:st.tool,a:[a],color:st.color});return}
    if(st.tool==='text'){setTool('cursor');setEdit({x:p.x,y:p.y,anchor:a,text:''});return}
    const d:Draft={id:newId(),type:st.tool,color:st.color,pts:st.tool==='brush'?[a]:[a,a],fixed:1,need:needOf(st.tool),x:p.x,y:p.y,placed:false,lastDown:Date.now(),px:st.tool==='brush'?[p]:undefined};
    draft.current=d;render(d);return;
   }
   const h=prim.hit(p,touch?14:6);
   if(h){
    stop(e);const isTemp=st.temp?.id===h.id,orig=isTemp?st.temp:st.drawings.find(d=>d.id===h.id);const r=raw(p);
    if(!orig||!r)return;
    if(st.selected!==h.id)setSelected(h.id);
    drag.current={id:h.id,temp:isTemp,part:h.hit.part,index:h.hit.part==='handle'?h.hit.index:0,start:r,orig,cur:null,x:p.x,y:p.y};
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
    const a=anchorAt(p);if(!a)return;dr.pts[dr.pts.length-1]=a;if(Math.hypot(p.x-dr.x,p.y-dr.y)>3)dr.placed=true;render(dr);return;
   }
   const g=drag.current;if(!g)return;
   if('touches' in e&&e.cancelable)e.preventDefault();
   if(!g.cur&&Math.hypot(p.x-g.x,p.y-g.y)<3)return;
   let next:Drawing|null=null;
   if(g.part==='handle'){const a=anchorAt(p);if(a)next=moveHandle(g.orig,g.index,a)}
   else{const r=raw(p);if(r)next=translate(g.orig,Math.round(r.l-g.start.l),r.p-g.start.p,conv.toL,t=>Math.round(conv.fromL(t)))}
   if(!next)return;g.cur=next;
   const pr=prim;
   if(g.temp)pr.temp=next;else pr.drawings=S.current.drawings.map(d=>d.id===g.id?next:d);
   pr.update();
  }
  function up(e:MouseEvent|TouchEvent){
   const dr=draft.current;
   // štětec končí puštěním; u ostatních tah (stisk–táhnout–pustit) přidá bod, klik nechá čekat na další
   if(dr){if(dr.type==='brush')finishBrush();else if(dr.placed){const p=point(e);if(p)advance(dr,p)}return}
   const g=drag.current;if(!g)return;drag.current=null;
   if(g.cur){if(g.temp)setTemp(g.cur);else commit(S.current.drawings.map(d=>d.id===g.id?g.cur!:d))}
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
  const ac=new AbortController();loaded.current=null;dirty.current=false;
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

 // úpravy vybrané kresby
 const current=selected?(temp?.id===selected?temp:drawings.find(d=>d.id===selected))??null:null;
 const patch=(p:Partial<Drawing>)=>{if(!current)return;const next={...current,...p};for(const k of Object.keys(next))if((next as Record<string,unknown>)[k]===undefined)delete (next as Record<string,unknown>)[k];if(temp?.id===current.id)setTemp(next);else commit(drawings.map(d=>d.id===current.id?next:d))};
 const patchStyle=(p:Partial<DrawStyle>)=>{if(!current)return;const s:DrawStyle={...current.s,...p};for(const k of Object.keys(s))if((s as Record<string,unknown>)[k]===undefined)delete (s as Record<string,unknown>)[k];patch({s:Object.keys(s).length?s:undefined})};
 const pickColor=(c:DrawColor)=>{setColor(c);patch({color:c})};
 const pin=()=>{if(!temp)return;if(drawings.length>=MAX_DRAWINGS){setSave('error');setSaveError(`Na jednom trhu může být nejvýš ${MAX_DRAWINGS} kreseb.`);return}commit([...drawings,temp]);setTemp(null)};
 const saveText=(text:string)=>{
  const e=edit;setEdit(null);if(!e)return;const v=text.trim().slice(0,MAX_TEXT);
  if(e.id){if(v)commit(drawings.map(d=>d.id===e.id?{...d,text:v}:d));return}
  if(!v)return;if(drawings.length>=MAX_DRAWINGS){setSave('error');setSaveError(`Na jednom trhu může být nejvýš ${MAX_DRAWINGS} kreseb.`);return}
  const d:Drawing={id:newId(),type:'text',a:[e.anchor],color,text:v};commit([...drawings,d]);setSelected(d.id);
 };
 const clearAll=()=>{if(!drawings.length&&!temp)return;if(!window.confirm(`Smazat všechny kresby na tomto trhu (${drawings.length})? Tuto akci nelze vrátit.`))return;setTemp(null);setSelected(null);commit([])};
 const pickTool=(t:Tool)=>{
  cancel();setEdit(null);setMenu(null);setTool(t===tool&&t!=='cursor'?'cursor':t);
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
   const active=g.tools.find(t=>t===tool),shown=active??last[g.id]??g.tools[0],{Icon,hint}=TOOL_META[shown],multi=g.tools.length>1;
   return <div key={g.id} className={'mc-group'+(active?' on':'')}>
    <button type="button" className={'mc-tool'+(active?' on':'')} aria-pressed={!!active} aria-label={g.label+': '+DRAW_LABELS[shown]} data-tip={DRAW_LABELS[shown]+' · '+hint} disabled={disabled}
     onClick={()=>pickTool(shown)} onKeyDown={e=>{if(multi&&(e.key==='ArrowRight'||e.key==='ArrowDown')){e.preventDefault();openMenu(g.id,e.currentTarget)}}}><Icon size={17} strokeWidth={1.8} aria-hidden/></button>
    {multi&&<button type="button" className="mc-caret" aria-label={'Další nástroje: '+g.label} aria-haspopup="menu" aria-expanded={menu?.group===g.id} disabled={disabled} onClick={e=>openMenu(g.id,e.currentTarget.previousElementSibling as HTMLElement)}/>}
   </div>;
  })}
  <span className="mc-tool-sep" aria-hidden/>
  <button type="button" className={'mc-tool'+(magnet?' on':'')} aria-pressed={magnet} aria-label="Magnet" data-tip={'Magnet · přichytit k O/H/L/C svíčky'+(magnet?' (zapnuto)':'')} onClick={()=>setMagnet(m=>!m)}><Magnet size={17} strokeWidth={1.8} aria-hidden/></button>
  <button type="button" className="mc-tool" aria-label="Smazat vše" data-tip="Smazat všechny kresby na trhu" disabled={!drawings.length&&!temp} onClick={clearAll}><Eraser size={17} strokeWidth={1.8} aria-hidden/></button>
  {menu&&menuGroup&&<div ref={menuRef} className="mc-menu" role="menu" aria-label={menuGroup.label} style={{left:menu.x,top:menu.y}}
   onKeyDown={e=>{
    const items=[...(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitemradio]')||[])],i=items.indexOf(document.activeElement as HTMLElement);
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}
    else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();setMenu(null)}
   }}>
   <div className="mc-menu-title">{menuGroup.label}</div>
   {menuGroup.tools.map(t=>{const {Icon,hint}=TOOL_META[t];return <button key={t} type="button" role="menuitemradio" aria-checked={tool===t||(!menuGroup.tools.includes(tool as DrawType)&&last[menuGroup.id]===t)} className={'mc-menu-item'+(tool===t?' on':'')} onClick={()=>pickTool(t)}><Icon size={16} strokeWidth={1.8} aria-hidden/><span>{DRAW_LABELS[t]}</span><small>{hint}</small></button>})}
  </div>}
 </div>;

 const isTemp=!!current&&temp?.id===current.id,hidden=!!current&&!isTemp&&!visibleOn(current,tf);
 const overlay=<>
  {current&&!edit&&<div className="mc-sel" role="group" aria-label={'Vybraná kresba: '+DRAW_LABELS[current.type]}>
   <span className="mc-sel-name">{DRAW_LABELS[current.type]}{isTemp?' · dočasné':''}{hidden&&<span className="mc-sel-hidden"><EyeOff size={12} aria-hidden/> skryto na {tf}</span>}</span>
   {current.type!=='measure'&&<Swatches value={current.color} onPick={pickColor} label="Barva"/>}
   {current.type!=='measure'&&<button type="button" className={'mc-tool sm'+(styleOpen?' on':'')} aria-expanded={styleOpen} aria-controls="mc-style" aria-label="Styl a text kresby" data-tip="Styl, text, viditelnost" onClick={()=>setStyleOpen(o=>!o)}><Settings2 size={15} aria-hidden/></button>}
   {isTemp&&<button type="button" className="mc-chip" onClick={pin}><Pin size={13} aria-hidden/> Připnout</button>}
   <button type="button" className="mc-tool sm danger" aria-label="Smazat kresbu" data-tip="Smazat (Delete)" onClick={()=>remove(current.id)}><Trash2 size={15} aria-hidden/></button>
   {styleOpen&&current.type!=='measure'&&<StylePanel key={current.id} d={current} tf={tf} tfList={tfList} onPatch={patch} onStyle={patchStyle}/>}
  </div>}
  {edit&&<TextInput key={edit.id||edit.x+':'+edit.y} edit={edit} onDone={saveText} onCancel={()=>setEdit(null)}/>}
  {tool!=='cursor'&&<div className="mc-draw-hint" role="status">{DRAW_LABELS[tool]}: {drawHint(tool)} · Esc zruší</div>}
 </>;
 const status=save!=='idle'?<span className={'mc-saved'+(save==='error'||save==='loaderror'?' err':'')} role="status">{SAVE_TEXT[save]}{save==='error'&&saveError?': '+saveError:''}</span>:null;
 return {toolbar,overlay,status,drawing:tool!=='cursor'};
}

function Swatches({value,onPick,label}:{value:DrawColor;onPick:(c:DrawColor)=>void;label:string}){
 return <span className="mc-swatches" role="group" aria-label={label}>{DRAW_COLORS.map(c=><button key={c} type="button" className={'mc-swatch-btn'+(value===c?' on':'')} data-c={c} aria-label={label+': '+COLOR_LABELS[c]} aria-pressed={value===c} title={COLOR_LABELS[c]} onClick={()=>onPick(c)}/>)}</span>;
}
function Seg<T extends string|number>({value,options,onPick,label}:{value:T;options:[T,string][];onPick:(v:T)=>void;label:string}){
 return <span className="mc-seg-sm" role="group" aria-label={label}>{options.map(([v,l])=><button key={String(v)} type="button" className={value===v?'on':''} aria-pressed={value===v} onClick={()=>onPick(v)}>{l}</button>)}</span>;
}
// panel stylu vybrané kresby: text/poznámka, čára, průhlednost, výplň, okraj, prodloužení, riziko, viditelnost na TF
function StylePanel({d,tf,tfList:TF_LIST,onPatch,onStyle}:{d:Drawing;tf:ChartTf;tfList:readonly ChartTf[];onPatch:(p:Partial<Drawing>)=>void;onStyle:(p:Partial<DrawStyle>)=>void}){
 const st=styleOf(d),caps=capsOf(d.type),isText=d.type==='text';
 const [text,setText]=useState(d.text||''),[risk,setRisk]=useState(st.risk===null?'':String(st.risk));
 const changeText=(v:string)=>{setText(v);if(isText){if(v.trim())onPatch({text:v.slice(0,MAX_TEXT)})}else onPatch({text:v.trim()?v.slice(0,MAX_TEXT):undefined})};
 const changeRisk=(v:string)=>{setRisk(v);const n=Number(v.replace(',','.'));onStyle({risk:v.trim()&&Number.isFinite(n)&&n>=0&&n<=1e9?n:undefined})};
 return <div id="mc-style" className="mc-style" role="group" aria-label="Styl kresby" onKeyDown={e=>{if(e.key==='Escape')e.stopPropagation()}}>
  <label className="mc-row mc-row-text"><span>{isText?'Text':'Poznámka'}</span><input type="text" value={text} maxLength={MAX_TEXT} placeholder={isText?'Text kresby…':'Text k nákresu…'} onChange={e=>changeText(e.target.value)}/></label>
  {(isText||text.trim())&&<>
   <div className="mc-row"><span>Umístění</span><Seg label="Umístění textu" value={st.ta} options={[['top','Nahoře'],['middle','Uprostřed'],['bottom','Dole']]} onPick={v=>onStyle({ta:v})}/></div>
   <div className="mc-row"><span>Velikost</span><Seg label="Velikost textu" value={st.ts} options={[['S','S'],['M','M'],['L','L']]} onPick={v=>onStyle({ts:v})}/></div>
   <div className="mc-row"><span>Barva textu</span><Swatches value={st.tc} onPick={c=>onStyle({tc:c})} label="Barva textu"/></div>
  </>}
  {caps.line&&<div className="mc-row"><span>Čára</span><Seg label="Tloušťka čáry" value={st.lw} options={[[1,'1'],[2,'2'],[3,'3']]} onPick={v=>onStyle({lw:v})}/><Seg label="Styl čáry" value={st.ls} options={[['solid','Plná'],['dashed','Čárky'],['dotted','Tečky']]} onPick={v=>onStyle({ls:v})}/></div>}
  <label className="mc-row"><span>Průhlednost</span><input type="range" min={10} max={100} step={5} value={Math.round(st.op*100)} aria-valuetext={Math.round(st.op*100)+' %'} onChange={e=>onStyle({op:Number(e.target.value)/100})}/><em>{Math.round(st.op*100)} %</em></label>
  {(caps.fill||caps.border)&&<div className="mc-row">
   {caps.fill&&<label className="mc-check"><input type="checkbox" checked={st.fill} onChange={e=>onStyle({fill:e.target.checked})}/>Pozadí</label>}
   {caps.border&&<label className="mc-check"><input type="checkbox" checked={st.border} onChange={e=>onStyle({border:e.target.checked})}/>Okraj</label>}
   {caps.border&&st.border&&<Swatches value={st.bc} onPick={c=>onStyle({bc:c})} label="Barva okraje"/>}
  </div>}
  {caps.extend&&<div className="mc-row"><span>Prodloužit</span>
   <label className="mc-check"><input type="checkbox" checked={st.extL} onChange={e=>onStyle({extL:e.target.checked})}/>Doleva</label>
   <label className="mc-check"><input type="checkbox" checked={st.extR} onChange={e=>onStyle({extR:e.target.checked})}/>Doprava</label>
  </div>}
  {caps.risk&&<label className="mc-row"><span>Riziko</span><input type="text" inputMode="decimal" value={risk} placeholder="částka (volitelné)" onChange={e=>changeRisk(e.target.value)}/></label>}
  <div className="mc-row" role="group" aria-label="Viditelnost na časových rámcích"><span>Vidět na</span>
   {TF_LIST.map(t=>{const on=visibleOn(d,t),only=on&&(d.tfs?.length===1||TF_LIST.length===1);return <label key={t} className={'mc-check'+(t===tf?' cur':'')}><input type="checkbox" checked={on} disabled={only} title={only?'Aspoň jeden časový rámec':undefined} onChange={()=>onPatch({tfs:toggleTf(d.tfs,t,TF_LIST)})}/>{t}</label>})}
  </div>
 </div>;
}

function TextInput({edit,onDone,onCancel}:{edit:Edit;onDone:(v:string)=>void;onCancel:()=>void}){
 const [v,setV]=useState(edit.text),done=useRef(false);
 const end=(ok:boolean)=>{if(done.current)return;done.current=true;if(ok)onDone(v);else onCancel()};
 return <input className="mc-text-input" style={{left:edit.x,top:edit.y}} autoFocus maxLength={MAX_TEXT} value={v} placeholder="Text kresby…" aria-label="Text kresby"
  onChange={e=>setV(e.target.value)} onBlur={()=>end(true)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();end(true)}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();end(false)}}}/>;
}
