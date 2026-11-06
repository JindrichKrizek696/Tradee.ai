'use client';
// Laboratoř · Strategie (jen vlastník): grafy a statistiky detailu běhu – equity v R s IS / OOS a drawdownem, srovnání s náhodou, rozdělení R,
// měsíce a roky, rozpady (trh, směr, seance, den, hodina, držení), MAE / MFE, klouzavá expectancy, Monte Carlo, srovnání variant a příbuzných
// definic a živá simulace agentů R… proti očekávání z testu. Vše se počítá v prohlížeči z kompaktních záznamů obchodů běhu (VariantResult.tx,
// od strat-v5; starší běhy → „přepočítej pro grafy“). Statistiky = lib/lab/strat-stats.ts. Data jen z /api/laborator/strategies (ostatním 404).
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {fmtNum} from '@/lib/journal/format';
import type {StrategyRunResult,VariantResult,SegMetrics} from '@/lib/lab/strat-engine';
import {decodeTx,equityR,underwater,ddDuration,rStats,histogram,percentileOf,monthly,breakdown,sessionOf,tradingDay,hourPrague,holdBucket,WEEKDAYS,
 rolling,monteCarlo,maeMfeInsights,drift,thin,stdev,maxDrawdown,quantile,type Tx,type Group,type Bin,type Drift} from '@/lib/lab/strat-stats';

const rr=(v:number|null|undefined,d=2)=>v===null||v===undefined||!Number.isFinite(v)?'–':(v>0?'+':v<0?'−':'')+fmtNum(Math.abs(v),d)+' R';
const n2=(v:number|null|undefined,d=2)=>v===null||v===undefined||!Number.isFinite(v)?'–':fmtNum(v,d);
const pc=(v:number|null|undefined,d=1)=>v===null||v===undefined||!Number.isFinite(v)?'–':fmtNum(v,d)+' %';
const sgn=(v:number|null|undefined)=>v===null||v===undefined?'':v>0?'pos':v<0?'neg':'';
const day=(t:number)=>new Date(t).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague'});
const days=(ms:number)=>fmtNum(ms/86400000,0)+' dní';
const COLORS=['var(--t-brand)','#d97706','#0891b2','#9333ea','#16a34a','#db2777','var(--t-fg-2)','#65a30d','#ea580c','#0f766e'];
const MONTHS=['led','úno','bře','dub','kvě','čvn','čvc','srp','zář','říj','lis','pro'];

