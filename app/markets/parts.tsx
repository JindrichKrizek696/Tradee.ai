'use client';
import type {Trend} from '@/lib/market-view';
export const fmtScore=(s:number|null)=>s===null?'—':(s>0?'+':'')+Math.round(s);
// Pruh od středu: vpravo bullish, vlevo bearish.
export function ScoreBar({score}:{score:number|null}){
 return <span className="m-bar" aria-hidden="true"><i className="m-mid"/>{score!==null&&score!==0&&<i className={score>0?'m-fill bull':'m-fill bear'} style={{[score>0?'left':'right']:'50%',width:Math.min(50,Math.abs(score)/2)+'%'}}/>}</span>;
}
export function TrendMark({trend}:{trend:Trend}){
 const [cls,sym,label]=trend===null?['m-trend','·','Trend neověřen']:trend>0?['m-trend positive','▲','Trend bullish']:trend<0?['m-trend negative','▼','Trend bearish']:['m-trend','■','Trend neutrální'];
 return <span className={cls} title={label} aria-label={label}>{sym}</span>;
}
