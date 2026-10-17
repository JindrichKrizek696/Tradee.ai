'use client';
// Laboratoř · Známé strategie: výsledek scripts/lab-known.mjs (lab_known) – pro každou rodinu nejlepší robustní parametry, IS vs OOS,
// obchody, PF, DD a srovnání s hranicí náhody, plus krátký český popis strategie. Jen vlastník (API vrací ostatním 404).
import {Fragment,useCallback,useEffect,useState} from 'react';
import {ChevronDown,ChevronRight} from 'lucide-react';
import {fmtNum} from '@/lib/journal/format';
import {knownKey,familyDef,KNOWN_MIN_OOS_TRADES,type KnownCombo} from '@/lib/lab/known-grid';
import type {KnownResult,KnownRow} from '@/lib/lab/known';

type Data={known:{id:string;created:string;result:KnownResult}|null;list:{id:string;created:string}[]};
const r2=(v:number|null|undefined)=>v===null||v===undefined?'–':(v>0?'+':v<0?'−':'')+fmtNum(Math.abs(v),2)+' R';
const num=(v:number|null|undefined,d=2)=>v===null||v===undefined?'–':fmtNum(v,d);
const sgn=(v:number|null|undefined)=>v===null||v===undefined?'':v>0?'pos':v<0?'neg':'';
const combo=(c:KnownCombo)=>{const f=familyDef(c.family);return `${f?.vLabels[c.v]??c.v} · SL ${fmtNum(c.slAtr,1)} ATR · max ${c.hold} d · ${c.set==='fx'?'FX':c.set==='ci'?'komodity + indexy':'vše'}`};
async function call<T>(url:string):Promise<T>{const r=await fetch(url,{cache:'no-store'});const j=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw Object.assign(new Error(j.error||'Načtení se nepovedlo.'),{status:r.status});return j as T}