// ---------------- obecné grafy (SVG + popisky v HTML, stejný jazyk jako bt-chart)
type Pt=[number,number];
type LSeries={label:string;pts:Pt[];color:string;dash?:boolean;width?:number;area?:boolean};
// jedno nebo víc spojnic; shade = podbarvené pásmo osy x (OOS), marks = svislé čáry, band = pásmo mezi dvěma řadami (Monte Carlo)
function LineChart({series,xFmt,yFmt,height=190,shade,marks,band,zero=true,label,base}:{series:LSeries[];xFmt:(x:number)=>string;yFmt:(y:number)=>string;height?:number;
 shade?:{from:number;to?:number;label:string}|null;marks?:{x:number;label:string}[];band?:{lo:Pt[];hi:Pt[];label:string}|null;zero?:boolean;label:string;base?:number}){
 const [hover,setHover]=useState<number|null>(null);
 const all=[...series.flatMap(s=>s.pts),...(band?[...band.lo,...band.hi]:[])];
 if(all.length<2)return <p className="mt-empty">Málo dat pro graf.</p>;
 const W=600,H=height,xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),xr=(x1-x0)||1;
 const lo=Math.min(...ys,zero?0:Infinity,base??Infinity),hi=Math.max(...ys,zero?0:-Infinity,base??-Infinity),yr=(hi-lo)||1;
 const X=(x:number)=>(x-x0)/xr*W,Y=(y:number)=>6+(hi-y)/yr*(H-12);
 const path=(p:Pt[])=>p.map((q,i)=>(i?'L':'M')+X(q[0]).toFixed(1)+','+Y(q[1]).toFixed(1)).join('');
 const hx=hover===null?null:x0+hover*xr;
 const near=(p:Pt[],x:number)=>{let lo2=0,hi2=p.length-1,r=-1;while(lo2<=hi2){const m=(lo2+hi2)>>1;if(p[m][0]<=x){r=m;lo2=m+1}else hi2=m-1}return r<0?null:p[r]};
 const pick=(e:React.PointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect();setHover(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)))};
 const hp=hover===null?0:hover*100;
 return <div className="bt-chart lb-sc-chart" onPointerMove={pick} onPointerLeave={()=>setHover(null)}>
  <div className="bt-axis lb-sc-yax" style={{height}}><span>{yFmt(hi)}</span><span>{yFmt(lo)}</span></div>
  <svg className="lb-sc-svg" style={{height}} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
   {shade&&<rect x={X(shade.from)} width={Math.max(0,X(shade.to??x1)-X(shade.from))} y="0" height={H} className="lb-sc-shade"/>}
   {zero&&lo<0&&hi>0&&<line x1="0" x2={W} y1={Y(0)} y2={Y(0)} className="base"/>}
   {base!==undefined&&<line x1="0" x2={W} y1={Y(base)} y2={Y(base)} className="base"/>}
   {band&&band.lo.length>1&&<path d={path(band.hi)+band.lo.slice().reverse().map(q=>'L'+X(q[0]).toFixed(1)+','+Y(q[1]).toFixed(1)).join('')+'Z'} className="lb-sc-band"/>}
   {series.map((s,i)=>s.pts.length>1&&<g key={i}>
    {s.area&&<path d={path(s.pts)+`L${X(s.pts[s.pts.length-1][0]).toFixed(1)},${Y(Math.max(lo,Math.min(hi,0))).toFixed(1)}L${X(s.pts[0][0]).toFixed(1)},${Y(Math.max(lo,Math.min(hi,0))).toFixed(1)}Z`} style={{fill:s.color,opacity:.16}} className="area"/>}
    <path d={path(s.pts)} style={{stroke:s.color,strokeWidth:s.width??2,strokeDasharray:s.dash?'5 3':undefined}} className="lb-sc-ln"/></g>)}
   {marks?.map(m=><line key={m.label} x1={X(m.x)} x2={X(m.x)} y1="0" y2={H} className="lb-sc-mark"/>)}
   {hx!==null&&<line x1={X(hx)} x2={X(hx)} y1="0" y2={H} className="guide"/>}
  </svg>
  <div className="bt-axis x"><span>{xFmt(x0)}</span>{marks?.map(m=><span key={m.label} className="lb-sc-marklabel">{m.label}</span>)}{shade&&<span className="lb-sc-shadelabel">{shade.label}</span>}<span>{xFmt(x1)}</span></div>
  {hx!==null&&<div className="lb-sc-tip" role="status" style={{left:hp+'%',transform:`translateX(${hp<18?'-10%':hp>82?'-90%':'-50%'})`}}>
   <b>{xFmt(hx)}</b>
   {series.map((s,i)=>{const p=near(s.pts,hx);return p&&<span key={i}><i style={{background:s.color}}/>{s.label} <em>{yFmt(p[1])}</em></span>})}
   {band&&(()=>{const a=near(band.lo,hx),b=near(band.hi,hx);return a&&b?<span><i className="lb-sc-bandkey"/>{band.label} <em>{yFmt(a[1])} – {yFmt(b[1])}</em></span>:null})()}
  </div>}
 </div>;
}
function Legend({items}:{items:{label:string;color:string;dash?:boolean}[]}){
 return <div className="lb-sc-legend">{items.map(x=><span key={x.label}><i style={{background:x.color,opacity:x.dash?.6:1}}/>{x.label}</span>)}</div>;
}
// sloupcový histogram v HTML (ostré popisky na mobilu); marker = svislá čára na hodnotě x
function Histo({bins,fmt,marker,label,colorOf}:{bins:Bin[];fmt:(x:number)=>string;marker?:{x:number;label:string}|null;label:string;colorOf?:(b:Bin)=>string}){
 if(!bins.length)return <p className="mt-empty">Málo dat pro graf.</p>;
 const top=Math.max(1,...bins.map(b=>b.n)),lo=bins[0].lo,hi=bins[bins.length-1].hi,span=(hi-lo)||1;
 const mx=marker?Math.max(0,Math.min(100,(marker.x-lo)/span*100)):null;
 return <figure className="lb-sc-hist" aria-label={label}>
  <div className="lb-sc-cols">{bins.map(b=><div key={b.lo} title={`${fmt(b.lo)} až ${fmt(b.hi)}: ${b.n}×`}><i style={{height:`${b.n/top*100}%`,background:colorOf?colorOf(b):undefined}} className={colorOf?'':(b.lo+b.hi)/2>0?'pos':'neg'}/></div>)}
   {mx!==null&&<span className="lb-sc-hmark" style={{left:mx+'%'}}><em style={{transform:`translateX(${mx<15?'0':mx>85?'-100%':'-50%'})`}}>{marker!.label}</em></span>}</div>
  <div className="bt-axis x"><span>{fmt(lo)}</span><span>{fmt((lo+hi)/2)}</span><span>{fmt(hi)}</span></div>
  <figcaption className="lb-hint">Svisle počet obchodů (nejvyšší sloupec {top}×).</figcaption>
 </figure>;
}
// vodorovné sloupce kolem nuly (roky, rozpady)
function HBars({rows}:{rows:{key:string;label:ReactNode;v:number;text:string}[]}){
 const m=Math.max(1e-9,...rows.map(r=>Math.abs(r.v)));
 return <ul className="lb-sc-hbars">{rows.map(r=><li key={r.key}><span>{r.label}</span><div className="lb-sc-hbar"><i className={r.v>=0?'pos':'neg'} style={{width:`${Math.abs(r.v)/m*50}%`,[r.v>=0?'left':'right']:'50%'}}/></div><b className={sgn(r.v)}>{r.text}</b></li>)}</ul>;
}
function Tiles({items}:{items:[string,string,string?,string?][]}){
 return <dl className="bt-tiles lb-sc-tiles">{items.map(([k,v,cls,sub])=><div key={k} className="bt-tile"><dt>{k}</dt><dd className={cls??''}>{v}</dd>{sub&&<dd className="sub">{sub}</dd>}</div>)}</dl>;
}

