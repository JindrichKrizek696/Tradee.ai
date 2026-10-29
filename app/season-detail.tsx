'use client';
// Detail sezonality (záložka v detailu trhu): vzorek 3/5/10/15/20 let, počet použitých let, rozptyl (odchylka, min/max),
// stabilita mezi první a druhou polovinou vzorku, volitelné odstranění trendu, pohled podle měsíců v roce a dnů v týdnu,
// varování při krátkém vzorku a export parametrů do CSV. Skóre se tím nemění (používá pevný vzorek 10 let).
import {useMemo,useState} from 'react';
import {Download} from 'lucide-react';
import {pct,type PriceData} from '@/lib/score-engine';
import {seasonDetail,monthOfYear,dayOfWeek,seasonCsv,LOOKBACKS} from '@/lib/seasonality';
import './analysis-detail.css';
const MONTHS=['Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];
const f=(n:number,d=2)=>{const v=Math.round(n*10**d)/10**d;return (v>0?'+':'')+(v===0?0:v).toLocaleString('cs-CZ',{minimumFractionDigits:d,maximumFractionDigits:d})};
const tone=(n:number)=>n>0?'positive':n<0?'negative':'';
type View='month'|'year'|'dow';
export function SeasonDetail({price,instrument,month,setMonth}:{price:PriceData|undefined;instrument:string;month:number;setMonth:(n:number)=>void}){
 const [look,setLook]=useState(10),[detrend,setDetrend]=useState(false),[view,setView]=useState<View>('month');
 const s=useMemo(()=>seasonDetail(price,month,look,detrend),[price,month,look,detrend]);
 const moy=useMemo(()=>monthOfYear(price,look,detrend),[price,look,detrend]);
 const dow=useMemo(()=>dayOfWeek(price?.pricePath||[]),[price]);
 if(!price)return <section className="s-card"><h2>Sezonalita</h2><p>Historie není dostupná.</p></section>;
 const maxAbs=Math.max(...s.years.map(y=>Math.abs(y.value)),.01),moyMax=Math.max(...moy.map(m=>Math.abs(m.avg)),.01),dowMax=Math.max(...dow.rows.map(r=>Math.abs(r.avg)),.0001);
 const exportCsv=()=>{const blob=new Blob(['﻿'+seasonCsv({instrument,source:price.sourceUrl,asOf:price.asOf,detail:s,moy,dow})],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`sezonalita-${instrument.replace(/[^A-Za-z0-9]+/g,'-')}-${month}-${look}let${detrend?'-bez-trendu':''}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
 const bar=(v:number,max:number)=><div className="s-diverge"><i style={{width:Math.abs(v)/max*48+'%',left:v>=0?'50%':undefined,right:v<0?'50%':undefined,background:v>=0?'var(--bull)':'var(--bear)'}}/></div>;
 return <section className="s-card ad-season">
  <div className="s-card-head"><div><span className="s-kicker">HISTORIE, NE PŘEDPOVĚĎ</span><h2>Sezonalita · {instrument}</h2></div><button type="button" className="al-btn" onClick={exportCsv}><Download size={15} aria-hidden/>Export CSV</button></div>
  <div className="ad-chips" role="group" aria-label="Pohled">{([['month','Vybraný měsíc'],['year','Měsíce v roce'],['dow','Dny v týdnu']] as [View,string][]).map(([v,l])=><button key={v} type="button" className={'c-chip'+(view===v?' on':'')} aria-pressed={view===v} onClick={()=>setView(v)}>{l}</button>)}</div>
  {view!=='dow'&&<div className="ad-chips" role="group" aria-label="Vzorek"><span className="ad-lab">Vzorek</span>{LOOKBACKS.map(l=><button key={l} type="button" className={'c-chip'+(look===l?' on':'')} aria-pressed={look===l} onClick={()=>setLook(l)}>{l} let</button>)}<label className="c-switch"><input type="checkbox" checked={detrend} onChange={e=>setDetrend(e.target.checked)}/>bez trendu</label></div>}
  {view==='month'&&<>
   <div className="ad-chips" role="group" aria-label="Měsíc">{MONTHS.map((m,i)=><button key={m} type="button" className={'c-chip'+(month===i+1?' on':'')} aria-pressed={month===i+1} onClick={()=>setMonth(i+1)}>{m.slice(0,3)}</button>)}</div>
   {s.warning&&<p className="s-note warning" role="status">{s.warning}</p>}
   <div className="ad-stats">
    <div><small>Použito let</small><b>{s.n} / {s.requested}</b><em>{s.years[0]?.year??'—'}–{s.years.at(-1)?.year??'—'}</em></div>
    <div><small>Průměr {MONTHS[month-1].toLowerCase()}</small><b className={tone(s.avg)}>{f(pct(s.avg))} %</b><em>medián {f(pct(s.median))} %</em></div>
    <div><small>Směrodatná odchylka</small><b>{s.sd.toLocaleString('cs-CZ',{maximumFractionDigits:2})} p. b.</b><em>log výnosy</em></div>
    <div><small>Min / max</small><b><span className={tone(s.min)}>{f(pct(s.min),1)}</span> / <span className={tone(s.max)}>{f(pct(s.max),1)}</span> %</b></div>
    <div><small>Kladné roky</small><b>{s.positive} / {s.n}</b><em>záporné {s.negative}</em></div>
    <div><small>Stabilita</small><b>{s.stable===null?'—':s.stable?'stejný směr':'mění se'}</b><em>1. pol. {f(pct(s.first.avg))} % · 2. pol. {f(pct(s.second.avg))} %</em></div>
   </div>
   <div className="s-year-bars">{s.years.map(y=><div key={y.year} className="ad-yr"><span>{y.year}</span>{bar(y.value,maxAbs)}<b className={tone(y.value)}>{f(pct(y.value))} %</b></div>)}</div>
   <p className="s-note">Stabilita porovnává starší a novější polovinu vzorku ({s.first.n} + {s.second.n} let). {detrend?'Bez trendu: od výnosu měsíce je odečten průměrný měsíční výnos daného roku, takže zůstává jen sezónní odchylka. ':''}Skóre používá pevný vzorek 10 let a aktuální měsíc; tento pohled ho nemění.</p>
  </>}
  {view==='year'&&<>
   {moy.some(m=>m.warning)&&<p className="s-note warning" role="status">{moy.find(m=>m.warning)!.warning}</p>}
   <table className="ad-table"><thead><tr><th>Měsíc</th><th>Let</th><th>Průměr</th><th></th><th>Odchylka</th><th>Kladné</th><th>Stabilita</th></tr></thead>
    <tbody>{moy.map(m=><tr key={m.month} className={m.month===month?'on':''} onClick={()=>{setMonth(m.month);setView('month')}}><td>{MONTHS[m.month-1]}</td><td>{m.n}</td><td className={tone(m.avg)}>{f(pct(m.avg))} %</td><td className="ad-bar">{bar(m.avg,moyMax)}</td><td>{m.sd.toLocaleString('cs-CZ',{maximumFractionDigits:2})}</td><td>{m.positive}/{m.n}</td><td>{m.stable===null?'—':m.stable?'✓':'×'}</td></tr>)}</tbody></table>
   <p className="s-note">Kliknutím na měsíc otevřeš jeho detail. Průměry jsou z log výnosů{detrend?' bez trendu roku':''}.</p>
  </>}
  {view==='dow'&&<>
   {dow.days<250&&<p className="s-note warning" role="status">Krátký vzorek: jen {dow.days} denních výnosů ({dow.from??'—'} až {dow.to??'—'}). Rozdíly mezi dny jsou v tak malém vzorku převážně šum.</p>}
   <table className="ad-table"><thead><tr><th>Den</th><th>Dnů</th><th>Průměr</th><th></th><th>Odchylka</th><th>Kladné</th></tr></thead>
    <tbody>{dow.rows.map(r=><tr key={r.dow}><td>{r.label}</td><td>{r.n}</td><td className={tone(r.avg)}>{f(r.avg,3)} %</td><td className="ad-bar">{bar(r.avg,dowMax)}</td><td>{r.sd.toLocaleString('cs-CZ',{maximumFractionDigits:3})}</td><td>{r.positive}/{r.n}</td></tr>)}</tbody></table>
   <p className="s-note">Denní log výnos proti předchozímu obchodnímu dni z denní reference ({price.sourceUrl.includes('ecb')?'ECB':'zdroj ceny'}); pondělí obsahuje víkend.</p>
  </>}
  <p className="s-note">Data k {price.asOf} · <a className="s-source" href={price.sourceUrl} target="_blank" rel="noreferrer">zdroj denní historie ↗</a></p>
 </section>;
}
