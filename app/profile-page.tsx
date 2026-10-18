'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Camera,Check,LogOut,Settings,Link2,Trash2,Upload,ZoomIn,ZoomOut,ShieldCheck} from 'lucide-react';
import {STYLES,MARKETS,AVATAR_COLORS,LIMITS,AVATAR_PX,AVATAR_MAX_BYTES,FIRST_YEAR,emptyProfile,type Profile,type Style,type Market} from '@/lib/profile/rules';
import {vocative,greeting} from '@/lib/dashboard';
import {Avatar} from './avatar';
import {usePalette} from './palette';
import {dropPush} from './notify-settings';
import './mt.css';
import './profile.css';
type Data={profile:Profile;avatar:string|null;memberSince:string|null;lastLogin:string|null;account:{googleName:string;first:string|null;email:string;role:string;owner:boolean}};
type Status={kind:'idle'|'saving'|'saved'|'err';msg?:string};
const json={'Content-Type':'application/json'};
const errorOf=async(r:Response,fallback:string)=>{const j=await r.json().catch(()=>null) as {error?:string}|null;return j?.error||fallback};
const roleLabel=(a:Data['account'])=>a.owner?'Vlastník':a.role==='admin'?'Administrátor':'Člen';
// waitlist.created je čas serveru, last_login UTC (UTC_TIMESTAMP)
const day=(s:string|null)=>s?new Date(s.slice(0,10)+'T12:00:00').toLocaleDateString('cs-CZ',{day:'numeric',month:'long',year:'numeric'}):'—';
const stamp=(s:string|null)=>s?new Date(s.replace(' ','T')+'Z').toLocaleString('cs-CZ',{day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const toggle=<T,>(a:T[],x:T)=>a.includes(x)?a.filter(y=>y!==x):[...a,x];

/** Ořez fotky do kruhu: tažení myší/prstem nebo šipkami, zoom posuvníkem, kolečkem nebo +/−. Výsledek je čtverec AVATAR_PX. */
function Cropper({src,busy,onCancel,onDone}:{src:string;busy:boolean;onCancel:()=>void;onDone:(b:Blob)=>void}){
 const V=240,stage=useRef<HTMLDivElement>(null),img=useRef<HTMLImageElement>(null),drag=useRef<{x:number;y:number;ox:number;oy:number}|null>(null);
 const [nat,setNat]=useState<{w:number;h:number}|null>(null),[zoom,setZoom]=useState(1),[off,setOff]=useState({x:0,y:0}),[err,setErr]=useState('');
 const size=(z:number)=>{const s=nat?V/Math.min(nat.w,nat.h)*z:1;return {s,w:nat?nat.w*s:V,h:nat?nat.h*s:V}};
 const {s,w,h}=size(zoom);
 // obrázek musí vždy zakrýt celý kruh
 const clamp=(o:{x:number;y:number},z=zoom)=>{const {w,h}=size(z);return {x:Math.max(-(w-V)/2,Math.min((w-V)/2,o.x)),y:Math.max(-(h-V)/2,Math.min((h-V)/2,o.y))}};
 const zoomTo=(z:number)=>{const n=Math.min(4,Math.max(1,z));setZoom(n);setOff(o=>clamp(o,n))};
 const zoomRef=useRef(zoomTo),zRef=useRef(zoom);
 useEffect(()=>{zoomRef.current=zoomTo;zRef.current=zoom});
 useEffect(()=>{const el=stage.current;if(!el)return;const wheel=(e:WheelEvent)=>{e.preventDefault();zoomRef.current(zRef.current*(e.deltaY<0?1.08:1/1.08))};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel)},[]);
 const down=(e:React.PointerEvent)=>{if(!nat)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,ox:off.x,oy:off.y}};
 const move=(e:React.PointerEvent)=>{const d=drag.current;if(d)setOff(clamp({x:d.ox+e.clientX-d.x,y:d.oy+e.clientY-d.y}))};
 const up=()=>{drag.current=null};
 const key=(e:React.KeyboardEvent)=>{const k=e.key,step=e.shiftKey?24:8;const m:Record<string,[number,number]>={ArrowLeft:[step,0],ArrowRight:[-step,0],ArrowUp:[0,step],ArrowDown:[0,-step]};
  if(m[k]){e.preventDefault();setOff(o=>clamp({x:o.x+m[k][0],y:o.y+m[k][1]}))}else if(k==='+'||k==='='){e.preventDefault();zoomTo(zoom*1.1)}else if(k==='-'){e.preventDefault();zoomTo(zoom/1.1)}};
 const done=()=>{const el=img.current;if(!el||!nat)return;const c=document.createElement('canvas');c.width=c.height=AVATAR_PX;const ctx=c.getContext('2d');if(!ctx)return setErr('Prohlížeč neumí fotku upravit.');
  ctx.imageSmoothingQuality='high';const L=(V-w)/2+off.x,T=(V-h)/2+off.y;ctx.drawImage(el,-L/s,-T/s,V/s,V/s,0,0,AVATAR_PX,AVATAR_PX);
  // WebP (Safari ho neumí zakódovat → vrátí PNG); kdyby byl soubor moc velký, JPEG
  c.toBlob(b=>{if(b&&b.size<=AVATAR_MAX_BYTES)return onDone(b);c.toBlob(j=>j?onDone(j):setErr('Fotku se nepodařilo zpracovat.'),'image/jpeg',.85)},'image/webp',.9)};
 return <div className="pf-crop">
  <div ref={stage} className={'pf-crop-stage'+(nat?'':' loading')} style={{width:V,height:V}} tabIndex={0} aria-label="Výřez fotky. Posun šipkami, přiblížení klávesami plus a minus." onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
   <img ref={img} src={src} alt="" draggable={false} onLoad={e=>{const t=e.currentTarget;if(t.naturalWidth<2||t.naturalHeight<2)return setErr('Obrázek je moc malý.');setNat({w:t.naturalWidth,h:t.naturalHeight})}} onError={()=>setErr('Obrázek se nepodařilo načíst. Zkus PNG, JPG nebo WebP.')} style={{width:w,height:h,transform:`translate(${(V-w)/2+off.x}px,${(V-h)/2+off.y}px)`}}/>
   <i className="pf-crop-ring" aria-hidden="true"/>
  </div>
  <div className="pf-zoom"><button type="button" className="mt-icon" aria-label="Oddálit" onClick={()=>zoomTo(zoom/1.15)} disabled={!nat||zoom<=1}><ZoomOut size={15}/></button><input type="range" min={1} max={4} step={0.01} value={zoom} style={{'--p':`${(zoom-1)/3*100}%`} as React.CSSProperties} onChange={e=>zoomTo(Number(e.target.value))} aria-label="Přiblížení" disabled={!nat}/><button type="button" className="mt-icon" aria-label="Přiblížit" onClick={()=>zoomTo(zoom*1.15)} disabled={!nat||zoom>=4}><ZoomIn size={15}/></button></div>
  <p className="pf-hint">Táhni fotku, aby byl obličej uprostřed kruhu.</p>
  {err&&<p className="pf-err" role="alert">{err}</p>}
  <div className="pf-actions"><button type="button" className="mt-btn" onClick={onCancel} disabled={busy}>Zrušit</button><button type="button" className="mt-btn primary" onClick={done} disabled={!nat||busy}><Check size={15}/>{busy?'Ukládám…':'Uložit fotku'}</button></div>
 </div>;
}

