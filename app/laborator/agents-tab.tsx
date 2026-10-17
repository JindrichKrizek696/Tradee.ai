'use client';
// Laboratoř · Agenti: populace 20 papírových agentů G01… s týdenní evolucí (scripts/lab-evolve.mjs) a AI analytikem (scripts/lab-analyst.py).
// Žebříček, křivky top 5 + benchmark A, genom a obchody agenta, časová osa evoluce, archiv a poslední analýza. Jen čtení, jen vlastník.
import {Fragment,useCallback,useEffect,useMemo,useState} from 'react';
import {ChevronDown,ChevronRight} from 'lucide-react';
import {fmtNum} from '@/lib/journal/format';
import {EquityChart,type Series} from '../journaling/backtest/equity-chart';
import {familyDef} from '@/lib/lab/known-grid';
import type {Genome} from '@/lib/lab/agents';
// popisky lokálně (lib/lab/agents.ts tahá engine a skóre – do prohlížeče ho nevozíme)
const FAMILY_LABEL=(f:string)=>f==='score'?'Skóre Tradee':familyDef(f)?.label??f;
const AGENT_SET_LABELS:Record<string,string>={fx:'FX páry',ci:'Komodity + indexy',all:'FX + komodity + indexy',crypto:'Krypto'};
import type {PaperStats,PaperEquityPoint,PaperTrade} from '@/lib/lab/paper';

type Row={id:string;active:boolean;genome:Genome;genomeText:string;meta:{gen:number;parent:string|null;origin:string};started:number;rulesVersion:string;stats:PaperStats;weekR:number;weekTrades:number;weekPnl:number;fitness:number;learning:boolean;killable:boolean;equity?:PaperEquityPoint[]};
type Evo={gen:number;at:number;agent:string;parent:string|null;action:string;reason:string;fitness:number|null};
type Data={now:number;agents:Row[];top:string[];bench:{started:number|null;equity:PaperEquityPoint[]};evolution:Evo[];analysis:{title:string;body:string;updated:string}|null;names:Record<string,string>};
type Detail={agent:Row&{text:string[]};trades:(Omit<PaperTrade,'partsAtEntry'>&{mark:{r:number;pnlCzk:number}|null})[];log:{at:number;text:string}[]};
const r2=(v:number|null)=>v===null?'–':(v>0?'+':v<0?'−':'')+fmtNum(Math.abs(v),2)+' R';
const kc=(v:number|null)=>v===null?'–':(v>0?'+':v<0?'−':'')+fmtNum(Math.abs(Math.round(v)),0)+' Kč';
const sgn=(v:number|null)=>v===null?'':v>0?'pos':v<0?'neg':'';
const when=(t:number|null)=>t===null?'–':new Date(t).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
const ACTION:Record<string,string>={seed:'Založen',clone:'Potomek',retire:'Archivován',evaluate:'Hodnocení'};
const CLS:Series['cls'][]=['b','c','d','e','f'];
async function call<T>(url:string):Promise<T>{const r=await fetch(url,{cache:'no-store'});const j=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw Object.assign(new Error(j.error||'Načtení se nepovedlo.'),{status:r.status});return j as T}

