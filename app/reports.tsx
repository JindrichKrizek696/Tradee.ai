'use client';
import {Fragment,useState} from 'react';
import {CalendarDays,ChevronDown,Landmark,ListChecks,Users} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import type {FundamentalData} from '@/lib/fundamentals';
import {eventMarkets} from '@/lib/calendar';
import {assetNames} from '@/lib/markets';
import {stance,mood,nextMeeting,upcoming,isMeeting,parseRetail} from '@/lib/reports';
import {pairs,type MarketData} from '@/lib/score-engine';
import {pairBreakdown} from '@/lib/fundamentals/breakdown';
import {ScoreBreakdown} from './score-breakdown';
import {Link,Picker} from './score-analyzer';

const date=(s:string,time=false)=>new Date(s).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',...(time?{hour:'2-digit',minute:'2-digit'} as const:{})});
const day=(s:string)=>new Date(s).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',weekday:'short',day:'numeric',month:'numeric'});
const inDays=(s:string,now:number)=>{const d=Math.round((Date.parse(s)-now)/86400000);return d<=0?'dnes':d===1?'zítra':`za ${d} d`};
// Ověřené očekávání před zasedáním; u ostatních bank není v podkladech uložené, proto se sekce nezobrazí.
const expected:Record<string,string>={GBP:'Průzkum MaPS uzavřený 4. září: téměř všichni respondenti očekávali ponechání sazby. Zveřejněno zpětně v zápisu BoE.'};

function Pill({tone,children,title}:{tone:string;children:React.ReactNode;title?:string}){return <span className={'r-pill '+tone} title={title}>{children}</span>}

