'use client';
import {useEffect,useLayoutEffect,useState} from 'react';
import {palettes,getPalette,isPalette,DEFAULT_PALETTE,type Palette} from '@/lib/palettes';
const KEY='tradee.palette';
const useIso=typeof window==='undefined'?useEffect:useLayoutEffect;
// světlé barvy --pl-*, tmavé --pd-*; který pár platí, vybírá palette.css podle data-theme
function apply(p:Palette){const s=document.documentElement.style,v:[string,string][]=[['--pl-bull',p.bull],['--pl-bear',p.bear],['--pl-bull-text',p.bullText],['--pl-bear-text',p.bearText],['--pd-bull',p.dark?.bull??p.bull],['--pd-bear',p.dark?.bear??p.bear]];for(const[k,x]of v)s.setProperty(k,x)}

// Předvolba barev signálu: hned z localStorage (bez bliknutí), pak sjednocení s účtem přes /api/settings.
export function usePalette(){
 const [id,setId]=useState(DEFAULT_PALETTE),[error,setError]=useState('');
 useIso(()=>{let saved:string|null=null;try{saved=localStorage.getItem(KEY)}catch{}if(isPalette(saved))setId(saved)},[]);
 useIso(()=>apply(getPalette(id)),[id]);
 useEffect(()=>{let live=true;fetch('/api/settings',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{palette?:string|null}>:null).then(j=>{if(live&&isPalette(j?.palette)){setId(j!.palette!);try{localStorage.setItem(KEY,j!.palette!)}catch{}}}).catch(()=>{});return()=>{live=false}},[]);
 const store=(v:string)=>{try{localStorage.setItem(KEY,v)}catch{}};
 // Neuložená volba se vrátí, jinak by ji příští načtení z účtu tiše přepsalo.
 const choose=(next:string)=>{if(!isPalette(next))return;const prev=id;setId(next);store(next);setError('');fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({palette:next})}).then(r=>{if(!r.ok)throw Error()}).catch(()=>{setId(prev);store(prev);setError('Barvy se nepodařilo uložit. Zkus to znovu.')})};
 return {palette:getPalette(id),choose,error};
}

export function PalettePicker({value,onChoose,error,children}:{value:string;onChoose:(id:string)=>void;error?:string;children?:React.ReactNode}){
 return <div className="p-picker" role="radiogroup" aria-label="Barvy signálu">
  <b>Barvy signálu</b>
  {palettes.map(p=><button key={p.id} type="button" role="radio" aria-checked={p.id===value} className={p.id===value?'on':''} onClick={()=>onChoose(p.id)}>
   <span className="p-swatch"><i style={{'--l':p.bull,'--d':p.dark?.bull??p.bull} as React.CSSProperties}/><i style={{'--l':p.bear,'--d':p.dark?.bear??p.bear} as React.CSSProperties}/></span>{p.label}{p.id===DEFAULT_PALETTE&&<small>výchozí</small>}
  </button>)}
  {error&&<p className="p-error" role="alert">{error}</p>}
  {children}
 </div>;
}