// ---------------- hlavní panel
export type Related={id:string;name:string;version:number;hasRun:boolean};
export type Sec='overview'|'dist'|'time'|'groups'|'mc'|'compare'|'live';
const SECS:[Sec,string][]=[['overview','Equity a náhoda'],['dist','Rozdělení R a MAE/MFE'],['time','Měsíce a trend'],['groups','Rozpady'],['mc','Monte Carlo'],['compare','Srovnání verzí'],['live','Živě vs test']];
export function StrategyCharts({res,vi,defId,name,related,recompute,initial='overview'}:{res:StrategyRunResult;vi:number;defId:string;name:string;related:Related[];recompute:string;initial?:Sec}){
 const [sec,setSec]=useState<Sec>(initial),[seg,setSeg]=useState<''|'is'|'oos'>('');
 const v=res.variants[vi]??res.variants[0],split=Date.parse(res.split+'T00:00:00Z');
 const all=useMemo(()=>decodeTx(v.tx,split),[v,split]);
 const list=useMemo(()=>seg?all.filter(t=>seg==='oos'?t.oos:!t.oos):all,[all,seg]);
 const noTx=!v.tx;
 const needTx=sec!=='compare'&&sec!=='live';
 return <div className="lb-sc">
  <div className="mt-chips lb-sc-tabs" role="tablist" aria-label="Grafy a statistiky">{SECS.map(([k,l])=><button key={k} role="tab" aria-selected={sec===k} className={sec===k?'active':''} onClick={()=>setSec(k)}>{l}</button>)}</div>
  {needTx&&!noTx&&sec!=='overview'&&<div className="lb-form"><label>Obchody<select className="lb-select" value={seg} onChange={e=>setSeg(e.target.value as ''|'is'|'oos')}><option value="">IS i OOS ({all.length})</option><option value="is">jen in-sample ({all.filter(t=>!t.oos).length})</option><option value="oos">jen out-of-sample ({all.filter(t=>t.oos).length})</option></select></label></div>}
  {needTx&&noTx?<p className="mt-empty">Běh je spočítaný před záznamy obchodů pro grafy – přepočítej pro grafy: <code>{recompute}</code></p>:
   sec==='overview'?<Overview res={res} v={v} all={all} split={split}/>:
   sec==='dist'?<Dist list={list}/>:
   sec==='time'?<TimeSec list={list} split={split} showSplit={!seg}/>:
   sec==='groups'?<Groups list={list} h1={res.data==='H1'}/>:
   sec==='mc'?<Mc list={list}/>:
   sec==='compare'?<Compare res={res} split={split} related={related} name={name}/>:
   <Live defId={defId} v={v} all={all}/>}
 </div>;
}

// ---- 1 + 2: equity v R, drawdown, náhoda
function Overview({res,v,all,split}:{res:StrategyRunResult;v:VariantResult;all:Tx[];split:number}){
 const {pts,uw,dur}=useMemo(()=>{const pts=equityR(all);return {pts,uw:underwater(pts),dur:ddDuration(pts)}},[all]);
 const minDd=Math.min(0,...uw.map(p=>p.dd));
 const start=all.length?Math.min(...all.map(t=>t.entryT)):0;
 const eq:Pt[]=pts.length?[[start,0],...thin(pts,600).map(p=>[p.t,p.cum] as Pt)]:[];
 const dd:Pt[]=uw.length?[[start,0],...thin(uw,600).map(p=>[p.t,p.dd] as Pt)]:[];
 const last=pts.length?pts[pts.length-1].cum:0;
 const ch=res.chance,o=v.metrics.oos.avgR,vals=ch?.values??[];
 const chBins=useMemo(()=>{const vs=ch?.values??[];if(vs.length<2)return [];const lo=Math.min(...vs,o??Infinity),hi=Math.max(...vs,o??-Infinity),w=Math.max(.005,(hi-lo)/14);return histogram(vs,Number(w.toPrecision(1)))},[ch,o]);
 const pctl=o===null?null:percentileOf(vals,o);
 return <>
  <h4 className="lb-h4">Equity v R (kumulativně, IS + OOS)</h4>
  {eq.length>1?<>
   <LineChart label={`Kumulativní R od 0 do ${rr(last)}; out-of-sample od ${res.split} podbarvené`} series={[{label:'Kumulativní R',pts:eq,color:last>=0?'var(--bull)':'var(--bear)',area:true}]} xFmt={day} yFmt={y=>rr(y,1)}
    shade={split<=eq[eq.length-1][0]?{from:Math.max(split,eq[0][0]),label:'OOS'}:null} marks={split>eq[0][0]&&split<eq[eq.length-1][0]?[{x:split,label:'start OOS '+day(split)}]:[]}/>
   <div className="bt-ddlabel"><span>Drawdown pod vodou (R)</span><span>{rr(minDd)}</span></div>
   <LineChart label={`Drawdown v R, nejhlubší ${rr(minDd)}`} height={80} series={[{label:'Drawdown',pts:dd,color:'var(--bear)',area:true,width:1.5}]} xFmt={day} yFmt={y=>rr(y,1)} shade={null} marks={split>eq[0][0]&&split<eq[eq.length-1][0]?[{x:split,label:''}]:[]}/>
   <p className="lb-hint">Podbarvené = out-of-sample. Nejdelší drawdown: {dur.trades} obchodů · {days(dur.ms)}{dur.from!==null?` (${day(dur.from)} – ${day(dur.to!)}${dur.recovered?'':', zatím nevyrovnaný'})`:''}. Křivka v R nezohledňuje velikost rizika (graf „Equity“ výše ano).</p>
  </>:<p className="mt-empty">Bez obchodů.</p>}
  <h4 className="lb-h4">Srovnání s náhodou</h4>
  {chBins.length?<>
   <Histo label="Rozdělení nejlepšího OOS průměru R s náhodnými směry" bins={chBins} fmt={x=>rr(x)} marker={o===null?null:{x:o,label:`strategie ${rr(o)}`}} colorOf={()=>'color-mix(in srgb,var(--t-fg-2,var(--t-muted)) 45%,transparent)'}/>
   <p className="lb-meta">OOS průměr R varianty {v.name}: <b className={sgn(o)}>{rr(o)}</b> · percentil mezi {vals.length} běhy s náhodnými směry: <b>{pc(pctl,0)}</b>{pctl!==null?(pctl>=95?' – výrazně nad náhodou':pctl>=75?' – nad většinou náhodných běhů':' – v pásmu náhody'):''}.</p>
   <p className="lb-hint">Každý náhodný běh = stejné vstupy (čas i cena) s náhodným směrem; hodnota = nejlepší OOS průměr R přes základ a varianty. Víc běhů: <code>--shuffles 100</code>.</p>
  </>:<p className="mt-empty">Běh nemá dost náhodných běhů (spusť s <code>--shuffles 20</code> a víc).</p>}
 </>;
}

