'use client';
// Formulář alertu (nový i úprava) jako malé okno: z detailu trhu, z grafu (zvonek, pravé tlačítko / dlouhý stisk, klik na čáru) i ze stránky /alerty.
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {Bell,Trash2,X} from 'lucide-react';
import {validateAlert,COOLDOWN_MIN,type Kind,type Channel} from '@/lib/alerts/logic';
import {marketKind} from '@/lib/market-hours';
import {saveAlert,removeAlert,type ClientAlert} from './alert-api';
import {defaultAlertChannels} from '@/lib/notify/prefs';
import {useNotifyPrefs} from '../notify-settings';
import './alerts.css';
const KIND_LABEL:Record<Kind,string>={above:'Nad',below:'Pod',touch:'Dotyk',pct:'% dnes',score:'Skóre'};
const KIND_HINT:Record<Kind,string>={above:'Cena překročí úroveň zdola nahoru',below:'Cena prorazí úroveň shora dolů',touch:'Cena se úrovně dotkne z kterékoli strany',pct:'Změna od včerejšího zavření dosáhne hranice',score:'Skóre Tradee překříží hranici (počítá se při obnově skóre)'};
const REPEAT:[number|null,string][]=[[null,'Jednorázově'],[15,'Opakovat, nejdřív po 15 min'],[30,'Opakovat, nejdřív po 30 min'],[60,'Opakovat, nejdřív po 1 h'],[240,'Opakovat, nejdřív po 4 h'],[1440,'Opakovat, nejdřív po 24 h']];
/** Cena do pole formuláře: rozumný počet desetinných míst podle velikosti. */
export const levelStr=(v:number)=>{const a=Math.abs(v),s=v.toFixed(a<10?5:a<1000?3:2);return s.includes('.')?s.replace(/0+$/,'').replace(/\.$/,''):s};
const dayStr=(ms:number)=>{const d=new Date(ms);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const known=(id:string)=>marketKind(id);
export type FormProps={instrument:string;name?:string;price?:number|null;changePct?:number|null;score?:number|null;alert?:ClientAlert|null;level?:number|null;kind?:Kind;pushAvailable?:boolean;onClose:()=>void;onSaved?:(a:ClientAlert,warnings:string[])=>void};
export function AlertForm({instrument,name,price=null,changePct=null,score=null,alert=null,level,kind:kind0,pushAvailable,onClose,onSaved}:FormProps){
 const currency=marketKind(instrument)==='currency',id=useId();
 const [kind,setKind]=useState<Kind>(alert?.kind??kind0??(currency?'score':'above'));
 const priceInit=(alert&&alert.kind!=='score'&&alert.kind!=='pct'?alert.level:null)??level??price;
 const [lv,setLv]=useState(priceInit!==null&&priceInit!==undefined?levelStr(priceInit):'');
 const [scoreLv,setScoreLv]=useState(alert?.kind==='score'&&alert.level!==null?String(alert.level):score!==null?String(Math.round(score/10)*10):'0');
 const [pct,setPct]=useState(alert?.pct!==null&&alert?.pct!==undefined?String(alert.pct):'1');
 const [op,setOp]=useState<string>(alert?.op??(kind0==='score'?'above':'gte'));
 const [note,setNote]=useState(alert?.note??''),[cool,setCool]=useState<number|null>(alert?.cooldownMin??null);
 const [exp,setExp]=useState(alert?.expiresAt?dayStr(alert.expiresAt):''),[active,setActive]=useState(alert?alert.active:true);
 const np=useNotifyPrefs().data?.prefs.alerts,touched=useRef(false);
 const [ch,setCh]=useState<Channel[]>(alert?.channels??defaultAlertChannels(null,pushAvailable));
 // nový alert: výchozí kanály podle Nastavení → Upozornění → Cenové alerty (dokud uživatel kanály sám nezmění)
 useEffect(()=>{if(!alert&&np&&!touched.current)setCh(defaultAlertChannels(np,pushAvailable))},[alert,np,pushAvailable]);
 const [busy,setBusy]=useState(false),[err,setErr]=useState(''),[confirmDel,setConfirmDel]=useState(false);
 const box=useRef<HTMLFormElement>(null),[now]=useState(()=>Date.now());
 useEffect(()=>{const k=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',k);box.current?.querySelector<HTMLInputElement>('input[data-first]')?.focus();return()=>window.removeEventListener('keydown',k)},[onClose]);
 const kinds:Kind[]=currency?['score']:['above','below','touch','pct','score'];
 const scoreOp=op==='below'?'below':'above',pctOp=op==='lte'?'lte':'gte';
 const body=useMemo(()=>{
  const expiresAt=exp?new Date(exp+'T23:59:59').getTime():null;
  const base={instrument,kind,note,cooldownMin:cool,expiresAt,channels:ch,active};
  return kind==='pct'?{...base,pct,op:pctOp}:kind==='score'?{...base,level:scoreLv,op:scoreOp}:{...base,level:lv};
 },[instrument,kind,note,cool,exp,ch,active,pct,pctOp,scoreLv,scoreOp,lv]);
 // varování hned při psaní (stejná validace jako na serveru); chyby až při uložení
 const live=useMemo(()=>{try{return {warn:validateAlert(body,{known,price,score,changePct,pushAvailable,now}).warnings,error:''}}catch(e){return {warn:[] as string[],error:(e as Error).message}}},[body,price,score,changePct,pushAvailable,now]);
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;if(live.error){setErr(live.error);return}
  setBusy(true);setErr('');
  try{const r=await saveAlert({...body,hint:{score}},alert?.id);onSaved?.(r.alert,r.warnings);onClose()}catch(x){setErr((x as Error).message)}finally{setBusy(false)}};
 const del=async()=>{if(!alert)return;if(!confirmDel){setConfirmDel(true);return}setBusy(true);try{await removeAlert(alert.id);onClose()}catch(x){setErr((x as Error).message);setBusy(false)}};
 const flip=(c:Channel)=>{touched.current=true;setCh(l=>l.includes(c)?l.filter(x=>x!==c):[...l,c])};
 const offByPrefs=np?ch.filter(c=>!np[c]):[];
 return <div className="al-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <form ref={box} className="al-form" role="dialog" aria-modal="true" aria-labelledby={id+'t'} onSubmit={submit}>
   <div className="al-head"><Bell size={16} aria-hidden/><h2 id={id+'t'}>{alert?'Upravit alert':'Nový alert'} · {name||instrument}</h2><button type="button" className="al-x" aria-label="Zavřít" onClick={onClose}><X size={16}/></button></div>
   {price!==null&&!currency&&<p className="al-now">Aktuální cena <b>{levelStr(price)}</b>{changePct!==null&&<> · dnes {changePct>0?'+':''}{changePct.toLocaleString('cs-CZ',{maximumFractionDigits:2})} %</>}{score!==null&&<> · skóre {score>0?'+':''}{score.toLocaleString('cs-CZ',{maximumFractionDigits:1})}</>}</p>}
   <div className="al-seg" role="radiogroup" aria-label="Typ alertu">{kinds.map(k=><button key={k} type="button" role="radio" aria-checked={kind===k} title={KIND_HINT[k]} onClick={()=>{setKind(k);if(k==='pct'&&op!=='lte')setOp('gte');if(k==='score'&&op!=='below')setOp('above')}}>{KIND_LABEL[k]}</button>)}</div>
   <p className="al-hint">{KIND_HINT[kind]}</p>
   {kind==='pct'?<div className="al-row"><select aria-label="Směr" value={pctOp} onChange={e=>setOp(e.target.value)}><option value="gte">≥ (aspoň)</option><option value="lte">≤ (nejvýš)</option></select><input data-first inputMode="decimal" aria-label="Změna dnes v %" value={pct} onChange={e=>setPct(e.target.value)}/><span className="al-unit">%</span></div>
   :kind==='score'?<div className="al-row"><select aria-label="Směr" value={scoreOp} onChange={e=>setOp(e.target.value)}><option value="above">překříží nad</option><option value="below">překříží pod</option></select><input data-first inputMode="decimal" aria-label="Skóre −100 až +100" value={scoreLv} onChange={e=>setScoreLv(e.target.value)}/><span className="al-unit">bodů</span></div>
   :<div className="al-row"><label className="al-lbl" htmlFor={id+'l'}>Cena</label><input id={id+'l'} data-first inputMode="decimal" value={lv} onChange={e=>setLv(e.target.value)}/></div>}
   <label className="al-field"><span>Poznámka</span><textarea rows={2} maxLength={500} placeholder="Proč mě to zajímá…" value={note} onChange={e=>setNote(e.target.value)}/></label>
   <div className="al-grid">
    <label className="al-field"><span>Opakování</span><select value={cool===null?'':String(cool)} onChange={e=>setCool(e.target.value?Number(e.target.value):null)}>{REPEAT.map(([v,l])=><option key={l} value={v===null?'':String(v)}>{l}</option>)}{cool!==null&&!REPEAT.some(r=>r[0]===cool)&&cool>=COOLDOWN_MIN&&<option value={String(cool)}>Opakovat, nejdřív po {cool} min</option>}</select></label>
    <label className="al-field"><span>Vyprší</span><input type="date" value={exp} min={dayStr(now)} onChange={e=>setExp(e.target.value)}/><small>{exp?'na konci dne':'bez vypršení'}</small></label>
   </div>
   <fieldset className="al-ch"><legend>Kam poslat</legend>
    <label><input type="checkbox" checked={ch.includes('push')} onChange={()=>flip('push')}/> Push</label>
    <label><input type="checkbox" checked={ch.includes('mail')} onChange={()=>flip('mail')}/> E-mail</label>
    {alert&&<label className="al-active"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Aktivní</label>}
   </fieldset>
    {ch.includes('push')&&pushAvailable===false&&<p className="al-warn" role="status">Push nemáš zapnutý na žádném zařízení – tenhle alert by nedorazil. Zaškrtni i e-mail, nebo push zapni v <a href="/nastaveni#upozorneni">Nastavení → Upozornění</a>.</p>}
   {offByPrefs.length>0&&<p className="al-warn" role="status">{offByPrefs.map(c=>c==='push'?'Push':'E-mail').join(' a ')} máš u cenových alertů vypnutý v <a href="/nastaveni#upozorneni">Nastavení → Upozornění</a> – tímhle kanálem alert nepřijde.</p>}
   {live.warn.length>0&&<ul className="al-warn" role="status">{live.warn.map(w=><li key={w}>{w}</li>)}</ul>}
   {err&&<p className="p-error al-err" role="alert">{err}</p>}
   <div className="al-actions">
    {alert&&<button type="button" className={'al-btn danger'+(confirmDel?' on':'')} disabled={busy} onClick={del}><Trash2 size={14} aria-hidden/>{confirmDel?'Opravdu smazat':'Smazat'}</button>}
    <span className="al-sp"/>
    <button type="button" className="al-btn" onClick={onClose}>Zrušit</button>
    <button type="submit" className="al-btn primary" disabled={busy}>{busy?'Ukládám…':alert?'Uložit':'Vytvořit alert'}</button>
   </div>
  </form>
 </div>;
}
