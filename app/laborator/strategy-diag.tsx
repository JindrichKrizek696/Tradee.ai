'use client';
// Laboratoř · Strategie (jen vlastník): diagnostika běhu (trychtýř podmínek, fáze vstupu, statistiky detektorů), ukázkové obchody v grafu
// se stopou enginu (která podmínka dala jakou úroveň a kdy) a porovnání verzí definice. Data z výsledku scripts/lab-strategies.mjs;
// svíčky kolem obchodu z /api/laborator/strategies?bars= (archiv market_bars, ostatním 404).
import {useEffect,useMemo,useRef,useState} from 'react';
import {createChart,CandlestickSeries,LineSeries,LineStyle,createSeriesMarkers,type UTCTimestamp,type SeriesMarker,type Time} from 'lightweight-charts';
import {fmtNum} from '@/lib/journal/format';
import {chartTime,snapper,pricePrecision} from '@/lib/journal/chart-data';
import {BLOCKS} from '@/lib/lab/rules-def';
import type {StratDiag,CondDiag,GroupDiag,Stages,SampleTrade,StrategyRunResult,SegMetrics} from '@/lib/lab/strat-engine';

const pct=(a:number,b:number)=>b>0?fmtNum(a/b*100,1)+' %':'–';
const int=(v:number|null|undefined)=>v===null||v===undefined?'–':fmtNum(v,0);
const rr=(v:number|null|undefined)=>v===null||v===undefined?'–':(v>0?'+':v<0?'−':'')+fmtNum(Math.abs(v),2)+' R';
const blockLabel=(b:string)=>BLOCKS[b as keyof typeof BLOCKS]?.label??b;
const dt=(t:number,h1:boolean)=>new Date(t).toLocaleString('cs-CZ',h1?{day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}:{day:'numeric',month:'numeric',year:'numeric'});
const px=(v:number|null|undefined)=>v===null||v===undefined||!Number.isFinite(v)?'–':fmtNum(v,v>=100?2:5);

// popisky statistik detektorů (klíče z lib/lab/strat-blocks.ts)
// zóny: koše mitigace = hloubka při PRVNÍM dotyku (od strat-v2; starší výsledky = maximum za život)
const STAT_LABELS:Record<string,string>={detected:'nalezeno',demand:'poptávka',supply:'nabídka',bullish:'býčích',bearish:'medvědích',touchedFresh:'dotčeno, dokud platily',
 invalidated:'zneplatněno',expired:'vypršelo (stáří)',aliveAtEnd:'platí na konci',filled:'vyplněno',mit0_25:'mitigace 0–25 %',mit25_50:'25–50 %',mit50_75:'50–75 %',mit75_100:'75–100 %',mit100:'100 % a víc',
 invalidatedAtFirstTouch:'zneplatněno hned při 1. dotyku',touchedInvalidated:'dotčené a zneplatněné',exceededMaxMit:'dotčené nad max. mitigací',pairsChecked:'porovnaných párů zón',pairsNested:'vnořených párů',
 swingHighs:'swing high',swingLows:'swing low',structureBreaks:'průrazů swingu',withDisplacement:'s displacementem',mssEvents:'MSS (se všemi podmínkami)',
 levelKnownBars:'svíček se známou úrovní',wickBeyondLow:'knot pod úrovní',wickBeyondHigh:'knot nad úrovní',sweepsLong:'sweepů long',sweepsShort:'sweepů short',
 patternsLong:'formací long',patternsShort:'formací short',bothActiveBars:'svíček s oběma zónami',nestedBars:'svíček s vnořením',
 days:'dní',barsKnown:'svíček se známým biasem',bullDays:'býčích dní',bearDays:'medvědích dní',insideDays:'inside dní',
 swingsUsed:'swingů',barsWithSupport:'svíček s podporou',barsWithResistance:'svíček s rezistencí',atSupport:'u podpory',atResistance:'u rezistence',maxTouches:'max. dotyků shluku',
 touchesAbove:'dotyků shluku nad',touchesBelow:'dotyků shluku pod',bothRefsBars:'svíček s oběma úrovněmi',validBars:'správný směr',passBars:'splněno',groupBars:'svíček s daty skupiny',strongestBars:'nejsilnější',weakestBars:'nejslabší'};

