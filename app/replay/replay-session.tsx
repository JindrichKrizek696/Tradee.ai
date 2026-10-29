'use client';
// Běžící replay seance: simulační hodiny (krok, přehrávání, skok na seanci / zprávu), grafy rámců, příkaz s kalkulačkou pozice
// nad replay účtem, otevřené pozice a čekající příkazy, rozhodnutí s checklistem strategie, datové panely do hodin a výsledky.
// Průběh počítá engine na klientu (lib/replay/engine.ts); při ukončení ho server přepočítá ze záznamu událostí a uloží.
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Play,Pause,StepForward,SkipForward,Rewind,RotateCcw,Flag,Download,BookOpen,TriangleAlert,ShieldAlert,Clock} from 'lucide-react';
import {call,TriChecklist,SnapshotView} from '../strategy/plan-ui';
import {PositionCalculator,type CalcCtx,type CalcFixed} from '../risk/position-calculator';
import {ReplayChart,type ChartLine,type ChartMark} from './replay-chart';
import {aggregate,bucketStart,prevClose,pragueTime,TF_MS,TF_LABEL,type Bar,type ReplayTf} from '@/lib/replay/clock';
import {run,rateAt,type ReplayEvent,type ReplaySpec,type OrderType,type Side,type Trade} from '@/lib/replay/engine';
import {summarize,MODE_LABEL,BREACH_TEXT,type Summary} from '@/lib/replay/results';
import {CHOICES,type Choice} from '@/lib/replay/core';
import type {Session,TradeRow} from '@/lib/replay/store';
import type {Spec} from '@/lib/risk/instruments';
import type {SizeResult} from '@/lib/risk/size';
import type {CheckState,DecisionItem,PlanSnapshot} from '@/lib/strategy/core';
import type {CalView,CotView} from '@/lib/replay/panels';
type Checklist={strategyName:string;version:number;models:string[];items:DecisionItem[]}|null;
type Loaded={session:Session;events:ReplayEvent[];bars:Record<string,Bar[]>;trades:TradeRow[];checklist:Checklist;sessions:{id:string;label:string}[]};
type Panels={clock:number;score:{source:string;items:Record<string,{score:number|null;at:string;coverage:number|null;reconstructed:boolean;method:string}>}|null;cot:CotView[];calendar:{past:CalView[];next:CalView[]}|null;macro:CalView[]|null};
const SPEEDS=[1,2,5,10,20];
const f=(n:number|null|undefined,d=2)=>n===null||n===undefined||!Number.isFinite(n)?'–':n.toLocaleString('cs-CZ',{maximumFractionDigits:d});
const fp=(n:number|null|undefined)=>n===null||n===undefined?'–':String(Math.round(n*1e6)/1e6);
const REASON:Record<string,string>={sl:'SL',tp:'TP',manual:'ručně',breach:'porušení',open:'otevřená'};
/** Specifikace replaye → tvar pro kalkulačku pozice (lib/risk/size.ts). */
function calcSpec(s:ReplaySpec):Spec{
 return {id:s.instrumentId,name:s.name||s.instrumentId,kind:'CFD',venue:'',quote:s.quote,tickSize:s.tickSize,tickValue:s.tickValue,contractSize:1,lotStep:s.lotStep,minLot:s.minLot,pip:s.pip??null,unit:s.unit||'lot',sessions:'',dataSymbol:null,market:s.symbol,proxy:false,volume:false,cot:false,fundamentals:false,aliases:[],commission:s.commission,spread:s.spread,overridden:[]};
}
export function ReplaySession({id,onClose}:{id:string;onClose:()=>void}){
 const [d,setD]=useState<Loaded|null>(null),[err,setErr]=useState(''),[info,setInfo]=useState(''),[busy,setBusy]=useState(false);
 const [clock,setClock]=useState(0),[reveal,setReveal]=useState<number|null>(null),[sym,setSym]=useState('');
 const [playing,setPlaying]=useState(false),[speed,setSpeed]=useState(2),[jump,setJump]=useState('session:london');
 const [panels,setPanels]=useState<Panels|null>(null),[final,setFinal]=useState<{summary:Summary;trades:TradeRow[]}|null>(null);
 const load=useCallback(async()=>{try{const j=await call<Loaded>('/api/replay/sessions/'+id);setD(j);setClock(j.session.clock);setReveal(j.session.revealUntil);setSym(s=>j.session.symbols.includes(s)?s:j.session.symbols[0]);
  setFinal(j.session.status!=='active'&&j.session.results?{summary:j.session.results.summary,trades:j.trades}:null);setErr('')}catch(e){setErr((e as Error).message)}},[id]);
 useEffect(()=>{load()},[load]);
 const s=d?.session,active=s?.status==='active';
 const res=useMemo(()=>d&&s?run({bars:d.bars,base:s.baseTf,events:d.events,exec:s.config.exec,specs:s.config.specs,account:s.config.account,clock,start:s.start}):null,[d,s,clock]);
 const summary=useMemo(()=>res&&s&&d?summarize(res.trades,d.events,s.config.account.balance,res.breach,s.mode):null,[res,s,d]);
 const needDecision=!!s?.decideN&&active&&(reveal===null||reveal<=clock);
 // ---- hodiny
 const inflight=useRef(false);
 const advance=useCallback(async(body:Record<string,unknown>)=>{
  if(inflight.current||!s)return false;inflight.current=true;
  try{const r=await call<{clock:number;bars:Record<string,Bar[]>;revealUntil:number|null;news:{at:number;title:string;currency:string}|null}>('/api/replay/sessions/'+id,'POST',{action:'advance',...body});
   setD(prev=>{if(!prev)return prev;const bars={...prev.bars};for(const [k,list] of Object.entries(r.bars)){const cur=bars[k]||[],last=cur.length?cur[cur.length-1].t:-Infinity;bars[k]=[...cur,...list.filter(b=>b.t>last)]}return {...prev,bars}});
   setClock(r.clock);setReveal(r.revealUntil);if(r.news)setInfo(`Před zprávou: ${r.news.currency} ${r.news.title} (${pragueTime(r.news.at)})`);setErr('');return true}
  catch(e){setErr((e as Error).message);setPlaying(false);return false}finally{inflight.current=false}
 },[id,s]);
 useEffect(()=>{
  if(!playing)return;
  const ms=speed>=2?500:1000,steps=speed>=2?Math.round(speed/2):1;
  const t=setInterval(()=>{advance({steps})},ms);return()=>clearInterval(t);
 },[playing,speed,advance]);
 useEffect(()=>{if(needDecision&&playing){setPlaying(false);setInfo('Zapiš rozhodnutí – pak se odkryjí další svíčky.')}},[needDecision,playing]);
 // porušení pravidel ukončí seanci se zprávou
 const finishing=useRef(false);
 const finish=useCallback(async(auto=false)=>{
  if(finishing.current)return;if(!auto&&!confirm('Ukončit seanci? Výsledky se přepočítají ze záznamu a uloží; pak už nejde pokračovat.'))return;
  finishing.current=true;setBusy(true);setPlaying(false);
  try{await call('/api/replay/sessions/'+id,'POST',{action:'finish'});await load()}catch(e){setErr((e as Error).message)}finally{setBusy(false);finishing.current=false}
 },[id,load]);
 useEffect(()=>{if(res?.breach&&active){setInfo(BREACH_TEXT[res.breach.reason]+' – seance končí.');finish(true)}},[res?.breach,active,finish]);
 // ---- panely do hodin (jen když hodiny stojí)
 useEffect(()=>{if(!s||playing)return;const t=setTimeout(()=>{call<Panels>('/api/replay/sessions/'+id+'/panels').then(setPanels).catch(()=>setPanels(null))},350);return()=>clearTimeout(t)},[id,s,clock,playing]);
 // ---- události
 const send=useCallback(async(kind:string,data:Record<string,unknown>)=>{
  setBusy(true);try{const r=await call<{event:ReplayEvent;revealUntil:number|null}>('/api/replay/sessions/'+id,'POST',{action:'event',kind,data});
   setD(prev=>prev?{...prev,events:[...prev.events,r.event]}:prev);setReveal(r.revealUntil);setErr('');return true}
  catch(e){setErr((e as Error).message);return false}finally{setBusy(false)}
 },[id]);
 const rewind=async(kind:'rewind'|'reset')=>{
  if(!s||!d)return;
  const to=kind==='reset'?s.start:prevClose(d.bars[s.symbols[0]]||[],s.baseTf,clock,s.start);
  if(to===null||to>=clock&&kind==='rewind')return;
  const warn=s.mode==='validate'?'Validační režim: přetočení / reset se zapíše do výsledků a seance nebude čistá. Pokračovat?':kind==='reset'?'Začít znovu od startu? Příkazy a rozhodnutí se zneplatní.':null;
  if(warn&&!confirm(warn))return;
  setPlaying(false);setBusy(true);
  try{await call('/api/replay/sessions/'+id,'POST',{action:kind,to,confirm:s.mode==='validate'});await load()}catch(e){setErr((e as Error).message)}finally{setBusy(false)}
 };
 const journal=async()=>{setBusy(true);try{const r=await call<{added:number}>('/api/replay/sessions/'+id,'POST',{action:'journal'});setInfo(`Do Deníku zapsáno ${r.added} obchodů (režim Replay – živé statistiky je nepočítají).`);await load()}catch(e){setErr((e as Error).message)}finally{setBusy(false)}};
 // klávesy: mezerník = play/pauza, šipka vpravo = krok
 useEffect(()=>{const on=(e:KeyboardEvent)=>{const t=e.target as HTMLElement;if(/INPUT|TEXTAREA|SELECT/.test(t.tagName)||!active)return;
  if(e.key===' '){e.preventDefault();setPlaying(p=>!p)}else if(e.key==='ArrowRight'){e.preventDefault();advance({steps:1})}};
  window.addEventListener('keydown',on);return()=>window.removeEventListener('keydown',on)},[active,advance]);
 if(!d||!s)return <main className="rp-main">{err?<p className="mt-alert" role="alert">{err} <button type="button" className="rp-link" onClick={onClose}>Zpět na seance</button></p>:<p className="rk-muted">Načítám seanci…</p>}</main>;
 const spec=s.config.specs[sym],last=res?.lastPrice[sym]??null,acc=s.config.account.currency;
 const decisions=d.events.filter(e=>e.kind==='decision'&&!e.void);
 const lastDecision=[...decisions].reverse().find(e=>e.data.symbol===sym&&e.clock===clock);
 const integrityBad=s.mode==='validate'&&(s.rewinds+s.resets>0);
 return <main className="rp-main rp-session">
  <div className="rp-head">
   <div><h1>{s.name}</h1><p className="rp-sub">{MODE_LABEL[s.mode]} · {s.symbols.join(', ')} · základ {s.baseTf} · účet {s.config.account.name} {f(s.config.account.balance,0)} {acc}{s.config.strategy&&<> · strategie {s.config.strategy.name} v{s.config.strategy.version}</>}</p></div>
   <div className="rp-clock" aria-live="polite"><Clock size={15}/> <b>{pragueTime(clock)}</b><small>Praha · start {pragueTime(s.start)}</small></div>
  </div>
  {integrityBad&&<p className="rp-banner warn"><ShieldAlert size={15}/> Validační seance byla {s.rewinds}× přetočena a {s.resets}× resetována – výsledky nejsou čistá validace.</p>}
  {s.config.notes.length>0&&<details className="rp-notes"><summary>Poznámky k nastavení ({s.config.notes.length})</summary><ul>{s.config.notes.map(n=><li key={n}>{n}</li>)}</ul></details>}
  {err&&<p className="mt-alert" role="alert">{err}</p>}
  {info&&<p className="rp-banner" role="status">{info} <button type="button" className="rp-link" onClick={()=>setInfo('')}>×</button></p>}
  {active&&<div className="rp-controls" role="toolbar" aria-label="Ovládání hodin">
   <button type="button" className="mt-btn rp-primary" disabled={needDecision} onClick={()=>setPlaying(!playing)} aria-pressed={playing}>{playing?<Pause size={15}/>:<Play size={15}/>} {playing?'Pauza':'Přehrát'}</button>
   <button type="button" className="mt-btn" disabled={needDecision||playing} onClick={()=>advance({steps:1})}><StepForward size={15}/> Svíčka</button>
   <label className="rp-inline">Rychlost <select value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{SPEEDS.map(x=><option key={x} value={x}>{x} svíček/s</option>)}</select></label>
   <span className="rp-inline"><select value={jump} onChange={e=>setJump(e.target.value)} aria-label="Skok">{d.sessions.map(x=><option key={x.id} value={'session:'+x.id}>Otevření: {x.label}</option>)}<option value="news">Další silná zpráva</option></select>
    <button type="button" className="mt-btn" disabled={needDecision||playing} onClick={()=>advance({until:jump})}><SkipForward size={15}/> Skok</button></span>
   <span className="rp-spacer"/>
   <button type="button" className="mt-btn" disabled={playing||busy||clock<=s.start} onClick={()=>rewind('rewind')} title={s.mode==='validate'?'Zapíše se do výsledků':''}><Rewind size={15}/> Zpět</button>
   <button type="button" className="mt-btn" disabled={playing||busy||clock<=s.start} onClick={()=>rewind('reset')}><RotateCcw size={15}/> Reset</button>
   <button type="button" className="mt-btn" disabled={busy} onClick={()=>finish()}><Flag size={15}/> Ukončit</button>
  </div>}
  {needDecision&&<p className="rp-banner decide"><TriangleAlert size={15}/> Rozhodni, pak odkryj: zapiš rozhodnutí (long / short / bez obchodu) – pak se odkryje dalších {s.decideN} svíček.</p>}
  {s.symbols.length>1&&<div className="mt-chips rp-symtabs" role="tablist" aria-label="Trh">{s.symbols.map(x=><button key={x} type="button" role="tab" aria-selected={sym===x} className={sym===x?'active':''} onClick={()=>setSym(x)}>{x}{res?.lastPrice[x]!==undefined&&<small> {fp(res.lastPrice[x])}</small>}</button>)}</div>}
  <Charts s={s} bars={d.bars[sym]||[]} clock={clock} sym={sym} res={res}/>
  <div className="rp-cols">
   <div className="rp-col">
    {active&&spec&&last!==null&&<OrderTicket key={sym} spec={spec} last={last} account={{name:s.config.account.name,currency:acc,balance:res?.balance??s.config.account.balance,remainingDD:res?.prop?.drawdown?.remaining??null,remainingDaily:res?.prop?.daily?.remaining??null,maxRiskPct:s.config.account.rules?.maxRiskPct??null}} busy={busy} decisionId={lastDecision?String(lastDecision.data.id):null} onSend={data=>send('order',data)}/>}
    <Positions res={res} active={!!active} busy={busy} acc={acc} onSend={send}/>
   </div>
   <div className="rp-col">
    {active&&<DecisionCard sym={sym} checklist={d.checklist} busy={busy} needed={needDecision} onSend={data=>send('decision',data)}/>}
    <DataPanels p={panels} symbols={s.symbols}/>
   </div>
  </div>
  <Results s={s} summary={final?.summary??summary} trades={final?final.trades:res?.trades??[]} live={!final} decisions={decisions} breach={res?.breach??s.results?.breach??null} busy={busy} onJournal={journal} acc={acc}/>
 </main>;
}
function Charts({s,bars,clock,sym,res}:{s:Session;bars:Bar[];clock:number;sym:string;res:ReturnType<typeof run>|null}){
 const tfs=s.tfs.length?s.tfs:[s.baseTf];
 const lines=useMemo(()=>{const out:ChartLine[]=[];if(!res)return out;
  for(const p of res.open.filter(p=>p.symbol===sym)){out.push({price:p.entry,title:(p.side==='long'?'Long ':'Short ')+p.qty,kind:'entry'});if(p.sl!==null)out.push({price:p.sl,title:'SL',kind:'sl'});if(p.tp!==null)out.push({price:p.tp,title:'TP',kind:'tp'})}
  for(const o of res.orders.filter(o=>o.symbol===sym&&o.status==='pending'&&o.price!==null))out.push({price:o.price as number,title:`${o.type==='limit'?'Limit':'Stop'} ${o.side}`,kind:'order'});
  return out},[res,sym]);
 const marks=useMemo(()=>{const out:ChartMark[]=[];if(!res)return out;
  for(const t of res.trades.filter(t=>t.symbol===sym)){out.push({t:t.entryTs,side:t.side,kind:'in',text:t.side==='long'?'L':'S'});out.push({t:t.exitTs,side:t.side,kind:'out',text:(REASON[t.reason]??t.reason)+(t.ambiguous?' ?':'')})}
  for(const p of res.open.filter(p=>p.symbol===sym))out.push({t:p.entryTs,side:p.side,kind:'in',text:p.side==='long'?'L':'S'});
  return out},[res,sym]);
 return <div className={'rp-charts n'+Math.min(4,tfs.length)}>{tfs.map(tf=><TfChart key={tf} tf={tf} s={s} bars={bars} clock={clock} sym={sym} lines={lines} marks={marks}/>)}</div>;
}
function TfChart({tf,s,bars,clock,sym,lines,marks}:{tf:ReplayTf;s:Session;bars:Bar[];clock:number;sym:string;lines:ChartLine[];marks:ChartMark[]}){
 const candles=useMemo(()=>aggregate(bars,s.baseTf,tf,clock),[bars,s.baseTf,tf,clock]);
 const snap=useCallback((t:number)=>tf===s.baseTf?t:bucketStart(t+TF_MS[s.baseTf]/2,tf),[tf,s.baseTf]);
 const partial=candles.length&&candles[candles.length-1].partial;
 return <figure className="rp-fig"><figcaption><b>{sym} · {tf}</b> <small>{TF_LABEL[tf]}</small>{partial?<span className="rp-tag" title="Svíčka vyššího rámce složená jen z uzavřených svíček základního rámce">rozpracovaná svíčka</span>:null}</figcaption>
  <ReplayChart candles={candles} lines={lines} marks={marks} snap={snap} label={`Graf ${sym} ${tf} do ${pragueTime(clock)}`}/></figure>;
}
function OrderTicket({spec,last,account,busy,decisionId,onSend}:{spec:ReplaySpec;last:number;account:Omit<CalcFixed,'spec'|'rate'>;busy:boolean;decisionId:string|null;onSend:(d:Record<string,unknown>)=>Promise<boolean>}){
 const [type,setType]=useState<OrderType>('market'),[sideSel,setSide]=useState<Side>('long'),[qty,setQty]=useState(''),[k,setK]=useState(0);
 const [calc,setCalc]=useState<{r:SizeResult|null;ctx:CalcCtx|null}>({r:null,ctx:null});
 const onResult=useCallback((r:SizeResult|null,ctx:CalcCtx)=>setCalc({r,ctx}),[]);
 const fixed=useMemo<CalcFixed>(()=>({...account,spec:calcSpec(spec),rate:(a,b)=>a===b?1:rateAt(spec,last,b)}),[account,spec,last]);
 const ok=calc.r&&calc.r.ok?calc.r:null,side:Side=ok?ok.side:sideSel,units=qty.trim()?Number(qty.replace(',','.')):ok?.units??NaN;
 const entry=calc.ctx?.entry,stop=calc.ctx&&Number.isFinite(calc.ctx.stop)?calc.ctx.stop:null,target=calc.ctx?.target??null;
 const wrongStop=type==='market'&&stop!==null&&(side==='long'?stop>=last:stop<=last);
 const submit=async()=>{if(await onSend({symbol:spec.symbol,side,type,price:type==='market'?null:entry,qty:units,sl:stop,tp:target,plannedRisk:ok&&!qty.trim()?ok.moneyAtRisk:null,decisionId})){setQty('');setK(x=>x+1)}};
 return <section className="mt-card rp-card"><h2>Příkaz · {spec.symbol}</h2>
  <div className="mt-chips" role="radiogroup" aria-label="Typ příkazu">{(['market','limit','stop'] as OrderType[]).map(t=><button key={t} type="button" role="radio" aria-checked={type===t} className={type===t?'active':''} onClick={()=>setType(t)}>{t==='market'?'Market':t==='limit'?'Limit':'Stop'}</button>)}</div>
  <p className="rp-hint">Poslední cena (bid) {fp(last)} · ask {fp(last+spec.spread)}. {type==='market'?'Market se vyplní na otevření další svíčky.':'Cena vstupu = pole Vstup v kalkulačce.'}</p>
  <PositionCalculator key={k} title={false} fixed={fixed} initial={{entry:Math.round(last*1e6)/1e6}} onResult={onResult}/>
  <div className="rp-grid">
   {!ok&&<div className="rp-f"><span>Směr</span><div className="mt-chips">{(['long','short'] as Side[]).map(x=><button key={x} type="button" className={sideSel===x?'active':''} onClick={()=>setSide(x)}>{x==='long'?'Long':'Short'}</button>)}</div></div>}
   <label className="rp-f"><span>Objem {ok?`(kalkulačka ${f(ok.units,4)})`:''}</span><input inputMode="decimal" value={qty} placeholder={ok?String(ok.units):''} onChange={e=>setQty(e.target.value)}/></label>
  </div>
  {wrongStop&&<p className="pc-warn"><TriangleAlert size={14}/> Stop loss je na špatné straně aktuální ceny – market by se hned zavřel.</p>}
  <button type="button" className={'mt-btn rp-primary '+side} disabled={busy||!(units>0)||type!=='market'&&!(entry&&entry>0)} onClick={submit}>{side==='long'?'Koupit':'Prodat'} {Number.isFinite(units)?f(units,4):''} · {type}{stop!==null?` · SL ${fp(stop)}`:''}{target!==null?` · TP ${fp(target)}`:''}</button>
 </section>;
}
function Positions({res,active,busy,acc,onSend}:{res:ReturnType<typeof run>|null;active:boolean;busy:boolean;acc:string;onSend:(k:string,d:Record<string,unknown>)=>Promise<boolean>}){
 const [edit,setEdit]=useState<{id:string;sl:string;tp:string}|null>(null);
 if(!res)return null;
 const pending=res.orders.filter(o=>o.status==='pending'),rejected=res.orders.filter(o=>o.status==='rejected').slice(-3);
 return <section className="mt-card rp-card"><h2>Pozice a příkazy</h2>
  <p className="rp-sub">Zůstatek <b>{f(res.balance)} {acc}</b> · equity <b>{f(res.equity)} {acc}</b>{res.prop?.daily&&<> · zbývá denní ztráta {f(res.prop.daily.remaining)}</>}{res.prop?.drawdown&&<> · zbývá drawdown {f(res.prop.drawdown.remaining)}</>}{res.prop?.target&&<> · cíl {f(res.prop.target.progress)} / {f(res.prop.target.amount)}{res.prop.target.done?' ✓':''}</>}</p>
  {!res.open.length&&!pending.length?<p className="rk-muted">Žádná otevřená pozice ani čekající příkaz.</p>:<div className="rp-table-wrap"><table className="rp-table"><thead><tr><th>Trh</th><th>Stav</th><th>Směr</th><th>Objem</th><th>Cena</th><th>SL</th><th>TP</th><th>P&L</th><th/></tr></thead><tbody>
   {res.open.map(p=><tr key={p.orderId}><td>{p.symbol}</td><td>otevřená{p.ambiguous&&<span className="rp-tag warn">nejednoznačné</span>}</td><td>{p.side}</td><td>{p.qty}</td><td>{fp(p.entry)}</td>
    {edit?.id===p.orderId?<><td><input className="rp-num" value={edit.sl} onChange={e=>setEdit({...edit,sl:e.target.value})} aria-label="SL"/></td><td><input className="rp-num" value={edit.tp} onChange={e=>setEdit({...edit,tp:e.target.value})} aria-label="TP"/></td></>:<><td>{fp(p.sl)}</td><td>{fp(p.tp)}</td></>}
    <td className={p.unrealized>=0?'pos':'neg'}>{f(p.unrealized)}</td>
    <td className="rp-actions">{active&&(edit?.id===p.orderId?<><button type="button" className="mt-btn" disabled={busy} onClick={async()=>{if(await onSend('modify',{orderId:p.orderId,sl:edit.sl.trim()?Number(edit.sl.replace(',','.')):null,tp:edit.tp.trim()?Number(edit.tp.replace(',','.')):null}))setEdit(null)}}>Uložit</button><button type="button" className="mt-btn" onClick={()=>setEdit(null)}>×</button></>
     :<><button type="button" className="mt-btn" onClick={()=>setEdit({id:p.orderId,sl:p.sl===null?'':String(p.sl),tp:p.tp===null?'':String(p.tp)})}>SL/TP</button><button type="button" className="mt-btn" disabled={busy} onClick={()=>onSend('close',{orderId:p.orderId})}>{p.closeReq?'zavírá se…':'Zavřít'}</button></>)}</td></tr>)}
   {pending.map(o=><tr key={o.id}><td>{o.symbol}</td><td>čeká · {o.type}</td><td>{o.side}</td><td>{o.qty}</td><td>{o.price===null?'market':fp(o.price)}</td><td>{fp(o.sl)}</td><td>{fp(o.tp)}</td><td/>
    <td className="rp-actions">{active&&<button type="button" className="mt-btn" disabled={busy} onClick={()=>onSend('cancel',{orderId:o.id})}>Zrušit</button>}</td></tr>)}
  </tbody></table></div>}
  {rejected.map(o=><p key={o.id} className="pc-warn"><TriangleAlert size={14}/> Odmítnuto: {o.reason}</p>)}
 </section>;
}
function DecisionCard({sym,checklist,busy,needed,onSend}:{sym:string;checklist:Checklist;busy:boolean;needed:boolean;onSend:(d:Record<string,unknown>)=>Promise<boolean>}){
 const [choice,setChoice]=useState<Choice|null>(null),[note,setNote]=useState(''),[model,setModel]=useState<string>(''),[states,setStates]=useState<Record<string,CheckState>>({});
 const items=(checklist?.items||[]).filter(i=>i.model===null||i.model===(model||null));
 const submit=async()=>{if(!choice)return;if(await onSend({symbol:sym,choice,note,states,model:model||null})){setChoice(null);setNote('');setStates({})}};
 return <section className={'mt-card rp-card'+(needed?' rp-need':'')}><h2>Rozhodnutí · {sym}</h2>
  <div className="mt-chips" role="radiogroup" aria-label="Rozhodnutí">{(Object.keys(CHOICES) as Choice[]).map(c=><button key={c} type="button" role="radio" aria-checked={choice===c} className={choice===c?'active':''} onClick={()=>setChoice(c)}>{CHOICES[c]}</button>)}</div>
  {checklist&&<div className="rp-check-wrap"><p className="rp-sub">Checklist: {checklist.strategyName} v{checklist.version}{checklist.models.length>0&&<> · model <select value={model} onChange={e=>setModel(e.target.value)}><option value="">společné</option>{checklist.models.map(m=><option key={m}>{m}</option>)}</select></>}</p>
   <TriChecklist items={items} states={states} onChange={(id,v)=>setStates({...states,[id]:v})} compact/></div>}
  <label className="rp-f"><span>Poznámka</span><textarea rows={2} value={note} maxLength={1000} onChange={e=>setNote(e.target.value)} placeholder="Proč ano / proč ne"/></label>
  <button type="button" className="mt-btn rp-primary" disabled={busy||!choice} onClick={submit}>Zapsat rozhodnutí</button>
  <p className="rp-hint">Rozhodnutí „bez obchodu“ se počítá do výsledků stejně jako vstupy. Snímek checklistu se uloží k rozhodnutí a k obchodu.</p>
 </section>;
}
function DataPanels({p,symbols}:{p:Panels|null;symbols:string[]}){
 if(!p)return <section className="mt-card rp-card"><h2>Data k času hodin</h2><p className="rk-muted">Načítám (při přehrávání se neobnovuje)…</p></section>;
 const ev=(v:CalView)=><li key={v.id} className={'rp-ev imp-'+v.impact.toLowerCase()}><span className="rp-ev-t">{pragueTime(v.at)}</span><b>{v.currency}</b> {v.title}<span className="rp-ev-v">{v.actual!==null&&<>skut. <b>{v.actual}</b> · </>}odhad {v.forecast??(v.lateCapture?'tehdy neznámý':'–')} · před. {v.previous??'–'}</span>{v.timeMovedLater&&<span className="rp-tag">termín se později posunul</span>}</li>;
 return <section className="mt-card rp-card"><h2>Data k {pragueTime(p.clock)}</h2>
  <h3>Skóre</h3>{p.score?<ul className="rp-list">{symbols.map(m=>{const x=p.score!.items[m];return <li key={m}><b>{m}</b> {x?<>{f(x.score,1)} <small>snímek {new Date(x.at).toLocaleString('cs-CZ',{timeZone:'Europe/Prague'})}{x.reconstructed?' · rekonstruováno':''}{x.coverage!==null?` · pokrytí ${x.coverage} %`:''}</small></>:<small>žádný snímek ≤ hodiny</small>}</li>})}</ul>:<p className="rk-muted">Skóre není dostupné.</p>}
  <h3>COT (podle data zveřejnění)</h3>{p.cot.length?<ul className="rp-list">{p.cot.map(c=><li key={c.currency}><b>{c.currency}</b> net {f(c.net,0)}{c.change!==null&&<> ({c.change>0?'+':''}{f(c.change,0)})</>}{c.netPct!==null&&<> · {f(c.netPct,1)} % OI</>} <small>pozice k {c.date}, zveřejněno {new Date(c.availableAt).toISOString().slice(0,10)}</small></li>)}</ul>:<p className="rk-muted">Žádný zveřejněný report pro tyto trhy.</p>}
  <h3>Kalendář</h3>{p.calendar?<>{p.calendar.next.length>0&&<><p className="rp-sub">Nadcházející (72 h)</p><ul className="rp-list">{p.calendar.next.slice(0,8).map(ev)}</ul></>}<p className="rp-sub">Vydané (48 h)</p>{p.calendar.past.length?<ul className="rp-list">{p.calendar.past.slice(0,8).map(ev)}</ul>:<p className="rk-muted">Nic.</p>}</>:<p className="rk-muted">Historie kalendáře není dostupná.</p>}
  <h3>Makro (poslední vydané)</h3>{p.macro&&p.macro.length?<ul className="rp-list">{p.macro.slice(0,10).map(ev)}</ul>:<p className="rk-muted">Pro tento čas není v historii kalendáře nic vydaného.</p>}
 </section>;
}
type AnyTrade=Trade|TradeRow;
function Results({s,summary,trades,live,decisions,breach,busy,onJournal,acc}:{s:Session;summary:Summary|null;trades:AnyTrade[];live:boolean;decisions:ReplayEvent[];breach:{reason:'daily'|'drawdown';ts:number}|null;busy:boolean;onJournal:()=>void;acc:string}){
 if(!summary)return null;
 const snap=(t:AnyTrade)=>('snapshot' in t?t.snapshot:null) as PlanSnapshot|null;
 return <section className="mt-card rp-card rp-results"><div className="rp-row"><h2>{live?'Průběžné výsledky':'Výsledky seance'}</h2>
  <span className="rp-actions"><a className="mt-btn" href={`/api/replay/sessions/${s.id}/export?format=json`}><Download size={14}/> JSON</a><a className="mt-btn" href={`/api/replay/sessions/${s.id}/export?format=csv`}><Download size={14}/> CSV</a>
   {!live&&!s.journaled&&<button type="button" className="mt-btn rp-primary" disabled={busy||!trades.length} onClick={onJournal}><BookOpen size={14}/> Do Deníku</button>}{s.journaled&&<span className="rp-tag">zapsáno v Deníku (režim Replay)</span>}</span></div>
  {breach&&<p className="rp-banner bad"><ShieldAlert size={15}/> {BREACH_TEXT[breach.reason]} ({pragueTime(breach.ts)}) – prop simulátor seanci ukončil.</p>}
  {s.mode==='validate'&&<p className={'rp-banner '+(summary.integrity.ok?'':'warn')}>{summary.integrity.ok?'Validace čistá – bez přetočení a resetu.':`Validace: ${summary.integrity.rewinds}× přetočeno, ${summary.integrity.resets}× reset.`}</p>}
  <dl className="rp-stats">
   <div><dt>Obchody</dt><dd>{summary.n} <small>({summary.wins} / {summary.losses}{summary.be?` / ${summary.be} BE`:''})</small></dd></div>
   <div><dt>P&L</dt><dd className={summary.pnl>=0?'pos':'neg'}>{f(summary.pnl)} {acc}</dd></div>
   <div><dt>Úspěšnost</dt><dd>{summary.winRate===null?'–':f(summary.winRate,1)+' %'}</dd></div>
   <div><dt>Profit factor</dt><dd>{f(summary.pf)}</dd></div>
   <div><dt>Očekávaná hodnota</dt><dd>{f(summary.expectancy)} {acc}{summary.avgR!==null&&<small> · {f(summary.avgR)} R</small>}</dd></div>
   <div><dt>Celkem R</dt><dd>{f(summary.totalR)} <small>(N = {summary.rCount})</small></dd></div>
   <div><dt>Max. drawdown</dt><dd>{f(summary.maxDD)} {acc}{summary.maxDDPct!==null&&<small> · {f(summary.maxDDPct)} %</small>}</dd></div>
   <div><dt>Náklady</dt><dd><small>komise {f(summary.costs.commission)} · swap {f(summary.costs.swap)} · spread {f(summary.costs.spread)} · skluz {f(summary.costs.slippage)}</small></dd></div>
   <div><dt>Rozhodnutí</dt><dd>{summary.decisions.total} <small>(long {summary.decisions.long} · short {summary.decisions.short} · bez obchodu {summary.decisions.none})</small></dd></div>
   <div><dt>Nejednoznačné / gap</dt><dd>{summary.ambiguous} / {summary.gaps}</dd></div>
  </dl>
  {trades.length>0&&<div className="rp-table-wrap"><table className="rp-table"><thead><tr><th>Trh</th><th>Směr</th><th>Vstup</th><th>Výstup</th><th>Důvod</th><th>Objem</th><th>Čistě</th><th>R</th><th>Příznaky</th></tr></thead><tbody>
   {trades.map(t=><tr key={t.id}><td>{t.symbol}</td><td>{t.side}</td><td>{fp(t.entry)} <small>{pragueTime(t.entryTs)}</small></td><td>{fp(t.exit)} <small>{pragueTime(t.exitTs)}</small></td><td>{REASON[t.reason]??t.reason}</td><td>{t.qty}</td><td className={t.net>=0?'pos':'neg'}>{f(t.net)}</td><td>{f(t.r)}</td>
    <td>{t.ambiguous&&<span className="rp-tag warn" title="SL i TP (nebo vstup a výstup) v jedné svíčce – pořadí neznáme, rozhodla zvolená politika">nejednoznačné</span>}{t.gap&&<span className="rp-tag">gap</span>}{snap(t)&&<details><summary>checklist</summary><SnapshotView snap={snap(t)!}/></details>}</td></tr>)}
  </tbody></table></div>}
  {decisions.length>0&&<details className="rp-decisions"><summary>Rozhodnutí ({decisions.length})</summary><ul className="rp-list">{decisions.map(e=>{const sn=e.data.snapshot as PlanSnapshot|null;return <li key={e.seq}><span className="rp-ev-t">{pragueTime(e.clock)}</span><b>{String(e.data.symbol)}</b> {CHOICES[e.data.choice as Choice]??String(e.data.choice)}{e.data.note?<> – {String(e.data.note)}</>:null}{sn?.eval&&<span className={'rp-tag '+(sn.eval.verdict==='blocked'?'warn':'')}>{sn.eval.verdict==='ready'?'checklist ok':sn.eval.verdict==='blocked'?'povinná nesplněná':'nejisté'}</span>}</li>})}</ul></details>}
 </section>;
}
