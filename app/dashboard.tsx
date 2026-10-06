'use client';
import {useRef,useState} from 'react';
import {CalendarDays,Check,Clock,AlertTriangle,ChevronRight,Activity,Flag,Globe2,DatabaseZap,LineChart} from 'lucide-react';
import type {FundamentalData} from '@/lib/fundamentals';
import type {MarketData} from '@/lib/score-engine';
import {groups} from '@/lib/markets';
import {TradeCalendar,useTrades,months,todayIso,plural} from './trade-calendar';
import {EventRow} from './calendar';
import {upcomingCalendar,flaggedMarkets,relative as until,type CalendarEvent} from '@/lib/calendar';
import {monthStats,monthCurve,fmtUsd} from '@/lib/trades';
import type {View} from './shell';
import {greeting,vocative,breadth,topSignals,sessions,dataHealth,recentChanges,type Row,type HistoryLike} from '@/lib/dashboard';
const fmt=(n:number|null,d=1)=>n===null?'—':(n>0?'+':'')+n.toLocaleString('cs-CZ',{maximumFractionDigits:d});
const day=(s:string)=>new Date(s).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'short'});
const time=(s:string)=>new Date(s).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',weekday:'short',hour:'2-digit',minute:'2-digit'});
const tone=(n:number|null)=>n===null||n===0?'':n>0?'up':'down';
const FLAGS=['green','orange','red'],FLAG_SHORT:Record<string,string>={green:'V tradu',orange:'Vyhlížím',red:'Čekám'};
const SIGNAL_GROUPS=['fx','currency','index','crypto','stock'];

function Curve({values,height=40}:{values:number[];height?:number}){
 if(values.length<2)return null;
 const w=200,max=Math.max(...values,0),min=Math.min(...values,0),y=(v:number)=>3+(max-v)/((max-min)||1)*(height-6),x=(i:number)=>i/(values.length-1)*w;
 const d=values.map((v,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1)).join(' '),color=(values.at(-1) as number)>=0?'var(--bull)':'var(--bear)';
 return <svg className="d-curve" viewBox={`0 0 ${w} ${height}`} style={{height}} preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2={w} y1={y(0)} y2={y(0)} className="d-zero" vectorEffect="non-scaling-stroke"/><path d={`${d} L${w} ${y(0).toFixed(1)} L0 ${y(0).toFixed(1)} Z`} style={{fill:color}} opacity=".12"/><path d={d} fill="none" style={{stroke:color}} strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/></svg>;
}
// Vodorovná lišta od středové nuly; scale = hodnota odpovídající plné polovině.
const Diverge=({v,scale}:{v:number;scale:number})=><span className="d-div"><i className={v>=0?'pos':'neg'} style={{width:Math.min(50,Math.abs(v)/scale*50)+'%'}}/></span>;

// Lišta zapuštěná do okraje okna: v klidu vystupuje jen úzký pruh s ikonami, po najetí se roztáhne.
function Notch({side,label,rail,children}:{side:'left'|'right';label:string;rail:React.ReactNode;children:React.ReactNode}){
 const ref=useRef<HTMLElement>(null),inner=useRef<HTMLDivElement>(null);
 // Rozbalená výška podle obsahu (CSS ji omezí výškou okna), aby pod krátkým seznamem nezůstávalo prázdné místo.
 const measure=()=>{if(ref.current&&inner.current)ref.current.style.setProperty('--open-h',inner.current.offsetHeight+'px')};
 return <aside ref={ref} className={'d-notch '+side} tabIndex={0} aria-label={label} onPointerEnter={measure} onFocus={measure}><div className="d-notch-clip"><div className="d-notch-rail" aria-hidden="true">{rail}</div><div className="d-notch-panel"><div ref={inner} className="d-notch-inner">{children}</div></div></div></aside>;
}

