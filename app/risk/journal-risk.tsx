'use client';
// Deník: limity profilu vybraného účtu (zbývající denní ztráta a drawdown) a „Nový obchod“ = okno s kalkulačkou pozice.
import {useEffect,useState} from 'react';
import {Calculator,X} from 'lucide-react';
import {useRisk,activeProfiles,writeProfilePref} from './risk-context';
import {RiskStatus} from './account-risk';
import {PositionCalculator} from './position-calculator';
import '../mt.css';
import './risk.css';
export function JournalRisk({account}:{account:string}){
 const {data}=useRisk(),[open,setOpen]=useState(false);
 const list=activeProfiles(data),shown=account==='all'?list:list.filter(p=>p.linkId===account);
 useEffect(()=>{if(!open)return;const k=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[open]);
 const start=()=>{if(shown.length===1)writeProfilePref(shown[0].id);setOpen(true)};
 return <>
  <div className="j-risk">
   {shown.map(p=><span key={p.id} className="j-risk-p" title={p.name}>{list.length>1&&<b className="rk-kind">{p.name}</b>}<RiskStatus profile={p} compact/></span>)}
   {data&&!list.length&&<a className="rk-muted" href="/ucty">Nastav profil účtu a uvidíš tu zbývající denní ztrátu a drawdown.</a>}
   <button type="button" className="mt-btn" onClick={start}><Calculator size={15}/> Nový obchod · kalkulačka</button>
  </div>
  {open&&<div className="pc-modal" role="dialog" aria-modal="true" aria-label="Nový obchod – kalkulačka pozice" onClick={e=>{if(e.target===e.currentTarget)setOpen(false)}}><div>
   <div className="ua-head"><h2>Nový obchod</h2><button type="button" className="mt-icon" onClick={()=>setOpen(false)} aria-label="Zavřít"><X size={16}/></button></div>
   <PositionCalculator title={false}/>
  </div></div>}
 </>;
}
