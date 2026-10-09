// Obchody uživatele na jednom trhu pro vrstvu grafu (uzavřené MT + ruční, nejnovějších 500).
import type {Db} from '../mysql.ts';
import {listJournal} from '../journal/store.ts';
export type ChartTrade={id:string;side:'buy'|'sell'|null;openTs:number|null;closeTs:number;date:string;openPrice:number|null;closePrice:number|null;pnl:number;currency:string;r:number|null;source:'mt'|'manual'};
export async function chartTrades(d:Db,userId:string,instrument:string):Promise<ChartTrade[]>{
 const j=await listJournal(d,userId),mine=j.trades.filter(t=>t.instrument===instrument).sort((a,b)=>b.closeTs-a.closeTs).slice(0,500);
 const ids=mine.filter(t=>t.source==='mt').map(t=>t.id.replace(/^mt:/,'')),px=new Map<string,{o:number|null;c:number|null}>();
 for(let i=0;i<ids.length;i+=200){const part=ids.slice(i,i+200);
  for(const r of (await d.prepare(`SELECT id,open_price,close_price_avg FROM mt_positions WHERE id IN (${part.map(()=>'?').join(',')})`).bind(...part).all<{id:string;open_price:number|null;close_price_avg:number|null}>()).results)
   px.set(r.id,{o:r.open_price===null?null:Number(r.open_price),c:r.close_price_avg===null?null:Number(r.close_price_avg)});}
 return mine.map(t=>({id:t.id,side:t.side,openTs:t.openTs,closeTs:t.closeTs,date:t.date,openPrice:px.get(t.id.replace(/^mt:/,''))?.o??null,closePrice:px.get(t.id.replace(/^mt:/,''))?.c??null,pnl:t.pnl,currency:j.currency,r:t.r,source:t.source}));
}