export function Dashboard({rows,flags,history,data,market,now,userName,open,setView,calendar,flagsReady}:{calendar:CalendarEvent[];rows:Row[];flags:Record<string,string>;history:HistoryLike;data:FundamentalData;market:MarketData;now:number;userName:string;open:(id:string)=>void;setView:(v:View)=>void;flagsReady:boolean}){
 const {trades,error:tradeError,ready:tradesReady,load:reloadTrades}=useTrades();
 const [group,setGroup]=useState('all');
 const b=breadth(rows),sess=sessions(now),health=dataHealth(data,market,now),changes=recentChanges(history,5),mine=flaggedMarkets(flags);
 const events=upcomingCalendar(calendar,now,6),next=events.find(e=>Date.parse(e.at)>=now&&(e.signal===3||e.global))||events.find(e=>Date.parse(e.at)>=now);
 const today=todayIso(now),y=Number(today.slice(0,4)),mo=Number(today.slice(5,7)),stats=monthStats(trades,y,mo),curve=monthCurve(trades,y,mo,today);
 const signalGroups=SIGNAL_GROUPS.filter(g=>rows.some(r=>r.group===g&&r.r.score)),top=topSignals(group==='all'?rows:rows.filter(r=>r.group===group),6),best=topSignals(rows,1);
 const ccy=rows.filter(r=>r.group==='currency'&&r.r.score!==null).sort((a,c)=>(c.r.score as number)-(a.r.score as number)),ccyScale=Math.max(10,...ccy.map(r=>Math.abs(r.r.score as number)))*1.1;
 const watched=rows.filter(r=>FLAGS.includes(flags[r.id])).sort((a,c)=>FLAGS.indexOf(flags[a.id])-FLAGS.indexOf(flags[c.id])||a.name.localeCompare(c.name)),count=(f:string)=>watched.filter(r=>flags[r.id]===f).length;
 const okSources=health.filter(h=>h.ok).length,live=sess.list.filter(x=>x.open);
 const dateLine=new Date(now).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',weekday:'long',day:'numeric',month:'long',year:'numeric'});
 const pct=(n:number)=>b.scored?100*n/b.scored+'%':'0%';
 const signalCol=(side:'bull'|'bear')=><div className="d-sig-col"><div className="d-sig-h"><span className={'d-key '+side}/>{side==='bull'?'Long · nejvyšší skóre':'Short · nejnižší skóre'}</div>
  {top[side].length?<ol>{top[side].map((r,i)=><li key={r.id}><button type="button" onClick={()=>open(r.id)}><span className="d-rank">{i+1}</span><span className="d-name"><b>{r.name}</b><small>{groups[r.group]}</small></span>{FLAGS.includes(flags[r.id])?<span className={'d-dot '+flags[r.id]} title={FLAG_SHORT[flags[r.id]]}/>:<span/>}<span className="d-meter"><i className={side} style={{width:Math.min(100,Math.abs(r.r.score as number))+'%'}}/></span><em className={tone(r.r.score)}>{fmt(r.r.score)}</em></button></li>)}</ol>:<p className="d-empty">Žádný trh v tomto směru.</p>}</div>;
 return <div className="d-dash">
  <header className="d-pagehead">
   <div><p className="d-date">{dateLine.charAt(0).toUpperCase()+dateLine.slice(1)}</p><h1>{greeting(new Date(now))}, {vocative(userName)}</h1></div>
   <div className="d-status">
    <span className={'d-chip'+(sess.fxOpen?' live':'')}><i/>{sess.fxOpen?<>FX trh otevřený{live.length?<> · {live.map(x=>x.city).join(', ')}</>:null}</>:'FX trh zavřený · víkend'}</span>
    {next&&<button type="button" className="d-chip" onClick={()=>setView('calendar')}><CalendarDays size={14}/><span>Další událost</span><b>{next.title}</b><span>{time(next.at)} · {until(next.at,now)}</span></button>}
   </div>
  </header>

  <section className="d-card d-kpis" aria-label="Souhrn">
   <div className="d-kpi">
    <span className="d-label">Šíře trhu</span>
    <div className="d-breadth"><span><img src="/brand/bull.png" alt=""/><b className="up">{b.bull}</b> bullish</span><span><img src="/brand/bear.png" alt=""/><b className="down">{b.bear}</b> bearish</span></div>
    <div className="d-stack" role="img" aria-label={`Bullish ${b.bull}, neutrální ${b.flat}, bearish ${b.bear}`}><i className="bull" style={{width:pct(b.bull)}}/><i className="flat" style={{width:pct(b.flat)}}/><i className="bear" style={{width:pct(b.bear)}}/></div>
    <small>{b.summary} · {b.scored} trhů se skóre</small>
   </div>
   {(['bull','bear'] as const).map(side=>{const r=best[side][0];return <button key={side} type="button" className="d-kpi" onClick={()=>r&&open(r.id)} disabled={!r}>
    <span className="d-label">{side==='bull'?'Nejsilnější long':'Nejsilnější short'}</span>
    <div className="d-value"><b className={tone(r?.r.score??null)}>{r?fmt(r.r.score):'—'}</b><span>{r?.name||'Bez signálu'}</span></div>
    <small>{r?groups[r.group]+' · pokrytí '+r.r.coverage+' %':'Žádné skóre v tomto směru'}</small>
   </button>})}
   <div className="d-kpi">
    <span className="d-label">P&amp;L · {months[mo-1].toLowerCase()}</span>
    <div className="d-value"><b className={tone(stats.total)}>{tradesReady&&!tradeError?fmtUsd(stats.total):'—'}</b><Curve values={curve} height={30}/></div>
    <small>{tradeError?'Deník se nepodařilo načíst':stats.count?`${stats.count} ${plural(stats.count)} · úspěšnost ${Math.round(stats.winRate)} %`:'Tento měsíc bez obchodů'}</small>
   </div>
   <div className="d-kpi">
    <span className="d-label">Podklady</span>
    <div className="d-value"><b>{okSources}<span className="d-of">/{health.length}</span></b><span>zdrojů aktuálních</span></div>
    <div className="d-seg">{health.map(h=><i key={h.label} className={h.ok?'ok':'warn'} title={h.label+' · '+h.detail}/>)}</div>
   </div>
  </section>

  <div className="d-grid">
   <section className="d-card d-signals">
    <div className="d-head"><h2>Síla signálů</h2><div className="d-tabs" role="tablist" aria-label="Skupina trhů">{['all',...signalGroups].map(g=><button key={g} type="button" role="tab" aria-selected={group===g} className={group===g?'on':''} onClick={()=>setGroup(g)}>{g==='all'?'Vše':groups[g]}</button>)}</div></div>
    <div className="d-sig-cols">{signalCol('bull')}{signalCol('bear')}</div>
    <div className="d-foot"><span>Skóre −100 až +100 · klik otevře detail trhu</span><button type="button" className="d-link" onClick={()=>setView('analyzer')}>Všechny trhy <ChevronRight size={14}/></button></div>
   </section>
   <section className="d-card d-ccy">
    <div className="d-head"><h2>Síla měn</h2><span className="d-meta">vlastní indexy</span></div>
    {ccy.length?<ul>{ccy.map(r=><li key={r.id}><button type="button" onClick={()=>open(r.id)}><b>{r.id}</b><Diverge v={r.r.score as number} scale={ccyScale}/><em className={tone(r.r.score)}>{fmt(r.r.score)}</em></button></li>)}</ul>:<p className="d-empty">Indexy měn zatím nemají skóre.</p>}
    <div className="d-foot"><span>Každá měna proti sedmi ostatním</span></div>
   </section>
   <div className="d-trades-wrap"><TradeCalendar now={now} trades={trades} ready={tradesReady} loadError={tradeError} reload={reloadTrades}/></div>
   <section className="d-card d-perf">
    <div className="d-head"><h2>Výkonnost · {months[mo-1].toLowerCase()}</h2><span className="d-meta">{stats.count} {plural(stats.count)}</span></div>
    {tradeError?<p className="d-empty">Deník obchodů se nepodařilo načíst.</p>:!tradesReady?<p className="d-empty">Načítám obchody…</p>:!stats.count?<p className="d-empty">Tento měsíc zatím bez obchodů. Zapiš je v kalendáři obchodů.</p>:<>
     <div className="d-perf-top"><b className={tone(stats.total)}>{fmtUsd(stats.total)}</b><span>kumulativně za měsíc</span></div>
     <Curve values={curve} height={120}/>
     <dl className="d-stats"><div><dt>Úspěšnost</dt><dd>{Math.round(stats.winRate)} %</dd></div><div><dt>Ziskové dny</dt><dd>{stats.greenDays} z {stats.days}</dd></div><div><dt>Průměr na obchod</dt><dd className={tone(stats.total)}>{fmtUsd(Math.round(stats.total/stats.count*100)/100)}</dd></div><div><dt>Nejlepší den</dt><dd className={tone(stats.best)}>{fmtUsd(stats.best)}</dd></div><div><dt>Nejhorší den</dt><dd className={tone(stats.worst)}>{fmtUsd(stats.worst)}</dd></div><div><dt>Obchodní dny</dt><dd>{stats.days}</dd></div></dl>
    </>}
   </section>
  </div>

  <div className="d-notches">
   <Notch side="left" label="Moje vlaječky" rail={<><Flag size={17}/>{FLAGS.map(f=><span key={f} className="d-rail-n"><i className={'d-dot '+f}/>{count(f)}</span>)}</>}>
    <div className="d-head"><h2>Moje vlaječky</h2><button type="button" className="d-link" onClick={()=>setView('analyzer')}>Analýza trhů <ChevronRight size={14}/></button></div>
    <div className="d-flagsum">{FLAGS.map(f=><div key={f}><i className={'d-dot '+f}/><b>{count(f)}</b><span>{FLAG_SHORT[f]}</span></div>)}</div>
    {watched.length?<ul className="d-rows">{watched.map(r=><li key={r.id}><button type="button" onClick={()=>open(r.id)}><span className={'d-dot '+flags[r.id]}/><span className="d-name"><b>{r.name}</b><small>{FLAG_SHORT[flags[r.id]]} · {groups[r.group]}</small></span><em className={tone(r.r.score)}>{fmt(r.r.score)}</em></button></li>)}</ul>:<p className="d-empty">{flagsReady?'Zatím žádné vlaječky. Označ trhy v Analýze trhů.':'Vlaječky teď nejsou k dispozici.'}</p>}
   </Notch>
   <Notch side="right" label="Trh teď: seance, události a podklady" rail={<><span className="d-rail-i"><Globe2 size={17}/>{sess.fxOpen&&<i className="live"/>}</span><span className="d-rail-i"><CalendarDays size={17}/>{events.length>0&&<em>{events.length}</em>}</span><span className="d-rail-i"><Activity size={17}/></span><span className="d-rail-i"><DatabaseZap size={17}/><i className={okSources===health.length?'live':'warn'}/></span></>}>
    <div className="d-head"><h2>Obchodní seance</h2><span className={'d-chip sm'+(sess.fxOpen?' live':'')}><i/>{sess.fxOpen?'FX otevřeno':'FX zavřeno'}</span></div>
    <div className="d-tl" style={{'--now':sess.nowMin/14.4+'%'} as React.CSSProperties}>
     {sess.list.map(x=><div key={x.id} className={'d-tl-row'+(x.open?' open':'')}><div className="d-tl-name"><b>{x.city}</b><small>{x.label}</small></div><div className="d-tl-track">{(x.start+x.length<=1440?[[x.start,x.length]]:[[x.start,1440-x.start],[0,x.start+x.length-1440]]).map(([a,l])=><i key={a} style={{left:a/14.4+'%',width:l/14.4+'%'}}/>)}</div></div>)}
     <div className="d-tl-axis">{[0,6,12,18,24].map(h=><span key={h}>{h}</span>)}</div>
    </div>
    <div className="d-head d-sub"><h2>Nadcházející události</h2><button type="button" className="d-link" onClick={()=>setView('calendar')}>Kalendář <ChevronRight size={14}/></button></div>
    <div className="c-list c-compact d-events">{events.length?events.map(e=><EventRow key={e.id} e={e} now={now} mine={mine} compact/>):<p className="d-empty">Žádné nadcházející události.</p>}</div>
    <div className="d-head d-sub"><h2>Poslední změny skóre</h2><span className="d-meta">{history.snapshots.length} snímků</span></div>
    <div className="d-list">{changes.length?changes.map(c=><div key={c.instrument}><LineChart size={14}/><span className="d-name"><b>{rows.find(r=>r.id===c.instrument)?.name||c.instrument}</b><small>{fmt(c.from)} → {fmt(c.to)} · {day(c.at)}</small></span><em className={tone(c.delta)}>{fmt(c.delta)}</em></div>):<p className="d-note">Od posledního snímku beze změny.</p>}{data.changes.slice(-2).reverse().map(c=><div key={c.at}><Clock size={14}/><span className="d-name"><b>{c.title}</b><small>{day(c.at)} · {c.body}</small></span><span/></div>)}</div>
    <div className="d-head d-sub"><h2>Stav podkladů</h2></div>
    <div className="d-list">{health.map(h=><div key={h.label}>{h.ok?<Check size={14} className="ok"/>:<AlertTriangle size={14} className="warn"/>}<span className="d-name"><b>{h.label}</b><small>{h.detail}</small></span><span className="d-bar"><i className={h.ok?'':'warn'} style={{width:h.usage+'%'}}/></span></div>)}</div>
   </Notch>
  </div>
 </div>;
}
