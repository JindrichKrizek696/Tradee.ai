'use client';
// Stránka /ucty: profily účtů (osobní / challenge / funded), jejich pravidla s historií verzí, poplatky a přepisy instrumentů brokerem.
import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,Plus,Pencil,Trash2,Archive,ArchiveRestore,X,Calculator} from 'lucide-react';
import {TEMPLATES,TEMPLATE_NOTE,KIND_LABELS,emptyRules,type ProfileKind,type Rules} from '@/lib/risk/account';
import {type Override} from '@/lib/risk/instruments';
import {pragueDate} from '@/lib/mt/trades';
import {usePalette} from '../palette';
import {useRisk,reloadRisk,type ClientProfile,type RiskContext} from './risk-context';
import {RiskStatus} from './account-risk';
import '../mt.css';
import './risk.css';
const TZS=['Europe/Prague','Europe/London','America/New_York','America/Chicago','UTC','Asia/Tokyo','Australia/Sydney'];
type Draft={id?:string;name:string;kind:ProfileKind;currency:string;startBalance:string;startDate:string;balance:string;linkId:string;feeChallenge:string;feeActivation:string;rules:Rules;effective:string;archived:boolean};
const today=()=>pragueDate(Date.now());
const s=(n:number|null|undefined)=>n===null||n===undefined?'':String(n);
const toDraft=(p:ClientProfile):Draft=>({id:p.id,name:p.name,kind:p.kind,currency:p.currency,startBalance:s(p.startBalance),startDate:p.startDate,balance:s(p.balance),linkId:p.linkId||'',feeChallenge:s(p.feeChallenge),feeActivation:s(p.feeActivation),rules:p.rules,effective:today(),archived:p.archived});
async function call(url:string,method:string,body?:unknown){const r=await fetch(url,{method,cache:'no-store',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const j=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw Error(j.error||'Akce se nepovedla.');return j}
const nOrNull=(v:string)=>v.trim()===''?null:Number(v.replace(',','.'));
function Num({label,value,onChange,suffix,hint}:{label:string;value:string|number;onChange:(v:string)=>void;suffix?:string;hint?:string}){
 return <label className="pc-field"><span>{label}{hint&&<small> {hint}</small>}</span><span className="ua-num"><input inputMode="decimal" value={value} onChange={e=>onChange(e.target.value)}/>{suffix&&<i>{suffix}</i>}</span></label>;
}
function Sel<T extends string>({label,value,options,onChange}:{label:string;value:T;options:[T,string][];onChange:(v:T)=>void}){
 return <label className="pc-field"><span>{label}</span><select value={value} onChange={e=>onChange(e.target.value as T)}>{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>;
}
function RulesEditor({r,ccy,onChange}:{r:Rules;ccy:string;onChange:(r:Rules)=>void}){
 const dl=r.dailyLoss,dd=r.drawdown,num=(v:string)=>{const n=Number(v.replace(',','.'));return Number.isFinite(n)?n:0};
 return <div className="ua-rules">
  <fieldset><legend>Denní limit ztráty</legend><div className="pc-grid">
   <Sel label="Typ" value={dl.type} options={[['none','bez limitu'],['amount','částka'],['pct','% zůstatku']]} onChange={v=>onChange({...r,dailyLoss:{...dl,type:v}})}/>
   {dl.type!=='none'&&<>
    <Num label="Limit" value={dl.value} suffix={dl.type==='pct'?'%':ccy} onChange={v=>onChange({...r,dailyLoss:{...dl,value:num(v)}})}/>
    {dl.type==='pct'&&<Sel label="Procenta z" value={dl.base} options={[['dayStart','zůstatku na začátku dne'],['initial','startovního zůstatku']]} onChange={v=>onChange({...r,dailyLoss:{...dl,base:v}})}/>}
    <Sel label="Počítá se" value={dl.ref} options={[['equity','i otevřená ztráta (equity)'],['balance','jen uzavřené (zůstatek)']]} onChange={v=>onChange({...r,dailyLoss:{...dl,ref:v}})}/>
   </>}
   <label className="pc-field pc-narrow"><span>Reset dne</span><input type="time" value={dl.reset} onChange={e=>onChange({...r,dailyLoss:{...dl,reset:e.target.value||'00:00'}})}/></label>
   <Sel label="Časová zóna" value={dl.tz} options={[...new Set([dl.tz,...TZS])].map(z=>[z,z])} onChange={v=>onChange({...r,dailyLoss:{...dl,tz:v}})}/>
  </div></fieldset>
  <fieldset><legend>Maximální drawdown</legend><div className="pc-grid">
   <Sel label="Typ" value={dd.type} options={[['none','bez limitu'],['static','statický (od startu)'],['trailing','trailing (od maxima)']]} onChange={v=>onChange({...r,drawdown:{...dd,type:v}})}/>
   {dd.type!=='none'&&<>
    <Sel label="Zadání" value={dd.mode} options={[['pct','% startu'],['amount','částka']]} onChange={v=>onChange({...r,drawdown:{...dd,mode:v}})}/>
    <Num label="Limit" value={dd.value} suffix={dd.mode==='pct'?'%':ccy} onChange={v=>onChange({...r,drawdown:{...dd,value:num(v)}})}/>
    <Sel label="Podle" value={dd.ref} options={[['equity','equity'],['balance','zůstatku']]} onChange={v=>onChange({...r,drawdown:{...dd,ref:v}})}/>
    {dd.type==='trailing'&&<><Sel label="Maximum" value={dd.when} options={[['eod','na konci dne'],['intraday','i během dne']]} onChange={v=>onChange({...r,drawdown:{...dd,when:v}})}/>
     <label className="pc-check"><input type="checkbox" checked={dd.lockAtStart} onChange={e=>onChange({...r,drawdown:{...dd,lockAtStart:e.target.checked}})}/> zastavit na startovním zůstatku</label></>}
   </>}
  </div></fieldset>
  <fieldset><legend>Cíl, konzistence a riziko</legend><div className="pc-grid">
   <Sel label="Cíl zisku" value={r.profitTarget.type} options={[['none','bez cíle'],['pct','% startu'],['amount','částka']]} onChange={v=>onChange({...r,profitTarget:{...r.profitTarget,type:v}})}/>
   {r.profitTarget.type!=='none'&&<Num label="Cíl" value={r.profitTarget.value} suffix={r.profitTarget.type==='pct'?'%':ccy} onChange={v=>onChange({...r,profitTarget:{...r.profitTarget,value:num(v)}})}/>}
   <Num label="Min. obchodních dnů" value={r.minTradingDays} onChange={v=>onChange({...r,minTradingDays:Math.max(0,Math.round(num(v)))})}/>
   <label className="pc-check"><input type="checkbox" checked={r.consistency.on} onChange={e=>onChange({...r,consistency:{...r.consistency,on:e.target.checked}})}/> pravidlo konzistence</label>
   {r.consistency.on&&<Num label="Nejlepší den max." value={r.consistency.maxSharePct} suffix="% zisku" onChange={v=>onChange({...r,consistency:{...r.consistency,maxSharePct:num(v)}})}/>}
   <Num label="Max. riziko na obchod" hint="(kalkulačka, disciplína)" value={r.maxRiskPct??''} suffix="%" onChange={v=>onChange({...r,maxRiskPct:v.trim()===''?null:num(v)})}/>
  </div></fieldset>
 </div>;
}
function Overrides({p,ctx}:{p:ClientProfile;ctx:RiskContext}){
 const [inst,setInst]=useState(''),[o,setO]=useState<Record<string,string>>({}),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
 const base=ctx.instruments.find(i=>i.id===inst);
 useEffect(()=>{const cur=p.overrides[inst]||{};setO(Object.fromEntries(Object.entries(cur).map(([k,v])=>[k,String(v)])))},[inst,p.overrides]);
 const save=async(id:string,ov:Override|Record<string,string>)=>{setBusy(true);setErr('');try{await call('/api/risk/overrides','PUT',{profileId:p.id,instrumentId:id,override:ov});await reloadRisk()}catch(e){setErr((e as Error).message)}finally{setBusy(false)}};
 const F=(k:string,label:string,ph:string)=><label className="pc-field pc-narrow"><span>{label}</span><input inputMode={k==='brokerSymbol'?'text':'decimal'} placeholder={ph} value={o[k]??''} onChange={e=>setO({...o,[k]:e.target.value})}/></label>;
 return <div className="ua-ov">
  <h3>Instrumenty u brokera</h3>
  <p className="mt-lead">Když má broker jinou velikost kontraktu, hodnotu ticku nebo krok objemu (např. XAUUSD), přepiš je tady. Komise je za lot tam i zpět v měně kotace, spread v ceně.</p>
  {Object.keys(p.overrides).length>0&&<ul className="ua-ovlist">{Object.entries(p.overrides).map(([id,ov])=><li key={id}><b>{id}</b><span>{Object.entries(ov).map(([k,v])=>`${k} ${v}`).join(' · ')}</span><button type="button" className="mt-icon" onClick={()=>setInst(id)} aria-label={'Upravit '+id}><Pencil size={14}/></button><button type="button" className="mt-icon" disabled={busy} onClick={()=>save(id,{})} aria-label={'Smazat přepis '+id}><X size={14}/></button></li>)}</ul>}
  <div className="pc-grid"><label className="pc-field"><span>Instrument</span><select value={inst} onChange={e=>setInst(e.target.value)}><option value="">Vyber…</option>{ctx.instruments.map(i=><option key={i.id} value={i.id}>{i.id} – {i.name}</option>)}</select></label></div>
  {base&&<><div className="pc-grid">{F('tickSize','Tick',String(base.tickSize))}{F('tickValue','Hodnota ticku',String(base.tickValue))}{F('contractSize','Kontrakt',String(base.contractSize))}{F('lotStep','Krok objemu',String(base.lotStep))}{F('minLot','Min. objem',String(base.minLot))}{F('commission','Komise / lot',base.quote)}{F('spread','Spread (cena)','0')}{F('brokerSymbol','Symbol brokera',base.id)}</div>
   <div className="mt-actions"><button type="button" className="mt-btn dark" disabled={busy} onClick={()=>save(inst,o)}>Uložit přepis {inst}</button></div></>}
  {err&&<p className="mt-alert" role="alert">{err}</p>}
 </div>;
}
function Editor({draft,ctx,onClose}:{draft:Draft;ctx:RiskContext;onClose:()=>void}){
 const [d,setD]=useState(draft),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
 const prof=draft.id?ctx.profiles.find(p=>p.id===draft.id):undefined,rulesChanged=!!prof&&JSON.stringify(prof.rules)!==JSON.stringify(d.rules);
 const used=new Set(ctx.profiles.filter(p=>p.id!==d.id&&p.linkId).map(p=>p.linkId));
 const linkTo=(id:string)=>{const a=ctx.accounts.find(x=>x.id===id);setD({...d,linkId:id,currency:a?.currency&&ctx.currencies.includes(a.currency)?a.currency:d.currency,startBalance:d.startBalance||(a?.balance?String(a.balance):'')})};
 async function save(){setBusy(true);setErr('');
  try{const body={name:d.name,kind:d.kind,currency:d.currency,startBalance:nOrNull(d.startBalance),startDate:d.startDate,balance:d.linkId&&d.linkId!=='manual'?null:nOrNull(d.balance),linkId:d.linkId||null,feeChallenge:nOrNull(d.feeChallenge),feeActivation:nOrNull(d.feeActivation),rules:d.rules,effective:d.effective,archived:d.archived};
   if(d.id)await call('/api/risk/profiles/'+encodeURIComponent(d.id),'PUT',body);else await call('/api/risk/profiles','POST',body);
   await reloadRisk();onClose()}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 return <section className="mt-card ua-edit" aria-label={d.id?'Upravit profil':'Nový profil'}>
  <div className="ua-head"><h2>{d.id?'Upravit profil':'Nový profil'}</h2><button type="button" className="mt-icon" onClick={onClose} aria-label="Zavřít"><X size={16}/></button></div>
  {!d.id&&<><div className="mt-chips ua-tpl" role="radiogroup" aria-label="Šablona">{TEMPLATES.map(t=><button key={t.id} type="button" role="radio" aria-checked={false} onClick={()=>setD({...d,kind:t.kind,rules:t.rules})}>{t.label}</button>)}</div><p className="pc-note">{TEMPLATE_NOTE}</p></>}
  <div className="pc-grid">
   <label className="pc-field"><span>Název</span><input value={d.name} maxLength={60} onChange={e=>setD({...d,name:e.target.value})} placeholder="Např. Challenge 50k"/></label>
   <Sel label="Typ" value={d.kind} options={Object.entries(KIND_LABELS) as [ProfileKind,string][]} onChange={v=>setD({...d,kind:v})}/>
   <label className="pc-field"><span>Propojení</span><select value={d.linkId} onChange={e=>linkTo(e.target.value)}><option value="">samostatný (zůstatek zadám)</option><option value="manual" disabled={used.has('manual')}>ruční zápisy v Tradee</option>{ctx.accounts.map(a=><option key={a.id} value={a.id} disabled={used.has(a.id)}>{a.platform.toUpperCase()} · {a.name} · {a.currency}</option>)}</select></label>
   <Sel label="Měna účtu" value={d.currency} options={ctx.currencies.map(c=>[c,c])} onChange={v=>setD({...d,currency:v})}/>
  </div>
  <div className="pc-grid">
   <Num label="Startovní zůstatek" value={d.startBalance} suffix={d.currency} onChange={v=>setD({...d,startBalance:v})}/>
   <label className="pc-field pc-narrow"><span>Start účtu</span><input type="date" value={d.startDate} onChange={e=>setD({...d,startDate:e.target.value})}/></label>
   {(!d.linkId||d.linkId==='manual')&&<Num label="Aktuální zůstatek" hint="(prázdné = start + obchody)" value={d.balance} suffix={d.currency} onChange={v=>setD({...d,balance:v})}/>}
   {d.kind!=='personal'&&<><Num label="Poplatek za challenge" value={d.feeChallenge} suffix={d.currency} onChange={v=>setD({...d,feeChallenge:v})}/><Num label="Aktivační poplatek" value={d.feeActivation} suffix={d.currency} onChange={v=>setD({...d,feeActivation:v})}/></>}
  </div>
  {d.linkId&&d.linkId!=='manual'&&<p className="pc-note">Zůstatek a equity se berou ze synchronizace účtu; bez zůstatku (import T212) ze startu a uzavřených obchodů.</p>}
  <RulesEditor r={d.rules} ccy={d.currency} onChange={rules=>setD({...d,rules})}/>
  {d.id&&<div className="pc-grid"><label className="pc-field"><span>Změněná pravidla platí od</span><input type="date" value={d.effective} onChange={e=>setD({...d,effective:e.target.value})} disabled={!rulesChanged}/></label></div>}
  {prof&&prof.versions.length>0&&<details className="ua-ver"><summary>Historie pravidel ({prof.versions.length})</summary><ul>{[...prof.versions].reverse().map((v,i)=><li key={i}>od <b>{new Date(v.effective+'T12:00:00Z').toLocaleDateString('cs-CZ')}</b> · {[v.rules.dailyLoss.type!=='none'?`denní ${v.rules.dailyLoss.value}${v.rules.dailyLoss.type==='pct'?' %':''}`:'',v.rules.drawdown.type!=='none'?`${v.rules.drawdown.type==='trailing'?'trailing':'statický'} DD ${v.rules.drawdown.value}${v.rules.drawdown.mode==='pct'?' %':''}`:'',v.rules.maxRiskPct!==null?`riziko ${v.rules.maxRiskPct} %`:''].filter(Boolean).join(' · ')||'bez limitů'}</li>)}</ul></details>}
  {err&&<p className="mt-alert" role="alert">{err}</p>}
  <div className="mt-actions"><button type="button" className="mt-btn dark" disabled={busy||!d.name.trim()} onClick={save}>{d.id?'Uložit':'Založit profil'}</button><button type="button" className="mt-btn" onClick={onClose}>Zrušit</button></div>
  {prof&&<Overrides p={prof} ctx={ctx}/>}
 </section>;
}
export default function AccountsPage(){
 usePalette();
 const {data,error}=useRisk(),[edit,setEdit]=useState<Draft|null>(null),[err,setErr]=useState('');
 const list=useMemo(()=>data?.profiles||[],[data]);
 // odkaz /ucty#<id> z kalkulačky otevře úpravu profilu
 useEffect(()=>{const id=location.hash.slice(1);if(id&&data){const p=data.profiles.find(x=>x.id===id);if(p)setEdit(toDraft(p))}},[data]);
 const fresh=():Draft=>({name:'',kind:'personal',currency:'USD',startBalance:'',startDate:today(),balance:'',linkId:'',feeChallenge:'',feeActivation:'',rules:emptyRules(),effective:today(),archived:false});
 const act=async(fn:()=>Promise<unknown>)=>{setErr('');try{await fn();await reloadRisk()}catch(e){setErr((e as Error).message)}};
 const linkName=(p:ClientProfile)=>p.linkId==='manual'?'ruční zápisy':p.linkId?(data?.accounts.find(a=>a.id===p.linkId)?.name||'propojený účet'):'samostatný';
 return <div className="mt-page">
  <header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main">
   <h1>Účty a riziko</h1>
   <p className="mt-lead">Profil účtu říká, kolik smíš ztratit za den a celkem, jaký je cíl a jak velkou pozici otevřít. Limity uvidíš na Dashboardu, v Deníku, v kalkulačce i v nástroji long/short v grafu.</p>
   <div className="mt-actions"><button type="button" className="mt-btn dark" onClick={()=>setEdit(fresh())} disabled={!data}><Plus size={15}/> Nový profil</button><a className="mt-btn" href="/kalkulacka"><Calculator size={15}/> Kalkulačka pozice</a></div>
   {(error||err)&&<p className="mt-alert" role="alert">{err||error}</p>}
   {edit&&data&&<Editor key={edit.id||'new'} draft={edit} ctx={data} onClose={()=>{setEdit(null);if(location.hash)history.replaceState(null,'',location.pathname)}}/>}
   {!data&&!error&&<p className="mt-empty">Načítám…</p>}
   {data&&!list.length&&!edit&&<section className="mt-card"><p className="mt-empty">Zatím žádný profil. Začni prázdným profilem nebo obecnou šablonou challenge / funded a hodnoty uprav podle své firmy.</p></section>}
   {list.map(p=><section key={p.id} className={'mt-card ua-card'+(p.archived?' off':'')}>
    <div className="ua-head"><h2>{p.name} <span className="rk-kind">{KIND_LABELS[p.kind]}</span>{p.archived&&<span className="rk-kind">archiv</span>}</h2>
     <div className="ua-tools"><button type="button" className="mt-icon" aria-label={'Upravit '+p.name} onClick={()=>setEdit(toDraft(p))}><Pencil size={15}/></button>
      <button type="button" className="mt-icon" aria-label={(p.archived?'Obnovit ':'Archivovat ')+p.name} onClick={()=>act(()=>call('/api/risk/profiles/'+encodeURIComponent(p.id),'PUT',{...toDraft(p),startBalance:p.startBalance,balance:p.balance,feeChallenge:p.feeChallenge,feeActivation:p.feeActivation,linkId:p.linkId,archived:!p.archived}))}>{p.archived?<ArchiveRestore size={15}/>:<Archive size={15}/>}</button>
      <button type="button" className="mt-icon" aria-label={'Smazat '+p.name} onClick={()=>{if(confirm(`Smazat profil „${p.name}“ i s historií pravidel? Obchody zůstanou.`))act(()=>call('/api/risk/profiles/'+encodeURIComponent(p.id),'DELETE'))}}><Trash2 size={15}/></button></div></div>
    <p className="ua-meta">{p.currency} · start {p.startBalance.toLocaleString('cs-CZ')} ({new Date(p.startDate+'T12:00:00Z').toLocaleDateString('cs-CZ')}) · {linkName(p)}{p.status?` · zůstatek ${p.status.balance.toLocaleString('cs-CZ')}`:''}{p.feeChallenge||p.feeActivation?` · poplatky ${((p.feeChallenge||0)+(p.feeActivation||0)).toLocaleString('cs-CZ')} ${p.currency}`:''}</p>
    {!p.archived&&<RiskStatus profile={p}/>}
    {!p.archived&&p.status&&(p.status.tradingDays.min>0)&&<p className="ua-meta">Obchodní dny: {p.status.tradingDays.count} z {p.status.tradingDays.min}</p>}
   </section>)}
  </main>
 </div>;
}
