'use client';
import type {MarketItem} from '@/lib/market-view';
import {ScoreBar,TrendMark,fmtScore} from './parts';
function Column({title,items,dir,open}:{title:string;items:MarketItem[];dir:'bull'|'bear';open:(id:string)=>void}){
 return <div className="m-top-col"><h3 className={dir==='bull'?'positive':'negative'}>{dir==='bull'?'▲':'▼'} {title}</h3>
  {items.length?items.map(i=><button key={i.id} type="button" className="m-top" onClick={()=>open(i.id)}><b>{i.name}</b><span className={dir==='bull'?'positive':'negative'}>{fmtScore(i.score)}</span><ScoreBar score={i.score}/><TrendMark trend={i.trend}/></button>):<p className="m-none">Žádný platný signál</p>}
 </div>;
}
export function TopSignals({bull,bear,open}:{bull:MarketItem[];bear:MarketItem[];open:(id:string)=>void}){
 return <section className="m-tops"><Column title="Nejsilnější bullish" items={bull} dir="bull" open={open}/><Column title="Nejsilnější bearish" items={bear} dir="bear" open={open}/></section>;
}