export function KnownTab({initial}:{initial?:Data}={}){
 const [data,setData]=useState<Data|null>(initial??null),[err,setErr]=useState(''),[missing,setMissing]=useState(false),[open,setOpen]=useState<string|null>(null);
 const load=useCallback((id?:string)=>{call<Data>('/api/laborator/known'+(id?'?id='+encodeURIComponent(id):'')).then(j=>{setData(j);setErr('')}).catch(e=>{if((e as {status?:number}).status===503)setMissing(true);else setErr((e as Error).message)})},[]);
 useEffect(()=>{if(!initial)load()},[load,initial]);
 if(missing)return <section className="mt-card"><p className="mt-alert">Známé strategie ještě nejdou – chybí migrace databáze (0030_lab_agents.sql).</p></section>;
 if(!data)return <section className="mt-card">{err?<p className="mt-alert" role="alert">{err}</p>:<p className="mt-empty">Načítám…</p>}</section>;
 const res=data.known?.result??null;
 const rowOf=(i:number|null)=>i===null||!res?null:res.rows.find(r=>r.i===i)??null;
 const line=(r:KnownRow,chance:number|null)=><><td className={sgn(r.is.avgR)}>{r2(r.is.avgR)}<small>{r.is.trades} obch. · PF {num(r.is.pf)}</small></td>
  <td className={sgn(r.oos.avgR)}>{r2(r.oos.avgR)}<small>win {num(r.oos.winRate,1)} %</small></td><td>{r.oos.trades}</td><td>{num(r.oos.pf)}</td><td className="neg">{num(r.oos.maxDd,1)} R</td>
  <td>{r2(chance)}{r.beatsChance?<span className="lb-badge ok">nad náhodou</span>:<span className="lb-badge">pod</span>}</td></>;
 return <>
  <section className="mt-card">
   <h2>Známé strategie</h2>
   <p className="mt-lead">Klasické strategie z literatury otestované stejným enginem, náklady a dělením in-sample 2015–2022 / out-of-sample 2023–dnes jako „Hledání prahů“, s hranicí náhody pro každou rodinu. Výpočet běží na serveru (scripts/lab-known.mjs).</p>
   {data.list.length>1&&<div className="lb-form"><label>Běh<select value={data.known?.id??''} onChange={e=>load(e.target.value)}>{data.list.map(x=><option key={x.id} value={x.id}>{new Date(x.created).toLocaleString('cs-CZ')}</option>)}</select></label></div>}
   {!res?<p className="mt-empty">Zatím žádný běh. Na VPS: <code>node --experimental-strip-types scripts/lab-known.mjs</code></p>:<>
    <p className="lb-meta">Spočítáno {new Date(res.computedAt).toLocaleString('cs-CZ')} · {res.markets.length} trhů · IS {res.from} – {res.split} · OOS {res.split} – {res.to} · {res.shuffles}× náhodné směry · robustní = IS i OOS &gt; 0, OOS ≥ {KNOWN_MIN_OOS_TRADES} obchodů, okolí &gt; 0, PF ≥ 1,1</p>
    <div className="lb-scroll"><table className="mt-table lb-table">
     <thead><tr><th>Strategie</th><th>Nejlepší parametry</th><th>IS průměr</th><th>OOS průměr</th><th>OOS obch.</th><th>OOS PF</th><th>OOS DD</th><th>Hranice náhody</th></tr></thead>
     <tbody>{res.families.map(f=>{const r=rowOf(f.best),isOpen=open===f.id;return <Fragment key={f.id}>
      <tr><td><button className="lb-link lb-exp" aria-expanded={isOpen} onClick={()=>setOpen(o=>o===f.id?null:f.id)}>{isOpen?<ChevronDown size={14}/>:<ChevronRight size={14}/>}{f.label}</button></td>
       {f.skipped?<td colSpan={7} className="lb-dim">{f.skipped}</td>:!r?<td colSpan={7}>bez obchodů</td>:<><td>{combo(r.combo)}{r.robust?<span className="lb-badge ok">robustní</span>:<span className="lb-badge no">ne robustní</span>}<small>{r.robust?'nejlepší robustní podle OOS':'žádná kombinace není robustní – ukázána nejlepší podle IS'}</small></td>{line(r,f.chance.median)}</>}</tr>
      {isOpen&&<tr className="lb-notesrow"><td colSpan={8}><p className="lb-meta" style={{whiteSpace:'normal'}}>{f.desc}</p>
       {f.combos.length>0&&<div className="lb-scroll"><table className="mt-table lb-table"><thead><tr><th>Kombinace</th><th>IS</th><th>OOS</th><th>OOS obch.</th><th>OOS PF</th><th>OOS DD</th><th>Okolí</th><th></th></tr></thead>
        <tbody>{f.combos.map(i=>{const x=rowOf(i)!;return <tr key={i} className={i===f.best?'lb-sel':''}><td>{combo(x.combo)}</td><td className={sgn(x.is.avgR)}>{r2(x.is.avgR)}<small>{x.is.trades} obch.</small></td><td className={sgn(x.oos.avgR)}>{r2(x.oos.avgR)}</td><td>{x.oos.trades}</td><td>{num(x.oos.pf)}</td><td>{num(x.oos.maxDd,1)} R</td><td className={sgn(x.nb)}>{r2(x.nb)}</td><td>{x.robust&&<span className="lb-badge ok">robustní</span>}{x.beatsChance&&<span className="lb-badge ok">nad náhodou</span>}</td></tr>})}</tbody></table></div>}
      </td></tr>}
     </Fragment>})}</tbody></table></div>
    <details className="lb-details"><summary>Jak číst výsledky</summary><ul className="lb-notes">{res.notes.map(n=><li key={n}>{n}</li>)}</ul>
     {res.rates.length>0&&<p className="lb-meta">Sazby (FRED, 3M OECD): {res.rates.map(r=>`${r.ccy} ${r.from?.slice(0,4)}–${r.to?.slice(0,7)}`).join(' · ')}</p>}</details>
    <p className="lb-meta">Nejlepší klíč do další práce: {res.families.filter(f=>{const r=rowOf(f.best);return r?.robust&&r.beatsChance}).map(f=>knownKey(rowOf(f.best)!.combo)).join(' · ')||'žádná rodina není zároveň robustní a nad hranicí náhody.'}</p>
   </>}
  </section>
 </>;
}
