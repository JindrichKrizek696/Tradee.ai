'use client';
import {CalendarDays,Check,Clock,AlertTriangle,ChevronRight,Activity,Flag,Globe2,Swords,Wallet,DatabaseZap,Radio,Sparkles} from 'lucide-react';
import type {FundamentalData} from '@/lib/fundamentals';
import type {MarketData} from '@/lib/score-engine';
import {groups} from '@/lib/markets';
import {TradeCalendar,useTrades,months,todayIso,plural} from './trade-calendar';
import {EventRow} from './calendar';
import {upcomingCalendar,flaggedMarkets,type CalendarEvent} from '@/lib/calendar';
import {monthStats,monthCurve,fmtUsd,type Trade} from '@/lib/trades';
import type {View} from './shell';
import {greeting,vocative,kpis,mood,topSignals,sessions,dataHealth,recentChanges,type Row,type HistoryLike,type Mood} from '@/lib/dashboard';
const fmt=(n:number|null,d=1)=>n===null?'—':(n>0?'+':'')+n.toLocaleString('cs-CZ',{maximumFractionDigits:d});
const day=(s:string)=>new Date(s).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'short'});
const tone=(n:number|null)=>n===null||n===0?'':n>0?'up':'down';
const FLAG_ORDER=['green','orange','red'],FLAG_SHORT:Record<string,string>={green:'V tradu',orange:'Vyhlížím',red:'Čekám'};
const MASCOT={bull:{alt:'Býk, maskot bullish trhů',line:'Dneska táhneme nahoru.'},bear:{alt:'Medvěd, maskot bearish trhů',line:'Dneska tlačíme dolů.'}};
type Side='bull'|'bear';

const Face=({who}:{who:Side})=><span className={'d-face is-'+who} aria-hidden="true"><img src={`/brand/${who}.png`} alt=""/></span>;

function Curve({values}:{values:number[]}){
 if(values.length<2)return null;
 const w=300,h=88,max=Math.max(...values,0),min=Math.min(...values,0),y=(v:number)=>8+(max-v)/((max-min)||1)*(h-16),x=(i:number)=>i/(values.length-1)*w;
 const d=values.map((v,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1)).join(' '),color=(values.at(-1) as number)>=0?'var(--bull)':'var(--bear)';
 return <svg className="d-curve" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2={w} y1={y(0)} y2={y(0)} className="d-zero" vectorEffect="non-scaling-stroke"/><path d={`${d} L${w} ${y(0).toFixed(1)} L0 ${y(0).toFixed(1)} Z`} style={{fill:color}} opacity=".13"/><path d={d} fill="none" style={{stroke:color}} strokeWidth="2.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"/></svg>;
}

function MoodHero({m,top,open,date}:{m:Mood;top:ReturnType<typeof topSignals>;open:(id:string)=>void;date:string}){
 const pct=(n:number)=>m.scored?100*n/m.scored+'%':'0%',markets=m.scored===1?'trhu':'trhů';
 const mascot=(who:Side)=><div className={'d-mascot is-'+who+(m.leader===who?' lead':'')}>{m.leader===who&&<span className="d-bubble">{MASCOT[who].line}</span>}<img src={`/brand/${who}.png`} alt={MASCOT[who].alt}/></div>;
 const chip=(r:Row|undefined,label:string)=>r&&<button type="button" onClick={()=>open(r.id)}><span>{label}</span><b>{r.name}</b><em className={tone(r.r.score)}>{fmt(r.r.score)}</em><ChevronRight size={14}/></button>;
 return <section className={'d-hero lead-'+m.leader}><div className="d-hero-in">
  {mascot('bull')}
  <div className="d-hero-body">
   <span className="d-kicker"><Radio size={13}/> Nálada trhu · {date}</span>
   <h1>{m.headline}</h1>
   <p>Z {m.scored} {markets} se skóre je <b>{m.bull} bullish</b> a <b>{m.bear} bearish</b>{m.flat?<>, {m.flat} bez jasného směru</>:null}.</p>
   <div className="d-tug" role="img" aria-label={`Bullish ${m.bull}, bez směru ${m.flat}, bearish ${m.bear}`}>
    <div className="d-tug-n is-bull"><b>{m.bull}</b><span>býci</span></div>
    <div className="d-tug-bar"><i className="is-bull" style={{width:pct(m.bull)}}/><i className="is-flat" style={{width:pct(m.flat)}}/><i className="is-bear" style={{width:pct(m.bear)}}/></div>
    <div className="d-tug-n is-bear"><b>{m.bear}</b><span>medvědi</span></div>
   </div>
   <div className="d-hero-chips">{chip(top.bull[0],'Nejsilnější býk')}{chip(top.bear[0],'Nejsilnější medvěd')}</div>
  </div>
  {mascot('bear')}
 </div></section>;
}