function Photo({data,name,color,setColor,onAvatar}:{data:Data;name:string;color:string|null;setColor:(c:string|null)=>void;onAvatar:(a:string|null)=>void}){
 const file=useRef<HTMLInputElement>(null),[src,setSrc]=useState<string|null>(null),[busy,setBusy]=useState(false),[st,setSt]=useState<Status>({kind:'idle'});
 useEffect(()=>()=>{if(src)URL.revokeObjectURL(src)},[src]);
 // fotoaparát v hlavičce profilu otevře stejný výběr souboru
 useEffect(()=>{const open=()=>file.current?.click();addEventListener('tradee:pick-photo',open);return()=>removeEventListener('tradee:pick-photo',open)},[]);
 const pick=(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;
  if(!/^image\//.test(f.type))return setSt({kind:'err',msg:'Vyber obrázek (PNG, JPG nebo WebP).'});if(f.size>20*1024*1024)return setSt({kind:'err',msg:'Obrázek může mít nejvýš 20 MB.'});
  setSt({kind:'idle'});setSrc(URL.createObjectURL(f))};
 const upload=async(b:Blob)=>{setBusy(true);try{const fd=new FormData();fd.append('file',b,'avatar.'+(b.type.split('/')[1]||'png'));const r=await fetch('/api/profile/avatar',{method:'POST',body:fd});if(!r.ok)throw Error(await errorOf(r,'Fotku se nepodařilo uložit.'));const j=await r.json() as {avatar:string|null};onAvatar(j.avatar);setSrc(null);setSt({kind:'saved',msg:'Fotka uložena'})}catch(e){setSt({kind:'err',msg:(e as Error).message})}finally{setBusy(false)}};
 const remove=async()=>{setBusy(true);try{const r=await fetch('/api/profile/avatar',{method:'DELETE'});if(!r.ok)throw Error(await errorOf(r,'Fotku se nepodařilo odebrat.'));onAvatar(null);setSt({kind:'saved',msg:'Fotka odebrána'})}catch(e){setSt({kind:'err',msg:(e as Error).message})}finally{setBusy(false)}};
 return <section className="mt-card pf-card" id="fotka">
  <div className="pf-title"><h2>Profilová fotka</h2><span className="pf-status" role="status" aria-live="polite">{st.kind==='saved'&&<><Check size={14}/>{st.msg}</>}</span></div>
  {src?<Cropper src={src} busy={busy} onCancel={()=>setSrc(null)} onDone={upload}/>:<>
   <div className="pf-photo">
    <span className="pf-photo-av"><Avatar name={name} src={data.avatar} color={color}/></span>
    <div className="pf-actions col">
     <button type="button" className="mt-btn primary" onClick={()=>file.current?.click()} disabled={busy}><Upload size={15}/>{data.avatar?'Nahrát jinou':'Nahrát fotku'}</button>
     {data.avatar&&<button type="button" className="mt-btn" onClick={remove} disabled={busy}><Trash2 size={15}/>Odebrat</button>}
    </div>
   </div>
   <p className="pf-hint">PNG, JPG nebo WebP. Před uložením fotku ořízneš do kruhu.</p>
   {st.kind==='err'&&<p className="pf-err" role="alert">{st.msg}</p>}
   <div className="pf-sub" role="radiogroup" aria-label="Barva kolečka s iniciálami">
    <span className="pf-label">Barva bez fotky</span>
    <div className="pf-swatches">{AVATAR_COLORS.map((c,i)=>{const on=(color||AVATAR_COLORS[0])===c;return <button key={c} type="button" role="radio" aria-checked={on} aria-label={`Barva ${i+1}`} className={'pf-swatch'+(on?' on':'')} style={{background:i===0?'linear-gradient(140deg,#245bff,#7a5cff)':c}} onClick={()=>setColor(i===0?null:c)}>{on&&<Check size={14}/>}</button>})}</div>
   </div>
  </>}
  <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick}/>
 </section>;
}

