'use client';
import {useEffect,useMemo,useState} from 'react';
import {Activity,Wallet,ShieldAlert,ShieldOff,Clock,CircleAlert,ChevronRight,type LucideIcon} from 'lucide-react';
import {levelBar,summarize,type OpenPosition} from '@/lib/positions/open';
import {fmtHold,fmtR,plural} from '@/lib/journal/format';
import {fmtMoney,fmtAmount} from '@/lib/trades';
import {fmtPrice} from './live';
import './open-positions.css';
type Data={currency:string;positions:OpenPosition[];summary:ReturnType<typeof summarize>};
const tone=(n:number|null)=>!n?'':n>0?'up':'down';
const POS=['otevřená pozice','otevřené pozice','otevřených pozic'] as const;
// objem: celé loty skloňovat (1 lot · 2 loty · 5 lotů), desetinné „0,5 lotu“
const lots=(v:number)=>v.toLocaleString('cs-CZ',{maximumFractionDigits:2})+' '+(Number.isInteger(v)?plural(v,['lot','loty','lotů']):'lotu');
// P&L v měně souhrnu, nepřevedené v měně účtu s ≈
const money=(p:OpenPosition,cur:string)=>p.pnl===null?'—':(p.converted?'':'≈ ')+fmtMoney(p.pnl,p.converted?cur:p.accountCurrency);
const ago=(ms:number)=>{const m=Math.floor(ms/60000);return m<1?'právě teď':m<60?`před ${m} min`:m<1440?`před ${Math.floor(m/60)} h`:`před ${Math.floor(m/1440)} d`};
// výběr účtu sdílený s Deníkem: all = vše, manual = ruční obchody (žádné MT pozice), jinak id MT účtu
export const byAccount=(list:OpenPosition[],account:string)=>account==='all'?list:account==='manual'?[]:list.filter(p=>p.accountId===account);
export const openTrade=(id:string)=>{location.hash='journal/'+encodeURIComponent('mt:'+id)};

// Otevřené pozice z API: při připojení a každých 60 s, jen když je stránka vidět; chyba nechá poslední data.
export function useOpenPositions(query=''){
 const [data,setData]=useState<Data|null>(null),[now,setNow]=useState(0);
 useEffect(()=>{let live=true;
  const load=async()=>{try{const r=await fetch('/api/positions/open'+query,{cache:'no-store'});if(!r.ok)return;const j=await r.json() as Data;if(live){setData(j);setNow(Date.now())}}catch{}};
  load();const t=setInterval(()=>{if(document.visibilityState==='visible')load()},60_000);
  const vis=()=>{if(document.visibilityState==='visible')load()};document.addEventListener('visibilitychange',vis);
  return()=>{live=false;clearInterval(t);document.removeEventListener('visibilitychange',vis)}},[query]);
 return {data,now};
}

// Pruh SL – vstup – TP s aktuální cenou (zisk vždy vpravo)
function Levels({p}:{p:OpenPosition}){
 const b=levelBar(p.side,p.openPrice,p.price,p.sl,p.tp);if(!b)return <span className="op-bar empty" aria-hidden="true"/>;
 const gain=b.price!==null&&b.price>=b.entry,lo=b.price===null?b.entry:Math.min(b.entry,b.price),hi=b.price===null?b.entry:Math.max(b.entry,b.price);
 const at=(v:number)=>({left:v+'%'});
 return <span className="op-bar" role="img" aria-label={`SL ${p.sl===null?'není':fmtPrice(p.sl)}, vstup ${fmtPrice(p.openPrice)}, cena ${p.price===null?'neznámá':fmtPrice(p.price)}, TP ${p.tp===null?'není':fmtPrice(p.tp)}`}>
  {b.price!==null&&<i className={'op-fill '+(gain?'up':'down')} style={{left:lo+'%',width:hi-lo+'%'}}/>}
  {b.sl!==null&&<i className="op-sl" style={at(b.sl)} title={'SL '+fmtPrice(p.sl!)}/>}
  {b.tp!==null&&<i className="op-tp" style={at(b.tp)} title={'TP '+fmtPrice(p.tp!)}/>}
  <i className="op-entry" style={at(b.entry)} title={'Vstup '+fmtPrice(p.openPrice)}/>
  {b.price!==null&&<i className={'op-price '+(gain?'up':'down')} style={at(b.price)} title={'Cena '+fmtPrice(p.price!)}/>}
 </span>;
}

