'use client';
import {useState} from 'react';
import type {JournalTrade} from '@/lib/journal/types';
import {bySession,byMarketType,heatmap,holdStats,insights,noEntryCount,SESSIONS,WEEKDAYS} from '@/lib/journal/analytics';
import {fmtMoney} from '@/lib/trades';
import {fmtHold,fmtNum,fmtR,plural} from '@/lib/journal/format';
const OBCH=['obchod','obchody','obchodů'] as const;
const cls=(n:number)=>n>0?'pos':n<0?'neg':'';
function BucketTable({title,rows,currency,first}:{title:string;rows:ReturnType<typeof bySession>;currency:string;first:string}){
 const maxAbs=Math.max(1,...rows.map(g=>Math.abs(g.total)));
 return <section className="j-card"><h2>{title}</h2>
  <table className="j-table j-break"><thead><tr><th>{first}</th><th>Obchody</th><th>Win rate</th><th>Celkem</th><th>Prům. R</th><th aria-hidden="true"/></tr></thead>
   <tbody>{rows.map(g=><tr key={g.key}><td data-l="Skupina"><b>{g.label}</b>{g.hint&&<small className="j-hint"> {g.hint}</small>}</td><td data-l="Obchody">{g.count}</td><td data-l="Win rate">{g.winRate===null?'–':fmtNum(g.winRate,1)+' %'}</td><td data-l="Celkem" className={cls(g.total)}>{g.count?fmtMoney(g.total,currency):'–'}</td><td data-l="Prům. R">{fmtR(g.avgR)}</td><td className="j-barcell" aria-hidden="true"><span className={g.total>=0?'pos':'neg'} style={{width:Math.abs(g.total)/maxAbs*100+'%'}}/></td></tr>)}</tbody></table>
 </section>;
}
function Heat({trades,currency}:{trades:JournalTrade[];currency:string}){
 const [mode,setMode]=useState<'count'|'pnl'>('count'),[by,setBy]=useState<'entry'|'exit'>('entry'),[act,setAct]=useState<[number,number]|null>(null);
 const {cells,maxCount,maxAbs}=heatmap(trades,by);
 const label=(d:number,h:number)=>{const c=cells[d][h];return `${WEEKDAYS[d]} ${String(h).padStart(2,'0')}:00 · ${c.count} ${plural(c.count,OBCH)}${c.count?' · '+fmtMoney(c.total,currency):''}`};
 const bg=(c:{count:number;total:number})=>{
  if(!c.count)return undefined;
  if(mode==='count')return `color-mix(in srgb, var(--t-brand) ${Math.round(14+66*c.count/maxCount)}%, transparent)`;
  if(!c.total)return 'var(--t-surface-3)';
  return `color-mix(in srgb, var(${c.total>0?'--bull':'--bear'}) ${Math.round(14+66*Math.abs(c.total)/maxAbs)}%, transparent)`;
 };
 return <section className="j-card"><div className="j-bhead"><h2>Heatmapa {by==='entry'?'vstupů':'výstupů'}</h2><div className="j-heatctl"><div className="j-tabs small" role="tablist" aria-label="Vstupy nebo výstupy">{([['entry','Vstupy'],['exit','Výstupy']] as const).map(([k,l])=><button key={k} type="button" role="tab" aria-selected={by===k} className={by===k?'active':''} onClick={()=>setBy(k)}>{l}</button>)}</div><div className="j-tabs small" role="tablist" aria-label="Zobrazení heatmapy">{([['count','Počet'],['pnl','P&L']] as const).map(([k,l])=><button key={k} type="button" role="tab" aria-selected={mode===k} className={mode===k?'active':''} onClick={()=>setMode(k)}>{l}</button>)}</div></div></div>
  <div className="j-heatscroll"><div className="j-heat" role="grid" aria-label={'Obchody podle dne a hodiny '+(by==='entry'?'vstupu':'výstupu')}>
   <div className="j-heatrow" role="row"><span className="j-heatday"/>{Array.from({length:24},(_,h)=><span key={h} className="j-heathour" role="columnheader">{h%3===0?String(h).padStart(2,'0'):''}</span>)}</div>
   {cells.map((row,d)=><div className="j-heatrow" role="row" key={d}><span className="j-heatday" role="rowheader">{WEEKDAYS[d]}</span>{row.map((c,h)=><span role="gridcell" key={h}><button type="button" className={'j-heatcell'+(c.count?'':' empty')+(act&&act[0]===d&&act[1]===h?' on':'')} style={{background:bg(c)}} aria-label={label(d,h)} title={label(d,h)} onMouseEnter={()=>setAct([d,h])} onMouseLeave={()=>setAct(null)} onFocus={()=>setAct([d,h])} onBlur={()=>setAct(null)} onClick={()=>setAct([d,h])}/></span>)}</div>)}
  </div></div>
  <p className="j-heattip" role="status">{act?label(act[0],act[1]):'Najeď na buňku (nebo ji vyber klávesnicí) pro detail.'}</p>
 </section>;
}
export function AnalyticsView({trades,currency}:{trades:JournalTrade[];currency:string}){
 const noTime=noEntryCount(trades),tips=insights(trades,currency),hold=holdStats(trades),holdMax=Math.max(1,...hold.buckets.map(b=>Math.abs(b.total))),held=hold.winners.count+hold.losers.count;
 const side=(n:string,s:typeof hold.winners)=>s.count?`${n} ${fmtHold(s.avgMs)} (medián ${fmtHold(s.medianMs)})`:null;
 const w=side('Ziskové držíš',hold.winners),l=side('ztrátové',hold.losers);
 return <div className="j-analytics">
  <div><h2 className="j-sectitle">Kdy a jak obchoduju</h2>
   {noTime>0&&<p className="j-muted">{noTime} {plural(noTime,['ruční obchod','ruční obchody','ručních obchodů'])} bez času vstupu se nepočítá do seancí, heatmapy ani doby držení.</p>}</div>
  <section className="j-card j-insights"><h2>Postřehy</h2>
   {tips.length?<ul>{tips.map(t=><li key={t}>{t}</li>)}</ul>:<p className="j-muted">Na postřehy zatím chybí data – potřebuju aspoň 5 obchodů ve skupině (seance, typ trhu, den a čas).</p>}
  </section>
  <BucketTable title="Podle seance" rows={bySession(trades)} currency={currency} first="Seance"/>
  <p className="j-muted j-legend">Čas vstupu v Praze: {SESSIONS.map(s=>`${s.label} ${s.hint.replace('-','–')}`).join(' · ')}. Překryv se počítá jen jako Překryv.</p>
  <BucketTable title="Podle typu trhu" rows={byMarketType(trades)} currency={currency} first="Trh"/>
  <Heat trades={trades} currency={currency}/>
  <section className="j-card"><h2>Doba držení</h2>
   {held?<><p className="j-holdsum">{[w,l].filter(Boolean).join(', ')||'–'}.</p>
    <div className="j-holdbars">{hold.buckets.map(b=><div key={b.label} className="j-holdrow"><span>{b.label}</span><span className="j-holdbar" aria-hidden="true"><i className={b.total>=0?'pos':'neg'} style={{width:Math.abs(b.total)/holdMax*100+'%'}}/></span><span>{b.count} {plural(b.count,OBCH)}</span><b className={cls(b.total)}>{b.count?fmtMoney(b.total,currency):'–'}</b></div>)}</div></>
   :<p className="j-muted">Dobu držení mají jen obchody z MetaTraderu.</p>}
  </section>
 </div>;
}
