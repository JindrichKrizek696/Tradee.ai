'use client';
import type {MarketItem} from '@/lib/market-view';
import {intensity,matchesQuery,textOn,tileBackground,DARK_BASE} from '@/lib/market-view';
import {useTheme} from '../theme';
import type {Palette} from '@/lib/palettes';
import {FlagDot} from './flag-dot';
import {LiveChange,type LiveData} from '../live';
import {fmtScore} from './parts';
const trendText=(t:MarketItem['trend'])=>t===null?'trend neověřen':t>0?'trend bullish':t<0?'trend bearish':'trend neutrální';
export function Heatmap({groups,query,palette,flags,flagsReady,onFlag,open,live}:{live?:LiveData|null;groups:{group:string;label:string;items:MarketItem[]}[];query:string;palette:Palette;flags:Record<string,string>;flagsReady:boolean;onFlag:(id:string,flag:string)=>void;open:(id:string)=>void}){
 const base=useTheme().theme==='dark'?DARK_BASE:undefined;
 return <div className="m-heat">{groups.map(g=><section key={g.group}><h3>{g.label}</h3><div className="m-tiles">{g.items.map(i=>{
  const a=intensity(i.score),hex=i.score!==null&&i.score<0?palette.bear:palette.bull;
  const style=i.score===null?undefined:{background:tileBackground(hex,a,base),color:textOn(hex,a,base)};
  return <div key={i.id} role="button" tabIndex={0} className={'m-tile'+(i.score===null?' m-empty':'')+(matchesQuery(i,query)?'':' m-dim')} style={style} title={`${i.name} · ${i.bias} · ${trendText(i.trend)} · ${i.coverage} % podkladů`} onClick={()=>open(i.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(i.id)}}}>
   <b>{i.name.replace(/ · měnový index$/,'')}</b><span>{fmtScore(i.score)}</span>{live?.quotes[i.id]&&<em className="m-tday"><LiveChange pct={live.quotes[i.id].changePct}/></em>}
   <FlagDot id={i.id} flag={flags[i.id]||'none'} disabled={!flagsReady} onPick={onFlag}/>
  </div>})}</div></section>)}</div>;
}