// ---- 3 + 6: rozdělení R, statistiky, MAE / MFE
function Dist({list}:{list:Tx[]}){
 const {s,bins,dur,ins}=useMemo(()=>{const rs=list.map(t=>t.r);
  return {s:rStats(rs),bins:histogram(rs.map(r=>Math.max(-6,Math.min(10,r))),.5),dur:ddDuration(equityR(list)),ins:maeMfeInsights(list)}},[list]);
 const hasMae=list.some(t=>t.mae>0||t.mfe>0);
 if(!list.length)return <p className="mt-empty">Žádné obchody ve vybraném úseku.</p>;
 return <>
  <h4 className="lb-h4">Rozdělení výsledků (koše po 0,5 R)</h4>
  <Histo label="Histogram R obchodů po 0,5 R" bins={bins} fmt={x=>rr(x,1)} marker={s.expectancy!==null?{x:s.expectancy,label:`průměr ${rr(s.expectancy)}`}:null}/>
  <p className="lb-hint">Hodnoty pod −6 R a nad +10 R jsou v krajních koších.</p>
  <Tiles items={[['Win rate',pc(s.winRate),'',`${s.wins} výher / ${s.losses} ztrát`],['Průměrná výhra',rr(s.avgWin),'pos'],['Průměrná ztráta',rr(s.avgLoss),'neg'],['Payoff ratio',n2(s.payoff),'','průměrná výhra / ztráta'],
   ['Expectancy',rr(s.expectancy),sgn(s.expectancy),'na obchod'],['SQN',n2(s.sqn),'',sqnText(s.sqn)],['Série výher / proher',`${s.maxWins} / ${s.maxLosses}`,'','nejdelší'],['Nejdelší drawdown',`${dur.trades} obch.`,'',days(dur.ms)]]}/>
  <h4 className="lb-h4">MAE / MFE (nejhorší a nejlepší pohyb během obchodu, R)</h4>
  {hasMae?<><Scatter list={list}/><ul className="lb-notes">{ins.map(x=><li key={x.id}>{x.text}</li>)}</ul></>:<p className="mt-empty">Obchody nemají MAE / MFE – přepočítej běh.</p>}
 </>;
}
const sqnText=(x:number|null)=>x===null?'málo dat':x<1?'slabé':x<2?'průměrné':x<3?'dobré':x<5?'výborné':'podezřele vysoké';
function Scatter({list}:{list:Tx[]}){
 const pts=useMemo(()=>thin(list,2500),[list]);
 const qa=quantile(list.map(t=>t.mae).sort((a,b)=>a-b),.98)??1,qf=quantile(list.map(t=>t.mfe).sort((a,b)=>a-b),.98)??1;
 const mxA=Math.max(1.2,Math.ceil(qa*2)/2),mxF=Math.max(1.2,Math.ceil(qf*2)/2),W=400,H=260;
 const X=(a:number)=>8+Math.min(a,mxA)/mxA*(W-16),Y=(f:number)=>H-8-Math.min(f,mxF)/mxF*(H-16);
 return <figure className="lb-sc-scatter">
  <div className="lb-sc-scwrap"><span className="lb-sc-yname">MFE ↑ {rr(mxF,1)}</span>
   <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bodový graf MAE proti MFE, zelené výhry, červené ztráty">
    <rect x="0" y="0" width={W} height={H} className="lb-sc-frame"/>
    <line x1={X(.8)} x2={X(.8)} y1="0" y2={H} className="lb-sc-ref"/><line x1="0" x2={W} y1={Y(1)} y2={Y(1)} className="lb-sc-ref"/>
    {pts.map((t,i)=><circle key={i} cx={X(t.mae)} cy={Y(t.mfe)} r="2.6" className={t.r>0?'w':'l'}/>)}
   </svg></div>
  <div className="bt-axis x"><span>MAE 0</span><span>svislá čára −0,8 R · vodorovná +1 R</span><span>{rr(-mxA,1)} →</span></div>
  <Legend items={[{label:'výhra',color:'var(--bull)'},{label:'ztráta',color:'var(--bear)'}]}/>
 </figure>;
}

