'use client';
// Upozornění: push na tomto zařízení (zapnout / vypnout / test), seznam zařízení, adresa pro e-maily a volba
// Push / E-mail / V aplikaci pro každou kategorii (tabulka notify_prefs přes /api/notify/prefs). Plná verze v Nastavení, kompaktní karta na /alerty.
import {useCallback,useEffect,useState} from 'react';
import {BellRing,Laptop,Send,Trash2} from 'lucide-react';
import {registerSW} from './pwa/register';
import {IosPushNote} from './pwa/pwa-ui';
import {isIos,isStandalone} from './pwa/install';
import {alertsChanged} from './alerts/alert-api';
import {CATEGORY_META,CHANNELS,type Category,type ChannelKey,type Channels} from '@/lib/notify/prefs';
import './notify-prefs.css';
export type PrefsData={prefs:Partial<Record<Category,Channels>>;categories:Category[];email:string;owner:boolean;vapidPublic:string|null};
const key=(s:string)=>{const p='='.repeat((4-s.length%4)%4),r=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(r,c=>c.charCodeAt(0))};
const json={'Content-Type':'application/json'};
const ios=()=>isIos(navigator.userAgent,navigator.platform,navigator.maxTouchPoints||0);
const supported=()=>'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
export const PREFS_EVT='tradee-notify-prefs';
const PUSH_EVT='tradee-push-devices';
const COL:Record<ChannelKey,string>={push:'Push',mail:'E-mail',inapp:'V aplikaci'};
const errText=async(r:Response,fb:string)=>{try{const j=await r.json() as {error?:string};return j.error||fb}catch{return fb}};

