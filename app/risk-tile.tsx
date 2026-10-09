'use client';
import {useEffect,useMemo,useState} from 'react';
import {ShieldAlert,CircleAlert} from 'lucide-react';
import {maxPositionRisk} from '@/lib/positions/open';
import {plural} from '@/lib/journal/format';
import {fmtAmount,fmtMoney} from '@/lib/trades';
import {useOpenPositions,type OpenData} from './open-positions';
import './risk-tile.css';
const POS=['pozice','pozice','pozic'] as const,NOSL=['pozice bez SL','pozice bez SL','pozic bez SL'] as const,PROFIT=['pozice se SL v zisku','pozice se SL v zisku','pozic se SL v zisku'] as const;
const pc=(n:number)=>n.toLocaleString('cs-CZ',{minimumFractionDigits:0,maximumFractionDigits:2})+' %';
const pc1=(n:number)=>n.toLocaleString('cs-CZ',{minimumFractionDigits:1,maximumFractionDigits:1})+' %';
const sign=(n:number)=>!n?'':n>0?'up':'down';
// Barva podle podílu limitu: ≤ 50 % klid, ≤ 100 % pozor, nad limit červeně
export const riskTone=(pct:number,limit:number|null)=>limit===null||limit<=0?'':pct>limit?'down':pct>limit*0.5?'mid':'up';
type Limits={total:number|null;single:number|null};
function useLimits():Limits{
 const [l,setL]=useState<Limits>({total:null,single:null});
 useEffect(()=>{let live=true;
  fetch('/api/rules',{cache:'no-store'}).then(async r=>{if(!r.ok)return;const j=await r.json() as {rules:Record<string,{on:boolean;value:number|null}>};
   const v=(id:string)=>{const x=j.rules[id];return x&&x.on&&x.value!==null?x.value:null};
   if(live)setL({total:v('max_total_risk'),single:v('max_risk')})}).catch(()=>{});
  return()=>{live=false}},[]);
 return l;
}
// Deník → záložka Otevřené (záložka se pamatuje v localStorage deníku)
const goOpen=()=>{try{const k='tradee.journal',v=JSON.parse(localStorage.getItem(k)||'{}');localStorage.setItem(k,JSON.stringify({...v,tab:'open'}))}catch{}location.hash='journal'};