export function AgentsTab({initial}:{initial?:Data}={}){
 const [data,setData]=useState<Data|null>(initial??null),[err,setErr]=useState(''),[missing,setMissing]=useState(false),[sel,setSel]=useState<string|null>(null),[detail,setDetail]=useState<Detail|null>(null),[showEval,setShowEval]=useState(false);
 const load=useCallback(()=>{call<Data>('/api/laborator/agents').then(j=>{setData(j);setErr('')}).catch(e=>{if((e as {status?:number}).status===503)setMissing(true);else setErr((e as Error).message)})},[]);
 useEffect(()=>{if(initial)return;load();const t=setInterval(()=>{if(document.visibilityState==='visible')load()},5*60000);return()=>clearInterval(t)},[load,initial]);
 useEffect(()=>{if(!sel){setDetail(null);return}setDetail(null);call<Detail>('/api/laborator/agents?agent='+encodeURIComponent(sel)).then(setDetail).catch(e=>setErr((e as Error).message))},[sel]);
 const series=useMemo(()=>{if(!data)return [];const out:Series[]=[];
  if(data.bench.started!==null&&data.bench.equity.length)out.push({label:'A – benchmark',points:[{t:data.bench.started,equity:100000},...data.bench.equity],cls:'a'});
  data.top.forEach((id,i)=>{const r=data.agents.find(a=>a.id===id);if(r?.equity)out.push({label:`${id} – ${FAMILY_LABEL(r.genome.family)}`,points:[{t:r.started,equity:100000},...r.equity],cls:CLS[i]})});
  // benchmark jen od startu populace, ať se křivky dají porovnat
  const from=Math.min(...data.agents.map(a=>a.started));if(Number.isFinite(from)&&out[0]?.cls==='a')out[0]={...out[0],points:out[0].points.filter(p=>p.t>=from-86400000)};
  return out.filter(s=>s.points.length>1)},[data]);
 if(missing)return <section className="mt-card"><p className="mt-alert">Agenti ještě nejdou – chybí migrace databáze (0030_lab_agents.sql).</p></section>;
 if(!data)return <section className="mt-card">{err?<p className="mt-alert" role="alert">{err}</p>:<p className="mt-empty">Načítám…</p>}</section>;
 const active=data.agents.filter(a=>a.active),archived=data.agents.filter(a=>!a.active),name=(id:string)=>data.names[id]||id;
 const evo=data.evolution.filter(e=>showEval||e.action!=='evaluate');
 const head=<tr><th>#</th><th>Agent</th><th>Týden</th><th>Celkem</th><th>Obchody</th><th>Win rate</th><th>Průměr R</th><th>Max. DD</th><th>Fitness</th><th>Gen.</th><th>Rodič</th></tr>;
 const row=(a:Row,i:number)=><Fragment key={a.id}><tr className={sel===a.id?'lb-sel':''}>
  <td>{i+1}</td>
  <td><button className="lb-link lb-exp" aria-expanded={sel===a.id} onClick={()=>setSel(s=>s===a.id?null:a.id)}>{sel===a.id?<ChevronDown size={14}/>:<ChevronRight size={14}/>}{a.id} – {FAMILY_LABEL(a.genome.family)}</button><small>{a.genomeText}</small>{a.learning&&<span className="lb-badge">učí se</span>}{a.active&&a.killable&&<span className="lb-badge no">k vyřazení</span>}</td>
  <td className={sgn(a.weekR)}>{r2(a.weekR)}<small>{kc(a.weekPnl)} · {a.weekTrades} obch.</small></td>
  <td className={sgn(a.stats.returnPct)}>{kc(a.stats.equity-a.stats.startEquity)}<small>{fmtNum(a.stats.returnPct,2)} % · {r2(a.stats.totalR)}</small></td>
  <td>{a.stats.trades}{a.stats.open?<small>+{a.stats.open} otevř.</small>:null}</td><td>{a.stats.winRate===null?'–':fmtNum(a.stats.winRate,1)+' %'}</td>
  <td className={sgn(a.stats.avgR)}>{r2(a.stats.avgR)}</td><td className={a.stats.maxDrawdownPct<0?'neg':''}>{fmtNum(a.stats.maxDrawdownPct,1)} %</td>
  <td className={sgn(a.fitness)}><b>{fmtNum(a.fitness,2)}</b></td><td>{a.meta.gen}</td><td>{a.meta.parent??'–'}</td></tr>
  {sel===a.id&&<tr className="lb-notesrow"><td colSpan={11}>{!detail?<p className="mt-empty">Načítám…</p>:<div>
   <dl className="lb-genome">{([['Rodina',FAMILY_LABEL(a.genome.family)+(a.genome.v?' · '+a.genome.v:'')],...(a.genome.family==='score'?[['Práh / vstup',`${a.genome.threshold} · ${a.genome.entry}`]]:[]),['SL',fmtNum(a.genome.slAtr,1)+' × ATR'],
    ['Výstup',a.genome.exit==='tp'?`TP ${fmtNum(a.genome.tpR,1)} R`:a.genome.exit==='trail'?`trailing ${fmtNum(a.genome.trailAtr,1)} × ATR`:'signálem'],['Držení',a.genome.hold+' d'],['Trhy',AGENT_SET_LABELS[a.genome.set]],['Max. pozic',String(a.genome.maxOpen)],['Riziko',fmtNum(a.genome.riskPct,1)+' %'],
    ['Kor. limit',a.genome.corrCap?'ano':'ne'],['Ochlazení',a.genome.cooldown?'ano':'ne'],['Pravidla',a.rulesVersion],['Start',when(a.started)]] as [string,string][]).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
   <p className="lb-meta">Původ: {a.meta.origin||'–'}{a.meta.parent?` · rodič ${a.meta.parent}`:''}. Pravidla agenta se po založení nemění – změna = nový agent.</p>
   <ul className="lb-notes">{detail.agent.text.map(t=><li key={t}>{t}</li>)}</ul>
   {detail.trades.length>0&&<div className="lb-scroll"><table className="mt-table lb-table"><thead><tr><th>Trh</th><th>Směr</th><th>Otevřeno</th><th>Zavřeno</th><th>Důvod</th><th>R</th><th>Kč</th></tr></thead>
    <tbody>{detail.trades.slice(0,40).map(t=><tr key={t.id} title={t.why}><td>{name(t.instrument)}</td><td>{t.direction}</td><td>{when(t.opened)}</td><td>{t.closed===null?'otevřeno':when(t.closed)}</td><td>{t.exitReason??'–'}</td>
     <td className={sgn(t.r??t.mark?.r??null)}>{r2(t.r??t.mark?.r??null)}</td><td className={sgn(t.pnlCzk??t.mark?.pnlCzk??null)}>{kc(t.pnlCzk??t.mark?.pnlCzk??null)}</td></tr>)}</tbody></table></div>}
   {detail.log.length>0&&<details className="lb-details"><summary>Deník agenta ({detail.log.length})</summary><ul className="lb-log">{detail.log.map((l,i)=><li key={i}><time>{when(l.at)}</time> {l.text}</li>)}</ul></details>}
  </div>}</td></tr>}
 </Fragment>;
 return <>
  <section className="mt-card">
   <h2>Populace agentů</h2>
   <p className="mt-lead">{active.length} aktivních agentů po 100 000 Kč obchoduje každých 15 minut, každý podle vlastního genomu (rodina strategie + parametry). V neděli v 18:15 evoluce: top 3 dostanou potomka s malou mutací, agent s aspoň 20 obchody a průměrem pod −0,1 R může být archivován. Fitness = R za týden + 0,5 × průměr R × √obchodů − penalizace DD nad 5 %.</p>
   {err&&<p className="mt-alert" role="alert">{err}</p>}
   {!data.agents.length?<p className="mt-empty">Populace ještě nevznikla. Na VPS: <code>node --experimental-strip-types scripts/lab-evolve.mjs --seed</code></p>:<>
    <div className="lb-scroll"><table className="mt-table lb-table lb-compare"><thead>{head}</thead><tbody>{active.map(row)}</tbody></table></div>
    {series.length?<EquityChart series={series} fmt={v=>fmtNum(Math.round(v),0)+' Kč'} base={100000}/>:<p className="mt-empty">Křivky se ukážou po prvních bězích.</p>}
   </>}
  </section>
  <section className="mt-card">
   <h2>Analýza týdne (AI)</h2>
   {!data.analysis?<p className="mt-empty">Zatím žádná. AI analytik běží v neděli v 18:30 a výsledek uloží jako poznámku „Týdenní analýza agentů“.</p>:<>
    <p className="lb-meta">{data.analysis.title} · {new Date(data.analysis.updated.replace(' ','T')+(data.analysis.updated.endsWith('Z')?'':'Z')).toLocaleString('cs-CZ')} · jen návrhy, nic sám nemění</p>
    <pre className="lb-pre">{data.analysis.body}</pre></>}
  </section>
  <section className="mt-card">
   <h2>Evoluce</h2>
   <label className="lb-hint"><input type="checkbox" checked={showEval} onChange={e=>setShowEval(e.target.checked)}/> i týdenní hodnocení všech agentů</label>
   {!evo.length?<p className="mt-empty">Zatím žádné změny.</p>:<ul className="lb-timeline">{evo.slice(0,150).map((e,i)=><li key={i} className={e.action}><time>gen {e.gen} · {when(e.at)}</time><b>{ACTION[e.action]??e.action} {e.agent}</b>{e.parent?` ← ${e.parent}`:''}{e.fitness!==null?` · fitness ${fmtNum(e.fitness,2)}`:''} – {e.reason}</li>)}</ul>}
  </section>
  {archived.length>0&&<section className="mt-card">
   <h2>Archiv ({archived.length})</h2>
   <p className="mt-lead">Vyřazení agenti – jen pro čtení, s celou historií. Otevřené pozice dobíhají podle svých pravidel, nové už neotevírají.</p>
   <div className="lb-scroll"><table className="mt-table lb-table"><thead>{head}</thead><tbody>{archived.map(row)}</tbody></table></div>
  </section>}
 </>;
}
