'use client';
// Nastavení grafu trhu (ozubené kolečko v liště): svíčky (podle Barev signálu, jedna z předvoleb, nebo vlastní tělo / obrys / knot), barva čáry, pozadí, mřížka, nitkový kříž a cenová osa.
// Ukládá se k účtu (/api/chart/prefs, klíč appearance) a do localStorage, aby se graf hned vykreslil ve správných barvách. Model a validace v lib/chart/appearance.
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {Check,Pipette,RotateCcw,X} from 'lucide-react';
import {palettes} from '@/lib/palettes';
import {APPEARANCE_DEFAULT,CANDLE_PARTS,canvasLine,isColor,readAppearance,resolveCandles,sameAppearance,setPartColor,sourcePair,splitColor,toHex,withOpacity,type Appearance,type CandleCtx,type CandlePart,type Crosshair,type GridLines,type GridStyle} from '@/lib/chart/appearance';
import type {ChartType} from '@/lib/chart/chart-types';

const KEY='tradee.chart.look';
const useIso=typeof window==='undefined'?useEffect:useLayoutEffect;
export type SaveState='loading'|'ok'|'saving'|'saved'|'error'|'local';
const store=(a:Appearance)=>{try{localStorage.setItem(KEY,JSON.stringify(a))}catch{}};
const put=(a:Appearance,keepalive:boolean)=>fetch('/api/chart/prefs',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefs:{appearance:a}}),keepalive});

