'use client';
// Záložka Nápady: pozice seskupené do nápadů (stejný trh a směr; okno od prvního vstupu nebo propojení se scénářem), ruční přeskupení / rozdělení,
// limit rizika nápadu s rezervací čekajících limitních vstupů a zrušené nevyplněné vstupy.
import {useEffect,useMemo,useState} from 'react';
import {AlertTriangle} from 'lucide-react';
import type {IdeaView} from '@/lib/journal/record-store';
import {LEG_STATUSES} from '@/lib/journal/ideas';
import {fmtMoney} from '@/lib/trades';
import {fmtNum,fmtR,fmtDateTime} from '@/lib/journal/format';
import './record.css';
type Data={window:number;ideas:IdeaView[]};
const KIND={manual:'ručně',auto:'automaticky',scenario:'ze scénáře'};
async function post(body:unknown){const r=await fetch('/api/journal/ideas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({})) as {error?:string;id?:string};if(!r.ok)throw Error(j.error||'Akce se nepovedla.');return j}
export function IdeasView({account,readOnly,query='',onOpen,focus}:{account:string;readOnly:boolean;query?:string;onOpen:(id:string)=>void;focus?:string|null}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[win,setWin]=useState(''),[open,setOpen]=useState<string|null>(focus??null),[busy,setBusy]=useState(false),[showAll,setShowAll]=useState(false);
 async function load(){try{const r=await fetch('/api/journal/ideas'+query,{cache:'no-store'});const j=await r.json() as Data&{error?:string};if(!r.ok)throw Error(j.error||'');setData(j);setWin(String(j.window));setError('')}catch(e){setError((e as Error).message||'Nápady se nepodařilo načíst.')}}
 useEffect(()=>{load()},[]);
 useEffect(()=>{if(focus){setOpen(focus);setTimeout(()=>document.getElementById('idea-'+focus)?.scrollIntoView?.({block:'center'}),50)}},[focus,data]);
 async function act(body:unknown){setBusy(true);try{const j=await post(body);setError('');await load();if(j.id)setOpen(j.id)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function saveWin(){const n=Number(win);if(!data||n===data.window)return;try{const r=await fetch('/api/journal/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ideaWindow:n})});const j=await r.json() as {error?:string};if(!r.ok)throw Error(j.error||'');await load()}catch(e){setError((e as Error).message||'Okno se nepodařilo uložit.')}}
 const list=useMemo(()=>(data?.ideas||[]).filter(i=>account==='all'||i.accountId===account).filter(i=>showAll||i.legs.length>1||i.kind!=='auto'||i.capPct!==null),[data,account,showAll]);
 if(!data)return <p className="j-muted">{error||'Načítám nápady…'}</p>;
 return <div className="ji">
  <div className="j-card"><p className="j-muted" style={{marginTop:0}}>Nápad spojuje vstupy na stejném trhu a ve stejném směru – přikupování, dva vstupy z různých zón i částečné výstupy. Průměrný vstup je vážený objemem a R se počítá z rizika všech vstupů do jejich prvních stopů.</p>
   <div className="ji-form">
    <label className="j-field"><span>Okno seskupení (min od prvního vstupu)</span><input type="number" min={5} max={10080} value={win} disabled={readOnly} onChange={e=>setWin(e.target.value)} onBlur={saveWin}/></label>
    <label className="jg-check"><input type="checkbox" checked={showAll} onChange={e=>setShowAll(e.target.checked)}/> <span>Zobrazit i nápady s jedním vstupem</span></label>
   </div></div>
  {error&&<p role="alert" className="s-notice">{error}</p>}
  {!list.length&&<p className="j-muted">{showAll?'Zatím žádné nápady.':'Žádný nápad s více vstupy. Zapni „Zobrazit i nápady s jedním vstupem“.'}</p>}
  {list.map(i=><IdeaCard key={i.id} idea={i} all={data.ideas} open={open===i.id} onToggle={()=>setOpen(open===i.id?null:i.id)} readOnly={readOnly} busy={busy} act={act} onOpen={onOpen}/>)}
 </div>;
}
function IdeaCard({idea:i,all,open,onToggle,readOnly,busy,act,onOpen}:{idea:IdeaView;all:IdeaView[];open:boolean;onToggle:()=>void;readOnly:boolean;busy:boolean;act:(b:unknown)=>Promise<void>;onOpen:(id:string)=>void}){
 const s=i.summary,cur=i.currency,money=(v:number|null)=>v===null?'–':fmtMoney(v,cur);
 const [cap,setCap]=useState(i.capPct===null?'':String(i.capPct)),[stop,setStop]=useState(i.stop===null?'':String(i.stop)),[note,setNote]=useState(i.note),[leg,setLeg]=useState({price:'',qty:'',stop:'',riskPct:'',note:''});
 const targets=all.filter(x=>x.id!==i.id&&x.symbol===i.symbol&&x.side===i.side).slice(0,20);
 const capW=s.cap.cap?Math.min(100,s.cap.filled/s.cap.cap*100):0,penW=s.cap.cap?Math.min(100-capW,s.cap.pending/s.cap.cap*100):0;
 return <section id={'idea-'+i.id} className={'j-card ji-card'+(open?' ji-hl':'')}>
  <div className="ji-head"><h3><button type="button" className="j-back" onClick={onToggle} aria-expanded={open}>{i.symbol}</button><span className={'j-side '+i.side}>{i.side==='buy'?'Buy':'Sell'}</span><span className="ji-kind">{KIND[i.kind]}</span><small className="j-muted">{i.account}</small></h3>
   <div className="ji-stats"><span>Vstupy <b>{s.filled}</b>{s.legs>s.filled?` + ${s.legs-s.filled} plán`:''}</span><span>Vážený vstup <b>{s.avgEntry===null?'–':fmtNum(s.avgEntry)}</b></span><span>Stop <b>{s.stop===null?'–':fmtNum(s.stop)}</b></span><span>Riziko <b>{s.plannedRisk===null?'neznámé':money(-s.plannedRisk)}</b></span><span>Výsledek <b className={s.net>0?'pos':s.net<0?'neg':''}>{money(s.net)}</b></span><span>R <b>{s.status==='closed'?(s.r===null?'neznámé R':fmtR(s.r)):'běží'}</b></span></div></div>
  {(s.cap.cap!==null||s.cap.pending>0)&&<div><div className={'ji-bar'+(s.cap.over?' over':'')} role="img" aria-label={`Využito ${s.cap.filled} %, čeká ${s.cap.pending} % z limitu ${s.cap.cap??'–'} %`}><i className="f" style={{width:capW+'%'}}/><i className="p" style={{width:penW+'%'}}/></div>
   <small className="j-muted">Otevřené + uzavřené {fmtNum(s.cap.filled,2)} % · čeká {fmtNum(s.cap.pending,2)} % · celkem {fmtNum(s.cap.total,2)} %{s.cap.cap!==null?` z limitu ${fmtNum(s.cap.cap,2)} %`:''}</small></div>}
  {i.warnings.map(w=><p key={w} className="jr-warn"><AlertTriangle size={14} aria-hidden/> {w}</p>)}
  {open&&<>
   <table className="j-table ji-legs"><thead><tr><th>Vstup</th><th>Stav</th><th>Cena</th><th>Objem</th><th>Stop</th><th>Riziko</th><th>Výsledek</th><th/></tr></thead>
    <tbody>{i.legs.map(l=><tr key={l.id}>
     <td data-l="Vstup">{l.tradeId?<button type="button" className="j-back" onClick={()=>onOpen(l.tradeId!)}>{l.openTs?fmtDateTime(l.openTs):'–'}</button>:l.note||'plánovaný'}</td>
     <td data-l="Stav">{LEG_STATUSES[l.status]}</td><td data-l="Cena">{fmtNum(l.price)}</td><td data-l="Objem">{fmtNum(l.qty,2)}</td><td data-l="Stop">{fmtNum(l.stop)}</td>
     <td data-l="Riziko">{l.riskPct===null?'–':fmtNum(l.riskPct,2)+' %'}</td><td data-l="Výsledek" className={(l.net??0)>0?'pos':(l.net??0)<0?'neg':''}>{l.net===null?'–':money(l.net)}</td>
     <td>{!readOnly&&<div className="ji-acts">{l.tradeId?<>{i.legs.filter(x=>x.tradeId).length>1&&<button type="button" disabled={busy} onClick={()=>act({action:'split',tradeId:l.tradeId})}>Oddělit</button>}
       {targets.length>0&&<select aria-label="Přesunout do nápadu" value="" disabled={busy} onChange={e=>{if(e.target.value)act({action:'assign',tradeIds:[l.tradeId],ideaId:e.target.value})}}><option value="">Přesunout do…</option>{targets.map(t=><option key={t.id} value={t.id}>{t.summary.firstTs?fmtDateTime(t.summary.firstTs):t.id} · {t.summary.filled} vst.</option>)}</select>}
       {i.kind==='manual'&&<button type="button" disabled={busy} onClick={()=>act({action:'reset',tradeId:l.tradeId})}>Automaticky</button>}</>
      :l.status==='pending'?<><button type="button" disabled={busy} onClick={()=>act({action:'cancel',legId:l.id})}>Zrušit (nevyplněn)</button><button type="button" disabled={busy} onClick={()=>act({action:'remove',legId:l.id})}>Smazat</button></>
      :<button type="button" disabled={busy} onClick={()=>act({action:'remove',legId:l.id})}>Smazat</button>}</div>}</td></tr>)}</tbody></table>
   {!readOnly&&<>
    <div className="ji-form"><label className="j-field"><span>Limit rizika nápadu (%)</span><input inputMode="decimal" value={cap} onChange={e=>setCap(e.target.value)} placeholder="např. 1"/></label>
     <label className="j-field"><span>Společný stop</span><input inputMode="decimal" value={stop} onChange={e=>setStop(e.target.value)} placeholder={s.stop===null?'':String(s.stop)}/></label>
     <label className="j-field jr-grow"><span>Poznámka</span><input maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
     <button type="button" className="j-btn" disabled={busy} onClick={()=>act({action:'update',ideaId:i.id,capPct:cap,stop,note})}>Uložit</button></div>
    <div className="ji-form"><b style={{width:'100%',fontSize:13}}>Čekající limitní vstup (rezervuje riziko)</b>
     <label className="j-field"><span>Cena</span><input inputMode="decimal" value={leg.price} onChange={e=>setLeg(x=>({...x,price:e.target.value}))}/></label>
     <label className="j-field"><span>Objem</span><input inputMode="decimal" value={leg.qty} onChange={e=>setLeg(x=>({...x,qty:e.target.value}))}/></label>
     <label className="j-field"><span>Stop</span><input inputMode="decimal" value={leg.stop} onChange={e=>setLeg(x=>({...x,stop:e.target.value}))}/></label>
     <label className="j-field"><span>Riziko %</span><input inputMode="decimal" value={leg.riskPct} onChange={e=>setLeg(x=>({...x,riskPct:e.target.value}))}/></label>
     <label className="j-field jr-grow"><span>Poznámka (zóna)</span><input maxLength={300} value={leg.note} onChange={e=>setLeg(x=>({...x,note:e.target.value}))}/></label>
     <button type="button" className="j-btn" disabled={busy} onClick={()=>act({action:'leg',ideaId:i.id,...leg}).then(()=>setLeg({price:'',qty:'',stop:'',riskPct:'',note:''}))}>Přidat vstup</button></div>
   </>}
  </>}
 </section>;
}
