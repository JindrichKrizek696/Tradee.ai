'use client';
import {Spark as LiveSpark,LiveChange,LiveBadge,newest,type LiveData} from './live';
import {useId,useRef,useState} from 'react';
import {MyTrading} from './my-trading';
import {CalendarDays,Check,Clock,AlertTriangle,ChevronRight,Activity,Flag,Globe2,DatabaseZap,LineChart} from 'lucide-react';
import type {FundamentalData} from '@/lib/fundamentals';
import type {MarketData} from '@/lib/score-engine';
import {groups} from '@/lib/markets';
import {TradeCalendar,useTrades,months,todayIso} from './trade-calendar';
import {EventRow} from './calendar';
import {upcomingCalendar,flaggedMarkets,relative as until,type CalendarEvent} from '@/lib/calendar';
import {monthStats,fmtMoney} from '@/lib/trades';
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
function Ring({pct}:{pct:number}){const r=34,c=2*Math.PI*r;return <svg className="d-ring" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r={r} className="d-ring-track"/><circle cx="42" cy="42" r={r} className="d-ring-fill" strokeDasharray={`${c*Math.max(0,Math.min(100,pct))/100} ${c}`} transform="rotate(-90 42 42)"/></svg>}
// Půlkruhový ukazatel indexu −100…+100 (medvědi vlevo, býci vpravo).
function Gauge({value}:{value:number}){
 const id=useId(),cx=120,cy=118,r=96,ang=(v:number)=>Math.PI*(1-(Math.max(-100,Math.min(100,v))+100)/200),pt=(v:number,rr:number)=>[cx+rr*Math.cos(ang(v)),cy-rr*Math.sin(ang(v))];
 const [kx,ky]=pt(value,r),arc=`M${cx-r} ${cy} A${r} ${r} 0 0 1 ${cx+r} ${cy}`;
 return <svg className="d-gauge" viewBox="0 0 240 132" aria-hidden="true">
  <defs><linearGradient id={id} x1="0" x2="1" y1="0" y2="0"><stop offset="0" style={{stopColor:'var(--bear)'}}/><stop offset=".5" style={{stopColor:'var(--t-border-strong)'}}/><stop offset="1" style={{stopColor:'var(--bull)'}}/></linearGradient></defs>
  <path d={arc} fill="none" className="d-gauge-track"/>
  <path d={arc} fill="none" stroke={`url(#${id})`} className="d-gauge-arc"/>
  {[-100,-50,0,50,100].map(t=>{const [x1,y1]=pt(t,r-16),[x2,y2]=pt(t,r-22);return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} className="d-gauge-tick"/>})}
  <circle cx={kx} cy={ky} r="10" className="d-gauge-knob"/>
 </svg>;
}
// Čistá převaha (bullish − bearish) v jednotlivých snímcích; najetím se ukáže čas snímku a počty, pod sloupci datum při změně dne.
const stamp=(s:string)=>new Date(s).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',weekday:'short',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
function NetBars({values,bull,bear,ats}:{values:number[];bull:number[];bear:number[];ats:string[]}){
 const [hov,setHov]=useState<number|null>(null),n=values.length,max=Math.max(1,...values.map(Math.abs));
 const days=ats.map((a,i)=>{const d=day(a);return i===0||d!==day(ats[i-1])?d:''}),pos=hov===null?0:(hov+.5)/n;
 return <div className="d-netzone" onPointerLeave={()=>setHov(null)}>
  <div className={'d-netbars'+(hov!==null?' hovering':'')}>{values.map((v,i)=><span key={i} onPointerEnter={()=>setHov(i)} className={(v>0?'pos':v<0?'neg':'zero')+(hov===i?' on':'')} style={{'--h':Math.abs(v)/max*50+'%'} as React.CSSProperties}/>)}
  {hov!==null&&<div className="d-nettip" role="status" style={{left:`calc(22px + (100% - 44px) * ${pos})`,...(values[hov]>=0?{top:'calc(50% + 8px)'}:{bottom:'calc(50% + 8px)'}),transform:`translateX(${pos<.15?'-12%':pos>.85?'-88%':'-50%'})`}}>
   <b>{stamp(ats[hov])}</b>
   <span>Bullish <em className="up">{bull[hov]}</em> · Bearish <em className="down">{bear[hov]}</em></span>
   <span>Převaha <em className={values[hov]>0?'up':values[hov]<0?'down':''}>{values[hov]>0?'+':''}{values[hov]}</em></span>
  </div>}</div>
  <div className="d-netdays" aria-hidden="true">{days.map((d,i)=><span key={i}>{d}</span>)}</div>
 </div>;
}
// Lišta zapuštěná do okraje okna: v klidu vystupuje jen úzký pruh s ikonami, po najetí se roztáhne.
function Notch({side,label,rail,children}:{side:'left'|'right';label:string;rail:React.ReactNode;children:React.ReactNode}){
 const ref=useRef<HTMLElement>(null),inner=useRef<HTMLDivElement>(null);
 // Rozbalená výška podle obsahu (CSS ji omezí výškou okna), aby pod krátkým seznamem nezůstávalo prázdné místo.
 const measure=()=>{if(ref.current&&inner.current)ref.current.style.setProperty('--open-h',inner.current.offsetHeight+'px')};
 return <aside ref={ref} className={'d-notch '+side} tabIndex={0} aria-label={label} onPointerEnter={measure} onFocus={measure}><div className="d-notch-clip"><div className="d-notch-rail" aria-hidden="true">{rail}</div><div className="d-notch-panel"><div ref={inner} className="d-notch-inner">{children}</div></div></div></aside>;
}

