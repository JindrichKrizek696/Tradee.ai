'use client';
import {useRef,useState} from 'react';
import {Upload,X} from 'lucide-react';
import {fmtMoney,fmtAmount} from '@/lib/trades';
import {fmtDate,plural} from '@/lib/journal/format';
import type {T212Preview} from '@/lib/import/t212-store';
type Market={id:string;name:string};
const MAX=5*1024*1024;
const day=(ms:number)=>fmtDate(new Date(ms).toLocaleDateString('sv-SE',{timeZone:'Europe/Prague'}));
const TRADES=['obchod','obchody','obchodů'] as const;
async function send(url:string,init:RequestInit):Promise<any>{
 const r=await fetch(url,init),j=await r.json().catch(()=>({})) as any;
 if(!r.ok)throw Error(j.error||'Akce se nepovedla. Zkus to znovu.');return j;
}
/** Deník: import historie CFD účtu z Trading 212 (CSV) – výběr souboru → náhled → uložení. */
export function T212Import({onDone,compact=false}:{onDone:()=>void;compact?:boolean}){
 const input=useRef<HTMLInputElement>(null);
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<T212Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(''),[markets,setMarkets]=useState<Market[]>([]);
 const body=(f:File)=>{const fd=new FormData();fd.append('file',f);return fd};
 async function check(f:File){
  setError('');setDone('');setPreview(null);setFile(f);
  if(f.size>MAX){setError('Soubor může mít nejvýš 5 MB.');return}
  setBusy(true);
  try{const j=await send('/api/import/t212?dry=1',{method:'POST',body:body(f)});setPreview(j.preview);
   if(j.preview.unmapped.length&&!markets.length)fetch('/api/checklists',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{markets?:Market[]}>:null).then(x=>{if(x?.markets)setMarkets(x.markets)}).catch(()=>{});
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function assign(symbol:string,instrument:string){
  if(!file)return;setBusy(true);
  try{await send('/api/checklists/symbols',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol,instrument:instrument==='-'?'':instrument})});const j=await send('/api/import/t212?dry=1',{method:'POST',body:body(file)});setPreview(j.preview)}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function run(){
  if(!file)return;setBusy(true);setError('');
  try{const j=await send('/api/import/t212',{method:'POST',body:body(file)});
   setDone(`Importováno ${j.imported} ${plural(j.imported,TRADES)}`+(j.duplicates?`, ${j.duplicates} už v deníku ${j.duplicates===1?'byl':'byly'}.`:'.'));setPreview(null);setFile(null);onDone();
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const reset=()=>{setPreview(null);setFile(null);setError('')};
 const picker=<input ref={input} type="file" accept=".csv,text/csv" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)check(f)}}/>;
 const cur=preview?.currencies[0]||'USD';
 return <div className={'j-import'+(compact?' compact':'')}>
  {picker}
  {!preview&&<div className="j-import-bar"><button type="button" className="j-btn" disabled={busy} onClick={()=>input.current?.click()}><Upload size={14}/> {busy?'Načítám soubor…':'Import z Trading 212'}</button>{done&&<span role="status" className="j-import-ok">{done}</span>}</div>}
  {error&&<p role="alert" className="s-notice">{error}</p>}
  {preview&&<section className="j-card j-import-card" aria-label="Náhled importu z Trading 212">
   <div className="j-import-head"><h2>Import z Trading 212</h2><button type="button" className="j-icon-btn" aria-label="Zrušit import" onClick={reset}><X size={16}/></button></div>
   <p className="j-muted">{file?.name}</p>
   <dl className="j-dl">
    <div><dt>Období</dt><dd>{preview.period?`${day(preview.period.from)} – ${day(preview.period.to)}`:'–'}</dd></div>
    <div><dt>Nové obchody</dt><dd><b>{preview.newTrades}</b></dd></div>
    <div><dt>Už v deníku (přeskočí se)</dt><dd>{preview.duplicates}</dd></div>
    <div><dt>Se stop lossem</dt><dd>{preview.withSl} z {preview.totals.count}</dd></div>
    <div><dt>Výsledek celkem</dt><dd className={preview.totals.total>0?'pos':preview.totals.total<0?'neg':''}>{fmtMoney(preview.totals.total,cur)}</dd></div>
    <div><dt>Z toho swap / FX poplatky</dt><dd>{fmtMoney(preview.totals.overnight+preview.totals.dividend,cur)} / {fmtMoney(preview.totals.fxFee,cur)}</dd></div>
    {(preview.cash.deposits>0||preview.cash.withdrawals>0||preview.cash.transfersIn>0||preview.cash.transfersOut>0)&&<div><dt>Vklady / výběry a převody</dt><dd>{fmtAmount(preview.cash.deposits+preview.cash.transfersIn,cur)} / {fmtAmount(preview.cash.withdrawals+preview.cash.transfersOut,cur)}</dd></div>}
   </dl>
   {preview.currencies.length>1&&<p className="j-muted">Soubor obsahuje víc měn účtu ({preview.currencies.join(', ')}) – každá se uloží jako samostatný účet.</p>}
   {preview.incomplete>0&&<p className="j-muted">{preview.incomplete} {plural(preview.incomplete,TRADES)} začal{preview.incomplete===1?'':'y'} před obdobím exportu – bez stop lossu a důvodu výstupu, pravidla disciplíny se u nich nevyhodnotí.</p>}
   {preview.openPositions>0&&<p className="j-muted">Otevřené pozice ({preview.openPositions}) se neimportují – přidají se dalším importem po uzavření.</p>}
   {preview.unmapped.length>0&&<div className="j-import-map">
    <p>Tyhle symboly Tradee nezná. Obchody se naimportují i tak, jen bez napojení na trh. Můžeš je přiřadit:</p>
    {preview.unmapped.map(s=><div className="ck-sym" key={s}><code>{s}</code><select aria-label={`Trh pro ${s}`} value="" disabled={busy} onChange={e=>e.target.value&&assign(s,e.target.value)}><option value="">— vyber trh —</option><option value="-">— nesledovat —</option>{markets.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>)}
   </div>}
   <div className="j-import-actions">
    <button type="button" className="j-btn dark" disabled={busy||!preview.newTrades} onClick={run}>{busy?'Importuji…':preview.newTrades?`Importovat ${preview.newTrades} ${plural(preview.newTrades,TRADES)}`:'Nic nového k importu'}</button>
    <button type="button" className="j-btn" disabled={busy} onClick={reset}>Zrušit</button>
   </div>
  </section>}
  {!preview&&!compact&&<small className="j-muted j-import-help">CSV z Trading 212: CFD účet → Historie → Exportovat. Opakovaný import stejného období nic nezdvojí.</small>}
 </div>;
}