// ---- 4 + 7: měsíce, roky, klouzavá expectancy
function TimeSec({list,split,showSplit}:{list:Tx[];split:number;showSplit:boolean}){
 const rows=useMemo(()=>monthly(list),[list]);
 const mx=Math.max(1e-9,...rows.flatMap(r=>r.months.map(m=>Math.abs(m??0))));
 const roll=useMemo(()=>{const s=[...list].sort((a,b)=>a.exitT-b.exitT),r=rolling(s.map(t=>t.r),20);return s.map((t,i)=>[t.exitT,r[i]] as [number,number|null]).filter((p):p is Pt=>p[1]!==null)},[list]);
 const avg=list.length?list.reduce((s,t)=>s+t.r,0)/list.length:0;
 if(!list.length)return <p className="mt-empty">Žádné obchody ve vybraném úseku.</p>;
 return <>
  <h4 className="lb-h4">Měsíce (součet R podle měsíce výstupu)</h4>
  <div className="lb-scroll"><table className="mt-table lb-table lb-heat lb-sc-heat lb-sc-keep"><thead><tr><th>Rok</th>{MONTHS.map(m=><th key={m}>{m}</th>)}<th>Rok</th></tr></thead>
   <tbody>{rows.map(r=><tr key={r.year}><th scope="row">{r.year}</th>{r.months.map((m,k)=><td key={k} title={m===null?'bez obchodů':`${rr(m)} · ${r.counts[k]} obch.`} style={m===null?undefined:{background:`color-mix(in srgb,var(${m>=0?'--bull':'--bear'}) ${Math.round(8+Math.abs(m)/mx*52)}%,transparent)`}}>{m===null?'':fmtNum(m,1)}</td>)}
    <td className={'lb-sc-tot '+sgn(r.total)}><b>{fmtNum(r.total,1)}</b><small>{r.trades} obch.</small></td></tr>)}</tbody></table></div>
  <h4 className="lb-h4">Roky</h4>
  <HBars rows={rows.map(r=>({key:String(r.year),label:<>{r.year}{showSplit&&Date.UTC(r.year,0,1)>=split?<small> OOS</small>:null}</>,v:r.total,text:`${rr(r.total,1)} · ${r.trades}`}))}/>
  <h4 className="lb-h4">Klouzavá expectancy (průměr R posledních 20 obchodů)</h4>
  {roll.length>1?<LineChart label="Klouzavý průměr R za 20 obchodů" series={[{label:'Průměr R (20)',pts:thin(roll,600),color:'var(--t-brand)'}]} xFmt={day} yFmt={y=>rr(y)} height={150} base={avg}
   shade={showSplit&&split<=roll[roll.length-1][0]?{from:Math.max(split,roll[0][0]),label:'OOS'}:null}/>:<p className="mt-empty">Potřeba aspoň 21 obchodů.</p>}
  <p className="lb-hint">Přerušovaná čára = průměr R celého výběru ({rr(avg)}); dlouhé období pod nulou = strategie přestala fungovat.</p>
 </>;
}

// ---- 5: rozpady
type Dim='market'|'side'|'session'|'weekday'|'hour'|'hold';
type SortK='label'|'trades'|'winRate'|'avgR'|'totalR';
function Groups({list,h1}:{list:Tx[];h1:boolean}){
 const dims:[Dim,string][]=[['market','Trh'],['side','Směr'],...(h1?[['session','Seance'],['hour','Hodina vstupu']] as [Dim,string][]:[]),['weekday','Den v týdnu'],['hold','Doba držení']];
 const [pick,setDim]=useState<Dim>('market'),[sort,setSort]=useState<{k:SortK;desc:boolean}>({k:'label',desc:false});
 const dim:Dim=dims.some(([k])=>k===pick)?pick:'market';
 const groups=useMemo(()=>breakdown(list,t=>dim==='market'?{key:t.market,label:t.market}:dim==='side'?{key:String(t.side),label:t.side>0?'long':'short',order:t.side>0?0:1}
  :dim==='session'?sessionOf(t.entryT):dim==='weekday'?(()=>{const d=tradingDay(t.entryT);return {key:'d'+d,label:WEEKDAYS[d]??'?',order:d}})()
  :dim==='hour'?(()=>{const h=hourPrague(t.entryT);return {key:'h'+h,label:String(h).padStart(2,'0')+':00',order:h}})():holdBucket(t.bars)),[list,dim]);
 const sorted=useMemo(()=>{const g=[...groups];const k=sort.k;if(k!=='label')g.sort((a,b)=>(a[k]-b[k])*(sort.desc?-1:1));else if(sort.desc)g.reverse();return g},[groups,sort]);
 const th=(k:SortK,l:string)=><th aria-sort={sort.k===k?(sort.desc?'descending':'ascending'):'none'}><button className="lb-link" onClick={()=>setSort(s=>({k,desc:s.k===k?!s.desc:k!=='label'}))}>{l}{sort.k===k?(sort.desc?' ↓':' ↑'):''}</button></th>;
 if(!list.length)return <p className="mt-empty">Žádné obchody ve vybraném úseku.</p>;
 return <>
  <div className="mt-chips lb-sc-dims" role="tablist" aria-label="Rozpad podle">{dims.map(([k,l])=><button key={k} role="tab" aria-selected={dim===k} className={dim===k?'active':''} onClick={()=>setDim(k)}>{l}</button>)}</div>
  <HBars rows={sorted.map((g:Group)=>({key:g.key,label:g.label,v:g.totalR,text:rr(g.totalR,1)}))}/>
  <div className="lb-scroll"><table className="mt-table lb-table lb-sc-keep"><thead><tr>{th('label',dims.find(d=>d[0]===dim)?.[1]??'')}{th('trades','Obchodů')}{th('winRate','Win rate')}{th('avgR','Průměr R')}{th('totalR','Celkem R')}</tr></thead>
   <tbody>{sorted.map(g=><tr key={g.key} className={g.trades<10?'lb-dim':''}><td>{g.label}</td><td>{g.trades}</td><td>{pc(g.winRate)}</td><td className={sgn(g.avgR)}>{rr(g.avgR)}</td><td className={sgn(g.totalR)}>{rr(g.totalR,1)}</td></tr>)}</tbody></table></div>
  <p className="lb-hint">{dim==='weekday'?'Den = obchodní den vstupu (začíná v 17:00 New York jako u FX). ':dim==='hour'?'Hodina vstupu v pražském čase. ':dim==='session'?'Seance podle výchozích oken (Tokio 9–18, Londýn 8–17, New York 8–17 místního času); překryv je zvlášť. ':dim==='hold'?'Doba držení ve svíčkách datového TF. ':''}Šedé řádky mají méně než 10 obchodů – málo na závěry. Řazení kliknutím na záhlaví.</p>
 </>;
}