export function Dashboard({rows,flags,history,data,market,now,userName,open,setView,calendar,flagsReady,live:liveData}:{live?:LiveData|null;calendar:CalendarEvent[];rows:Row[];flags:Record<string,string>;history:HistoryLike;data:FundamentalData;market:MarketData;now:number;userName:string;open:(id:string)=>void;setView:(v:View)=>void;flagsReady:boolean}){
 const {trades,currency,error:tradeError,ready:tradesReady,load:reloadTrades}=useTrades();
 const [side,setSide]=useState<'bull'|'bear'>('bull'),[group,setGroup]=useState('all'),[rev,setRev]=useState(0);
 const b=breadth(rows),sess=sessions(now),health=dataHealth(data,market,now),changes=recentChanges(history,5),mine=flaggedMarkets(flags);
 const events=upcomingCalendar(calendar,now,6),next=events.find(e=>Date.parse(e.at)>=now&&(e.signal===3||e.global))||events.find(e=>Date.parse(e.at)>=now);
 const today=todayIso(now),y=Number(today.slice(0,4)),mo=Number(today.slice(5,7)),stats=monthStats(trades,y,mo),month=months[mo-1].toLowerCase();
 const bullT=bullishTrail(history,24),bearT=bearishTrail(history,24),net=bullT.map((v,i)=>v-(bearT[i]??0)),index=b.scored?Math.round(100*(b.bull-b.bear)/b.scored):0;
 const delta=(t:number[])=>t.length>1?t[t.length-1]-t[t.length-2]:0,signed=(n:number)=>n>0?'+'+n:n<0?'−'+-n:'0';
 const signalGroups=SIGNAL_GROUPS.filter(g=>rows.some(r=>r.group===g&&r.r.score)),list=topSignals(group==='all'?rows:rows.filter(r=>r.group===group),6)[side];
 const ccy=rows.filter(r=>r.group==='currency'&&r.r.score!==null).sort((a,c)=>(c.r.score as number)-(a.r.score as number)),ccyScale=Math.max(10,...ccy.map(r=>Math.abs(r.r.score as number)))*1.15;
 const watched=rows.filter(r=>FLAGS.includes(flags[r.id])).sort((a,c)=>FLAGS.indexOf(flags[a.id])-FLAGS.indexOf(flags[c.id])||a.name.localeCompare(c.name)),count=(f:string)=>watched.filter(r=>flags[r.id]===f).length;
 const okSources=health.filter(h=>h.ok).length,live=sess.list.filter(x=>x.open),trail=history.snapshots.slice(-24);
 const quotes=liveData?.quotes||{},moves=rows.filter(r=>r.group!=='currency'&&quotes[r.id]).map(r=>({r,q:quotes[r.id]})),rise=moves.filter(m=>m.q.changePct>0).sort((a,c)=>c.q.changePct-a.q.changePct).slice(0,5),fall=moves.filter(m=>m.q.changePct<0).sort((a,c)=>a.q.changePct-c.q.changePct).slice(0,5);
 const strength=rows.filter(r=>r.group==='currency').map(r=>({r,v:quotes[r.id]?.changePct})).filter((x):x is {r:Row;v:number}=>x.v!==undefined).sort((a,c)=>c.v-a.v),strScale=Math.max(0.05,...strength.map(x=>Math.abs(x.v)));
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
   <MyTrading now={now} rev={rev} style={tile(0)} onAddTrade={()=>document.querySelector('.d-cal')?.scrollIntoView({behavior:'smooth',block:'start'})}/>

   <section className="d-card d-pulse" style={tile(1)}>
    <div className="d-head"><h2>Šíře trhu</h2><span className="d-meta">{b.scored?b.scored+' trhů se skóre':'Podklady jsou starší než limit'}{trail.length?' · snímek '+day(trail[trail.length-1].at):''}</span></div>
    <div className="d-pulse-body">
     <div className="d-gaugebox">
      <Gauge value={index}/>
      <div className="d-gauge-center">{b.scored?<><b className={tone(index)}>{signed(index)}</b><span>{b.summary}</span></>:<><b className="d-na">—</b><span>Skóre je pozastavené</span></>}</div>
      <div className="d-gauge-scale"><span>Bearish</span><span>Bullish</span></div>
     </div>
     <ul className="d-brows">
      {([['bull','Bullish',b.bull,bullT],['bear','Bearish',b.bear,bearT]] as const).map(([k,label,n,t])=><li key={k}><button type="button" onClick={()=>{setSide(k);document.querySelector('.d-watch')?.scrollIntoView({behavior:'smooth',block:'center'})}}>
       <span className="d-badge"><i className="d-mascot"><img src={`/brand/${k}.png`} alt=""/></i></span>
       <span className="d-name"><b>{label}</b><small>{delta(t)?signed(delta(t))+' proti minulému snímku':'beze změny'}</small></span>
       <Spark values={[...t]} color={k==='bull'?'var(--bull)':'var(--bear)'}/>
       <em className={'d-score '+(k==='bull'?'up':'down')}>{n}</em>
      </button></li>)}
      <li><div className="d-brow-flat"><span className="d-badge"><i>=</i></span><span className="d-name"><b>Neutrální</b><small>skóre přesně 0</small></span><span/><em className="d-score">{b.flat}</em></div></li>
     </ul>
    </div>
    {net.length>1&&<div className="d-bleed d-netwrap"><NetBars values={net} bull={bullT} bear={bearT} ats={trail.map(t=>t.at)}/><div className="d-axis d-netcap"><span>Čistá převaha bullish − bearish · {net.length} snímků · najeď na sloupec pro detail</span></div></div>}
   </section>

   {liveData&&(moves.length>0||strength.length>0)&&<section className="d-card d-movers" style={tile(2)}>
    <div className="d-head"><h2>Co se dnes hýbe</h2><LiveBadge live={liveData} quote={newest(liveData)}/></div>
    <div className="d-mv-cols">
     {([['Rostou',rise],['Padají',fall]] as const).map(([label,list])=><div key={label} className="d-mv-col"><h3>{label}</h3>
      {list.length?<ul>{list.map(({r,q})=><li key={r.id}><button type="button" onClick={()=>open(r.id)}><span className="d-mv-name">{r.name}</span><LiveSpark points={q.points} changePct={q.changePct}/><LiveChange pct={q.changePct}/></button></li>)}</ul>:<p className="d-empty">Dnes žádný pohyb.</p>}
     </div>)}
    </div>
    {strength.length>0&&<div className="d-mv-str"><h3>Síla měn dnes</h3>
     <ul>{strength.map(({r,v})=><li key={r.id}><button type="button" onClick={()=>open(r.id)}><b>{r.id}</b><span className="d-hbar"><i className={v>0?'pos':v<0?'neg':'zero'} style={{'--w':Math.abs(v)/strScale*50+'%'} as React.CSSProperties}/></span><LiveChange pct={v}/></button></li>)}</ul>
    </div>}
   </section>}

   <section className="d-card d-watch" style={tile(3)}>
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

   <section className="d-card d-ccy" style={tile(4)}>
    <div className="d-head"><h2>Síla měn</h2><span className="d-meta">každá proti 7 ostatním</span></div>
    {ccy.length?<div className="d-vbars">{ccy.map(r=>{const v=r.r.score as number,h=Math.min(50,Math.abs(v)/ccyScale*50);return <button key={r.id} type="button" className="d-vbar" onClick={()=>open(r.id)} title={r.name+' · '+fmt(v)}>
     <span className="d-vbar-plot"><i className={v>=0?'pos':'neg'} style={{height:h+'%'}}/><em className={tone(v)} style={v>=0?{bottom:`calc(50% + ${h}% + 4px)`}:{top:`calc(50% + ${h}% + 4px)`}}>{fmt(v)}</em></span>
     <span className="d-vbar-lbl"><i>{SYM[r.id]}</i><b>{r.id}</b></span>
    </button>})}</div>:<p className="d-empty">Indexy měn zatím nemají skóre.</p>}
   </section>

   <div className="d-cal" style={tile(5)}><TradeCalendar now={now} trades={trades} currency={currency} ready={tradesReady} loadError={tradeError} reload={async()=>{await reloadTrades();setRev(r=>r+1)}}/></div>

   <section className="d-card d-perf" style={tile(6)}>
    <div className="d-head"><h2>Statistiky · {month}</h2></div>
    {tradeError?<p className="d-empty">Deník obchodů se nepodařilo načíst.</p>:!stats.count?<p className="d-empty">Statistiky se ukážou po prvním obchodu v měsíci.</p>:<>
     <div className="d-ringbox"><Ring pct={stats.winRate}/><div><b>{Math.round(stats.winRate)} %</b><span>úspěšnost · {stats.wins} z {stats.count} obchodů v zisku</span></div></div>
     <dl className="d-stats">
      <div><dt>Ziskové dny</dt><dd>{stats.greenDays} z {stats.days}</dd></div>
      <div><dt>Průměr na obchod</dt><dd className={tone(stats.total)}>{fmtMoney(Math.round(stats.total/stats.count*100)/100,currency)}</dd></div>
      <div><dt>Nejlepší den</dt><dd className={tone(stats.best)}>{fmtMoney(stats.best,currency)}</dd></div>
      <div><dt>Nejhorší den</dt><dd className={tone(stats.worst)}>{fmtMoney(stats.worst,currency)}</dd></div>
     </dl>
    </>}
    {recent.length>0&&<div className="d-recent"><h3>Poslední obchody</h3><ul>{recent.map(t=><li key={t.id}><span className="d-name"><b>{t.instrument}</b><small>{day(t.date+'T12:00:00Z')}{t.note?' · '+t.note:''}</small></span><em className={tone(t.pnl)}>{fmtMoney(t.pnl,currency)}</em></li>)}</ul></div>}
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
