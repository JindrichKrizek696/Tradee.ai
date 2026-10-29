// Replay: výsledky seance – obchody, R, P&L, profit factor, očekávaná hodnota, max. drawdown, porušení pravidel,
// rozhodnutí včetně „bez obchodu“ a integrita validace (přetočení / reset). Čisté funkce – testy scripts/check-replay.mjs.
import type {Trade,Breach,ReplayEvent} from './engine.ts';
export type Mode='learn'|'validate';
export const MODE_LABEL:Record<Mode,string>={learn:'Výukový',validate:'Validační'};
export type Summary={n:number;wins:number;losses:number;be:number;winRate:number|null;pnl:number;grossWin:number;grossLoss:number;pf:number|null;expectancy:number|null;
 avgR:number|null;totalR:number|null;rCount:number;maxDD:number;maxDDPct:number|null;costs:{commission:number;swap:number;spread:number;slippage:number};
 ambiguous:number;gaps:number;decisions:{long:number;short:number;none:number;total:number};breaches:{reason:string;ts:number;text:string}[];
 integrity:{rewinds:number;resets:number;ok:boolean};endBalance:number};
const r2=(n:number)=>Math.round(n*100)/100;
export const BREACH_TEXT:Record<Breach['reason'],string>={daily:'Porušen denní limit ztráty',drawdown:'Porušen maximální drawdown'};
export function summarize(trades:Trade[],events:ReplayEvent[],startBalance:number,breach:Breach|null,mode:Mode):Summary{
 const closed=[...trades].sort((a,b)=>a.exitTs-b.exitTs||a.id.localeCompare(b.id));
 const wins=closed.filter(t=>t.net>0),losses=closed.filter(t=>t.net<0);
 const grossWin=r2(wins.reduce((a,t)=>a+t.net,0)),grossLoss=r2(-losses.reduce((a,t)=>a+t.net,0)),pnl=r2(closed.reduce((a,t)=>a+t.net,0));
 const withR=closed.filter(t=>t.r!==null),totalR=withR.length?r2(withR.reduce((a,t)=>a+(t.r as number),0)):null;
 let bal=startBalance,peak=startBalance,maxDD=0,maxDDPct=0;
 for(const t of closed){bal+=t.net;if(bal>peak)peak=bal;const dd=peak-bal;if(dd>maxDD){maxDD=dd;maxDDPct=peak>0?dd/peak*100:0}}
 const live=events.filter(e=>!e.void),dec=live.filter(e=>e.kind==='decision'),choice=(c:string)=>dec.filter(e=>e.data.choice===c).length;
 const rewinds=events.filter(e=>e.kind==='rewind').length,resets=events.filter(e=>e.kind==='reset').length;
 return {n:closed.length,wins:wins.length,losses:losses.length,be:closed.length-wins.length-losses.length,winRate:closed.length?Math.round(wins.length/closed.length*1000)/10:null,pnl,grossWin,grossLoss,
  pf:grossLoss>0?Math.round(grossWin/grossLoss*100)/100:null,expectancy:closed.length?r2(pnl/closed.length):null,avgR:withR.length?Math.round((totalR as number)/withR.length*100)/100:null,totalR,rCount:withR.length,
  maxDD:r2(maxDD),maxDDPct:closed.length?Math.round(maxDDPct*100)/100:null,
  costs:{commission:r2(closed.reduce((a,t)=>a+t.commission,0)),swap:r2(closed.reduce((a,t)=>a+t.swap,0)),spread:r2(closed.reduce((a,t)=>a+t.spreadCost,0)),slippage:r2(closed.reduce((a,t)=>a+t.slippageCost,0))},
  ambiguous:closed.filter(t=>t.ambiguous).length,gaps:closed.filter(t=>t.gap).length,
  decisions:{long:choice('long'),short:choice('short'),none:choice('none'),total:dec.length},
  breaches:breach?[{reason:breach.reason,ts:breach.ts,text:BREACH_TEXT[breach.reason]}]:[],
  integrity:{rewinds,resets,ok:mode==='learn'||rewinds+resets===0},endBalance:r2(startBalance+pnl)};
}
/** CSV obchodů (středník, desetinná čárka by rozbila čísla – tečka; UTF-8 s BOM přidává klient). */
export function tradesCsv(trades:Trade[]):string{
 const iso=(ms:number)=>new Date(ms).toISOString();
 const head=['id','trh','směr','objem','vstup čas','vstup','výstup čas','výstup','důvod','SL','TP','hrubě','komise','swap','spread','skluz','čistě','plánované riziko','R','nejednoznačné','gap'];
 const rows=trades.map(t=>[t.id,t.symbol,t.side,t.qty,iso(t.entryTs),t.entry,iso(t.exitTs),t.exit,t.reason,t.sl??'',t.tp??'',t.gross,t.commission,t.swap,t.spreadCost,t.slippageCost,t.net,t.plannedRisk??'',t.r??'',t.ambiguous?1:0,t.gap?1:0]);
 return [head,...rows].map(r=>r.map(v=>{const s=String(v);return /[;"\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join(';')).join('\n');
}
