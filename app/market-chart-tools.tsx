'use client';
// Doplňky grafu trhu: seznam klávesových zkratek, snímek grafu se štítky (stáhnout / ke scénáři / k obchodu), rychlá kalkulačka pozice a úzká obrazovka.
import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {X,Download,Camera} from 'lucide-react';
import type {ChartTrade} from '@/lib/chart/trades';
import type {Drawing} from '@/lib/chart/drawings';
import {PositionCalculator} from './risk/position-calculator';

// úzká obrazovka (telefon): lišty grafu v jednom řádku, zbytek v nabídce „Více“
const NARROW='(max-width: 760px)';
const subNarrow=(cb:()=>void)=>{const m=window.matchMedia(NARROW);m.addEventListener('change',cb);return()=>m.removeEventListener('change',cb)};
export const useNarrow=()=>useSyncExternalStore(subNarrow,()=>window.matchMedia(NARROW).matches,()=>false);

const MAC=typeof navigator!=='undefined'&&/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent);
const MOD=MAC?'⌘':'Ctrl';
export const SHORTCUTS:[string,string][]=[
 ['F','graf přes celou obrazovku (Esc zpět)'],
 ['Shift + F','režim soustředění – skryje panely a lišty'],
 ['Alt + R','výchozí pohled (automatické měřítko, posledních ~150 svíček)'],
 ['Kolečko myši','přiblížení kolem kurzoru (nebo k pravému okraji podle nastavení Zobrazení)'],
 ['Tah grafem / Ctrl, Alt + tah','posun grafu (s nástrojem kreslení jen s Ctrl / Alt)'],
 [MOD+' + Z',`zpět (kresby)`],
 [MAC?'⇧⌘Z':'Ctrl + Y','znovu (kresby)'],
 ['Delete / Backspace','smazat vybranou kresbu'],
 ['Esc','zrušit nástroj, výběr, zavřít panel'],
 ['Enter / dvojklik','dokončit lomenou čáru'],
 ['Shift při kreslení','vodorovně / svisle, u obdélníku čtverec'],
 ['L','logaritmické měřítko ceny'],
 ['?','tento seznam zkratek'],
];
function Modal({title,onClose,children,wide}:{title:string;onClose:()=>void;children:React.ReactNode;wide?:boolean}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const k=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose()}};document.addEventListener('keydown',k,true);ref.current?.querySelector<HTMLElement>('button,input,select')?.focus();return()=>document.removeEventListener('keydown',k,true)},[onClose]);
 return <div className="mc-modal-back" onPointerDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div ref={ref} className={'mc-modal'+(wide?' wide':'')} role="dialog" aria-modal="true" aria-label={title}>
   <div className="mc-modal-head"><b>{title}</b><button type="button" className="mc-tool sm" aria-label="Zavřít" onClick={onClose}><X size={15} aria-hidden/></button></div>
   {children}
  </div>
 </div>;
}
export function ShortcutsDialog({onClose}:{onClose:()=>void}){
 return <Modal title="Klávesové zkratky grafu" onClose={onClose}>
  <dl className="mc-keys">{SHORTCUTS.map(([k,v])=><div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}</dl>
 </Modal>;
}

// snímek grafu: náhled, štítky (do názvu souboru, u scénáře i do poznámky) a kam s ním – stáhnout, ke scénáři trhu (obrázek scénáře), k obchodu na trhu (screenshot v Deníku)
type ScenarioLite={id:string;hypothesis:string;note:string;bias:string;status:string};
const slug=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);
export function ScreenshotDialog({canvas,instrument,name,tf,trades,onClose}:{canvas:HTMLCanvasElement;instrument:string;name:string;tf:string;trades:ChartTrade[];onClose:()=>void}){
 const url=useMemo(()=>{try{return canvas.toDataURL('image/png')}catch{return ''}},[canvas]);
 const [tags,setTags]=useState(''),[to,setTo]=useState<'download'|'scenario'|'trade'>('download'),[sc,setSc]=useState<ScenarioLite[]|null>(null),[pick,setPick]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState<{t:string;err?:boolean;href?:string}|null>(null);
 useEffect(()=>{if(to!=='scenario'||sc)return;fetch('/api/scenarios?scope=open&instrument='+encodeURIComponent(instrument),{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{scenarios?:ScenarioLite[]}>:Promise.reject()).then(j=>{setSc(j.scenarios||[]);setPick(p=>p||j.scenarios?.[0]?.id||'')}).catch(()=>setSc([]))},[to,sc,instrument]);
 const tagList=tags.split(/[,;#]+/).map(t=>t.trim()).filter(Boolean).slice(0,8);
 const file=`graf-${slug(instrument)}-${tf}${tagList.length?'-'+tagList.map(slug).join('-'):''}.png`;
 const recent=trades.slice(0,30);
 const save=async()=>{
  setBusy(true);setMsg(null);
  try{
   const blob=await new Promise<Blob|null>(res=>canvas.toBlob(res,'image/png'));if(!blob)throw new Error('Snímek se nepodařilo vytvořit.');
   if(to==='download'){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=file;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);setMsg({t:'Staženo jako '+file});return}
   const fd=new FormData();fd.append('file',new File([blob],file,{type:'image/png'}));
   if(to==='scenario'){
    const s=sc?.find(x=>x.id===pick);if(!s)throw new Error('Vyber scénář.');
    const r=await fetch('/api/plan-files',{method:'POST',body:fd}),j=await r.json().catch(()=>({})) as {file?:{id:string};error?:string};if(!r.ok||!j.file)throw new Error(j.error||'Obrázek se nepodařilo nahrát.');
    const note=tagList.length?((s.note?s.note+'\n':'')+tagList.map(t=>'#'+t.replace(/\s+/g,'_')).join(' ')).slice(0,2000):undefined;
    const p=await fetch('/api/scenarios/'+encodeURIComponent(s.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(note===undefined?{fileId:j.file.id}:{fileId:j.file.id,note})});
    if(!p.ok){const e=await p.json().catch(()=>({})) as {error?:string};throw new Error(e.error||'Snímek se nepodařilo připojit ke scénáři.')}
    setMsg({t:'Připojeno ke scénáři',href:'/scenare'});return;
   }
   if(!pick)throw new Error('Vyber obchod.');
   const r=await fetch('/api/journal/'+encodeURIComponent(pick)+'/files',{method:'POST',body:fd}),j=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw new Error(j.error||'Snímek se nepodařilo připojit k obchodu.');
   setMsg({t:'Připojeno k obchodu v Deníku',href:'/#journal/'+encodeURIComponent(pick)});
  }catch(e){setMsg({t:e instanceof Error?e.message:'Nepodařilo se uložit.',err:true})}
  finally{setBusy(false)}
 };
 const tradeLabel=(t:ChartTrade)=>(t.side==='buy'?'Buy':t.side==='sell'?'Sell':'Ruční')+' · '+t.date+(t.r!==null?' · '+t.r.toLocaleString('cs-CZ',{maximumFractionDigits:2})+' R':'');
 return <Modal title={'Snímek grafu · '+name+' '+tf} onClose={onClose} wide>
  {url&&<img className="mc-shot" src={url} alt={'Snímek grafu '+name}/>}
  <div className="mc-shot-form">
   <label className="mc-row"><span>Štítky</span><input type="text" value={tags} maxLength={120} placeholder="např. reakce zóny, A+ setup" onChange={e=>setTags(e.target.value)}/></label>
   <div className="mc-row" role="radiogroup" aria-label="Kam se snímkem"><span>Kam</span>
    {([['download','Stáhnout'],['scenario','Ke scénáři'],['trade','K obchodu']] as const).map(([v,l])=><label key={v} className="mc-check"><input type="radio" name="mc-shot-to" checked={to===v} onChange={()=>{setTo(v);setPick(v==='trade'?recent[0]?.id||'':'');if(v==='scenario')setSc(null);setMsg(null)}}/>{l}</label>)}
   </div>
   {to==='scenario'&&<label className="mc-row"><span>Scénář</span>{sc===null?<small>Načítám scénáře…</small>:sc.length?<select className="mc-chip mc-type" value={pick} onChange={e=>setPick(e.target.value)}>{sc.map(s=><option key={s.id} value={s.id}>{s.hypothesis.slice(0,60)}</option>)}</select>:<small>Na tomto trhu není otevřený scénář.</small>}</label>}
   {to==='scenario'&&<small className="mc-hint">Nahradí dosavadní obrázek scénáře; štítky se připíšou do poznámky.</small>}
   {to==='trade'&&<label className="mc-row"><span>Obchod</span>{recent.length?<select className="mc-chip mc-type" value={pick} onChange={e=>setPick(e.target.value)}>{recent.map(t=><option key={t.id} value={t.id}>{tradeLabel(t)}</option>)}</select>:<small>Na tomto trhu zatím nejsou obchody.</small>}</label>}
   <div className="mc-row mc-row-actions"><button type="button" className="mc-chip on" disabled={busy||(to!=='download'&&!pick)} onClick={save}>{to==='download'?<><Download size={13} aria-hidden/> Stáhnout PNG</>:<><Camera size={13} aria-hidden/> {busy?'Ukládám…':'Připojit snímek'}</>}</button>
    {msg&&<span className={'mc-note'+(msg.err?' err':'')} role="status">{msg.t}{msg.href&&<> · <a href={msg.href}>otevřít</a></>}</span>}</div>
  </div>
 </Modal>;
}

// rychlý panel stop / cíl / velikost pozice: kalkulačka z Účtů a rizika, předvyplněná z vybrané pozice long/short v grafu (vstup, stop, cíl)
export function CalcPanel({market,drawing,last,onClose}:{market:string;drawing:Drawing|null;last:number|null;onClose:()=>void}){
 const pos=drawing&&(drawing.type==='long'||drawing.type==='short')&&drawing.a.length===3?drawing:null;
 const initial=pos?{market,entry:pos.a[0].p,stop:pos.a[1].p,target:pos.a[2].p}:{market,entry:last??undefined};
 const key=pos?pos.id+':'+pos.a.map(a=>a.p).join(','):'m:'+market;
 return <aside className="mc-calc" aria-label="Rychlá kalkulačka pozice" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose()}}}>
  <div className="mc-tree-head"><b>Stop · cíl · velikost</b><button type="button" className="mc-tool sm" aria-label="Zavřít kalkulačku" onClick={onClose}><X size={15} aria-hidden/></button></div>
  <p className="mc-calc-note">{pos?'Z vybrané '+(pos.type==='long'?'long':'short')+' pozice v grafu.':'Tip: vyber v grafu pozici long/short a hodnoty se předvyplní.'}</p>
  <PositionCalculator key={key} initial={initial} title={false}/>
 </aside>;
}
