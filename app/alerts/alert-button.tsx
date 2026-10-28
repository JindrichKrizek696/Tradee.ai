'use client';
// Tlačítko „Alert“ v detailu trhu: otevře formulář předvyplněný aktuální cenou; číslo = aktivní alerty na trhu.
import {useState} from 'react';
import {Bell} from 'lucide-react';
import {AlertForm} from './alert-form';
import {useAlerts} from './alert-api';
import './alerts.css';
export function AlertButton({instrument,name,price,changePct,score}:{instrument:string;name:string;price:number|null;changePct:number|null;score:number|null}){
 const [open,setOpen]=useState(false),{data}=useAlerts(instrument),n=data?.alerts.filter(a=>a.active).length??0;
 return <>
  <button type="button" className="al-btn al-detail-btn" title={n?`Aktivní alerty na tomto trhu: ${n}. Spravuješ je na stránce Alerty.`:'Nastavit alert na cenu, denní změnu nebo skóre'} onClick={()=>setOpen(true)}><Bell size={15} aria-hidden/>Alert{n>0&&<span className="al-tag active">{n}</span>}</button>
  {open&&<AlertForm instrument={instrument} name={name} price={price} changePct={changePct} score={score} pushAvailable={data?.pushAvailable} onClose={()=>setOpen(false)}/>}
 </>;
}
