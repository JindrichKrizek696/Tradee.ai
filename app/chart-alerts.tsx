'use client';
// Alerty v grafu: aktivní cenové alerty jako čárkované vodorovné čáry se zvonkem, tah čárou změní úroveň (uloží se), klik otevře úpravu / smazání.
// Nový alert: zvonek v liště grafu (aktuální cena), pravé tlačítko myši nebo dlouhý stisk na grafu → „Alert na této ceně“.
import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {Bell,Pencil} from 'lucide-react';
import {LineStyle,type IChartApi,type IPriceLine,type ISeriesApi,type SeriesType} from 'lightweight-charts';
import {isPriceKind} from '@/lib/alerts/logic';
import {useAlerts,saveAlert,type ClientAlert} from './alerts/alert-api';
import {AlertForm,levelStr} from './alerts/alert-form';
import './alerts/alerts.css';
type Pt={x:number;y:number};
type Menu={x:number;y:number;price:number;hit:ClientAlert|null};
const COLOR='#f59e0b';
const TAG:Record<string,string>={above:'nad',below:'pod',touch:'dotyk'};
export function useChartAlerts({chart,series,ver,el,instrument,name,busy,lastPrice,score}:{chart:RefObject<IChartApi|null>;series:RefObject<ISeriesApi<SeriesType>|null>;ver:number;el:RefObject<HTMLDivElement|null>;instrument:string;name:string;busy:()=>boolean;lastPrice:number|null;score?:number|null}){
 const {data}=useAlerts(instrument);
 const lines=useRef(new Map<string,{line:IPriceLine;a:ClientAlert}>());
 const [form,setForm]=useState<{alert?:ClientAlert;level?:number}|null>(null),[menu,setMenu]=useState<Menu|null>(null),[drag,setDrag]=useState<{y:number;text:string}|null>(null),[err,setErr]=useState('');
 const list=(data?.alerts||[]).filter(a=>a.active&&isPriceKind(a.kind)&&a.level!==null);
 const key=list.map(a=>a.id+':'+a.level+':'+a.kind+':'+(a.note||'')).join('|');
 // čáry na cenové sérii (po výměně série – ver – znovu)
 useEffect(()=>{
  const s=series.current;if(!s)return;const map=lines.current;
  for(const a of list)map.set(a.id,{a,line:s.createPriceLine({price:a.level as number,color:COLOR,lineStyle:LineStyle.Dashed,lineWidth:1,title:'🔔 '+TAG[a.kind]+(a.note?' · '+a.note.slice(0,24):''),axisLabelVisible:true,axisLabelColor:COLOR,axisLabelTextColor:'#111'})});
  return()=>{for(const {line} of map.values()){try{s.removePriceLine(line)}catch{}}map.clear()};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[ver,key]);
 // tah čáry, klik na čáru, pravé tlačítko, dlouhý stisk
 const S=useRef({busy,lastPrice});useLayoutEffect(()=>{S.current={busy,lastPrice}});
 useEffect(()=>{
  const box=el.current as HTMLDivElement|null;if(!box)return;
  const B:HTMLDivElement=box;
  const pos=(cx:number,cy:number):Pt=>{const r=box.getBoundingClientRect();return {x:cx-r.left,y:cy-r.top}};
  const pt=(e:MouseEvent|TouchEvent)=>{const t='touches' in e?e.touches[0]??e.changedTouches[0]:e;return t?pos(t.clientX,t.clientY):null};
  const inPane=(p:Pt)=>{const c=chart.current;if(!c)return false;const h=c.panes()[0]?.getHeight()??0;return p.x>=0&&p.x<=c.timeScale().width()+70&&p.y>=0&&p.y<=h};
  const hitAt=(p:Pt,tol:number)=>{const s=series.current;if(!s)return null;let best:{id:string;d:number}|null=null;
   for(const [id,{a}] of lines.current){const y=s.priceToCoordinate(a.level as number);if(y===null)continue;const d=Math.abs(y-p.y);if(d<=tol&&(!best||d<best.d))best={id,d}}
   return best?lines.current.get(best.id)!:null};
  let g:{id:string;a:ClientAlert;line:IPriceLine;y0:number;moved:boolean;level:number}|null=null,press:ReturnType<typeof setTimeout>|null=null,p0:Pt|null=null;
  const cancelPress=()=>{if(press){clearTimeout(press);press=null}};
  const openMenu=(p:Pt)=>{const s=series.current;if(!s)return;const price=s.coordinateToPrice(p.y);if(price===null||!(price>0))return;const h=hitAt(p,8);setMenu({x:p.x,y:p.y,price,hit:h?.a??null})};
  function down(e:MouseEvent|TouchEvent){
   const touch='touches' in e;if(!touch&&(e as MouseEvent).button!==0)return;
   if(e.defaultPrevented||S.current.busy())return;
   const p=pt(e);if(!p||!inPane(p))return;
   setMenu(null);
   if(touch&&e.touches.length===1){p0=p;cancelPress();press=setTimeout(()=>{press=null;if(!g||!g.moved){g=null;openMenu(p)}},550)}
   const h=hitAt(p,touch?12:5);if(!h)return;
   e.stopPropagation();if(e.cancelable)e.preventDefault();
   g={id:h.a.id,a:h.a,line:h.line,y0:p.y,moved:false,level:h.a.level as number};
  }
  function move(e:MouseEvent|TouchEvent){
   const p=pt(e);if(!p)return;
   if(press&&p0&&Math.hypot(p.x-p0.x,p.y-p0.y)>8)cancelPress();
   if(!g){if(!('touches' in e)){const on=!S.current.busy()&&inPane(p)&&!!hitAt(p,5);if(on!==(B.dataset.alertHover==='1'))B.dataset.alertHover=on?'1':''}return}
   if('touches' in e&&e.cancelable)e.preventDefault();
   if(!g.moved&&Math.abs(p.y-g.y0)<3)return;
   g.moved=true;cancelPress();
   const s=series.current,v=s?.coordinateToPrice(p.y);if(v===null||v===undefined||!(v>0))return;
   g.level=Number(levelStr(v));g.line.applyOptions({price:g.level});setDrag({y:p.y,text:'🔔 '+levelStr(g.level)});
  }
  async function up(){
   cancelPress();const d=g;g=null;if(!d)return;setDrag(null);
   if(!d.moved){setForm({alert:d.a});return}
   if(d.level===d.a.level)return;
   try{setErr('');await saveAlert({level:d.level},d.id)}catch(x){d.line.applyOptions({price:d.a.level as number});setErr((x as Error).message)}
  }
  const ctx=(e:MouseEvent)=>{if(S.current.busy())return;const p=pt(e);if(!p||!inPane(p))return;e.preventDefault();openMenu(p)};
  const opt={capture:true,passive:false} as const;
  box.addEventListener('mousedown',down,opt);box.addEventListener('touchstart',down,opt);box.addEventListener('contextmenu',ctx);
  window.addEventListener('mousemove',move);window.addEventListener('touchmove',move,{passive:false});
  window.addEventListener('mouseup',up);window.addEventListener('touchend',up);window.addEventListener('touchcancel',up);
  return()=>{cancelPress();box.removeEventListener('mousedown',down,opt);box.removeEventListener('touchstart',down,opt);box.removeEventListener('contextmenu',ctx);window.removeEventListener('mousemove',move);window.removeEventListener('touchmove',move);window.removeEventListener('mouseup',up);window.removeEventListener('touchend',up);window.removeEventListener('touchcancel',up)};
 },[chart,series,el]);
 // menu zavře klik jinam / Esc
 useEffect(()=>{if(!menu)return;const c=(e:MouseEvent)=>{if(!(e.target as HTMLElement)?.closest?.('.mc-al-menu'))setMenu(null)},k=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(null)};
  const t=setTimeout(()=>{window.addEventListener('mousedown',c);window.addEventListener('keydown',k)},0);return()=>{clearTimeout(t);window.removeEventListener('mousedown',c);window.removeEventListener('keydown',k)}},[menu]);
 const button=<button type="button" className="mc-chip mc-icon" aria-label="Nový alert na aktuální ceně" title="Alert na aktuální ceně (nebo pravé tlačítko myši v grafu)" onClick={()=>setForm({level:lastPrice??undefined})}><Bell size={14} aria-hidden/>{list.length>0&&<span className="mc-count">{list.length}</span>}</button>;
 const overlay=<>
  {menu&&<div className="mc-al-menu" role="menu" style={{left:Math.max(4,menu.x),top:menu.y}}>
   <button type="button" role="menuitem" onClick={()=>{setForm({level:Number(levelStr(menu.price))});setMenu(null)}}><Bell size={14} aria-hidden/>Alert na této ceně ({levelStr(menu.price)})</button>
   {menu.hit&&<button type="button" role="menuitem" onClick={()=>{setForm({alert:menu.hit!});setMenu(null)}}><Pencil size={14} aria-hidden/>Upravit alert</button>}
  </div>}
  {drag&&<div className="mc-al-drag" style={{top:drag.y}}>{drag.text}</div>}
  {err&&<div className="mc-al-menu" role="alert" style={{left:8,top:8}} onClick={()=>setErr('')}><span style={{padding:8,fontSize:13}}>{err}</span></div>}
 </>;
 const modal=form&&<AlertForm key={form.alert?.id||'new'} instrument={instrument} name={name} alert={form.alert} level={form.level} price={lastPrice} score={score??null} pushAvailable={data?.pushAvailable} onClose={()=>setForm(null)}/>;
 return {button,overlay,modal,count:list.length};
}
