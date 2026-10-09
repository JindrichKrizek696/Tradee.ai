'use client';
import {useEffect,useState} from 'react';
import {ArrowLeft,ChevronLeft,ChevronRight,Trash2,Upload,X} from 'lucide-react';
import type {JournalChange,JournalDetail,JournalTrade} from '@/lib/journal/types';
import {fmtMoney} from '@/lib/trades';
import {fmtHold,fmtR,fmtDateTime,fmtDate,fmtNum} from '@/lib/journal/format';
import {checkUpload} from '@/lib/journal/rows';
import {TradeChart} from './trade-chart';
import {CheckSet} from '../checklist-card';
import type {SnapshotList} from '@/lib/checklists/core';
export type TradeDetailProps={id:string;trade?:JournalTrade;currency:string;allTags:string[];prev:string|null;next:string|null;onOpen:(id:string)=>void;onClose:()=>void;onChanged:()=>void;readOnly?:boolean;query?:string};
const KIND:Record<string,string>={open:'Otevření',add:'Přidání',partial_close:'Částečné uzavření',close:'Uzavření',sl:'Stop loss',tp:'Take profit'};
const REASON:Record<string,string>={sl:'stop loss',tp:'take profit',so:'stop out',client:'ručně (terminál)',mobile:'ručně (mobil)',web:'ručně (web)',expert:'EA / algoritmus'};
const why=(r:string|null)=>r?REASON[r]||r:'–';
async function send(url:string,method:string,body?:unknown):Promise<any>{
 const form=body instanceof FormData,r=await fetch(url,{method,headers:form||body===undefined?undefined:{'Content-Type':'application/json'},body:form?body:body===undefined?undefined:JSON.stringify(body)});
 const j=await r.json().catch(()=>({})) as any;if(!r.ok)throw Error(j.error||'Akce se nepovedla. Zkus to znovu.');return j;
}
const describe=(c:JournalChange)=>c.kind==='sl'||c.kind==='tp'?`${fmtNum(c.old_value)} → ${c.new_value===null?'zrušen':fmtNum(c.new_value)}`:`${c.volume??''} @ ${fmtNum(c.price)}${c.reason?' · '+why(c.reason):''}`;
export function TradeDetail({id,trade,currency,allTags,prev,next,onOpen,onClose,onChanged,readOnly=false,query=''}:TradeDetailProps){
 const mt=id.startsWith('mt:'),url='/api/journal/'+encodeURIComponent(id);
 const [d,setD]=useState<JournalDetail|null>(null),[error,setError]=useState(''),[note,setNote]=useState(mt?'':trade?.note||''),[saved,setSaved]=useState(''),[tagInput,setTagInput]=useState(''),[zoom,setZoom]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const [snap,setSnap]=useState<SnapshotList[]|null>(null),[avail,setAvail]=useState(false),[ckLoaded,setCkLoaded]=useState(false),[ckBusy,setCkBusy]=useState(false);
 async function loadCk(){try{const r=await fetch(url+'/checklist'+query,{cache:'no-store'});const j=await r.json() as any;if(!r.ok)throw Error(j.error||'Checklist se nepodařilo načíst.');setSnap(j.snapshot);setAvail(!!j.available);setCkLoaded(true)}catch(e){setError((e as Error).message)}}
 async function toggleCk(ci:number,itemId:string){if(!snap)return;const before=snap,after=snap.map((l,i)=>i!==ci?l:{...l,items:l.items.map(it=>it.id===itemId?{...it,checked:!it.checked}:it)});setSnap(after);setError('');try{await send(url+'/checklist','PUT',{snapshot:after})}catch(e){setSnap(before);setError((e as Error).message)}}
 async function fillCk(){setCkBusy(true);try{await send(url+'/checklist','POST');setError('');await loadCk()}catch(e){setError((e as Error).message)}finally{setCkBusy(false)}}
 async function load(){try{const r=await fetch(url+query,{cache:'no-store'});const j=await r.json() as any;if(!r.ok)throw Error(j.error||'Obchod se nepodařilo načíst.');setD(j);setNote(j.position.note||'')}catch(e){setError((e as Error).message)}}
 useEffect(()=>{if(mt)load()},[]);
 useEffect(()=>{loadCk()},[]);
 useEffect(()=>{if(!zoom)return;const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setZoom(null)};document.addEventListener('keydown',esc);return()=>document.removeEventListener('keydown',esc)},[zoom]);
 const oldNote=mt?d?.position.note||'':trade?.note||'';
 async function saveNote(){if(note.trim()===oldNote.trim())return;try{await send(url,'PATCH',{note});setSaved('Uloženo');setError('');if(d)setD({...d,position:{...d.position,note}});onChanged()}catch(e){setError((e as Error).message)}}
 const manualTags=d?d.position.tags_manual.split(',').filter(Boolean):[],autoTags=d?d.position.tags.split(',').filter(Boolean):[];
 async function saveTags(tags:string[]){try{await send(url,'PATCH',{tags});setD(x=>x&&{...x,position:{...x.position,tags_manual:tags.join(',')}});setError('');onChanged()}catch(e){setError((e as Error).message)}}
 function addTag(){const t=tagInput.trim().replace(/^#/,'').toLowerCase();if(!t)return;setTagInput('');if(!manualTags.includes(t)&&!autoTags.includes(t))saveTags([...manualTags,t])}
 async function upload(f:File){const err=checkUpload({type:f.type,size:f.size},d?.files.length||0);if(err){setError(err);return}
  setBusy(true);try{const fd=new FormData();fd.append('file',f);await send(url+'/files','POST',fd);setError('');await load();onChanged()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function removeFile(fileId:string){if(!window.confirm('Smazat screenshot?'))return;try{await send(url+'/files','DELETE',{fileId});await load();onChanged()}catch(e){setError((e as Error).message)}}
 const noteBox=(max:number)=>readOnly?(note.trim()?<p className="j-noteview">{note}</p>:<p className="j-muted">Bez poznámky.</p>):<><textarea className="j-note" rows={5} maxLength={max} value={note} onChange={e=>{setNote(e.target.value);setSaved('')}} onBlur={saveNote} placeholder="Proč jsi vstoupil, co jsi viděl, co příště jinak…" aria-label="Poznámka k obchodu"/><small className="j-muted">{saved||`Ukládá se po kliknutí mimo pole · max. ${max} znaků`}</small></>;
 const checklistBox=!ckLoaded?<p className="j-muted">Načítám…</p>:snap?<div className="cc-list">{snap.map((l,ci)=><CheckSet key={l.checklistId+ci} name={l.name} items={l.items} onToggle={readOnly?undefined:id=>toggleCk(ci,id)}/>)}</div>:avail?<><p className="j-muted">K obchodu není uložený checklist.</p>{!readOnly&&<button type="button" className="j-btn" disabled={ckBusy} onClick={fillCk}>{ckBusy?'Vyplňuji…':'Vyplnit checklist'}</button>}</>:readOnly?null:<p className="j-muted">Pro tento trh nemáš checklist.</p>;
 const head=<div className="j-dhead"><button type="button" className="j-back" onClick={onClose}><ArrowLeft size={16}/> Deník</button>
  <div className="j-nav"><button type="button" disabled={!prev} onClick={()=>prev&&onOpen(prev)} aria-label="Novější obchod" title="Novější obchod"><ChevronLeft size={18}/></button><button type="button" disabled={!next} onClick={()=>next&&onOpen(next)} aria-label="Starší obchod" title="Starší obchod"><ChevronRight size={18}/></button></div></div>;
 if(!mt){
  if(!trade)return <div className="j-detail">{head}<p className="j-muted">Obchod nenalezen.</p></div>;
  return <div className="j-detail">{head}
   <h1 className="j-title">{trade.symbol} <small>Ručně · {fmtDate(trade.date)}</small></h1>
   {error&&<p role="alert" className="s-notice">{error}</p>}
   <section className="j-card"><dl className="j-dl"><div><dt>Výsledek</dt><dd className={trade.pnl>0?'pos':trade.pnl<0?'neg':''}>{fmtMoney(trade.pnl,currency)}</dd></div></dl><p className="j-muted">Ruční zápis nemá vstup, výstup ani stop loss – graf a podrobná čísla jsou jen u obchodů z MetaTraderu.</p></section>
   <section className="j-card"><h2>Poznámka</h2>{noteBox(500)}</section>
  {checklistBox&&<section className="j-card"><h2>Checklist při vstupu</h2>{checklistBox}</section>}
  </div>;
 }
 const p=d?.position;
 if(!d||!p)return <div className="j-detail">{head}{error?<p role="alert" className="s-notice">{error}</p>:<p className="j-muted">Načítám obchod…</p>}</div>;
 const cur=p.acc_currency,money=(v:number|null)=>v===null?'–':fmtMoney(v,cur),inR=(v:number|null)=>v!==null&&p.risk_money?` (${fmtR(Math.round(v/p.risk_money*100)/100)})`:'';
 const rows:[string,string][]=[
  ['Vstup',fmtNum(p.open_price)],['Výstup (průměr)',fmtNum(p.close_price_avg)],['Objem (max.)',fmtNum(p.volume_max,2)],
  ['Výsledek',money(p.net)+(trade&&trade.converted&&cur!==currency?` · ${fmtMoney(trade.pnl,currency)}`:'')],
  ['Zisk / komise / swap',`${money(p.profit)} / ${money(p.commission)} / ${money(p.swap)}`],
  ['SL / TP na začátku',`${fmtNum(p.sl_initial)} / ${fmtNum(p.tp_initial)}`],['SL / TP na konci',`${fmtNum(p.sl_last)} / ${fmtNum(p.tp_last)}`],
  ['Riziko',p.risk_money===null?'bez stop lossu':money(-p.risk_money)+(p.risk_pct!==null?` (${fmtNum(p.risk_pct,2)} % účtu)`:'')],
  ['R:R plán / výsledek',`${p.rr_planned===null?'–':fmtNum(p.rr_planned,2)} / ${fmtR(p.r_result)}`],
  ['MFE (nejvíc v zisku)',money(p.mfe_money)+inR(p.mfe_money)+(p.mfe_partial?' · odhad, chybí část dat':'')],
  ['MAE (nejvíc ve ztrátě)',money(p.mae_money)+inR(p.mae_money)],
  ['Slippage',p.slippage_points===null?'–':fmtNum(p.slippage_points,1)+' b.'],['Spread při vstupu',p.spread_entry===null?'–':fmtNum(p.spread_entry,1)+' b.'],
  ['Otevřeno / zavřeno',`${why(p.open_reason||null)} / ${why(p.close_reason)}`],
  ['Držení',p.close_ts?fmtHold(p.close_ts-p.open_ts):'otevřená'],['Magic / komentář',`${p.magic||'–'} / ${p.comment||'–'}`]];
 return <div className="j-detail">{head}
  <h1 className="j-title">{p.symbol} <span className={'j-side '+p.side}>{p.side==='buy'?'Buy':'Sell'}</span> <small>{p.acc_name} · {fmtDateTime(p.open_ts)} → {p.close_ts?fmtDateTime(p.close_ts):'otevřená'}</small></h1>
  {error&&<p role="alert" className="s-notice">{error}</p>}
  <section className="j-card">{d.bars&&d.bars.data.length?<><TradeChart bars={d.bars.data} position={p} changes={d.changes}/><small className="j-muted">Svíčky {d.bars.tf} · čas Europe/Praha · tečkovaně nejlepší (MFE) a nejhorší (MAE) cena</small></>:<p className="j-muted">Graf není k dispozici – svíčky posílá EA od verze 1.1 a jen pro obchody z posledních 30 dní.</p>}</section>
  <div className="j-grid">
   <section className="j-card"><h2>Čísla</h2><dl className="j-dl">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>
   <section className="j-card"><h2>Průběh</h2><ol className="j-timeline">{d.changes.map((c,i)=><li key={i}><time>{fmtDateTime(c.ts)}</time><b>{KIND[c.kind]||c.kind}</b><span>{describe(c)}</span></li>)}</ol></section>
  </div>
  <section className="j-card"><h2>Tagy</h2>
   <div className="j-chips">{autoTags.map(t=><span key={'a'+t} className="j-chip" title="Z komentáře obchodu v MetaTraderu">#{t}</span>)}{manualTags.map(t=><span key={t} className="j-chip manual">#{t}{!readOnly&&<button type="button" aria-label={'Odebrat tag '+t} onClick={()=>saveTags(manualTags.filter(x=>x!==t))}><X size={12}/></button>}</span>)}{!autoTags.length&&!manualTags.length&&<span className="j-muted">Zatím bez tagů.</span>}</div>
   {!readOnly&&<><form className="j-tagform" onSubmit={e=>{e.preventDefault();addTag()}}><input list="j-alltags" value={tagInput} onChange={e=>setTagInput(e.target.value)} placeholder="Přidat tag, např. breakout" maxLength={31} aria-label="Nový tag"/><datalist id="j-alltags">{allTags.map(t=><option key={t} value={t}/>)}</datalist><button type="submit" className="j-btn">Přidat</button></form>
   <small className="j-muted">Tagy napsané v komentáři obchodu v MetaTraderu (#breakout) se přidají samy.</small></>}
  </section>
  <section className="j-card"><h2>Poznámka</h2>{noteBox(5000)}</section>
  {checklistBox&&<section className="j-card"><h2>Checklist při vstupu</h2>{checklistBox}</section>}
  <section className="j-card"><h2>Screenshoty</h2>
   {d.files.length>0&&<div className="j-shots">{d.files.map(f=><figure key={f.id}><button type="button" className="j-shot" onClick={()=>setZoom('/api/journal/files/'+f.id+query)} aria-label={'Zvětšit '+f.name}><img src={'/api/journal/files/'+f.id+query} alt={f.name} loading="lazy"/></button>{!readOnly&&<button type="button" className="j-del" aria-label={'Smazat '+f.name} onClick={()=>removeFile(f.id)}><Trash2 size={14}/></button>}</figure>)}</div>}
   {readOnly?!d.files.length&&<p className="j-muted">Bez screenshotů.</p>:<>{d.files.length<5?<label className="j-btn"><Upload size={14}/> {busy?'Nahrávám…':'Nahrát screenshot'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)upload(f)}}/></label>:<p className="j-muted">K obchodu jde nahrát nejvýš 5 screenshotů.</p>}
   <small className="j-muted">PNG, JPEG nebo WebP, nejvýš 5 MB.</small></>}
  </section>
  {zoom&&<div className="j-zoom" role="dialog" aria-modal="true" aria-label="Screenshot" onClick={()=>setZoom(null)}><img src={zoom} alt=""/><button type="button" aria-label="Zavřít" onClick={()=>setZoom(null)}><X size={20}/></button></div>}
 </div>;
}
