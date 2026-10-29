'use client';
// Interní QA: stav funkcí (ověřeno výpočtem / ovládáním / jen v menu / návrh) z data/features.json – jen pro správce (/api/admin/features).
import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import {usePalette} from '@/app/palette';
import '../../mt.css';
import '../admin.css';
type Status='vypocet'|'ovladani'|'menu'|'navrh';
type Data={updated:string;statuses:Record<Status,string>;features:{id:string;area:string;name:string;status:Status;check:string}[]};
const LABEL:Record<Status,string>={vypocet:'ověřeno výpočtem',ovladani:'ověřeno ovládáním',menu:'jen v menu',navrh:'návrh'};
export default function FeaturesPage(){
 usePalette();
 const [d,setD]=useState<Data|null>(null),[err,setErr]=useState(''),[denied,setDenied]=useState(false),[f,setF]=useState<Status|'all'>('all');
 useEffect(()=>{fetch('/api/admin/features',{cache:'no-store'}).then(async r=>{if(r.status===403){setDenied(true);return}const j=await r.json() as Data&{error?:string};if(!r.ok)throw Error(j.error||'Nepodařilo se načíst.');setD(j)}).catch(e=>setErr((e as Error).message))},[]);
 const counts=useMemo(()=>{const c:Record<string,number>={};for(const x of d?.features||[])c[x.status]=(c[x.status]||0)+1;return c},[d]);
 const list=(d?.features||[]).filter(x=>f==='all'||x.status===f);
 return <div className="mt-page"><header className="mt-top"><a href="/admin" className="mt-back"><ArrowLeft size={16}/> Administrace</a></header>
  <main className="mt-main"><h1>Stav funkcí</h1>
   {denied?<section className="mt-card"><p className="mt-empty">Sem nemáš přístup.</p></section>:<>
   <p className="mt-lead">Interní přehled pro QA. Seznam se udržuje ručně v souboru <code>data/features.json</code>{d?` (aktualizováno ${new Date(d.updated+'T12:00:00Z').toLocaleDateString('cs-CZ')})`:''}.</p>
   {err&&<p className="mt-alert" role="alert">{err}</p>}
   {d&&<><div className="mt-chips" role="radiogroup" aria-label="Filtr stavu">{(['all','vypocet','ovladani','menu','navrh'] as const).map(k=><button key={k} type="button" role="radio" aria-checked={f===k} className={f===k?'active':''} onClick={()=>setF(k)}>{k==='all'?'Vše':LABEL[k]} <small>({k==='all'?d.features.length:counts[k]||0})</small></button>)}</div>
    <section className="mt-card"><table className="mt-table"><thead><tr><th>Oblast</th><th>Funkce</th><th>Stav</th><th>Test</th></tr></thead>
     <tbody>{list.map(x=><tr key={x.id}><td>{x.area}</td><td>{x.name}</td><td><span className={'mt-tag'+(x.status==='vypocet'||x.status==='ovladani'?' real':x.status==='navrh'?'':' warn')} title={d.statuses[x.status]}>{LABEL[x.status]}</span></td><td>{x.check?<code>{x.check}</code>:<small>–</small>}</td></tr>)}</tbody></table></section>
    <section className="mt-card"><h2>Co stavy znamenají</h2><ul className="mt-steps">{(Object.keys(LABEL) as Status[]).map(k=><li key={k}><b>{LABEL[k]}</b> – {d.statuses[k]}</li>)}</ul></section></>}
   </>}
  </main></div>;
}
