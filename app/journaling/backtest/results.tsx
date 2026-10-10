'use client';
// Výsledek jednoho běhu: souhrn, equity + drawdown, varování pokrytí, plán vs. realita, rozpad po trzích a seznam obchodů.
import {Fragment,useMemo,useState} from 'react';
import {TriangleAlert,ChevronDown,ChevronUp} from 'lucide-react';
import type {BacktestTrade} from '@/lib/backtest/engine';
import {fmtMoney,fmtAmount} from '@/lib/trades';
import {fmtNum,fmtR,fmtDateTime,plural} from '@/lib/journal/format';
import {EquityChart,type Series} from './equity-chart';
import {CUR,REASONS,fmtPct,fmtPf,fmtPeriod,tone,rulesText,sqlMs,type Run} from './shared';
const PAGE=50;
type SortKey='entryT'|'exitT'|'instrument'|'side'|'r'|'pnl'|'bars'|'reason';
const COLS:[SortKey,string][]=[['entryT','Vstup'],['instrument','Trh'],['side','Směr'],['exitT','Výstup'],['reason','Důvod'],['bars','Svíček'],['r','R'],['pnl','P&L']];
const DATA_NAMES:Record<string,string>={score:'Skóre Tradee',strength:'Síla měn',cot:'COT',news:'Kalendář zpráv'};
const price=(n:number)=>fmtNum(n,n>=1000?2:5);
export function Summary({run}:{run:Run}){
 const s=run.summary;
 const tiles:[string,React.ReactNode,React.ReactNode,string?][]=[
  ['Obchody',String(s.trades),`${s.wins} ${plural(s.wins,['výhra','výhry','výher'])} · ${s.losses} ${plural(s.losses,['prohra','prohry','proher'])}`],
  ['Win rate',fmtPct(s.winRate),'podíl obchodů v zisku'],
  ['Čistý výsledek',fmtMoney(s.netPnl,CUR),<>{fmtPct(s.netPct,2,true)} · konečný kapitál {fmtAmount(s.finalEquity,CUR)}</>,tone(s.netPnl)],
  ['Průměrné R',fmtR(s.avgR),`celkem ${fmtR(s.totalR)}`,tone(s.avgR)],
  ['Profit factor',fmtPf(s),s.profitFactor===null&&s.wins>0?'žádný ztrátový obchod':'zisky ÷ ztráty'],
  ['Expectancy',s.expectancy===null?'–':fmtMoney(s.expectancy,CUR),'průměr na obchod',tone(s.expectancy)],
  ['Max. drawdown',s.maxDrawdownPct?'−'+fmtPct(s.maxDrawdownPct,2):'–',s.maxDrawdown?fmtMoney(-s.maxDrawdown,CUR)+' od vrcholu':'bez poklesu',s.maxDrawdownPct?'neg':''],
  ['Nejdelší série proher',String(s.longestLosingStreak),plural(s.longestLosingStreak,['obchod','obchody','obchodů'])+' za sebou']];
 return <dl className="bt-tiles">{tiles.map(([k,v,sub,cls])=><div key={k} className="bt-tile"><dt>{k}</dt><dd className={cls}>{v}</dd><dd className="sub">{sub}</dd></div>)}</dl>;
}
function Plan({run}:{run:Run}){
 const p=run.result.plan,s=run.summary;
 if(!p)return null;
 const row=(k:string,a:React.ReactNode,b:React.ReactNode)=><tr><th scope="row">{k}</th><td>{a}</td><td>{b}</td></tr>;
 return <section className="j-card"><h2>Plán vs. realita</h2>
  {!p.trades?<p className="j-muted">Ve stejném období ({fmtPeriod(run.params.from,run.params.to)}) nemáš žádný obchod označený touto strategií. Strategii přiřadíš u obchodu v záložce Obchody.</p>:<>
  <table className="bt-plan"><thead><tr><th/><th>Backtest</th><th>Tvoje obchody</th></tr></thead><tbody>
   {row('Obchody',s.trades,p.trades)}
   {row('Win rate',fmtPct(s.winRate),fmtPct(p.winRate))}
   {row('Průměrné R',fmtR(s.avgR),<>{fmtR(p.avgR)}{p.withR<p.trades&&<small> ({p.withR} z {p.trades} se SL)</small>}</>)}
   {row('Celkem R',fmtR(s.totalR),fmtR(p.withR?p.totalR:null))}
   {row('Výsledek',<span className={tone(s.netPnl)}>{fmtMoney(s.netPnl,CUR)}</span>,<span className={tone(p.pnl)}>{fmtMoney(p.pnl,p.currency)}</span>)}
   {row('Porušení pravidel','–',p.violations?<span className="neg">{p.violations}× u {p.tradesWithViolations} {plural(p.tradesWithViolations,['obchodu','obchodů','obchodů'])}</span>:'žádné')}
  </tbody></table>
  <p className="bt-help">Tvoje obchody jsou ty, které máš v Journalingu označené touto strategií a zavřel jsi je ve stejném období. Výsledek backtestu je na modelovém účtu {fmtAmount(run.params.capital,CUR)}, tvůj ve měně účtu – srovnávej hlavně R a win rate.</p></>}
 </section>;
}
function Trades({trades,truncated}:{trades:BacktestTrade[];truncated:boolean}){
 const [sort,setSort]=useState<{k:SortKey;d:1|-1}>({k:'exitT',d:-1}),[page,setPage]=useState(0),[open,setOpen]=useState<number|null>(null),[market,setMarket]=useState('');
 const markets=useMemo(()=>[...new Set(trades.map(t=>t.instrument))].sort(),[trades]);
 const list=useMemo(()=>{const a=trades.map((t,i)=>({t,i})).filter(x=>!market||x.t.instrument===market);const k=sort.k;
  return a.sort((x,y)=>{const p=x.t[k],q=y.t[k];return (typeof p==='number'&&typeof q==='number'?p-q:String(p).localeCompare(String(q)))*sort.d||x.i-y.i})},[trades,sort,market]);
 const pages=Math.max(1,Math.ceil(list.length/PAGE)),p=Math.min(page,pages-1),shown=list.slice(p*PAGE,p*PAGE+PAGE);
 const by=(k:SortKey)=>{setSort(s=>({k,d:s.k===k?(s.d===1?-1:1):k==='instrument'||k==='side'||k==='reason'?1:-1}));setPage(0)};
 return <section className="j-card j-tablecard bt-trades">
  <div className="bt-thead"><h2>Obchody</h2>{markets.length>1&&<label className="j-field"><span className="sr-only">Trh</span><select value={market} onChange={e=>{setMarket(e.target.value);setPage(0);setOpen(null)}}><option value="">Všechny trhy</option>{markets.map(m=><option key={m}>{m}</option>)}</select></label>}<span className="j-muted">{list.length} {plural(list.length,['obchod','obchody','obchodů'])}{truncated&&' (jen posledních)'}</span></div>
  {!list.length?<p className="j-muted">Backtest nenašel žádný obchod – podmínky v tomto období ani jednou nenastaly současně.</p>:<>
  <table className="j-table bt-ttable"><thead><tr>{COLS.map(([k,l])=><th key={k} aria-sort={sort.k===k?(sort.d===1?'ascending':'descending'):undefined}><button type="button" onClick={()=>by(k)}>{l}{sort.k===k&&(sort.d===1?<ChevronUp size={12}/>:<ChevronDown size={12}/>)}</button></th>)}</tr></thead>
   <tbody>{shown.map(({t,i})=><Fragment key={i}><tr tabIndex={0} aria-expanded={open===i} className={open===i?'sel':''} onClick={()=>setOpen(open===i?null:i)} onKeyDown={e=>{if(e.key==='Enter')setOpen(open===i?null:i)}}>
    <td data-l="Vstup">{fmtDateTime(t.entryT)}</td>
    <td data-l="Trh"><b>{t.instrument}</b></td>
    <td data-l="Směr"><span className={'j-side '+(t.side==='long'?'buy':'sell')}>{t.side==='long'?'Long':'Short'}</span></td>
    <td data-l="Výstup">{fmtDateTime(t.exitT)}</td>
    <td data-l="Důvod">{REASONS[t.reason]}</td>
    <td data-l="Svíček">{t.bars}</td>
    <td data-l="R" className={tone(t.r)}>{fmtR(t.r)}</td>
    <td data-l="P&L" className={tone(t.pnl)}>{fmtMoney(t.pnl,CUR)}</td>
   </tr>{open===i&&<tr className="bt-detail"><td colSpan={COLS.length}><dl>
    <div><dt>Vstupní cena</dt><dd>{price(t.entryPrice)}</dd></div><div><dt>Výstupní cena</dt><dd>{price(t.exitPrice)}</dd></div>
    <div><dt>Stop loss</dt><dd>{price(t.sl)}</dd></div><div><dt>Take profit</dt><dd>{t.tp===null?'–':price(t.tp)}</dd></div>
    <div><dt>Riziko</dt><dd>{fmtAmount(t.risk,CUR)}</dd></div><div><dt>Výsledek</dt><dd className={tone(t.pnl)}>{fmtR(t.r)} · {fmtMoney(t.pnl,CUR)}</dd></div>
   </dl><p className="bt-help">Ceny vstupu a výstupu jsou včetně spreadu, úrovně SL a TP jsou střední ceny. Graf trhu s vyznačeným obchodem přibude později.</p></td></tr>}</Fragment>)}</tbody></table>
  {pages>1&&<div className="j-pager"><button type="button" disabled={p===0} onClick={()=>setPage(p-1)}>← Předchozí</button><span>{p+1} / {pages}</span><button type="button" disabled={p>=pages-1} onClick={()=>setPage(p+1)}>Další →</button></div>}</>}
 </section>;
}
export function Results({run}:{run:Run}){
 const r=run.result,pm=run.params;
 const series=useMemo<Series[]>(()=>[{label:'Equity',points:r.equity,cls:'a'}],[r.equity]);
 const cov=Object.entries(r.coverage||{}).filter(([,c])=>c&&c.bars>0);
 const pmSorted=useMemo(()=>[...r.perMarket].sort((a,b)=>b.pnl-a.pnl),[r.perMarket]);
 return <div className="bt-results">
  <div className="bt-runhead"><h2>Výsledek</h2><span className="j-muted">{pm.markets.length} {plural(pm.markets.length,['trh','trhy','trhů'])} · {pm.tf} · {fmtPeriod(pm.from,pm.to)} · kapitál {fmtAmount(pm.capital,CUR)} · riziko {fmtNum(pm.riskPct,2)} % · spuštěno {fmtDateTime(sqlMs(run.created))}</span><span className="bt-rtext">{rulesText(pm.rules)}</span></div>
  {r.warnings.length>0&&<div className="bt-warn" role="status"><TriangleAlert size={16}/><div><b>Na co si dát pozor</b><ul>{r.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>
   {cov.length>0&&<p>Pokrytí dat Tradee: {cov.map(([k,c],i)=><span key={k}>{i>0&&' · '}{DATA_NAMES[k]||k} {c!.first!==null&&c!.last!==null?fmtPeriod(c!.first,c!.last+1):'bez dat'} ({fmtNum(100-100*c!.missing/c!.bars,0)} % svíček s daty)</span>)}</p>}</div></div>}
  <Summary run={run}/>
  <section className="j-card"><h2>Equity a drawdown</h2><EquityChart series={series} base={pm.capital} fmt={v=>fmtAmount(Math.round(v),CUR)}/></section>
  <Plan run={run}/>
  {pmSorted.length>1&&<section className="j-card j-tablecard"><table className="j-table bt-pm"><caption>Po trzích</caption><thead><tr><th>Trh</th><th>Svíček</th><th>Obchodů</th><th>Win rate</th><th>Celkem R</th><th>Prům. R</th><th>P&L</th></tr></thead>
   <tbody>{pmSorted.map(m=><tr key={m.instrument}><td data-l="Trh"><b>{m.instrument}</b></td><td data-l="Svíček">{fmtNum(m.bars,0)}</td><td data-l="Obchodů">{m.trades}</td><td data-l="Win rate">{fmtPct(m.winRate)}</td><td data-l="Celkem R" className={tone(m.totalR)}>{fmtR(m.totalR)}</td><td data-l="Prům. R">{fmtR(m.avgR)}</td><td data-l="P&L" className={tone(m.pnl)}>{fmtMoney(m.pnl,CUR)}</td></tr>)}</tbody></table></section>}
  <Trades key={run.id} trades={r.trades} truncated={r.truncated}/>
 </div>;
}