// Seznam pozic: řádky na desktopu, karty na mobilu; klik otevře detail obchodu v Deníku
export function OpenPositionsList({positions,currency,now,onOpen=openTrade}:{positions:OpenPosition[];currency:string;now:number;onOpen?:(id:string)=>void}){
 return <ul className="op-list">{positions.map(p=><li key={p.id}><button type="button" className={'op-row'+(p.stale?' stale':'')} onClick={()=>onOpen(p.id)}>
  <span className="op-name"><b>{p.symbol}</b><em className={'op-side '+p.side}>{p.side}</em><small>{lots(p.volume)} · {p.account}</small></span>
  <span className="op-px"><small>Vstup → cena</small>{fmtPrice(p.openPrice)} → <b>{p.price===null?'—':fmtPrice(p.price)}</b></span>
  <span className="op-lv"><Levels p={p}/><small><span>SL {p.sl===null?'—':fmtPrice(p.sl)}</span><span>TP {p.tp===null?'—':fmtPrice(p.tp)}</span></small></span>
  <span className="op-pnl"><b className={tone(p.pnl)}>{money(p,currency)}</b><small className={tone(p.r)}>{p.sl===null?'bez SL':p.r===null?'– R':fmtR(p.r)}</small></span>
  <span className="op-time"><span><Clock size={12}/>{fmtHold(Math.max(0,now-p.openTs))}</span>{p.stale?<em className="op-stale"><CircleAlert size={12}/>EA neběží{p.updated!==null&&' · '+ago(Math.max(0,now-p.updated))}</em>:<small>{p.updated===null?'':ago(Math.max(0,now-p.updated))}</small>}</span>
  <ChevronRight size={16} className="op-go" aria-hidden="true"/>
 </button></li>)}</ul>;
}

// Souhrnné dlaždice: počet, plovoucí P&L, riziko, pozice bez SL
function Summary({list,currency}:{list:OpenPosition[];currency:string}){
 const s=summarize(list);
 const tiles:[string,string,LucideIcon,string,string?][]=[['Pozice','cnt',Activity,String(s.count)],['Plovoucí P&L','pnl '+tone(s.pnl),Wallet,list.every(p=>p.pnl===null)?'—':(s.converted?'':'≈ ')+fmtMoney(s.pnl,currency),s.converted?undefined:'část pozic bez kurzu – v měně účtu u řádku'],['Riziko','risk',ShieldAlert,s.risk?fmtAmount(s.risk,currency):'—','součet rizika do SL']];
 if(s.noSl)tiles.push(['Bez SL','nosl',ShieldOff,String(s.noSl),plural(s.noSl,['pozice nemá stop loss','pozice nemají stop loss','pozic nemá stop loss'])]);
 return <dl className="op-sum">{tiles.map(([k,cls,Icon,v,title])=><div key={k} className={'op-tile '+cls} title={title}><dt><i className="op-ico"><Icon size={14}/></i>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

// Dashboard: karta pod „Můj trading“, stejný výběr účtu; bez pozic skrytá
export function OpenPositionsCard({account,style}:{account:string;style?:React.CSSProperties}){
 const {data,now}=useOpenPositions(),list=useMemo(()=>byAccount(data?.positions||[],account),[data,account]);
 if(!data||!list.length)return null;
 return <section className="d-card d-op" style={style}>
  <div className="d-head"><h2>Otevřené pozice</h2><span className="d-meta">{list.length} {plural(list.length,POS)} · obnovuje se každou minutu</span></div>
  <Summary list={list} currency={data.currency}/>
  <OpenPositionsList positions={list} currency={data.currency} now={now}/>
 </section>;
}

// Deník: záložka „Otevřené“ (seznam filtrovaný účtem z filtru Deníku)
export function OpenPositionsTab({data,now,account,onOpen}:{data:Data|null;now:number;account:string;onOpen:(id:string)=>void}){
 const list=useMemo(()=>byAccount(data?.positions||[],account),[data,account]);
 if(!data)return <p className="j-muted">Načítám otevřené pozice…</p>;
 if(!list.length)return <div className="j-card j-empty"><p>Žádné otevřené pozice{account==='all'?'':' na tomto účtu'}.</p><p>Pozice z MetaTraderu se tu ukážou, jakmile je EA odešle.</p></div>;
 return <div className="j-card op-card"><Summary list={list} currency={data.currency}/><OpenPositionsList positions={list} currency={data.currency} now={now} onOpen={onOpen}/></div>;
}

// Detail trhu: pruh „Máš otevřenou pozici…“ pod nadpisem; bez pozic nic
export function MarketPositionBanner({instrument}:{instrument:string}){
 const {data,now}=useOpenPositions(),list=useMemo(()=>(data?.positions||[]).filter(p=>p.instrument===instrument),[data,instrument]);
 if(!data||!list.length)return null;
 return <div className="op-banner">{list.map(p=><button key={p.id} type="button" onClick={()=>openTrade(p.id)}>
  <span className="op-dot" aria-hidden="true"/>
  <span>Máš otevřenou pozici: <b className={'op-side '+p.side}>{p.side}</b> {lots(p.volume)} · <b className={tone(p.pnl)}>{money(p,data.currency)}</b> · SL {p.sl===null?'—':fmtPrice(p.sl)} · TP {p.tp===null?'—':fmtPrice(p.tp)}{p.stale&&<em className="op-stale"><CircleAlert size={12}/>EA neběží{p.updated!==null&&' · '+ago(Math.max(0,now-p.updated))}</em>}{!p.stale&&p.updated!==null&&<small> · {ago(Math.max(0,now-p.updated))}</small>}</span>
  <ChevronRight size={16} aria-hidden="true"/>
 </button>)}</div>;
}
