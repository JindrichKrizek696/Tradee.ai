'use client';
// Záložky grafu na stránce /graf: pracovní kontexty (trh + TF + rozvržení) – nová, duplikovat, přejmenovat, přesunout tažením, zavřít, obnovit nedávno zavřenou i s kresbami;
// tečka = neuložené změny; stav autosave („Uloženo“ / „Ukládám…“ / „Chyba synchronizace – zkusit znovu“) a pojmenovaná rozvržení (volitelně se svázanou verzí strategie).
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Plus,Copy,Pencil,X,History,LayoutTemplate,Check,Trash2,RotateCcw,CloudOff,Cloud,Loader2} from 'lucide-react';
import {MAX_TABS,MAX_LAYOUTS,MAX_LAYOUT_NAME,MAX_TAB_NAME,SAVE_LABELS,emptyWorkspace,newTab,addTab,duplicateTab,renameTab,moveTab,closeTab,restoreTab,mergeDrawings,updateTab,applyLayout,layoutView,layoutChanged,dirtyTabs,parseWorkspace,parseLayouts,tabTitle,viewKey,readView,type Workspace,type Layout,type Tab,type ChartView,type SaveState,type StrategyRef} from '@/lib/chart/workspace';
import {newId,parseDrawings,type Drawing} from '@/lib/chart/drawings';