// ---- 8: Monte Carlo
function Mc({list}:{list:Tx[]}){
 const rs=useMemo(()=>[...list].sort((a,b)=>a.exitT-b.exitT).map(t=>t.r),[list]);
 const mc=useMemo(()=>monteCarlo(rs,{runs:1000,seed:42}),[rs]);
 const actual=useMemo(()=>{const cum:number[]=[];rs.forEach((r,i)=>cum.push((i?cum[i-1]:0)+r));return mc.idx.map((i,q)=>[q,cum[i]] as Pt)},[rs,mc]);
 const realDd=useMemo(()=>maxDrawdown(rs),[rs]);
 const ddBins=useMemo(()=>{if(!mc.dd.length)return [];const lo=Math.min(...mc.dd),w=Math.max(.25,Number(((-lo)/16).toPrecision(1)));return histogram(mc.dd,w)},[mc]);
 if(rs.length<5)return <p className="mt-empty">Monte Carlo potřebuje aspoň 5 obchodů.</p>;
 const X=(q:number)=>mc.idx[q]+1,pts=(a:number[]):Pt[]=>a.map((y,q)=>[X(q),y]);
 return <>
  <h4 className="lb-h4">1 000 náhodných pořadí obchodů – pásmo 5–95 %</h4>
  <LineChart label="Monte Carlo: medián, pásmo 5 až 95 procent a skutečné pořadí kumulativního R" series={[{label:'medián',pts:pts(mc.p50),color:'var(--t-fg-2)',dash:true},{label:'skutečné pořadí',pts:actual.map(([q,y])=>[X(q),y]),color:'var(--t-brand)'}]}
   band={{lo:pts(mc.p5),hi:pts(mc.p95),label:'5–95 %'}} xFmt={x=>`obchod ${fmtNum(x,0)}`} yFmt={y=>rr(y,1)}/>
  <Legend items={[{label:'skutečné pořadí',color:'var(--t-brand)'},{label:'medián',color:'var(--t-fg-2)',dash:true},{label:'pásmo 5–95 %',color:'color-mix(in srgb,var(--t-brand) 30%,transparent)'}]}/>
  <Tiles items={[['Skutečný max. DD',rr(realDd,1),'neg',`horší než ${pc(100-(percentileOf(mc.dd,realDd)??0),0)} pořadí`],['Max. DD – medián',rr(mc.ddP?.p50,1),'neg'],['Max. DD – nejhorších 5 %',rr(mc.ddP?.p5,1),'neg'],['Max. DD – nejlepších 5 %',rr(mc.ddP?.p95,1),'neg',`konec vždy ${rr(mc.final?.p50,1)}`]]}/>
  <h4 className="lb-h4">Rozdělení max. drawdownu (R)</h4>
  <Histo label="Histogram maximálního drawdownu z 1000 přeházení" bins={ddBins} fmt={x=>rr(x,1)} marker={{x:realDd,label:`skutečný ${rr(realDd,1)}`}} colorOf={()=>'color-mix(in srgb,var(--bear) 55%,transparent)'}/>
  <p className="lb-hint">Stejné obchody v jiném pořadí (seed 42, výsledek se při dalším otevření nemění). Konečný součet R je ve všech pořadích stejný; liší se cesta a hloubka drawdownu – počítej s drawdownem z „nejhorších 5 %“.</p>
 </>;
}

