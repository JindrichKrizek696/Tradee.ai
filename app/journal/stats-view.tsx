'use client';
import {useState} from 'react';
import type {JournalTrade} from '@/lib/journal/types';
import {summary,equityCurve,breakdown,type BreakdownBy} from '@/lib/journal/stats';
import {fmtMoney} from '@/lib/trades';
import {fmtHold,fmtR,fmtNum,tradesWord} from '@/lib/journal/format';
const BY:[BreakdownBy,string][]=[['tag','Tag'],['symbol','Pár'],['side','Směr'],['weekday','Den vstupu'],['hour','Hodina vstupu'],['hold','Délka držení']];
// Kumulovaný výsledek po obchodech; najetím myší (prstem) se ukáže obchod, jeho výsledek a průběžný součet.
export function Curve({points,currency}:{points:{ts:number;value:number}[];currency:string}){
 const [hover,setHover]=useState<number|null>(null),values=points.map(p=>p.value),n=values.length;
 const W=600,H=160,min=Math.min(0,...values),max=Math.max(0,...values),span=max-min||1;
 const x=(i:number)=>(i+1)/n*W,y=(v:number)=>H-4-(v-min)/span*(H-8);
 const d=`M0,${y(0).toFixed(1)}`+values.map((v,i)=>`L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
 const pick=(e:React.PointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect();setHover(Math.max(0,Math.min(n-1,Math.round((e.clientX-r.left)/r.width*n)-1)))};
 const p=hover===null?null:points[hover],delta=hover===null?0:values[hover]-(hover?values[hover-1]:0),hx=hover===null?0:x(hover)/W*100;
 return <div className="j-curvewrap" onPointerMove={pick} onPointerLeave={()=>setHover(null)}>
  <svg className="j-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Kumulovaný výsledek po ${n} obchodech`}><line x1="0" x2={W} y1={y(0)} y2={y(0)} className="zero"/><path d={d} className={(values.at(-1)??0)>=0?'pos':'neg'}/>{p&&<line x1={x(hover!)} x2={x(hover!)} y1="0" y2={H} className="guide"/>}</svg>
  {p&&<span className="j-curvedot" style={{left:hx+'%',top:y(p.value)/H*100+'%'}}/>}
  {p&&<div className="j-curvetip" role="status" style={{left:hx+'%',transform:`translateX(${hx<18?'-12%':hx>82?'-88%':'-50%'})`}}>
   <b>{hover!+1}. obchod · {new Date(p.ts).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague'})}</b>
   <span>Výsledek <em className={delta>0?'pos':delta<0?'neg':''}>{fmtMoney(delta,currency)}</em></span>
   <span>Celkem <em className={p.value>0?'pos':p.value<0?'neg':''}>{fmtMoney(p.value,currency)}</em></span>
  </div>}
 </div>;
}
export function StatsView({trades,currency}:{trades:JournalTrade[];currency:string}){
 const [by,setBy]=useState<BreakdownBy>('tag');
 if(!trades.length)return <p className="j-muted">Filtru neodpovídá žádný obchod.</p>;
 const s=summary(trades),curve=equityCurve(trades),groups=breakdown(trades,by),m=(v:number|null)=>v===null?'–':fmtMoney(v,currency),maxAbs=Math.max(1,...groups.map(g=>Math.abs(g.total)));
 const cards:[string,string,string?][]=[
  ['Obchody',String(s.count),`${s.wins} v zisku · ${s.losses} ve ztrátě`],
  ['Win rate',s.winRate===null?'–':fmtNum(s.winRate,1)+' %'],
  ['Profit factor',s.profitFactor===null?'–':fmtNum(s.profitFactor,2),s.profitFactor===null&&s.wins?'žádný ztrátový obchod':'zisky ÷ ztráty'],
  ['Expectancy',m(s.expectancy),s.expectancyR===null?'průměr na obchod':`${fmtR(s.expectancyR)} na obchod`],
  ['Celkem',m(s.total)],
  ['Prům. zisk / ztráta',`${m(s.avgWin)} / ${m(s.avgLoss)}`],
  ['Nejlepší / nejhorší',`${m(s.best)} / ${m(s.worst)}`],
  ['Série výher / proher',`${s.maxWinStreak} / ${s.maxLossStreak}`],
  ['Max. drawdown',s.maxDrawdown?m(-s.maxDrawdown):'–','největší pokles od maxima'],
  ['Prům. držení',fmtHold(s.avgHoldMs)]];
 return <div className="j-stats">
  <div className="j-cards">{cards.map(([k,v,sub])=><div key={k} className="j-card j-kpi"><span>{k}</span><b>{v}</b>{sub&&<small>{sub}</small>}</div>)}</div>
  {s.noRisk>0&&<p className="j-muted">Metriky v R počítají jen obchody se stop lossem – {s.noRisk} {tradesWord(s.noRisk)} bez SL.</p>}
  <section className="j-card"><h2>Vývoj výsledku</h2><Curve points={curve} currency={currency}/></section>
  <section className="j-card"><div className="j-bhead"><h2>Rozpad</h2><div className="j-tabs small" role="tablist">{BY.map(([k,l])=><button key={k} type="button" role="tab" aria-selected={by===k} className={by===k?'active':''} onClick={()=>setBy(k)}>{l}</button>)}</div></div>
   {groups.length?<table className="j-table j-break"><thead><tr><th>{BY.find(b=>b[0]===by)?.[1]}</th><th>Obchody</th><th>Win rate</th><th>Celkem</th><th>Exp. R</th><th aria-hidden="true"/></tr></thead>
    <tbody>{groups.map(g=><tr key={g.key}><td data-l="Skupina"><b>{g.label}</b></td><td data-l="Obchody">{g.count}</td><td data-l="Win rate">{fmtNum(g.winRate,1)} %</td><td data-l="Celkem" className={g.total>0?'pos':g.total<0?'neg':''}>{m(g.total)}</td><td data-l="Exp. R">{fmtR(g.expectancyR)}</td><td className="j-barcell" aria-hidden="true"><span className={g.total>=0?'pos':'neg'} style={{width:Math.abs(g.total)/maxAbs*100+'%'}}/></td></tr>)}</tbody></table>
   :<p className="j-muted">{by==='hour'||by==='hold'||by==='side'?'Tenhle rozpad mají jen obchody z MetaTraderu.':'Žádná data.'}</p>}
  </section>
 </div>;
}
