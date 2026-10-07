'use client';
import {useEffect,useState} from 'react';
import {ArrowLeft,Copy,Trash2,Pencil} from 'lucide-react';
import {CURRENCIES} from '@/lib/fx';
import './mt.css';
type Key={id:string;name:string;prefix:string;created:string;last_used:string|null};
type Account={id:string;platform:string;login:string;server:string;company:string;currency:string;mode:string;name:string;ea_version:string;last_seen:string|null;balance:number|null;equity:number|null;positions:number;open:number};
const EA_VERSION='1.0.0';
const utc=(s:string|null)=>s?new Date(s.replace(' ','T')+'Z').getTime():0;
function ago(s:string|null){if(!s)return 'nikdy';const m=Math.round((Date.now()-utc(s))/60000);if(m<1)return 'právě teď';if(m<60)return `před ${m} min`;const h=Math.round(m/60);if(h<48)return `před ${h} h`;return new Date(utc(s)).toLocaleDateString('cs-CZ')}
async function call(url:string,method:string,body?:unknown){const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const j=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw Error(j.error||'Akce se nepovedla.');return j}
export default function MtConnect(){
 const [keys,setKeys]=useState<Key[]>([]),[accounts,setAccounts]=useState<Account[]>([]),[currency,setCurrency]=useState('USD');
 const [fresh,setFresh]=useState<string|null>(null),[keyName,setKeyName]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(false),[copied,setCopied]=useState(false);
 async function load(){try{const [k,a,s]=await Promise.all(['/api/mt/keys','/api/mt/accounts','/api/settings'].map(u=>fetch(u,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json()}))) as unknown[];setKeys((k as {keys:Key[]}).keys);setAccounts((a as {accounts:Account[]}).accounts);setCurrency((s as {currency?:string}).currency||'USD');setReady(true);setError('')}catch{setError('Data se nepodařilo načíst. Obnov stránku.')}}
 useEffect(()=>{load()},[]);
 const run=(fn:()=>Promise<unknown>)=>fn().then(()=>{setError('');return load()}).catch((e:Error)=>setError(e.message));
 async function createKey(){try{const j=await call('/api/mt/keys','POST',{name:keyName}) as {key:string};setFresh(j.key);setKeyName('');setCopied(false);await load()}catch(e){setError((e as Error).message)}}
 return <div className="mt-page">
  <header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main">
   <h1>Propojení s MetaTraderem</h1>
   <p className="mt-lead">Tradee automaticky zapíše každý obchod z MetaTraderu 5 nebo 4 – vstupy, výstupy, posuny SL a TP, výsledky i průběh pozice. Stačí jednou nastavit.</p>
   {error&&<p className="mt-alert" role="alert">{error}</p>}
   <section className="mt-card">
    <h2>Jak propojit</h2>
    <ol className="mt-steps">
     <li><b>Vytvoř si klíč</b> níže a zkopíruj ho.</li>
     <li><b>Stáhni EA</b>: <a href="/downloads/TradeeSync.ex5">TradeeSync.ex5</a> (MT5) nebo <a href="/downloads/TradeeSync.ex4">TradeeSync.ex4</a> (MT4) a v MetaTraderu otevři Soubor → Otevřít složku dat → <code>MQL5/Experts</code> (MT4: <code>MQL4/Experts</code>) a soubor tam vlož. Zdrojový kód: <a href="/downloads/TradeeSync.mq5">.mq5</a> · <a href="/downloads/TradeeSync.mq4">.mq4</a>.</li>
     <li><b>Povol připojení</b>: Nástroje → Možnosti → Experti → zaškrtni „Povolit WebRequest pro uvedené URL" a přidej <code>https://tradee.eu</code>. Zapni i „Algo trading" (MT4: „Automatické obchodování").</li>
     <li><b>Spusť EA</b>: přetáhni TradeeSync na libovolný graf, do pole <code>TradeeKey</code> vlož klíč a potvrď. Do minuty se účet objeví níže. Graf nech otevřený – EA běží, dokud běží MetaTrader.</li>
    </ol>
   </section>
   <section className="mt-card">
    <h2>Klíče</h2>
    {fresh&&<div className="mt-fresh"><p><b>Nový klíč – zobrazí se jen teď.</b> Ulož si ho, po obnovení stránky už ho neuvidíš.</p><div className="mt-keybox"><code>{fresh}</code><button type="button" className="mt-btn" onClick={()=>{navigator.clipboard.writeText(fresh).then(()=>setCopied(true))}}><Copy size={14}/> {copied?'Zkopírováno':'Kopírovat'}</button></div></div>}
    <div className="mt-row"><input placeholder="Název (např. Notebook, VPS)" maxLength={60} value={keyName} onChange={e=>setKeyName(e.target.value)}/><button type="button" className="mt-btn dark" onClick={createKey}>Vytvořit klíč</button></div>
    {ready&&!keys.length&&<p className="mt-empty">Zatím nemáš žádný klíč.</p>}
    {keys.length>0&&<table className="mt-table"><thead><tr><th>Název</th><th>Klíč</th><th>Naposledy použit</th><th/></tr></thead><tbody>{keys.map(k=><tr key={k.id}><td>{k.name}</td><td><code>{k.prefix}…</code></td><td>{ago(k.last_used)}</td><td><button type="button" className="mt-icon" aria-label="Zrušit klíč" onClick={()=>{if(window.confirm('Zrušit klíč? EA, které ho používá, přestane posílat data.'))run(()=>call('/api/mt/keys','DELETE',{id:k.id}))}}><Trash2 size={14}/></button></td></tr>)}</tbody></table>}
   </section>
   <section className="mt-card">
    <h2>Připojené účty</h2>
    {ready&&!accounts.length&&<p className="mt-empty">Žádný účet zatím neposlal data. Po spuštění EA se tu objeví do minuty.</p>}
    {accounts.length>0&&<table className="mt-table"><thead><tr><th>Účet</th><th>Broker / server</th><th>Měna</th><th>Pozice</th><th>Spojení</th><th/></tr></thead><tbody>{accounts.map(a=>{const live=Date.now()-utc(a.last_seen)<5*60000;return <tr key={a.id}>
     <td><b>{a.name||a.login}</b> <span className="mt-tag">{a.platform.toUpperCase()}</span> <span className={'mt-tag '+(a.mode==='real'?'real':'')}>{a.mode==='real'?'live':a.mode}</span>{a.ea_version&&a.ea_version!==EA_VERSION&&<span className="mt-tag warn" title="Stáhni novou verzi EA">EA {a.ea_version}</span>}</td>
     <td>{a.company}<br/><small>{a.server} · {a.login}</small></td>
     <td>{a.currency}</td>
     <td>{a.positions}{a.open>0&&<small> · {a.open} otevř.</small>}</td>
     <td><span className={'mt-dot '+(live?'on':'')}/>{ago(a.last_seen)}</td>
     <td className="mt-actions"><button type="button" className="mt-icon" aria-label="Přejmenovat" onClick={()=>{const n=window.prompt('Název účtu v Tradee',a.name);if(n!==null)run(()=>call('/api/mt/accounts','PATCH',{id:a.id,name:n}))}}><Pencil size={14}/></button><button type="button" className="mt-icon" aria-label="Odpojit a smazat data" onClick={()=>{if(window.confirm('Odpojit účet a smazat všechna jeho data v Tradee? Nejde vrátit.'))run(()=>call('/api/mt/accounts','DELETE',{id:a.id}))}}><Trash2 size={14}/></button></td>
    </tr>})}</tbody></table>}
   </section>
   <section className="mt-card">
    <h2>Měna souhrnu</h2>
    <p className="mt-lead">Kalendář obchodů a P&L sčítají všechny účty v této měně (přepočet denním kurzem ECB). Ručně zapsané obchody se nepřepočítávají.</p>
    <select value={currency} onChange={e=>{const c=e.target.value;setCurrency(c);run(()=>call('/api/settings','POST',{currency:c}))}}>{CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}</select>
   </section>
  </main>
 </div>;
}
