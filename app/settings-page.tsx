'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowUp,ArrowDown,GripVertical,Moon,Sun,RotateCcw} from 'lucide-react';
import {CURRENCIES} from '@/lib/fx';
import {VIEWS,defaultNav,type Nav,type View} from '@/lib/nav';
import {PalettePicker,usePalette} from './palette';
import {NotifySettings} from './notify-settings';
import {useTheme} from './theme';
import {NavBar,NAV_META} from './nav-bar';
import {useNav} from './nav-prefs';
import './mt.css';
import './nastaveni.css';
const move=<T,>(a:T[],i:number,d:number)=>{const j=i+d;if(j<0||j>=a.length)return a;const b=[...a];[b[i],b[j]]=[b[j],b[i]];return b};
function Navigation(){
 const {nav,change,status}=useNav(),drag=useRef<View|null>(null),[dragging,setDragging]=useState<View|null>(null),list=useRef<HTMLUListElement>(null);
 const preview:Nav={order:nav.order,hidden:nav.hidden},isDefault=JSON.stringify(nav)===JSON.stringify(defaultNav());
 const shift=(i:number,d:number)=>change({...nav,order:move(nav.order,i,d)});
 const toggle=(id:View)=>{if(id==='dashboard')return;change({...nav,hidden:nav.hidden.includes(id)?nav.hidden.filter(x=>x!==id):[...nav.hidden,id]})};
 // Tažení přes pointer events (myš i dotyk): ukazatel drží celý seznam, pod prstem se hledá řádek a přetahovaná položka se na jeho místo hned přesune.
 const down=(e:React.PointerEvent,id:View)=>{if(e.button!==0)return;e.preventDefault();list.current?.setPointerCapture(e.pointerId);drag.current=id;setDragging(id)};
 const over=(e:React.PointerEvent)=>{const id=drag.current;if(!id)return;const row=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-nav-id]'),to=row?.dataset.navId as View|undefined;if(!to||to===id)return;const from=nav.order.indexOf(id),at=nav.order.indexOf(to);if(from<0||at<0)return;const o=[...nav.order];o.splice(from,1);o.splice(at,0,id);change({...nav,order:o})};
 const end=(e:React.PointerEvent)=>{if(!drag.current)return;drag.current=null;setDragging(null);try{list.current?.releasePointerCapture(e.pointerId)}catch{}};
 return <section className="mt-card">
  <div className="nv-title"><h2>Navigace</h2><span className={'nv-status'+(status==='err'?' err':'')} role="status" aria-live="polite">{status==='saving'?'Ukládám…':status==='saved'?'Uloženo':status==='err'?'Uložení se nepovedlo. Změna platí jen v tomto prohlížeči.':''}</span></div>
  <p className="mt-lead">Přetažením změníš pořadí položek v horní liště, přepínačem je schováš. Dashboard zůstává vždy.</p>
  <div className="nv-stage"><NavBar nav={preview} view="dashboard" preview/></div>
  <ul className="nv-list" ref={list} onPointerMove={over} onPointerUp={end} onPointerCancel={end}>{nav.order.map((id,i)=>{const [label,Icon]=NAV_META[id],off=nav.hidden.includes(id);
   return <li key={id} data-nav-id={id} className={'nv-row'+(off?' off':'')+(dragging===id?' drag':'')}>
    <span className="nv-grip" role="presentation" onPointerDown={e=>down(e,id)} title="Přetáhni"><GripVertical size={18}/></span>
    <Icon size={17}/><span className="nv-name">{label}</span>
    <button type="button" className="mt-icon" aria-label={`Posunout ${label} nahoru`} disabled={i===0} onClick={()=>shift(i,-1)}><ArrowUp size={14}/></button>
    <button type="button" className="mt-icon" aria-label={`Posunout ${label} dolů`} disabled={i===nav.order.length-1} onClick={()=>shift(i,1)}><ArrowDown size={14}/></button>
    <button type="button" role="switch" aria-checked={!off} aria-label={`Zobrazit ${label}`} title={id==='dashboard'?'Dashboard nelze schovat':off?'Zobrazit':'Schovat'} disabled={id==='dashboard'} className="nv-switch" onClick={()=>toggle(id)}><i aria-hidden="true"/></button>
   </li>})}</ul>
  <div className="nv-foot"><button type="button" className="mt-btn" disabled={isDefault} onClick={()=>change(defaultNav())}><RotateCcw size={15}/> Obnovit výchozí</button></div>
 </section>;
}
function Look(){
 const {theme,toggle}=useTheme(),{palette,choose,error}=usePalette();
 const pick=(t:'light'|'dark')=>{if(theme!==t)toggle()};
 return <section className="mt-card">
  <h2>Vzhled</h2>
  <div className="nv-line"><span>Motiv</span><div className="mt-chips" role="radiogroup" aria-label="Motiv"><button type="button" role="radio" aria-checked={theme==='light'} className={theme==='light'?'active':''} onClick={()=>pick('light')}><Sun size={14}/> Světlý</button><button type="button" role="radio" aria-checked={theme==='dark'} className={theme==='dark'?'active':''} onClick={()=>pick('dark')}><Moon size={14}/> Tmavý</button></div></div>
  <div className="nv-embed"><PalettePicker value={palette.id} onChoose={choose} error={error}/></div>
 </section>;
}
function Alerts(){
 return <section className="mt-card"><h2>Upozornění</h2><div className="p-picker nv-embed"><NotifySettings/></div></section>;
}
function Summary(){
 const [cur,setCur]=useState(''),[st,setSt]=useState<'idle'|'saved'|'err'>('idle');
 useEffect(()=>{let live=true;fetch('/api/settings',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{currency?:string}>:null).then(j=>{if(live)setCur(j?.currency||'USD')}).catch(()=>{if(live)setSt('err')});return()=>{live=false}},[]);
 const choose=(c:string)=>{const prev=cur;setCur(c);setSt('idle');fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currency:c})}).then(r=>{if(!r.ok)throw Error();setSt('saved')}).catch(()=>{setCur(prev);setSt('err')})};
 return <section className="mt-card">
  <div className="nv-title"><h2>Měna souhrnu</h2><span className={'nv-status'+(st==='err'?' err':'')} role="status" aria-live="polite">{st==='saved'?'Uloženo':st==='err'?'Měnu se nepodařilo uložit.':''}</span></div>
  <p className="mt-lead">Kalendář obchodů a P&L sčítají všechny účty v této měně (přepočet denním kurzem ECB). Ručně zapsané obchody se nepřepočítávají.</p>
  <select aria-label="Měna souhrnu" value={cur} disabled={!cur} onChange={e=>choose(e.target.value)}>{!cur&&<option value="">…</option>}{CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}</select>
 </section>;
}
export default function SettingsPage(){
 usePalette(); // barvy signálu podle nastavení uživatele hned po načtení
 return <div className="mt-page">
  <header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main">
   <h1>Nastavení</h1>
   <p className="mt-lead">Navigace, vzhled, upozornění a měna souhrnu na jednom místě. Změny se ukládají k tvému účtu.</p>
   <Navigation/><Look/><Alerts/><Summary/>
  </main>
 </div>;
}