function Me({userName,now,inTrade,eventsToday,live}:{userName:string;now:number;inTrade:number;eventsToday:number;live:string[]}){
 const date=new Date(now).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',weekday:'long',day:'numeric',month:'long'}),long=date.charAt(0).toUpperCase()+date.slice(1);
 return <section className="d-card d-me">
  <div className="d-me-top"><span className="d-avatar">{userName.trim().charAt(0).toUpperCase()||'?'}</span><div><span className="d-greet">{greeting(new Date(now))},</span><h1>{vocative(userName)}</h1></div></div>
  <div className="d-today"><CalendarDays size={15}/>{long}</div>
  <ul className="d-brief">
   <li><span className="d-dot green"/><span>{inTrade?<>Máš <b>{inTrade} {inTrade===1?'otevřenou pozici':inTrade<5?'otevřené pozice':'otevřených pozic'}</b></>:'Teď nejsi v žádném tradu'}</span></li>
   <li><span className="d-dot blue"/><span>{eventsToday?<>Dnes <b>{eventsToday} {eventsToday===1?'událost':eventsToday<5?'události':'událostí'}</b> na tvých trzích</>:'Dnes žádná událost na tvých trzích'}</span></li>
   <li><span className="d-dot amber"/><span>{live.length?<><b>{live.join(' a ')}</b> {live.length===1?'právě obchoduje':'právě obchodují'}</>:'Všechny hlavní seance jsou zavřené'}</span></li>
  </ul>
  <blockquote>Disciplína dnes. Svoboda zítra.</blockquote>
 </section>;
}

function Month({trades,ready,error,now}:{trades:Trade[];ready:boolean;error:string;now:number}){
 const today=todayIso(now),y=Number(today.slice(0,4)),mo=Number(today.slice(5,7)),s=monthStats(trades,y,mo),curve=monthCurve(trades,y,mo,today);
 return <section className="d-card d-month">
  <div className="d-head"><div className="d-title"><span className="d-ico"><Wallet size={16}/></span><h2>{mo===9?'Tvoje':'Tvůj'} {months[mo-1].toLowerCase()}</h2></div>{s.count>0&&<span className="d-muted">{s.count} {plural(s.count)}</span>}</div>
  {error?<div className="d-empty">Deník obchodů se nepodařilo načíst.</div>:!ready?<div className="d-empty">Načítám obchody…</div>:!s.count?<div className="d-empty"><Sparkles size={18}/>Tento měsíc zatím bez obchodů. Zapiš první v kalendáři a uvidíš tu svůj vývoj.</div>:<>
   <div className={'d-big '+tone(s.total)}>{fmtUsd(s.total)}</div>
   <Curve values={curve}/>
   <div className="d-stats"><div><span>Úspěšnost</span><b>{Math.round(s.winRate)} %</b></div><div><span>Ziskové dny</span><b>{s.greenDays} z {s.days}</b></div><div><span>Nejlepší den</span><b className={tone(s.best)}>{fmtUsd(s.best)}</b></div><div><span>Nejhorší den</span><b className={tone(s.worst)}>{fmtUsd(s.worst)}</b></div></div>
  </>}
 </section>;
}

