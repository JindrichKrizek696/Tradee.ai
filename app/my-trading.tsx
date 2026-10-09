'use client';
import {useEffect,useMemo,useState} from 'react';
import {ArrowUpRight,ArrowDownRight,RotateCcw,Plus,Link2,Wallet,CandlestickChart,Target,Flame,TrendingDown,type LucideIcon} from 'lucide-react';
import type {JournalList} from '@/lib/journal/types';
import {DEFAULT_FILTER,filterTrades,sanitizeFilter,summary,equityCurve,currentStreak,isBestPeriod,drawdownPct} from '@/lib/journal/stats';
import {fmtNum,plural as pl} from '@/lib/journal/format';
import {fmtMoney,periodStats,type Trade} from '@/lib/trades';
import {readAccount,writeAccount} from './journal/account-pref';
import {Curve} from './journal/stats-view';
import {PnlChart,GHOST} from './pnl-chart';
import {months,todayIso} from './trade-calendar';
import './journal/journal.css';
type P='week'|'month'|'year'|'all';
const PERIODS:[P,string][]=[['week','Týden'],['month','Měsíc'],['year','Rok'],['all','Vše']],PKEY='tradee.mytrading.period';
const DAYS=['Pondělí','Úterý','Středa','Čtvrtek','Pátek','Sobota','Neděle'];
const PW:Record<P,string>={week:'týden',month:'měsíc',year:'rok',all:'celou dobu'};
const tone=(n:number)=>n>0?'up':n<0?'down':'';
const WIN=['výhra','výhry','výher'] as const,LOSS=['prohra','prohry','proher'] as const;
// win rate: < 40 % medvěd, 40–55 % jantar, > 55 % býk
const wrTone=(w:number)=>w<40?'down':w<=55?'mid':'up';
// prstenec win rate (obvod kruhu r=16)
const Ring=({pct}:{pct:number})=><svg className="d-mt-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16"/><circle cx="20" cy="20" r="16" strokeDasharray={`${pct/100*100.53} 100.53`} transform="rotate(-90 20 20)"/></svg>;
// Souhrn vlastního obchodování nahoře na Dashboardu: stejná data a výpočty jako Deník, účet sdílený s Deníkem.
export function MyTrading({now,onAddTrade,onAccount,rev=0,style}:{now:number;onAddTrade:()=>void;onAccount?:(a:string)=>void;rev?:number;style?:React.CSSProperties}){
 const [data,setData]=useState<JournalList|null>(null),[error,setError]=useState(''),[account,setAccount]=useState('all'),[period,setPeriod]=useState<P>('month');
 async function load(){try{const r=await fetch('/api/journal',{cache:'no-store'});const j=await r.json() as JournalList&{error?:string};if(!r.ok)throw Error(j.error||'');setData(j);setError('')}catch(e){setError((e as Error).message||'Obchody se nepodařilo načíst.')}}
 // volby z prohlížeče až po připojení (Dashboard se renderuje i na serveru)
 useEffect(()=>{setAccount(readAccount());try{const p=localStorage.getItem(PKEY);if(PERIODS.some(x=>x[0]===p))setPeriod(p as P)}catch{}},[]);
 useEffect(()=>{load()},[rev]);
 // uložený účet mohl zmizet (smazaný MT účet, žádné ruční obchody) → všechny účty; počítá se hned při renderu, efekt jen uloží „all“
 const acc=useMemo(()=>data?sanitizeFilter({...DEFAULT_FILTER,account},data.trades,data.accounts).account:account,[data,account]);
 useEffect(()=>{if(acc!==account){setAccount(acc);writeAccount(acc)}},[acc,account]);
 // vybraný účet hlásí Dashboardu (karta Otevřené pozice)
 useEffect(()=>{onAccount?.(acc)},[acc,onAccount]);
 const trades=useMemo(()=>data?.trades||[],[data]),cur=data?.currency||'USD',today=todayIso(now),y=Number(today.slice(0,4)),mo=Number(today.slice(5,7));
 const all=useMemo(()=>filterTrades(trades,{...DEFAULT_FILTER,account:acc},now),[trades,acc,now]);
 const list=useMemo(()=>filterTrades(trades,{...DEFAULT_FILTER,account:acc,period},now),[trades,acc,period,now]);
 const s=useMemo(()=>summary(list),[list]),streak=useMemo(()=>currentStreak(list),[list]),curve=useMemo(()=>equityCurve(all),[all]);
 const ps=useMemo(()=>period==='all'?null:periodStats(list.map((t):Trade=>({id:t.id,date:t.date,instrument:t.symbol,pnl:t.pnl,note:'',created:''})),period,today),[list,period,today]);
 const pick=(a:string)=>{setAccount(a);writeAccount(a)},choose=(p:P)=>{setPeriod(p);try{localStorage.setItem(PKEY,p)}catch{}};
 const periodLabel=period==='week'?'tento týden':period==='month'?months[mo-1]+' '+y:period==='year'?String(y):'celá historie';
 const title=(b:{label:string},i:number)=>period==='year'?months[i]+' '+y:period==='month'?`${b.label}. ${mo}. ${y}`:DAYS[i]||b.label;
 const hasManual=trades.some(t=>t.source==='manual');
 // maskot podle výsledku období: býk v zisku, medvěd ve ztrátě, dvojice bez obchodů / na nule
 const [mascot,mood]=!data?['mascots-pair','']:!s.count?['mascots-pair','Zatím klid – žádné uzavřené obchody']:s.total>0?['bull',`Býk je spokojený · ${fmtMoney(s.total,cur)} za ${PW[period]}`]:s.total<0?['bear',`Medvěd vládne · ${fmtMoney(s.total,cur)} za ${PW[period]}`]:['mascots-pair',`Vyrovnaně · ${fmtMoney(0,cur)} za ${PW[period]}`];
 const best=useMemo(()=>period==='month'||period==='week'?isBestPeriod(all,period,today):false,[all,period,today]);
 const head=<div className="d-head"><div className="d-mt-who"><img className="d-mt-mascot" src={`/landing/img/${mascot}.webp`} alt="" height={52}/><div><h2>Můj trading</h2>{mood&&<p className={'d-mt-mood '+tone(s.count?s.total:0)}>{mood}</p>}</div>{best&&<span className="d-mt-best">🏆 Nejlepší {period==='month'?'měsíc':'týden'}</span>}</div><div className="d-mt-ctl">
  {data&&<select className="d-mt-acc" aria-label="Účet" value={acc} onChange={e=>pick(e.target.value)}><option value="all">Všechny účty</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}{hasManual&&<option value="manual">Ručně zapsané</option>}</select>}
  <div className="d-seg sm" role="tablist" aria-label="Období">{PERIODS.map(([p,l])=><button key={p} type="button" role="tab" aria-selected={period===p} className={period===p?'on':''} onClick={()=>choose(p)}>{l}</button>)}</div>
 </div></div>;
 const ghost=(msg:React.ReactNode)=><div className="d-pnlwrap"><PnlChart buckets={GHOST} ghost/><div className="d-ghostmsg">{msg}</div></div>;
 if(!data)return <section className="d-card d-mt" style={style}>{head}{ghost(error?<><span>Obchody se nepodařilo načíst.</span><button type="button" className="d-btn" onClick={()=>load()}><RotateCcw size={14}/>Zkusit znovu</button></>:<span>Načítám obchody…</span>)}</section>;
 if(!all.length)return <section className="d-card d-mt" style={style}>{head}{ghost(<><span>{acc==='all'||acc==='manual'?'Zatím tu nejsou žádné obchody.':'Na tomto účtu zatím nejsou žádné uzavřené obchody.'}</span><div className="d-mt-cta">{(acc==='all'||acc==='manual')&&<a className="d-btn" href="/mt"><Link2 size={14}/>Připoj MetaTrader</a>}<button type="button" className="d-btn" onClick={onAddTrade}><Plus size={14}/>Zapsat obchod</button></div></>)}</section>;
 const wr=s.winRate??0,hot=streak.kind==='win'&&streak.count>=3,ddPct=drawdownPct(equityCurve(list),s.maxDrawdown),share=(n:number)=>s.count?n/s.count*100+'%':'0';
 const kpis:[string,string,LucideIcon,React.ReactNode,React.ReactNode,string?][]=[
  ['P&L','pnl '+tone(s.total),Wallet,fmtMoney(s.total,cur),s.count?<span className={'d-delta '+tone(s.total)}>{s.total>=0?<ArrowUpRight size={13}/>:<ArrowDownRight size={13}/>}{Math.round(wr)} % úspěšnost</span>:periodLabel,tone(s.total)],
  ['Obchody','cnt',CandlestickChart,String(s.count),<><span className="d-mt-split" aria-hidden="true"><i className="w" style={{width:share(s.wins)}}/><i className="l" style={{width:share(s.losses)}}/></span>{s.wins} v zisku · {s.losses} ve ztrátě</>],
  ['Win rate','wr '+(s.winRate===null?'':wrTone(wr)),Target,<span key="wr" className="d-mt-wr">{s.winRate===null?'—':fmtNum(s.winRate,1)+' %'}{s.winRate!==null&&<Ring pct={wr}/>}</span>,periodLabel],
  ['Série','streak'+(hot?' hot':''),Flame,streak.kind?<span className="d-mt-flames"><span aria-hidden="true">{Array.from({length:Math.min(5,streak.count)},(_,i)=><i key={i} style={{animationDelay:i*.17+'s'}}>{streak.kind==='win'?'🔥':'❄️'}</i>)}</span>{streak.count}</span>:'—',<>{streak.kind&&<>{pl(streak.count,streak.kind==='win'?WIN:LOSS)} v řadě · </>}nejdelší: {s.maxWinStreak} {pl(s.maxWinStreak,WIN)} · {s.maxLossStreak} {pl(s.maxLossStreak,LOSS)}</>,streak.kind==='win'?'up':streak.kind==='loss'?'down':''],
  ['Max drawdown','dd',TrendingDown,s.maxDrawdown?fmtMoney(-s.maxDrawdown,cur):'—',ddPct!==null&&s.maxDrawdown?<><span className="d-mt-split dd" aria-hidden="true"><i className="l" style={{width:ddPct+'%'}}/></span>{ddPct} % z maxima</>:'největší pokles od maxima',s.maxDrawdown?'down':'']];
 return <section className="d-card d-mt" style={style}>
  {head}
  <dl className="d-mt-kpi">{kpis.map(([k,cls,Icon,v,sub,c])=><div key={k} className={'d-mt-tile '+cls}><dt><i className="d-mt-ico"><Icon size={15}/></i>{k}</dt><dd className={c||''}>{v}</dd><dd className="d-mt-sub">{sub}</dd></div>)}</dl>
  <div className="d-mt-charts">
   {ps&&<div className="d-mt-chart"><h3>P&amp;L v období <span>· {periodLabel}</span></h3>
    {list.length?<div className="d-pnlwrap"><PnlChart buckets={ps.buckets} currency={cur} title={title}/></div>:ghost(<span>V tomto období žádné obchody.</span>)}
    <div className="d-axis d-ticks">{ps.buckets.map((x,i)=><span key={i}>{period!=='month'||i===0||(i+1)%5===0||(i===ps.buckets.length-1&&(i+1)%5>=3)?x.label:''}</span>)}</div>
   </div>}
   <div className="d-mt-chart"><h3>Celkový zisk <span>· celá historie</span></h3><Curve points={curve} currency={cur} fill end/></div>
  </div>
 </section>;
}
