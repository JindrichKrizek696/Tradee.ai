'use client';
import {useId,useRef,useState} from 'react';
import {CalendarDays,Check,Clock,AlertTriangle,ChevronRight,Activity,Flag,Globe2,DatabaseZap,LineChart,ArrowUpRight,ArrowDownRight} from 'lucide-react';
import type {FundamentalData} from '@/lib/fundamentals';
import type {MarketData} from '@/lib/score-engine';
import {groups} from '@/lib/markets';
import {TradeCalendar,useTrades,months,todayIso,plural} from './trade-calendar';
import {EventRow} from './calendar';
import {upcomingCalendar,flaggedMarkets,relative as until,type CalendarEvent} from '@/lib/calendar';
import {monthStats,monthCurve,fmtUsd} from '@/lib/trades';
import type {View} from './shell';
import {greeting,vocative,breadth,topSignals,sessions,dataHealth,recentChanges,scoreSeries,bullishTrail,bearishTrail,type Row,type HistoryLike} from '@/lib/dashboard';
const fmt=(n:number|null,d=1)=>n===null?'—':(n>0?'+':'')+n.toLocaleString('cs-CZ',{maximumFractionDigits:d});
const day=(s:string)=>new Date(s).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'short'});
const time=(s:string)=>new Date(s).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',weekday:'short',hour:'2-digit',minute:'2-digit'});
const tone=(n:number|null)=>n===null||n===0?'':n>0?'up':'down';
const FLAGS=['green','orange','red'],FLAG_SHORT:Record<string,string>={green:'V tradu',orange:'Vyhlížím',red:'Čekám'};
const SIGNAL_GROUPS=['fx','currency','index','crypto','stock'];
const SYM:Record<string,string>={EUR:'€',USD:'$',GBP:'£',JPY:'¥',CHF:'Fr',AUD:'A$',NZD:'N$',CAD:'C$'};
const ASSET:Record<string,[string,string?]>={'BTC-USD':['₿','#f7931a'],'ETH-USD':['Ξ','#627eea'],'SOL-USD':['◎','#9945ff'],'^NDX':['N'],'^GSPC':['S']};
type Tile=React.CSSProperties&{'--i'?:number};

// Ikona trhu: u páru dvě překrývající se měny, jinak jedna.
function Badge({r}:{r:Row}){
 if(r.group==='fx'){const [a,b]=r.id.split('/');return <span className="d-badge pair" aria-hidden="true"><i>{SYM[a]||a[0]}</i><i>{SYM[b]||b[0]}</i></span>}
 const [sym,bg]=r.group==='currency'?[SYM[r.id]||r.id[0]]:ASSET[r.id]||[r.id.replace(/^\^/,'').charAt(0)];
 return <span className="d-badge" aria-hidden="true"><i style={bg?{background:bg,color:'#fff'}:undefined}>{sym}</i></span>;
}
function Spark({values,color}:{values:number[];color:string}){
 const id=useId();
 if(values.length<2)return <span className="d-spark"/>;
 const w=100,h=30,max=Math.max(...values),min=Math.min(...values),y=(v:number)=>3+(max-v)/((max-min)||1)*(h-6),x=(i:number)=>i/(values.length-1)*w;
 const d=values.map((v,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1)).join(' ');
 return <svg className="d-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" style={{stopColor:color,stopOpacity:.25}}/><stop offset="1" style={{stopColor:color,stopOpacity:0}}/></linearGradient></defs><path d={`${d} L${w} ${h} L0 ${h} Z`} fill={`url(#${id})`}/><path d={d} fill="none" style={{stroke:color}} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/></svg>;
}
// Plošný graf s přechodem; zero = vykreslit a zahrnout nulovou osu (P&L).
function Area({series,height,zero}:{series:{values:number[];color:string}[];height:number;zero?:boolean}){
 const id=useId(),all=series.flatMap(s=>s.values);
 if(series.every(s=>s.values.length<2))return null;
 const w=400,hi=Math.max(...all,...(zero?[0]:[])),lo=Math.min(...all,...(zero?[0]:[])),pad=(hi-lo)*.12||1,top=hi+pad,bot=zero?lo:lo-pad,y=(v:number)=>(top-v)/((top-bot)||1)*height;
 return <svg className="d-area" viewBox={`0 0 ${w} ${height}`} style={{height}} preserveAspectRatio="none" aria-hidden="true">
  <defs>{series.map((s,k)=><linearGradient key={k} id={id+k} x1="0" x2="0" y1="0" y2="1"><stop offset="0" style={{stopColor:s.color,stopOpacity:.3}}/><stop offset="1" style={{stopColor:s.color,stopOpacity:0}}/></linearGradient>)}</defs>
  {zero&&<line x1="0" x2={w} y1={y(0)} y2={y(0)} className="d-zero" vectorEffect="non-scaling-stroke"/>}
  {series.map((s,k)=>{if(s.values.length<2)return null;const d=s.values.map((v,i)=>(i?'L':'M')+(i/(s.values.length-1)*w).toFixed(1)+' '+y(v).toFixed(1)).join(' ');return <g key={k}><path d={`${d} L${w} ${height} L0 ${height} Z`} fill={`url(#${id+k})`}/><path d={d} fill="none" style={{stroke:s.color}} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/></g>})}
 </svg>;
}
function Ring({pct}:{pct:number}){const r=34,c=2*Math.PI*r;return <svg className="d-ring" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r={r} className="d-ring-track"/><circle cx="42" cy="42" r={r} className="d-ring-fill" strokeDasharray={`${c*Math.max(0,Math.min(100,pct))/100} ${c}`} transform="rotate(-90 42 42)"/></svg>}

