'use client';
// Kreslení v grafu trhu: nástroje ve skupinách, výběr a tažení kreseb, panel stylu, ukládání per uživatel × trh (/api/chart/drawings).
import {Fragment,useEffect,useLayoutEffect,useMemo,useRef,useState,type RefObject} from 'react';
import type {IChartApi,ISeriesApi,Logical,SeriesType} from 'lightweight-charts';
import {MousePointer2,TrendingUp,Minus,RectangleHorizontal,AlignVerticalDistributeCenter,Type,Ruler,Magnet,Eraser,Trash2,MoveUpRight,MoveRight,ArrowRightToLine,Waypoints,Brush,Equal,SquareArrowUp,SquareArrowDown,MoveVertical,MoveHorizontal,Pin,Settings2,EyeOff,GitFork,Grid3x3,Rows4,Undo2,Redo2,Star,GripVertical,ChartBarDecreasing,Lock,LockOpen,Eye,X,SquareStack,EqualApproximately,ScanLine,Zap,Copy,Archive,ArchiveRestore,BellPlus,ClipboardList,BringToFront,SendToBack} from 'lucide-react';
import {chartTime} from '@/lib/journal/chart-data';
import {TF_SEC,type ChartTf} from '@/lib/chart/layers';
import {COLOR_LABELS,DRAW_COLORS,DRAW_LABELS,MAX_DRAWINGS,MAX_FIB_LEVELS,defaultLevels,sameLevels,nextLevel,levelInput,numInput,fibLabel,arrowEnds,arrowOf,shiftMode,lockDir,lockAnchor,toggleFav,favFrac,favStep,type FibLevel,type FullStyle,RR_MAX,RR_MIN,isHex,type NamedColor,applyLook,emptyHistory,emptyPrefs,lookOf,parsePrefs,record,redoStep,rrOf,undoStep,withRR,MAX_PRESETS,MAX_PRESET_NAME,type DrawPrefs,type History,type Look,type Preset,createdOf,MAX_PATH,MAX_TEXT,capsOf,firstTouch,fromChartTime,logicalOf,measure,measureLines,moveHandle,moveEdge,type Edge,newId,parseDrawings,pipSize,positionFrom,priceRangeLine,simplifyMax,snapPrice,styleOf,timeOfLogical,timeRangeLine,toggleTf,translate,visibleOn,BUILTIN_PRESETS,isBuiltin,bulk,duplicateOf,eqLabel,layerOf,LAYERS,MANUAL_TYPES,MANUAL_NOTE,type Bulk,type Anchor,type DrawColor,type DrawStyle,type DrawType,type Drawing,type Pt} from '@/lib/chart/drawings';
import {DrawingsPrimitive,type DrawPalette} from './chart-drawings';
import {evalZone,zoneEdges,zoneKindFor,stateText,htfLabel,htfVisible,nestZones,zoneScenario,zoneAlert,ZONE_RULES,ZONE_STATES,ZONE_KINDS,type ZoneEval,type ZoneMeta,type ZoneRule} from '@/lib/chart/zones';
import {volumeProfile,barsBetween,type Profile} from '@/lib/chart/volume-profile';
import {TFS} from '@/lib/chart/candles';
import {fmtPrice} from './live';
import {useRisk,useProfilePref} from './risk/risk-context';
import {chartSizing,SizingRow} from './risk/chart-sizing';

export type Tool='cursor'|DrawType;
type Bar={time:number;open:number;high:number;low:number;close:number;volume?:number};
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
 zone:{Icon:SquareStack,hint:'2 rohy zóny, druh podle polohy vůči ceně'},eqhl:{Icon:EqualApproximately,hint:'2 vrcholy nebo dna · ruční značka'},fvg:{Icon:ScanLine,hint:'2 rohy mezery · ruční značka'},mss:{Icon:Zap,hint:'úroveň a svíčka prolomení · ruční značka'},
 measure:{Icon:Ruler,hint:'2 body, neukládá se'},vprofile:{Icon:ChartBarDecreasing,hint:'začátek a konec rozsahu'},prange:{Icon:MoveVertical,hint:'2 body'},trange:{Icon:MoveHorizontal,hint:'2 body'},text:{Icon:Type,hint:'1 bod'},
};
export const TOOL_GROUPS:{id:string;label:string;tools:DrawType[]}[]=[
 {id:'lines',label:'Čáry',tools:['trend','ray','hline','hray','touch','path']},
 {id:'channels',label:'Kanály a vidle',tools:['channel','pitchfork']},
 {id:'fib',label:'Fibonacci a Gann',tools:['fib','fibext','gann']},
 {id:'zones',label:'Zóny',tools:['zone']},
 {id:'liq',label:'Likvidita (ruční značky)',tools:['eqhl','fvg','mss']},
 {id:'shapes',label:'Tvary',tools:['rect','brush']},
 {id:'pos',label:'Pozice',tools:['long','short']},
 {id:'measure',label:'Měření',tools:['measure','prange','trange']},
 {id:'volume',label:'Objem',tools:['vprofile']},
 {id:'text',label:'Text',tools:['text']},
];
const LAST_KEY='tradee.chart.tools';
const ONE_CLICK=new Set<DrawType>(['hline','hray','touch']);
const needOf=(t:DrawType)=>t==='path'?MAX_PATH:t==='channel'||t==='fibext'||t==='pitchfork'?3:2;
const drawHint=(t:DrawType)=>ONE_CLICK.has(t)||t==='text'?'klikni do grafu':t==='brush'?'kresli tahem myši nebo prstu':t==='path'?'klikej body, dvojklik nebo Enter dokončí':t==='channel'?'klikni dva body čáry a třetí pro šířku kanálu':t==='fibext'?'klikni začátek a konec impulsu a pak bod korekce':t==='pitchfork'?'klikni počátek a pak dva vrcholy (horní a dolní)':t==='gann'?'klikni dva protilehlé rohy (nebo táhni)':t==='long'||t==='short'?'klikni vstup a pak stop-loss (nebo táhni), cíl se nastaví na R:R 2':t==='vprofile'?'klikni začátek a konec časového rozsahu (nebo táhni)':t==='zone'?'klikni dva rohy zóny (báze); pod cenou poptávka, nad cenou nabídka':t==='mss'?'klikni prolomenou úroveň a pak svíčku prolomení · '+MANUAL_NOTE:t==='eqhl'||t==='fvg'?'klikni dva body · '+MANUAL_NOTE:'klikni na dva body (nebo táhni)';
const SAVE_TEXT:Record<Exclude<Save,'idle'>,string>={saving:'Ukládám kresby…',saved:'Uloženo',error:'Kresby se nepodařilo uložit',loaderror:'Kresby se nepodařilo načíst'};
const css=(name:string,fallback:string)=>getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback;
// barvu z CSS (i color-mix, var) převést na #rrggbb / rgba() přes plátno, aby šla průhlednost
let probe:CanvasRenderingContext2D|null=null;
function norm(c:string,fallback:string){try{probe??=document.createElement('canvas').getContext('2d');if(!probe)return c;probe.fillStyle=fallback;probe.fillStyle=c;return String(probe.fillStyle)}catch{return c}}
const MAC=typeof navigator!=='undefined'&&/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent);
const UNDO_KEY=MAC?'⌘Z':'Ctrl+Z',REDO_KEY=MAC?'⇧⌘Z':'Ctrl+Y';
const RR_CHIPS=[1,1.5,2,3],MID_CHIPS=[.25,.5,.75];
const fmtRR=(v:number)=>String(Math.round(v*100)/100);
const editable=(t:EventTarget|null)=>t instanceof HTMLElement&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const VP_CACHE=new WeakMap<object,Map<string,Profile|null>>();
const created=(id:string)=>{const t=createdOf(id);return t===null?'':new Date(t).toLocaleString('cs-CZ',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})};
const touchLabel=(sec:number,tf:ChartTf)=>new Date(sec*1000).toLocaleString('cs-CZ',{timeZone:'UTC',day:'numeric',month:'numeric',...(tf==='D1'||tf==='W1'||tf==='MN'?{year:'numeric'}:{hour:'2-digit',minute:'2-digit'}) as Intl.DateTimeFormatOptions});