// ---- trychtýř podmínek + fáze vstupu + detektory
export function DiagPanel({diag}:{diag:StratDiag}){
 const [mk,setMk]=useState('');
 const d=mk?diag.markets.find(m=>m.id===mk)??diag.total:diag.total;
 const groups=d.groups??[];
 // úzké hrdlo = povinná jednotka (podmínka mimo skupinu, nebo skupina NEBO) s nejvíc prvními selháními
 const units:(CondDiag|GroupDiag)[]=[...d.conds.filter(c=>c.role==='required'&&!c.group),...groups];
 const worst=units.reduce<CondDiag|GroupDiag|null>((a,c)=>!a||(c.firstFail??0)>(a.firstFail??0)?c:a,null);
 const s=d.stages,lim=diag.entryType==='limit';
 return <div className="lb-diag">
  <div className="lb-form"><label>Trh<select className="lb-select" value={mk} onChange={e=>setMk(e.target.value)}><option value="">Všechny trhy ({diag.markets.length})</option>{diag.markets.map(m=><option key={m.id} value={m.id}>{m.id}</option>)}</select></label>
   <span className="lb-hint">Svíčky od {diag.from||'začátku dat'} (období IS + OOS) · {int(d.bars)} svíček · všechny povinné podmínky splněné {int(d.allRequired)}× ({pct(d.allRequired,d.bars)})</span></div>
  <h4 className="lb-h4">Trychtýř podmínek (v pořadí definice)</h4>
  <ol className="lb-funnel">{d.conds.flatMap(c=>{const g=c.group?groups.find(x=>x.id===c.group):undefined,isReq=c.role==='required'&&!c.group,bn=isReq&&c===worst&&(c.firstFail??0)>0;
   const head=g&&g.members[0]===c.id?[<GroupRow key={'g:'+g.id} g={g} bars={d.bars} bn={g===worst&&g.firstFail>0}/>]:[];
   return [...head,<li key={c.id} className={bn?'lb-bottleneck':''} style={c.group?{marginLeft:'1.5rem'}:undefined}>
    <div className="lb-fn-head"><b>{c.id}</b><span>{blockLabel(c.block)} · {c.tf}{c.group?` · NEBO (skupina ${c.group})`:c.role==='optional'?' · volitelná':c.role==='info'?' · jen úrovně':''}</span>{bn&&<span className="lb-badge no">úzké hrdlo</span>}</div>
    <div className="lb-bar" title={`platí ${c.true} z ${d.bars}`}><i style={{width:`${d.bars?c.true/d.bars*100:0}%`}}/></div>
    {isReq&&<div className="lb-bar cum" title={`kumulativně ${c.funnel}`}><i style={{width:`${d.bars?(c.funnel??0)/d.bars*100:0}%`}}/></div>}
    <small>platí {int(c.true)} ({pct(c.true,d.bars)}; long {int(c.trueL)}, short {int(c.trueS)}, úseků {int(c.onsets)}){isReq?<> · kumulativně {int(c.funnel)} ({pct(c.funnel??0,d.bars)}) · první nesplněná {int(c.firstFail)}×</>:null}{c.unknown?<> · bez dat {int(c.unknown)}</>:null}</small>
   </li>]})}</ol>
  <p className="lb-hint">Horní pruh = jak často podmínka platí sama, spodní = kumulativně se všemi předchozími povinnými. „První nesplněná“ = u kolika svíček právě tahle podmínka zastavila signál – nejvyšší číslo je úzké hrdlo. Skupina NEBO je v trychtýři jeden krok (stačí jeden člen); členové pod ní ukazují, jak často platí každý sám.</p>
  <h4 className="lb-h4">Fáze vstupu</h4>
  <Waterfall s={s} lim={lim}/>
  {d.conds.some(c=>c.stats)&&<><h4 className="lb-h4">Detektory (celá historie)</h4>
   <div className="lb-scroll"><table className="mt-table lb-table"><thead><tr><th>Podmínka</th><th>Blok</th><th>Statistiky detektoru</th></tr></thead>
    <tbody>{d.conds.filter(c=>c.stats).map(c=><tr key={c.id}><td>{c.id}</td><td>{blockLabel(c.block)} ({c.tf})</td>
     <td className="lb-wrap">{Object.entries(c.stats!).map(([k,v])=><span key={k} className={'lb-stat'+(v===0&&(k==='detected'||k==='mssEvents'||k.startsWith('sweeps')||k.startsWith('patterns'))?' zero':'')}>{STAT_LABELS[k]??k} <b>{int(v)}</b></span>)}</td></tr>)}</tbody></table></div>
   <p className="lb-hint">Detektor, který skoro nic nenajde (nula zón / sweepů / MSS), je nejčastější příčina prázdného trychtýře.</p></>}
 </div>;
}
function GroupRow({g,bars,bn}:{g:GroupDiag;bars:number;bn:boolean}){
 return <li className={bn?'lb-bottleneck':''}>
  <div className="lb-fn-head"><b>{g.id}</b><span>skupina NEBO ({g.members.join(' ∨ ')}) – stačí jeden člen</span>{bn&&<span className="lb-badge no">úzké hrdlo</span>}</div>
  <div className="lb-bar" title={`platí ${g.true} z ${bars}`}><i style={{width:`${bars?g.true/bars*100:0}%`}}/></div>
  <div className="lb-bar cum" title={`kumulativně ${g.funnel}`}><i style={{width:`${bars?g.funnel/bars*100:0}%`}}/></div>
  <small>platí aspoň jeden člen {int(g.true)} ({pct(g.true,bars)}; long {int(g.trueL)}, short {int(g.trueS)}, úseků {int(g.onsets)}) · kumulativně {int(g.funnel)} ({pct(g.funnel,bars)}) · první nesplněná {int(g.firstFail)}×</small>
 </li>;
}
function Waterfall({s,lim}:{s:Stages;lim:boolean}){
 const top=Math.max(1,s.allRequired);
 const rows:[string,number,'in'|'out'|'sub'][]=[['Všechny povinné podmínky splněné',s.allRequired,'in'],['− platí long i short zároveň',s.both,'out'],['− na trhu už běží pozice / příkaz',s.busy,'out'],
  ['Nalezená nastavení',s.setups,'in'],['− hodnocení pod minimem',s.skipRating,'out'],['− R:R pod minimem',s.skipRR,'out'],['− překážka před cílem',s.skipObstacle,'out'],['− chybí úroveň / stop na špatné straně',s.skipLevel,'out'],
  [lim?'Zadané limitní příkazy':'Pokusy o vstup na close',s.placed,'in'],
  [lim?'· dotyků mimo vstupní okno seance':'− mimo vstupní okno seance',s.blockSession,lim?'sub':'out'],[lim?'· dotyků v okně zpráv':'− zprávy',s.blockNews,lim?'sub':'out'],
  ['− plno (max. otevřených pozic)',s.blockFull,'out'],['− limit obchodů za den / týden',s.blockTrades,'out'],['− ztrátové stopky (stop-den, denní / týdenní limit)',s.blockLoss,'out'],
  ...(lim?[['− limit vypršel',s.expired,'out'],['− čeká na konci dat',s.pendingAtEnd,'out']] as [string,number,'out'][]:[]),['Otevřené obchody',s.opened,'in']];
 return <ul className="lb-wf">{rows.map(([l,n,k])=><li key={l} className={k}><span>{l}</span><div className="lb-bar"><i style={{width:`${Math.min(100,n/top*100)}%`}}/></div><b>{int(n)}</b></li>)}</ul>;
}