// ---- 9: srovnání variant a příbuzných definic
type EqCurve={id:string;name:string;version:number;run:{id:string;version:number;created:string;chance:number|null;variants:{name:string;metrics:{is:SegMetrics;oos:SegMetrics;all:SegMetrics};robust:boolean;curve:Pt[]|null}[]}|null};
function Compare({res,split,related,name}:{res:StrategyRunResult;split:number;related:Related[];name:string}){
 const [got,setGot]=useState<{key:string;curves:EqCurve[];err:string}|null>(null);
 const key=related.map(r=>r.id).join(',');
 useEffect(()=>{if(!key)return;let off=false;
  fetch('/api/laborator/strategies?eq='+encodeURIComponent(key),{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{curves:EqCurve[]}>:Promise.reject(new Error('Příbuzné definice nejde načíst.')))
   .then(j=>{if(!off)setGot({key,curves:j.curves,err:''})}).catch(e=>{if(!off)setGot({key,curves:[],err:(e as Error).message})});return()=>{off=true}},[key]);
 const sib=useMemo(()=>got?.key===key?got.curves:[],[got,key]);
 type Row={label:string;m:{is:SegMetrics;oos:SegMetrics;all:SegMetrics};robust:boolean;curve:Pt[]|null;own:boolean};
 const rows:Row[]=useMemo(()=>[
  ...res.variants.map(v=>({label:res.variants.length>1?`${name} · ${v.name}`:name,m:v.metrics,robust:v.robust,curve:v.tx?thin(equityR(decodeTx(v.tx,split)),400).map(p=>[p.t,p.cum] as Pt):null,own:true})),
  ...sib.flatMap(c=>c.run?[{label:`${c.name} v${c.version}`,m:c.run.variants[0].metrics,robust:c.run.variants[0].robust,curve:c.run.variants[0].curve,own:false}]:[])],[res,split,name,sib]);
 const series=rows.filter(r=>r.curve&&r.curve.length>1).slice(0,COLORS.length).map((r,i)=>({label:r.label,pts:r.curve!,color:COLORS[i],dash:!r.own,width:r.own&&i===0?2.4:1.6}));
 const missing=rows.filter(r=>!r.curve).length;
 return <>
  <h4 className="lb-h4">Křivky v R: varianty této definice{related.length?' a příbuzné definice':''}</h4>
  {series.length?<><LineChart label={`Porovnání kumulativního R ${series.length} řad`} series={series} xFmt={day} yFmt={y=>rr(y,1)}/>
   <Legend items={series.map(s=>({label:s.label,color:s.color,dash:s.dash}))}/></>:<p className="mt-empty">Žádná řada nemá záznamy obchodů – přepočítej běhy.</p>}
  {missing>0&&<p className="lb-hint">{missing} {missing===1?'řada nemá':'řad nemá'} záznamy obchodů (starší běh) – v grafu chybí, metriky v tabulce zůstávají.</p>}
  {got?.err&&<p className="mt-alert" role="alert">{got.err}</p>}
  {!!key&&!got&&<p className="mt-empty">Načítám příbuzné definice…</p>}
  <div className="lb-scroll"><table className="mt-table lb-table lb-compare lb-sc-keep"><thead><tr><th>Řada</th><th>IS průměr R</th><th>OOS obch.</th><th>OOS win rate</th><th>OOS průměr R</th><th>OOS PF</th><th>OOS DD (R)</th><th>Celkem R</th><th>Robustní</th></tr></thead>
   <tbody>{rows.map(r=><tr key={r.label}><td>{r.label}</td><td className={sgn(r.m.is.avgR)}>{rr(r.m.is.avgR)}</td><td>{r.m.oos.trades}</td><td>{pc(r.m.oos.winRate)}</td><td className={sgn(r.m.oos.avgR)}>{rr(r.m.oos.avgR)}</td><td>{n2(r.m.oos.pf)}</td><td>{n2(r.m.oos.maxDd)}</td><td className={sgn(r.m.all.totalR)}>{rr(r.m.all.totalR,1)}</td><td>{r.robust?'ano':'ne'}</td></tr>)}</tbody></table></div>
  <p className="lb-hint">Příbuzné = definice se stejným základem názvu (např. „název“, „název-volna“, „název-prisna“), vždy poslední verze s jejím posledním během{related.length?`: ${related.map(r=>`${r.name} v${r.version}${r.hasRun?'':' (bez výsledku)'}`).join(', ')}`:' – žádné nalezeny'}. Přerušovaně = příbuzné definice.</p>
 </>;
}

// ---- 10: živě vs test
type LiveAgent={variant:string;defId:string;version:number;active:boolean;started:number;startEquity:number;equity:[number,number][];
 trades:{instrument:string;direction:'long'|'short';opened:number;closed:number|null;r:number|null;pnlCzk:number|null;exitReason:string|null}[]};
const DRIFT:Record<Drift['level'],[string,string]>={few:['málo obchodů',''],ok:['v souladu s testem','ok'],watch:['pozor – odchylka','no'],off:['výrazná odchylka','no']};
function Live({defId,v,all}:{defId:string;v:VariantResult;all:Tx[]}){
 const [got,setGot]=useState<{id:string;agents:LiveAgent[];err:string}|null>(null);
 useEffect(()=>{let off=false;
  fetch('/api/laborator/strategies?live='+encodeURIComponent(defId),{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{agents:LiveAgent[]}>:Promise.reject(new Error('Živé agenty nejde načíst.')))
   .then(j=>{if(!off)setGot({id:defId,agents:j.agents,err:''})}).catch(e=>{if(!off)setGot({id:defId,agents:[],err:(e as Error).message})});return()=>{off=true}},[defId]);
 const oos=all.filter(t=>t.oos).map(t=>t.r),bt={avgR:v.metrics.oos.avgR,winRate:v.metrics.oos.winRate,sd:stdev(oos)};
 if(!got||got.id!==defId)return <p className="mt-empty">Načítám agenty…</p>;
 if(got.err)return <p className="mt-alert" role="alert">{got.err}</p>;
 if(!got.agents.length)return <p className="mt-empty">Tuhle definici zatím žádný agent R… v Simulaci neobchoduje – spusť ho tlačítkem „Pustit do simulace“.</p>;
 return <>{got.agents.map(a=><LiveAgentView key={a.variant} a={a} bt={bt} oosN={oos.length}/>)}
  <p className="lb-hint">Očekávání = OOS výsledky testu ({v.name}, {oos.length} obchodů). Pásmo = očekávaný součet R ± 2 směrodatné chyby; odchylka = rozdíl průměru R v násobcích směrodatné chyby testu (pod 1 v souladu, 1–2 pozor, nad 2 výrazná).</p></>;
}
function LiveAgentView({a,bt,oosN}:{a:LiveAgent;bt:{avgR:number|null;winRate:number|null;sd:number|null};oosN:number}){
 const closed=a.trades.filter(t=>t.closed!==null&&t.r!==null).sort((x,y)=>x.closed!-y.closed!),rs=closed.map(t=>t.r!),open=a.trades.filter(t=>t.closed===null).length;
 const d=drift(rs,bt);
 const cum:Pt[]=[[0,0]];let c=0;rs.forEach((r,i)=>cum.push([i+1,c+=r]));
 const exp:Pt[]=[],lo:Pt[]=[],hi:Pt[]=[];
 if(bt.avgR!==null)for(let k=0;k<=Math.max(1,rs.length);k++){const m=k*bt.avgR,e=bt.sd?2*bt.sd*Math.sqrt(k):0;exp.push([k,m]);lo.push([k,m-e]);hi.push([k,m+e])}
 const eq:Pt[]=a.equity.map(([t,e])=>[t,e]);
 const [lab,cls]=DRIFT[d.level];
 return <div className="lb-sc-live">
  <h4 className="lb-h4">{a.variant} · v{a.version}{a.active?'':' (vypnutý)'} <span className={'lb-badge '+cls}>{lab}</span></h4>
  <Tiles items={[['Uzavřené obchody',String(rs.length),'',open?`otevřené ${open}`:'od '+day(a.started)],['Průměr R živě',rr(d.avgR),sgn(d.avgR),`test OOS ${rr(bt.avgR)}`],['Win rate živě',pc(d.winRate),'',`test OOS ${pc(bt.winRate)}`],
   ['Odchylka',d.z===null?'–':`${d.z>0?'+':d.z<0?'−':''}${fmtNum(Math.abs(d.z),1)} σ`,d.z===null?'':d.z<0?'neg':'pos',d.diffR===null?'':`${rr(d.diffR)} na obchod`]]}/>
  {rs.length>0&&<><LineChart label={`Živé kumulativní R agenta ${a.variant} proti očekávání z testu`} height={160} series={[{label:'živě',pts:cum,color:'var(--t-brand)'},...(exp.length?[{label:'očekávání z testu',pts:exp,color:'var(--t-fg-2)',dash:true}]:[])]}
   band={bt.sd&&lo.length?{lo,hi,label:'± 2 σ'}:null} xFmt={x=>`obchod ${fmtNum(x,0)}`} yFmt={y=>rr(y,1)}/>
   <Legend items={[{label:'živě (kumulativní R)',color:'var(--t-brand)'},{label:'očekávání z testu',color:'var(--t-fg-2)',dash:true},{label:'pásmo ± 2 σ',color:'color-mix(in srgb,var(--t-brand) 30%,transparent)'}]}/></>}
  {eq.length>1&&<><div className="bt-ddlabel"><span>Equity účtu (Kč, včetně otevřených)</span><span>start {fmtNum(a.startEquity,0)} Kč</span></div>
   <LineChart label={`Equity agenta ${a.variant} v Kč`} height={130} zero={false} base={a.startEquity} series={[{label:'equity',pts:eq,color:eq[eq.length-1][1]>=a.startEquity?'var(--bull)':'var(--bear)'}]} xFmt={day} yFmt={y=>fmtNum(y,0)+' Kč'}/></>}
  {closed.length>0&&<details className="lb-details"><summary>Poslední obchody ({Math.min(20,closed.length)} z {closed.length})</summary>
   <div className="lb-scroll"><table className="mt-table lb-table"><thead><tr><th>Trh</th><th>Směr</th><th>Otevřeno</th><th>Zavřeno</th><th>R</th><th>Kč</th></tr></thead>
    <tbody>{closed.slice(-20).reverse().map((t,i)=><tr key={i}><td>{t.instrument}</td><td>{t.direction}</td><td>{day(t.opened)}</td><td>{day(t.closed!)}</td><td className={sgn(t.r)}>{rr(t.r)}</td><td className={sgn(t.pnlCzk)}>{n2(t.pnlCzk,0)}</td></tr>)}</tbody></table></div></details>}
  {oosN<20&&<p className="lb-hint">Test má jen {oosN} OOS obchodů – očekávání je samo nejisté.</p>}
 </div>;
}