function Flags({rows,flags,ready,open,setView}:{rows:Row[];flags:Record<string,string>;ready:boolean;open:(id:string)=>void;setView:(v:View)=>void}){
 const mine=rows.filter(r=>FLAG_ORDER.includes(flags[r.id])).sort((a,b)=>FLAG_ORDER.indexOf(flags[a.id])-FLAG_ORDER.indexOf(flags[b.id])||a.name.localeCompare(b.name));
 const count=(f:string)=>mine.filter(r=>flags[r.id]===f).length;
 return <section className="d-card d-flags">
  <div className="d-head"><div className="d-title"><span className="d-ico"><Flag size={16}/></span><h2>Moje vlaječky</h2></div><button type="button" className="d-link" onClick={()=>setView('analyzer')}>Trhy <ChevronRight size={14}/></button></div>
  <div className="d-flagsum">{FLAG_ORDER.map(f=><div key={f} className={'flag-'+f}><b>{count(f)}</b><span>{FLAG_SHORT[f]}</span></div>)}</div>
  {mine.length?<ul className="d-flaglist">{mine.map(r=><li key={r.id}><button type="button" onClick={()=>open(r.id)}><span className={'d-dot '+flags[r.id]}/><span className="d-name"><b>{r.name}</b><small>{FLAG_SHORT[flags[r.id]]}</small></span><em className={tone(r.r.score)}>{fmt(r.r.score)}</em></button></li>)}</ul>:<div className="d-empty">{ready?'Zatím nic nesleduješ. Označ si trhy vlaječkou v Analýze trhů.':'Vlaječky teď nejsou k dispozici.'}</div>}
 </section>;
}

function Board({top,flags,open,setView}:{top:ReturnType<typeof topSignals>;flags:Record<string,string>;open:(id:string)=>void;setView:(v:View)=>void}){
 const col=(side:Side)=><div className={'d-col is-'+side}>
  <div className="d-col-head"><Face who={side}/><div><b>{side==='bull'?'Býci táhnou nahoru':'Medvědi tlačí dolů'}</b><small>{side==='bull'?'nejvyšší bullish skóre':'nejnižší bearish skóre'}</small></div></div>
  {top[side].length?<ol>{top[side].map((r,i)=><li key={r.id}><button type="button" onClick={()=>open(r.id)}><span className="d-rank">{i+1}</span><span className="d-name"><b>{r.name}{FLAG_ORDER.includes(flags[r.id])&&<span className={'d-dot '+flags[r.id]} title={FLAG_SHORT[flags[r.id]]}/>}</b><small>{groups[r.group]}</small></span><span className="d-meter"><i style={{width:Math.min(100,Math.abs(r.r.score as number))+'%'}}/></span><em className={tone(r.r.score)}>{fmt(r.r.score)}</em></button></li>)}</ol>:<div className="d-empty">Žádný trh v tomto směru.</div>}
 </div>;
 return <section className="d-card d-board">
  <div className="d-head"><div className="d-title"><span className="d-ico"><Swords size={16}/></span><h2>Kdo táhne trh</h2></div><button type="button" className="d-link" onClick={()=>setView('analyzer')}>Všechny trhy <ChevronRight size={14}/></button></div>
  <div className="d-cols">{col('bull')}{col('bear')}</div>
 </section>;
}

function Sessions({s}:{s:ReturnType<typeof sessions>}){
 const seg=(start:number,len:number)=>start+len<=1440?[[start,len]]:[[start,1440-start],[0,start+len-1440]];
 return <section className="d-card d-sessions">
  <div className="d-head"><div className="d-title"><span className="d-ico"><Globe2 size={16}/></span><h2>Obchodní seance</h2></div><span className={'d-pill '+(s.fxOpen?'live':'')}>{s.fxOpen?'FX otevřeno':'FX víkend'}</span></div>
  <div className="d-tl" style={{'--now':s.nowMin/14.4+'%'} as React.CSSProperties}>
   {s.list.map(x=><div key={x.id} className={'d-tl-row'+(x.open?' open':'')}><div className="d-tl-name"><b>{x.city}</b><small>{x.label}</small></div><div className="d-tl-track">{seg(x.start,x.length).map(([a,l])=><i key={a} style={{left:a/14.4+'%',width:l/14.4+'%'}}/>)}</div></div>)}
   <div className="d-tl-row d-tl-axis"><span/><div className="d-tl-track">{[0,6,12,18,24].map(h=><span key={h} style={{left:h/24*100+'%'}}>{h}</span>)}</div></div>
  </div>
  <small className="d-foot">Pražský čas · místní obchodní hodiny burz</small>
 </section>;
}

