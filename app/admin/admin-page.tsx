'use client';
import {useCallback,useEffect,useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import {fmtAmount} from '@/lib/trades';
import type {Overview,Person,AdminMtAccount,AuditRow} from '@/lib/admin/store';
import '../mt.css';
import './admin.css';
type Filter='all'|'pending'|'approved'|'blocked';
const FILTERS:[Filter,string][]=[['all','Vše'],['pending','Čekající'],['approved','Schválení'],['blocked','Zablokovaní']];
const STATUS:Record<string,string>={pending:'čeká',approved:'schválen',blocked:'zablokován',owner:'vlastník'};
const ACTION:Record<string,string>={approve:'schválil',block:'zablokoval',unblock:'odblokoval',role_admin:'udělal adminem',role_member:'odebral admina',view_journal:'otevřel deník',view_trade:'otevřel obchod'};
const utc=(s:string|null)=>s?new Date(s.replace(' ','T')+'Z').getTime():0;
function ago(s:string|null){if(!s)return 'nikdy';const m=Math.round((Date.now()-utc(s))/60000);if(m<1)return 'právě teď';if(m<60)return `před ${m} min`;const h=Math.round(m/60);if(h<48)return `před ${h} h`;return `před ${Math.round(h/24)} dny`}
const stamp=(s:string|null|undefined)=>{const t=s?(/^\d{4}-\d\d-\d\d \d/.test(s)?utc(s):Date.parse(s)):NaN;return Number.isFinite(t)?new Date(t).toLocaleString('cs-CZ',{timeZone:'Europe/Prague'}):'neznámo'};
const day=(s:string|null)=>{const m=s&&/^(\d{4})-(\d\d)-(\d\d)/.exec(s);return m?new Date(+m[1],+m[2]-1,+m[3]).toLocaleDateString('cs-CZ'):'–'};
async function get<T>(url:string){const r=await fetch(url,{cache:'no-store'});const j=await r.json().catch(()=>({})) as T&{error?:string};if(!r.ok)throw Object.assign(Error((j as {error?:string}).error||'Data se nepodařilo načíst.'),{status:r.status});return j}
export default function AdminPage(){
 const [ov,setOv]=useState<Overview|null>(null),[ppl,setPpl]=useState<Person[]>([]),[me,setMe]=useState({id:'',owner:false}),[mt,setMt]=useState<AdminMtAccount[]>([]),[log,setLog]=useState<AuditRow[]>([]);
 const [fund,setFund]=useState<{checkedAt?:string;prices?:string}>({}),[error,setError]=useState(''),[denied,setDenied]=useState(false),[ready,setReady]=useState(false),[filter,setFilter]=useState<Filter>('all'),[q,setQ]=useState(''),[busy,setBusy]=useState('');
 const reload=useCallback(async(parts?:'people')=>{try{
  if(parts==='people'){const [o,p]=await Promise.all([get<Overview>('/api/admin/overview'),get<{people:Person[]}>('/api/admin/people')]);setOv(o);setPpl(p.people);setError('');return}
  const w=await get<{user?:{owner?:boolean}}>('/api/watchlist'),owner=!!w.user?.owner;
  const [o,p,m,a]=await Promise.all([get<Overview>('/api/admin/overview'),get<{people:Person[];me:{id:string;owner:boolean}}>('/api/admin/people'),get<{accounts:AdminMtAccount[]}>('/api/admin/mt'),get<{audit:AuditRow[]}>('/api/admin/audit')]);
  setOv(o);setPpl(p.people);setMe(p.me);setMt(m.accounts);setLog(a.audit);setError('');setReady(true);
  get<{checkedAt?:string;scoreMarket?:{refresh?:{attemptedAt?:string}}}>('/api/fundamentals').then(f=>setFund({checkedAt:f.checkedAt,prices:f.scoreMarket?.refresh?.attemptedAt})).catch(()=>{});
 }catch(e){if((e as {status?:number}).status===403)setDenied(true);else setError((e as Error).message||'Data se nepodařilo načíst. Obnov stránku.');setReady(true)}},[]);
 useEffect(()=>{reload()},[reload]);
 async function act(email:string,action:string,confirm?:string){if(confirm&&!window.confirm(confirm))return;setBusy(email);try{const r=await fetch('/api/admin/people',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,action})});const j=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw Error(j.error||'Akce se nepovedla.');await reload('people')}catch(e){setError((e as Error).message)}setBusy('')}
 const needle=q.trim().toLowerCase(),list=ppl.filter(p=>(filter==='all'||p.status===filter)&&(!needle||p.email.toLowerCase().includes(needle)||p.name.toLowerCase().includes(needle)));
 const top=<header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>;
 if(denied)return <div className="mt-page">{top}<main className="mt-main"><section className="mt-card"><h1>Administrace</h1><p className="mt-empty">Sem nemáš přístup.</p><a className="mt-btn" href="/">Zpět do Tradee</a></section></main></div>;
 const kpi=(l:string,v:string|number,s?:string)=><div className="ad-kpi" key={l+s}><span>{l}</span><b>{v}</b>{s&&<small>{s}</small>}</div>;
 return <div className="mt-page">{top}
  <main className="mt-main">
   <h1>Administrace</h1>
   {error&&<p className="mt-alert" role="alert">{error}</p>}
   {!ready&&<p className="mt-empty">Načítám…</p>}
   {ov&&<section className="mt-card" aria-label="Přehled"><h2>Přehled</h2><div className="ad-kpis">
    {kpi('Uživatelé',ov.users.total,`${ov.users.approved} schválených · ${ov.users.pending} čeká · ${ov.users.blocked} zablokováno`)}
    {kpi('Admini',ov.users.admins)}
    {kpi('Waitlist za 7 dní',ov.waitlist7d)}
    {kpi('MT účty',ov.mt.accounts,`${ov.mt.online} online`)}
    {kpi('Obchody dnes',ov.mt.trades1d)}{kpi('Obchody 7 dní',ov.mt.trades7d)}{kpi('Obchody 30 dní',ov.mt.trades30d)}
    {kpi('Data','Fundamenty',`ověřeny ${stamp(fund.checkedAt)}`)}
    {kpi('Data','Ceny',`obnoveny ${stamp(fund.prices)}`)}
   </div></section>}
   {ready&&!denied&&<section className="mt-card" aria-label="Lidé"><h2>Lidé</h2>
    <div className="ad-tools"><div className="mt-chips" role="group" aria-label="Filtr">{FILTERS.map(([k,l])=><button key={k} type="button" className={filter===k?'active':''} aria-pressed={filter===k} onClick={()=>setFilter(k)}>{l}</button>)}</div>
    <input className="ad-search" type="search" aria-label="Hledat podle e-mailu nebo jména" placeholder="Hledat e-mail nebo jméno" value={q} onChange={e=>setQ(e.target.value)}/></div>
    {!list.length?<p className="mt-empty">Nikdo nevyhovuje filtru.</p>:<table className="mt-table ad-table"><thead><tr><th>Uživatel</th><th>Stav</th><th>Role</th><th>Zapsán</th><th>Poslední přihlášení</th><th>MT účty</th><th>Akce</th></tr></thead><tbody>{list.map(p=>{const self=p.memberId===me.id&&!!me.id,none=p.isOwner||self,off=busy===p.email;return <tr key={p.email}>
     <td className="ad-main"><b>{p.email}</b>{p.name&&p.name!==p.email&&<small>{p.name}</small>}</td>
     <td data-l="Stav"><span className={'mt-tag ad-st '+p.status}>{STATUS[p.status]}</span></td>
     <td data-l="Role">{p.role==='admin'?'admin':p.role?'člen':'–'}</td>
     <td data-l="Zapsán">{day(p.created)}</td>
     <td data-l="Poslední přihlášení">{p.lastLogin?ago(p.lastLogin):<span title="Přihlášení se zaznamenávají od 8. 10. 2026">–</span>}</td>
     <td data-l="MT účty">{p.mtAccounts}</td>
     <td className="ad-acts">{!none&&<>
      {p.status==='pending'&&<button type="button" className="mt-btn dark" disabled={off} onClick={()=>act(p.email,'approve')}>Schválit</button>}
      {p.status==='approved'&&<button type="button" className="mt-btn" disabled={off} onClick={()=>act(p.email,'block',`Zablokovat ${p.email}? Ztratí přístup do Tradee a jeho EA přestane posílat data.`)}>Zablokovat</button>}
      {p.status==='blocked'&&<button type="button" className="mt-btn" disabled={off} onClick={()=>act(p.email,'unblock')}>Odblokovat</button>}
      {me.owner&&p.memberId&&(p.role==='admin'?<button type="button" className="mt-btn" disabled={off} onClick={()=>act(p.email,'role_member',`Odebrat ${p.email} roli admina?`)}>Odebrat admina</button>:<button type="button" className="mt-btn" disabled={off} onClick={()=>act(p.email,'role_admin',`Udělat z ${p.email} admina?`)}>Udělat adminem</button>)}
     </>}</td>
    </tr>})}</tbody></table>}
   </section>}
   {ready&&!denied&&<section className="mt-card" aria-label="MetaTrader účty"><h2>MetaTrader účty</h2>
    {!mt.length?<p className="mt-empty">Zatím nikdo nepřipojil MetaTrader.</p>:<table className="mt-table ad-table"><thead><tr><th>Majitel</th><th>Účet</th><th>EA</th><th>Spojení</th><th>Pozice</th>{<th>Zůstatek / equity</th>}{<th>Deník</th>}</tr></thead><tbody>{mt.map(a=><tr key={a.id}>
     <td className="ad-main"><b>{a.ownerName||a.ownerEmail}</b>{a.ownerName&&<small>{a.ownerEmail}</small>}</td>
     <td data-l="Účet"><span className="mt-tag">{a.platform.toUpperCase()}</span><span className={'mt-tag '+(a.mode==='real'?'real':'')}>{a.mode==='real'?'live':'demo'}</span><br/>{a.company}<small>{a.server} · {a.login}</small></td>
     <td data-l="EA">{a.eaVersion||'–'}{a.oldEa&&<span className="mt-tag warn">stará verze</span>}</td>
     <td data-l="Spojení"><span className={'mt-dot '+(a.online?'on':'')}/>{a.online?'online · ':''}{ago(a.lastSeen)}</td>
     <td data-l="Pozice">{a.positions} · {a.open} otevř.</td>
     {<td data-l="Zůstatek / equity">{a.balance==null?'–':fmtAmount(a.balance,a.currency)}{a.equity!=null&&<small>{fmtAmount(a.equity,a.currency)}</small>}</td>}
     {<td className="ad-acts"><a className="mt-btn" href={'/admin/journal/'+encodeURIComponent(a.memberId)}>Otevřít deník</a></td>}
    </tr>)}</tbody></table>}
   </section>}
   {ready&&<section className="mt-card" aria-label="Záznam nahlížení"><h2>Záznam nahlížení</h2>
    {!log.length?<p className="mt-empty">Zatím nic.</p>:<table className="mt-table ad-table"><thead><tr><th>Čas</th><th>Kdo</th><th>Akce</th><th>Koho</th><th>Detail</th></tr></thead><tbody>{log.slice(0,100).map((r,i)=><tr key={i}>
     <td data-l="Čas">{stamp(r.at)}</td><td data-l="Kdo">{r.actor}</td><td data-l="Akce">{ACTION[r.action]||r.action}</td><td data-l="Koho">{r.target}</td><td data-l="Detail">{r.detail||'–'}</td>
    </tr>)}</tbody></table>}
   </section>}
  </main>
 </div>;
}