// vzhled grafu: hned z localStorage (bez bliknutí), pak z účtu; ukládá se 400 ms po poslední změně, odchod ze stránky uloží hned
// bez načtení z účtu (chyba, nepřihlášený) platí změny jen v tomto prohlížeči; změna před načtením má přednost před uloženou
export function useChartAppearance(){
 const [look,setLook]=useState<Appearance>(APPEARANCE_DEFAULT),[state,setState]=useState<SaveState>('loading'),[colors,setColors]=useState<string[]>([]);
 const loaded=useRef(false),dirty=useRef(false),pending=useRef<Appearance|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useIso(()=>{try{const v=localStorage.getItem(KEY);if(v)setLook(readAppearance(JSON.parse(v)))}catch{}},[]);
 const flush=(keepalive=false)=>{
  if(timer.current){clearTimeout(timer.current);timer.current=null}
  const a=pending.current;if(!a||!loaded.current)return;pending.current=null;
  setState('saving');
  put(a,keepalive).then(r=>{if(!r.ok)throw Error();setState(s=>pending.current?s:'saved')}).catch(()=>setState('error'));
 };
 const schedule=(a:Appearance)=>{pending.current=a;if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>flush(),400)};
 useEffect(()=>{
  const ac=new AbortController();
  fetch('/api/chart/prefs',{signal:ac.signal,cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{prefs?:{appearance?:unknown;colors?:unknown}}>:Promise.reject()).then(j=>{
   const p=j.prefs||{};
   setColors(Array.isArray(p.colors)?p.colors.filter((c):c is string=>isColor(c)&&c.length===7).map(c=>c.toLowerCase()):[]);
   loaded.current=true;setState('ok');
   if(dirty.current){if(pending.current)schedule(pending.current);return}
   if(p.appearance){const v=readAppearance(p.appearance);setLook(v);store(v)}
  }).catch(()=>{if(!ac.signal.aborted)setState('local')});
  const leave=()=>flush(true);
  window.addEventListener('pagehide',leave);
  return()=>{ac.abort();window.removeEventListener('pagehide',leave);flush(true)};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 const change=(next:Appearance)=>{setLook(next);store(next);dirty.current=true;pending.current=next;if(loaded.current)schedule(next)};
 return {look,change,state,colors};
}

// barvy motivu pro graf a náhledy: signál (--bull / --bear), značka, plocha a okraj; jen v prohlížeči
export type ThemeColors=CandleCtx&{brand:string;bg:string;grid:string};
export function themeColors():ThemeColors{
 const st=getComputedStyle(document.documentElement),g=(n:string,d:string)=>toHex(st.getPropertyValue(n))??d;
 return {dark:document.documentElement.dataset.theme==='dark',bull:g('--bull','#16a34a'),bear:g('--bear','#dc2626'),brand:g('--t-brand','#245bff'),bg:g('--t-surface','#ffffff'),grid:g('--t-border','#e2e6ee')};
}

type Side='up'|'down';
type EditKey=`${CandlePart}.${Side}`|'line'|'bg'|'grid';
const STATE_TEXT:Partial<Record<SaveState,string>>={saving:'Ukládám…',saved:'Uloženo k účtu',error:'Nepodařilo se uložit, platí jen v tomto prohlížeči.',local:'Platí jen v tomto prohlížeči.'};
const PART_LABEL:Record<CandlePart,string>={body:'Tělo',border:'Obrys',wick:'Knot'};
const SIDE_LABEL:Record<Side,string>={up:'růst',down:'pokles'};
const GRID_OPTS:[GridLines,string,string][]=[['both','Obě','Vodorovné i svislé čáry'],['h','Vodorovná','Jen vodorovné čáry (ceny)'],['v','Svislá','Jen svislé čáry (čas)'],['none','Žádná','Bez mřížky']];
const STYLE_OPTS:[GridStyle,string,string][]=[['solid','Plná','Plné čáry'],['dashed','Čárkovaná','Čárkované čáry'],['dotted','Tečkovaná','Tečkované čáry']];
const CROSS_OPTS:[Crosshair,string,string][]=[['normal','Volný','kříž sleduje myš'],['magnet','Magnet','přichytí se k O, H, L, C svíčky'],['hidden','Skrytý','bez čar, legenda zůstane']];
// paleta výběru barvy: šedé, syté, světlé a tmavé odstíny (Tailwind, jako zbytek aplikace)
const SWATCHES=['#ffffff','#e4e4e7','#d4d4d8','#a1a1aa','#71717a','#52525b','#3f3f46','#27272a','#18181b','#000000',
 '#dc2626','#f97316','#eab308','#16a34a','#10b981','#06b6d4','#245bff','#7c3aed','#c026d3','#ec4899',
 '#fca5a5','#fdba74','#fde047','#86efac','#6ee7b7','#67e8f9','#93c5fd','#c4b5fd','#f0abfc','#f9a8d4',
 '#7f1d1d','#9a3412','#854d0e','#14532d','#065f46','#155e75','#1e3a8a','#4c1d95','#701a75','#831843'];

export function ChartSettings({look,change,state,colors,type}:{look:Appearance;change:(a:Appearance)=>void;state:SaveState;colors:string[];type:ChartType|'footprint'}){
 const [edit,setEdit]=useState<EditKey|null>(null),theme=themeColors();
 const r=resolveCandles(look,theme),isLine=type==='line'||type==='area';
 // OHLC sloupce a footprint mají jen barvu růstu a poklesu (obrys a knot nemají)
 const single=type==='bars'||type==='footprint',parts:readonly CandlePart[]=single?['body']:CANDLE_PARTS;
 const set=(p:Partial<Appearance>)=>change({...look,...p});
 const toggleEdit=(k:EditKey)=>setEdit(e=>e===k?null:k);
 const app=sourcePair('app',theme),appName=palettes.find(p=>{const x=sourcePair(p.id,theme);return x.up===app.up&&x.down===app.down})?.label;
 const srcLabel=look.src==='app'?'podle Barev signálu':look.src==='custom'?'vlastní':palettes.find(p=>p.id===look.src)?.label??'';
 const partKey=edit&&edit.includes('.')?edit.split('.') as [CandlePart,Side]:null;
 const cross=CROSS_OPTS.find(o=>o[0]===look.crosshair),gridAuto=look.bg?canvasLine(look.bg):theme.grid;
 const editor=(k:EditKey)=>{
  const common={custom:colors,onClose:()=>setEdit(null)};
  if(k==='line')return <ColorEditor key={k} {...common} label="Barva čáry" value={look.line} fallback={theme.brand} onPick={c=>set({line:c})}/>;
  if(k==='bg')return <ColorEditor key={k} {...common} label="Pozadí grafu" value={look.bg} fallback={theme.bg} onPick={c=>set({bg:c})}/>;
  if(k==='grid')return <ColorEditor key={k} {...common} label="Barva mřížky" value={look.gridColor} fallback={gridAuto} onPick={c=>set({gridColor:c})}/>;
  const [p,side]=k.split('.') as [CandlePart,Side];
  return <ColorEditor key={k} {...common} label={(single?'Barva':PART_LABEL[p])+' · '+SIDE_LABEL[side]} value={r[p][side]} onPick={c=>{if(c)change(setPartColor(look,theme,p,side,c))}}/>;
 };
 return <div className="mc-ind mc-set">
  <section className="mc-set-sec" aria-label={isLine?'Čára':'Svíčky'}>
   <h3 className="mc-set-h">{isLine?'Čára':type==='bars'?'Sloupce':'Svíčky'}</h3>
   {isLine?<>
    <div className="mc-set-line"><span>Barva čáry</span><em>{look.line?look.line.toUpperCase():'podle motivu'}</em><Swatch color={look.line??theme.brand} open={edit==='line'} label="Barva čáry" onClick={()=>toggleEdit('line')}/></div>
    {edit==='line'&&editor('line')}
   </>:<>
    <div className="mc-cfg-field">
     <span className="mc-cfg-lbl"><span>Barvy</span><em>{srcLabel}</em></span>
     <div className="mc-src" role="radiogroup" aria-label="Barvy svíček">
      <button type="button" role="radio" aria-checked={look.src==='app'} className="mc-src-row" onClick={()=>set({src:'app'})}><Candles up={app.up} down={app.down}/><span><b>Podle Barev signálu</b><small>{appName?appName+' · ':''}mění se s nastavením aplikace</small></span></button>
      <div className="mc-src-grid">{palettes.map(p=>{const x=sourcePair(p.id,theme);return <button key={p.id} type="button" role="radio" aria-checked={look.src===p.id} aria-label={p.label} title={p.label} className="mc-src-chip" onClick={()=>set({src:p.id})}><Candles up={x.up} down={x.down}/></button>})}</div>
      <button type="button" role="radio" aria-checked={look.src==='custom'} className="mc-src-row" onClick={()=>set({src:'custom'})}><Candles up={look.body.up} down={look.body.down}/><span><b>Vlastní</b><small>klikni na barvu níže a vyber libovolnou</small></span></button>
     </div>
    </div>
    <div className="mc-parts" role="group" aria-label="Barvy částí svíčky">
     <span aria-hidden/><span className="mc-parts-h" aria-hidden>Růst</span><span className="mc-parts-h" aria-hidden>Pokles</span>
     {parts.map(p=>{const on=single||r[p].on;return <div key={p} className={'mc-part'+(on?'':' off')}>
      {single?<span className="mc-part-name">{type==='footprint'?'Delta':'Barva'}</span>:<button type="button" role="checkbox" aria-checked={r[p].on} className="mc-chk" onClick={()=>change({...look,[p]:{...look[p],on:!look[p].on}})}><i aria-hidden>{r[p].on&&<Check size={11} strokeWidth={3}/>}</i>{PART_LABEL[p]}</button>}
      {(['up','down'] as const).map(side=>{const k:EditKey=`${p}.${side}`;return <Swatch key={side} color={r[p][side]} open={edit===k} label={(single?'Barva':PART_LABEL[p])+' – '+SIDE_LABEL[side]+': '+r[p][side].toUpperCase()} onClick={()=>toggleEdit(k)}/>})}
     </div>})}
    </div>
    {partKey&&parts.includes(partKey[0])&&editor(edit as EditKey)}
    {type==='hollow'&&<p className="mc-ind-note">Rostoucí duté svíčky mají jen obrys – bez vlastního obrysu v barvě těla.</p>}
   </>}
  </section>
  <section className="mc-set-sec" aria-label="Plátno">
   <h3 className="mc-set-h">Plátno</h3>
   <div className="mc-set-line"><span>Pozadí</span><em>{look.bg?look.bg.toUpperCase():'podle motivu'}</em><Swatch color={look.bg??theme.bg} open={edit==='bg'} label="Pozadí grafu" onClick={()=>toggleEdit('bg')}/></div>
   {edit==='bg'&&editor('bg')}
   <div className="mc-cfg-field"><span className="mc-cfg-lbl"><span>Mřížka</span></span><Seg label="Mřížka" value={look.grid} options={GRID_OPTS} onPick={v=>set({grid:v})}/></div>
   {look.grid!=='none'&&<>
    <div className="mc-set-line"><Seg label="Styl mřížky" value={look.gridStyle} options={STYLE_OPTS} onPick={v=>set({gridStyle:v})}/><Swatch color={look.gridColor??gridAuto} open={edit==='grid'} label={'Barva mřížky: '+(look.gridColor?look.gridColor.toUpperCase():'podle motivu')} onClick={()=>toggleEdit('grid')}/></div>
    {edit==='grid'&&editor('grid')}
   </>}
   <div className="mc-cfg-field"><span className="mc-cfg-lbl"><span>Nitkový kříž</span>{cross&&<em>{cross[2]}</em>}</span><Seg label="Nitkový kříž" value={look.crosshair} options={CROSS_OPTS} onPick={v=>set({crosshair:v})}/></div>
  </section>
  <section className="mc-set-sec tight" aria-label="Cenová osa">
   <h3 className="mc-set-h">Cenová osa</h3>
   <SwitchRow label="Štítek poslední ceny" on={look.lastLabel} onToggle={()=>set({lastLabel:!look.lastLabel})}/>
   <SwitchRow label="Čára poslední ceny" note="tečkovaná čára přes celý graf" on={look.lastLine} onToggle={()=>set({lastLine:!look.lastLine})}/>
   <SwitchRow label="Odpočet do zavření svíčky" note="pod štítkem ceny; u zavřeného trhu se skryje" on={look.countdown} onToggle={()=>set({countdown:!look.countdown})}/>
  </section>
  <div className="mc-set-foot">
   <span className={'mc-set-st'+(state==='error'?' err':'')} role="status" aria-live="polite">{STATE_TEXT[state]??''}</span>
   <button type="button" className="mc-chip" disabled={sameAppearance(look,APPEARANCE_DEFAULT)} onClick={()=>{setEdit(null);change(APPEARANCE_DEFAULT)}}><RotateCcw size={13} aria-hidden/>Obnovit výchozí</button>
  </div>
 </div>;
}

// dvě svíčky (růst, pokles) jako náhled dvojice barev
function Candles({up,down}:{up:string;down:string}){
 return <svg className="mc-cndl" viewBox="0 0 26 18" width="26" height="18" aria-hidden><path d="M7 1v16" stroke={up} strokeWidth="1.5"/><rect x="4" y="4" width="6" height="9" rx="1" fill={up}/><path d="M19 2v15" stroke={down} strokeWidth="1.5"/><rect x="16" y="6" width="6" height="8" rx="1" fill={down}/></svg>;
}
// vzorek barvy (průhlednost přes šachovnici); otevírá výběr barvy pod řádkem
function Swatch({color,open,label,onClick}:{color:string;open:boolean;label:string;onClick:()=>void}){
 return <button type="button" className="mc-sw" aria-expanded={open} aria-label={label} title={label} onClick={onClick}><i style={{'--c':color} as React.CSSProperties}/></button>;
}
function Seg<T extends string>({label,value,options,onPick}:{label:string;value:T;options:[T,string,string][];onPick:(v:T)=>void}){
 return <div className="mc-seg" data-n={options.length} role="group" aria-label={label}>{options.map(([v,l,t])=><button key={v} type="button" aria-pressed={value===v} title={t} onClick={()=>onPick(v)}>{l}</button>)}</div>;
}
function SwitchRow({label,note,on,onToggle}:{label:string;note?:string;on:boolean;onToggle:()=>void}){
 const id=useId();
 return <button type="button" role="switch" aria-checked={on} aria-describedby={note?id:undefined} className="mc-set-sw" onClick={onToggle}><span><b>{label}</b>{note&&<small id={id}>{note}</small>}</span><span className="mc-switch" aria-hidden><i/></span></button>;
}
// výběr barvy: podle motivu (kde dává smysl), paleta, vlastní barvy z Nastavení, libovolná barva (systémový výběr nebo HEX) a neprůhlednost
function ColorEditor({label,value,fallback,custom,onPick,onClose}:{label:string;value:string|null;fallback?:string;custom:string[];onPick:(c:string|null)=>void;onClose:()=>void}){
 const ref=useRef<HTMLDivElement>(null),id=useId(),[draft,setDraft]=useState<string|null>(null);
 const cur=value??fallback??'#000000',{hex,a}=splitColor(toHex(cur)??'#000000'),op=Math.round(a*100);
 const pickHex=(h:string)=>onPick(withOpacity(h,a));
 useEffect(()=>{ref.current?.scrollIntoView({block:'nearest'})},[]);
 const chip=(c:string)=><button key={c} type="button" className="mc-ce-c" style={{background:c}} aria-pressed={value!==null&&hex===c} aria-label={c.toUpperCase()} title={c.toUpperCase()} onClick={()=>pickHex(c)}/>;
 return <div ref={ref} className="mc-ce" role="group" aria-label={'Barva: '+label}>
  <div className="mc-ce-head"><b>{label}</b><button type="button" className="mc-ce-x" aria-label="Zavřít výběr barvy" title="Zavřít" onClick={onClose}><X size={14} aria-hidden/></button></div>
  {fallback&&<button type="button" className="mc-ce-auto" aria-pressed={value===null} onClick={()=>onPick(null)}><i style={{background:fallback}} aria-hidden/>Podle motivu{value===null&&<Check size={14} aria-hidden/>}</button>}
  <div className="mc-ce-grid" role="group" aria-label="Paleta">{SWATCHES.map(chip)}</div>
  <div className="mc-ce-sub"><span>Moje barvy</span><a href="/nastaveni#barvy" title="Vlastní barvy spravuješ v Nastavení">{custom.length?'Upravit':'Přidat'}</a></div>
  {custom.length>0?<div className="mc-ce-grid" role="group" aria-label="Moje barvy">{custom.map(chip)}</div>:<p className="mc-ce-empty">Uložené barvy přidáš v Nastavení › Barvy kreseb.</p>}
  <div className="mc-ce-row">
   <span className="mc-ce-native" title="Libovolná barva"><input type="color" aria-label="Libovolná barva" value={hex} onChange={e=>pickHex(e.target.value)}/><Pipette size={14} aria-hidden/></span>
   <input type="text" className="mc-ce-hex" aria-label="Barva v HEX (#RRGGBB)" spellCheck={false} maxLength={7} value={draft??hex.toUpperCase()} onChange={e=>{const v=e.target.value.trim();setDraft(v);if(/^#?[0-9a-f]{6}$/i.test(v))pickHex((v.startsWith('#')?v:'#'+v).toLowerCase())}} onBlur={()=>setDraft(null)}/>
  </div>
  <div className="mc-cfg-field">
   <span className="mc-cfg-lbl"><span id={id}>Neprůhlednost</span><em>{op} %</em></span>
   <input type="range" className="mc-range" min={0} max={100} step={5} value={op} aria-labelledby={id} aria-valuetext={op+' %'} style={{'--p':op+'%'} as React.CSSProperties} onChange={e=>onPick(withOpacity(hex,Number(e.target.value)/100))}/>
  </div>
 </div>;
}
