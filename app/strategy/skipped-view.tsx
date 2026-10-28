'use client';
// Deník: časová osa vynechaných obchodů a stavů dne (záložka „Vynechané“) a karta dodržování plánu ve Statistikách.
import {useEffect,useMemo,useState} from 'react';
import {Ban,PauseCircle} from 'lucide-react';
import {instruments} from '@/lib/markets';
import {SKIP_REASONS,DAY_STATUSES,BIASES,planStats,timeline,type SkipReason,type DayStatus} from '@/lib/strategy/scenario';
import type {Eval,PlanSnapshot} from '@/lib/strategy/core';
import {call,dtText,pragueDay,SnapshotView} from './plan-ui';
type NoTrade={id:string;scenarioId:string|null;instrument:string|null;direction:'long'|'short'|null;reason:SkipReason;note:string;snapshot:PlanSnapshot|null;at:number};
type Day={day:string;status:DayStatus;note:string};
type Data={noTrades:NoTrade[];days:Day[];plans?:{tradeId:string;eval:Eval|null}[]};
const NAME=new Map(instruments.map(i=>[i.id,i.name]));
const inRange=(day:string,from:string,to:string)=>day>=from&&day<=to;
function useData(from:string,to:string,query:string,plans:boolean){
 const [d,setD]=useState<Data|null>(null),[err,setErr]=useState('');
 useEffect(()=>{let live=true;const q=new URLSearchParams({from,to,...(plans?{plans:'1'}:{})});const as=new URLSearchParams(query.replace(/^\?/,'')).get('as');if(as)q.set('as',as);
  call<Data>('/api/no-trades?'+q).then(j=>{if(live){setD(j);setErr('')}}).catch(e=>{if(live)setErr((e as Error).message)});return()=>{live=false}},[from,to,query,plans]);
 // API vrací o den širší okno (hranice dne podle Prahy) → ořez na pražské dny
 const data=useMemo(()=>d&&{...d,noTrades:d.noTrades.filter(n=>inRange(pragueDay(n.at),from,to)),days:d.days.filter(x=>inRange(x.day,from,to))},[d,from,to]);
 return {data,err};
}
export function SkippedTimeline({from,to,query='',readOnly}:{from:string;to:string;query?:string;readOnly?:boolean}){
 const {data,err}=useData(from,to,query,false),[open,setOpen]=useState<string|null>(null);
 const tl=useMemo(()=>data?timeline(data.noTrades,data.days,pragueDay):[],[data]);
 if(err)return <p role="alert" className="s-notice">{err}</p>;
 if(!data)return <p className="j-muted">Načítám…</p>;
 return <div className="j-card sg-timeline">
  {!readOnly&&<p className="j-muted">Vynechaný obchod a stav dne zapíšeš na stránce <a href="/scenare">Scénáře</a>. Bez P&amp;L – počítá se do dodržování plánu.</p>}
  {!tl.length?<p className="j-muted">V tomto období žádný vynechaný obchod ani stav dne.</p>:<ol>{tl.map(t=><li key={t.day}><div className="sg-tl-day"><time>{new Date(t.day+'T12:00:00Z').toLocaleDateString('cs-CZ',{weekday:'short',day:'numeric',month:'numeric',year:'numeric'})}</time>{t.status&&<span className={'sg-daytag '+t.status}><PauseCircle size={12}/>{DAY_STATUSES[t.status]}</span>}{t.dayNote&&<small>{t.dayNote}</small>}</div>
   {t.items.length>0&&<ul>{t.items.map(n=><li key={n.id}><button type="button" className="sg-tl-item" aria-expanded={open===n.id} onClick={()=>setOpen(open===n.id?null:n.id)}><Ban size={13}/><b>{SKIP_REASONS[n.reason]}</b><span>{n.instrument?NAME.get(n.instrument)||n.instrument:'bez trhu'}{n.direction?' · '+BIASES[n.direction]:''}</span><small>{dtText(n.at).split(' ').slice(-1)[0]}</small>{n.snapshot&&<span className={'sg-mini '+n.snapshot.eval.verdict}>{n.snapshot.strategyName} v{n.snapshot.version}</span>}</button>
    {open===n.id&&<div className="sg-tl-detail">{n.note&&<p>{n.note}</p>}{n.snapshot&&<SnapshotView snap={n.snapshot}/>}{n.scenarioId&&!readOnly&&<a href={'/scenare#'+n.scenarioId}>Otevřít scénář</a>}</div>}</li>)}</ul>}</li>)}</ol>}
 </div>;
}
export function PlanStatsCard({from,to,tradeIds,query=''}:{from:string;to:string;tradeIds:string[];query?:string}){
 const {data,err}=useData(from,to,query,true);
 const st=useMemo(()=>{if(!data)return null;const ids=new Set(tradeIds);return planStats(data.noTrades,data.days,(data.plans||[]).filter(p=>ids.has(p.tradeId)))},[data,tradeIds]);
 if(err||!st)return null;
 return <section className="j-card sg-pstats"><h2>Plán a vynechané obchody</h2>
  <dl className="j-dl">
   <div><dt>Dodržení plánu</dt><dd className={st.adherence===null?'':st.adherence>=80?'pos':st.adherence<60?'neg':''}>{st.adherence===null?'–':st.adherence+' %'}</dd></div>
   <div><dt>Obchody s plánem</dt><dd>{st.plans}{st.broken?` · ${st.broken} s nesplněnou povinnou`:''}</dd></div>
   <div><dt>Vynechané setupy</dt><dd>{st.count}{st.skipsOnRule?` · ${st.skipsOnRule} kvůli pravidlu`:''}</dd></div>
   <div><dt>Dny bez obchodu</dt><dd>{(Object.keys(DAY_STATUSES) as DayStatus[]).map(k=>`${DAY_STATUSES[k]} ${st.days[k]}`).join(' · ')}</dd></div>
  </dl>
  {st.count>0&&<ul className="sg-reasons">{(Object.keys(SKIP_REASONS) as SkipReason[]).filter(k=>st.byReason[k]).map(k=><li key={k}><span>{SKIP_REASONS[k]}</span><i style={{width:Math.round(st.byReason[k]/st.count*100)+'%'}}/><b>{st.byReason[k]}</b></li>)}</ul>}
  <small className="j-muted">Dodržení = obchody s checklistem bez nesplněné povinné podmínky + vynechání kvůli nesplněné podmínce, z obou dohromady.</small>
 </section>;
}