function Account({data}:{data:Data}){
 const a=data.account;
 return <section className="mt-card pf-card pf-acc">
  <h2>Účet</h2>
  <dl className="pf-dl">
   <div><dt>E-mail</dt><dd>{a.email}</dd></div>
   <div><dt>Přihlášení</dt><dd>Google · {a.googleName}</dd></div>
   <div><dt>Role</dt><dd><span className="pf-role"><ShieldCheck size={14}/>{roleLabel(a)}</span></dd></div>
   <div><dt>Členem od</dt><dd>{day(data.memberSince)}</dd></div>
   <div><dt>Poslední přihlášení</dt><dd>{stamp(data.lastLogin)}</dd></div>
  </dl>
  <p className="pf-hint">E-mail a heslo spravuje Google. Jméno z Google se použije, když pole Jméno necháš prázdné.</p>
  <div className="pf-actions col">
   <a className="mt-btn" href="/nastaveni"><Settings size={15}/>Nastavení</a>
   <a className="mt-btn" href="/mt"><Link2 size={15}/>Propojení s MetaTraderem</a>
   <form method="post" action="/auth/logout" onSubmit={e=>{e.preventDefault();const f=e.currentTarget;dropPush().finally(()=>f.submit())}}><button type="submit" className="mt-btn pf-out"><LogOut size={15}/>Odhlásit</button></form>
  </div>
 </section>;
}

