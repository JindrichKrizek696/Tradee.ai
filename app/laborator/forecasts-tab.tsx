'use client';
// Laboratoř · Prognózy: přesnost prognóz Trading Economics a ING (směr proti ceně v době vydání, průměrná chyba proti ceně na konci horizontu). Jen vlastník (API vrací ostatním 404).
import {useEffect,useState} from 'react';
import {fmtNum} from '@/lib/journal/format';
import type {SourceStat} from '@/lib/forecasts/eval';
import type {Forecasts} from '@/lib/forecasts/core';
import ForecastCard from '../forecast-card';
type Data={stats:SourceStat[];snapshots:number;today:string;missing?:boolean;current?:Forecasts};
const NAMES:Record<string,string>={te:'Trading Economics',ing:'ING Think'};
const pc=(v:number|null)=>v===null?'–':fmtNum(v*100,0)+' %';
const e2=(v:number|null)=>v===null?'–':(v>0?'+':v<0?'−':'')+fmtNum(Math.abs(v),2)+' %';
export function ForecastsTab(){
 const [d,setD]=useState<Data|null>(null),[err,setErr]=useState('');
 useEffect(()=>{fetch('/api/laborator/forecasts',{cache:'no-store'}).then(async r=>{const j=await r.json().catch(()=>({})) as Data&{error?:string};if(!r.ok)throw Error(j.error||'Nepodařilo se načíst.');setD(j)}).catch(e=>setErr((e as Error).message))},[]);
 return <><section className="mt-card">
  <h2>Prognózy</h2>
  <p className="mt-lead">Jak se trefují prognózy Trading Economics a ING u FX párů. Každá stažená prognóza se uloží s cenou v době vydání; po konci horizontu (konec čtvrtletí, 12 měsíců) se porovná se skutečnou cenou. Hit rate = zda cena skončila na té straně, kam prognóza mířila, vůči ceně v den vydání. Denní snímky stejného horizontu spolu silně souvisejí, proto jde o orientační číslo.</p>
  {err?<p className="mt-empty">{err}</p>:!d?<p className="mt-empty">Načítám…</p>:d.missing?<p className="mt-empty">Tabulka forecast_snapshots ještě neexistuje (migrace 0029 se pouští na VPS ručně).</p>
  :!d.stats.length||d.stats.every(s=>!s.resolved)?<p className="mt-empty">Zatím není co vyhodnotit: {d.snapshots} uložených prognóz, žádný horizont ještě neskončil. První výsledky přijdou po konci aktuálního čtvrtletí.</p>
  :<div className="lb-scroll"><table className="mt-table lb-table"><thead><tr><th>Zdroj</th><th>Prognóz</th><th>Vyhodnoceno</th><th>Čeká</th><th>Hit rate směru</th><th>Průměrná chyba</th><th>Průměrné vychýlení</th></tr></thead><tbody>
   {d.stats.map(s=><tr key={s.source}><td>{NAMES[s.source]??s.source}</td><td>{s.total}</td><td>{s.resolved}</td><td>{s.pending}</td><td>{pc(s.hitRate)} <small>({s.hits}/{s.directional})</small></td><td>{e2(s.mape)}</td><td>{e2(s.bias)}</td></tr>)}
  </tbody></table></div>}
 </section>{d?.current?.pairs&&<section className="mt-card"><h2>Aktuální prognózy FX</h2><p className="mt-lead">Vidíš jen ty – mimo Laboratoř se nezobrazují. Změna proti poslední ceně, ze které vycházel zdroj.</p><div className="lb-fc-grid">{Object.keys(d.current.pairs).sort().map(p=><div key={p}><h3>{p}</h3><ForecastCard pair={p} forecasts={d.current} spot={null}/></div>)}</div></section>}</>;
}