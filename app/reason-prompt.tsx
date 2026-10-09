'use client';
import {useEffect,useRef,useState} from 'react';
import {REASONS,REVIEW_LIMITS} from '@/lib/discipline/rules';
import {fmtMoney} from '@/lib/trades';
import {fmtNum,fmtDateTime} from '@/lib/journal/format';
import './reason-prompt.css';
export type Pending={id:number;tradeId:string;rule:string;detail:Record<string,unknown>;created:string;trade:{symbol:string;side:string|null;closeTs:number|null;net:number|null;currency:string|null}};
const title=(p:Pending)=>p.rule==='no_early_close'?`Zavřel jsi ${p.trade.symbol} dřív, proč?`:p.rule==='no_sl_widen'?`Posunul jsi SL u ${p.trade.symbol} proti sobě, proč?`:`Proč jsi porušil pravidlo u ${p.trade.symbol}?`;
const detail=(p:Pending)=>{const d=p.detail,num=(v:unknown)=>typeof v==='number'?fmtNum(v,5):null;
 if(p.rule==='no_sl_widen'){const a=num(d.from),b=num(d.to);return a&&b?`SL ${a} → ${b}`:a||b?`SL → ${b||a}`:''}
 return p.rule==='no_early_close'?'Pozice zavřena ručně dřív, než ji vyřídil SL nebo TP.':''};
// Okno s výzvami ke zdůvodnění porušení: po jedné, „Později“ odloží okno na serveru na 4 h.
export function ReasonPrompt({items,onClose}:{items:Pending[];onClose:()=>void}){
 const [i,setI]=useState(0),[code,setCode]=useState(''),[text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),box=useRef<HTMLDivElement>(null);
 const p=items[i];
 useEffect(()=>{box.current?.focus()},[i]);
 async function later(){
  if(busy)return;setBusy(true);
  try{await fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'snooze'})})}catch{}
  onClose();
 }
 const laterRef=useRef(later);laterRef.current=later;
 useEffect(()=>{const k=(e:KeyboardEvent)=>{if(e.key==='Escape')laterRef.current()};document.addEventListener('keydown',k);return()=>document.removeEventListener('keydown',k)},[]);
 if(!p)return null;
 const next=()=>{if(i+1>=items.length)onClose();else{setI(i+1);setCode('');setText('');setError('')}};
 async function save(){
  if(!code){setError('Vyber důvod.');return}
  if(code==='other'&&!text.trim()){setError('U důvodu „Jiné“ napiš, co se stalo.');return}
  setBusy(true);setError('');
  try{
   const r=await fetch('/api/violations/reason',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:p.id,code,text:text.trim()})});
   // 404 = porušení mezitím zmizelo nebo už je zdůvodněné (např. v Journalingu) → jen přeskočit
   if(!r.ok&&r.status!==404){const j=await r.json().catch(()=>({})) as {error?:string};throw Error(j.error||'')}
   setBusy(false);next();
  }catch(e){setBusy(false);setError((e as Error).message||'Zdůvodnění se nepodařilo uložit. Zkus to znovu.')}
 }
 const t=p.trade,sub=[t.net!==null?fmtMoney(t.net,t.currency||'USD'):'',t.closeTs?'zavřeno '+fmtDateTime(t.closeTs):''].filter(Boolean).join(' · '),det=detail(p);
 const onKeyDown=(e:React.KeyboardEvent)=>{
  if(e.key!=='Tab'||!box.current)return;
  const f=[...box.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],textarea,[tabindex="0"]')];
  if(!f.length)return;
  const first=f[0],last=f[f.length-1];
  if(e.shiftKey&&(document.activeElement===first||document.activeElement===box.current)){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
 };
 return <div className="rp-back"><div className="rp-box" ref={box} role="dialog" aria-modal="true" aria-labelledby="rp-title" tabIndex={-1} onKeyDown={onKeyDown}>
  <p className="rp-count">{i+1} z {items.length}</p>
  <h2 id="rp-title">{title(p)}</h2>
  {sub&&<p className={'rp-sub'+(t.net!==null&&t.net>0?' pos':t.net!==null&&t.net<0?' neg':'')}>{sub}</p>}
  {det&&<p className="rp-detail">{det}</p>}
  <div className="rp-chips" role="radiogroup" aria-label="Důvod">{REASONS.map(x=><button key={x.id} type="button" role="radio" aria-checked={code===x.id} className={code===x.id?'on':''} onClick={()=>{setCode(x.id);setError('')}}>{x.label}</button>)}</div>
  <textarea rows={3} maxLength={REVIEW_LIMITS.reasonText} value={text} onChange={e=>setText(e.target.value)} aria-label={code==='other'?'Důvod (povinné)':'Poznámka (nepovinná)'} placeholder={code==='other'?'Co se stalo? (povinné)':'Poznámka (nepovinná)'}/>
  {error&&<p role="alert" className="rp-err">{error}</p>}
  <div className="rp-btns"><button type="button" className="rp-btn dark" disabled={busy} onClick={save}>{busy?'Ukládám…':'Uložit'}</button><button type="button" className="rp-btn" disabled={busy} onClick={later}>Později</button><a className="rp-link" href={'#journaling/'+encodeURIComponent(p.tradeId)} onClick={()=>{void later()}}>Otevřít v Journalingu</a></div>
 </div></div>;
}
