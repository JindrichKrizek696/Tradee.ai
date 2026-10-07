// Uzavřené MT pozice → řádky kalendáře obchodů (vedle ručních zápisů).
import type {Trade} from '../trades.ts';
import {convert,type Rates} from '../fx.ts';
export type MtClosedRow={id:string;ticket:string;symbol:string;net:number;close_ts:number;tags:string;tags_manual:string;note:string|null;acc_currency:string;acc_name:string;acc_login:string};
export const pragueDate=(ms:number)=>new Date(ms).toLocaleDateString('sv-SE',{timeZone:'Europe/Prague'});
export function mtTradesToCalendar(rows:MtClosedRow[],currency:string,rates:Rates):Trade[]{
 return rows.map(r=>{
  const date=pragueDate(Number(r.close_ts)),net=Number(r.net),conv=convert(net,r.acc_currency,currency,date,rates);
  const tags=[r.tags,r.tags_manual].filter(Boolean).join(',').split(',').filter(Boolean).map(t=>'#'+t).join(' ');
  return {id:'mt:'+r.id,date,instrument:r.symbol,pnl:conv??net,note:[tags,r.note||''].filter(Boolean).join(' · '),created:new Date(Number(r.close_ts)).toISOString(),source:'mt',account:r.acc_name||'••••'+String(r.acc_login).slice(-4),accountCurrency:r.acc_currency,net,converted:conv!==null};
 });
}