// Dashboard: otevřené riziko (součet rizika do aktuálních SL) proti limitu z pravidel; stejný výběr účtu jako ostatní dlaždice
export function RiskTile({account,style,shared}:{account:string;style?:React.CSSProperties;shared?:{data:OpenData|null}}){
 const own=useOpenPositions('',!shared),{data}=shared||own,limits=useLimits();
 const view=useMemo(()=>{
  if(!data||account==='manual'||!data.accounts.length)return null;
  const all=account==='all',acc=all?null:data.accounts.find(a=>a.accountId===account);
  if(!all&&!acc)return null;
  const positions=all?data.positions:data.positions.filter(p=>p.accountId===account);
  const eq=new Map(data.accounts.map(a=>[a.accountId,a.equity]));
  const m=maxPositionRisk(positions,id=>eq.get(id)??null);
  // jeden účet: částky v jeho měně; všechny: v měně souhrnu
  const t=all?{cur:data.currency,equity:data.total.equity,risk:data.total.risk,pct:data.total.riskPct,count:data.total.count,noSl:data.total.noSl,prof:data.total.slInProfit,floating:data.total.floating}
   :{cur:acc!.currency,equity:acc!.equity,risk:acc!.risk,pct:acc!.riskPct,count:acc!.count,noSl:acc!.noSl,prof:acc!.slInProfit,floating:acc!.floating};
  return {all,t,m};
 },[data,account]);
 if(!data||!view)return null;
 const {all,t,m}=view,key=(e:React.KeyboardEvent)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();goOpen()}};
 const tone=t.pct===null?'':riskTone(t.pct,limits.total);
 const empty=t.count===0;
 const rows=all?data.accounts:[];
 return <section className="d-card d-risk" style={style}>
  <div className="rk-main" role="link" tabIndex={0} onClick={goOpen} onKeyDown={key} aria-label="Otevřené riziko. Otevřít otevřené pozice v Deníku">
   <h2><ShieldAlert size={16}/>Riziko <span>· otevřené pozice</span></h2>
   {empty?<>
     <p className="rk-none">Žádné otevřené riziko</p>
     {t.equity!==null&&<p className="rk-sub">Equity {fmtAmount(t.equity,t.cur)}</p>}
    </>:<>
     <div className="rk-big"><p className={'rk-pct '+tone}>{t.pct===null?'—':pc1(t.pct)}</p><p className="rk-money">{fmtAmount(t.risk,t.cur)}{t.equity!==null&&<span> z equity {fmtAmount(t.equity,t.cur)}</span>}</p></div>
     <p className="rk-sub">Otevřené riziko · {limits.total!==null?`limit ${pc(limits.total)}`:'limit vypnutý'} · {t.count} {plural(t.count,POS)}</p>
    </>}
   {t.noSl>0&&<p className="rk-warn"><CircleAlert size={14}/>{t.noSl} {plural(t.noSl,NOSL)} – riziko není omezené</p>}
   {t.prof>0&&<p className="rk-muted">{t.prof} {plural(t.prof,PROFIT)} (riziko 0)</p>}
   {m&&<p className="rk-sub">Největší riziko: <b>{m.symbol}</b> <b className={riskTone(m.riskPct,limits.single)}>{pc1(m.riskPct)}</b>{limits.single!==null&&` (limit ${pc(limits.single)})`}</p>}
   {!empty&&<p className="rk-sub">Plovoucí P&L <b className={sign(t.floating)}>{fmtMoney(t.floating,t.cur)}</b></p>}
  </div>
  {rows.length>0&&<div className="rk-table" role="table" aria-label="Riziko podle účtů">
   <div className="rk-tr rk-th" role="row"><span role="columnheader">Účet</span><span role="columnheader">Equity</span><span role="columnheader">Riziko</span><span role="columnheader">Pozic</span><span role="columnheader">Plovoucí</span></div>
   {rows.map(a=><div key={a.accountId} className="rk-tr" role="row">
    <span className="rk-name" role="cell" data-l="Účet">{a.name}</span>
    <span role="cell" data-l="Equity">{a.equity===null?'—':fmtAmount(a.equity,a.currency)}</span>
    <span role="cell" data-l="Riziko" className={a.riskPct===null?'':riskTone(a.riskPct,limits.total)}>{a.count?`${fmtAmount(a.risk,a.currency)} · ${a.riskPct===null?'—':pc1(a.riskPct)}`:'—'}{a.noSl>0&&<em title="pozice bez SL"> · bez SL</em>}</span>
    <span role="cell" data-l="Pozic">{a.count}</span>
    <span role="cell" data-l="Plovoucí" className={a.count?sign(a.floating):''}>{a.count?fmtMoney(a.floating,a.currency):'—'}</span>
   </div>)}
   <div className="rk-tr rk-sum" role="row">
    <span className="rk-name" role="cell" data-l="Účet">Celkem</span>
    <span role="cell" data-l="Equity">{data.total.equity===null?'—':fmtAmount(data.total.equity,data.currency)}</span>
    <span role="cell" data-l="Riziko" className={data.total.riskPct===null?'':riskTone(data.total.riskPct,limits.total)}>{data.total.count?`${fmtAmount(data.total.risk,data.currency)} · ${data.total.riskPct===null?'—':pc1(data.total.riskPct)}`:'—'}</span>
    <span role="cell" data-l="Pozic">{data.total.count}</span>
    <span role="cell" data-l="Plovoucí" className={data.total.count?sign(data.total.floating):''}>{data.total.count?fmtMoney(data.total.floating,data.currency):'—'}</span>
   </div>
  </div>}
 </section>;
}