// treeOpen / onTreeClose / treeExtra = panel Objekty v grafu (strom objektů); treeExtra = sekce indikátorů z grafu
// htf = zóny vyššího TF na nižším TF; name = název trhu (seznam objektů); onDrawings = aktuální kresby trhu nahoru (snímek při zavření záložky)
export function useChartDrawings({chart,series,ver,el,bars,tf,tfList,instrument,tick,treeOpen=false,onTreeClose,treeExtra,htf=true,name,onDrawings}:{chart:RefObject<IChartApi|null>;series:RefObject<ISeriesApi<SeriesType>|null>;ver:number;el:RefObject<HTMLDivElement|null>;bars:Bar[];tf:ChartTf;tfList:readonly ChartTf[];instrument:string;tick:number;treeOpen?:boolean;onTreeClose?:()=>void;treeExtra?:React.ReactNode;htf?:boolean;name?:string;onDrawings?:(instrument:string,list:Drawing[])=>void}){
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
 const times=useMemo(()=>bars.map(b=>b.time),[bars]);
 // zóny: stav z ceny (svíčky aktuálního TF, čas UTC) a vnoření do zón vyššího TF
 const zbars=useMemo(()=>bars.map(b=>({t:fromChartTime(b.time),h:b.high,l:b.low,c:b.close})),[bars]);
 const zev=useMemo(()=>{const m=new Map<string,ZoneEval>();for(const d of drawings)if(d.type==='zone'&&d.zn&&d.a.length===2)m.set(d.id,evalZone(d.zn,zoneEdges(d.zn.k,d.a),Math.max(d.a[0].t,d.a[1].t),zbars));return m},[drawings,zbars]);
 const parents=useMemo(()=>nestZones(drawings.flatMap(d=>{if(d.type!=='zone'||!d.zn)return [];const e=zoneEdges(d.zn.k,d.a);return [{id:d.id,tf:d.otf,hi:e.hi,lo:e.lo,par:d.zn.par}]})),[drawings]);
 const S=useRef({tool,drawings,temp,selected,magnet,color,bars,times,tf,instrument,prefs,presetSel,zev});
 useLayoutEffect(()=>{S.current={tool,drawings,temp,selected,magnet,color,bars,times,tf,instrument,prefs,presetSel,zev}});
 useEffect(()=>{onDrawings?.(instrument,drawings)},[drawings,instrument,onDrawings]);
 // profil účtu pro loty v nástroji long/short (Účty a riziko)
 const risk=useRisk(),riskPref=useProfilePref(),RK=useRef({data:risk.data,pref:riskPref});
 useLayoutEffect(()=>{RK.current={data:risk.data,pref:riskPref}});
 // vzhled nové kresby: zvolený preset nástroje, jinak uživatelův výchozí, jinak nic (vestavěné hodnoty)
 const lookFor=(t:DrawType):Look|null=>{const st=S.current,id=st.presetSel[t];return (id&&[...BUILTIN_PRESETS,...st.prefs.presets].find(p=>p.id===id&&p.tool===t))||st.prefs.defaults[t]||null};
 // nová kresba: TF vzniku; zóna dostane druh podle ceny, pravidlo dotyk a čas vzniku
 const stamp=(d:Drawing):Drawing=>{const st=S.current,last=st.bars.length?st.bars[st.bars.length-1].close:null;const x:Drawing={...d,otf:st.tf};if(x.type==='zone'&&!x.zn)x.zn={k:zoneKindFor(x.a,last),rule:'touch',at:Date.now()};return x};
 const draft=useRef<Draft|null>(null),drag=useRef<Drag|null>(null),panning=useRef(false);
 const dirty=useRef(false),loaded=useRef<string|null>(null),pending=useRef<{instrument:string;drawings:Drawing[]}|null>(null);
 const menuRef=useRef<HTMLDivElement>(null);
 // historie úprav kreseb aktuálního trhu (Zpět / Znovu); group slučuje rychlé změny jednoho pole (psaní, posuvník) do jednoho kroku
 const hist=useRef<History<Drawing[]>>(emptyHistory()),lastGroup=useRef<{g:string;at:number}|null>(null);
 const [undoVer,setUndoVer]=useState(0),[canHist,setCanHist]=useState({undo:false,redo:false}),[rrFocus,setRrFocus]=useState<{id:string;n:number}|null>(null);

 // velikost plochy grafu pro plovoucí panel oblíbených (hlásí ji primitivum při vykreslení)
 const [area,setArea]=useState<{w:number;h:number}|null>(null);
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
   size:(w,h)=>setArea({w,h}),
   zone:d=>{if(!d.zn)return null;const ev=S.current.zev.get(d.id);return {state:ev?stateText(ev):ZONE_STATES.waiting,htf:htfLabel(d.otf,S.current.tf),muted:ev?.state==='invalid'||ev?.state==='archived',kind:d.zn.k}},
   eq:d=>eqLabel(d.a[0].p,S.current.bars[Math.round(conv.toL(d.a[0].t))]),
   sizing:d=>chartSizing(d,RK.current.data,RK.current.pref,S.current.instrument),
   // volume profile rozsahu ze svíček mezi kotvami (cache: stejné svíčky, rozsah a nastavení = stejný profil)
   profile:d=>{
    const bs=S.current.bars;let m=VP_CACHE.get(bs);if(!m){m=new Map();VP_CACHE.set(bs,m)}
    const st=styleOf(d),t0=chartTime(d.a[0].t),t1=chartTime((d.a[1]??d.a[0]).t),k=Math.min(t0,t1)+'|'+Math.max(t0,t1)+'|'+st.vr+'|'+st.va;
    if(!m.has(k))m.set(k,volumeProfile(barsBetween(bs,t0,t1),st.vr,st.va/100));return m.get(k)??null;
   },
  });
  return {conv,prim};
 });
 // bod pod kurzorem: logický index a cena; kotva = střed svíčky (+ magnet na O/H/L/C)
 const raw=(p:Pt)=>{const ax=conv.axis(),price=series.current?.coordinateToPrice(p.y);if(!ax||price==null)return null;return {l:(p.x-ax.x0)/ax.dx,p:price}};
 const anchorAt=(p:Pt):Anchor|null=>{const r=raw(p);if(!r)return null;const i=Math.round(r.l),bar=S.current.magnet?S.current.bars[i]:undefined;return {t:Math.round(conv.fromL(i)),p:bar?snapPrice(bar,r.p):r.p}};
 // volný bod (štětec): bez zaokrouhlení na svíčku
 const freeAt=(p:Pt):Anchor|null=>{const r=raw(p);return r?{t:Math.round(conv.fromL(r.l)),p:r.p}:null};

 useEffect(()=>{prim.update()},[risk.data,riskPref,prim]);
 // připojení primitiva k sérii svíček
 useEffect(()=>{const s=series.current,pr=prim;s?.attachPrimitive(pr);pr.update();return()=>{try{s?.detachPrimitive(pr)}catch{}}},[series,ver]);
 useEffect(()=>{const pr=prim;pr.drawings=drawings;pr.temp=temp;pr.selected=selected;pr.tf=tf;pr.htf=htf;pr.update()},[drawings,temp,selected,times,tf,htf,zev]);
 // po přepnutí TF zrušit výběr kresby, která na něm není vidět
 useEffect(()=>{setSelected(id=>{const d=id?S.current.drawings.find(x=>x.id===id):null;return d&&!visibleOn(d,tf)?null:id})},[tf]);
 // barvy z palety a motivu (překreslit při změně)
 useEffect(()=>{
  const fg=css('--t-fg','#0b0c0e');
  const pal:DrawPalette={brand:norm(css('--t-brand','#245bff'),'#245bff'),bull:norm(css('--bull','#16a34a'),'#16a34a'),bear:norm(css('--bear','#dc2626'),'#dc2626'),amber:'#f59e0b',muted:norm(css('--t-muted','#6b7079'),'#6b7079'),fg:norm(fg,'#0b0c0e'),bg:norm(css('--t-surface','#ffffff'),'#ffffff'),text:norm(fg,'#0b0c0e')};
  prim.palette=pal;prim.update();
 },[tick]);
 // při kreslení tahy kreslí, takže tah grafem graf neposouvá (jen s Ctrl / Alt, viz down); kolečko, osy a štípnutí fungují vždy jako v TradingView
 useEffect(()=>{const c=chart.current;if(!c)return;const free=tool==='cursor';c.applyOptions({handleScroll:{mouseWheel:true,pressedMouseMove:free,horzTouchDrag:free,vertTouchDrag:free},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true,axisDoubleClickReset:true}})},[tool,chart]);
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
 const build=(dr:Draft):Drawing=>applyLook(stamp({id:dr.id,type:dr.type,color:dr.color,a:(dr.type==='long'||dr.type==='short')?positionFrom(dr.type,dr.pts[0],dr.pts[1]??dr.pts[0]):dr.pts}),dr.look);
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
  // Shift: čára vodorovně (cena referenčního bodu – předchozího / druhého konce) nebo svisle (jeho čas) podle toho, kam se kurzor pohnul víc;
  // u obdélníku a mřížky rovnoměrný tvar (čtverec v pixelech) jako v malování; u pozic jen vodorovně
  const shiftOf=(e?:MouseEvent|TouchEvent)=>!!e&&!('touches' in e)&&e.shiftKey;
  const refPx=(ref:Anchor):Pt|null=>{const ax=conv.axis(),ry=series.current?.priceToCoordinate(ref.p);return ax&&ry!=null?{x:ax.x0+ax.dx*conv.toL(ref.t),y:ry}:null};
  const lock=(type:DrawType,a:Anchor,ref:Anchor|undefined,on:boolean,p:Pt):Anchor=>{
   if(!on||!ref)return a;const mode=shiftMode(type),r=refPx(ref);
   if(mode==='square'){if(!r)return a;const dx=p.x-r.x,dy=p.y-r.y,sz=Math.max(Math.abs(dx),Math.abs(dy));return freeAt({x:r.x+(dx<0?-sz:sz),y:r.y+(dy<0?-sz:sz)})||a}
   if(mode==='h'||!r||lockDir(p.x-r.x,p.y-r.y)==='h')return lockAnchor(a,ref,'h');
   // svisle: cena pod kurzorem, magnet z O/H/L/C svíčky referenčního bodu
   const rw=raw(p),bar=S.current.magnet?S.current.bars[Math.round(conv.toL(ref.t))]:undefined;
   return rw?{t:ref.t,p:bar?snapPrice(bar,rw.p):rw.p}:lockAnchor(a,ref,'v');
  };
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
   // Ctrl / Alt (⌘ na Macu) + tah = posun grafu i s nástrojem nebo nad kresbou: událost projde ke grafu, kreslení ji nechá být
   if(!touch&&(e.ctrlKey||e.altKey||e.metaKey)){panning.current=true;chart.current?.applyOptions({handleScroll:{pressedMouseMove:true}});return}
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
    if(ONE_CLICK.has(st.tool)){finish(applyLook(stamp({id:newId(),type:st.tool,a:[a],color:st.color}),look));return}
    if(st.tool==='text'){setTool('cursor');setEdit({x:p.x,y:p.y,anchor:a,text:look?.text||'',look});return}
    const d:Draft={id:newId(),type:st.tool,color:st.color,pts:st.tool==='brush'?[a]:[a,a],fixed:1,need:needOf(st.tool),x:p.x,y:p.y,placed:false,lastDown:Date.now(),px:st.tool==='brush'?[p]:undefined,look};
    draft.current=d;render(d);return;
   }
   const h=prim.hit(p,touch?14:6);
   if(h){
    stop(e);const isTemp=st.temp?.id===h.id,orig=isTemp?st.temp:st.drawings.find(d=>d.id===h.id);const r=raw(p);
    if(!orig||!r)return;
    if(st.selected!==h.id)setSelected(h.id);
    if(orig.lock)return;
    drag.current={id:h.id,temp:isTemp,part:h.hit.part,index:h.hit.part==='handle'?h.hit.index:0,edge:h.hit.part==='edge'?h.hit.edge:undefined,start:r,orig,cur:null,x:p.x,y:p.y,rr:h.hit.part==='body'&&prim.rrAt(p)===h.id};
    return;
   }
   if(st.selected!==null)setSelected(null);
   if(st.temp)setTemp(null);
  }
  function move(e:MouseEvent|TouchEvent){
   const p=point(e);if(!p||panning.current)return;
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
   if(panning.current){panning.current=false;chart.current?.applyOptions({handleScroll:{pressedMouseMove:S.current.tool==='cursor'}});return}
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
   // preventDefault = Esc spotřebovalo kreslení (graf pak neukončí celou obrazovku – React mezitím stihne překreslit a výběr už v DOM není)
   else if(e.key==='Escape'&&(st.tool!=='cursor'||draft.current||drag.current||st.selected||st.temp)){e.preventDefault();cancel();setSelected(null);setTemp(null)}
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
 // na mobilu je nabídka pod tlačítkem – u skupin vpravo v liště ji posunout doleva, aby nepřetekla za okraj obrazovky
 useLayoutEffect(()=>{const box=menuRef.current;if(!menu||!box)return;const over=box.getBoundingClientRect().right-(window.innerWidth-8);if(over>0)box.style.left=Math.max(8,menu.x-over)+'px'},[menu]);

 // presety a oblíbené: načíst jednou na stránku; ukládat 500 ms po poslední změně (PUT presets, defaults, fav a tfFav; barvy patří Nastavení)
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
   fetch('/api/chart/prefs',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefs:{presets:next.presets,defaults:next.defaults,fav:next.fav,tfFav:next.tfFav}})}).then(r=>{if(!r.ok)throw Error();setPrefsState('ok')}).catch(()=>setPrefsState('error'));
  },500);
 };
 // presety nástroje: vestavěné šablony (Fibonacci třetiny) a uživatelovy
 const presetsOf=(t:DrawType)=>[...BUILTIN_PRESETS,...prefs.presets].filter(p=>p.tool===t);
 const presetName=(t:Tool)=>{if(t==='cursor')return null;const id=presetSel[t];return id?presetsOf(t).find(p=>p.id===id)?.name??null:null};
 const savePreset=(d:Drawing,name:string)=>{
  const n=name.trim().slice(0,MAX_PRESET_NAME);if(!n)return;
  const same=prefs.presets.find(p=>p.tool===d.type&&p.name.toLowerCase()===n.toLowerCase());
  const p:Preset={...lookOf(d),id:same?.id??newId(),name:n,tool:d.type};
  if(!same&&prefs.presets.length>=MAX_PRESETS)return;if(isBuiltin(p.id))return;
  changePrefs({...prefs,presets:same?prefs.presets.map(x=>x.id===same.id?p:x):[...prefs.presets,p]});
 };
 const deletePreset=(id:string)=>{if(isBuiltin(id))return;changePrefs({...prefs,presets:prefs.presets.filter(p=>p.id!==id)});setPresetSel(m=>Object.fromEntries(Object.entries(m).filter(([,v])=>v!==id)))};
 const setDefault=(d:Drawing)=>changePrefs({...prefs,defaults:{...prefs.defaults,[d.type]:lookOf(d)}});
 const resetDefault=(t:DrawType)=>{const defaults={...prefs.defaults};delete defaults[t];changePrefs({...prefs,defaults})};
 // oblíbené nástroje (hvězdička v nabídce skupiny a u vybrané kresby) a poloha jejich plovoucího panelu
 const isFav=(t:DrawType)=>prefs.fav.tools.includes(t);
 const toggleFavorite=(t:DrawType)=>changePrefs({...prefs,fav:{...prefs.fav,tools:toggleFav(prefs.fav.tools,t)}});
 // oblíbené časové rámce (hvězdička v seznamu TF v hlavičce grafu); pořadí podle délky TF
 const toggleTfFav=(t:string)=>changePrefs({...prefs,tfFav:prefs.tfFav.includes(t)?prefs.tfFav.filter(x=>x!==t):TFS.filter(x=>x===t||prefs.tfFav.includes(x))});
 // strom objektů: skrýt / zamknout / najít kresbu
 const flag=(id:string,k:'hide'|'lock')=>{commit(drawings.map(d=>{if(d.id!==id)return d;const n={...d};if(n[k])delete n[k];else n[k]=true;return n}));if(k==='hide')setSelected(x=>x===id?null:x)};
 const focusDrawing=(id:string)=>{
  const d=drawings.find(x=>x.id===id),ts=chart.current?.timeScale();if(!d||!ts)return;
  const ls=d.a.map(a=>conv.toL(a.t)),lo=Math.min(...ls),hi=Math.max(...ls),r=ts.getVisibleLogicalRange();
  if(r&&(lo<r.from||hi>r.to)){const span=Math.max(r.to-r.from,hi-lo+12),mid=(lo+hi)/2;ts.setVisibleLogicalRange({from:mid-span/2,to:mid+span/2})}
  if(!d.hide&&visibleOn(d,tf)){setTool('cursor');setSelected(id)}
 };
 const moveFav=(x:number,y:number)=>changePrefs({...prefs,fav:{...prefs.fav,x,y}});
 // hromadné akce v seznamu objektů a kopie kresby (posun o 3 svíčky doprava, ať se nepřekrývá)
 const doBulk=(ids:string[],b:Bulk)=>{if(!ids.length)return;if(b.op==='delete'&&!window.confirm(`Smazat vybrané kresby (${ids.length})? Vrátit je půjde tlačítkem Zpět (${UNDO_KEY}).`))return;commit(bulk(drawings,ids,b));if(b.op==='delete'||b.op==='hide')setSelected(x=>x&&ids.includes(x)?null:x)};
 const duplicate=(id:string)=>{
  const d=drawings.find(x=>x.id===id);if(!d)return;
  if(drawings.length>=MAX_DRAWINGS){setSave('error');setSaveError(`Na jednom trhu může být nejvýš ${MAX_DRAWINGS} kreseb.`);return}
  const c=duplicateOf(d,newId(),Date.now()),moved=d.type==='hline'?c:translate(c,3,0,conv.toL,t=>Math.round(conv.fromL(t)));
  commit([...drawings,moved]);setSelected(moved.id);
 };
 // zóna: scénář (POST /api/scenarios) a alert na dotyk proximální hrany (POST /api/alerts); ID se uloží do zóny
 const [zoneMsg,setZoneMsg]=useState<{id:string;text:string;err?:boolean;href?:string}|null>(null);
 const zonePatch=(id:string,p:Partial<ZoneMeta>)=>{const list=S.current.drawings;commit(list.map(d=>{if(d.id!==id||!d.zn)return d;const zn={...d.zn,...p} as ZoneMeta;for(const k of Object.keys(zn))if((zn as Record<string,unknown>)[k]===undefined)delete (zn as Record<string,unknown>)[k];return {...d,zn}}))};
 const post=async(url:string,body:unknown)=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({})) as Record<string,unknown>;if(!r.ok)throw new Error(typeof j.error==='string'?j.error:'Nepodařilo se uložit.');return j};
 const zoneScenarioCreate=async(d:Drawing)=>{
  if(!d.zn)return;setZoneMsg({id:d.id,text:'Zakládám scénář…'});
  try{const j=await post('/api/scenarios',zoneScenario(instrument,d.zn.k,zoneEdges(d.zn.k,d.a),d.otf,fmtPrice)) as {scenario?:{id?:string}};const sid=j.scenario?.id;if(sid)zonePatch(d.id,{scn:sid});setZoneMsg({id:d.id,text:'Scénář založen',href:'/scenare'+(sid?'#'+sid:'')})}
  catch(e){setZoneMsg({id:d.id,text:e instanceof Error?e.message:'Scénář se nepodařilo založit.',err:true})}
 };
 const zoneAlertCreate=async(d:Drawing)=>{
  if(!d.zn)return;setZoneMsg({id:d.id,text:'Nastavuji alert…'});
  try{const j=await post('/api/alerts',zoneAlert(instrument,d.zn.k,zoneEdges(d.zn.k,d.a),d.otf,fmtPrice)) as {alert?:{id?:string};warnings?:string[]};const aid=j.alert?.id;if(aid&&/^al_[a-z0-9]{1,40}$/.test(aid))zonePatch(d.id,{al:aid});setZoneMsg({id:d.id,text:'Alert na dotyk zóny nastaven'+(j.warnings?.length?' · '+j.warnings[0]:''),href:'/alerty'})}
  catch(e){setZoneMsg({id:d.id,text:e instanceof Error?e.message:'Alert se nepodařilo nastavit.',err:true})}
 };

 // úpravy vybrané kresby
 const current=selected?(temp?.id===selected?temp:drawings.find(d=>d.id===selected))??null:null;
 // vybraná kresba pro „Nový scénář“ na stránce grafu (úrovně z obdélníku / pozice / čáry) – jako událost okna, graf o scénářích neví
 useEffect(()=>{try{window.dispatchEvent(new CustomEvent('tradee:drawing-selected',{detail:{instrument,drawing:current?{type:current.type,a:current.a,zn:current.zn}:null}}))}catch{}},[current,instrument]);
 const patch=(p:Partial<Drawing>,group?:string)=>{if(!current)return;const next={...current,...p};for(const k of Object.keys(next))if((next as Record<string,unknown>)[k]===undefined)delete (next as Record<string,unknown>)[k];if(temp?.id===current.id)setTemp(next);else commit(drawings.map(d=>d.id===current.id?next:d),group&&group+':'+current.id)};
 const patchStyle=(p:Partial<DrawStyle>,group?:string)=>{if(!current)return;const s:DrawStyle={...current.s,...p};for(const k of Object.keys(s))if((s as Record<string,unknown>)[k]===undefined)delete (s as Record<string,unknown>)[k];patch({s:Object.keys(s).length?s:undefined},group)};
 const applyPreset=(p:Preset)=>{if(!current)return;const next=applyLook(current,p);if(temp?.id===current.id)setTemp(next);else commit(drawings.map(d=>d.id===current.id?next:d));setUndoVer(n=>n+1)};
 const pickColor=(c:DrawColor)=>{setColor(c);patch({color:c})};
 const pin=()=>{if(!temp)return;if(drawings.length>=MAX_DRAWINGS){setSave('error');setSaveError(`Na jednom trhu může být nejvýš ${MAX_DRAWINGS} kreseb.`);return}commit([...drawings,temp]);setTemp(null)};
 const saveText=(text:string)=>{
  const e=edit;setEdit(null);if(!e)return;const v=text.trim().slice(0,MAX_TEXT);
  if(e.id){if(v)commit(drawings.map(d=>d.id===e.id?{...d,text:v}:d));return}
  if(!v)return;if(drawings.length>=MAX_DRAWINGS){setSave('error');setSaveError(`Na jednom trhu může být nejvýš ${MAX_DRAWINGS} kreseb.`);return}
  const d:Drawing=applyLook(stamp({id:newId(),type:'text',a:[e.anchor],color,text:v}),e.look);commit([...drawings,d]);setSelected(d.id);
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
    // hvězdička je vedle nástroje: šipka doprava na ni, doleva zpět; nahoru/dolů po nástrojích a presetech
    const a=document.activeElement as HTMLElement|null,star=!!a?.classList.contains('mc-fav-star');
    const items=[...(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitemradio]')||[])],i=items.indexOf((star?a?.previousElementSibling:a) as HTMLElement);
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}
    else if(e.key==='ArrowRight'&&!star&&a?.nextElementSibling?.classList.contains('mc-fav-star')){e.preventDefault();(a.nextElementSibling as HTMLElement).focus()}
    else if(e.key==='ArrowLeft'&&star){e.preventDefault();(a?.previousElementSibling as HTMLElement|null)?.focus()}
    else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();setMenu(null)}
   }}>
   <div className="mc-menu-title">{menuGroup.label}</div>
   {menuGroup.tools.map(t=>{const {Icon,hint}=TOOL_META[t],ps=presetsOf(t),sel=presetSel[t];const cur=tool===t||(!menuGroup.tools.includes(tool as DrawType)&&last[menuGroup.id]===t);return <Fragment key={t}>
    <div className="mc-menu-row" role="none">
     <button type="button" role="menuitemradio" aria-checked={cur&&!sel} className={'mc-menu-item'+(tool===t&&!sel?' on':'')} onClick={()=>pickTool(t,null)}><Icon size={16} strokeWidth={1.8} aria-hidden/><span>{DRAW_LABELS[t]}</span><small>{hint}{prefs.defaults[t]?' · tvůj výchozí vzhled':''}</small></button>
     <FavStar on={isFav(t)} tool={t} onToggle={()=>toggleFavorite(t)}/>
    </div>
    {ps.map(p=><button key={p.id} type="button" role="menuitemradio" aria-checked={cur&&sel===p.id} aria-label={DRAW_LABELS[t]+' – preset '+p.name} className={'mc-menu-item mc-menu-preset'+(tool===t&&sel===p.id?' on':'')} onClick={()=>pickTool(t,p.id)}><i className="mc-preset-dot" style={{background:swatchBg(p.color)}} aria-hidden/><span>{p.name}</span></button>)}
   </Fragment>})}
  </div>}
 </div>;

 const isTemp=!!current&&temp?.id===current.id,hidden=!!current&&!isTemp&&!visibleOn(current,tf);
 const overlay=<>
  {current&&!edit&&<div className="mc-sel" role="group" aria-label={'Vybraná kresba: '+DRAW_LABELS[current.type]}>
   <span className="mc-sel-name">{DRAW_LABELS[current.type]}{isTemp?' · dočasné':''}{current.lock&&<span className="mc-sel-hidden"><Lock size={11} aria-hidden/> zamčeno</span>}{hidden&&<span className="mc-sel-hidden"><EyeOff size={12} aria-hidden/> skryto na {tf}</span>}</span>
   {current.type!=='measure'&&<Swatches value={current.color} onPick={pickColor} label="Barva" custom={prefs.colors} add/>}
   {current.type!=='measure'&&<button type="button" className={'mc-tool sm'+(styleOpen?' on':'')} aria-expanded={styleOpen} aria-controls="mc-style" aria-label="Styl a text kresby" data-tip="Styl, text, viditelnost" onClick={()=>setStyleOpen(o=>!o)}><Settings2 size={15} aria-hidden/></button>}
   {!isTemp&&<button type="button" className={'mc-tool sm'+(current.lock?' on':'')} aria-pressed={!!current.lock} aria-label={current.lock?'Odemknout kresbu':'Zamknout kresbu'} data-tip={current.lock?'Odemknout (zamčenou kresbu nejde posunout)':'Zamknout (nepůjde posunout)'} onClick={()=>flag(current.id,'lock')}>{current.lock?<Lock size={15} aria-hidden/>:<LockOpen size={15} aria-hidden/>}</button>}
   <button type="button" className={'mc-tool sm mc-fav-toggle'+(isFav(current.type)?' on':'')} aria-pressed={isFav(current.type)} aria-label={(isFav(current.type)?'Odebrat z oblíbených: ':'Přidat do oblíbených: ')+DRAW_LABELS[current.type]} data-tip={isFav(current.type)?'Odebrat nástroj z oblíbených':'Nástroj do oblíbených'} onClick={()=>toggleFavorite(current.type)}><Star size={15} fill={isFav(current.type)?'currentColor':'none'} aria-hidden/></button>
   {!isTemp&&<button type="button" className="mc-tool sm" aria-label="Duplikovat kresbu" data-tip="Duplikovat" onClick={()=>duplicate(current.id)}><Copy size={15} aria-hidden/></button>}
   {!isTemp&&<button type="button" className="mc-tool sm" aria-label="Do popředí" data-tip={'Vrstva: '+LAYERS[layerOf(current)].label+' → popředí'} disabled={layerOf(current)===2} onClick={()=>doBulk([current.id],{op:'layer',z:layerOf(current)===0?1:2})}><BringToFront size={15} aria-hidden/></button>}
   {!isTemp&&<button type="button" className="mc-tool sm" aria-label="Do pozadí" data-tip={'Vrstva: '+LAYERS[layerOf(current)].label+' → pozadí'} disabled={layerOf(current)===0} onClick={()=>doBulk([current.id],{op:'layer',z:layerOf(current)===2?1:0})}><SendToBack size={15} aria-hidden/></button>}
   {MANUAL_TYPES.includes(current.type)&&<span className="mc-sel-manual">{MANUAL_NOTE}</span>}
   {isTemp&&<button type="button" className="mc-chip" onClick={pin}><Pin size={13} aria-hidden/> Připnout</button>}
   <button type="button" className="mc-tool sm danger" aria-label="Smazat kresbu" data-tip="Smazat (Delete)" onClick={()=>remove(current.id)}><Trash2 size={15} aria-hidden/></button>
   {current.type==='zone'&&current.zn&&!isTemp&&!styleOpen&&<span className="mc-sel-zone">{(()=>{const ev=zev.get(current.id);return ev?stateText(ev):ZONE_STATES.waiting})()}{htfLabel(current.otf,tf)?' · '+htfLabel(current.otf,tf):''}</span>}
   {current.type==='zone'&&current.zn&&!isTemp&&styleOpen&&<ZoneRows d={current} ev={zev.get(current.id)} parent={parents.get(current.id)} zones={drawings.filter(x=>x.type==='zone'&&x.id!==current.id)} tf={tf} htf={htf} msg={zoneMsg?.id===current.id?zoneMsg:null} onPatch={p=>zonePatch(current.id,p)} onScenario={()=>zoneScenarioCreate(current)} onAlert={()=>zoneAlertCreate(current)}/>}
   {styleOpen&&current.type!=='measure'&&<StylePanel key={current.id+':'+undoVer} d={current} market={instrument} tf={tf} tfList={tfList} onPatch={patch} onStyle={patchStyle} focusRR={rrFocus?.id===current.id?rrFocus.n:0} onFocusedRR={()=>setRrFocus(null)} colors={prefs.colors} presets={presetsOf(current.type)} hasDefault={!!prefs.defaults[current.type]} canSave={prefs.presets.length<MAX_PRESETS||presetsOf(current.type).length>0} prefsOk={prefsState==='ok'||prefsState==='error'} onSavePreset={n=>savePreset(current,n)} onDeletePreset={deletePreset} onApplyPreset={applyPreset} onSetDefault={()=>setDefault(current)} onResetDefault={()=>resetDefault(current.type)}/>}
  </div>}
  {edit&&<TextInput key={edit.id||edit.x+':'+edit.y} edit={edit} onDone={saveText} onCancel={()=>setEdit(null)}/>}
  {area&&prefs.fav.tools.length>0&&<FavBar tools={prefs.fav.tools} x={prefs.fav.x} y={prefs.fav.y} area={area} tool={tool} disabled={disabled} presetName={presetName} onPick={t=>pickTool(t)} onMove={moveFav}/>}
  {tool!=='cursor'&&<div className="mc-draw-hint" role="status">{DRAW_LABELS[tool]}{presetName(tool)?' · preset „'+presetName(tool)+'“':''}: {drawHint(tool)} · Ctrl/Alt + tah posune graf · Esc zruší</div>}
 </>;
 const tree=treeOpen?<ObjectTree drawings={drawings} tf={tf} htf={htf} selected={selected} extra={treeExtra} market={name||instrument} zev={zev} parents={parents} onFocus={focusDrawing} onFlag={flag} onRemove={remove} onClearAll={clearAll} onBulk={doBulk} onDuplicate={duplicate} onClose={()=>onTreeClose?.()}/>:null;
 const status=<>{save!=='idle'&&<span className={'mc-saved'+(save==='error'||save==='loaderror'?' err':'')} role="status">{SAVE_TEXT[save]}{save==='error'&&saveError?': '+saveError:''}</span>}
  {prefsState==='error'&&<span className="mc-saved err" role="status">Presety se nepodařilo uložit</span>}</>;
 return {toolbar,overlay,status,tree,drawing:tool!=='cursor',count:drawings.length,tfFav:prefs.tfFav,toggleTfFav,current:current&&!isTemp?current:null,drawings};
}

