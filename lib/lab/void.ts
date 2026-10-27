// Laboratoř · Simulace: zneplatnění obchodů otevřených nebo zavřených při zavřeném trhu (čistá funkce; zápis scripts/lab-void-closed-market.mjs).
// Před opravou obchodních hodin (lib/market-hours.ts isMarketOpen) se zavřený trh poznal jen podle stáří živé ceny – Yahoo ale o víkendu kotuje FX
// orientačně, takže simulace o víkendu otevírala i zavírala. Neplatný obchod zůstává v DB (void_reason), do statistik se nepočítá (paper.ts validTrades).
import {isMarketOpen} from '../market-hours.ts';

const H=3600000;
export type VoidIn={id:string;variant?:string|null;instrument:string;opened:number;closed:number|null;exitReason?:string|null;pnlCzk?:number|null;voidReason?:string|null};
export const VOID_OPEN='zavřený trh při vstupu',VOID_CLOSE='zavřený trh při výstupu',VOID_BOTH='zavřený trh při vstupu i výstupu';
// výstup SL / TP / trailing z H1 svíčky má čas = konec svíčky (u akcií až 16:30 NY, svíčka 15:30–16:00) → platí, když byl trh otevřený během svíčky
const closeOk=(x:VoidIn)=>{const c=x.closed!;if(isMarketOpen(x.instrument,null,c)||isMarketOpen(x.instrument,null,c-1))return true;
 return (x.exitReason==='sl'||x.exitReason==='tp'||x.exitReason==='trail')&&isMarketOpen(x.instrument,null,c-H)};
/** Důvod zneplatnění, nebo null (platný / už zneplatněný). */
export function voidReasonOf(x:VoidIn):string|null{
 if(x.voidReason)return null;
 const badOpen=!isMarketOpen(x.instrument,null,x.opened),badClose=x.closed!==null&&!closeOk(x);
 return badOpen&&badClose?VOID_BOTH:badOpen?VOID_OPEN:badClose?VOID_CLOSE:null;
}
export type VoidAction={id:string;variant:string;instrument:string;reason:string;wasOpen:boolean;opened:number;closed:number|null;pnlCzk:number|null};
/** Plán: které obchody zneplatnit; otevřené se zavřou jako neplatné (bez P&L) a uvolní místo. */
export function voidPlan(trades:VoidIn[]):VoidAction[]{
 return trades.flatMap(x=>{const reason=voidReasonOf(x);return reason?[{id:x.id,variant:x.variant??'A',instrument:x.instrument,reason,wasOpen:x.closed===null,opened:x.opened,closed:x.closed,pnlCzk:x.closed===null?null:(x.pnlCzk??0)}]:[]})
  .sort((a,b)=>a.opened-b.opened||a.id.localeCompare(b.id));
}