// Lišta zapuštěná do okraje okna: v klidu vystupuje jen úzký pruh s ikonami, po najetí se roztáhne.
function Notch({side,label,rail,children}:{side:'left'|'right';label:string;rail:React.ReactNode;children:React.ReactNode}){
 const ref=useRef<HTMLElement>(null),inner=useRef<HTMLDivElement>(null);
 // Rozbalená výška podle obsahu (CSS ji omezí výškou okna), aby pod krátkým seznamem nezůstávalo prázdné místo.
 const measure=()=>{if(ref.current&&inner.current)ref.current.style.setProperty('--open-h',inner.current.offsetHeight+'px')};
 return <aside ref={ref} className={'d-notch '+side} tabIndex={0} aria-label={label} onPointerEnter={measure} onFocus={measure}><div className="d-notch-clip"><div className="d-notch-rail" aria-hidden="true">{rail}</div><div className="d-notch-panel"><div ref={inner} className="d-notch-inner">{children}</div></div></div></aside>;
}

export function Dashboard({rows,flags,history,data,market,now,userName,open,setView,calendar,flagsReady}:{calendar:CalendarEvent[];rows:Row[];flags:Record<string,string>;history:HistoryLike;data:FundamentalData;market:MarketData;now:number;userName:string;open:(id:string)=>void;setView:(v:View)=>void;flagsReady:boolean}){
 const {trades,error:tradeError,ready:tradesReady,load:reloadTrades}=useTrades();
 const [side,setSide]=useState<'bull'|'bear'>('bull'),[group,setGroup]=useState('all');
 const b=breadth(rows),sess=sessions(now),health=dataHealth(data,market,now),changes=recentChanges(history,5),mine=flaggedMarkets(flags);
 const events=upcomingCalendar(calendar,now,6),next=events.find(e=>Date.parse(e.at)>=now&&(e.signal===3||e.global))||events.find(e=>Date.parse(e.at)>=now);
 const today=todayIso(now),y=Number(today.slice(0,4)),mo=Number(today.slice(5,7)),stats=monthStats(trades,y,mo),curve=monthCurve(trades,y,mo,today),month=months[mo-1].toLowerCase();
 const signalGroups=SIGNAL_GROUPS.filter(g=>rows.some(r=>r.group===g&&r.r.score)),list=topSignals(group==='all'?rows:rows.filter(r=>r.group===group),6)[side];
 const ccy=rows.filter(r=>r.group==='currency'&&r.r.score!==null).sort((a,c)=>(c.r.score as number)-(a.r.score as number)),ccyScale=Math.max(10,...ccy.map(r=>Math.abs(r.r.score as number)))*1.15;
 const watched=rows.filter(r=>FLAGS.includes(flags[r.id])).sort((a,c)=>FLAGS.indexOf(flags[a.id])-FLAGS.indexOf(flags[c.id])||a.name.localeCompare(c.name)),count=(f:string)=>watched.filter(r=>flags[r.id]===f).length;
 const okSources=health.filter(h=>h.ok).length,live=sess.list.filter(x=>x.open),trail=history.snapshots.slice(-24);
 const dateLine=new Date(now).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',weekday:'long',day:'numeric',month:'long',year:'numeric'});
 const pct=(n:number)=>b.scored?100*n/b.scored+'%':'0%',spark=(r:Row)=>scoreSeries(history,r.id,r.r.method,'1m',now).map(p=>p.score);
 const tile=(i:number):Tile=>({'--i':i}),recent=[...trades].sort((a,c)=>c.date.localeCompare(a.date)||c.created.localeCompare(a.created)).slice(0,4);
 return <div className="d-dash">
  <header className="d-pagehead">
   <div><p className="d-date">{dateLine.charAt(0).toUpperCase()+dateLine.slice(1)}</p><h1>{greeting(new Date(now))}{userName?', '+vocative(userName):''}</h1></div>
   <div className="d-status">
    <span className={'d-chip'+(sess.fxOpen?' live':'')}><i/>{sess.fxOpen?<>FX otevřeno{live.length?<span> · {live.map(x=>x.city).join(', ')}</span>:null}</>:'FX zavřeno · víkend'}</span>
    {next&&<button type="button" className="d-chip" onClick={()=>setView('calendar')}><CalendarDays size={14}/><b>{next.title}</b><span>{time(next.at)} · {until(next.at,now)}</span></button>}
    <span className={'d-chip'+(okSources===health.length?'':' warn')} title={health.map(h=>h.label+': '+h.detail).join('\n')}><DatabaseZap size={14}/>Podklady <b>{okSources}/{health.length}</b></span>
   </div>
  </header>

  <div className="d-bento">
   <section className="d-card d-pulse" style={tile(0)}>
    <div className="d-head"><h2>Šíře trhu</h2><span className="d-meta">{b.scored} trhů se skóre</span></div>
    <div className="d-pulse-stats">
     <div><span className="d-lbl"><img src="/brand/bull.png" alt=""/>Bullish</span><b className="up">{b.bull}</b></div>
     <div><span className="d-lbl"><img src="/brand/bear.png" alt=""/>Bearish</span><b className="down">{b.bear}</b></div>
     <div><span className="d-lbl">Neutrální</span><b className="d-flat">{b.flat}</b></div>
     <p className="d-verdict">{b.summary}</p>
    </div>
    <div className="d-stack" role="img" aria-label={`Bullish ${b.bull}, neutrální ${b.flat}, bearish ${b.bear}`}><i className="bull" style={{width:pct(b.bull)}}/><i className="flat" style={{width:pct(b.flat)}}/><i className="bear" style={{width:pct(b.bear)}}/></div>
    <div className="d-bleed"><Area height={110} series={[{values:bullishTrail(history,24),color:'var(--bull)'},{values:bearishTrail(history,24),color:'var(--bear)'}]}/>{trail.length>1&&<div className="d-axis"><span>{day(trail[0].at)}</span><span>Vývoj počtu bullish a bearish trhů</span><span>{day(trail.at(-1)!.at)}</span></div>}</div>
   </section>

   <section className="d-card d-pnl" style={tile(1)}>
    <div className="d-head"><h2>P&amp;L · {month}</h2><span className="d-meta">{stats.count} {plural(stats.count)}</span></div>
    {tradeError?<p className="d-empty">Deník obchodů se nepodařilo načíst.</p>:!tradesReady?<p className="d-empty">Načítám obchody…</p>:<>
     <div className="d-big"><b className={tone(stats.total)}>{fmtUsd(stats.total)}</b>{stats.count>0&&<span className={'d-delta '+tone(stats.total)}>{stats.total>=0?<ArrowUpRight size={14}/>:<ArrowDownRight size={14}/>}{Math.round(stats.winRate)} % úspěšnost</span>}</div>
     {stats.count?<div className="d-bleed"><Area height={130} zero series={[{values:curve,color:stats.total>=0?'var(--bull)':'var(--bear)'}]}/><div className="d-axis"><span>1. {month}</span><span>Kumulativní výsledek</span><span>dnes</span></div></div>:<p className="d-empty">Tento měsíc zatím bez obchodů. Zapiš první v kalendáři níže.</p>}
    </>}
   </section>

   <section className="d-card d-watch" style={tile(2)}>
    <div className="d-head">
     <div className="d-seg" role="tablist" aria-label="Směr">{(['bull','bear'] as const).map(s=><button key={s} type="button" role="tab" aria-selected={side===s} className={side===s?'on':''} onClick={()=>setSide(s)}><span className={'d-key '+s}/>{s==='bull'?'Nejsilnější long':'Nejsilnější short'}</button>)}</div>
     <div className="d-chips" role="tablist" aria-label="Skupina trhů">{['all',...signalGroups].map(g=><button key={g} type="button" role="tab" aria-selected={group===g} className={group===g?'on':''} onClick={()=>setGroup(g)}>{g==='all'?'Vše':groups[g]}</button>)}</div>
    </div>
    {list.length?<ol className="d-watchlist">{list.map(r=><li key={r.id}><button type="button" onClick={()=>open(r.id)}>
     <Badge r={r}/>
     <span className="d-name"><b>{r.name}{FLAGS.includes(flags[r.id])&&<i className={'d-dot '+flags[r.id]} title={FLAG_SHORT[flags[r.id]]}/>}</b><small>{groups[r.group]} · pokrytí {r.r.coverage} %</small></span>
     <Spark values={spark(r)} color={side==='bull'?'var(--bull)':'var(--bear)'}/>
     <em className={'d-score '+tone(r.r.score)}>{fmt(r.r.score)}</em>
    </button></li>)}</ol>:<p className="d-empty">Žádný trh v tomto směru.</p>}
    <div className="d-foot"><span>Skóre −100 až +100 · křivka = posledních 30 dní</span><button type="button" className="d-link" onClick={()=>setView('analyzer')}>Všechny trhy <ChevronRight size={14}/></button></div>
   </section>

   <section className="d-card d-ccy" style={tile(3)}>
    <div className="d-head"><h2>Síla měn</h2><span className="d-meta">každá proti 7 ostatním</span></div>
    {ccy.length?<div className="d-vbars">{ccy.map(r=>{const v=r.r.score as number,h=Math.min(50,Math.abs(v)/ccyScale*50);return <button key={r.id} type="button" className="d-vbar" onClick={()=>open(r.id)} title={r.name+' · '+fmt(v)}>
     <span className="d-vbar-plot"><i className={v>=0?'pos':'neg'} style={{height:h+'%'}}/><em className={tone(v)} style={v>=0?{bottom:`calc(50% + ${h}% + 4px)`}:{top:`calc(50% + ${h}% + 4px)`}}>{fmt(v)}</em></span>
     <span className="d-vbar-lbl"><i>{SYM[r.id]}</i><b>{r.id}</b></span>
    </button>})}</div>:<p className="d-empty">Indexy měn zatím nemají skóre.</p>}
   </section>

   <div className="d-cal" style={tile(4)}><TradeCalendar now={now} trades={trades} ready={tradesReady} loadError={tradeError} reload={reloadTrades}/></div>

   <section className="d-card d-perf" style={tile(5)}>
    <div className="d-head"><h2>Statistiky · {month}</h2></div>
    {tradeError?<p className="d-empty">Deník obchodů se nepodařilo načíst.</p>:!stats.count?<p className="d-empty">Statistiky se ukážou po prvním obchodu v měsíci.</p>:<>
     <div className="d-ringbox"><Ring pct={stats.winRate}/><div><b>{Math.round(stats.winRate)} %</b><span>úspěšnost · {stats.wins} z {stats.count} obchodů v zisku</span></div></div>
     <dl className="d-stats">
      <div><dt>Ziskové dny</dt><dd>{stats.greenDays} z {stats.days}</dd></div>
      <div><dt>Průměr na obchod</dt><dd className={tone(stats.total)}>{fmtUsd(Math.round(stats.total/stats.count*100)/100)}</dd></div>
      <div><dt>Nejlepší den</dt><dd className={tone(stats.best)}>{fmtUsd(stats.best)}</dd></div>
      <div><dt>Nejhorší den</dt><dd className={tone(stats.worst)}>{fmtUsd(stats.worst)}</dd></div>
     </dl>
    </>}
    {recent.length>0&&<div className="d-recent"><h3>Poslední obchody</h3><ul>{recent.map(t=><li key={t.id}><span className="d-name"><b>{t.instrument}</b><small>{day(t.date+'T12:00:00Z')}{t.note?' · '+t.note:''}</small></span><em className={tone(t.pnl)}>{fmtUsd(t.pnl)}</em></li>)}</ul></div>}
   </section>
  </div>

  <div className="d-notches">
   <Notch side="left" label="Moje vlaječky" rail={<><Flag size={17}/>{FLAGS.map(f=><span key={f} className="d-rail-n"><i className={'d-dot '+f}/>{count(f)}</span>)}</>}>
    <div className="d-head"><h2>Moje vlaječky</h2><button type="button" className="d-link" onClick={()=>setView('analyzer')}>Analýza trhů <ChevronRight size={14}/></button></div>
    <div className="d-flagsum">{FLAGS.map(f=><div key={f}><i className={'d-dot '+f}/><b>{count(f)}</b><span>{FLAG_SHORT[f]}</span></div>)}</div>
    {watched.length?<ul className="d-rows">{watched.map(r=><li key={r.id}><button type="button" onClick={()=>open(r.id)}><Badge r={r}/><span className="d-name"><b>{r.name}</b><small><i className={'d-dot '+flags[r.id]}/>{FLAG_SHORT[flags[r.id]]}</small></span><em className={'d-score '+tone(r.r.score)}>{fmt(r.r.score)}</em></button></li>)}</ul>:<p className="d-empty">{flagsReady?'Zatím žádné vlaječky. Označ trhy v Analýze trhů.':'Vlaječky teď nejsou k dispozici.'}</p>}
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