// Objekty v grafu (jako strom objektů v TradingView): indikátory (z grafu) a všechny kresby trhu od nejnovější – najít, skrýt, zamknout, smazat, duplikovat;
// u kresby trh, TF vzniku, vrstva, souřadnice, poznámka, u zóny stav a rodič; zaškrtnuté kresby hromadně skrýt / zamknout / smazat / přesunout do vrstvy
const anchorText=(d:Drawing)=>d.a.slice(0,3).map(a=>fmtPrice(a.p)+' @ '+new Date(a.t).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})).join(' → ')+(d.a.length>3?' … ('+d.a.length+' bodů)':'');
function ObjectTree({drawings,tf,htf,selected,extra,market,zev,parents,onFocus,onFlag,onRemove,onClearAll,onBulk,onDuplicate,onClose}:{drawings:Drawing[];tf:ChartTf;htf:boolean;selected:string|null;extra?:React.ReactNode;market:string;zev:Map<string,ZoneEval>;parents:Map<string,string>;onFocus:(id:string)=>void;onFlag:(id:string,k:'hide'|'lock')=>void;onRemove:(id:string)=>void;onClearAll:()=>void;onBulk:(ids:string[],b:Bulk)=>void;onDuplicate:(id:string)=>void;onClose:()=>void}){
 const list=[...drawings].sort((a,b)=>(createdOf(b.id)??0)-(createdOf(a.id)??0));
 const [pick,setPick]=useState<string[]>([]),[open,setOpen]=useState<string|null>(null);
 const ids=pick.filter(id=>drawings.some(d=>d.id===id)),all=ids.length===drawings.length&&drawings.length>0;
 const act=(b:Bulk)=>{onBulk(ids,b);if(b.op==='delete')setPick([])};
 return <aside className="mc-tree" aria-label="Objekty v grafu" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose()}}}>
  <div className="mc-tree-head"><b>Objekty v grafu</b><button type="button" className="mc-tool sm" aria-label="Zavřít objekty" data-tip="Zavřít" onClick={onClose}><X size={15} aria-hidden/></button></div>
  {extra}
  <div className="mc-tree-sec"><label className="mc-tree-all"><input type="checkbox" checked={all} disabled={!drawings.length} aria-label="Vybrat všechny kresby" onChange={e=>setPick(e.target.checked?drawings.map(d=>d.id):[])}/></label><span>Kresby</span><em>{drawings.length}</em>{drawings.length>0&&<button type="button" className="mc-tree-clear" onClick={onClearAll}>Smazat vše</button>}</div>
  {ids.length>0&&<div className="mc-tree-bulk" role="toolbar" aria-label={'Hromadné akce ('+ids.length+')'}>
   <span>{ids.length} vybráno</span>
   <button type="button" className="mc-chip" onClick={()=>act({op:'hide'})}>Skrýt</button>
   <button type="button" className="mc-chip" onClick={()=>act({op:'show'})}>Zobrazit</button>
   <button type="button" className="mc-chip" onClick={()=>act({op:'lock'})}>Zamknout</button>
   <button type="button" className="mc-chip" onClick={()=>act({op:'unlock'})}>Odemknout</button>
   <select className="mc-chip mc-type" aria-label="Přesunout do vrstvy" value="" onChange={e=>{const z=Number(e.target.value);if(z===0||z===1||z===2)act({op:'layer',z})}}><option value="" disabled>Do vrstvy…</option>{LAYERS.map(l=><option key={l.z} value={l.z}>{l.label}</option>)}</select>
   <button type="button" className="mc-chip danger" onClick={()=>act({op:'delete'})}>Smazat</button>
  </div>}
  {list.length?<ul className="mc-tree-list">{list.map(d=>{const {Icon}=TOOL_META[d.type],off=!visibleOn(d,tf)||(d.type==='zone'&&!htfVisible(d.otf,tf,htf)),name=DRAW_LABELS[d.type],when=created(d.id),ev=zev.get(d.id),par=parents.get(d.id),pd=par?drawings.find(x=>x.id===par):undefined;
   const meta=[when,d.otf?'vznik '+d.otf:'',d.tfs?'jen '+d.tfs.join(', '):'',layerOf(d)!==1?LAYERS[layerOf(d)].label.toLowerCase():'',off?'skryto na '+tf:''].filter(Boolean).join(' · ');
   const exp=open===d.id;
   return <li key={d.id} className={'mc-tree-row'+(selected===d.id?' on':'')+(d.hide||off?' dim':'')}>
    <input type="checkbox" className="mc-tree-pick" checked={ids.includes(d.id)} aria-label={'Vybrat: '+name} onChange={e=>setPick(p=>e.target.checked?[...p,d.id]:p.filter(x=>x!==d.id))}/>
    <button type="button" className="mc-tree-main" onClick={()=>onFocus(d.id)} title="Najít v grafu a vybrat">
     <i className="mc-tree-ic" style={{color:swatchBg(d.color)}}><Icon size={15} strokeWidth={1.8} aria-hidden/></i>
     <span><b>{name}{ev?' · '+stateText(ev):''}</b>{d.text&&<small className="mc-tree-note">{d.text}</small>}{meta&&<small>{meta}</small>}{MANUAL_TYPES.includes(d.type)&&<small>{MANUAL_NOTE}</small>}</span>
    </button>
    <button type="button" className={'mc-tool sm'+(exp?' on':'')} aria-expanded={exp} aria-label={'Podrobnosti: '+name} data-tip="Podrobnosti" onClick={()=>setOpen(o=>o===d.id?null:d.id)}><ClipboardList size={14} aria-hidden/></button>
    <button type="button" className="mc-tool sm" aria-label={'Duplikovat: '+name} data-tip="Duplikovat" onClick={()=>onDuplicate(d.id)}><Copy size={14} aria-hidden/></button>
    <button type="button" className={'mc-tool sm'+(d.hide?' on':'')} aria-pressed={!!d.hide} aria-label={(d.hide?'Zobrazit: ':'Skrýt: ')+name} data-tip={d.hide?'Zobrazit':'Skrýt'} onClick={()=>onFlag(d.id,'hide')}>{d.hide?<EyeOff size={14} aria-hidden/>:<Eye size={14} aria-hidden/>}</button>
    <button type="button" className={'mc-tool sm'+(d.lock?' on':'')} aria-pressed={!!d.lock} aria-label={(d.lock?'Odemknout: ':'Zamknout: ')+name} data-tip={d.lock?'Odemknout':'Zamknout'} onClick={()=>onFlag(d.id,'lock')}>{d.lock?<Lock size={14} aria-hidden/>:<LockOpen size={14} aria-hidden/>}</button>
    <button type="button" className="mc-tool sm danger" aria-label={'Smazat: '+name} data-tip="Smazat" onClick={()=>onRemove(d.id)}><Trash2 size={14} aria-hidden/></button>
    {exp&&<dl className="mc-tree-det">
     <div><dt>ID</dt><dd>{d.id}</dd></div>
     <div><dt>Trh</dt><dd>{market}</dd></div>
     <div><dt>TF vzniku</dt><dd>{d.otf||'neuvedeno (starší kresba)'}</dd></div>
     <div><dt>Body</dt><dd>{anchorText(d)}</dd></div>
     <div><dt>Styl</dt><dd>{(isHex(d.color)?d.color:COLOR_LABELS[d.color as NamedColor])+' · čára '+styleOf(d).lw+' px · '+LAYERS[layerOf(d)].label.toLowerCase()}</dd></div>
     {d.text&&<div><dt>Poznámka</dt><dd>{d.text}</dd></div>}
     {d.zn&&<div><dt>Zóna</dt><dd>{ZONE_KINDS[d.zn.k]+' · pravidlo: '+ZONE_RULES[d.zn.rule]+(d.zn.rule==='pct'?' '+(d.zn.pct??50)+' %':'')+(pd?' · uvnitř '+(pd.otf||'')+' zóny':'')}</dd></div>}
    </dl>}
   </li>})}</ul>:<p className="mc-tree-empty">Zatím žádné kresby. Nástroje jsou v liště vlevo.</p>}
 </aside>;
}

