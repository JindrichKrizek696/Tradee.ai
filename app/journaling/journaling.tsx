'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowUpRight,ArrowDownRight,ShieldCheck,TriangleAlert,Star as StarIcon,ClipboardList} from 'lucide-react';
import type {JournalList} from '@/lib/journal/types';
import {DEFAULT_FILTER,filterTrades,periodRange,sanitizeFilter,sortTrades,type Filter,type Period} from '@/lib/journal/stats';
import {readAccount,writeAccount} from '../journal/account-pref';
import {Filters} from '../journal/filters';
import {overview,trend,type ReviewLite,type ViolationLite} from '@/lib/discipline/overview';
import type {RuleSettings} from '@/lib/discipline/rules';
import {fmtMoney} from '@/lib/trades';
import {fmtDateTime,fmtDate,fmtNum,plural} from '@/lib/journal/format';
import {ReviewPanel,Stars,ruleLabel,type Strat,type Custom} from './review-panel';
import {Backtest} from './backtest/backtest';
import '../journal/journal.css';
import './journaling.css';
type Rv=ReviewLite&{customBroken:string[]};
type Meta={reviews:Record<string,Rv>;violations:Record<string,ViolationLite[]>;custom:Custom[];strategies:Strat[];rules:RuleSettings};
const PERIODS:[Period,string][]=[['week','Týden'],['month','Měsíc'],['year','Rok'],['all','Vše']],KEY='tradee.journaling',PAGE=50;
// #journaling = obchody, #journaling/<id> = detail obchodu, #journaling/backtest = záložka Backtest
// Vložené do Deníku (Nastavení > Sloučit Deník a Journaling): #journal/vyhodnoceni, #journal/vyhodnoceni/<id>, #journal/backtest
const pfx=(embed?:string)=>embed?'journal/vyhodnoceni':'journaling',btHash=(embed?:string)=>embed?'#journal/backtest':'#journaling/backtest';
const hashId=(embed?:string)=>{const h=location.hash,P='#'+pfx(embed)+'/';if(!h.startsWith(P)||h===btHash(embed))return null;try{return decodeURIComponent(h.slice(P.length))}catch{return null}};
const hashTab=(embed?:string):'trades'|'backtest'=>location.hash===btHash(embed)?'backtest':'trades';
const addDays=(iso:string,d:number)=>new Date(Date.parse(iso+'T12:00:00Z')+d*864e5).toISOString().slice(0,10);
function saved():{filter:Filter;only:{todo:boolean;viol:boolean}}{try{const v=JSON.parse(localStorage.getItem(KEY)||'{}');return {filter:{...DEFAULT_FILTER,period:'month',...(v.filter||{})},only:{todo:!!v.only?.todo,viol:!!v.only?.viol}}}catch{return {filter:{...DEFAULT_FILTER,period:'month'},only:{todo:false,viol:false}}}}
export function Journaling({viewAs,embed}:{viewAs?:{id:string;name:string};embed?:'review'|'backtest'}={}){
 const BT_HASH=btHash(embed),P=pfx(embed),E=embed?'x':undefined;
 const q=viewAs?'?as='+encodeURIComponent(viewAs.id):'';
 const [data,setData]=useState<JournalList|null>(null),[meta,setMeta]=useState<Meta|null>(null),[error,setError]=useState(''),[filter,setFilter]=useState<Filter>(()=>{const f=saved().filter;return viewAs?f:{...f,account:readAccount()}}),[only,setOnly]=useState(()=>saved().only),[detail,setDetail]=useState<string|null>(()=>hashId(E)),[page,setPage]=useState(0),[now]=useState(()=>Date.now()),[tab,setTab]=useState(()=>embed?(embed==='backtest'?'backtest':'trades'):viewAs?'trades':hashTab());
 const dirty=useRef(false),btDirty=useRef(false);
 async function load(){try{const [a,b]=await Promise.all([fetch('/api/journal'+q,{cache:'no-store'}),fetch('/api/journaling'+q,{cache:'no-store'})]);const j=await a.json() as JournalList&{error?:string},m=await b.json() as Meta&{error?:string};if(!a.ok)throw Error(j.error||'');if(!b.ok)throw Error(m.error||'');setData(j);setMeta(m);setError('')}catch(e){setError((e as Error).message||'Journaling se nepodařilo načíst. Zkus obnovit stránku.')}}
 async function reloadMeta(){try{const b=await fetch('/api/journaling'+q,{cache:'no-store'});if(b.ok)setMeta(await b.json() as Meta)}catch{}}
 useEffect(()=>{load();const on=()=>{if(btDirty.current&&location.hash!==BT_HASH){if(!confirm('Pravidla backtestu mají neuložené změny. Opravdu odejít a změny zahodit?')){location.hash=BT_HASH.slice(1);return}}setDetail(hashId(E));if(!viewAs&&!embed)setTab(hashTab())};addEventListener('hashchange',on);
  return()=>{removeEventListener('hashchange',on);if(!embed&&/^#journaling(\/|$)/.test(location.hash))history.replaceState(null,'',location.pathname+location.search)}},[]);
 useEffect(()=>{if(data)setFilter(f=>{const s=sanitizeFilter(f,data.trades,data.accounts);return JSON.stringify(s)===JSON.stringify(f)?f:s})},[data]);
 useEffect(()=>{if(!viewAs)writeAccount(filter.account)},[filter.account,viewAs]);
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify({filter:viewAs?{...filter,account:'all'}:filter,only}))}catch{}},[filter,only,viewAs]);
 useEffect(()=>setPage(0),[filter,only]);
 const trades=useMemo(()=>data?.trades||[],[data]),reviews=meta?.reviews||{},viols=meta?.violations||{};
 const strategies=meta?.strategies||[],custom=meta?.custom||[];
 const base=useMemo(()=>filterTrades(trades,filter,now),[trades,filter,now]);
 const ov=useMemo(()=>overview(base,reviews,viols,Object.fromEntries(Object.entries(reviews).map(([k,v])=>[k,v.customBroken||[]])),strategies),[base,reviews,viols,strategies]);
 // předchozí stejně dlouhé období (jen pro Týden / Měsíc / Rok / 30 a 90 dní / vlastní s Od)
 const prev=useMemo(()=>{
  if(filter.period==='all'||(filter.period==='custom'&&!filter.from))return null;
  const [from,to]=periodRange(filter,now),days=Math.round((Date.parse(to)-Date.parse(from))/864e5)+1;
  if(!(days>0))return null;
  const pt=filterTrades(trades,{...filter,period:'custom',from:addDays(from,-days),to:addDays(from,-1)},now);
  return overview(pt,reviews,viols,Object.fromEntries(Object.entries(reviews).map(([k,v])=>[k,v.customBroken||[]])),strategies).discipline;
 },[filter,trades,now,reviews,viols,strategies]);
 const hasViol=(id:string)=>!!(viols[id]?.length||reviews[id]?.customBroken?.length);
 const list=useMemo(()=>sortTrades(base.filter(t=>(!only.todo||reviews[t.id]?.rating==null)&&(!only.viol||hasViol(t.id))),'closeTs',-1),[base,only,reviews,viols]);// eslint-disable-line react-hooks/exhaustive-deps
 const idx=detail?list.findIndex(t=>t.id===detail):-1;
 const nextId=useMemo(()=>{if(!detail)return null;const from=idx<0?0:idx+1;return list.slice(from).find(t=>reviews[t.id]?.rating==null&&t.id!==detail)?.id??null},[list,idx,detail,reviews]);
 const open=(id:string)=>{if(id===detail)return;if(dirty.current&&!confirm('Máš neuložené změny. Opravdu je zahodit?'))return;location.hash=P+'/'+encodeURIComponent(id)};
 const close=()=>{location.hash=P};
 const go=(t:'trades'|'backtest')=>{if(t===tab)return;if(t==='backtest'&&dirty.current&&!confirm('Máš neuložené změny. Opravdu je zahodit?'))return;location.hash=t==='backtest'?BT_HASH.slice(1):P};
 const head=(extra?:React.ReactNode)=>embed?(extra?<div className="j-head">{extra}</div>:null):<div className="j-head"><div className="jg-titlebar"><h1>Journaling</h1>{!viewAs&&<div className="jg-seg" role="tablist" aria-label="Sekce Journalingu">{([['trades','Obchody'],['backtest','Backtest']] as const).map(([k,l])=><button key={k} type="button" role="tab" aria-selected={tab===k} className={tab===k?'on':''} onClick={()=>go(k)}>{l}</button>)}</div>}</div>{extra}</div>;
 if(tab==='backtest'&&!viewAs)return embed?<Backtest dirtyRef={btDirty}/>:<div className="j-page">{head()}<Backtest dirtyRef={btDirty}/></div>;
 if(!data||!meta)return <div className="j-page">{head()}{error?<p role="alert" className="s-notice">{error}</p>:<p className="j-muted">Načítám Journaling…</p>}</div>;
 const cur=data.currency,d=ov.discipline,tr=trend(d,prev),pages=Math.max(1,Math.ceil(list.length/PAGE)),p=Math.min(page,pages-1),shown=list.slice(p*PAGE,p*PAGE+PAGE);
 const dtone=d===null?'':d>=80?'up':d<60?'down':'mid',topName=ov.top?ruleLabel(ov.top.rule,custom):null;
 const tile=(cls:string,Icon:typeof ShieldCheck,k:string,v:React.ReactNode,sub:React.ReactNode,extra?:React.ReactNode)=><div className={'jg-tile '+cls}><dt><i><Icon size={15}/></i>{k}</dt><dd>{v}</dd><dd className="jg-sub">{sub}</dd>{extra}</div>;
 return <div className={embed?'jg-embed':'j-page'}>
  {viewAs&&<p className="j-viewas" role="status">Prohlížíš Journaling: <b>{viewAs.name}</b> · jen pro čtení</p>}
  {head(<div className="jg-seg" role="tablist" aria-label="Období">{PERIODS.map(([k,l])=><button key={k} type="button" role="tab" aria-selected={filter.period===k} className={filter.period===k?'on':''} onClick={()=>setFilter(f=>({...f,period:k}))}>{l}</button>)}</div>)}
  {error&&<p role="alert" className="s-notice">{error}</p>}
  {!trades.length?<div className="j-card j-empty"><p>Zatím tu nejsou žádné obchody.</p><p>Připoj MetaTrader na stránce <a href="/mt">Propojení s MetaTraderem</a> – obchody se sem pak zapíšou samy a půjdou vyhodnotit.</p></div>:<>
  <dl className="jg-tiles">
   {tile('disc '+dtone,ShieldCheck,'Disciplína',d===null?'—':d+' %',d===null?'Žádné posouzené obchody':<>{ov.clean} z {ov.judged} {plural(ov.judged,['obchodu','obchodů','obchodů'])} bez porušení</>,tr!==null&&<span className={'jg-delta '+(tr>0?'up':tr<0?'down':'')}>{tr>=0?<ArrowUpRight size={13}/>:<ArrowDownRight size={13}/>}{tr>0?'+':''}{fmtNum(tr,0)} p. b. oproti minulému období</span>)}
   {tile('top',TriangleAlert,'Nejčastěji porušené',topName||'—',ov.top?`${ov.top.count}× v tomto období`:'Zatím žádné porušení')}
   {tile('rate',StarIcon,'Průměr',ov.avgRating===null?'—':<>{fmtNum(ov.avgRating,1)} <Stars value={Math.round(ov.avgRating)} size={13}/></>,'z vyhodnocených obchodů')}
   <button type="button" className={'jg-tile todo'+(only.todo?' active':'')} aria-pressed={only.todo} onClick={()=>setOnly(o=>({...o,todo:!o.todo}))}><dt><i><ClipboardList size={15}/></i>K vyhodnocení</dt><dd>{ov.toReview}</dd><dd className="jg-sub">{ov.needReason>0?`${ov.needReason} ${plural(ov.needReason,['zdůvodnění chybí','zdůvodnění chybí','zdůvodnění chybí'])}`:only.todo?'Zobrazeny jen nevyhodnocené':'Klikni pro zobrazení'}</dd></button>
  </dl>
  {ov.byStrategy.length>0&&<div className="j-card j-tablecard jg-strat"><table className="j-table"><caption>Podle strategie</caption><thead><tr><th>Strategie</th><th>Obchodů</th><th>Win rate</th><th>Výsledek</th><th>Průměr ★</th></tr></thead><tbody>{ov.byStrategy.map(s=><tr key={s.id||'none'} style={{cursor:'default'}}><td data-l="Strategie"><b>{s.name}</b></td><td data-l="Obchodů">{s.trades}</td><td data-l="Win rate">{s.winRate} %</td><td data-l="Výsledek" className={s.pnl>0?'pos':s.pnl<0?'neg':''}>{fmtMoney(s.pnl,cur)}</td><td data-l="Průměr ★">{s.avgRating===null?'–':fmtNum(s.avgRating,1)}</td></tr>)}</tbody></table></div>}
  <Filters filter={filter} onChange={setFilter} trades={trades} accounts={data.accounts}/>
  <div className="jg-toggles"><label className="jg-check"><input type="checkbox" checked={only.todo} onChange={e=>setOnly(o=>({...o,todo:e.target.checked}))}/><span>Jen nevyhodnocené</span></label><label className="jg-check"><input type="checkbox" checked={only.viol} onChange={e=>setOnly(o=>({...o,viol:e.target.checked}))}/><span>Jen s porušením</span></label><span className="j-muted">{list.length} {plural(list.length,['obchod','obchody','obchodů'])}</span></div>
  <div className={'jg-layout'+(detail?' has-panel':'')}>
   <div>{!list.length?<p className="j-muted">Filtru neodpovídá žádný obchod.</p>:<div className="j-card j-tablecard"><table className="j-table jg-table">
    <thead><tr><th>Zavřeno</th><th>Pár</th><th>Směr</th><th>Výsledek</th><th>Hodnocení</th><th>Strategie</th><th>Porušení</th></tr></thead>
    <tbody>{shown.map(t=>{const rv=reviews[t.id],vs=viols[t.id]||[],cb=rv?.customBroken||[],miss=vs.some(v=>v.needsReason&&!v.reasoned),sname=rv?.strategyId?strategies.find(s=>s.id===rv.strategyId)?.name:null;
     return <tr key={t.id} tabIndex={0} className={t.id===detail?'sel':''} aria-selected={t.id===detail} onClick={()=>open(t.id)} onKeyDown={e=>{if(e.key==='Enter')open(t.id)}}>
      <td data-l="Zavřeno">{t.source==='mt'?fmtDateTime(t.closeTs):fmtDate(t.date)}</td>
      <td data-l="Pár"><b>{t.symbol}</b></td>
      <td data-l="Směr">{t.side?<span className={'j-side '+t.side}>{t.side==='buy'?'Buy':'Sell'}</span>:'–'}</td>
      <td data-l="Výsledek" className={t.pnl>0?'pos':t.pnl<0?'neg':''}>{fmtMoney(t.pnl,t.converted?cur:t.accountCurrency||cur)}</td>
      <td data-l="Hodnocení"><Stars value={rv?.rating??null} size={13}/></td>
      <td data-l="Strategie">{sname||'–'}</td>
      <td data-l="Porušení" className="jg-tags">{vs.map((v,i)=><span key={i} className="jg-tag bad">{ruleLabel(v.rule,custom)}</span>)}{cb.map(c=><span key={c} className="jg-tag bad">{ruleLabel('custom:'+c,custom)}</span>)}{miss&&<span className="jg-tag warn">Chybí zdůvodnění</span>}</td>
     </tr>})}</tbody></table>
    {pages>1&&<div className="j-pager"><button type="button" disabled={p===0} onClick={()=>setPage(p-1)}>← Předchozí</button><span>{p+1} / {pages}</span><button type="button" disabled={p>=pages-1} onClick={()=>setPage(p+1)}>Další →</button></div>}</div>}</div>
   {detail&&<ReviewPanel key={detail} id={detail} trade={trades.find(t=>t.id===detail)} currency={cur} strategies={strategies} custom={custom} readOnly={!!viewAs} query={q} nextId={nextId} dirtyRef={dirty} onClose={close} onOpen={open} onSaved={reloadMeta}/>}
  </div></>}
 </div>;
}