// ---- ukázkové obchody + graf
export function SamplesPanel({samples,data}:{samples:SampleTrade[];data:'D1'|'H1'}){
 const [sel,setSel]=useState(0),[seg,setSeg]=useState<''|'is'|'oos'>('');
 const list=useMemo(()=>samples.map((t,i)=>({t,i})).filter(x=>!seg||x.t.seg===seg),[samples,seg]);
 const cur=samples[sel]??null,h1=data==='H1';
 return <div>
  <div className="lb-form"><label>Úsek<select className="lb-select" value={seg} onChange={e=>setSeg(e.target.value as ''|'is'|'oos')}><option value="">IS i OOS ({samples.length})</option><option value="is">jen in-sample</option><option value="oos">jen out-of-sample</option></select></label>
   <span className="lb-hint">Rovnoměrný výběr z obchodů běhu (nejvýš 50). Klikni na řádek – graf ukáže svíčky kolem obchodu, vstup / stop / cíl a úrovně podmínek, které ho spustily.</span></div>
  {cur&&<SampleChart t={cur} data={data}/>}
  <div className="lb-scroll lb-samples"><table className="mt-table lb-table"><thead><tr><th>#</th><th>Úsek</th><th>Trh</th><th>Směr</th><th>Signál</th><th>Vstup</th><th>Stop</th><th>Cíl</th><th>Výstup</th><th>Výsledek</th><th>Důvod</th></tr></thead>
   <tbody>{list.map(({t,i})=><tr key={i} className={i===sel?'lb-sel':''}><td><button className="lb-link" onClick={()=>setSel(i)}>{i+1}</button></td><td>{t.seg.toUpperCase()}</td><td>{t.market}</td><td>{t.side>0?'long':'short'}</td>
    <td>{dt(t.trace?.sigBarT??t.sigT,h1)}</td><td>{px(t.entry)}</td><td>{px(t.stop)}</td><td>{px(t.target)}</td><td>{px(t.exit)}</td><td className={t.r>0?'pos':t.r<0?'neg':''}>{rr(t.r)}</td><td>{REASONS[t.reason]??t.reason}</td></tr>)}</tbody></table></div>
 </div>;
}
const REASONS:Record<string,string>={sl:'stop',be:'break-even',tp:'cíl',time:'čas',end:'konec dat'};
const PALETTE=['#7c3aed','#0891b2','#d97706','#db2777','#65a30d','#0f766e','#9333ea','#ea580c'];
const css=(name:string,fallback:string)=>getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback;
type RawBar=[number,number,number,number,number];
function SampleChart({t,data}:{t:SampleTrade;data:'D1'|'H1'}){
 const el=useRef<HTMLDivElement>(null);
 const ms=data==='D1'?86400000:3600000,sigBar=t.trace?.sigBarT??t.sigT-ms;
 // okno svíček: ~60 svíček před signálem (nebo od nejstarší události podmínky), ~20 po výstupu; nejvýš 900 svíček rozpětí (limit API)
 const url=useMemo(()=>{
  const to=t.exitT+30*ms,span=900*ms;let from=sigBar-(data==='D1'?90:80)*ms;
  if(to-from>span)from=to-span;
  const firstLv=Math.min(...(t.trace?.conds.map(c=>c.t??Infinity)??[]));if(Number.isFinite(firstLv)&&firstLv<from&&to-firstLv<=span)from=firstLv-5*ms;
  return `/api/laborator/strategies?bars=${encodeURIComponent(t.market)}&tf=${data}&from=${Math.floor(from)}&to=${Math.ceil(to)}`;
 },[t,data,ms,sigBar]);
 const [got,setGot]=useState<{url:string;bars:RawBar[]|null;err:string}|null>(null);
 const bars=got?.url===url?got.bars:null,err=got?.url===url?got.err:'';
 useEffect(()=>{
  let off=false;
  fetch(url,{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{bars:RawBar[]}>:Promise.reject(new Error('Svíčky nejde načíst.')))
   .then(j=>{if(!off)setGot({url,bars:j.bars,err:''})}).catch(e=>{if(!off)setGot({url,bars:null,err:(e as Error).message})});
  return()=>{off=true};
 },[url]);
 useEffect(()=>{
  if(!el.current||!bars?.length)return;
  const line=css('--t-border','#e5e7eb'),bull=css('--bull','#16a34a'),bear=css('--bear','#dc2626'),brand=css('--t-brand','#2563eb');
  const chart=createChart(el.current,{autoSize:true,layout:{background:{color:'transparent'},textColor:css('--t-muted','#6b7280'),fontFamily:'inherit'},grid:{vertLines:{color:line},horzLines:{color:line}},rightPriceScale:{borderColor:line},timeScale:{borderColor:line,timeVisible:data==='H1',secondsVisible:false}});
  const times=bars.map(b=>b[0]),snap=snapper(times),T=(ms0:number)=>chartTime(snap(Math.max(times[0],ms0))) as UTCTimestamp;
  const prec=pricePrecision([...bars.slice(0,200).flatMap(b=>[b[1],b[4]]),t.entry??NaN]),priceFormat={type:'price' as const,precision:prec,minMove:1/10**prec};
  const cs=chart.addSeries(CandlestickSeries,{upColor:bull,downColor:bear,borderVisible:false,wickUpColor:bull,wickDownColor:bear,priceFormat});
  cs.setData(bars.map(b=>({time:chartTime(b[0]) as UTCTimestamp,open:b[1],high:b[2],low:b[3],close:b[4]})));
  // úsečka ceny od času a do času b (dva body; stejný čas → jen bod)
  const seg=(price:number|null|undefined,a:number,b:number,color:string,title:string,style:LineStyle,width:1|2=1)=>{
   if(price===null||price===undefined||!Number.isFinite(price))return;const ta=T(a),tb=T(b);
   const l=chart.addSeries(LineSeries,{color,lineWidth:width,lineStyle:style,title,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,priceFormat});
   l.setData(ta===tb?[{time:ta,value:price}]:[{time:ta,value:price},{time:tb,value:price}]);
  };
  const tr=t.trace,markers:SeriesMarker<Time>[]=[];
  tr?.conds.forEach((c,k)=>{const color=PALETTE[k%PALETTE.length],from=c.t??sigBar;
   for(const [key,v] of Object.entries(c.lv))seg(v,from,sigBar,color,`${c.id}.${key}`,LineStyle.Dashed);
   if(c.t!==null)markers.push({time:T(c.t),position:t.side>0?'belowBar':'aboveBar',shape:'circle',color,text:c.id})});
  const end=t.exitT;
  tr?.legs.forEach((l,q)=>seg(l.L,sigBar,end,brand,tr.legs.length>1?`vstup ${q+1}`:'vstup',LineStyle.Solid,2));
  if(!tr)seg(t.entry,t.entryT,end,brand,'vstup',LineStyle.Solid,2);
  seg(t.stop??tr?.stop.price,sigBar,end,bear,'SL',LineStyle.Solid,2);
  seg(t.target??tr?.target.price,sigBar,end,bull,'cíl',LineStyle.Solid,2);
  seg(tr?.tp1,sigBar,end,bull,'TP1',LineStyle.Dotted);
  markers.push({time:T(sigBar),position:t.side>0?'belowBar':'aboveBar',shape:'square',color:brand,text:'signál'});
  markers.push({time:T(t.entryT),position:t.side>0?'belowBar':'aboveBar',shape:t.side>0?'arrowUp':'arrowDown',color:brand,text:'vstup'});
  markers.push({time:T(t.exitT),position:t.side>0?'aboveBar':'belowBar',shape:'circle',color:t.r>=0?bull:bear,text:rr(t.r)});
  markers.sort((a,b)=>(a.time as number)-(b.time as number));
  createSeriesMarkers(cs,markers);
  chart.timeScale().fitContent();
  return()=>chart.remove();
 },[bars,t,data,sigBar]);
 const tr=t.trace;
 return <div className="lb-sample">
  <div ref={el} className="lb-chart" role="img" aria-label={`Graf ukázkového obchodu ${t.market}: svíčky, vstup, stop, cíl a úrovně podmínek`}/>
  {err&&<p className="mt-alert" role="alert">{err}</p>}{!bars&&!err&&<p className="mt-empty">Načítám svíčky…</p>}{bars&&!bars.length&&<p className="mt-empty">V archivu nejsou svíčky pro toto období.</p>}
  {tr?<div className="lb-trace">
   <p className="lb-meta">Signál {dt(tr.sigBarT,data==='H1')} · vstup {tr.legs.map(l=>`${px(l.L)}${l.from?` (${l.from}.${l.key})`:tr.legs.length>1?' (close po potvrzení – plán)':' (close)'}`).join(' + ')} · stop {px(tr.stop.price)} (od {tr.stop.from}{tr.stop.key?'.'+tr.stop.key:''}, výchozí úroveň {px(tr.stop.ref)}) · cíl {px(tr.target.price)} ({tr.target.type==='level'?`${tr.target.from}.${tr.target.key}`:tr.target.type==='r'?'násobek R':tr.target.type==='expr'?'min/max úrovní':tr.target.type==='zone'?'protilehlá zóna':'protilehlý swing'}){tr.tp1!==null?` · TP1 ${px(tr.tp1)}`:''}</p>
   <ul className="lb-tracelist">{tr.conds.map((c,k)=><li key={c.id}><i style={{background:PALETTE[k%PALETTE.length]}}/><b>{c.id}</b> {blockLabel(c.block)}{c.role==='optional'?' · volitelná':''}{c.t!==null?` · událost ${dt(c.t,data==='H1')}`:''}{Object.keys(c.lv).length?' · '+Object.entries(c.lv).map(([k,v])=>`${k} ${px(v)}`).join(', '):''}{c.n?' · '+Object.entries(c.n).map(([k,v])=>`${STAT_LABELS[k]??k} ${v}`).join(', '):''}</li>)}</ul>
  </div>:<p className="lb-hint">Tento obchod nemá stopu enginu (spočítáno starší verzí).</p>}
 </div>;
}

// ---- porovnání dvou verzí definice (výsledky jejich posledních běhů)
export type VersionRun={id:string;version:number;run:{id:string;version:number;created:string;result:StrategyRunResult}|null};
export function CompareVersions({a,b}:{a:VersionRun;b:VersionRun}){
 const va=a.run?.result.variants[0],vb=b.run?.result.variants[0];
 const m=(r:SegMetrics|undefined,k:keyof SegMetrics)=>r?r[k]:null;
 const rows:[string,(v:typeof va,r:VersionRun)=>string][]=[
  ['Spočítáno',(_,r)=>r.run?new Date(r.run.created).toLocaleString('cs-CZ'):'zatím ne'],
  ['IS obchodů',v=>int(m(v?.metrics.is,'trades') as number|null)],['IS průměr R',v=>rr(m(v?.metrics.is,'avgR') as number|null)],['IS PF',v=>{const x=m(v?.metrics.is,'pf') as number|null;return x===null?'–':fmtNum(x,2)}],
  ['OOS obchodů',v=>int(m(v?.metrics.oos,'trades') as number|null)],['OOS průměr R',v=>rr(m(v?.metrics.oos,'avgR') as number|null)],['OOS PF',v=>{const x=m(v?.metrics.oos,'pf') as number|null;return x===null?'–':fmtNum(x,2)}],
  ['OOS max. DD (R)',v=>{const x=m(v?.metrics.oos,'maxDd') as number|null;return x===null?'–':fmtNum(x,2)}],['Hranice náhody',(_,r)=>rr(r.run?.result.chance?.median)],['Robustní (základ)',v=>v?v.robust?'ano':'ne':'–'],
  ['Povinné splněné (svíček)',v=>int(v?.diag?.total.allRequired)],['Nalezená nastavení',v=>int(v?.diag?.total.stages.setups)],['Otevřené obchody',v=>int(v?.diag?.total.stages.opened)],
 ];
 const ids=[...new Set([...(va?.diag?.total.conds??[]),...(vb?.diag?.total.conds??[])].map(c=>c.id))];
 const cd=(v:typeof va,id:string)=>{const c=v?.diag?.total.conds.find(x=>x.id===id);return c?`${int(c.true)}${c.firstFail!==null?` / ${int(c.firstFail)}`:''}`:'–'};
 return <div className="lb-scroll"><table className="mt-table lb-table lb-compare"><thead><tr><th></th><th>v{a.version}</th><th>v{b.version}</th></tr></thead>
  <tbody>{rows.map(([l,f])=><tr key={l}><td>{l}</td><td>{f(va,a)}</td><td>{f(vb,b)}</td></tr>)}
   {ids.length>0&&<tr className="lb-edge"><td colSpan={3}>Podmínky: platí (svíček) / první nesplněná</td></tr>}
   {ids.map(id=><tr key={id}><td>{id}</td><td>{cd(va,id)}</td><td>{cd(vb,id)}</td></tr>)}</tbody></table></div>;
}
