'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useOpenRequest} from '../open-request';
import {ArrowDown,ArrowLeft,ArrowUp,FileText,Folder as FolderIcon,FolderPlus,Pencil,Plus,Trash2} from 'lucide-react';
import {LIMITS,SUGGESTED,cleanFolderName,suggestions,excerpt,noteLabel,sqlMs,sortNotes,folderCounts,type Folder,type Note,type NoteMeta,type NotePatch} from '@/lib/notebook/core';
import {groups} from '@/lib/markets';
import {fmtDateTime,plural} from '@/lib/journal/format';
import './notebook.css';
// Poznámky (Notebook): vlastní složky vlevo, papíry ve složce (nejnovější nahoře) a papír s textem, který se ukládá sám při psaní
type Market={id:string;name:string;group:string};
type Data={folders:Folder[];notes:NoteMeta[];markets:Market[]};
type Save='idle'|'pending'|'saving'|'saved'|'error';
const KEY='tradee.notebook',SAVE_MS=800;// poslední složka se pamatuje v prohlížeči
const readLast=()=>{try{return localStorage.getItem(KEY)}catch{return null}};
const writeLast=(id:string)=>{try{localStorage.setItem(KEY,id)}catch{}};
// keepalive (odeslání i při zavírání stránky) má limit 64 kB
async function call<T=unknown>(url:string,method:string,body?:unknown,keepalive=false):Promise<T>{const s=body===undefined?undefined:JSON.stringify(body);const r=await fetch(url,{method,cache:'no-store',headers:{'Content-Type':'application/json'},body:s,keepalive:keepalive&&!!s&&new TextEncoder().encode(s).length<60000});const j=await r.json().catch(()=>({})) as T&{error?:string};if(!r.ok)throw Error(j.error||'Akce se nepovedla. Zkus to prosím znovu.');return j}
const move=<T,>(a:T[],i:number,d:number)=>{const j=i+d;if(i<0||j<0||j>=a.length)return a;const b=[...a];[b[i],b[j]]=[b[j],b[i]];return b};
const when=(s:string)=>fmtDateTime(sqlMs(s));
const hm=new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit'});
// pole papíru do seznamu (text se do seznamu nepřenáší, jen náhled)
const metaOf=(p:NotePatch):Partial<NoteMeta>=>({...(p.title!==undefined?{title:p.title}:{}),...(p.folderId!==undefined?{folderId:p.folderId}:{}),...(p.instrument!==undefined?{instrument:p.instrument}:{}),...(p.body!==undefined?{excerpt:excerpt(p.body)}:{})});
function NameForm({initial='',label,submit,suggest=[],onDone,onCancel}:{initial?:string;label:string;submit:string;suggest?:readonly string[];onDone:(name:string)=>Promise<void>;onCancel?:()=>void}){
 const [v,setV]=useState(initial),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 async function go(name:string){const n=cleanFolderName(name);if(typeof n!=='string'){setErr(n.error);return}setBusy(true);setErr('');try{await onDone(n)}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 return <form className="nb-form" onSubmit={e=>{e.preventDefault();go(v)}}>
  <input type="text" value={v} autoFocus maxLength={LIMITS.name} aria-label={label} placeholder={label} disabled={busy} onChange={e=>{setV(e.target.value);setErr('')}} onKeyDown={e=>{if(e.key==='Escape'&&onCancel){e.preventDefault();onCancel()}}}/>
  <div className="nb-form-btns"><button type="submit" className="j-btn dark" disabled={busy||!v.trim()}>{busy?'Ukládám…':submit}</button>{onCancel&&<button type="button" className="j-btn" disabled={busy} onClick={onCancel}>Zrušit</button>}</div>
  {suggest.length>0&&<div className="nb-sugg">{suggest.map(s=><button key={s} type="button" className="nb-chip" disabled={busy} onClick={()=>go(s)}>+ {s}</button>)}</div>}
  {err&&<p className="jg-err" role="alert">{err}</p>}
 </form>;
}
// papír: změny se pošlou SAVE_MS po posledním úhozu (výběr složky a trhu hned), při zavření papíru nebo stránky se dořeší čekající uložení
function Paper({id,initial,folders,markets,onMeta,onDeleted,onClose,onLost}:{id:string;initial:Note|null;folders:Folder[];markets:Market[];onMeta:(id:string,m:Partial<NoteMeta>,follow?:boolean)=>void;onDeleted:(id:string)=>void;onClose:()=>void;onLost:(msg:string)=>void}){
 const [note,setNote]=useState<Note|null>(initial),[loadErr,setLoadErr]=useState(''),[save,setSave]=useState<Save>('idle'),[saveErr,setSaveErr]=useState(''),[savedAt,setSavedAt]=useState<string|null>(null);
 const pending=useRef<NotePatch|null>(null),inflight=useRef<Promise<unknown>|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),dead=useRef(false),text=useRef<HTMLTextAreaElement>(null);
 const cb=useRef({onMeta,onLost});useEffect(()=>{cb.current={onMeta,onLost}});
 const url='/api/notebook/notes/'+encodeURIComponent(id);
 useEffect(()=>{if(initial)return;const ac=new AbortController();
  fetch(url,{cache:'no-store',signal:ac.signal}).then(async r=>{const j=await r.json().catch(()=>({})) as {note?:Note;error?:string};if(!r.ok||!j.note)throw Error(j.error||'Papír se nepodařilo načíst. Zkus to prosím znovu.');setNote(j.note)}).catch(e=>{if(!ac.signal.aborted)setLoadErr((e as Error).message)});
  return()=>ac.abort()},[url,initial]);
 async function flush(){
  clearTimeout(timer.current);
  if(inflight.current||!pending.current||dead.current)return;
  const p=pending.current;pending.current=null;setSave('saving');
  const req=call<{updated:string;excerpt?:string}>(url,'PATCH',p);inflight.current=req;let ok=false;
  try{const r=await req;ok=true;cb.current.onMeta(id,{...metaOf(p),updated:r.updated});setSavedAt(r.updated);setNote(n=>n&&{...n,updated:r.updated});setSaveErr('');setSave(pending.current?'pending':'saved')}
  catch(e){pending.current={...p,...(pending.current||{})};setSave('error');setSaveErr((e as Error).message)}
  finally{inflight.current=null}
  if(ok&&pending.current)timer.current=setTimeout(flush,200);// psal během ukládání
 }
 function edit(p:NotePatch,now=false){if(dead.current)return;setNote(n=>n&&{...n,...p});pending.current={...(pending.current||{}),...p};setSave('pending');clearTimeout(timer.current);timer.current=setTimeout(flush,now?0:SAVE_MS)}
 // zavření papíru: čekající změny odeslat (až po případném běžícím uložení, ať starší text nepřepíše novější)
 useEffect(()=>()=>{clearTimeout(timer.current);const p=pending.current;if(!p||dead.current)return;pending.current=null;cb.current.onMeta(id,metaOf(p),false);
  (inflight.current||Promise.resolve()).catch(()=>{}).then(()=>call(url,'PATCH',p,true)).catch(e=>cb.current.onLost((e as Error).message))},[id,url]);
 // zavření stránky: upozornit na neuložené a zkusit je odeslat
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(pending.current||inflight.current)e.preventDefault()};const hide=()=>{const p=pending.current;if(p&&!dead.current&&!inflight.current){pending.current=null;call(url,'PATCH',p,true).catch(()=>{})}};
  addEventListener('beforeunload',warn);addEventListener('pagehide',hide);return()=>{removeEventListener('beforeunload',warn);removeEventListener('pagehide',hide)}},[url]);
 async function remove(){if(!note||!confirm(`Smazat papír „${noteLabel(note)}“? Tohle nejde vrátit.`))return;
  clearTimeout(timer.current);const p=pending.current;pending.current=null;dead.current=true;
  try{await inflight.current?.catch(()=>{});await call(url,'DELETE');onDeleted(id)}catch(e){dead.current=false;if(p)pending.current={...p,...(pending.current||{})};setSave('error');setSaveErr((e as Error).message)}}
 if(loadErr)return <div className="nb-paper"><button type="button" className="nb-back" onClick={onClose}><ArrowLeft size={16}/> Seznam</button><p role="alert" className="s-notice">{loadErr}</p></div>;
 if(!note)return <div className="nb-paper"><p className="j-muted">Načítám papír…</p></div>;
 const state=save==='pending'?'Neuložené změny…':save==='saving'?'Ukládám…':save==='saved'&&savedAt?'Uloženo v '+hm.format(sqlMs(savedAt)):save==='error'?'Neuloženo':'Upraveno '+when(note.updated);
 const grouped=Object.entries(groups).filter(([g])=>g!=='all').map(([g,l])=>[l,markets.filter(m=>m.group===g)] as const).filter(([,ms])=>ms.length);
 return <article className="nb-paper" aria-label={noteLabel(note)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();flush()}}}>
  <div className="nb-ptop">
   <button type="button" className="nb-back" onClick={onClose}><ArrowLeft size={16}/> Seznam</button>
   <span className={'nb-state '+save} role="status" aria-live="polite">{state}{save==='error'&&<>{saveErr&&<> – {saveErr}</>} <button type="button" className="nb-retry" onClick={()=>flush()}>Zkusit znovu</button></>}</span>
   <button type="button" className="nb-icon" aria-label="Smazat papír" title="Smazat papír" onClick={remove}><Trash2 size={15}/></button>
  </div>
  <input className="nb-title" type="text" value={note.title} maxLength={LIMITS.title} placeholder="Bez názvu" aria-label="Název papíru" autoFocus={!!initial} onChange={e=>edit({title:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();text.current?.focus()}}}/>
  <div className="nb-props">
   <label className="nb-prop"><FolderIcon size={14} aria-hidden="true"/><span className="sr-only">Složka</span><select value={note.folderId} onChange={e=>edit({folderId:e.target.value},true)}>{folders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
   <label className="nb-prop"><span>Trh</span><select value={note.instrument||''} onChange={e=>edit({instrument:e.target.value||null},true)}><option value="">Bez trhu</option>{grouped.map(([l,ms])=><optgroup key={l} label={l}>{ms.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>)}</select></label>
   <span className="nb-dates">Založeno {when(note.created)}</span>
  </div>
  <textarea ref={text} className="nb-body" value={note.body} maxLength={LIMITS.body} placeholder={'Piš sem… Třeba co se tento týden povedlo, co ne a na co se zaměřit příště.'} aria-label="Text papíru" onChange={e=>edit({body:e.target.value})}/>
  <div className="nb-pfoot"><span>{note.body.length.toLocaleString('cs-CZ')} / {LIMITS.body.toLocaleString('cs-CZ')} znaků</span><span>Ukládá se samo · Ctrl+S hned</span></div>
 </article>;
}
export function Notebook(){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[folderId,setFolderId]=useState<string|null>(null),[noteId,setNoteId]=useState<string|null>(null),[fresh,setFresh]=useState<Note|null>(null),[form,setForm]=useState<'add'|'rename'|null>(null),[busy,setBusy]=useState(false);
 const [tick,setTick]=useState(0),load=()=>setTick(t=>t+1);// load = načíst znovu
 // poznámka vybraná ve vyhledávání: hned, nebo po (znovu)načtení seznamu
 const wanted=useRef<string|null>(null);
 useOpenRequest('note',id=>{const n=data?.notes.find(x=>x.id===id);if(n){setFolderId(n.folderId);setNoteId(n.id)}else{wanted.current=id;load()}});
 useEffect(()=>{let live=true;
  call<Data>('/api/notebook','GET').then(j=>{if(!live)return;setData(j);const asked=wanted.current?j.notes.find(x=>x.id===wanted.current):null;wanted.current=null;setFolderId(f=>{const want=asked?.folderId??f??readLast();return want&&j.folders.some(x=>x.id===want)?want:j.folders[0]?.id??null});if(asked)setNoteId(asked.id);setError('')},e=>{if(live)setError((e as Error).message)});
  return()=>{live=false}},[tick]);
 useEffect(()=>{if(folderId)writeLast(folderId)},[folderId]);
 const folders=useMemo(()=>data?.folders||[],[data]),notes=useMemo(()=>data?.notes||[],[data]),markets=useMemo(()=>data?.markets||[],[data]);
 const counts=useMemo(()=>folderCounts(notes),[notes]),list=useMemo(()=>sortNotes(notes.filter(n=>n.folderId===folderId)),[notes,folderId]);
 const names=useMemo(()=>Object.fromEntries(markets.map(m=>[m.id,m.name])),[markets]);
 const folder=folders.find(f=>f.id===folderId)||null,fi=folder?folders.indexOf(folder):-1;
 const change=(fn:(d:Data)=>Data)=>setData(d=>d?fn(d):d);
 async function act(fn:()=>Promise<void>){setBusy(true);try{await fn();setError('')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function createFolder(name:string){const j=await call<{folder:Folder}>('/api/notebook/folders','POST',{name});change(d=>({...d,folders:[...d.folders,j.folder]}));return j.folder}
 async function addFolder(name:string){const f=await createFolder(name);setFolderId(f.id);setNoteId(null);setForm(null);setError('')}
 const addSuggested=()=>act(async()=>{let first:string|null=null;for(const n of suggestions(folders)){const f=await createFolder(n);first??=f.id}if(first)setFolderId(first)});
 async function renameFolder(name:string){if(!folder)return;await call('/api/notebook/folders','PATCH',{id:folder.id,name});change(d=>({...d,folders:d.folders.map(f=>f.id===folder.id?{...f,name}:f)}));setForm(null);setError('')}
 function moveFolder(dir:number){const o=move(folders,fi,dir);if(o===folders)return;change(d=>({...d,folders:o}));act(()=>call('/api/notebook/folders','PATCH',{order:o.map(f=>f.id)}).then(()=>{},e=>{load();throw e}))}
 function deleteFolder(){if(!folder)return;const n=counts[folder.id]||0;
  if(!confirm(n?`Smazat složku „${folder.name}“? Smaže se i ${n} ${plural(n,['papír','papíry','papírů'])} v ní. Tohle nejde vrátit.`:`Smazat prázdnou složku „${folder.name}“?`))return;
  act(async()=>{await call('/api/notebook/folders','DELETE',{id:folder.id});const rest=folders.filter(f=>f.id!==folder.id);
   if(noteId&&notes.find(x=>x.id===noteId)?.folderId===folder.id)setNoteId(null);
   change(d=>({...d,folders:d.folders.filter(f=>f.id!==folder.id),notes:d.notes.filter(x=>x.folderId!==folder.id)}));setFolderId(rest[Math.min(fi,rest.length-1)]?.id??null)});
 }
 const pickFolder=(id:string)=>{setFolderId(id);setNoteId(null);setForm(f=>f==='rename'?null:f)};
 const newNote=()=>{if(folderId)act(async()=>{const j=await call<{note:Note}>('/api/notebook/notes','POST',{folderId});const {body,...m}=j.note;change(d=>({...d,notes:[{...m,excerpt:excerpt(body)},...d.notes]}));setFresh(j.note);setNoteId(j.note.id)})};
 const openNote=(id:string)=>{if(id===noteId)return;setFresh(null);setNoteId(id)};
 const onMeta=(id:string,m:Partial<NoteMeta>,follow=true)=>{change(d=>({...d,notes:d.notes.map(n=>n.id===id?{...n,...m}:n)}));if(follow&&m.folderId)setFolderId(m.folderId)};
 const onDeleted=(id:string)=>{change(d=>({...d,notes:d.notes.filter(n=>n.id!==id)}));setNoteId(null);setFresh(null)};
 const onLost=(msg:string)=>setError('Poslední změny papíru se nepodařilo uložit: '+msg);
 if(!data)return error?<div className="nb-load"><p role="alert" className="s-notice">{error}</p><button type="button" className="j-btn" onClick={load}>Zkusit znovu</button></div>:<p className="j-muted">Načítám poznámky…</p>;
 if(!folders.length)return <div className="j-card nb-start">
  <h2>Poznámky</h2>
  <p>Založ si složky podle toho, co si chceš zapisovat – třeba analýzy, plán na začátek týdne nebo report na jeho konci. V každé složce pak můžeš mít libovolně papírů.</p>
  {error&&<p role="alert" className="s-notice">{error}</p>}
  <div className="nb-sugg">{SUGGESTED.map(s=><button key={s} type="button" className="j-btn" disabled={busy} onClick={()=>act(()=>addFolder(s))}><FolderPlus size={15}/> {s}</button>)}<button type="button" className="j-btn dark" disabled={busy} onClick={addSuggested}>Založit všechny tři</button></div>
  <p className="j-muted">Nebo si pojmenuj vlastní – třeba „Páry“, „Psychologie“ nebo „Nápady“.</p>
  <NameForm label="Název vlastní složky" submit="Vytvořit" onDone={addFolder}/>
 </div>;
 return <div className={'nb'+(noteId?' open':'')}>
  {error&&<p role="alert" className="s-notice nb-alert">{error}</p>}
  <nav className="nb-folders" aria-label="Složky poznámek">
   <h2 className="nb-h">Složky</h2>
   <ul>{folders.map(f=><li key={f.id}><button type="button" className={f.id===folderId?'on':''} aria-current={f.id===folderId?'true':undefined} onClick={()=>pickFolder(f.id)}><FolderIcon size={15} aria-hidden="true"/><span>{f.name}</span><small>{counts[f.id]||0}</small></button></li>)}</ul>
   {form==='add'?<NameForm label="Název složky" submit="Vytvořit" suggest={suggestions(folders)} onDone={addFolder} onCancel={()=>setForm(null)}/>
    :<button type="button" className="nb-add" disabled={folders.length>=LIMITS.folders} title={folders.length>=LIMITS.folders?`Nejvýš ${LIMITS.folders} složek`:undefined} onClick={()=>setForm('add')}><FolderPlus size={15}/> Nová složka</button>}
  </nav>
  <section className="nb-list" aria-label={folder?'Papíry ve složce '+folder.name:'Papíry'}>
   {folder&&(form==='rename'?<NameForm key={folder.id} initial={folder.name} label="Nový název složky" submit="Uložit" onDone={renameFolder} onCancel={()=>setForm(null)}/>
    :<div className="nb-lhead"><h2 className="nb-h">{folder.name}</h2><div className="nb-acts">
     <button type="button" className="nb-icon" aria-label="Posunout složku výš" title="Posunout výš" disabled={busy||fi<=0} onClick={()=>moveFolder(-1)}><ArrowUp size={14}/></button>
     <button type="button" className="nb-icon" aria-label="Posunout složku níž" title="Posunout níž" disabled={busy||fi>=folders.length-1} onClick={()=>moveFolder(1)}><ArrowDown size={14}/></button>
     <button type="button" className="nb-icon" aria-label="Přejmenovat složku" title="Přejmenovat" onClick={()=>setForm('rename')}><Pencil size={14}/></button>
     <button type="button" className="nb-icon" aria-label="Smazat složku" title="Smazat složku" disabled={busy} onClick={deleteFolder}><Trash2 size={14}/></button></div></div>)}
   <button type="button" className="j-btn dark nb-new" disabled={busy||!folder||notes.length>=LIMITS.notes} onClick={newNote}><Plus size={15}/> Nový papír</button>
   {notes.length>=LIMITS.notes&&<p className="j-muted">Máš {LIMITS.notes} papírů, víc se nevejde. Smaž nějaké staré.</p>}
   {list.length?<ul className="nb-notes">{list.map(n=><li key={n.id}><button type="button" className={'nb-note'+(n.id===noteId?' on':'')} aria-current={n.id===noteId?'true':undefined} onClick={()=>openNote(n.id)}>
     <b>{noteLabel(n)}</b><span className="nb-ex">{n.excerpt||'Prázdný papír'}</span>
     <span className="nb-meta"><time dateTime={n.created.replace(' ','T')+'Z'}>{when(n.created)}</time>{n.instrument&&<span className="nb-mkt">{names[n.instrument]||n.instrument}</span>}</span></button></li>)}</ul>
    :folder&&<div className="nb-empty"><p>Ve složce „{folder.name}“ zatím nejsou žádné papíry.</p><p>Založ první – třeba report za tento týden.</p></div>}
  </section>
  {noteId?<Paper key={noteId} id={noteId} initial={fresh?.id===noteId?fresh:null} folders={folders} markets={markets} onMeta={onMeta} onDeleted={onDeleted} onClose={()=>setNoteId(null)} onLost={onLost}/>
   :<div className="nb-paper nb-blank"><FileText size={28} aria-hidden="true"/><p>{list.length?'Vyber papír ze seznamu, nebo založ nový.':'Tady se otevře papír, do kterého budeš psát.'}</p></div>}
 </div>;
}
