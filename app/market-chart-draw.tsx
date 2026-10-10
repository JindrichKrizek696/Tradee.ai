'use client';
// Kreslení v grafu trhu: nástroje, výběr a tažení kreseb, ukládání per uživatel × trh (/api/chart/drawings).
import {useEffect,useLayoutEffect,useMemo,useRef,useState,type RefObject} from 'react';
import type {IChartApi,ISeriesApi,Logical} from 'lightweight-charts';
import {MousePointer2,TrendingUp,Minus,RectangleHorizontal,AlignVerticalDistributeCenter,Type,Ruler,Magnet,Eraser,Trash2,MoveUpRight,PencilLine,Pin} from 'lucide-react';
import {chartTime} from '@/lib/journal/chart-data';
import {TF_SEC} from '@/lib/chart/layers';
import type {Tf} from '@/lib/chart/candles';
import {ANCHORS,COLOR_LABELS,DRAW_COLORS,DRAW_LABELS,MAX_DRAWINGS,MAX_TEXT,fromChartTime,logicalOf,measure,measureLines,newId,parseDrawings,snapPrice,timeOfLogical,translate,type Anchor,type DrawColor,type DrawType,type Drawing,type Pt} from '@/lib/chart/drawings';
import {DrawingsPrimitive,type DrawPalette} from './chart-drawings';
import {fmtPrice} from './live';