export default function ProfilePage(){
 usePalette();
 const [data,setData]=useState<Data|null>(null),[loadErr,setLoadErr]=useState(''),[form,setForm]=useState<Profile>(emptyProfile),[st,setSt]=useState<Status>({kind:'idle'});
 const load=()=>{fetch('/api/profile',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error(await errorOf(r,'Profil se nepodařilo načíst.'));return r.json() as Promise<Data>}).then(d=>{setData(d);setForm(d.profile)}).catch(e=>setLoadErr((e as Error).message))};
 useEffect(load,[]);
 const saved=data?.profile,dirty=!!saved&&JSON.stringify(form)!==JSON.stringify(saved);
 // neuložené změny: prohlížeč se před odchodem zeptá
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=''};addEventListener('beforeunload',warn);return()=>removeEventListener('beforeunload',warn)},[dirty]);
 useEffect(()=>{if(st.kind!=='saved')return;const t=setTimeout(()=>setSt({kind:'idle'}),2500);return()=>clearTimeout(t)},[st]);
 const set=<K extends keyof Profile>(k:K,v:Profile[K])=>{setForm(f=>({...f,[k]:v}));if(st.kind!=='saving')setSt({kind:'idle'})};
 const save=async(e?:React.FormEvent)=>{e?.preventDefault();if(!saved||!dirty||st.kind==='saving')return;
  const patch:Record<string,unknown>={};for(const k of Object.keys(form) as (keyof Profile)[])if(JSON.stringify(form[k])!==JSON.stringify(saved[k]))patch[k]=form[k];
  setSt({kind:'saving'});
  try{const r=await fetch('/api/profile',{method:'POST',headers:json,body:JSON.stringify(patch)});if(!r.ok)throw Error(await errorOf(r,'Profil se nepodařilo uložit.'));const d=await r.json() as Omit<Data,'account'>;setData(x=>x&&{...x,...d});setForm(d.profile);setSt({kind:'saved'})}
  catch(e){setSt({kind:'err',msg:(e as Error).message})}};
 if(!data)return <div className="mt-page pf-page"><header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header><main className="mt-main pf-main">
  <h1>Profil</h1>
  {loadErr?<div className="mt-alert pf-load-err" role="alert"><span>{loadErr}</span><button type="button" className="mt-btn" onClick={()=>{setLoadErr('');load()}}>Zkusit znovu</button></div>:<div className="pf-hero pf-skel" aria-busy="true" aria-label="Načítám profil"><i/><div><b/><span/><span/></div></div>}
 </main></div>;
 const a=data.account,name=form.displayName?.trim()||a.googleName,auto=vocative(a.first||name);
 const tags=[...form.styles.map(s=>STYLES[s]),...form.markets.map(m=>MARKETS[m])];
 const year=new Date().getFullYear(),years=Array.from({length:year-FIRST_YEAR+1},(_,i)=>year-i);
 return <div className="mt-page pf-page">
  <header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main pf-main">
   <h1>Profil</h1>
   <p className="mt-lead">Jak tě Tradee oslovuje a co o sobě ukazuješ. Změny se ukládají k tvému účtu.</p>
   <section className="pf-hero" aria-label="Náhled profilu">
    <div className="pf-hero-av"><Avatar name={name} src={data.avatar} color={form.color}/><button type="button" className="pf-cam" aria-label="Změnit profilovou fotku" title="Změnit fotku" onClick={()=>dispatchEvent(new Event('tradee:pick-photo'))}><Camera size={16}/></button></div>
    <div className="pf-hero-txt">
     <h2>{name}</h2>
     <p className="pf-meta">{a.email}<span aria-hidden="true">·</span>{roleLabel(a)}{data.memberSince&&<><span aria-hidden="true">·</span>v Tradee od {day(data.memberSince)}</>}</p>
     {form.bio&&<p className="pf-bio">{form.bio}</p>}
     {(tags.length>0||form.since)&&<ul className="pf-tags" aria-label="Obchodování">{tags.map(t=><li key={t}>{t}</li>)}{form.since&&<li>Obchoduje od {form.since}</li>}</ul>}
    </div>
   </section>
   <div className="pf-grid">
    <div className="pf-col">
     <Photo data={data} name={name} color={form.color} setColor={c=>set('color',c)} onAvatar={av=>setData(d=>d&&{...d,avatar:av})}/>
     <Account data={data}/>
    </div>
    <form id="pf-form" className="pf-col" onSubmit={save}>
     <section className="mt-card pf-card">
      <h2>Osobní údaje</h2>
      <div className="pf-field"><label className="pf-label" htmlFor="pf-name">Jméno</label><input id="pf-name" aria-describedby="pf-name-hint" value={form.displayName??''} maxLength={LIMITS.name} placeholder={a.googleName} autoComplete="name" onChange={e=>set('displayName',e.target.value||null)}/><small className="pf-hint" id="pf-name-hint">Zobrazí se v Tradee místo jména z Google účtu.</small></div>
      <div className="pf-field"><label className="pf-label" htmlFor="pf-greet">Oslovení</label><input id="pf-greet" aria-describedby="pf-greet-hint" value={form.greet??''} maxLength={LIMITS.greet} placeholder={auto} onChange={e=>set('greet',e.target.value||null)}/><small className="pf-hint" id="pf-greet-hint">Dashboard tě pozdraví: {greeting(new Date())}, <b>{form.greet?.trim()||auto}</b>. Prázdné = automaticky z křestního jména.</small></div>
      <div className="pf-field"><div className="pf-label"><label htmlFor="pf-bio">O mně</label><small>{[...(form.bio??'')].length}/{LIMITS.bio}</small></div><textarea id="pf-bio" value={form.bio??''} maxLength={LIMITS.bio} rows={4} placeholder="Pár slov o tom, jak obchoduješ a co tě baví." onChange={e=>set('bio',e.target.value||null)}/></div>
     </section>
     <section className="mt-card pf-card">
      <h2>Obchodování</h2>
      <div className="pf-field" role="group" aria-labelledby="pf-styles"><span className="pf-label" id="pf-styles">Styl</span><div className="pf-chips">{(Object.keys(STYLES) as Style[]).map(k=><button key={k} type="button" aria-pressed={form.styles.includes(k)} className={'pf-chip'+(form.styles.includes(k)?' on':'')} onClick={()=>set('styles',(Object.keys(STYLES) as Style[]).filter(x=>toggle(form.styles,k).includes(x)))}>{STYLES[k]}</button>)}</div></div>
      <div className="pf-field" role="group" aria-labelledby="pf-markets"><span className="pf-label" id="pf-markets">Trhy</span><div className="pf-chips">{(Object.keys(MARKETS) as Market[]).map(k=><button key={k} type="button" aria-pressed={form.markets.includes(k)} className={'pf-chip'+(form.markets.includes(k)?' on':'')} onClick={()=>set('markets',(Object.keys(MARKETS) as Market[]).filter(x=>toggle(form.markets,k).includes(x)))}>{MARKETS[k]}</button>)}</div></div>
      <div className="pf-field"><label className="pf-label" htmlFor="pf-since">Obchoduji od</label><select id="pf-since" value={form.since??''} onChange={e=>set('since',e.target.value?Number(e.target.value):null)}><option value="">Neuvedeno</option>{years.map(y=><option key={y} value={y}>{y}</option>)}</select></div>
     </section>
    </form>
    {(dirty||st.kind!=='idle')&&<div className={'pf-bar'+(st.kind==='err'?' err':'')+(!dirty&&st.kind==='saved'?' done':'')} role="status" aria-live="polite">
     <span>{st.kind==='err'?st.msg:st.kind==='saving'?'Ukládám…':!dirty&&st.kind==='saved'?<><Check size={15}/> Profil uložen</>:'Máš neuložené změny'}</span>
     {dirty&&<div className="pf-actions"><button type="button" className="mt-btn" onClick={()=>{setForm(saved!);setSt({kind:'idle'})}} disabled={st.kind==='saving'}>Zrušit</button><button type="submit" form="pf-form" className="mt-btn primary" disabled={st.kind==='saving'}>Uložit změny</button></div>}
    </div>}
   </div>
  </main>
 </div>;
}