export function Dashboard({rows,flags,history,data,market,now,userName,open,setView,calendar,flagsReady}:{calendar:CalendarEvent[];rows:Row[];flags:Record<string,string>;history:HistoryLike;data:FundamentalData;market:MarketData;now:number;userName:string;open:(id:string)=>void;setView:(v:View)=>void;flagsReady:boolean}){
 const {trades,error:tradeError,ready:tradesReady,load:reloadTrades}=useTrades();
 const k=kpis(rows,flags),m=mood(rows),top=topSignals(rows,5),sess=sessions(now);
 const health=dataHealth(data,market,now),changes=recentChanges(history,5),events=upcomingCalendar(calendar,now,6),mine=flaggedMarkets(flags);
 const today=todayIso(now),eventsToday=calendar.filter(e=>todayIso(Date.parse(e.at))===today&&Date.parse(e.at)>=now-3600000&&e.markets.some(x=>mine.has(x))).length;
 const date=new Date(now).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'long'});
 return <div className="d-desk">
  <aside className="d-rail d-left" aria-label="Tvůj přehled">
   <Me userName={userName} now={now} inTrade={k.inTrade} eventsToday={eventsToday} live={sess.list.filter(x=>x.open).map(x=>x.city)}/>
   <Month trades={trades} ready={tradesReady} error={tradeError} now={now}/>
   <Flags rows={rows} flags={flags} ready={flagsReady} open={open} setView={setView}/>
  </aside>
  <div className="d-center">
   <MoodHero m={m} top={top} open={open} date={date}/>
   <Board top={top} flags={flags} open={open} setView={setView}/>
   <TradeCalendar now={now} trades={trades} ready={tradesReady} loadError={tradeError} reload={reloadTrades}/>
  </div>
  <aside className="d-rail d-right" aria-label="Trhy a podklady">
   <Sessions s={sess}/>
   <section className="d-card d-events"><div className="d-head"><div className="d-title"><span className="d-ico"><CalendarDays size={16}/></span><h2>Co tě čeká</h2></div><button type="button" className="d-link" onClick={()=>setView('calendar')}>Kalendář <ChevronRight size={14}/></button></div><div className="c-list c-compact">{events.length?events.map(e=><EventRow key={e.id} e={e} now={now} mine={mine} compact/>):<div className="d-empty">Žádné nadcházející události.</div>}</div></section>
   <section className="d-card d-changes"><div className="d-head"><div className="d-title"><span className="d-ico"><Activity size={16}/></span><h2>Poslední změny</h2></div><span className="d-muted">{history.snapshots.length} snímků</span></div><div className="d-list">{changes.length?changes.map(c=><div key={c.instrument}><span className={'d-check '+(c.delta>0?'up':c.delta<0?'down':'muted')}><Activity size={13}/></span><div><b>{rows.find(r=>r.id===c.instrument)?.name||c.instrument}</b><small>{fmt(c.from)} → {fmt(c.to)} · {day(c.at)}</small></div><em className={tone(c.delta)}>{fmt(c.delta)}</em></div>):<p className="d-note">Skóre se od posledního snímku nezměnilo.</p>}{data.changes.slice(-2).reverse().map(c=><div key={c.at}><span className="d-check muted"><Clock size={13}/></span><div><b>{c.title}</b><small>{day(c.at)} · {c.body}</small></div><span/></div>)}</div></section>
   <section className="d-card d-health"><div className="d-head"><div className="d-title"><span className="d-ico"><DatabaseZap size={16}/></span><h2>Stav podkladů</h2></div><span className="d-muted" title="Podíl trhů s plným pokrytím vstupů">pokrytí {k.freshness} %</span></div><div className="d-list">{health.map(h=><div key={h.label}><span className={'d-check '+(h.ok?'ok':'warn')}>{h.ok?<Check size={13}/>:<AlertTriangle size={13}/>}</span><div><b>{h.label}</b><small>{h.detail}</small></div><span className="d-bar" title={h.usage+' % limitu'}><i className={h.ok?'':'warn'} style={{width:h.usage+'%'}}/></span></div>)}</div></section>
  </aside>
 </div>;
}
