'use client';
// Zbývající denní ztráta a drawdown profilu účtu: proužek (kalkulačka, Deník) a karta na Dashboardu.
import {ShieldAlert,Wallet} from 'lucide-react';
import {fmtAmount} from '@/lib/trades';
import {KIND_LABELS} from '@/lib/risk/account';
import {useRisk,activeProfiles,type ClientProfile} from './risk-context';
import './risk.css';
const amt=(n:number,c:string)=>fmtAmount(Math.round(n*100)/100,c);
// barva podle zbývající části limitu: > 50 % klid, > 20 % pozor, jinak červeně
export const leftTone=(remaining:number,limit:number)=>remaining<=0?'down':limit>0&&remaining/limit<=0.2?'down':limit>0&&remaining/limit<=0.5?'mid':'up';
const resetText=(ts:number)=>new Date(ts).toLocaleString('cs-CZ',{weekday:'short',hour:'2-digit',minute:'2-digit'});
/** Kompaktní řádek: „Denní ztráta zbývá 360 z 510 USD · Drawdown zbývá 1 400 USD“. */
export function RiskStatus({profile,compact}:{profile:ClientProfile;compact?:boolean}){
 const s=profile.status,c=profile.currency;
 if(!s)return <p className="rk-strip rk-muted">Stav účtu se nepodařilo spočítat.</p>;
 const items:React.ReactNode[]=[];
 if(s.daily)items.push(<span key="d" className={'rk-chip '+leftTone(s.daily.remaining,s.daily.limit)} title={`Limit ${amt(s.daily.limit,c)} · zůstatek na začátku dne ${amt(s.daily.dayStartBalance,c)} · reset ${resetText(s.daily.resetAt)}`}>Denní ztráta: zbývá <b>{amt(s.daily.remaining,c)}</b>{!compact&&<> z {amt(s.daily.limit,c)}</>}</span>);
 if(s.drawdown)items.push(<span key="dd" className={'rk-chip '+leftTone(s.drawdown.remaining,s.drawdown.limit)} title={`${s.drawdown.type==='trailing'?'Trailing':'Statický'} drawdown ${amt(s.drawdown.limit,c)} · dno ${amt(s.drawdown.floor,c)} · vrchol ${amt(s.drawdown.peak,c)}`}>Drawdown: zbývá <b>{amt(s.drawdown.remaining,c)}</b>{!compact&&<> (dno {amt(s.drawdown.floor,c)})</>}</span>);
 if(!compact&&s.target)items.push(<span key="t" className={'rk-chip '+(s.target.done?'up':'')}>Cíl: {s.target.done?'splněn':<>zbývá <b>{amt(s.target.remaining,c)}</b></>}</span>);
 if(!compact&&s.consistency&&!s.consistency.ok)items.push(<span key="c" className="rk-chip mid" title={`Nejlepší den ${amt(s.consistency.bestDay,c)} z celkem ${amt(s.consistency.total,c)}`}>Konzistence: nejlepší den {s.consistency.sharePct} % (max {s.consistency.max} %)</span>);
 if(!items.length)return <p className="rk-strip rk-muted">Profil {profile.name} nemá denní limit ani drawdown. <a href="/ucty">Nastavit</a></p>;
 return <p className="rk-strip" aria-label={'Rizikové limity účtu '+profile.name}>{items}</p>;
}
/** Dlaždice Dashboardu: limity všech aktivních profilů (nebo odkaz na založení). */
export function AccountRiskCard({style}:{style?:React.CSSProperties}){
 const {data,error}=useRisk(),list=activeProfiles(data);
 // Na dashboardu jen když má uživatel profil účtu (prázdná výzva patří do /ucty a průvodce)
 if(data&&!list.length)return null;
 return <section className="d-card rk-card" style={style} aria-labelledby="rk-card-h">
  <div className="d-head"><h2 id="rk-card-h">Limity účtů</h2><a className="d-meta" href="/ucty">Účty a riziko</a></div>
  {error&&!data?<p className="rk-muted">{error}</p>:!data?<p className="rk-muted">Načítám…</p>:!list.length?<div className="rk-empty"><Wallet size={18}/><p>Založ si profil účtu (osobní, challenge nebo funded) a uvidíš tu zbývající denní ztrátu a drawdown. <a href="/ucty">Založit profil</a></p></div>
  :<ul className="rk-list">{list.map(p=>{const s=p.status;return <li key={p.id}>
    <div className="rk-name"><b>{p.name}</b><span className="rk-kind">{KIND_LABELS[p.kind]}</span>{s?.breached.length?<span className="rk-breach"><ShieldAlert size={13}/> limit překročen</span>:null}<span className="rk-bal">{s?amt(s.equity,p.currency):''}</span></div>
    <RiskStatus profile={p}/>
   </li>})}</ul>}
 </section>;
}
