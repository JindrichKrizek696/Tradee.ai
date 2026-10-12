'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowUp,ArrowDown,GripVertical,Moon,Sun,RotateCcw,Plus,X} from 'lucide-react';
import {MAX_COLORS,isHex} from '@/lib/chart/drawings';
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
 const preview:Nav={order:nav.order,hidden:nav.hidden,merge:nav.merge},isDefault=JSON.stringify(nav)===JSON.stringify(defaultNav());
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
  <div className="nv-line"><span>Sloučit Deník a Journaling<small style={{display:'block',color:'var(--t-muted)',fontSize:13,fontWeight:400}}>V liště zůstane jen Deník, Journaling je v něm jako záložky Vyhodnocení, Backtest a Poznámky.</small></span><button type="button" role="switch" aria-checked={nav.merge} aria-label="Sloučit Deník a Journaling" className="nv-switch" onClick={()=>change({...nav,merge:!nav.merge})}><i aria-hidden="true"/></button></div>
  <ul className="nv-list" ref={list} onPointerMove={over} onPointerUp={end} onPointerCancel={end}>{nav.order.map((id,i)=>{const [label,Icon]=NAV_META[id],merged=nav.merge&&id==='journaling',off=nav.hidden.includes(id)||merged;
   return <li key={id} data-nav-id={id} className={'nv-row'+(off?' off':'')+(dragging===id?' drag':'')}>
    <span className="nv-grip" role="presentation" onPointerDown={e=>down(e,id)} title="Přetáhni"><GripVertical size={18}/></span>
    <Icon size={17}/><span className="nv-name">{label}</span>
    <button type="button" className="mt-icon" aria-label={`Posunout ${label} nahoru`} disabled={i===0} onClick={()=>shift(i,-1)}><ArrowUp size={14}/></button>
    <button type="button" className="mt-icon" aria-label={`Posunout ${label} dolů`} disabled={i===nav.order.length-1} onClick={()=>shift(i,1)}><ArrowDown size={14}/></button>
    <button type="button" role="switch" aria-checked={!off} aria-label={`Zobrazit ${label}`} title={id==='dashboard'?'Dashboard nelze schovat':merged?'Sloučeno s Deníkem':off?'Zobrazit':'Schovat'} disabled={id==='dashboard'||merged} className="nv-switch" onClick={()=>toggle(id)}><i aria-hidden="true"/></button>
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
// vlastní barvy kreseb v grafu trhu (drawing_prefs.colors); nabízí je panel stylu kresby
function DrawColors(){
 const [colors,setColors]=useState<string[]|null>(null),[pick,setPick]=useState('#7c3aed'),[st,setSt]=useState<'idle'|'saved'|'err'|'loaderr'>('idle');
 useEffect(()=>{let live=true;fetch('/api/chart/prefs',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{prefs?:{colors?:unknown}}>:Promise.reject()).then(j=>{if(live)setColors(Array.isArray(j.prefs?.colors)?j.prefs!.colors.filter(isHex).map(c=>c.toLowerCase()):[])}).catch(()=>{if(live)setSt('loaderr')});return()=>{live=false}},[]);
 useEffect(()=>{if(location.hash==='#barvy')document.getElementById('barvy')?.scrollIntoView({block:'start'})},[colors]);
 const save=(next:string[])=>{const prev=colors;setColors(next);setSt('idle');fetch('/api/chart/prefs',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefs:{colors:next}})}).then(r=>{if(!r.ok)throw Error();setSt('saved')}).catch(()=>{setColors(prev);setSt('err')})};
 const list=colors||[],c=pick.toLowerCase(),dup=list.includes(c),full=list.length>=MAX_COLORS;
 return <section className="mt-card" id="barvy">
  <div className="nv-title"><h2>Barvy kreseb</h2><span className={'nv-status'+(st==='err'||st==='loaderr'?' err':'')} role="status" aria-live="polite">{st==='saved'?'Uloženo':st==='err'?'Barvy se nepodařilo uložit.':st==='loaderr'?'Barvy se nepodařilo načíst.':''}</span></div>
  <p className="mt-lead">Vlastní barvy se v grafu trhu nabídnou vedle vestavěných (u kresby, textu i okraje). Nejvýš {MAX_COLORS}. Odebraná barva u už nakreslených kreseb zůstane.</p>
  {list.length>0?<ul className="dc-list" aria-label="Vlastní barvy">{list.map((x,i)=><li key={x} className="dc-item">
   <i className="dc-swatch" style={{background:x}} aria-hidden="true"/><code>{x.toUpperCase()}</code>
   <button type="button" className="mt-icon" aria-label={`Posunout ${x.toUpperCase()} dopředu`} disabled={i===0} onClick={()=>save(move(list,i,-1))}><ArrowUp size={14}/></button>
   <button type="button" className="mt-icon" aria-label={`Posunout ${x.toUpperCase()} dozadu`} disabled={i===list.length-1} onClick={()=>save(move(list,i,1))}><ArrowDown size={14}/></button>
   <button type="button" className="mt-icon" aria-label={`Odebrat barvu ${x.toUpperCase()}`} onClick={()=>save(list.filter(y=>y!==x))}><X size={14}/></button>
  </li>)}</ul>:colors&&<p className="dc-empty">Zatím žádné vlastní barvy.</p>}
  <div className="dc-add">
   <label className="dc-pick"><span>Nová barva</span><input type="color" value={pick} onChange={e=>setPick(e.target.value)} disabled={!colors}/><code aria-hidden="true">{pick.toUpperCase()}</code></label>
   <button type="button" className="mt-btn" disabled={!colors||dup||full||!isHex(c)} title={full?`Nejvýš ${MAX_COLORS} barev`:dup?'Tahle barva už v seznamu je':undefined} onClick={()=>save([...list,c])}><Plus size={15}/> Přidat barvu</button>
  </div>
 </section>;
}
export default function SettingsPage(){
 usePalette(); // barvy signálu podle nastavení uživatele hned po načtení
 return <div className="mt-page">
  <header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main">
   <h1>Nastavení</h1>
   <p className="mt-lead">Navigace, vzhled, upozornění, měna souhrnu a barvy kreseb na jednom místě. Změny se ukládají k tvému účtu.</p>
   <Navigation/><Look/><Alerts/><Summary/><DrawColors/>
  </main>
 </div>;
}