export type Tool='cursor'|DrawType;
type Bar={time:number;open:number;high:number;low:number;close:number};
type Save='idle'|'saving'|'saved'|'error'|'loaderror';
type Drag={id:string;temp:boolean;part:'body'|'handle';index:number;start:{l:number;p:number};orig:Drawing;cur:Drawing|null;x:number;y:number};
type Draft={d:Drawing;x:number;y:number;placed:boolean};
type Edit={x:number;y:number;anchor:Anchor;id?:string;text:string};
const TOOLS:{tool:Tool;label:string;Icon:typeof Minus;hint?:string}[]=[
 {tool:'cursor',label:'Kurzor',Icon:MousePointer2,hint:'výběr a posun kreseb'},
 {tool:'trend',label:DRAW_LABELS.trend,Icon:TrendingUp,hint:'2 body'},
 {tool:'hline',label:DRAW_LABELS.hline,Icon:Minus,hint:'1 cena'},
 {tool:'rect',label:DRAW_LABELS.rect,Icon:RectangleHorizontal,hint:'2 rohy'},
 {tool:'fib',label:DRAW_LABELS.fib,Icon:AlignVerticalDistributeCenter,hint:'2 body'},
 {tool:'text',label:DRAW_LABELS.text,Icon:Type,hint:'1 bod'},
 {tool:'measure',label:DRAW_LABELS.measure,Icon:Ruler,hint:'2 body, neukládá se'},
];
const SAVE_TEXT:Record<Exclude<Save,'idle'>,string>={saving:'Ukládám kresby…',saved:'Uloženo',error:'Kresby se nepodařilo uložit',loaderror:'Kresby se nepodařilo načíst'};
const css=(name:string,fallback:string)=>getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback;
// barvu z CSS (i color-mix, var) převést na #rrggbb / rgba() přes plátno, aby šla průhlednost
let probe:CanvasRenderingContext2D|null=null;
function norm(c:string,fallback:string){try{probe??=document.createElement('canvas').getContext('2d');if(!probe)return c;probe.fillStyle=fallback;probe.fillStyle=c;return String(probe.fillStyle)}catch{return c}}
const editable=(t:EventTarget|null)=>t instanceof HTMLElement&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function useChartDrawings({chart,series,el,bars,tf,instrument,tick}:{chart:RefObject<IChartApi|null>;series:RefObject<ISeriesApi<'Candlestick'>|null>;el:RefObject<HTMLDivElement|null>;bars:Bar[];tf:Tf;instrument:string;tick:number}){
 const [tool,setTool]=useState<Tool>('cursor');
 const [drawings,setDrawings]=useState<Drawing[]>([]),[temp,setTemp]=useState<Drawing|null>(null),[selected,setSelected]=useState<string|null>(null);
 const [magnet,setMagnet]=useState(false),[color,setColor]=useState<DrawColor>('brand');
 const [edit,setEdit]=useState<Edit|null>(null),[save,setSave]=useState<Save>('idle'),[saveError,setSaveError]=useState('');
 // aktuální stav pro handlery myši (registrují se jednou)
 const S=useRef({tool,drawings,temp,selected,magnet,color,bars,times:[] as number[],tf,instrument});
 const times=useMemo(()=>bars.map(b=>b.time),[bars]);
 useLayoutEffect(()=>{S.current={tool,drawings,temp,selected,magnet,color,bars,times,tf,instrument}});
 const draft=useRef<Draft|null>(null),drag=useRef<Drag|null>(null);
 const dirty=useRef(false),loaded=useRef<string|null>(null),pending=useRef<{instrument:string;drawings:Drawing[]}|null>(null);

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
   measureLines:d=>measureLines(measure(d.a[0],d.a[1],conv.toL(d.a[0].t),conv.toL(d.a[1].t)),fmtPrice),
  });
  return {conv,prim};
 });
 // bod pod kurzorem: logický index a cena; kotva = střed svíčky (+ magnet na O/H/L/C)
 const raw=(p:Pt)=>{const ax=conv.axis(),price=series.current?.coordinateToPrice(p.y);if(!ax||price==null)return null;return {l:(p.x-ax.x0)/ax.dx,p:price}};
 const anchorAt=(p:Pt):Anchor|null=>{const r=raw(p);if(!r)return null;const i=Math.round(r.l),bar=S.current.magnet?S.current.bars[i]:undefined;return {t:Math.round(conv.fromL(i)),p:bar?snapPrice(bar,r.p):r.p}};

 // připojení primitiva k sérii svíček
 useEffect(()=>{const s=series.current,pr=prim;s?.attachPrimitive(pr);return()=>{try{s?.detachPrimitive(pr)}catch{}}},[series]);
 useEffect(()=>{const pr=prim;pr.drawings=drawings;pr.temp=temp;pr.selected=selected;pr.update()},[drawings,temp,selected,times,tf]);
 // barvy z palety a motivu (překreslit při změně)
 useEffect(()=>{
  const fg=css('--t-fg','#0b0c0e');
  const pal:DrawPalette={brand:norm(css('--t-brand','#245bff'),'#245bff'),bull:norm(css('--bull','#16a34a'),'#16a34a'),bear:norm(css('--bear','#dc2626'),'#dc2626'),amber:'#f59e0b',muted:norm(css('--t-muted','#6b7079'),'#6b7079'),fg:norm(fg,'#0b0c0e'),bg:norm(css('--t-surface','#ffffff'),'#ffffff'),text:norm(fg,'#0b0c0e')};
  prim.palette=pal;prim.update();
 },[tick]);
 // při kreslení graf neposouvat ani nezoomovat (tahy kreslí)
 useEffect(()=>{const c=chart.current;if(!c)return;const free=tool==='cursor';c.applyOptions({handleScroll:free,handleScale:free})},[tool,chart]);

 const commit=(next:Drawing[])=>{dirty.current=true;setDrawings(next)};
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

 // myš a dotyk: zachytit dřív než graf (capture), aby kreslení a tažení kresby neposouvalo graf
 useEffect(()=>{
  const box=el.current;if(!box)return;
  const pos=(cx:number,cy:number):Pt=>{const r=box.getBoundingClientRect();return {x:cx-r.left,y:cy-r.top}};
  const inPane=(p:Pt)=>{const c=chart.current;if(!c)return false;const h=c.panes()[0]?.getHeight()??0;return p.x>=0&&p.x<=c.timeScale().width()&&p.y>=0&&p.y<=h};
  const point=(e:MouseEvent|TouchEvent)=>{const t='touches' in e?e.touches[0]??e.changedTouches[0]:e;return t?pos(t.clientX,t.clientY):null};
  const stop=(e:Event)=>{e.stopPropagation();if(e.cancelable)e.preventDefault()};
  function down(e:MouseEvent|TouchEvent){
   if(!('touches' in e)&&e.button!==0)return;
   const p=point(e),st=S.current;if(!p||!inPane(p)||!st.times.length)return;
   const touch='touches' in e;
   if(draft.current){stop(e);const a=anchorAt(p);if(a){const d={...draft.current.d,a:[draft.current.d.a[0],a]};if(Math.hypot(p.x-draft.current.x,p.y-draft.current.y)>3)finish(d);else{draft.current.placed=false}}return}
   if(st.tool!=='cursor'){
    stop(e);const a=anchorAt(p);if(!a)return;
    if(st.tool==='hline'){finish({id:newId(),type:'hline',a:[a],color:st.color});return}
    if(st.tool==='text'){setTool('cursor');setEdit({x:p.x,y:p.y,anchor:a,text:''});return}
    const d:Drawing={id:newId(),type:st.tool,a:[a,a],color:st.color};
    draft.current={d,x:p.x,y:p.y,placed:false};prim.draft=d;prim.update();return;
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
   if(dr){if('touches' in e&&e.cancelable)e.preventDefault();const a=anchorAt(p);if(!a)return;dr.d={...dr.d,a:[dr.d.a[0],a]};if(Math.hypot(p.x-dr.x,p.y-dr.y)>3)dr.placed=true;prim.draft=dr.d;prim.update();return}
   const g=drag.current;if(!g)return;
   if('touches' in e&&e.cancelable)e.preventDefault();
   if(!g.cur&&Math.hypot(p.x-g.x,p.y-g.y)<3)return;
   let next:Drawing|null=null;
   if(g.part==='handle'){const a=anchorAt(p);if(a)next={...g.orig,a:g.orig.a.map((x,i)=>i===g.index?a:x)}}
   else{const r=raw(p);if(r)next=translate(g.orig,Math.round(r.l-g.start.l),r.p-g.start.p,conv.toL,t=>Math.round(conv.fromL(t)))}
   if(!next)return;g.cur=next;
   const pr=prim;
   if(g.temp)pr.temp=next;else pr.drawings=S.current.drawings.map(d=>d.id===g.id?next:d);
   pr.update();
  }
  function up(e:MouseEvent|TouchEvent){
   const dr=draft.current;
   // tah s myší (stisk–táhnout–pustit) dokončí kresbu; klik nechá čekat na druhý bod
   if(dr){if(dr.placed){const p=point(e),a=p&&anchorAt(p);finish(a?{...dr.d,a:[dr.d.a[0],a]}:dr.d)}return}
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
 // klávesy: Esc zruší, Delete/Backspace smaže vybranou kresbu
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   if(editable(e.target))return;const st=S.current;
   if(e.key==='Escape'&&(st.tool!=='cursor'||draft.current||drag.current||st.selected||st.temp)){cancel();setSelected(null);setTemp(null)}
   else if((e.key==='Delete'||e.key==='Backspace')&&st.selected){e.preventDefault();remove(st.selected)}
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);

 // načtení kreseb trhu; při odchodu z trhu dořešit čekající uložení
 const send=(payload:{instrument:string;drawings:Drawing[]},keepalive=false)=>{
  if(pending.current!==payload)return;pending.current=null;
  if(payload.instrument===S.current.instrument)setSave('saving');
  fetch('/api/chart/drawings?instrument='+encodeURIComponent(payload.instrument),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({drawings:payload.drawings}),keepalive}).then(async r=>{
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

 // úpravy vybrané kresby
 const current=selected?(temp?.id===selected?temp:drawings.find(d=>d.id===selected))??null:null;
 const patch=(p:Partial<Drawing>)=>{if(!current)return;const next={...current,...p};if(temp?.id===current.id)setTemp(next);else commit(drawings.map(d=>d.id===current.id?next:d))};
 const pickColor=(c:DrawColor)=>{setColor(c);patch({color:c})};
 const pin=()=>{if(!temp)return;if(drawings.length>=MAX_DRAWINGS){setSave('error');setSaveError(`Na jednom trhu může být nejvýš ${MAX_DRAWINGS} kreseb.`);return}commit([...drawings,temp]);setTemp(null)};
 const editText=()=>{if(!current||current.type!=='text')return;const p=prim.env.project(current.a[0]);if(p)setEdit({x:p.x,y:p.y,anchor:current.a[0],id:current.id,text:current.text||''})};
 const saveText=(text:string)=>{
  const e=edit;setEdit(null);if(!e)return;const v=text.trim().slice(0,MAX_TEXT);
  if(e.id){if(v)commit(drawings.map(d=>d.id===e.id?{...d,text:v}:d));return}
  if(!v)return;if(drawings.length>=MAX_DRAWINGS){setSave('error');setSaveError(`Na jednom trhu může být nejvýš ${MAX_DRAWINGS} kreseb.`);return}
  const d:Drawing={id:newId(),type:'text',a:[e.anchor],color,text:v};commit([...drawings,d]);setSelected(d.id);
 };
 const clearAll=()=>{if(!drawings.length&&!temp)return;if(!window.confirm(`Smazat všechny kresby na tomto trhu (${drawings.length})? Tuto akci nelze vrátit.`))return;setTemp(null);setSelected(null);commit([])};
 const pickTool=(t:Tool)=>{cancel();setEdit(null);setTool(t===tool&&t!=='cursor'?'cursor':t);if(t!=='cursor'){setSelected(null);setTemp(null)}};

 const disabled=!bars.length;
 const toolbar=<div className="mc-tools" role="toolbar" aria-label="Kreslení v grafu">
  {TOOLS.map(({tool:t,label,Icon,hint})=><button key={t} type="button" className={'mc-tool'+(tool===t?' on':'')} aria-pressed={tool===t} aria-label={label} data-tip={label+(hint?' · '+hint:'')} disabled={disabled&&t!=='cursor'} onClick={()=>pickTool(t)}><Icon size={17} strokeWidth={1.8} aria-hidden/></button>)}
  <span className="mc-tool-sep" aria-hidden/>
  <button type="button" className={'mc-tool'+(magnet?' on':'')} aria-pressed={magnet} aria-label="Magnet" data-tip={'Magnet · přichytit k O/H/L/C svíčky'+(magnet?' (zapnuto)':'')} onClick={()=>setMagnet(m=>!m)}><Magnet size={17} strokeWidth={1.8} aria-hidden/></button>
  <button type="button" className="mc-tool" aria-label="Smazat vše" data-tip="Smazat všechny kresby na trhu" disabled={!drawings.length&&!temp} onClick={clearAll}><Eraser size={17} strokeWidth={1.8} aria-hidden/></button>
 </div>;
 const overlay=<>
  {current&&!edit&&<div className="mc-sel" role="group" aria-label={'Vybraná kresba: '+DRAW_LABELS[current.type]}>
   <span className="mc-sel-name">{DRAW_LABELS[current.type]}{temp?.id===current.id?' · dočasné':''}</span>
   {current.type!=='measure'&&<span className="mc-swatches">{DRAW_COLORS.map(c=><button key={c} type="button" className={'mc-swatch-btn'+(current.color===c?' on':'')} data-c={c} aria-label={'Barva: '+COLOR_LABELS[c]} aria-pressed={current.color===c} title={COLOR_LABELS[c]} onClick={()=>pickColor(c)}/>)}</span>}
   {current.type==='trend'&&<button type="button" className={'mc-tool sm'+(current.ray?' on':'')} aria-pressed={!!current.ray} aria-label="Prodloužit čáru" data-tip="Prodloužit čáru (polopřímka)" onClick={()=>patch({ray:!current.ray||undefined})}><MoveUpRight size={15} aria-hidden/></button>}
   {current.type==='text'&&<button type="button" className="mc-tool sm" aria-label="Upravit text" data-tip="Upravit text" onClick={editText}><PencilLine size={15} aria-hidden/></button>}
   {temp?.id===current.id&&<button type="button" className="mc-chip" onClick={pin}><Pin size={13} aria-hidden/> Připnout</button>}
   <button type="button" className="mc-tool sm danger" aria-label="Smazat kresbu" data-tip="Smazat (Delete)" onClick={()=>remove(current.id)}><Trash2 size={15} aria-hidden/></button>
  </div>}
  {edit&&<TextInput key={edit.id||edit.x+':'+edit.y} edit={edit} onDone={saveText} onCancel={()=>setEdit(null)}/>}
  {tool!=='cursor'&&<div className="mc-draw-hint" role="status">{DRAW_LABELS[tool]}: {ANCHORS[tool]===1?'klikni do grafu':'klikni na dva body (nebo táhni)'} · Esc zruší</div>}
 </>;
 const status=save!=='idle'?<span className={'mc-saved'+(save==='error'||save==='loaderror'?' err':'')} role="status">{SAVE_TEXT[save]}{save==='error'&&saveError?': '+saveError:''}</span>:null;
 return {toolbar,overlay,status,drawing:tool!=='cursor'};
}

function TextInput({edit,onDone,onCancel}:{edit:Edit;onDone:(v:string)=>void;onCancel:()=>void}){
 const [v,setV]=useState(edit.text),done=useRef(false);
 const end=(ok:boolean)=>{if(done.current)return;done.current=true;if(ok)onDone(v);else onCancel()};
 return <input className="mc-text-input" style={{left:edit.x,top:edit.y}} autoFocus maxLength={MAX_TEXT} value={v} placeholder="Text kresby…" aria-label="Text kresby"
  onChange={e=>setV(e.target.value)} onBlur={()=>end(true)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();end(true)}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();end(false)}}}/>;
}
