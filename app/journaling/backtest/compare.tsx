'use client';
// Porovnání dvou uložených běhů: parametry, souhrn s rozdílem a překryté křivky (v % kapitálu, aby šly srovnat i různé kapitály).
import {useMemo} from 'react';
import {X} from 'lucide-react';
import type {BacktestSummary} from '@/lib/backtest/metrics';
import {fmtMoney,fmtAmount} from '@/lib/trades';
import {fmtNum,fmtR,fmtDateTime} from '@/lib/journal/format';
import {EquityChart,type Series} from './equity-chart';
import {CUR,fmtPct,fmtPf,fmtPeriod,marketsText,rulesText,sqlMs,type Run} from './shared';
type Row=[string,(s:BacktestSummary)=>number|null,(v:number|null)=>string,1|-1|0]; // 1 = víc je lépe, −1 = méně je lépe
const ROWS:Row[]=[
 ['Obchody',s=>s.trades,v=>v===null?'–':fmtNum(v,0),0],
 ['Win rate',s=>s.winRate,v=>fmtPct(v),1],
 ['Čistý výsledek',s=>s.netPnl,v=>v===null?'–':fmtMoney(v,CUR),1],
 ['Výnos',s=>s.netPct,v=>fmtPct(v,2,true),1],
 ['Průměrné R',s=>s.avgR,fmtR,1],
 ['Celkem R',s=>s.totalR,fmtR,1],
 ['Expectancy',s=>s.expectancy,v=>v===null?'–':fmtMoney(v,CUR),1],
 ['Max. drawdown',s=>s.maxDrawdownPct,v=>v===null?'–':fmtPct(v,2),-1],
 ['Nejdelší série proher',s=>s.longestLosingStreak,v=>v===null?'–':fmtNum(v,0),-1]];
const pctPoints=(r:Run)=>r.result.equity.map(p=>({t:p.t,equity:(p.equity/r.params.capital-1)*100}));
export function Compare({runs,onClose}:{runs:[Run,Run];onClose:()=>void}){
 const [a,b]=runs;
 const series=useMemo<Series[]>(()=>[{label:'Běh A',points:pctPoints(a),cls:'a',raw:a.result.equity},{label:'Běh B',points:pctPoints(b),cls:'b',raw:b.result.equity}],[a,b]);
 const p=(r:Run)=>r.params;
 const info:[string,(r:Run)=>React.ReactNode][]=[['Spuštěno',r=>fmtDateTime(sqlMs(r.created))],['Trhy',r=>marketsText(p(r).markets)],['Rámec a období',r=>`${p(r).tf} · ${fmtPeriod(p(r).from,p(r).to)}`],['Kapitál a riziko',r=>`${fmtAmount(p(r).capital,CUR)} · ${fmtNum(p(r).riskPct,2)} %`],['Vstup',r=>rulesText(p(r).rules)]];
 return <section className="j-card bt-compare">
  <div className="bt-thead"><h2>Porovnání běhů</h2><button type="button" className="jg-x" aria-label="Zavřít porovnání" onClick={onClose}><X size={18}/></button></div>
  <div className="bt-cmpscroll"><table className="bt-cmp"><thead><tr><th/><th><i className="bt-dot a"/>Běh A</th><th><i className="bt-dot b"/>Běh B</th><th>Rozdíl B − A</th></tr></thead><tbody>
   {info.map(([k,f])=><tr key={k} className="info"><th scope="row">{k}</th><td>{f(a)}</td><td>{f(b)}</td><td/></tr>)}
   <tr className="info"><th scope="row">Profit factor</th><td>{fmtPf(a.summary)}</td><td>{fmtPf(b.summary)}</td><td/></tr>
   {ROWS.map(([k,get,fmt,better])=>{const va=get(a.summary),vb=get(b.summary),d=va===null||vb===null?null:Math.round((vb-va)*100)/100,good=d===null||!d||!better?'':(d>0)===(better>0)?'pos':'neg';
    return <tr key={k}><th scope="row">{k}</th><td>{fmt(va)}</td><td>{fmt(vb)}</td><td className={good}>{d===null?'–':d===0?'stejné':(d>0&&!fmt(d).startsWith('+')?'+':'')+fmt(d)}</td></tr>})}
  </tbody></table></div>
  <h3 className="bt-sub">Equity v % kapitálu</h3>
  <EquityChart series={series} base={0} fmt={v=>fmtPct(v,1,true)}/>
  <div className="bt-legend"><span><i className="bt-dot a"/>Běh A</span><span><i className="bt-dot b"/>Běh B</span></div>
 </section>;
}
