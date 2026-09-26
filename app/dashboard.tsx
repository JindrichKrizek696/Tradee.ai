'use client';
import {CalendarDays,TrendingUp,TrendingDown,Target,Gauge,Flag,Check,Clock,AlertTriangle,ChevronRight,Activity} from 'lucide-react';
import type {FundamentalData} from '@/lib/fundamentals';
import type {MarketData} from '@/lib/score-engine';
import {flagLabels} from '@/lib/markets';
import {TradeCalendar} from './trade-calendar';
import type {View} from './shell';
import {greeting,vocative,kpis,bullishTrail,bearishTrail,dataHealth,recentChanges,upcomingEvents,importanceLabel,type Row,type HistoryLike} from '@/lib/dashboard';
const fmt=(n:number|null,d=1)=>n===null?'—':(n>0?'+':'')+n.toLocaleString('cs-CZ',{maximumFractionDigits:d});
const time=(s:string)=>new Date(s).toLocaleTimeString('cs-CZ',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit'});
const day=(s:string)=>new Date(s).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'short'});

function Spark({values,color='#245bff'}:{values:number[];color?:string}){
 if(values.length<2)return <svg className="t-viz" viewBox="0 0 64 40" aria-hidden="true"/>;
 const max=Math.max(...values,1),min=Math.min(...values,0),pts=values.map((v,i)=>[4+i/(values.length-1)*56,34-(v-min)/(max-min||1)*28] as const);
 const d=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
 return <svg className="t-viz" viewBox="0 0 64 40" aria-hidden="true"><path d={`${d} L${pts[pts.length-1][0].toFixed(1)} 38 L4 38 Z`} fill={color} opacity=".12"/><path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function Ring({pct,color='#245bff'}:{pct:number;color?:string}){const r=15,c=2*Math.PI*r;return <svg className="t-viz" viewBox="0 0 64 40" aria-hidden="true"><circle cx="32" cy="20" r={r} fill="none" stroke="#eef1f7" strokeWidth="6"/><circle cx="32" cy="20" r={r} fill="none" stroke={color} strokeWidth="6" strokeDasharray={`${c*Math.max(0,Math.min(100,pct))/100} ${c}`} strokeLinecap="round" transform="rotate(-90 32 20)"/></svg>}
function Bars({values,colors}:{values:number[];colors:string[]}){const max=Math.max(...values,1);return <svg className="t-viz" viewBox="0 0 64 40" aria-hidden="true">{values.map((v,i)=><rect key={i} x={10+i*16} y={36-v/max*30} width="10" height={v/max*30+1} rx="3" fill={colors[i]} opacity={v?1:.25}/>)}</svg>}


export function Dashboard({rows,flags,history,data,market,now,userName,open,setView}:{rows:Row[];flags:Record<string,string>;history:HistoryLike;data:FundamentalData;market:MarketData;now:number;userName:string;open:(id:string)=>void;setView:(v:View)=>void}){
 const k=kpis(rows,flags),flagged=rows.filter(r=>flags[r.id]&&flags[r.id]!=='none');
 const health=dataHealth(data,market,now),changes=recentChanges(history,5),events=upcomingEvents(data,now,5);
 const trend=(r:Row):[string,string]=>{const t=r.r.parts.find(p=>p.id==='trend')?.signal;const v=r.r.price?.trend??0;return t===null||t===undefined?['','Neověřen']:v>0?['up','Bullish']:v<0?['down','Bearish']:['','Neutrální']};
 const strongestUp=!!k.strongest&&(k.strongest.r.score as number)>0;
 const today=new Date(now).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',weekday:'short',day:'numeric',month:'short',year:'numeric'});
 return <div className="t-dash">
  <section className="t-hero">
   <div><span className="t-greet">{greeting(new Date(now))},</span><h1>{vocative(userName)} 👋</h1><p>Disciplína dnes. Svoboda zítra.</p></div>
   <svg className="t-hero-line" viewBox="0 0 1200 130" preserveAspectRatio="none" aria-hidden="true"><path d="M0 115 C150 105 250 70 400 78 S650 40 800 52 S1050 25 1200 12 V130 H0 Z" fill="#245bff" fillOpacity=".07"/><path d="M0 115 C150 105 250 70 400 78 S650 40 800 52 S1050 25 1200 12" fill="none" stroke="#245bff" strokeOpacity=".35" strokeWidth="2"/></svg>
   <img className="t-hero-img" src="/brand/mascots-pair.png" alt=""/>
   <div className="t-date"><CalendarDays size={20}/><div><small>Dnes</small><b>{today}</b></div></div>
  </section>
  <section className="t-kpis">
   <div className="t-kpi"><div className="t-kpi-icon"><TrendingUp size={18}/></div><div><span>Bullish trhy</span><b>{k.bullish}</b><small className="up">z {k.scored} se skóre</small></div><Spark values={bullishTrail(history)} color="#16a34a"/></div>
   <div className="t-kpi"><div className="t-kpi-icon"><TrendingDown size={18}/></div><div><span>Bearish trhy</span><b>{k.bearish}</b><small className="down">z {k.scored} se skóre</small></div><Spark values={bearishTrail(history)} color="#dc2626"/></div>
   <button className="t-kpi" onClick={()=>k.strongest&&open(k.strongest.id)} disabled={!k.strongest}><div className="t-kpi-icon"><Target size={18}/></div><div><span>Nejsilnější signál</span><b className={strongestUp?'up':'down'}>{k.strongest?fmt(k.strongest.r.score):'—'}</b><small>{k.strongest?.name||'Bez dat'}</small></div><Ring pct={k.strongest?Math.abs(k.strongest.r.score as number):0} color={strongestUp?'#16a34a':'#dc2626'}/></button>
   <div className="t-kpi"><div className="t-kpi-icon"><Gauge size={18}/></div><div><span>Čerstvost podkladů</span><b>{k.freshness} %</b><small>trhů s plným pokrytím</small></div><Ring pct={k.freshness}/></div>
   <button className="t-kpi" onClick={()=>setView('analyzer')}><div className="t-kpi-icon"><Flag size={18}/></div><div><span>Moje vlaječky</span><b>{k.flagged}</b><small className="up">{k.inTrade} v tradu</small></div><Bars values={[k.waiting,k.looking,k.inTrade]} colors={['#d23e4e','#d38a19','#188557']}/></button>
  </section>
  <section className="t-row">
   <TradeCalendar now={now}/>
   <div className="t-card">
    <div className="t-card-head"><h2>Moje vlaječky</h2><button className="t-link" onClick={()=>setView('analyzer')}>Zobrazit vše <ChevronRight size={14}/></button></div>
    <div className="t-mini"><div><span>Sleduji</span><b>{k.flagged}</b></div><div><span>V tradu</span><b className="up">{k.inTrade}</b></div><div><span>Vyhlížím</span><b>{k.looking}</b></div><div><span>Čekám</span><b className="down">{k.waiting}</b></div></div>
    {flagged.length?<table className="t-table"><thead><tr><th>Trh</th><th>Skóre</th><th>Trend</th><th>Vlaječka</th></tr></thead><tbody>{flagged.slice(0,8).map(r=>{const [cls,label]=trend(r);return <tr key={r.id} className="click" onClick={()=>open(r.id)}><td><b>{r.name}</b></td><td className={r.r.score===null?'':(r.r.score>0?'up':'down')}><b>{fmt(r.r.score)}</b></td><td><span className={'t-chip '+cls}>{label}</span></td><td><span className={'t-chip flag-'+flags[r.id]}>{flagLabels[flags[r.id]]}</span></td></tr>})}</tbody></table>:<div className="t-empty">Zatím žádné vlaječky. Označ trhy v Analýze trhů.</div>}
   </div>
  </section>
  <section className="t-row3">
   <div className="t-card"><div className="t-card-head"><h2>Stav podkladů</h2><span className="t-val">kontrola každé 4 h</span></div><div className="t-list">{health.map(h=><div key={h.label}><span className={'t-check'+(h.ok?'':' warn')}>{h.ok?<Check size={14}/>:<AlertTriangle size={14}/>}</span><div><b>{h.label}</b><small>{h.detail}</small></div><div className="t-right"><span className="t-bar"><i className={h.ok?'':'warn'} style={{width:h.usage+'%'}}/></span><span className="t-val">{h.usage} %</span></div></div>)}</div></div>
   <div className="t-card"><div className="t-card-head"><h2>Poslední změny</h2><span className="t-val">{history.snapshots.length} snímků</span></div><div className="t-list">{changes.length?changes.map(c=><div key={c.instrument}><span className={'t-check'+(c.delta>0?'':c.delta<0?' warn':' muted')}><Activity size={14}/></span><div><b>{rows.find(r=>r.id===c.instrument)?.name||c.instrument}</b><small>{fmt(c.from)} → {fmt(c.to)} · {day(c.at)}</small></div><span className={'t-val '+(c.delta>0?'up':c.delta<0?'down':'')}>{fmt(c.delta)}</span></div>):<div className="t-empty">Skóre se od posledního snímku nezměnilo.</div>}{data.changes.slice(-2).reverse().map(c=><div key={c.at}><span className="t-check muted"><Clock size={14}/></span><div><b>{c.title}</b><small>{day(c.at)} · {c.body}</small></div><span/></div>)}</div></div>
   <div className="t-card"><div className="t-card-head"><h2>Kalendář</h2><button className="t-link" onClick={()=>setView('calendar')}>Zobrazit vše <ChevronRight size={14}/></button></div><div className="t-list">{events.length?events.map(e=>{const [cls,label]=importanceLabel(e.importance);return <div key={e.id}><span className="t-time">{e.timeKnown?time(e.at):'—'}<small>{day(e.at)}</small></span><div><b>{e.title}<span className="t-ccy">{e.currency}</span></b><small>{e.watch}</small></div><span className={'t-badge '+cls}>{label}</span></div>}):<div className="t-empty">Žádné nadcházející události.</div>}</div></div>
  </section>
 </div>;
}