// zóna: druh, pravidlo mitigace, stav z ceny s historií, rodičovská zóna vyššího TF, archiv, scénář a alert
const zoneWhen=(t:number)=>new Date(t).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
function ZoneRows({d,ev,parent,zones,tf,htf,msg,onPatch,onScenario,onAlert}:{d:Drawing;ev?:ZoneEval;parent?:string;zones:Drawing[];tf:ChartTf;htf:boolean;msg:{text:string;err?:boolean;href?:string}|null;onPatch:(p:Partial<ZoneMeta>)=>void;onScenario:()=>void;onAlert:()=>void}){
 const z=d.zn!,e=zoneEdges(z.k,d.a),pz=parent?zones.find(x=>x.id===parent):undefined,[hist,setHist]=useState(false);
 const htfL=htfLabel(d.otf,tf);
 return <div className="mc-zone" role="group" aria-label="Zóna">
  <div className="mc-row"><span>Stav</span><b className={'mc-zone-state '+(ev?.state??'waiting')}>{ev?stateText(ev):ZONE_STATES.waiting}</b>{htfL&&<em className="mc-zone-htf">{htfL}{!htf?' (skryté zóny vyššího TF)':''}</em>}{ev?.partial&&<small className="mc-hint">část historie je mimo načtené svíčky {tf}</small>}</div>
  <div className="mc-row"><span>Hrany</span><small>proximální {fmtPrice(e.proximal)} · distální {fmtPrice(e.distal)} · vznik {zoneWhen(z.at)}{d.otf?' na '+d.otf:''}</small></div>
  <div className="mc-row"><span>Druh</span><Seg label="Druh zóny" value={z.k} options={[['demand','Poptávka'],['supply','Nabídka']]} onPick={v=>onPatch({k:v})}/></div>
  <div className="mc-row"><span>Mitigace</span><Seg label="Pravidlo mitigace" value={z.rule} options={[['touch','Dotyk'],['close','Zavření'],['pct','% průniku']]} onPick={(v:ZoneRule)=>onPatch({rule:v,pct:v==='pct'?z.pct??50:undefined})}/>
   {z.rule==='pct'&&<><NumField className="mc-num" value={z.pct??50} label="Průnik v % hloubky zóny (1–100)" hint="Celé číslo 1 až 100" parse={t=>numInput(t,1,100,0)} onChange={v=>onPatch({pct:v})}/><em>%</em></>}
   <small className="mc-hint">{ZONE_RULES[z.rule]}; zneplatnění = zavření svíčky za distální hranou (knot nestačí)</small>
  </div>
  <div className="mc-row"><span>Vyšší TF</span>{pz?<small>uvnitř {pz.otf||''} zóny {fmtPrice(Math.min(pz.a[0].p,pz.a[1].p))}–{fmtPrice(Math.max(pz.a[0].p,pz.a[1].p))}{z.par?' (ručně)':' (automaticky)'}</small>:<small>není uvnitř zóny vyššího TF</small>}
   <select className="mc-chip mc-type" aria-label="Rodičovská zóna" value={z.par??''} onChange={e=>onPatch({par:e.target.value||undefined})}><option value="">Automaticky</option>{zones.map(x=><option key={x.id} value={x.id}>{(x.otf||'?')+' '+(x.zn?.k==='supply'?'nabídka':'poptávka')+' '+fmtPrice(Math.min(x.a[0].p,x.a[1].p))}</option>)}</select>
  </div>
  {ev&&ev.history.length>0&&<div className="mc-row mc-row-top"><span>Historie</span><button type="button" className="mc-chip" aria-expanded={hist} onClick={()=>setHist(h=>!h)}>{hist?'Skrýt':'Zobrazit'} ({ev.history.length})</button>
   {hist&&<ol className="mc-zone-hist">{ev.history.map((h,i)=><li key={i}><time>{zoneWhen(h.t)}</time> {h.state==='mitigated'?'mitigována '+Math.round(h.depth*100)+' %':ZONE_STATES[h.state]}</li>)}</ol>}</div>}
  <div className="mc-row mc-row-actions">
   <button type="button" className="mc-chip" onClick={onScenario} disabled={!!z.scn} title={z.scn?'Scénář už je založený':'Založí scénář (long u poptávky, short u nabídky) se vstupem v zóně a zneplatněním na distální hraně'}><ClipboardList size={13} aria-hidden/> {z.scn?'Scénář založen':'Scénář ze zóny'}</button>
   <button type="button" className="mc-chip" onClick={onAlert} disabled={!!z.al} title={z.al?'Alert už je nastavený':'Alert „dotyk“ na proximální hraně'}><BellPlus size={13} aria-hidden/> {z.al?'Alert nastaven':'Alert na dotyk'}</button>
   <button type="button" className="mc-chip" onClick={()=>onPatch({arch:z.arch?undefined:Date.now()})}>{z.arch?<><ArchiveRestore size={13} aria-hidden/> Vrátit z archivu</>:<><Archive size={13} aria-hidden/> Archivovat</>}</button>
   {msg&&<span className={'mc-note'+(msg.err?' err':'')} role="status">{msg.text}{msg.href&&<> · <a href={msg.href}>otevřít</a></>}</span>}
  </div>
 </div>;
}

