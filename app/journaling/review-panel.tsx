'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {X,Star,ExternalLink} from 'lucide-react';
import type {JournalTrade} from '@/lib/journal/types';
import type {SnapshotList} from '@/lib/checklists/core';
import {RULES,EMOTIONS,REASONS,REVIEW_LIMITS} from '@/lib/discipline/rules';
import {fmtMoney} from '@/lib/trades';
import {fmtR,fmtHold,fmtNum,fmtDateTime,fmtDate} from '@/lib/journal/format';
export type Strat={id:string;name:string;archived:boolean};
export type Custom={id:string;text:string};
type Review={rating:number|null;strategyId:string|null;reason:string;emotions:string[];lesson:string;customBroken:string[]};
type Viol={id:number;rule:string;detail:Record<string,unknown>;needsReason:boolean;reasonCode:string|null;reasonText:string|null};
type Rev={review:Review;violations:Viol[];checklist?:SnapshotList[]|null};
type Form={rating:number|null;strategyId:string;newName:string;reason:string;lesson:string;emotions:string[];custom:string[];reasons:Record<string,{code:string;text:string}>};
const NEW='__new';
const n=(v:unknown,d=2)=>fmtNum(typeof v==='number'?v:Number(v),d);
// lidský popis automatického porušení (detail z vyhodnocení pravidla)
export function violationText(rule:string,d:Record<string,unknown>):string{
 switch(rule){
  case 'sl_required':return 'Stop loss nebyl nastaven do 2 minut od vstupu.';
  case 'max_risk':return `Riziko ${n(d.riskPct)} % (limit ${n(d.limit)} %)`;
  case 'max_total_risk':return `Celkové otevřené riziko ${n(d.totalPct)} % (limit ${n(d.limit)} %)`;
  case 'max_trades_day':return `${n(d.n,0)}. obchod dne (limit ${n(d.limit,0)})`;
  case 'stop_after_losses':return `Další obchod po ${n(d.losses,0)} ztrátách v řadě (limit ${n(d.limit,0)})`;
  case 'max_daily_loss':return `Denní ztráta ${n(d.lossPct)} % (limit ${n(d.limit)} %)`;
  case 'no_early_close':return 'Pozice zavřena ručně dřív, než ji vyřídil SL nebo TP.';
  case 'no_sl_widen':return `Stop loss posunut proti obchodu z ${n(d.from,5)} na ${n(d.to,5)}.`;
  case 'no_news':return 'Vstup krátce před nebo po zprávě s vysokým dopadem.';
  default:return '';
 }
}
export const ruleLabel=(rule:string,custom:Custom[])=>rule.startsWith('custom:')?custom.find(c=>c.id===rule.slice(7))?.text||'Smazané pravidlo':RULES.find(r=>r.id===rule)?.label||rule;
export function Stars({value,size=14,onPick,label}:{value:number|null;size?:number;onPick?:(n:number)=>void;label?:string}){
 return <span className={'jg-stars'+(onPick?' pick':'')} role={onPick?'radiogroup':'img'} aria-label={label||(value?`Hodnocení ${value} z 5`:'Nevyhodnoceno')}>{[1,2,3,4,5].map(i=>{const on=!!value&&i<=value,s=<Star size={size} className={on?'on':''} fill={on?'currentColor':'none'} aria-hidden="true"/>;
  return onPick?<button key={i} type="button" role="radio" aria-checked={value===i} aria-label={`${i} z 5`} onClick={()=>onPick(i)}>{s}</button>:<i key={i}>{s}</i>})}</span>;
}
const toForm=(r:Rev):Form=>({rating:r.review.rating,strategyId:r.review.strategyId||'',newName:'',reason:r.review.reason,lesson:r.review.lesson,emotions:r.review.emotions,custom:r.review.customBroken,reasons:Object.fromEntries(r.violations.filter(v=>v.needsReason).map(v=>[v.rule,{code:v.reasonCode||'',text:v.reasonText||''}]))});
export function ReviewPanel({id,trade,currency,strategies,custom,readOnly,query,nextId,dirtyRef,onClose,onOpen,onSaved}:{id:string;trade?:JournalTrade;currency:string;strategies:Strat[];custom:Custom[];readOnly:boolean;query:string;nextId:string|null;dirtyRef:{current:boolean};onClose:()=>void;onOpen:(id:string)=>void;onSaved:()=>void}){
 const [rev,setRev]=useState<Rev|null>(null),[form,setForm]=useState<Form|null>(null),[base,setBase]=useState(''),[error,setError]=useState(''),[state,setState]=useState<'idle'|'saving'|'saved'>('idle'),[loadErr,setLoadErr]=useState('');
 const top=useRef<HTMLDivElement>(null);
 useEffect(()=>{let live=true;setRev(null);setForm(null);setError('');setLoadErr('');setState('idle');
  fetch('/api/reviews/'+encodeURIComponent(id)+query,{cache:'no-store'}).then(async r=>{const j=await r.json() as Rev&{error?:string};if(!r.ok)throw Error(j.error||'');if(!live)return;const f=toForm(j);setRev(j);setForm(f);setBase(JSON.stringify(f))}).catch(e=>{if(live)setLoadErr((e as Error).message||'Vyhodnocení se nepodařilo načíst.')});
  top.current?.scrollIntoView?.({block:'nearest'});
  return()=>{live=false}},[id,query]);
 const dirty=!!form&&JSON.stringify(form)!==base;
 useEffect(()=>{dirtyRef.current=dirty&&!readOnly;return()=>{dirtyRef.current=false}},[dirty,readOnly,dirtyRef]);
 useEffect(()=>{if(!dirty||readOnly)return;const f=(e:BeforeUnloadEvent)=>{e.preventDefault()};addEventListener('beforeunload',f);return()=>removeEventListener('beforeunload',f)},[dirty,readOnly]);
 const unmet=useMemo(()=>(rev?.checklist||[]).map(l=>({name:l.name,items:l.items.filter(i=>!i.checked)})).filter(l=>l.items.length),[rev]);
 const set=(p:Partial<Form>)=>{setForm(f=>f&&{...f,...p});if(state==='saved')setState('idle')};
 const toggle=(list:string[],v:string)=>list.includes(v)?list.filter(x=>x!==v):[...list,v];
 const leave=(fn:()=>void)=>{if(dirty&&!readOnly&&!confirm('Máš neuložené změny. Opravdu je zahodit?'))return;fn()};
 async function save(andNext:boolean){
  if(!form||!rev||state==='saving')return;
  for(const v of rev.violations)if(v.needsReason){const r=form.reasons[v.rule];if(r?.code==='other'&&!r.text.trim()){setError(`U pravidla „${ruleLabel(v.rule,custom)}“ napiš, proč jsi zvolil „Jiné“.`);return}}
  setState('saving');setError('');
  const reasons=Object.fromEntries(Object.entries(form.reasons).filter(([,r])=>r.code).map(([k,r])=>[k,{code:r.code,text:r.text.trim()}]));
  const body={rating:form.rating,...(form.strategyId===NEW?(form.newName.trim()?{strategyName:form.newName.trim()}:{strategyId:null}):{strategyId:form.strategyId||null}),reason:form.reason,lesson:form.lesson,emotions:form.emotions,customBroken:form.custom,reasons};
  try{
   const r=await fetch('/api/reviews/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const j=await r.json() as Rev&{error?:string};if(!r.ok)throw Error(j.error||'');
   const merged={...j,checklist:rev.checklist},f=toForm(merged);setRev(merged);setForm(f);setBase(JSON.stringify(f));setState('saved');dirtyRef.current=false;onSaved();
   if(andNext){if(nextId)onOpen(nextId);else onClose()}
  }catch(e){setState('idle');setError((e as Error).message||'Vyhodnocení se nepodařilo uložit. Zkus to znovu.')}
 }
 const head=<div className="jg-phead" ref={top}><div className="jg-ptitle">{trade?<><b>{trade.symbol}</b>{trade.side&&<span className={'j-side '+trade.side}>{trade.side==='buy'?'Buy':'Sell'}</span>}<span className={'jg-res '+(trade.pnl>0?'pos':trade.pnl<0?'neg':'')}>{fmtMoney(trade.pnl,trade.converted?currency:trade.accountCurrency||currency)}</span></>:<b>Obchod</b>}</div><button type="button" className="jg-x" aria-label="Zavřít panel" onClick={()=>leave(onClose)}><X size={18}/></button></div>;
 const preview=trade&&<div className="jg-prev"><span>{trade.source==='mt'&&trade.closeTs?fmtDateTime(trade.closeTs):fmtDate(trade.date)}</span><span>R <b>{fmtR(trade.r)}</b></span><span>Držení <b>{fmtHold(trade.holdMs)}</b></span><a href={'#journal/'+encodeURIComponent(id)} onClick={e=>{if(dirty&&!readOnly&&!confirm('Máš neuložené změny. Opravdu je zahodit?'))e.preventDefault()}}>Otevřít v Deníku <ExternalLink size={13}/></a></div>;
 if(loadErr)return <aside className="jg-panel" aria-label="Vyhodnocení obchodu">{head}<p role="alert" className="s-notice">{loadErr}</p></aside>;
 if(!rev||!form)return <aside className="jg-panel" aria-label="Vyhodnocení obchodu">{head}{preview}<p className="j-muted">Načítám vyhodnocení…</p></aside>;
 const active=strategies.filter(s=>!s.archived||s.id===form.strategyId);
 return <aside className="jg-panel" aria-label="Vyhodnocení obchodu">
  {head}{preview}
  <fieldset className="jg-form" disabled={readOnly}>
   <section><h3>Hodnocení</h3><div className="jg-rate"><Stars value={form.rating} size={26} onPick={v=>set({rating:form.rating===v?null:v})} label="Hodnocení obchodu"/><small>{form.rating?`${form.rating} z 5 · klikni znovu pro zrušení`:'Zatím nehodnoceno'}</small></div></section>
   <section><label className="jg-lab" htmlFor="jg-strat">Strategie</label>
    <select id="jg-strat" value={form.strategyId} onChange={e=>set({strategyId:e.target.value})}><option value="">Bez strategie</option>{active.map(s=><option key={s.id} value={s.id}>{s.name}{s.archived?' (archivovaná)':''}</option>)}<option value={NEW}>+ Nová strategie…</option></select>
    {form.strategyId===NEW&&<input className="jg-new" placeholder="Název nové strategie" maxLength={60} value={form.newName} onChange={e=>set({newName:e.target.value})} aria-label="Název nové strategie"/>}</section>
   <section><label className="jg-lab" htmlFor="jg-why">Proč jsem šel dovnitř</label><textarea id="jg-why" rows={3} maxLength={REVIEW_LIMITS.text} value={form.reason} onChange={e=>set({reason:e.target.value})} placeholder="Setup, důvod, co jsem čekal…"/></section>
   <section><h3>Pravidla</h3>
    {!rev.violations.length&&!custom.length&&!unmet.length&&<p className="j-muted">Žádná porušení ani vlastní pravidla.</p>}
    {rev.violations.map(v=>{const r=form.reasons[v.rule]||{code:'',text:''};return <div key={v.id} className="jg-viol"><b>{ruleLabel(v.rule,custom)}</b><p>{violationText(v.rule,v.detail)}</p>
     {v.needsReason&&<div className="jg-why"><select aria-label={`Důvod porušení: ${ruleLabel(v.rule,custom)}`} value={r.code} onChange={e=>set({reasons:{...form.reasons,[v.rule]:{...r,code:e.target.value}}})}><option value="">Vyber důvod…</option>{REASONS.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select>
      <input placeholder={r.code==='other'?'Důvod (povinné)':'Poznámka (nepovinná)'} maxLength={REVIEW_LIMITS.reasonText} value={r.text} onChange={e=>set({reasons:{...form.reasons,[v.rule]:{...r,text:e.target.value}}})} aria-label="Text zdůvodnění"/></div>}</div>})}
    {unmet.length>0&&<div className="jg-unmet"><b>Nesplněno při vstupu</b>{unmet.map(l=><div key={l.name}><small>{l.name}</small><ul>{l.items.map(i=><li key={i.id}>{i.text}</li>)}</ul></div>)}</div>}
    {custom.length>0&&<div className="jg-custom"><b>Vlastní pravidla</b>{custom.map(c=><label key={c.id} className="jg-check"><input type="checkbox" checked={form.custom.includes(c.id)} onChange={()=>set({custom:toggle(form.custom,c.id)})}/><span>Porušil jsem: {c.text}</span></label>)}</div>}
   </section>
   <section><h3>Emoce</h3><div className="jg-chips">{EMOTIONS.map(e=><button key={e.id} type="button" aria-pressed={form.emotions.includes(e.id)} className={form.emotions.includes(e.id)?'on':''} onClick={()=>set({emotions:toggle(form.emotions,e.id)})}>{e.label}</button>)}</div></section>
   <section><label className="jg-lab" htmlFor="jg-less">Co příště jinak</label><textarea id="jg-less" rows={3} maxLength={REVIEW_LIMITS.text} value={form.lesson} onChange={e=>set({lesson:e.target.value})} placeholder="Jedno konkrétní ponaučení"/></section>
  </fieldset>
  {readOnly?<p className="j-muted">Cizí deník – jen pro čtení.</p>:<div className="jg-foot">
   {error&&<p role="alert" className="jg-err">{error}</p>}
   <div className="jg-btns"><button type="button" className="j-btn dark" disabled={state==='saving'||!dirty} onClick={()=>save(false)}>{state==='saving'?'Ukládám…':'Uložit'}</button><button type="button" className="j-btn" disabled={state==='saving'} onClick={()=>save(true)}>Uložit a další</button><span className="jg-state" role="status">{state==='saved'?'Uloženo':dirty?'Neuložené změny':''}</span></div>
  </div>}
 </aside>;
}
