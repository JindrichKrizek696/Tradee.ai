'use client';
// Laboratoř · Hledání prahů: výsledek historického sweepu (scripts/lab-sweep.mjs) – heatmapa, průběh podle prahu, top 30, hranice náhody,
// „Pustit do simulace“ u robustní kombinace (POST /api/laborator/sweep → varianta S01…S20). Jen vlastník (API vrací ostatním 404).
import {useCallback,useEffect,useMemo,useState} from 'react';
import {Play,AlertTriangle} from 'lucide-react';
import {fmtNum} from '@/lib/journal/format';
import {comboAt,comboIndex,ENTRY_LABELS,EXIT_LABELS,SET_LABELS,SWEEP_GRID,type SweepCombo,type SweepEntry,type SweepSet,type SweepExit} from '@/lib/lab/sweep-grid';
import type {SweepResult} from '@/lib/lab/sweep';

type Summary={combos:number;robust:number;chance:number|null;ms:number};
type Item={id:string;created:string;summary:Summary|null};
export type SweepData={sweep:{id:string;created:string;result:SweepResult}|null;list:Item[];running:{variant:string;combo:number;sweepId:string|null}[]};
type Metric='oosAvg'|'isAvg'|'allTot'|'oosPf';
const METRICS:[Metric,string][]=[['oosAvg','OOS průměr R'],['isAvg','IS průměr R'],['allTot','Celkem R'],['oosPf','OOS profit factor']];
const ENTRIES=SWEEP_GRID.entry,TH=SWEEP_GRID.threshold;
const num=(v:number|null|undefined,d=2)=>v===null||v===undefined?'–':fmtNum(v,d);
const r2=(v:number|null|undefined)=>v===null||v===undefined?'–':(v>0?'+':v<0?'−':'')+fmtNum(Math.abs(v),2)+' R';
const sgn=(v:number|null|undefined)=>v===null||v===undefined?'':v>0?'pos':v<0?'neg':'';
async function call<T>(url:string,method='GET',body?:unknown):Promise<T>{
 const r=await fetch(url,{method,cache:'no-store',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const j=await r.json().catch(()=>({})) as {error?:string;missing?:boolean};if(!r.ok)throw Object.assign(new Error(j.error||'Akce se nepovedla.'),{status:r.status});return j as T;
}
// barva buňky: zelená / červená podle znaménka (PF kolem 1), intenzita podle velikosti
function cellBg(m:Metric,v:number|null):string|undefined{
 if(v===null)return undefined;
 const x=m==='oosPf'?v-1:v,scale=m==='allTot'?60:m==='oosPf'?.6:.3,k=Math.min(1,Math.abs(x)/scale);
 if(Math.abs(x)<1e-9)return undefined;
 return `color-mix(in srgb, var(${x>0?'--bull':'--bear'}) ${Math.round(8+k*52)}%, transparent)`;
}

// initial = předvyplněná data (jen pro kontrolu vykreslení bez API)
export function SweepTab({initial}:{initial?:SweepData}={}){
 const [data,setData]=useState<SweepData|null>(initial??null),[err,setErr]=useState(''),[missing,setMissing]=useState(false),[busy,setBusy]=useState<number|null>(null),[msg,setMsg]=useState('');
 const [sel,setSel]=useState<string>('');
 const [f,setF]=useState<Omit<SweepCombo,'threshold'|'entry'>>({slAtr:1.5,exit:'tp2',hold:10,corrCap:false,cooldown:false,set:'fx'});
 const [metric,setMetric]=useState<Metric>('oosAvg'),[onlyRobust,setOnlyRobust]=useState(true),[allSets,setAllSets]=useState(true);
 const load=useCallback((id?:string)=>{call<SweepData>('/api/laborator/sweep'+(id?'?id='+encodeURIComponent(id):'')).then(j=>{setData(j);setErr('');if(j.sweep)setSel(j.sweep.id)}).catch(e=>{if((e as {status?:number}).status===503)setMissing(true);else setErr((e as Error).message)})},[]);
 useEffect(()=>{if(!initial)load()},[load,initial]);
 const res=data?.sweep?.result??null;
 const fi=useMemo(()=>res?Object.fromEntries(res.fields.map((k,i)=>[k,i])) as Record<string,number>:{} as Record<string,number>,[res]);
 const val=useCallback((i:number,k:string)=>{const r=res?.rows[i];return r?(r[fi[k]] as number|null):null},[res,fi]);
 const cell=(entry:SweepEntry,threshold:number)=>comboIndex({...f,entry,threshold});
 // kde se to láme: první práh (vzestupně), od kterého je OOS průměr R záporný a už nezlepší nad nulu
 const breaks=useMemo(()=>res?ENTRIES.map(e=>{const v=TH.map(t=>val(cell(e,t),'oosAvg'));
  const from=(pred:(x:number)=>boolean)=>{for(let k=0;k<TH.length;k++)if(v.slice(k).every(x=>x===null||pred(x))&&v.slice(k).some(x=>x!==null))return TH[k];return null};
  const known=v.filter((x):x is number=>x!==null);
  return {e,known:known.length,allNeg:known.length>0&&known.every(x=>x<0),allPos:known.length>0&&known.every(x=>x>0),neg:from(x=>x<0),pos:from(x=>x>0)}}):[],[res,val,f]); // eslint-disable-line react-hooks/exhaustive-deps
 const top=useMemo(()=>{if(!res)return [];const out:number[]=[];res.rows.forEach((r,i)=>{if(!r)return;if(onlyRobust&&r[fi.robust]!==1)return;if(!allSets&&comboAt(i).set!==f.set)return;if((r[fi.oosN] as number)<1)return;out.push(i)});
  return out.sort((a,b)=>(val(b,'oosAvg')??-9)-(val(a,'oosAvg')??-9)).slice(0,30)},[res,fi,onlyRobust,allSets,f.set,val]);
 const running=new Map((data?.running??[]).filter(x=>x.sweepId===data?.sweep?.id).map(x=>[x.combo,x.variant]));
 async function simulate(i:number){
  const c=comboAt(i);if(!confirm(`Pustit do simulace kombinaci ${ENTRY_LABELS[c.entry]} · práh ${c.threshold} · SL ${c.slAtr} ATR · ${EXIT_LABELS[c.exit]} · max ${c.hold} d · ${SET_LABELS[c.set]}?\n\nVznikne nová varianta S01–S20 s vlastním účtem 100 000 Kč. Živě se práh porovnává se skutečným skóre Tradee (u FX i s fundamenty), ne s technickým kompozitem ze sweepu.`))return;
  setBusy(i);setMsg('');try{const j=await call<{variant:string}>('/api/laborator/sweep','POST',{action:'simulate',sweepId:data!.sweep!.id,combo:i});setMsg(`Varianta ${j.variant} založena – začne obchodovat při příštím běhu simulace (do 15 min). Najdeš ji v záložce Simulace.`);load(data!.sweep!.id)}
  catch(e){setErr((e as Error).message)}finally{setBusy(null)}
 }
 if(missing)return <section className="mt-card"><p className="mt-alert">Hledání prahů ještě nejde – chybí migrace databáze (0028_lab_sweep.sql).</p></section>;
 if(!data)return <section className="mt-card">{err?<p className="mt-alert" role="alert">{err}</p>:<p className="mt-empty">Načítám…</p>}</section>;
 const ch=res?.chance??null;
 return <>
  <section className="mt-card">
   <h2>Hledání prahů</h2>
   <p className="mt-lead">Historický sweep: ~7 800 kombinací prahu skóre, typu vstupu, stop-lossu, výstupu, držení a limitů nad denními svíčkami. Každá kombinace má výsledek zvlášť v letech 2015–2022 (in-sample, IS) a od 2023 (out-of-sample, OOS). Hledáme místa, kde to funguje v obou obdobích a nezlomí se to o krok vedle.</p>
   <div className="bt-warn lb-sw-warn"><AlertTriangle size={16}/><ul>
    <li>Historicky jde zrekonstruovat jen <b>technický kompozit</b>: trend + COT + sezonalita (váhy 15 : 15 : 5 jako ve score-v3). <b>Fundamenty (sazby, inflace, makro, retail) historicky nemáme.</b></li>
    <li>Živá simulace (varianty S01…) porovnává práh se <b>skutečným skóre Tradee</b> (FX = score-v3 i s fundamenty, ostatní technický model) – stejné číslo prahu se proto živě může chovat jinak.</li>
   </ul></div>
   {!res?<p className="mt-empty">Sweep zatím neproběhl. Spouští se na serveru: <code>node --experimental-strip-types scripts/lab-sweep.mjs</code> (několik minut), výsledek se objeví tady.</p>:<>
    <div className="lb-form">
     {data.list.length>1&&<label>Sweep<select value={sel} onChange={e=>{setSel(e.target.value);load(e.target.value)}}>{data.list.map(x=><option key={x.id} value={x.id}>{new Date(x.created).toLocaleString('cs-CZ')} · {x.summary?`${x.summary.robust} robustních`:''}</option>)}</select></label>}
     <span className="lb-meta">IS {res.from} – {new Date(Date.parse(res.split)-86400000).toISOString().slice(0,10)} · OOS {res.split} – {res.to} · {res.markets.length} trhů ({res.markets.filter(m=>m.cot).length} s COT) · {res.rows.filter(Boolean).length.toLocaleString('cs-CZ')} kombinací · robustních {res.robust.length} · spočítáno {new Date(res.computedAt).toLocaleString('cs-CZ')} za {Math.round(res.ms/1000)} s</span>
    </div>
   </>}
   {err&&<p className="mt-alert" role="alert">{err}</p>}
   {msg&&<p className="lb-meta lb-ok" role="status">{msg}</p>}
  </section>
  {res&&<>
   <section className="mt-card">
    <h2>Kde se to láme</h2>
    <div className="lb-form lb-sw-dims">
     <label>Trhy<select value={f.set} onChange={e=>setF({...f,set:e.target.value as SweepSet})}>{SWEEP_GRID.set.map(s=><option key={s} value={s}>{SET_LABELS[s]}</option>)}</select></label>
     <label>SL<select value={f.slAtr} onChange={e=>setF({...f,slAtr:Number(e.target.value)})}>{SWEEP_GRID.slAtr.map(s=><option key={s} value={s}>{fmtNum(s,1)} × ATR</option>)}</select></label>
     <label>Výstup<select value={f.exit} onChange={e=>setF({...f,exit:e.target.value as SweepExit})}>{SWEEP_GRID.exit.map(s=><option key={s} value={s}>{EXIT_LABELS[s]}</option>)}</select></label>
     <label>Držet max.<select value={f.hold} onChange={e=>setF({...f,hold:Number(e.target.value)})}>{SWEEP_GRID.hold.map(s=><option key={s} value={s}>{s} dní</option>)}</select></label>
     <label>Korelační limit<select value={String(f.corrCap)} onChange={e=>setF({...f,corrCap:e.target.value==='true'})}><option value="false">vypnutý</option><option value="true">max 2 na skupinu</option></select></label>
     <label>Ochlazení<select value={String(f.cooldown)} onChange={e=>setF({...f,cooldown:e.target.value==='true'})}><option value="false">vypnuté</option><option value="true">5 dní po ztrátě</option></select></label>
    </div>
    <div className="mt-chips" role="group" aria-label="Metrika">{METRICS.map(([k,l])=><button key={k} className={metric===k?'active':''} aria-pressed={metric===k} onClick={()=>setMetric(k)}>{l}</button>)}</div>
    <div className="lb-scroll"><table className="mt-table lb-table lb-heat">
     <thead><tr><th>Vstup \ práh |skóre|</th>{TH.map(t=><th key={t}>≥ {t}</th>)}</tr></thead>
     <tbody>{ENTRIES.map(e=><tr key={e}><th scope="row">{ENTRY_LABELS[e]}</th>{TH.map(t=>{const i=cell(e,t),v=val(i,metric),n=val(i,metric==='isAvg'?'isN':metric==='allTot'?'allN':'oosN'),rob=val(i,'robust')===1;
      return <td key={t} style={{background:cellBg(metric,v)}} className={rob?'lb-rob':''} title={`IS ${num(val(i,'isN'),0)} obch. ${r2(val(i,'isAvg'))} · OOS ${num(val(i,'oosN'),0)} obch. ${r2(val(i,'oosAvg'))} · PF ${num(val(i,'oosPf'))} · okolí ${r2(val(i,'nb'))}${rob?' · robustní':''}`}>
       <b>{metric==='oosPf'?num(v):metric==='allTot'?num(v,1):r2(v)}</b><small>{num(n,0)} obch.{rob?' · ★':''}</small></td>})}</tr>)}</tbody>
    </table></div>
    <p className="lb-meta">Barva = {METRICS.find(m=>m[0]===metric)![1]} (zelená kladná, červená záporná; PF kolem 1). ★ = robustní kombinace. Najetím na buňku IS / OOS detail.</p>
    <ul className="lb-notes">{breaks.map(b=><li key={b.e}><b>{ENTRY_LABELS[b.e]}:</b> {!b.known?'bez obchodů.':b.allNeg?'OOS průměr R je záporný při všech prazích.':b.allPos?'OOS průměr R je kladný při všech prazích.':b.neg!==null?`od prahu ${b.neg} je OOS průměr R záporný (výš se už nezlepší).`:b.pos!==null?`pod prahem ${b.pos} OOS průměr R kolísá kolem nuly / je záporný, od prahu ${b.pos} je kladný.`:'OOS průměr R střídá znaménko – bez jasného zlomu.'}</li>)}</ul>
    <LineChart res={res} val={val} f={f} chance={ch?.median??null}/>
   </section>
   <section className="mt-card">
    <h2>Hranice náhody</h2>
    {ch?<>
     <p className="mt-lead">Když zkusíš {ch.n.toLocaleString('cs-CZ')} kombinací, některá vyjde dobře i čistou náhodou. Proto jsme celý grid {ch.reps}× přepočítali s <b>náhodnými směry obchodů</b> (náhodné znaménko pro každou epizodu signálu, stejné časování vstupů i výstupů) a pokaždé vzali nejlepší OOS průměr R (s aspoň 60 OOS obchody).</p>
     <dl className="bt-tiles">{([['Hranice náhody (medián)',r2(ch.median),'nejlepší OOS průměr R v šumu'],['Nejhorší případ (max)',r2(ch.max),`z ${ch.reps} opakování`],['Robustních nad hranicí',String(res.robust.filter(i=>(val(i,'oosAvg')??-9)>(ch.median??9)).length),`z ${res.robust.length} robustních`]] as [string,string,string][]).map(([k,v,s])=><div key={k} className="bt-tile"><dt>{k}</dt><dd>{v}</dd><dd className="sub">{s}</dd></div>)}</dl>
     <p className="lb-meta">Kombinace s OOS průměrem pod {r2(ch.median)} nejsou lepší, než co hledání najde v náhodných datech – i když jsou „robustní“. Seed {ch.seed}, výsledek je deterministický.</p>
    </>:<p className="mt-empty">Tento sweep běžel bez náhodného srovnání (--shuffles 0).</p>}
   </section>
   <section className="mt-card">
    <h2>Top 30 podle OOS průměru R</h2>
    <div className="lb-form">
     <label className="lb-check"><input type="checkbox" checked={onlyRobust} onChange={e=>setOnlyRobust(e.target.checked)}/>jen robustní</label>
     <label className="lb-check"><input type="checkbox" checked={allSets} onChange={e=>setAllSets(e.target.checked)}/>všechny sady trhů (jinak jen {SET_LABELS[f.set]})</label>
    </div>
    {!top.length?<p className="mt-empty">Žádná kombinace nesplňuje filtr.</p>:<div className="lb-scroll"><table className="mt-table lb-table">
     <thead><tr><th>Kombinace</th><th>IS obch.</th><th>IS průměr</th><th>IS PF</th><th>OOS obch.</th><th>OOS průměr</th><th>OOS PF</th><th>OOS DD</th><th>OOS win</th><th>Okolí</th><th></th></tr></thead>
     <tbody>{top.map(i=>{const c=comboAt(i),rob=val(i,'robust')===1,run=running.get(i),beat=ch?.median!=null&&(val(i,'oosAvg')??-9)>ch.median;return <tr key={i}>
      <td><b>{ENTRY_LABELS[c.entry]} · práh {c.threshold}</b><small>SL {fmtNum(c.slAtr,1)} ATR · {EXIT_LABELS[c.exit]} · max {c.hold} d · {SET_LABELS[c.set]}{c.corrCap?' · kor. limit':''}{c.cooldown?' · ochlazení':''}</small></td>
      <td>{num(val(i,'isN'),0)}</td><td className={sgn(val(i,'isAvg'))}>{r2(val(i,'isAvg'))}</td><td>{num(val(i,'isPf'))}</td>
      <td>{num(val(i,'oosN'),0)}</td><td className={sgn(val(i,'oosAvg'))}>{r2(val(i,'oosAvg'))}{ch&&<small>{beat?'nad hranicí náhody':'pod hranicí náhody'}</small>}</td><td>{num(val(i,'oosPf'))}</td><td className="neg">{num(val(i,'oosDd'),1)} R</td><td>{num(val(i,'oosWin'),1)} %</td>
      <td className={sgn(val(i,'nb'))}>{r2(val(i,'nb'))}</td>
      <td className="mt-actions">{rob?run?<span className="lb-hint">běží jako {run}</span>:<button className="mt-btn" disabled={busy!==null} onClick={()=>simulate(i)}><Play size={14}/>{busy===i?'Zakládám…':'Pustit do simulace'}</button>:<span className="lb-hint">není robustní</span>}</td></tr>})}</tbody>
    </table></div>}
    <ul className="lb-notes">{res.notes.map((n,i)=><li key={i}>{n}</li>)}</ul>
   </section>
  </>}
 </>;
}

// OOS průměr R podle prahu pro každý typ vstupu (ostatní dimenze podle výběru), nula a hranice náhody
function LineChart({res,val,f,chance}:{res:SweepResult;val:(i:number,k:string)=>number|null;f:Omit<SweepCombo,'threshold'|'entry'>;chance:number|null}){
 const W=640,H=220,P={l:44,r:12,t:12,b:28};
 const series=ENTRIES.map(e=>({e,pts:TH.map(t=>({t,v:val(comboIndex({...f,entry:e,threshold:t}),'oosAvg')}))}));
 const vals=series.flatMap(s=>s.pts.map(p=>p.v)).filter((v):v is number=>v!==null).concat([0,...(chance!==null?[chance]:[])]);
 if(vals.length<=1)return null;
 let lo=Math.min(...vals),hi=Math.max(...vals);if(hi-lo<.1){hi+=.05;lo-=.05}const pad=(hi-lo)*.08;lo-=pad;hi+=pad;
 const x=(t:number)=>P.l+(t-TH[0])/(TH[TH.length-1]-TH[0])*(W-P.l-P.r),y=(v:number)=>P.t+(hi-v)/(hi-lo)*(H-P.t-P.b);
 const ticks=Array.from({length:5},(_,k)=>lo+(hi-lo)*k/4);
 const cls:Record<SweepEntry,string>={immediate:'a',pullback:'c',contra:'d'};
 return <figure className="lb-line" aria-label={`OOS průměr R podle prahu pro ${SET_LABELS[res.markets.length?f.set:'fx']}`}>
  <svg viewBox={`0 0 ${W} ${H}`} role="img">
   {ticks.map((v,k)=><g key={k}><line x1={P.l} x2={W-P.r} y1={y(v)} y2={y(v)} className="grid"/><text x={P.l-6} y={y(v)+4} textAnchor="end">{fmtNum(v,2)}</text></g>)}
   <line x1={P.l} x2={W-P.r} y1={y(0)} y2={y(0)} className="zero"/>
   {chance!==null&&<><line x1={P.l} x2={W-P.r} y1={y(chance)} y2={y(chance)} className="chance"/><text x={W-P.r} y={y(chance)-4} textAnchor="end" className="chance-t">hranice náhody</text></>}
   {TH.map(t=><text key={t} x={x(t)} y={H-8} textAnchor="middle">{t}</text>)}
   {series.map(s=>{const pts=s.pts.filter(p=>p.v!==null);return <g key={s.e} className={'ln '+cls[s.e]}><polyline points={pts.map(p=>`${x(p.t)},${y(p.v!)}`).join(' ')}/>{pts.map(p=><circle key={p.t} cx={x(p.t)} cy={y(p.v!)} r={3}/>)}</g>})}
  </svg>
  <figcaption>{series.map(s=><span key={s.e}><i className={'bt-dot '+cls[s.e]}/>{ENTRY_LABELS[s.e]}</span>)}<span>osa X = práh |skóre|, osa Y = OOS průměr R</span></figcaption>
 </figure>;
}
