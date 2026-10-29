'use client';
// Skóre k datu (Etapa 2A): volba „Stav k datu“, banner, panel „Proč?“ u každého čísla, graf historie s vysvětlením změn,
// karta měny a signály páru, skóre v době vstupu (Deník) a při založení scénáře. Logika: lib/score/pit.ts (bez AI textu).
import {useEffect,useMemo,useRef,useState} from 'react';
import {History,X} from 'lucide-react';
import {explainPart,diffSnapshots,fingerprint,directionText,stance,mixedSignals,dayMonthTime,cz,methodChanges,fromHistory,type PitSnapshot,type PitPart,type PitChange,type WindowKey,type CurrencyGroup} from '@/lib/score/pit';
import {componentInfo,METHOD} from '@/lib/score/method-text';
import type {V3Part} from '@/lib/score/v3';
import './score-pit.css';

export type AtResponse={t:string;source:'db'|'history';snapshots:Record<string,PitSnapshot>;previous:Record<string,PitSnapshot|null>};
/** Stav k času t (null = jen poslední uložený snímek pro „co se změnilo“). markets=null = všechny trhy. */
export function useScoresAt(t:number|null,markets:string[]|null,enabled=true){
 const [res,setRes]=useState<AtResponse|null>(null),[error,setError]=useState(''),[done,setDone]=useState(''),key=(markets||[]).join(','),req=`${t}|${key}`;
 useEffect(()=>{if(!enabled)return;let gone=false;
  const q=new URLSearchParams();if(t!==null)q.set('t',String(Math.round(t)));if(key)q.set('markets',key);
  fetch('/api/scores/at?'+q,{cache:'no-store'}).then(async r=>{const j=await r.json() as AtResponse&{error?:string};if(!r.ok)throw Error(j.error||'Stav k datu se nepodařilo načíst.');if(!gone){setRes(j);setError('')}}).catch(e=>{if(!gone)setError((e as Error).message)}).finally(()=>{if(!gone)setDone(req)});
  return()=>{gone=true}},[t,key,enabled,req]);
 return {res,error,loading:enabled&&done!==req};
}
const toLocal=(ms:number)=>new Date(ms-new Date(ms).getTimezoneOffset()*60000).toISOString().slice(0,16);
/** Výběr času „Stav k datu“; prázdné = teď (živý výpočet). */
export function AsOfControl({t,onChange,label='Stav k datu'}:{t:number|null;onChange:(t:number|null)=>void;label?:string}){
 const [max]=useState(()=>toLocal(Date.now()));
 return <div className="pit-asof"><label><History size={14} aria-hidden/><span>{label}</span><input type="datetime-local" value={t===null?'':toLocal(t)} max={max} onChange={e=>{const n=Date.parse(e.target.value);onChange(e.target.value&&Number.isFinite(n)?n:null)}} aria-label={label}/></label>{t!==null&&<button type="button" className="pit-now" onClick={()=>onChange(null)}>Teď</button>}</div>;
}
/** „Zobrazuješ stav k D. M. HH:MM“ + čas skutečného snímku a označení rekonstrukce. */
export function AsOfBanner({t,snap,source,loading,error,onReset,count}:{t:number;snap?:PitSnapshot|null;source?:string;loading?:boolean;error?:string;onReset:()=>void;count?:number}){
 const gap=snap?t-Date.parse(snap.at):0;
 return <div className="pit-banner" role="status"><b>Zobrazuješ stav k {dayMonthTime(t)}</b>
  <span>{loading?'Načítám uložené snímky…':error?error:snap?<>nejbližší uložený snímek {dayMonthTime(snap.at)}{gap>6*3600000?` (o ${Math.round(gap/3600000)} h starší)`:''}{snap.reconstructed?' · rekonstruováno z historie (bez vstupních čísel)':''}{source==='history'?' · záloha z historie':''}</>:count===0||count===undefined?'Pro tento čas není uložený žádný snímek – historie začíná později.':`${count} trhů ze snímků ≤ zvolený čas`}</span>
  <button type="button" onClick={onReset}>Zpět na teď</button></div>;
}
/** PitPart → tvar pro řádek složky (app/score-breakdown.tsx ComponentRow). */
export function toV3Part(p:PitPart):V3Part{
 const sources=p.inputs.filter(i=>i.url).map(i=>({label:i.source||i.label,url:i.url as string})).filter((s,i,a)=>a.findIndex(x=>x.url===s.url)===i);
 return {id:p.id as V3Part['id'],label:p.label,weight:p.weight,value:p.value,signal:p.value===null?null:p.value/2,contribution:p.contribution,reason:componentInfo(p.id)||p.detail,detail:p.detail,asOf:p.asOf,asOfLabel:p.period||'',ageMs:p.ageMs,age:null,window:p.window||'',source:sources[0]?.url??null,sources,stale:p.status==='stale',status:p.status,missingReason:p.missingReason};
}
const tone=(n:number|null)=>n===null||n===0?'':n>0?'positive':'negative';
/** Panel „Proč?“ jedné složky: vstupy → porovnávaná veličina → pravidlo → hodnota → váha → příspěvek + změny od minula. */
export function WhyPanel({part,snap,prev,market,onClose}:{part:PitPart;snap:Pick<PitSnapshot,'coverage'|'reconstructed'|'method'|'at'>;prev?:PitSnapshot|null;market:string;onClose?:()=>void}){
 const e=explainPart(part,snap),changes=prev?diffSnapshots(prev,snap as PitSnapshot).filter(c=>c.id===part.id||c.id==='method'):[];
 const st=stance(part,market);
 return <div className="pit-why" role="region" aria-label={'Proč: '+part.label}>
  <div className="pit-why-head"><b>{e.title} = {e.value}</b>{part.scale==='pm2'&&st.side!=='none'&&<span className={'pit-stance '+st.side}>{st.text}</span>}{onClose&&<button type="button" className="pit-x" aria-label="Zavřít" onClick={onClose}><X size={14}/></button>}</div>
  {e.reconstructed&&<p className="pit-note">Rekonstruováno z historie – vstupní čísla tehdy nebyla uložena; k dispozici je jen hodnota a příspěvek.</p>}
  {e.status&&<p className="pit-note">{e.status}</p>}
  {e.inputs.length>0&&<table className="pit-inputs"><thead><tr><th>Vstup</th><th>Hodnota</th><th>Období · data · zdroj</th></tr></thead><tbody>{e.inputs.map((i,k)=><tr key={k}><td>{i.label}</td><td className="num">{i.value}{i.transform&&<small>{i.transform}</small>}</td><td>{i.meta.join(' · ')}{i.url&&<> · <a href={i.url} target="_blank" rel="noreferrer">odkaz ↗</a></>}</td></tr>)}</tbody></table>}
  <dl className="pit-dl">{e.x&&<><dt>Porovnání</dt><dd>{e.x}</dd></>}{e.rule&&<><dt>Pravidlo</dt><dd>{e.rule}</dd></>}<dt>Váha</dt><dd>{e.weight}</dd><dt>Příspěvek</dt><dd>{e.contribution}</dd></dl>
  {prev!==undefined&&<div className="pit-changes"><b>Od předchozího snímku{prev?` (${dayMonthTime(prev.at)})`:''}</b>{!prev?<p>Starší snímek s jiným obsahem není uložený.</p>:changes.length?<ul>{changes.map(c=><li key={c.id}>{c.text}</li>)}</ul>:<p>Beze změny.</p>}</div>}
 </div>;
}
/** Proč u celkového skóre: vzorec + všechny změny od předchozího snímku. */
export function ScoreWhy({snap,prev,onClose}:{snap:PitSnapshot;prev:PitSnapshot|null|undefined;onClose:()=>void}){
 const changes=prev?diffSnapshots(prev,snap):[];
 return <div className="pit-why" role="region" aria-label="Proč toto skóre"><div className="pit-why-head"><b>Skóre {cz(snap.score,1)} · {snap.method} {snap.version!==snap.method?`(revize ${snap.version})`:''}</b><button type="button" className="pit-x" aria-label="Zavřít" onClick={onClose}><X size={14}/></button></div>
  <p className="pit-note">{snap.method==='score-v3'?METHOD.card:'Technický model: signál složky × váha.'} Dostupné váhy {snap.coverage??'?'} %. Snímek {dayMonthTime(snap.at)}{snap.reconstructed?' · rekonstruováno z historie':''}.</p>
  <table className="pit-inputs"><thead><tr><th>Složka</th><th>Hodnota</th><th>Příspěvek</th></tr></thead><tbody>{snap.parts.map(p=><tr key={p.id}><td>{p.label} <small>{p.weight} %</small></td><td className="num">{p.status==='ok'?(p.value===null?'—':cz(p.value,2)):p.missingReason}</td><td className={'num '+tone(p.contribution)}>{p.contribution===null?'—':cz(p.contribution,2)}</td></tr>)}</tbody></table>
  <div className="pit-changes"><b>Od předchozího snímku{prev?` (${dayMonthTime(prev.at)})`:''}</b>{!prev?<p>Starší snímek s jiným obsahem není uložený.</p>:changes.length?<ul>{changes.map(c=><li key={c.id}>{c.text}</li>)}</ul>:<p>Beze změny.</p>}</div>
 </div>;
}
/** Tlačítko „Proč?“ s panelem pod sebou (řízené zvenku – panel se vykresluje v řádku). */
export function WhyButton({open,onToggle,label}:{open:boolean;onToggle:()=>void;label:string}){
 return <button type="button" className={'pit-whybtn'+(open?' on':'')} aria-expanded={open} aria-label={'Proč: '+label} onClick={onToggle}>Proč?</button>;
}
/** Živý snímek vs uložený: co se změnilo „od minula“ (předchozí snímek s jiným obsahem). */
export function previousFor(live:PitSnapshot,stored:PitSnapshot|null|undefined,storedPrev:PitSnapshot|null|undefined){
 if(!stored)return null;
 return fingerprint(stored)!==fingerprint(live)?stored:storedPrev??null;
}
/** Směr páru a smíšené signály (nic se neskrývá): odznaky „pro BASE / pro QUOTE“. */
export function PairSignals({parts,market}:{parts:PitPart[];market:string}){
 const m=mixedSignals(parts,market),[b,q]=market.split('/');
 return <div className="pit-pair"><p className="pit-dir"><b>{directionText(market)}</b>{q?` · záporné = podpora ${q} vůči ${b}`:''}</p>
  <div className="pit-badges">{parts.map(p=>{const s=stance(p,market);return <span key={p.id} className={'pit-badge '+s.side} title={`${p.label}: ${p.status==='ok'&&p.value!==null?cz(p.value,2):p.missingReason||'chybí'}`}>{p.label} · {s.text}</span>})}</div>
  {m.mixed?<p className="pit-mixed">Smíšené signály: pro {b} {m.pro.join(', ')} ({cz(m.proPts,1)} b.) · {q?`pro ${q}`:'proti'} {m.proti.join(', ')} (−{Math.abs(m.protiPts).toLocaleString('cs-CZ',{maximumFractionDigits:1})} b.)</p>:<p className="pit-mixed">Složky se směrem shodují{m.pro.length?` (pro ${b})`:m.proti.length?` (${q?'pro '+q:'proti '+b})`:''}.</p>}
 </div>;
}
/** Karta měny: složky jen pro tuto měnu, horizonty odděleně (trend D1, makro měsíčně, pozice týdně, sezonalita měsíc). */
export function CurrencyCard({c,groups}:{c:string;groups:CurrencyGroup[]}){
 return <section className="s-card pit-ccard" aria-labelledby={'cc-'+c}><div className="sb-head"><h2 id={'cc-'+c}>Karta měny {c}</h2><span className="s-badge">vlastní čísla {c} · složka indexu = průměr 7 párů</span></div>
  <p className="pit-dir"><b>{directionText(c)}</b> · horizonty se nesčítají dohromady, každá skupina má vlastní časové okno.</p>
  <div className="pit-cgrid">{groups.map(g=><div key={g.id} className="pit-cgroup"><h3>{g.label}<small>{g.horizon}</small></h3>
   {g.rows.map(r=><div key={r.id} className="pit-crow"><span className="pit-clabel">{r.label}<small>{[r.period,r.source].filter(Boolean).join(' · ')}{r.url&&<> · <a href={r.url} target="_blank" rel="noreferrer">↗</a></>}</small></span><span className="pit-cown">{r.own}</span><span className={'pit-cidx '+tone(r.index)} title="Složka indexu −2…+2 (průměr párů)">{r.index===null?(r.indexStatus||'—'):cz(r.index,2)}</span></div>)}
  </div>)}</div></section>;
}

