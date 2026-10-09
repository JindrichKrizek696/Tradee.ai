'use client';
import {useEffect,useMemo,useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import type {JournalList} from '@/lib/journal/types';
import {DEFAULT_FILTER,filterTrades} from '@/lib/journal/stats';
import {plural} from '@/lib/journal/format';
import {overview,type ReviewLite,type ViolationLite} from '@/lib/discipline/overview';
import {ruleLabel,type Custom} from './journaling/review-panel';
import './discipline-tile.css';
type Data={trades:JournalList['trades'];reviews:Record<string,ReviewLite&{customBroken?:string[]}>;violations:Record<string,ViolationLite[]>;custom:Custom[];strategies:{id:string;name:string}[]};
const PW={week:'tento týden',month:'tento měsíc',year:'letos',all:'celou dobu'};
const TRADES=['obchod','obchody','obchodů'] as const,PROMPTS=['výzva ke zdůvodnění','výzvy ke zdůvodnění','výzev ke zdůvodnění'] as const;
// Dlaždice Disciplína na Dashboardu: účet sdílený s „Můj trading“, období z „Můj trading“ (výchozí Měsíc).
export function DisciplineTile({now,account,period='month',rev=0,style}:{now:number;account:string;period?:keyof typeof PW;rev?:number;style?:React.CSSProperties}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(false);
 useEffect(()=>{let live=true;
  Promise.all([fetch('/api/journal',{cache:'no-store'}),fetch('/api/journaling',{cache:'no-store'})]).then(async([a,b])=>{
   if(!a.ok||!b.ok)throw Error();
   const j=await a.json() as JournalList,g=await b.json() as Omit<Data,'trades'>;
   if(live){setData({trades:j.trades,...g});setError(false)}
  }).catch(()=>{if(live)setError(true)});
  return()=>{live=false}},[rev]);
 const ov=useMemo(()=>{
  if(!data)return null;
  const list=filterTrades(data.trades,{...DEFAULT_FILTER,account,period},now);
  return overview(list,data.reviews,data.violations,Object.fromEntries(Object.entries(data.reviews).map(([k,v])=>[k,v.customBroken||[]])),data.strategies);
 },[data,account,period,now]);
 const go=()=>{location.hash='journaling'};
 const body=!ov?<p className="dt-muted">{error?'Disciplínu se nepodařilo načíst.':'Načítám…'}</p>
  :ov.discipline===null?<p className="dt-muted">Zatím žádné obchody k posouzení. <a href="/pravidla">Nastav si pravidla</a></p>
  :<><p className={'dt-pct '+(ov.discipline>=80?'up':ov.discipline>=50?'mid':'down')}>{ov.discipline} %</p>
   <p className="dt-sub">{ov.clean} {plural(ov.clean,TRADES)} bez porušení z {ov.judged}</p>
   {ov.top&&<p className="dt-top">Nejčastěji: <b>{ruleLabel(ov.top.rule,data!.custom)}</b> ({ov.top.count}×)</p>}
   {ov.needReason>0&&<span className="dt-chip">{ov.needReason} {plural(ov.needReason,PROMPTS)}</span>}</>;
 const key=(e:React.KeyboardEvent)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}};
 const nodata=!!ov&&ov.discipline===null;
 const head=<h2><ShieldCheck size={16}/>Disciplína <span>· {PW[period]}</span></h2>;
 return <section className="d-card d-disc" style={style}>
  {nodata?<div className="dt-main">{head}{body}</div>
  :<div className="dt-main" role="link" tabIndex={0} onClick={go} onKeyDown={key} aria-label={'Disciplína, '+PW[period]+'. Otevřít Journaling'}>{head}{body}</div>}
 </section>;
}
