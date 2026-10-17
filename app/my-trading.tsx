'use client';
import {useEffect,useMemo,useState} from 'react';
import {ArrowUpRight,ArrowDownRight,RotateCcw,Plus,Link2,Wallet,CandlestickChart,Target,Flame,TrendingDown,type LucideIcon} from 'lucide-react';
import type {JournalList} from '@/lib/journal/types';
import {DEFAULT_FILTER,filterTrades,sanitizeFilter,summary,equityCurve,currentStreak,isBestPeriod,drawdownPct,prevMonthRange,validRange,defaultCustomRange,rangeLabel} from '@/lib/journal/stats';
import {fmtNum,plural as pl} from '@/lib/journal/format';
import {fmtMoney,periodStats,type Trade,type Bucket} from '@/lib/trades';
import {readAccount,writeAccount} from './journal/account-pref';
import {Curve} from './journal/stats-view';
import {PnlChart,GHOST} from './pnl-chart';
import {months,todayIso} from './trade-calendar';
import './journal/journal.css';
export type P='week'|'month'|'prevmonth'|'year'|'all'|'custom';
export type Range={from:string;to:string};
const PERIODS:[P,string][]=[['week','Týden'],['month','Měsíc'],['prevmonth','Minulý měsíc'],['year','Rok'],['all','Vše'],['custom','Vlastní']],PKEY='tradee.mytrading.period',RKEY='tradee.mytrading.range';
const DAYS=['Pondělí','Úterý','Středa','Čtvrtek','Pátek','Sobota','Neděle'];
const PW:Record<P,string>={week:'týden',month:'měsíc',prevmonth:'minulý měsíc',year:'rok',all:'celou dobu',custom:''};
const pad=(n:number)=>String(n).padStart(2,'0');
// sloupce grafu pro vlastní rozsah: dny (do 62 dnů), jinak měsíce
function customBuckets(list:{date:string;pnl:number}[],from:string,to:string,today:string){
 const keys:string[]=[],days=(Date.parse(to)-Date.parse(from))/864e5+1,byDay=days<=62,sums=new Map<string,number>();
 for(const t of list){const k=byDay?t.date:t.date.slice(0,7);sums.set(k,(sums.get(k)||0)+t.pnl)}
 if(byDay)for(let i=0;i<days;i++)keys.push(new Date(Date.parse(from)+i*864e5).toISOString().slice(0,10));
 else{let y=Number(from.slice(0,4)),m=Number(from.slice(5,7));while(`${y}-${pad(m)}`<=to.slice(0,7)){keys.push(`${y}-${pad(m)}`);if(++m>12){m=1;y++}}}
 const now=byDay?today:today.slice(0,7);let cum=0;
 return keys.map((k,i):Bucket=>{const pnl=Math.round((sums.get(k)||0)*100)/100,future=k>now;if(!future)cum+=pnl;return {label:byDay?String(Number(k.slice(8)))+(i===0||k.endsWith('-01')?'.'+Number(k.slice(5,7)):''):months[Number(k.slice(5))-1].slice(0,3),pnl,future,cum:future?null:Math.round(cum*100)/100}});
}
const tone=(n:number)=>n>0?'up':n<0?'down':'';
const WIN=['výhra','výhry','výher'] as const,LOSS=['prohra','prohry','proher'] as const;
// win rate: < 40 % medvěd, 40–55 % jantar, > 55 % býk
const wrTone=(w:number)=>w<40?'down':w<=55?'mid':'up';
// prstenec win rate (obvod kruhu r=16)
const Ring=({pct}:{pct:number})=><svg className="d-mt-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16"/><circle cx="20" cy="20" r="16" strokeDasharray={`${pct/100*100.53} 100.53`} transform="rotate(-90 20 20)"/></svg>;
// Souhrn vlastního obchodování nahoře na Dashboardu: stejná data a výpočty jako Deník, účet sdílený s Deníkem.
export function MyTrading({now,onAddTrade,onAccount,onPeriod,rev=0,style}:{now:number;onAddTrade:()=>void;onAccount?:(a:string)=>void;onPeriod?:(p:P,r:Range)=>void;rev?:number;style?:React.CSSProperties}){
 const [data,setData]=useState<JournalList|null>(null),[error,setError]=useState(''),[account,setAccount]=useState('all'),[period,setPeriod]=useState<P>('month'),[range,setRange]=useState<Range>({from:'',to:''}),[draft,setDraft]=useState<Range>({from:'',to:''});
 async function load(){try{const r=await fetch('/api/journal',{cache:'no-store'});const j=await r.json() as JournalList&{error?:string};if(!r.ok)throw Error(j.error||'');setData(j);setError('')}catch(e){setError((e as Error).message||'Obchody se nepodařilo načíst.')}}
 // volby z prohlížeče až po připojení (Dashboard se renderuje i na serveru)
 useEffect(()=>{setAccount(readAccount());try{const p=localStorage.getItem(PKEY);if(PERIODS.some(x=>x[0]===p))setPeriod(p as P)}catch{}
  let r:Range|null=null;try{const j=JSON.parse(localStorage.getItem(RKEY)||'null');if(j&&validRange(j.from,j.to))r={from:j.from,to:j.to}}catch{}
  const [df,dt]=defaultCustomRange(Date.now()),v=r||{from:df,to:dt};setRange(v);setDraft(v)},[]);
 useEffect(()=>{load()},[rev]);
 // uložený účet mohl zmizet (smazaný MT účet, žádné ruční obchody) → všechny účty; počítá se hned při renderu, efekt jen uloží „all“
 const acc=useMemo(()=>data?sanitizeFilter({...DEFAULT_FILTER,account},data.trades,data.accounts).account:account,[data,account]);
 useEffect(()=>{if(acc!==account){setAccount(acc);writeAccount(acc)}},[acc,account]);
 // vybraný účet hlásí Dashboardu (karta Otevřené pozice)
 useEffect(()=>{onAccount?.(acc)},[acc,onAccount]);
 useEffect(()=>{onPeriod?.(period,range)},[period,range,onPeriod]);
 const trades=useMemo(()=>data?.trades||[],[data]),cur=data?.currency||'USD',today=todayIso(now),y=Number(today.slice(0,4)),mo=Number(today.slice(5,7));
 const all=useMemo(()=>filterTrades(trades,{...DEFAULT_FILTER,account:acc},now),[trades,acc,now]);
 const list=useMemo(()=>filterTrades(trades,{...DEFAULT_FILTER,account:acc,period,from:range.from,to:range.to},now),[trades,acc,period,range,now]);
 const s=useMemo(()=>summary(list),[list]),streak=useMemo(()=>currentStreak(list),[list]),curve=useMemo(()=>equityCurve(all),[all]);
 const [pf]=prevMonthRange(today),ps=useMemo(()=>{
  if(period==='all')return null;
  const tl=list.map((t):Trade=>({id:t.id,date:t.date,instrument:t.symbol,pnl:t.pnl,note:'',created:''}));
  if(period==='custom'){const b=customBuckets(tl,range.from,range.to,today);return {buckets:b}}
  return periodStats(tl,period==='prevmonth'?'month':period,period==='prevmonth'?prevMonthRange(today)[1]:today);
 },[list,period,today,range]);
 const pick=(a:string)=>{setAccount(a);writeAccount(a)},choose=(p:P)=>{setPeriod(p);try{localStorage.setItem(PKEY,p)}catch{}},
  rangeOk=validRange(draft.from,draft.to),
  edit=(k:'from'|'to',v:string)=>{const d={...draft,[k]:v};setDraft(d);if(validRange(d.from,d.to)){setRange(d);try{localStorage.setItem(RKEY,JSON.stringify(d))}catch{}}};
 const rl=rangeLabel(range.from,range.to,today),periodLabel=period==='week'?'tento týden':period==='month'?months[mo-1]+' '+y:period==='prevmonth'?months[Number(pf.slice(5,7))-1]+' '+pf.slice(0,4):period==='year'?String(y):period==='custom'?rl:'celá historie',pw=period==='custom'?rl:PW[period];
 const title=(b:{label:string},i:number)=>period==='year'?months[i]+' '+y:period==='month'?`${b.label}. ${mo}. ${y}`:period==='prevmonth'?`${b.label}. ${Number(pf.slice(5,7))}. ${pf.slice(0,4)}`:period==='custom'?(b.label.includes('.')||/^\D/.test(b.label)?b.label:`${b.label}.`):DAYS[i]||b.label;
 const tick=(i:number,n:number)=>period==='month'||period==='prevmonth'?i===0||(i+1)%5===0||(i===n-1&&(i+1)%5>=3):period==='custom'&&n>12?i%Math.ceil(n/10)===0:true;
 const hasManual=trades.some(t=>t.source==='manual');
 // maskot podle výsledku období: býk v zisku, medvěd ve ztrátě, dvojice bez obchodů / na nule
 const [mascot,mood]=!data?['/landing/img/mascots-pair.webp','']:!s.count?['/brand/poses/bull-laptop.webp','Zatím klid – žádné uzavřené obchody']:s.total>0?['/brand/poses/bull-celebrate.webp',`Býk je spokojený · ${fmtMoney(s.total,cur)} za ${pw}`]:s.total<0?['/brand/poses/bear-celebrate.webp',`Medvěd vládne · ${fmtMoney(s.total,cur)} za ${pw}`]:['/landing/img/mascots-pair.webp',`Vyrovnaně · ${fmtMoney(0,cur)} za ${pw}`];
 const best=useMemo(()=>period==='month'||period==='week'?isBestPeriod(all,period,today):false,[all,period,today]);
 const head=<div className="d-head"><div className="d-mt-who"><img className="d-mt-mascot" src={mascot} alt="" height={64}/><div><h2>Můj trading</h2>{mood&&<p className={'d-mt-mood '+tone(s.count?s.total:0)}>{mood}</p>}</div>{best&&<span className="d-mt-best">🏆 Nejlepší {period==='month'?'měsíc':'týden'}</span>}</div><div className="d-mt-ctl">
  {data&&<select className="d-mt-acc" aria-label="Účet" value={acc} onChange={e=>pick(e.target.value)}><option value="all">Všechny účty</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}{hasManual&&<option value="manual">Ručně zapsané</option>}</select>}
  <div className="d-seg sm" role="tablist" aria-label="Období">{PERIODS.map(([p,l])=><button key={p} type="button" role="tab" aria-selected={period===p} className={period===p?'on':''} onClick={()=>choose(p)}>{l}</button>)}</div>
  {period==='custom'&&<div className="d-mt-range"><label>Od<input type="date" value={draft.from} max={draft.to||undefined} onChange={e=>edit('from',e.target.value)} aria-invalid={!rangeOk}/></label><label>Do<input type="date" value={draft.to} min={draft.from||undefined} onChange={e=>edit('to',e.target.value)} aria-invalid={!rangeOk}/></label>{!rangeOk&&<span className="d-mt-rerr" role="alert">Datum „od“ musí být před „do“.</span>}</div>}
 </div></div>;
 const ghost=(msg:React.ReactNode)=><div className="d-pnlwrap"><PnlChart buckets={GHOST} ghost/><div className="d-ghostmsg">{msg}</div></div>;
 if(!data)return <section className="d-card d-mt" style={style}>{head}{ghost(error?<><span>Obchody se nepodařilo načíst.</span><button type="button" className="d-btn" onClick={()=>load()}><RotateCcw size={14}/>Zkusit znovu</button></>:<span>Načítám obchody…</span>)}</section>;
 if(!all.length)return <section className="d-card d-mt" style={style}>{head}{ghost(<><span>{acc==='all'||acc==='manual'?'Zatím tu nejsou žádné obchody.':'Na tomto účtu zatím nejsou žádné uzavřené obchody.'}</span><div className="d-mt-cta">{(acc==='all'||acc==='manual')&&<a className="d-btn" href="/mt"><Link2 size={14}/>Připoj MetaTrader</a>}<button type="button" className="d-btn primary" onClick={onAddTrade}><Plus size={14}/>Zapsat obchod</button></div></>)}</section>;
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
    <div className="d-axis d-ticks">{ps.buckets.map((x,i)=><span key={i}>{tick(i,ps.buckets.length)?x.label:''}</span>)}</div>
   </div>}
   <div className="d-mt-chart"><h3>Celkový zisk <span>· celá historie</span></h3><Curve points={curve} currency={cur} fill end/></div>
  </div>
 </section>;
}
