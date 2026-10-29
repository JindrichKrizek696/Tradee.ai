'use client';
// Replay: seznam seancí a formulář nové seance (trhy, start, rámce, režim, „rozhodni, pak odkryj“, exekuce, replay účet, strategie).
import {useEffect,useMemo,useState} from 'react';
import {Play,Trash2,Plus,X} from 'lucide-react';
import {call,useStrategies,fromLocalInput} from '../strategy/plan-ui';
import {useRisk,activeProfiles} from '../risk/risk-context';
import {REPLAY_TFS,TF_LABEL,tfAllowed,pragueTime,type BaseTf,type ReplayTf} from '@/lib/replay/clock';
import {MODE_LABEL,type Mode,type Summary} from '@/lib/replay/results';
type Market={id:string;name:string;group:string};
type Item={id:string;name:string;mode:Mode;status:string;symbols:string[];baseTf:BaseTf;start:number;clock:number;rewinds:number;resets:number;journaled:boolean;updated:number;summary:Summary|null;currency:string};
type ListResp={sessions:Item[];markets:Market[];templates:{id:string;label:string;kind:string}[];currencies:string[]};
const GROUPS:Record<string,string>={fx:'Měnové páry',currency:'Měnové indexy',commodities:'Komodity',index:'Indexy',stock:'Akcie',crypto:'Krypto'};
const STATUS:Record<string,string>={active:'běží',ended:'ukončená',breached:'porušená pravidla'};
const f=(n:number,d=2)=>n.toLocaleString('cs-CZ',{maximumFractionDigits:d});
export function ReplaySetup({onOpen}:{onOpen:(id:string)=>void}){
 const [data,setData]=useState<ListResp|null>(null),[err,setErr]=useState(''),[busy,setBusy]=useState(false),[form,setForm]=useState(false);
 const load=()=>call<ListResp>('/api/replay/sessions').then(setData).catch(e=>setErr((e as Error).message));
 useEffect(()=>{load()},[]);
 const del=async(id:string)=>{if(!confirm('Smazat seanci včetně záznamu a výsledků? Obchody už zapsané v Deníku zůstanou.'))return;try{await call('/api/replay/sessions/'+id,'DELETE');load()}catch(e){setErr((e as Error).message)}};
 return <main className="rp-main">
  <h1>Replay</h1>
  <p className="mt-lead">Obchoduj historii svíčku po svíčce. Hodiny jsou společné pro všechny rámce a trhy, budoucí svíčky ani data (skóre, COT, kalendář) nevidíš. <b>Výukový</b> režim dovolí přetáčet, <b>validační</b> každé přetočení zapíše do výsledků.</p>
  {err&&<p className="mt-alert" role="alert">{err}</p>}
  <section className="mt-card">
   <div className="rp-row"><h2>Seance</h2><button type="button" className="mt-btn" onClick={()=>setForm(!form)}>{form?<X size={15}/>:<Plus size={15}/>} {form?'Zavřít':'Nová seance'}</button></div>
   {form&&data&&<NewSession data={data} busy={busy} onCreate={async b=>{setBusy(true);setErr('');try{const r=await call<{id:string}>('/api/replay/sessions','POST',b);onOpen(r.id)}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}}/>}
   {!data?<p className="rk-muted">Načítám…</p>:!data.sessions.length?<p className="rk-muted">Zatím žádná seance. Založ první – vyber trh a datum v historii.</p>:
   <div className="rp-table-wrap"><table className="rp-table"><thead><tr><th>Název</th><th>Režim</th><th>Trhy</th><th>Hodiny</th><th>Stav</th><th>Výsledek</th><th/></tr></thead><tbody>
    {data.sessions.map(s=><tr key={s.id}>
     <td><button type="button" className="rp-link" onClick={()=>onOpen(s.id)}>{s.name}</button></td>
     <td>{MODE_LABEL[s.mode]}{s.mode==='validate'&&s.rewinds+s.resets>0&&<span className="rp-tag warn" title="Přetočení ve validačním režimu">{s.rewinds+s.resets}× přetočeno</span>}</td>
     <td>{s.symbols.join(', ')} · {s.baseTf}</td><td>{pragueTime(s.clock)}</td><td>{STATUS[s.status]??s.status}{s.journaled&&<span className="rp-tag">v Deníku</span>}</td>
     <td>{s.summary?<>{s.summary.n} obch. · {f(s.summary.pnl)} {s.currency}{s.summary.totalR!==null&&<> · {f(s.summary.totalR)} R</>}</>:'–'}</td>
     <td className="rp-actions"><button type="button" className="mt-btn" onClick={()=>onOpen(s.id)}><Play size={14}/> Otevřít</button><button type="button" className="mt-btn" aria-label="Smazat seanci" onClick={()=>del(s.id)}><Trash2 size={14}/></button></td>
    </tr>)}</tbody></table></div>}
  </section>
 </main>;
}
type Body=Record<string,unknown>;
function NewSession({data,busy,onCreate}:{data:ListResp;busy:boolean;onCreate:(b:Body)=>void}){
 const {list:sList}=useStrategies(false),strategies=sList??[],risk=useRisk(),profiles=activeProfiles(risk.data);
 const [name,setName]=useState(''),[symbols,setSymbols]=useState<string[]>(['EUR/USD']),[pick,setPick]=useState('');
 const [start,setStart]=useState(()=>{const d=new Date(Date.now()-120*86400000);d.setHours(8,0,0,0);const p=(n:number)=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T08:00`});
 const [baseTf,setBase]=useState<BaseTf>('H1'),[tfs,setTfs]=useState<ReplayTf[]>(['H1','H4','D1']),[mode,setMode]=useState<Mode>('learn'),[decide,setDecide]=useState(false),[decideN,setDecideN]=useState('5');
 const [spreadMode,setSpreadMode]=useState<'fixed'|'registry'>('fixed'),[spreadTicks,setSpreadTicks]=useState('10'),[commissionMode,setCommissionMode]=useState<'fixed'|'registry'>('fixed'),[commission,setCommission]=useState('7'),[slip,setSlip]=useState('0');
 const [swapOn,setSwapOn]=useState(false),[swapLong,setSwapLong]=useState('-5'),[swapShort,setSwapShort]=useState('-2'),[ambiguity,setAmb]=useState<'conservative'|'optimistic'>('conservative');
 const [accSource,setAccSource]=useState<'template'|'profile'>('template'),[templateId,setTemplate]=useState('challenge_static'),[profileId,setProfile]=useState(''),[balance,setBalance]=useState('100000'),[currency,setCurrency]=useState('USD');
 const [strategyId,setStrategy]=useState('');
 const groups=useMemo(()=>{const g=new Map<string,Market[]>();for(const m of data.markets)(g.get(m.group)??g.set(m.group,[]).get(m.group)!).push(m);return [...g]},[data.markets]);
 const prof=profiles.find(p=>p.id===profileId);
 useEffect(()=>{if(prof){setCurrency(prof.currency);setBalance(String(prof.startBalance))}},[prof]);
 const add=()=>{if(pick&&!symbols.includes(pick)&&symbols.length<4)setSymbols([...symbols,pick]);setPick('')};
 const st=strategies.find(s=>s.id===strategyId);
 const submit=()=>onCreate({name,symbols,start:fromLocalInput(start),baseTf,tfs:tfs.filter(t=>tfAllowed(baseTf,t)),mode,decideN:decide?Number(decideN):null,
  exec:{spreadMode,spreadTicks:Number(spreadTicks.replace(',','.')),commissionMode,commission:Number(commission.replace(',','.')),slippageTicks:Number(slip.replace(',','.')),swap:{on:swapOn,long:Number(swapLong.replace(',','.')),short:Number(swapShort.replace(',','.')),tripleWed:true},ambiguity},
  account:{source:accSource,templateId,profileId:accSource==='profile'?profileId:null,balance:Number(balance.replace(/\s/g,'').replace(',','.')),currency},strategyId:st?.id??null,versionId:st?.latest?.id??null});
 return <div className="rp-form">
  <fieldset><legend>Trhy a čas</legend>
   <label className="rp-f"><span>Název</span><input value={name} onChange={e=>setName(e.target.value)} placeholder="např. EUR/USD Londýn březen" maxLength={80}/></label>
   <div className="rp-f"><span>Trhy (nejvýš 4, hodiny řídí první)</span><div className="rp-chips">{symbols.map(s=><span key={s} className="rp-chip">{s}<button type="button" aria-label={'Odebrat '+s} onClick={()=>setSymbols(symbols.filter(x=>x!==s))}><X size={12}/></button></span>)}
    <select value={pick} onChange={e=>setPick(e.target.value)} aria-label="Přidat trh"><option value="">+ přidat trh</option>{groups.map(([g,list])=><optgroup key={g} label={GROUPS[g]??g}>{list.map(m=><option key={m.id} value={m.id} disabled={symbols.includes(m.id)}>{m.name===m.id?m.id:`${m.id} – ${m.name}`}</option>)}</optgroup>)}</select>
    <button type="button" className="mt-btn" disabled={!pick||symbols.length>=4} onClick={add}>Přidat</button></div></div>
   <label className="rp-f"><span>Start (tvůj místní čas)</span><input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label>
   <div className="rp-f"><span>Základní rámec</span><div className="mt-chips" role="radiogroup" aria-label="Základní rámec">{(['H1','D1'] as BaseTf[]).map(b=><button key={b} type="button" role="radio" aria-checked={baseTf===b} className={baseTf===b?'active':''} onClick={()=>setBase(b)}>{b==='H1'?'H1 (archiv od ~2024)':'D1 (archiv od 2003)'}</button>)}</div></div>
   <div className="rp-f"><span>Zobrazené rámce</span><div className="rp-checks">{REPLAY_TFS.map(t=><label key={t} className={tfAllowed(baseTf,t)?'':'off'}><input type="checkbox" disabled={!tfAllowed(baseTf,t)} checked={tfs.includes(t)&&tfAllowed(baseTf,t)} onChange={e=>setTfs(e.target.checked?[...tfs,t]:tfs.filter(x=>x!==t))}/> {t} <small>{TF_LABEL[t]}</small></label>)}</div></div>
  </fieldset>
  <fieldset><legend>Režim</legend>
   <div className="mt-chips" role="radiogroup" aria-label="Režim">{(['learn','validate'] as Mode[]).map(m=><button key={m} type="button" role="radio" aria-checked={mode===m} className={mode===m?'active':''} onClick={()=>setMode(m)}>{MODE_LABEL[m]}</button>)}</div>
   <p className="rp-hint">{mode==='learn'?'Výukový: můžeš se vracet o svíčky zpět a začít znovu.':'Validační: hodiny jdou jen dopředu; každé přetočení nebo reset se zapíše a ukáže ve výsledcích.'}</p>
   <label className="rp-check"><input type="checkbox" checked={decide} onChange={e=>setDecide(e.target.checked)}/> „Rozhodni, pak odkryj“ – další <input className="rp-num" inputMode="numeric" value={decideN} onChange={e=>setDecideN(e.target.value)} disabled={!decide} aria-label="Počet svíček"/> svíček se odkryje až po zapsaném rozhodnutí (long / short / bez obchodu)</label>
  </fieldset>
  <fieldset><legend>Exekuce</legend>
   <div className="rp-grid">
    <label className="rp-f"><span>Spread</span><select value={spreadMode} onChange={e=>setSpreadMode(e.target.value as 'fixed')}><option value="fixed">pevný v ticích</option><option value="registry">z registru (přepis účtu), jinak pevný</option></select></label>
    <label className="rp-f"><span>Spread (ticky)</span><input inputMode="decimal" value={spreadTicks} onChange={e=>setSpreadTicks(e.target.value)}/></label>
    <label className="rp-f"><span>Komise</span><select value={commissionMode} onChange={e=>setCommissionMode(e.target.value as 'fixed')}><option value="fixed">pevná</option><option value="registry">z registru, jinak pevná</option></select></label>
    <label className="rp-f"><span>Komise za lot tam i zpět (měna kotace)</span><input inputMode="decimal" value={commission} onChange={e=>setCommission(e.target.value)}/></label>
    <label className="rp-f"><span>Skluz market / stop (ticky)</span><input inputMode="decimal" value={slip} onChange={e=>setSlip(e.target.value)}/></label>
    <label className="rp-f"><span>SL i TP v jedné svíčce</span><select value={ambiguity} onChange={e=>setAmb(e.target.value as 'conservative')}><option value="conservative">konzervativně (platí SL)</option><option value="optimistic">optimisticky (platí TP)</option></select></label>
   </div>
   <label className="rp-check"><input type="checkbox" checked={swapOn} onChange={e=>setSwapOn(e.target.checked)}/> Swap za noc (rollover 21:00 UTC, středa 3×): long <input className="rp-num" inputMode="decimal" value={swapLong} onChange={e=>setSwapLong(e.target.value)} disabled={!swapOn} aria-label="Swap long"/> short <input className="rp-num" inputMode="decimal" value={swapShort} onChange={e=>setSwapShort(e.target.value)} disabled={!swapOn} aria-label="Swap short"/> za lot v měně účtu</label>
   <p className="rp-hint">Svíčky jsou bid; ask = bid + spread. Gap přes stop se vyplní na otevření svíčky. Nejednoznačné svíčky jsou ve výsledcích označené.</p>
  </fieldset>
  <fieldset><legend>Replay účet</legend>
   <div className="rp-grid">
    <label className="rp-f"><span>Pravidla</span><select value={accSource} onChange={e=>setAccSource(e.target.value as 'template')}><option value="template">ze šablony</option><option value="profile" disabled={!profiles.length}>z mého profilu účtu</option></select></label>
    {accSource==='template'?<label className="rp-f"><span>Šablona</span><select value={templateId} onChange={e=>setTemplate(e.target.value)}>{data.templates.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
     :<label className="rp-f"><span>Profil</span><select value={profileId} onChange={e=>setProfile(e.target.value)}><option value="">vyber…</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    <label className="rp-f"><span>Zůstatek</span><input inputMode="decimal" value={balance} onChange={e=>setBalance(e.target.value)}/></label>
    <label className="rp-f"><span>Měna</span><select value={currency} onChange={e=>setCurrency(e.target.value)}>{data.currencies.map(c=><option key={c}>{c}</option>)}</select></label>
   </div>
   <p className="rp-hint">Denní ztráta a drawdown z pravidel (prop simulátor): porušení seanci ukončí a výsledky ho uvedou. Hodnoty šablon jsou jen příklad.</p>
  </fieldset>
  <fieldset><legend>Strategie (volitelně)</legend>
   <label className="rp-f"><span>Checklist při rozhodnutí</span><select value={strategyId} onChange={e=>setStrategy(e.target.value)}><option value="">bez strategie</option>{strategies.filter(s=>!s.archived&&s.latest).map(s=><option key={s.id} value={s.id}>{s.name} · v{s.latest!.version}</option>)}</select></label>
  </fieldset>
  <div className="rp-row"><button type="button" className="mt-btn rp-primary" disabled={busy||!symbols.length} onClick={submit}><Play size={15}/> {busy?'Zakládám…':'Spustit replay'}</button></div>
 </div>;
}