/** Volba kanálů po kategoriích; po uložení dá vědět ostatním částem stránky (okénko alertů, formulář alertu). */
export function useNotifyPrefs(){
 const [data,setData]=useState<PrefsData|null>(null),[status,setStatus]=useState<''|'saving'|'saved'|'err'|'loaderr'>('');
 const load=useCallback(async()=>{try{const r=await fetch('/api/notify/prefs',{cache:'no-store'});if(!r.ok)throw Error();setData(await r.json() as PrefsData)}catch{setStatus('loaderr')}},[]);
 useEffect(()=>{load();const f=()=>{load()};window.addEventListener(PREFS_EVT,f);return()=>window.removeEventListener(PREFS_EVT,f)},[load]);
 const save=async(cat:Category,ch:ChannelKey,val:boolean)=>{
  if(!data)return;const prev=data;
  setData({...data,prefs:{...data.prefs,[cat]:{...(data.prefs[cat] as Channels),[ch]:val}}});setStatus('saving');
  try{const r=await fetch('/api/notify/prefs',{method:'PUT',headers:json,body:JSON.stringify({prefs:{[cat]:{[ch]:val}}})});if(!r.ok)throw Error();
   const j=await r.json() as {prefs:PrefsData['prefs']};setData(d=>d?{...d,prefs:j.prefs}:d);setStatus('saved');try{window.dispatchEvent(new Event(PREFS_EVT))}catch{}}
  catch{setData(prev);setStatus('err')}
 };
 return {data,status,save};
}
/** Odběr push na tomto zařízení. */
function usePushDevice(vapidPublic:string|null){
 const [here,setHere]=useState<string|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
 useEffect(()=>{let live=true;(async()=>{try{if(supported()){const reg=await navigator.serviceWorker.getRegistration('/sw.js'),sub=await reg?.pushManager.getSubscription();if(live)setHere(sub&&Notification.permission==='granted'?sub.endpoint:null)}}catch{}if(live)setReady(true)})();return()=>{live=false}},[]);
 const changed=()=>{try{window.dispatchEvent(new Event(PUSH_EVT))}catch{}alertsChanged()};
 const enable=async()=>{if(busy||!vapidPublic)return;setBusy(true);setMsg('');
  try{
   if(ios()&&!isStandalone()){setMsg('Na iPhonu nejdřív přidej Tradee na plochu (Sdílet → Přidat na plochu) a push zapni v nainstalované aplikaci (iOS 16.4+).');return}
   if(!supported()){setMsg('Tento prohlížeč push nepodporuje.');return}
   const perm=await Notification.requestPermission();
   if(perm!=='granted'){setMsg('Prohlížeč upozornění blokuje – povol je v nastavení prohlížeče.');return}
   const reg=await registerSW();if(!reg)throw Error('sw');await navigator.serviceWorker.ready;
   const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key(vapidPublic)}),j=sub.toJSON();
   const r=await fetch('/api/push',{method:'POST',headers:json,body:JSON.stringify({endpoint:j.endpoint,keys:j.keys})});
   if(!r.ok){await sub.unsubscribe().catch(()=>{});throw Error()}
   setHere(sub.endpoint);changed();
  }catch(e){const brave=!!(navigator as Navigator&{brave?:unknown}).brave,push=e instanceof DOMException&&(e.name==='AbortError'||e.name==='NotAllowedError'||/push service/i.test(e.message));
   setMsg(brave&&push?'Brave má push vypnutý: v brave://settings/privacy zapni „Use Google services for push messaging“, restartuj prohlížeč a zkus to znovu.':push?'Prohlížeč odmítl push službu ('+(e as DOMException).name+'). Zkus Chrome, Edge nebo Firefox.':'Push se nepodařilo nastavit. Zkus to znovu.')}
  finally{setBusy(false)}};
 const disable=async()=>{if(busy)return;setBusy(true);setMsg('');
  try{const reg=await navigator.serviceWorker.getRegistration('/sw.js'),sub=await reg?.pushManager.getSubscription();
   if(sub){const endpoint=sub.endpoint;await sub.unsubscribe();await fetch('/api/push',{method:'DELETE',headers:json,body:JSON.stringify({endpoint})})}}catch{}
  setHere(null);changed();setBusy(false)};
 return {here,ready,busy,msg,enable,disable,forget:()=>setHere(null)};
}
/** Testovací push: žádost do fronty (nejvýš 1/min), odešle ji cron do minuty; stav se dočte z GET. */
function TestPush({disabled,small}:{disabled?:boolean;small?:boolean}){
 const [st,setSt]=useState<{t:'idle'|'wait'|'ok'|'err';m:string}>({t:'idle',m:''});
 useEffect(()=>{if(st.t!=='wait')return;let n=0;const t=setInterval(async()=>{n++;
  try{const r=await fetch('/api/notify/test',{cache:'no-store'}),j=await r.json() as {test:{done:number|null;sent:number|null}|null};
   if(j.test?.done&&j.test.sent!==null){clearInterval(t);setSt(j.test.sent>0?{t:'ok',m:`Odesláno na ${j.test.sent} zařízení. Nedorazilo? Zkontroluj, že prohlížeč nemá upozornění ztlumená.`}:{t:'err',m:'Push se nepodařilo doručit na žádné zařízení. Zkus push na tomto zařízení vypnout a znovu zapnout.'})}}catch{}
  if(n>=15){clearInterval(t);setSt({t:'err',m:'Test zatím neodešel – zkus to za chvíli znovu.'})}},8000);return()=>clearInterval(t)},[st.t]);
 const send=async()=>{setSt({t:'wait',m:'Odesílám… push dorazí do minuty.'});
  try{const r=await fetch('/api/notify/test',{method:'POST',headers:json,body:'{}'});if(!r.ok)throw Error(await errText(r,'Test se nepodařilo odeslat.'))}
  catch(e){setSt({t:'err',m:(e as Error).message})}};
 return <span className="np-test"><button type="button" className={'np-btn'+(small?' sm':'')} disabled={disabled||st.t==='wait'} onClick={send}><Send size={14} aria-hidden/>{small?'Poslat test':'Poslat testovací upozornění'}</button>{st.m&&<small className={st.t==='err'?'np-err':''} role="status">{st.m}</small>}</span>;
}
type Device={id:string;endpoint:string;label:string;created:number|null;lastOk:number|null};
const day=(ms:number|null)=>ms?new Date(ms).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',year:'numeric'}):'–';
function Devices({here,onLostHere}:{here:string|null;onLostHere:()=>void}){
 const [list,setList]=useState<Device[]|null>(null),[err,setErr]=useState('');
 const load=useCallback(async()=>{try{const r=await fetch('/api/push',{cache:'no-store'});if(!r.ok)throw Error();setList((await r.json() as {devices:Device[]}).devices)}catch{setErr('Seznam zařízení se nepodařilo načíst.')}},[]);
 useEffect(()=>{load();const f=()=>{load()};window.addEventListener(PUSH_EVT,f);return()=>window.removeEventListener(PUSH_EVT,f)},[load,here]);
 const drop=async(d:Device)=>{if(!confirm(`Odebrat zařízení „${d.label}“? Push na něj přestane chodit.`))return;setErr('');
  try{const r=await fetch('/api/push',{method:'DELETE',headers:json,body:JSON.stringify({id:d.id})});if(!r.ok)throw Error();
   if(d.endpoint===here){try{const reg=await navigator.serviceWorker.getRegistration('/sw.js'),sub=await reg?.pushManager.getSubscription();await sub?.unsubscribe()}catch{}onLostHere()}
   load();alertsChanged()}catch{setErr('Zařízení se nepodařilo odebrat.')}};
 if(!list)return err?<p className="np-err">{err}</p>:null;
 return <div className="np-devices"><h3>Zařízení s push ({list.length})</h3>
  {list.length===0?<p className="np-muted">Zatím žádné. Push se zapíná na každém zařízení zvlášť.</p>:
  <ul>{list.map(d=><li key={d.id}><Laptop size={15} aria-hidden/><span><b>{d.label}</b>{d.endpoint===here&&<em className="np-here">toto zařízení</em>}<small>přidáno {day(d.created)}{d.lastOk?` · naposledy doručeno ${day(d.lastOk)}`:''}</small></span>
   <button type="button" className="np-icon" aria-label={`Odebrat ${d.label}`} title="Odebrat zařízení" onClick={()=>drop(d)}><Trash2 size={14}/></button></li>)}</ul>}
  {err&&<p className="np-err">{err}</p>}
 </div>;
}
function Switch({label,on,disabled,onClick}:{label:string;on:boolean;disabled?:boolean;onClick:()=>void}){
 return <button type="button" role="switch" aria-checked={on} aria-label={label} className="np-switch" disabled={disabled} onClick={onClick}><i aria-hidden="true"/></button>;
}
/** Tabulka kategorie × kanál (Push / E-mail / V aplikaci). */
export function PrefsMatrix({data,save,only}:{data:PrefsData;save:(c:Category,k:ChannelKey,v:boolean)=>void;only?:Category}){
 const cats=only?data.categories.filter(c=>c===only):data.categories;
 return <table className={'np-matrix'+(only?' one':'')}>
  {!only&&<thead><tr><th scope="col"><span className="np-sr">Kategorie</span></th>{CHANNELS.map(c=><th key={c} scope="col">{COL[c]}</th>)}</tr></thead>}
  <tbody>{cats.map(cat=>{const m=CATEGORY_META[cat],p=data.prefs[cat];if(!p)return null;
   return <tr key={cat}>{!only&&<th scope="row"><b>{m.label}</b>{m.ownerOnly&&<em className="np-owner">jen vlastník</em>}<small>{m.hint}</small></th>}
    {CHANNELS.map(c=>{const na=c==='inapp'&&!m.inapp;return <td key={c} data-label={COL[c]}>{na?<span className="np-na" title="Tahle kategorie v aplikaci nic neukazuje">–</span>:
     <label className="np-cell"><Switch label={`${m.label}: ${COL[c]}`} on={p[c]} onClick={()=>save(cat,c,!p[c])}/>{only&&<span>{COL[c]}</span>}</label>}</td>})}
   </tr>})}</tbody>
 </table>;
}
const statusText=(s:string)=>s==='saving'?'Ukládám…':s==='saved'?'Uloženo':s==='err'?'Uložení se nepovedlo.':s==='loaderr'?'Nastavení se nepodařilo načíst.':'';
function DeviceBlock({vapidPublic,compact}:{vapidPublic:string|null;compact?:boolean}){
 const dev=usePushDevice(vapidPublic);
 if(!vapidPublic)return <p className="np-muted">Push teď na serveru není nastavený – upozornění chodí e-mailem a v aplikaci.</p>;
 const on=!!dev.here;
 return <div className={'np-device'+(compact?' compact':'')}>
  <div className="np-device-line"><BellRing size={17} aria-hidden/><span><b>Push na tomto zařízení</b><small>{!dev.ready?'Zjišťuji…':on?'Zapnuto – upozornění dorazí, i když Tradee nemáš otevřené.':'Vypnuto'}</small></span>
   <span className="np-device-actions">{on?<><TestPush small={compact}/><button type="button" className="np-btn sm ghost" disabled={dev.busy} onClick={dev.disable}>Vypnout</button></>
    :<button type="button" className="np-btn primary" disabled={dev.busy||!dev.ready} onClick={dev.enable}>{dev.busy?'Zapínám…':'Zapnout push'}</button>}</span></div>
  <IosPushNote/>
  {dev.msg&&<p className="np-err" role="alert">{dev.msg}</p>}
  {!compact&&<Devices here={dev.here} onLostHere={dev.forget}/>}
 </div>;
}
/** Celá sekce v Nastavení. */
export function NotifySettings(){
 const {data,status,save}=useNotifyPrefs();
 if(!data)return status==='loaderr'?<p className="np-err">{statusText(status)}</p>:<p className="np-muted">Načítám…</p>;
 return <div className="np">
  <span className={'np-status'+(status==='err'||status==='loaderr'?' err':'')} role="status" aria-live="polite">{statusText(status)}</span>
  <DeviceBlock vapidPublic={data.vapidPublic}/>
  <p className="np-mail">E-maily chodí na <b>{data.email}</b><small>Adresa je z tvého účtu Google, se kterým se přihlašuješ – jinou zatím nastavit nejde.</small></p>
  <PrefsMatrix data={data} save={save}/>
  <p className="np-muted">„V aplikaci“ = okénko, když máš Tradee zrovna otevřené. Spuštěné alerty najdeš vždy i ve schránce u zvonku. Push chodí jen na zařízení, kde je zapnutý.</p>
 </div>;
}
/** Kompaktní karta na /alerty: kanály cenových alertů + push na tomto zařízení. */
export function AlertNotifyCard(){
 const {data,status,save}=useNotifyPrefs();
 if(!data)return null;
 return <section className="mt-card np-card" aria-labelledby="np-alerts-h">
  <div className="np-head"><h2 id="np-alerts-h">Kam posílat alerty</h2><span className={'np-status'+(status==='err'?' err':'')} role="status" aria-live="polite">{statusText(status)}</span><a className="np-link" href="/nastaveni#upozorneni">Všechna upozornění →</a></div>
  <PrefsMatrix data={data} save={save} only="alerts"/>
  <DeviceBlock vapidPublic={data.vapidPublic} compact/>
 </section>;
}
// Při odhlášení odebere odběr push z tohoto prohlížeče (best-effort), aby další uživatel na sdíleném zařízení nedostával cizí upozornění.
export async function dropPush(){try{if(!('serviceWorker' in navigator))return;const reg=await navigator.serviceWorker.getRegistration('/sw.js'),sub=await reg?.pushManager.getSubscription();if(!sub)return;const endpoint=sub.endpoint;await Promise.race([fetch('/api/push',{method:'DELETE',headers:json,body:JSON.stringify({endpoint})}).catch(()=>{}),new Promise(r=>setTimeout(r,3000))]);await sub.unsubscribe().catch(()=>{})}catch{}}