const json=async(r:Response)=>{const j=await r.json().catch(()=>({})) as Record<string,unknown>;if(!r.ok)throw new Error(typeof j.error==='string'?j.error:'Chyba '+r.status);return j};
const put=(url:string,body:unknown,keepalive=false)=>{const b=JSON.stringify(body);return fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:b,keepalive:keepalive&&b.length<60000}).then(json)};
// pracovní plocha: načtení, autosave 800 ms po změně, stav ukládání, rozvržení
export function useWorkspace(ids:readonly string[],start:{instrument:string|null;tf?:string;view:()=>ChartView}){
 const [ws,setWs]=useState<Workspace>(emptyWorkspace),[layouts,setLayouts]=useState<Layout[]>([]),[ready,setReady]=useState(false),[save,setSave]=useState<SaveState>('idle'),[error,setError]=useState('');
 const [savedWs,setSavedWs]=useState<Workspace|null>(null),[synced,setSynced]=useState(false);
 const saved=useRef<Workspace|null>(null),cur=useRef(ws),pending=useRef(false),loadOk=useRef(false);
 useLayoutEffect(()=>{cur.current=ws});
 // první záložka / přepnutí podle adresy (/graf/<trh>?tf=…)
 const fromUrl=useCallback((w:Workspace):Workspace=>{
  const inst=start.instrument;if(!inst)return w;
  const tfv=start.tf?readView({tf:start.tf}).tf:null,withTf=(t:Tab):Tab=>tfv&&tfv===start.tf?{...t,view:{...t.view,tf:tfv}}:t;
  const act=w.tabs.find(t=>t.id===w.active);
  if(act?.instrument===inst)return {...w,tabs:w.tabs.map(t=>t.id===act.id?withTf(t):t)};
  const other=w.tabs.find(t=>t.instrument===inst);
  if(other)return {...w,active:other.id,tabs:w.tabs.map(t=>t.id===other.id?withTf(t):t)};
  if(w.tabs.length>=MAX_TABS&&act)return {...w,tabs:w.tabs.map(t=>t.id===act.id?withTf({...t,instrument:inst,name:''}):t)};
  return addTab(w,withTf(newTab(newId(),inst,{...start.view(),focus:false})));
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 const load=useCallback(()=>{
  setSave('idle');setError('');
  fetch('/api/chart/workspace',{cache:'no-store'}).then(json).then(j=>{
   const w=parseWorkspace(j.workspace,ids);saved.current=w;setSavedWs(w);loadOk.current=true;setSynced(true);
   setLayouts(parseLayouts(j.layouts));setWs(fromUrl(w));setReady(true);
  }).catch(e=>{
   // bez načtené plochy se nic neukládá (nepřepsaly by se uložené záložky); graf jede v dočasné záložce
   loadOk.current=false;setWs(w=>w.tabs.length?w:fromUrl(emptyWorkspace()));setReady(true);setSave('error');setError(e instanceof Error?e.message:'');
  });
 },[ids,fromUrl]);
 useEffect(()=>{load()},[load]);
 // autosave
 const send=useCallback((w:Workspace,keepalive=false)=>{
  pending.current=false;setSave('saving');
  put('/api/chart/workspace',{workspace:w},keepalive).then(()=>{saved.current=w;setSavedWs(w);if(cur.current===w)setSave('saved');setError('')}).catch(e=>{setSave('error');setError(e instanceof Error?e.message:'')});
 },[]);
 useEffect(()=>{
  if(!ready||!loadOk.current||viewKey(ws)===viewKey(saved.current))return;
  pending.current=true;const t=setTimeout(()=>send(ws),800);return()=>clearTimeout(t);
 },[ws,ready,send]);
 useEffect(()=>{const f=()=>{if(pending.current&&loadOk.current)send(cur.current,true)};addEventListener('pagehide',f);return()=>removeEventListener('pagehide',f)},[send]);
 const retry=()=>{if(!loadOk.current)load();else send(cur.current)};
 const saveLayouts=(next:Layout[])=>{setLayouts(next);put('/api/chart/layouts',{layouts:next}).catch(e=>{setSave('error');setError(e instanceof Error?e.message:'Rozvržení se nepodařilo uložit.')})};
 return {ws,setWs,layouts,saveLayouts,ready,save,error,retry,dirty:dirtyTabs(savedWs,ws),synced};
}

type Props={ws:Workspace;layouts:Layout[];save:SaveState;error:string;dirty:Set<string>;name:(id:string)=>string;
 onChange:(w:Workspace)=>void;onLayouts:(l:Layout[])=>void;onRetry:()=>void;picker:(onPick:(id:string)=>void)=>React.ReactNode;
 snapshot:(tab:Tab)=>Promise<Drawing[]>;onRestored:(tab:Tab,drawings:Drawing[])=>Promise<void>};
export function ChartTabs({ws,layouts,save,error,dirty,name,onChange,onLayouts,onRetry,picker,snapshot,onRestored}:Props){
 const [editing,setEditing]=useState<string|null>(null),[drag,setDrag]=useState<number|null>(null),[menu,setMenu]=useState<'new'|'closed'|'layouts'|null>(null);
 const bar=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!menu)return;const f=(e:PointerEvent)=>{if(!bar.current?.querySelector('.mct-pop')?.contains(e.target as Node)&&!(e.target as HTMLElement).closest?.('[data-mct-menu]'))setMenu(null)};const k=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setMenu(null)}};document.addEventListener('pointerdown',f);document.addEventListener('keydown',k,true);return()=>{document.removeEventListener('pointerdown',f);document.removeEventListener('keydown',k,true)}},[menu]);
 const act=ws.tabs.find(t=>t.id===ws.active)??null,layout=act?.layoutId?layouts.find(l=>l.id===act.layoutId):undefined;
 const close=async(t:Tab)=>{let d:Drawing[]=[];try{d=await snapshot(t)}catch{}onChange(closeTab(ws,t.id,d,Date.now()))};
 const restore=async(i:number)=>{const r=restoreTab(ws,i,()=>newId());if(!r)return;setMenu(null);const tab=r.ws.tabs[r.ws.tabs.length-1];await onRestored(tab,r.drawings).catch(()=>{});onChange(r.ws)};
 const key=(e:React.KeyboardEvent,i:number)=>{
  if(e.ctrlKey&&e.shiftKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();onChange(moveTab(ws,i,i+(e.key==='ArrowLeft'?-1:1)))}
  else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const n=ws.tabs[(i+(e.key==='ArrowLeft'?-1:1)+ws.tabs.length)%ws.tabs.length];if(n){onChange({...ws,active:n.id});setTimeout(()=>bar.current?.querySelector<HTMLElement>(`[data-tab="${n.id}"]`)?.focus())}}
  else if(e.key==='F2'){e.preventDefault();setEditing(ws.tabs[i].id)}
 };
 const saveIcon=save==='saving'?<Loader2 size={13} className="mct-spin" aria-hidden/>:save==='error'?<CloudOff size={13} aria-hidden/>:<Cloud size={13} aria-hidden/>;
 return <div ref={bar} className="mct" role="toolbar" aria-label="Záložky grafu">
  <div className="mct-list" role="tablist" aria-label="Pracovní kontexty grafu">
   {ws.tabs.map((t,i)=>{const on=t.id===ws.active,title=tabTitle(t,name);return <div key={t.id} className={'mct-tab'+(on?' on':'')+(drag===i?' drag':'')} draggable={editing!==t.id}
     onDragStart={e=>{setDrag(i);e.dataTransfer.effectAllowed='move'}} onDragOver={e=>{if(drag!==null){e.preventDefault();e.dataTransfer.dropEffect='move'}}} onDrop={e=>{e.preventDefault();if(drag!==null)onChange(moveTab(ws,drag,i));setDrag(null)}} onDragEnd={()=>setDrag(null)}>
    {editing===t.id?<RenameInput value={t.name||title} onDone={v=>{setEditing(null);if(v!==null)onChange(renameTab(ws,t.id,v===title?t.name:v))}}/>
    :<button type="button" role="tab" data-tab={t.id} aria-selected={on} tabIndex={on?0:-1} className="mct-name" title={title+' – dvojklik přejmenuje, tažením přesuneš (Ctrl+Shift+šipka)'} onClick={()=>onChange({...ws,active:t.id})} onDoubleClick={()=>setEditing(t.id)} onKeyDown={e=>key(e,i)}>
     {dirty.has(t.id)&&<i className="mct-dot" title="Neuložené změny" aria-label="neuložené změny"/>}<span>{title}</span>
    </button>}
    {on&&editing!==t.id&&<>
     <button type="button" className="mct-x" aria-label={'Přejmenovat záložku '+title} title="Přejmenovat (F2)" onClick={()=>setEditing(t.id)}><Pencil size={12} aria-hidden/></button>
     <button type="button" className="mct-x" aria-label={'Duplikovat záložku '+title} title="Duplikovat záložku" disabled={ws.tabs.length>=MAX_TABS} onClick={()=>onChange(duplicateTab(ws,t.id,newId()))}><Copy size={12} aria-hidden/></button>
    </>}
    {ws.tabs.length>1&&<button type="button" className="mct-x" aria-label={'Zavřít záložku '+title} title="Zavřít (obnovíš v Nedávno zavřených)" onClick={()=>close(t)}><X size={13} aria-hidden/></button>}
   </div>})}
  </div>
  <div className="mct-tools">
   <div className="mct-menu">
    <button type="button" data-mct-menu className="mct-btn" aria-label="Nová záložka" title={ws.tabs.length>=MAX_TABS?`Nejvýš ${MAX_TABS} záložek`:'Nová záložka (vyber trh)'} disabled={ws.tabs.length>=MAX_TABS} aria-expanded={menu==='new'} onClick={()=>setMenu(m=>m==='new'?null:'new')}><Plus size={15} aria-hidden/></button>
    {menu==='new'&&<div className="mct-pop" role="dialog" aria-label="Nová záložka"><p className="mct-pop-t">Nová záložka – vyber trh</p>{picker(id=>{setMenu(null);onChange(addTab(ws,newTab(newId(),id,act?{...act.view,focus:false}:undefined)))})}</div>}
   </div>
   <div className="mct-menu">
    <button type="button" data-mct-menu className="mct-btn" aria-label="Nedávno zavřené záložky" title="Nedávno zavřené" disabled={!ws.closed.length} aria-expanded={menu==='closed'} onClick={()=>setMenu(m=>m==='closed'?null:'closed')}><History size={15} aria-hidden/>{ws.closed.length>0&&<span className="mc-count">{ws.closed.length}</span>}</button>
    {menu==='closed'&&<div className="mct-pop" role="dialog" aria-label="Nedávno zavřené záložky"><p className="mct-pop-t">Nedávno zavřené</p><ul className="mct-closed">{ws.closed.map((c,i)=><li key={c.tab.id+':'+c.closedAt}><span><b>{tabTitle(c.tab,name)}</b><small>{new Date(c.closedAt).toLocaleString('cs-CZ',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})}{c.drawings.length?' · '+c.drawings.length+' kreseb':''}</small></span><button type="button" className="mc-chip" disabled={ws.tabs.length>=MAX_TABS} onClick={()=>restore(i)}><RotateCcw size={12} aria-hidden/> Obnovit</button></li>)}</ul></div>}
   </div>
   <div className="mct-menu">
    <button type="button" data-mct-menu className={'mct-btn mct-lay'+(layout?' on':'')} aria-expanded={menu==='layouts'} title="Rozvržení: panely, nástroje, indikátory, seance" onClick={()=>setMenu(m=>m==='layouts'?null:'layouts')}><LayoutTemplate size={15} aria-hidden/><span>{layout?layout.name:'Rozvržení'}</span>{layout&&act&&layoutChanged(act,layout)&&<i className="mct-dot" title="Záložka se liší od rozvržení"/>}</button>
    {menu==='layouts'&&act&&<LayoutsMenu tab={act} layouts={layouts} onApply={l=>{onChange({...ws,tabs:ws.tabs.map(t=>t.id===act.id?applyLayout(t,l):t)});setMenu(null)}} onSave={onLayouts} onDetach={()=>onChange(updateTab(ws,act.id,{layoutId:null}))}/>}
   </div>
   {layout?.strategy&&<span className="mct-strat" title="Rozvržení je svázané s verzí strategie">Strategie: {layout.strategy.label}</span>}
   <span className={'mct-save '+save} role="status" aria-live="polite">{save!=='idle'&&<>{saveIcon}{save==='error'?<button type="button" className="mc-link" onClick={onRetry} title={error||undefined}>{SAVE_LABELS.error}</button>:SAVE_LABELS[save]}</>}</span>
  </div>
 </div>;
}
function RenameInput({value,onDone}:{value:string;onDone:(v:string|null)=>void}){
 const [v,setV]=useState(value),done=useRef(false);
 const end=(ok:boolean)=>{if(done.current)return;done.current=true;onDone(ok?v:null)};
 return <input className="mct-rename" autoFocus value={v} maxLength={MAX_TAB_NAME} aria-label="Název záložky (prázdný = trh a TF)" onFocus={e=>e.target.select()} onChange={e=>setV(e.target.value)} onBlur={()=>end(true)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();end(true)}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();end(false)}}}/>;
}
// rozvržení: použít na záložku, uložit aktuální pohled jako nové / přepsat, smazat; volitelně svázat s verzí strategie (z etapy 1A)
type Strat={id:string;name:string;archived:boolean;latest:{id:string;version:number}|null};
function LayoutsMenu({tab,layouts,onApply,onSave,onDetach}:{tab:Tab;layouts:Layout[];onApply:(l:Layout)=>void;onSave:(l:Layout[])=>void;onDetach:()=>void}){
 const [name,setName]=useState(''),[strat,setStrat]=useState(''),[list,setList]=useState<Strat[]|null>(null);
 useEffect(()=>{fetch('/api/strategies',{cache:'no-store'}).then(json).then(j=>setList(((j.strategies as Strat[])||[]).filter(s=>!s.archived&&s.latest))).catch(()=>setList([]))},[]);
 const ref=(id:string):StrategyRef|null=>{const s=list?.find(x=>x.id===id);return s&&s.latest?{strategyId:s.id,versionId:s.latest.id,label:s.name+' v'+s.latest.version}:null};
 const n=name.replace(/\s+/g,' ').trim(),clash=layouts.find(l=>l.name.toLowerCase()===n.toLowerCase());
 const create=()=>{if(!n)return;const l:Layout={id:clash?.id??newId(),name:n.slice(0,MAX_LAYOUT_NAME),view:layoutView(tab.view),strategy:strat?ref(strat):clash?.strategy??null};onSave(clash?layouts.map(x=>x.id===clash.id?l:x):[...layouts,l]);setName('');onApply(l)};
 return <div className="mct-pop mct-layouts" role="dialog" aria-label="Rozvržení">
  <p className="mct-pop-t">Rozvržení (panely, nástroje, indikátory, seance)</p>
  {layouts.length?<ul className="mct-closed">{layouts.map(l=><li key={l.id}><span><b>{l.name}{tab.layoutId===l.id&&<Check size={12} aria-label="použito"/>}</b>{l.strategy&&<small>strategie {l.strategy.label}</small>}</span>
   <button type="button" className="mc-chip" onClick={()=>onApply(l)}>Použít</button>
   {tab.layoutId===l.id&&layoutChanged(tab,l)&&<button type="button" className="mc-chip" title="Přepsat rozvržení aktuálním pohledem záložky" onClick={()=>onSave(layouts.map(x=>x.id===l.id?{...x,view:layoutView(tab.view)}:x))}>Uložit změny</button>}
   <button type="button" className="mct-x" aria-label={'Smazat rozvržení '+l.name} title="Smazat rozvržení" onClick={()=>{if(window.confirm(`Smazat rozvržení „${l.name}“? Záložky si pohled ponechají.`)){onSave(layouts.filter(x=>x.id!==l.id));if(tab.layoutId===l.id)onDetach()}}}><Trash2 size={12} aria-hidden/></button>
  </li>)}</ul>:<p className="mct-empty">Zatím žádné. Ulož aktuální pohled záložky jako rozvržení.</p>}
  <div className="mct-new">
   <input type="text" value={name} maxLength={MAX_LAYOUT_NAME} placeholder="Název, např. Intraday NY" aria-label="Název nového rozvržení" onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();create()}}}/>
   <select className="mc-chip mc-type" aria-label="Svázat s verzí strategie (volitelně)" value={strat} onChange={e=>setStrat(e.target.value)}><option value="">Bez strategie</option>{(list||[]).map(s=><option key={s.id} value={s.id}>{s.name} v{s.latest?.version}</option>)}</select>
   <button type="button" className="mc-chip on" disabled={!n||(!clash&&layouts.length>=MAX_LAYOUTS)} onClick={create}>{clash?'Přepsat':'Uložit'}</button>
  </div>
 </div>;
}
// obnovení zavřené záložky: chybějící kresby trhu ze snímku se doplní (nic se nepřepíše)
export async function restoreDrawings(instrument:string,snapshot:Drawing[]){
 if(!snapshot.length)return;
 const q='/api/chart/drawings?instrument='+encodeURIComponent(instrument);
 const j=await fetch(q,{cache:'no-store'}).then(json),cur=parseDrawings(j.drawings??[]);
 const m=mergeDrawings(cur.ok?cur.drawings:[],snapshot);
 if(m.added)await put(q,{drawings:m.drawings});
}
export async function fetchDrawings(instrument:string):Promise<Drawing[]>{
 const j=await fetch('/api/chart/drawings?instrument='+encodeURIComponent(instrument),{cache:'no-store'}).then(json),r=parseDrawings(j.drawings??[]);return r.ok?r.drawings:[];
}
