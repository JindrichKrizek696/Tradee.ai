'use client';
// Stránka /kalkulacka: samostatná kalkulačka velikosti pozice (?trh=EUR/USD&vstup=…&stop=…&cil=… předvyplní vstupy).
import {useState} from 'react';
import {ArrowLeft,Wallet} from 'lucide-react';
import {usePalette} from '../palette';
import {PositionCalculator,type CalcInitial} from './position-calculator';
import '../mt.css';
import './risk.css';
function fromQuery():CalcInitial{
 if(typeof location==='undefined')return {};
 const q=new URLSearchParams(location.search),n=(k:string)=>{const v=q.get(k);const x=v===null?NaN:Number(v);return Number.isFinite(x)?x:undefined};
 return {market:q.get('trh')||undefined,instrument:q.get('instrument')||undefined,entry:n('vstup'),stop:n('stop'),target:n('cil')};
}
export default function CalculatorPage(){
 usePalette();
 const [init]=useState(fromQuery);
 return <div className="mt-page">
  <header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main">
   <h1>Kalkulačka pozice</h1>
   <p className="mt-lead">Velikost pozice podle rizika: % zůstatku, % zbývajícího drawdownu nebo pevná částka. Objem se zaokrouhluje dolů na krok brokera, náklady (komise, spread) jsou v riziku. <a href="/ucty"><Wallet size={14}/> Účty a riziko</a></p>
   <section className="mt-card"><PositionCalculator initial={init} title={false}/></section>
  </main>
 </div>;
}