// ---------- graf historie ----------
const WIN:WindowKey[]=['1D','1W','1M','3M','1R'];
type HistResp={source:'db'|'history';daily:boolean;snapshots:PitSnapshot[]};
type LegacyHistory=Parameters<typeof fromHistory>[0];
/** Historie skóre s vysvětlením každé změny (najetí / klik), okna 1D–1R a značky změn metodiky. */
export function PitHistory({market,fallback}:{market:string;fallback:LegacyHistory}){
 const [w,setW]=useState<WindowKey>('1M'),[res,setRes]=useState<HistResp|null>(null),[err,setErr]=useState(''),[sel,setSel]=useState<number|null>(null);
 useEffect(()=>{let gone=false;
  fetch(`/api/scores/history?market=${encodeURIComponent(market)}&window=${w}`,{cache:'no-store'}).then(async r=>{const j=await r.json() as HistResp&{error?:string};if(!r.ok)throw Error(j.error||'Historii se nepodařilo načíst.');if(!gone){setRes(j);setErr('')}})
   .catch(e=>{if(gone)return;setErr((e as Error).message);const all=fromHistory(fallback,[market]),from=Date.now()-({'1D':1,'1W':7,'1M':31,'3M':92,'1R':366}[w])*86400000;setRes({source:'history',daily:false,snapshots:all.filter(s=>Date.parse(s.at)>=from)})});
  return()=>{gone=true}},[market,w,fallback]);
 const rows=res?.snapshots||[],t0=rows.length?Date.parse(rows[0].at):0,t1=rows.length?Date.parse(rows.at(-1)!.at):1,span=Math.max(t1-t0,1);
 const X=(at:string)=>rows.length===1?415:48+(Date.parse(at)-t0)/span*740,Y=(v:number)=>110-v*.8;
 const marks=methodChanges(rows),idx=sel===null?rows.length-1:Math.min(sel,rows.length-1),cur=rows[idx],prev=idx>0?rows[idx-1]:null;
 const changes:PitChange[]=cur&&prev?diffSnapshots(prev,cur):[];
 const ref=useRef<SVGSVGElement>(null);
 const move=(e:React.MouseEvent<SVGSVGElement>)=>{if(!rows.length||!ref.current)return;const b=ref.current.getBoundingClientRect(),vx=(e.clientX-b.left)/b.width*820;let best=0,dist=Infinity;rows.forEach((r,i)=>{const d=Math.abs(X(r.at)-vx);if(d<dist){dist=d;best=i}});setSel(best)};
 return <section className="s-card n-history pit-hist"><div className="s-card-head"><div><span className="s-kicker">AUDIT SKÓRE</span><h2>Historie a důvody změn</h2></div>
  <div className="pit-wins" role="tablist" aria-label="Okno historie">{WIN.map(k=><button key={k} type="button" role="tab" aria-selected={w===k} className={w===k?'on':''} onClick={()=>{setW(k);setSel(null)}}>{k}</button>)}</div></div>
  {err&&res?.source==='history'&&<p className="pit-note">Uložené snímky nejsou dostupné ({err}) – graf ukazuje zálohu z historie.</p>}
  <svg ref={ref} viewBox="0 0 820 235" role="img" aria-label={'Historie skóre '+market} onMouseMove={move} onClick={move}>
   {[-100,-50,0,50,100].map(v=><g key={v}><line x1="48" x2="795" y1={Y(v)} y2={Y(v)} className="pit-grid" strokeDasharray={v===0?'4 4':undefined}/><text x="36" y={Y(v)+4} textAnchor="end" className="pit-axis">{v}</text></g>)}
   {rows.slice(1).map((r,i)=>{const a=rows[i];return a.score!==null&&r.score!==null&&a.method===r.method?<polyline key={r.at} points={`${X(a.at)},${Y(a.score)} ${X(r.at)},${Y(a.score)} ${X(r.at)},${Y(r.score)}`} className="pit-line"/>:null})}
   {marks.map(m=><g key={m.at} pointerEvents="none"><line x1={X(m.at)} x2={X(m.at)} y1="20" y2="194" className="pit-mark"/><text x={X(m.at)>620?X(m.at)-6:X(m.at)+6} y="28" textAnchor={X(m.at)>620?'end':'start'} className="pit-axis">{m.from} → {m.to}</text></g>)}
   {rows.map((r,i)=>r.score===null?null:<circle key={r.at} cx={X(r.at)} cy={Y(r.score)} r={idx===i?7:4.5} className={'pit-dot'+(r.reconstructed?' rec':'')} tabIndex={0} role="button" aria-label={`${dayMonthTime(r.at)}, skóre ${cz(r.score,1)}`} onFocus={()=>setSel(i)}/>)}
   <text x="48" y="225" className="pit-axis">{rows[0]?dayMonthTime(rows[0].at):'Zatím bez záznamu'}</text><text x="790" y="225" textAnchor="end" className="pit-axis">{rows.length>1?dayMonthTime(rows.at(-1)!.at):''}</text>
  </svg>
  <div className="n-history-note" aria-live="polite">{cur?<><b>{dayMonthTime(cur.at)} · {cz(cur.score,1)} bodů{prev&&cur.score!==null&&prev.score!==null?` (${cz(Math.round((cur.score-prev.score)*10)/10,1)})`:''}</b><small> · {cur.method}{cur.version!==cur.method?' '+cur.version:''}{cur.reconstructed?' · rekonstruováno z historie':''}</small>
   {!prev?<p>První bod v okně – předchozí stav je před začátkem okna.</p>:changes.length?<ul className="pit-chlist">{changes.map(c=><li key={c.id}>{c.text}</li>)}</ul>:<p>Beze změny složek.</p>}</>:<p>{res?'Pro toto okno není uložený žádný snímek.':'Načítám…'}</p>}</div>
  <small>{res?.daily?'Delší okno: kanonické denní snímky (první snímek dne). ':''}Body jsou jen okamžiky změny; chybějící skóre se nenahrazuje nulou. Svislá čára = změna metodiky. Prázdné kolečko = rekonstruováno z historie.</small>
 </section>;
}

