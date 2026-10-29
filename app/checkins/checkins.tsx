'use client';
// Check-iny (nepovinné, krátké, bez hodnocení): před seancí, před vstupem (2 klepnutí), po obchodu a statistika v Deníku.
// Vždy jen vlastní data přihlášeného (/api/checkins nezná pohled správce). Logika: lib/checkins/core.ts
import {useEffect,useState} from 'react';
import {Lock} from 'lucide-react';
import {SCALES,VERDICTS,PRIVACY,pragueDay,type Checkin,type Scale,type Verdict,type Stats} from '@/lib/checkins/core';
import {Term} from '../term';
import './checkins.css';
async function call<T>(method:string,body?:unknown,q=''):Promise<T>{const r=await fetch('/api/checkins'+q,{method,cache:'no-store',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const j=await r.json().catch(()=>({})) as T&{error?:string};if(!r.ok)throw Error(j.error||'Uložení se nepovedlo.');return j}
export function Private(){return <p className="ck-private"><Lock size={12} aria-hidden="true"/> {PRIVACY}</p>}
function Dots({label,value,onChange}:{label:string;value:number|null;onChange:(v:number|null)=>void}){
 return <div className="ck-scale" role="radiogroup" aria-label={label+' (1 nízká až 5 vysoká)'}><span className="ck-lbl">{label}</span>{[1,2,3,4,5].map(n=><button key={n} type="button" role="radio" aria-checked={value===n} aria-label={`${label} ${n} z 5`} className={value===n?'on':''} onClick={()=>onChange(value===n?null:n)}>{n}</button>)}</div>;
}
/** Před seancí: energie, soustředění, nálada 1–5 a poznámka. Dnešní poslední záznam se ukáže. */
export function SessionCheckin(){
 const [today]=useState(()=>pragueDay(Date.now())),[v,setV]=useState<Record<Scale,number|null>>({energy:null,focus:null,mood:null}),[note,setNote]=useState(''),[last,setLast]=useState<Checkin|null>(null),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false),[off,setOff]=useState(false);
 useEffect(()=>{call<{checkins:Checkin[]}>('GET',undefined,`?from=${today}&to=${today}`).then(j=>setLast(j.checkins.find(c=>c.kind==='session')||null)).catch(e=>{if(/migrace/.test((e as Error).message))setOff(true)})},[today]);
 if(off)return null;
 async function save(){setBusy(true);setMsg('');try{const j=await call<{checkin:Checkin}>('POST',{kind:'session',...v,note});setLast(j.checkin);setV({energy:null,focus:null,mood:null});setNote('');setMsg('Zapsáno. Díky.')}catch(e){setMsg((e as Error).message)}finally{setBusy(false)}}
 const any=v.energy!==null||v.focus!==null||v.mood!==null;
 return <section className="mt-card ck-card" aria-labelledby="ck-s-h"><h2 id="ck-s-h">Jak se dnes cítíš? <small>nepovinné</small></h2>
  <p className="mt-lead">Krátký <Term id="check-in">check-in</Term> před seancí. Odpověz, jak to právě je – časem uvidíš souvislosti se svým procesem.</p>
  {last&&<p className="ck-last">Dnes zapsáno: {SCALES.map(([k,l])=>last[k]!==null?`${l} ${last[k]}/5`:null).filter(Boolean).join(' · ')}{last.note?` · „${last.note}“`:''}</p>}
  {SCALES.map(([k,l])=><Dots key={k} label={l} value={v[k]} onChange={n=>setV(x=>({...x,[k]:n}))}/>)}
  <label className="ck-note"><span>Poznámka</span><input maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="Třeba: málo spánku, klidné ráno…"/></label>
  <div className="ck-row"><button type="button" className="mt-btn" disabled={busy||!any} onClick={save}>Zapsat check-in</button><span className="ck-msg" role="status">{msg}</span></div>
  <Private/>
 </section>;
}
/** Před vstupem: „Cítíš FOMO?“ a „Je vstup podle plánu?“ – po dvou odpovědích se uloží sám. */
export function EntryCheck({scenarioId,tradeId,compact}:{scenarioId?:string;tradeId?:string;compact?:boolean}){
 const [fomo,setFomo]=useState<boolean|null>(null),[plan,setPlan]=useState<boolean|null>(null),[st,setSt]=useState<'idle'|'saved'|'err'>('idle'),[err,setErr]=useState('');
 useEffect(()=>{if(!tradeId&&!scenarioId)return;let live=true;call<{checkins:Checkin[]}>('GET',undefined,tradeId?'?tradeId='+encodeURIComponent(tradeId):'?scenarioId='+encodeURIComponent(scenarioId!)).then(j=>{const e=live&&j.checkins.find(c=>c.kind==='entry');if(e){setFomo(e.fomo);setPlan(e.plan);setSt('saved')}}).catch(()=>{});return()=>{live=false}},[tradeId,scenarioId]);
 async function pick(f:boolean|null,p:boolean|null){setFomo(f);setPlan(p);if(f===null||p===null)return;try{await call('POST',{kind:'entry',fomo:f,plan:p,scenarioId:scenarioId||null,tradeId:tradeId||null});setSt('saved')}catch(e){setSt('err');setErr((e as Error).message)}}
 const yn=(label:string,val:boolean|null,on:(v:boolean)=>void)=><span className="ck-yn" role="radiogroup" aria-label={label}><span className="ck-lbl">{label}</span>{([[true,'Ano'],[false,'Ne']] as const).map(([b,t])=><button key={t} type="button" role="radio" aria-checked={val===b} className={val===b?'on':''} disabled={st==='saved'} onClick={()=>on(b)}>{t}</button>)}</span>;
 return <div className={'ck-entry'+(compact?' compact':'')}>
  <b className="ck-h">Před vstupem <small>2 klepnutí, nepovinné</small></b>
  {yn('Cítíš FOMO?',fomo,b=>pick(b,plan))}{yn('Je vstup podle plánu?',plan,b=>pick(fomo,b))}
  {st==='saved'&&<span className="ck-msg" role="status">Zapsáno soukromě.</span>}{st==='err'&&<span className="ck-msg err" role="alert">{err}</span>}
 </div>;
}
/** Po obchodu: zařazení (podle plánu / legitimní ztráta / chyba v exekuci / FOMO / revenge / jiné). */
export function AfterTradeCheck({tradeId}:{tradeId:string}){
 const [cur,setCur]=useState<Checkin|null>(null),[note,setNote]=useState(''),[msg,setMsg]=useState(''),[off,setOff]=useState(false);
 useEffect(()=>{let live=true;call<{checkins:Checkin[]}>('GET',undefined,'?tradeId='+encodeURIComponent(tradeId)).then(j=>{if(!live)return;const a=j.checkins.find(c=>c.kind==='after')||null;setCur(a);setNote(a?.note||'')}).catch(e=>{if(live&&/migrace/.test((e as Error).message))setOff(true)});return()=>{live=false}},[tradeId]);
 if(off)return null;
 async function save(verdict:Verdict,n=note){setMsg('');try{const j=await call<{checkin:Checkin}>('POST',{kind:'after',verdict,tradeId,note:n});setCur(j.checkin);setMsg('Zapsáno soukromě.')}catch(e){setMsg((e as Error).message)}}
 return <div className="ck-after">
  <div className="ck-chips" role="radiogroup" aria-label="Jak obchod zařadíš">{(Object.keys(VERDICTS) as Verdict[]).map(v=><button key={v} type="button" role="radio" aria-checked={cur?.verdict===v} className={cur?.verdict===v?'on':''} onClick={()=>save(v)}>{VERDICTS[v]}</button>)}</div>
  {cur&&<input className="ck-note-in" maxLength={500} value={note} aria-label="Poznámka k zařazení" placeholder="Poznámka (nepovinné)" onChange={e=>setNote(e.target.value)} onBlur={()=>{if(cur.verdict&&note!==cur.note)save(cur.verdict,note)}}/>}
  <span className="ck-msg" role="status">{msg}</span>
  <Private/>
 </div>;
}
/** Statistika v Deníku: stav vs. skóre procesu, zařazení obchodů, kontrola před vstupem. Bez hodnotících slov. */
export function CheckinStats(){
 const [s,setS]=useState<Stats|null>(null),[err,setErr]=useState('');
 useEffect(()=>{call<{stats:Stats}>('GET',undefined,'?stats=1').then(j=>setS(j.stats)).catch(e=>setErr((e as Error).message))},[]);
 if(err)return <section className="j-card ck-stats"><h2>Stav a proces</h2><p className="j-muted">{err}</p></section>;
 if(!s)return null;
 const empty=!s.sessions&&!s.entries&&!s.afters;
 return <section className="j-card ck-stats" aria-labelledby="ck-st-h"><h2 id="ck-st-h">Stav a proces <small>z tvých check-inů</small></h2>
  {empty?<p className="j-muted">Zatím žádné check-iny. Zapíšeš je na stránce <a href="/scenare">Scénáře</a> (před seancí), u scénáře (před vstupem) a v záznamu obchodu (po obchodu).</p>:<>
   <div className="ck-buckets">{s.buckets.map(b=><div key={b.key} className="ck-bucket"><span>{b.label}</span><b>{b.avgProcess===null?'–':b.avgProcess+' %'}</b><small>{b.days} {b.days===1?'den':b.days<5&&b.days>1?'dny':'dní'} · {b.trades} hodnocených obchodů</small></div>)}</div>
   <p className="j-muted ck-explain">Průměrné <Term id="proces-skore">skóre procesu</Term> obchodů ve dnech podle check-inu před seancí (průměr energie, soustředění a nálady).</p>
   <ul className="ck-sum">{s.summary.map(t=><li key={t}>{t}</li>)}</ul>
   {s.verdicts.length>0&&<><h3>Zařazení po obchodu</h3><ul className="ck-verd">{s.verdicts.map(v=><li key={v.verdict}><span>{v.label}</span><b>{v.count}×</b><small>{v.avgProcess===null?'':`proces ${v.avgProcess} %`}</small></li>)}</ul></>}
   {s.entries>0&&<p className="j-muted">Před vstupem: podle plánu {s.entry.planYes}× / mimo plán {s.entry.planNo}× · FOMO ano {s.entry.fomoYes}× / ne {s.entry.fomoNo}×.</p>}
  </>}
  <Private/>
 </section>;
}
