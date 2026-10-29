'use client';
// Stránka /replay: trénink a validace obchodování na historii bez nahlížení do budoucna. Bez ?id seznam seancí a založení nové,
// s ?id=… běžící seance (simulační hodiny, příkazy, rozhodnutí, výsledky).
import {useEffect,useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import {usePalette} from '../palette';
import {ReplaySetup} from './replay-setup';
import {ReplaySession} from './replay-session';
import '../mt.css';
import './replay.css';
const readId=()=>{if(typeof location==='undefined')return null;const v=new URLSearchParams(location.search).get('id');return v&&/^rp_[a-z0-9]{1,30}$/.test(v)?v:null};
export default function ReplayPage(){
 usePalette();
 const [id,setId]=useState<string|null>(null),[ready,setReady]=useState(false);
 useEffect(()=>{setId(readId());setReady(true);const on=()=>setId(readId());window.addEventListener('popstate',on);return()=>window.removeEventListener('popstate',on)},[]);
 const open=(v:string|null)=>{history.pushState(null,'',v?'/replay?id='+v:'/replay');setId(v)};
 return <div className="mt-page rp-page">
  <header className="rp-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a>{id&&<button type="button" className="mt-back rp-link" onClick={()=>open(null)}>Všechny seance</button>}</header>
  {ready&&(id?<ReplaySession key={id} id={id} onClose={()=>open(null)}/>:<ReplaySetup onOpen={open}/>)}
 </div>;
}
