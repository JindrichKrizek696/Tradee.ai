'use client';
import {useEffect,useLayoutEffect,useState} from 'react';
import {palettes,getPalette,isPalette,DEFAULT_PALETTE,type Palette} from '@/lib/palettes';
const KEY='tradee.palette';
const useIso=typeof window==='undefined'?useEffect:useLayoutEffect;
function apply(p:Palette){const s=document.documentElement.style;s.setProperty('--bull',p.bull);s.setProperty('--bear',p.bear);s.setProperty('--bull-text',p.bullText);s.setProperty('--bear-text',p.bearText)}

// Předvolba barev signálu: hned z localStorage (bez bliknutí), pak sjednocení s účtem přes /api/settings.
export function usePalette(){
 const [id,setId]=useState(DEFAULT_PALETTE);
 useIso(()=>{let saved:string|null=null;try{saved=localStorage.getItem(KEY)}catch{}if(isPalette(saved))setId(saved)},[]);
 useIso(()=>apply(getPalette(id)),[id]);
 useEffect(()=>{let live=true;fetch('/api/settings',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{palette?:string|null}>:null).then(j=>{if(live&&isPalette(j?.palette)){setId(j!.palette!);try{localStorage.setItem(KEY,j!.palette!)}catch{}}}).catch(()=>{});return()=>{live=false}},[]);
 const choose=(next:string)=>{if(!isPalette(next))return;setId(next);try{localStorage.setItem(KEY,next)}catch{}fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({palette:next})}).catch(()=>{})};
 return {palette:getPalette(id),choose};
}

export function PalettePicker({value,onChoose}:{value:string;onChoose:(id:string)=>void}){
 return <div className="p-picker" role="radiogroup" aria-label="Barvy signálu">
  <b>Barvy signálu</b>
  {palettes.map(p=><button key={p.id} type="button" role="radio" aria-checked={p.id===value} className={p.id===value?'on':''} onClick={()=>onChoose(p.id)}>
   <span className="p-swatch"><i style={{background:p.bull}}/><i style={{background:p.bear}}/></span>{p.label}{p.id===DEFAULT_PALETTE&&<small>výchozí</small>}
  </button>)}
 </div>;
}