// hvězdička oblíbeného nástroje v nabídce skupiny (šipkou doprava z nástroje)
function FavStar({on,tool,onToggle}:{on:boolean;tool:DrawType;onToggle:()=>void}){
 return <button type="button" role="menuitemcheckbox" aria-checked={on} tabIndex={-1} className={'mc-fav-star'+(on?' on':'')} aria-label={(on?'Odebrat z oblíbených: ':'Přidat do oblíbených: ')+DRAW_LABELS[tool]} title={on?'Odebrat z oblíbených':'Přidat do oblíbených (plovoucí panel nad grafem)'} onClick={onToggle}><Star size={14} strokeWidth={1.8} fill={on?'currentColor':'none'} aria-hidden/></button>;
}
// plovoucí panel oblíbených nástrojů nad grafem (jako v TradingView): tažením za úchyt (nebo šipkami na něm) se přesune a drží se uvnitř plochy grafu;
// poloha je podíl volného místa (favFrac), takže panel sedí i po změně velikosti okna; uloží se až po puštění
const FAV_PAD=6;
function FavBar({tools,x,y,area,tool,disabled,presetName,onPick,onMove}:{tools:DrawType[];x:number;y:number;area:{w:number;h:number};tool:Tool;disabled:boolean;presetName:(t:Tool)=>string|null;onPick:(t:DrawType)=>void;onMove:(x:number,y:number)=>void}){
 const ref=useRef<HTMLDivElement>(null),drag=useRef<{sx:number;sy:number;left:number;top:number;pw:number;ph:number}|null>(null),[pos,setPos]=useState<{x:number;y:number}|null>(null);
 const W=Math.max(0,area.w-2*FAV_PAD),H=Math.max(0,area.h-2*FAV_PAD),cur=pos??{x,y};
 const down=(e:React.PointerEvent<HTMLButtonElement>)=>{
  const el=ref.current;if(!el||e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
  const pw=el.offsetWidth,ph=el.offsetHeight;drag.current={sx:e.clientX,sy:e.clientY,left:cur.x*Math.max(0,W-pw),top:cur.y*Math.max(0,H-ph),pw,ph};
 };
 const move=(e:React.PointerEvent)=>{const d=drag.current;if(d)setPos(favFrac(d.left+e.clientX-d.sx,d.top+e.clientY-d.sy,d.pw,d.ph,W,H))};
 const up=()=>{if(!drag.current)return;drag.current=null;if(pos&&(pos.x!==x||pos.y!==y))onMove(pos.x,pos.y);setPos(null)};
 const key=(e:React.KeyboardEvent)=>{const k=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,[number,number]>)[e.key];if(!k)return;e.preventDefault();const st=e.shiftKey?.25:.05,n=favStep({x,y},k[0]*st,k[1]*st);onMove(n.x,n.y)};
 return <div className="mc-fav-area" style={{left:FAV_PAD,top:FAV_PAD,width:W,height:H}}>
  <div ref={ref} className={'mc-fav'+(cur.y>.5?' up':'')+(pos?' moving':'')} role="toolbar" aria-label="Oblíbené nástroje" style={{left:cur.x*100+'%',top:cur.y*100+'%',transform:`translate(${-cur.x*100}%,${-cur.y*100}%)`}}>
   <button type="button" className="mc-fav-grip" aria-label="Přesunout panel oblíbených (táhni nebo šipky)" title="Přesunout panel (táhni)" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}><GripVertical size={14} aria-hidden/></button>
   {tools.map(t=>{const {Icon,hint}=TOOL_META[t],pn=presetName(t);return <button key={t} type="button" className={'mc-tool'+(tool===t?' on':'')} aria-pressed={tool===t} aria-label={DRAW_LABELS[t]+(pn?' (preset '+pn+')':'')} data-tip={DRAW_LABELS[t]+(pn?' · preset „'+pn+'“':'')+' · '+hint} disabled={disabled} onClick={()=>onPick(t)}><Icon size={17} strokeWidth={1.8} aria-hidden/></button>})}
  </div>
 </div>;
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
function StylePanel({d,tf,tfList:TF_LIST,onPatch,onStyle,focusRR,onFocusedRR,market,...pp}:{d:Drawing;market:string;tf:ChartTf;tfList:readonly ChartTf[];onPatch:(p:Partial<Drawing>,group?:string)=>void;onStyle:(p:Partial<DrawStyle>,group?:string)=>void;focusRR:number;onFocusedRR:()=>void}&PresetProps){
 const st=styleOf(d),caps=capsOf(d.type),isText=d.type==='text',pos=d.type==='long'||d.type==='short'?d.type:null,ar=arrowEnds(st.arrow);
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
  {caps.arrow&&<div className="mc-row" role="group" aria-label="Šipky na koncích čáry"><span>Šipka</span>
   <label className="mc-check"><input type="checkbox" checked={ar.start} onChange={e=>onStyle({arrow:arrowOf(e.target.checked,ar.end)})}/>Na začátku</label>
   <label className="mc-check"><input type="checkbox" checked={ar.end} onChange={e=>onStyle({arrow:arrowOf(ar.start,e.target.checked)})}/>Na konci</label>
  </div>}
  {caps.label&&<div className="mc-row" role="group" aria-label="Popisek dotyku"><span>Popisek</span>
   <Seg label="Popisek dotyku nad, na nebo pod čarou" value={st.la} options={[['top','Nahoře'],['middle','Uprostřed'],['bottom','Dole']]} onPick={v=>onStyle({la:v==='top'?undefined:v})}/>
   <Seg label="Popisek dotyku u konce čáry" value={st.lx} options={[['left','Vlevo'],['right','Vpravo']]} onPick={v=>onStyle({lx:v==='right'?undefined:v})}/>
  </div>}
  {caps.levels&&<FibRows type={d.type} st={st} onStyle={onStyle}/>}
  {caps.mid&&<div className="mc-row" role="group" aria-label="Střední čára kanálu"><span>Střed</span>
   <label className="mc-check"><input type="checkbox" checked={st.mid} onChange={e=>onStyle({mid:e.target.checked?undefined:false})}/>Střední čára</label>
   {st.mid&&<>
    <Seg label="Rychlá volba polohy střední čáry" value={st.midp} options={MID_CHIPS.map(v=>[v,v.toLocaleString('cs-CZ')] as [number,string])} onPick={v=>onStyle({midp:v===.5?undefined:v})}/>
    <NumField className="mc-num" value={st.midp} label="Poloha střední čáry: 0 = čára z prvních dvou bodů, 1 = rovnoběžka" hint="Číslo 0 až 1" parse={t=>numInput(t,0,1,3)} onChange={v=>onStyle({midp:v===.5?undefined:v},'midp')}/>
    <Swatches value={st.midc} onPick={c=>onStyle({midc:c})} label="Barva střední čáry" custom={pp.colors}/>
   </>}
  </div>}
  <label className="mc-row"><span>Průhlednost</span><input type="range" min={10} max={100} step={5} value={Math.round(st.op*100)} aria-valuetext={Math.round(st.op*100)+' %'} onChange={e=>onStyle({op:Number(e.target.value)/100},'op')}/><em>{Math.round(st.op*100)} %</em></label>
  {(caps.fill||caps.border)&&<div className="mc-row">
   {caps.fill&&<label className="mc-check"><input type="checkbox" checked={st.fill} onChange={e=>onStyle({fill:e.target.checked})}/>Pozadí</label>}
   {caps.border&&<label className="mc-check"><input type="checkbox" checked={st.border} onChange={e=>onStyle({border:e.target.checked})}/>Okraj</label>}
   {caps.border&&st.border&&<Swatches value={st.bc} onPick={c=>onStyle({bc:c})} label="Barva okraje" custom={pp.colors}/>}
  </div>}
  {caps.vp&&<>
   <div className="mc-row" role="group" aria-label="Řádky a value area"><span>Řádky</span>
    <NumField className="mc-num" value={st.vr} label="Počet řádků profilu (4–200)" hint="Celé číslo 4 až 200" parse={t=>numInput(t,4,200,0)} onChange={v=>onStyle({vr:v===24?undefined:v},'vr')}/>
    <span className="mc-row-label">Value area</span><NumField className="mc-num" value={st.va} label="Value area v % objemu (10–100)" hint="Celé číslo 10 až 100" parse={t=>numInput(t,10,100,0)} onChange={v=>onStyle({va:v===70?undefined:v},'va')}/><em>%</em>
   </div>
   <div className="mc-row"><span>Histogram</span><Seg label="Strana histogramu" value={st.vs} options={[['left','Vlevo'],['right','Vpravo']]} onPick={v=>onStyle({vs:v==='left'?undefined:v})}/></div>
   <label className="mc-row"><span>Šířka</span><input type="range" min={5} max={100} step={5} value={st.vw} aria-valuetext={st.vw+' % rozsahu'} onChange={e=>onStyle({vw:Number(e.target.value)===30?undefined:Number(e.target.value)},'vw')}/><em>{st.vw} %</em></label>
   <div className="mc-row" role="group" aria-label="Čáry profilu"><span>Zobrazit</span>
    <label className="mc-check"><input type="checkbox" checked={st.vpoc} onChange={e=>onStyle({vpoc:e.target.checked?undefined:false})}/>POC</label>
    <label className="mc-check"><input type="checkbox" checked={st.vva} onChange={e=>onStyle({vva:e.target.checked?undefined:false})}/>Hranice value area</label>
    <label className="mc-check"><input type="checkbox" checked={st.extR} onChange={e=>onStyle({extR:e.target.checked||undefined})}/>POC doprava</label>
   </div>
  </>}
  {caps.extend&&!caps.vp&&<div className="mc-row"><span>Prodloužit</span>
   <label className="mc-check"><input type="checkbox" checked={st.extL} onChange={e=>onStyle({extL:e.target.checked})}/>Doleva</label>
   <label className="mc-check"><input type="checkbox" checked={st.extR} onChange={e=>onStyle({extR:e.target.checked})}/>Doprava</label>
  </div>}
  {pos&&<div className="mc-row"><label className="mc-row-label" htmlFor="mc-rr">R:R</label>
   <input id="mc-rr" ref={rrRef} type="number" inputMode="decimal" min={RR_MIN} max={RR_MAX} step={0.1} value={rr} aria-describedby="mc-rr-hint" onChange={e=>changeRR(e.target.value,'rr')} onBlur={()=>setRr(fmtRR(rrOf(d.a)))}/>
   <span className="mc-seg-sm" role="group" aria-label="Rychlá volba R:R">{RR_CHIPS.map(v=><button key={v} type="button" className={Math.abs(rrNow-v)<.005?'on':''} aria-pressed={Math.abs(rrNow-v)<.005} onClick={()=>changeRR(String(v))}>{v.toLocaleString('cs-CZ')}</button>)}</span>
   <small id="mc-rr-hint" className="mc-hint">cíl se přepočítá ze vstupu a stopu ({RR_MIN.toLocaleString('cs-CZ')}–{RR_MAX})</small>
  </div>}
  {pos&&<div className="mc-row"><span>Popisky</span>
   <label className="mc-check"><input type="checkbox" checked={st.tags} aria-describedby="mc-tags-hint" onChange={e=>onStyle({tags:e.target.checked||undefined})}/>Vždy zobrazit</label>
   <small id="mc-tags-hint" className="mc-hint">jinak cíl, stop, R:R a ceny na ose jen u vybrané pozice</small>
  </div>}
  {caps.risk&&<label className="mc-row"><span>Riziko</span><input type="text" inputMode="decimal" value={risk} placeholder="částka (volitelné)" onChange={e=>changeRisk(e.target.value)}/></label>}
  {pos&&<SizingRow d={d} market={market}/>}
  <div className="mc-row" role="group" aria-label="Viditelnost na časových rámcích"><span>Vidět na</span>
   {TF_LIST.map(t=>{const on=visibleOn(d,t),only=on&&(d.tfs?.length===1||TF_LIST.length===1);return <label key={t} className={'mc-check'+(t===tf?' cur':'')}><input type="checkbox" checked={on} disabled={only} title={only?'Aspoň jeden časový rámec':undefined} onChange={()=>onPatch({tfs:toggleTf(d.tfs,t,TF_LIST)})}/>{t}</label>})}
  </div>
  <PresetRow d={d} {...pp}/>
 </div>;
}
// hladiny Fibonacciho (jako v TradingView): zapnout/vypnout, upravit hodnotu, přidat/odebrat vlastní; popisky hladina/cena, poměr/procenta
function FibRows({type,st,onStyle}:{type:DrawType;st:FullStyle;onStyle:(p:Partial<DrawStyle>,group?:string)=>void}){
 const lv=st.lv,def=defaultLevels(type),[focus,setFocus]=useState<number|null>(null);
 // seznam shodný s výchozím se neukládá (kresba sleduje výchozí hladiny)
 const set=(next:FibLevel[],group?:string)=>onStyle({lv:sameLevels(next,def)?undefined:next},group);
 const add=()=>{const v=nextLevel(lv);if(v===null)return;setFocus(lv.length);set([...lv,{v,on:true}])};
 return <>
  <div className="mc-row mc-row-top" role="group" aria-label="Hladiny Fibonacciho"><span>Hladiny</span>
   <div className="mc-fib-lv">
    {lv.map((l,i)=><span key={i} className={'mc-fib-item'+(l.on?'':' off')}>
     <input type="checkbox" checked={l.on} aria-label={'Zobrazit hladinu '+fibLabel(l.v)} onChange={e=>set(lv.map((x,j)=>j===i?{...x,on:e.target.checked}:x))}/>
     <NumField value={l.v} label="Hodnota hladiny" hint="Hodnota −5 až 10, každá hladina jen jednou" parse={t=>{const n=levelInput(t);return n!==null&&!lv.some((x,j)=>j!==i&&x.v===n)?n:null}} focus={focus===i} onFocused={()=>setFocus(null)} onChange={v=>set(lv.map((x,j)=>j===i?{...x,v}:x),'lv'+i)}/>
     <button type="button" className="mc-fib-x" aria-label={'Odebrat hladinu '+fibLabel(l.v)} title="Odebrat hladinu" onClick={()=>set(lv.filter((_,j)=>j!==i))}>×</button>
    </span>)}
    <button type="button" className="mc-chip" disabled={lv.length>=MAX_FIB_LEVELS} title={lv.length>=MAX_FIB_LEVELS?`Nejvýš ${MAX_FIB_LEVELS} hladin`:'Přidat vlastní hladinu'} onClick={add}>+ Hladina</button>
    {!sameLevels(lv,def)&&<button type="button" className="mc-chip" title="Vrátit výchozí seznam hladin" onClick={()=>onStyle({lv:undefined})}>Výchozí hladiny</button>}
   </div>
  </div>
  <div className="mc-row"><span>Popisky</span><Seg label="Popisky hladin" value={st.lb} options={[['both','Hladina a cena'],['level','Hladina'],['price','Cena'],['none','Skrýt']]} onPick={v=>onStyle({lb:v==='both'?undefined:v})}/></div>
  {(st.lb==='both'||st.lb==='level')&&<div className="mc-row"><span>Hladina jako</span><Seg label="Hladina jako poměr nebo procenta" value={st.pct?'pct':'ratio'} options={[['ratio','0,618'],['pct','61,8 %']]} onPick={v=>onStyle({pct:v==='pct'||undefined})}/></div>}
 </>;
}
const fmtNum=(v:number)=>String(v).replace('.',',');
// číselné pole (čárka i tečka): při psaní se ukládá jen platná hodnota (parse → null = neplatná); po opuštění pole se ukáže uložená
function NumField({value,label,hint,parse,onChange,focus=false,onFocused,className}:{value:number;label:string;hint:string;parse:(t:string)=>number|null;onChange:(v:number)=>void;focus?:boolean;onFocused?:()=>void;className?:string}){
 const [text,setText]=useState<string|null>(null),ref=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(focus){ref.current?.focus();ref.current?.select();onFocused?.()}},[focus,onFocused]);
 const bad=text!==null&&parse(text)===null;
 return <input ref={ref} type="text" inputMode="decimal" className={className} value={text??fmtNum(value)} aria-label={label} aria-invalid={bad||undefined} title={bad?hint:label}
  onFocus={()=>setText(fmtNum(value))} onBlur={()=>setText(null)} onChange={e=>{const t=e.target.value;setText(t);const n=parse(t);if(n!==null&&n!==value)onChange(n)}}
  onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur()}}/>;
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
   {presets.map(p=><span key={p.id} className="mc-preset"><button type="button" title={'Použít preset na tuto kresbu'} onClick={()=>{onApplyPreset(p)}}><i className="mc-preset-dot" style={{background:swatchBg(p.color)}} aria-hidden/>{p.name}</button>{!isBuiltin(p.id)&&<button type="button" className="mc-preset-x" aria-label={'Smazat preset '+p.name} title="Smazat preset" onClick={()=>onDeletePreset(p.id)}>×</button>}</span>)}
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