// ---------- skóre v době vstupu / při založení ----------
/** Malá karta „skóre v době …“ ze snímku ≤ t (Deník: vstup obchodu, scénáře: založení). */
export function ScoreAt({market,t,title}:{market:string|null;t:number;title:string}){
 const {res,error,loading}=useScoresAt(t,market?[market]:null,!!market),[open,setOpen]=useState(false);
 const snap=market?res?.snapshots[market]:null;
 const m=useMemo(()=>snap&&market?mixedSignals(snap.parts,market):null,[snap,market]);
 if(!market)return null;
 return <div className="pit-at"><div className="pit-at-head"><b>{title}</b>{loading?<span>načítám…</span>:error?<span>{error}</span>:!snap?<span>Pro tento čas není uložený snímek skóre.</span>:<>
  <strong className={tone(snap.score)}>{cz(snap.score,1)}</strong><span>{snap.score===null?'pozastaveno':snap.score>0?'bullish':snap.score<0?'bearish':'vyrovnané'} · snímek {dayMonthTime(snap.at)}{snap.reconstructed?' · rekonstruováno':''}</span>
  <WhyButton open={open} onToggle={()=>setOpen(o=>!o)} label={title}/></>}</div>
  {snap&&m&&market.includes('/')&&<small className="pit-dir">{directionText(market)}{m.mixed?` · smíšené: pro ${m.pro.join(', ')} · proti ${m.proti.join(', ')}`:''}</small>}
  {open&&snap&&<ScoreWhy snap={snap} prev={res?.previous[market]} onClose={()=>setOpen(false)}/>}
 </div>;
}