export function Reports({data,instrument,market,now:at}:{data:FundamentalData;instrument?:string;market?:MarketData;now?:number}){
 const [kind,setKind]=useState('banks'),[cur,setCur]=useState('all'),[open,setOpen]=useState<string|null>(null),[pair,setPair]=useState('EUR/USD');
 const now=Date.now(),all=Object.keys(data.currencies);
 const selected=instrument?(assetNames[instrument]?all:instrument.split('/')):cur==='all'?all:[cur];
 const link=(s:string)=>data.sources[s]?<Link url={data.sources[s].url}>{data.sources[s].label}</Link>:null;
 const events=upcoming(data.events.filter(e=>eventMarkets(e).some(c=>selected.includes(c))),now);
 const institutions=data.institutions.filter(i=>i.currencies.some(c=>selected.includes(c))).sort((a,b)=>b.date.localeCompare(a.date));
 const retail=Object.entries(data.pairObservations||{}).filter(([p,o])=>p.includes('/')&&p!=='USD/EUR'&&pairs.includes(p)&&o.retailPositions?.value&&(instrument?p===instrument:p.split('/').some(c=>selected.includes(c))));

 const calendar=<section className="s-card r-section"><div className="r-head"><h2><CalendarDays size={20}/> Co nás čeká</h2><span className="r-muted">Čas v Praze</span></div>
  {events.length?<div className="r-events">{events.map(e=><article key={e.id} className={'r-event'+(isMeeting(e)?' meeting':'')}>
   <div className="r-when"><b>{day(e.at)}</b><span>{e.timeKnown?new Date(e.at).toLocaleTimeString('cs-CZ',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit'}):'čas neověřen'}</span><small>{inDays(e.at,now)}</small></div>
   <div className="r-what"><div className="r-title">{e.currency&&<span className="r-cur">{e.currency}</span>}<b>{e.title}</b>{isMeeting(e)&&<Pill tone="meeting">Rozhodnutí banky</Pill>}</div>{e.watch&&<p>{e.watch}</p>}</div>
   <div className="r-exp">{e.consensus&&<span>Očekávání<b>{e.consensus}</b></span>}{e.actual&&<span>Výsledek<b>{e.actual}</b></span>}{!e.consensus&&!e.actual&&<span className="r-muted">Konsensus neověřen</span>}{link(e.source)}</div>
  </article>)}</div>:<p className="r-muted">Žádné nadcházející události pro vybrané měny.</p>}
 </section>;

 return <div className="r-page">
  <div className="s-heading"><div><span className="s-kicker">KOMUNIKACE × OČEKÁVÁNÍ</span><h1>Reporty</h1><p>Co banky udělaly, kam míří a co přijde.</p></div></div>
  {!instrument&&<div className="r-chips" role="group" aria-label="Filtr měn">{['all',...all].map(c=><button key={c} type="button" className={cur===c?'active':''} aria-pressed={cur===c} onClick={()=>setCur(c)}>{c==='all'?'Všechny měny':c}</button>)}</div>}
  <Tabs value={kind} onValueChange={setKind} className="s-tabs"><TabsList><TabsTrigger value="banks"><Landmark size={16}/> Banky a instituce</TabsTrigger><TabsTrigger value="traders"><Users size={16}/> Očekávání obchodníků</TabsTrigger>{market&&!instrument&&<TabsTrigger value="breakdown"><ListChecks size={16}/> Přehled skóre</TabsTrigger>}</TabsList>
  {market&&!instrument&&<TabsContent value="breakdown">
   <div className="r-breakdown-pick"><Picker label="Vybrat pár" value={pair} onChange={setPair} items={pairs.map(p=>({value:p,label:p}))}/></div>
   {(b=>b?<ScoreBreakdown b={b}/>:<p className="r-muted">Pro tento pár nejsou podklady.</p>)(pairBreakdown(pair,data,market,at??now))}
  </TabsContent>}
  <TabsContent value="banks">
   <section className="s-card r-section"><div className="r-head"><h2>Centrální banky</h2><span className="r-muted">Kliknutím na řádek zobrazíš detail</span></div>
    <div className="r-table-wrap"><table className="r-banks"><thead><tr><th>Měna</th><th>Banka</th><th>Sazba</th><th>Poslední krok</th><th>Výhled</th><th>Nálada</th><th>Příští zasedání</th><th aria-label="Detail"/></tr></thead><tbody>
    {selected.filter(c=>data.currencies[c]).map(c=>{const b=data.currencies[c],m=mood(b.factors),step=stance(b.factors.decision?.value),view=stance(b.factors.guidance?.value),next=nextMeeting(data.events,c,now),isOpen=open===c;
     return <Fragment key={c}><tr className={'r-row'+(isOpen?' open':'')} onClick={()=>setOpen(isOpen?null:c)} tabIndex={0} aria-expanded={isOpen} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setOpen(isOpen?null:c)}}}>
      <td><span className="r-cur">{c}</span></td><td className="r-bank">{b.bank}</td><td className="r-rate">{b.rate}</td>
      <td><Pill tone={step.tone} title={b.factors.decision?.reason}>{step.label}</Pill><small>{date(b.decisionDate)}</small></td>
      <td><Pill tone={view.tone} title={b.factors.guidance?.reason}>{view.label}</Pill></td>
      <td><Pill tone={m.tone+' strong'} title="Součet čtyř vstupů: krok banky, výhled sazeb, ekonomická aktivita a trh práce">{m.label}{m.score!==null&&<i>{m.score>0?'+':''}{m.score}</i>}</Pill></td>
      <td>{next?<><b>{date(next.at)}</b><small>{inDays(next.at,now)}</small></>:<span className="r-muted">neověřeno</span>}</td>
      <td><ChevronDown size={18} className="r-chevron"/></td></tr>
     {isOpen&&<tr className="r-detail"><td colSpan={8}><div className="r-detail-grid">
      <div><h3>Co banka vydala</h3><ul>{b.facts.map(f=><li key={f}>{f}</li>)}</ul>{expected[c]&&<><h3>Co se očekávalo předem</h3><p>{expected[c]}</p></>}</div>
      <div><h3>Další scénář</h3><p>{b.scenario}</p><h3>Riziko</h3><p>{b.risk}</p><div className="r-factors">{Object.entries(b.factors).map(([id,f])=><span key={id} title={f.reason}><Pill tone={stance(f.value).tone}>{({decision:'Krok',guidance:'Výhled',activity:'Aktivita',labor:'Trh práce'} as Record<string,string>)[id]||id}</Pill>{f.reason}</span>)}</div>{link(b.source)}</div>
     </div></td></tr>}</Fragment>})}
    </tbody></table></div>
   </section>
   {calendar}
   <section className="s-card r-section"><div className="r-head"><h2>Výhledy institucí</h2><span className="r-muted">Názory a nová data, nejnovější první</span></div>
    {institutions.length?<div className="r-insts">{institutions.map((i,n)=><article key={n} className="r-inst"><div className="r-inst-head"><b>{i.name}</b><small>{date(i.date)}</small></div><div className="r-tags">{i.currencies.map(c=><span key={c} className="r-cur">{c}</span>)}</div><p>{i.view}</p><small>{i.caveat}</small>{link(i.source)}</article>)}</div>:<p className="r-muted">Pro vybrané měny zatím není uložený žádný výhled.</p>}
   </section>
  </TabsContent>
  <TabsContent value="traders">
   {selected.includes('GBP')&&<section className="s-card r-section"><h2>Očekávání sazeb · GBP</h2><p>Průzkum MaPS ukazoval delší období stabilní sazby. OIS křivka byla výš a rostla; zápis BoE upozorňuje, že část pohybu představuje rizikovou prémii. Průzkum a tržní cena tedy nejsou stejná veličina.</p>{link('gbp-policy-sep26')}<small>Informace z 17. září 2026. Jde o zaznamenané očekávání, ne dnešní živý konsensus.</small></section>}
   <section className="s-card r-section"><div className="r-head"><h2>Retailové pozice</h2><span className="r-muted">Vzorek Myfxbook</span></div>
    {retail.length?<div className="r-retail">{retail.map(([p,o])=>{const r=o.retailPositions!,v=parseRetail(r.value!);return <div key={p} className="r-retail-row"><b>{p}</b>{v?<div className="r-bar" title={r.value!}><span style={{width:v.long+'%'}}>Long {v.long} %</span><span style={{width:v.short+'%'}}>Short {v.short} %</span></div>:<span>{r.value}</span>}<small>{r.checkedAt?'Kontrola '+date(r.checkedAt):r.period}</small><a className="s-source" href={r.sourceUrl} target="_blank" rel="noreferrer">Zdroj ↗</a></div>})}</div>:<p className="r-muted">Pro vybrané měny nejsou uložené retailové pozice.</p>}
    <small className="r-note">Vzorek brokerů popisuje otevřené pozice, ne názor všech obchodníků ani budoucí vývoj. Data mohou mít zpoždění a do skóre nevstupují.</small>
   </section>
   {calendar}
  </TabsContent></Tabs>
 </div>
}
