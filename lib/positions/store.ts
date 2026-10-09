// DB vrstva otevřených pozic: mt_positions (status open) + poslední position_state z mt_events.
import type {Db} from '../mysql.ts';
import {userCurrency,loadRates} from '../rates-db.ts';
import {convert} from '../fx.ts';
import {pragueDate} from '../mt/trades.ts';
import {mapSymbol} from '../checklists/core.ts';
import {symbolMap} from '../checklists/store.ts';
import {rMultiple,isStale,summarize,type OpenPosition} from './open.ts';
type Row={id:string;account_id:string;ticket:string;symbol:string;side:'buy'|'sell';open_ts:number;open_price:number;volume_max:number;sl_last:number|null;tp_last:number|null;risk_money:number|null;acc_currency:string;acc_name:string;acc_login:string};
type State={account_id:string;position:string;payload:string;ts:number};
const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const lvl=(v:unknown)=>{const n=num(v);return n!==null&&n>0?n:null};
export async function openPositions(d:Db,userId:string,ids:readonly string[],now=Date.now()){
 const rows=(await d.prepare(`SELECT p.id,p.account_id,p.ticket,p.symbol,p.side,p.open_ts,p.open_price,p.volume_max,p.sl_last,p.tp_last,p.risk_money,a.currency AS acc_currency,a.name AS acc_name,a.login AS acc_login
  FROM mt_positions p JOIN mt_accounts a ON a.id=p.account_id WHERE a.user_id=? AND p.status='open' ORDER BY p.open_ts DESC`).bind(userId).all<Row>()).results;
 const currency=await userCurrency(d,userId);
 const base=(r:Row)=>String(r.ticket).split(':r')[0];
 const states=new Map<string,State>();
 if(rows.length){
  const accs=[...new Set(rows.map(r=>r.account_id))],pos=[...new Set(rows.map(base))];
  // poslední stav každé pozice: MAX(ts) přes index (account_id,position,ts), payload se dočte až pro vítěze
  const inl=`account_id IN (${accs.map(()=>'?').join(',')}) AND position IN (${pos.map(()=>'?').join(',')})`;
  for(const s of (await d.prepare(`SELECT e.account_id,e.position,e.payload,e.ts FROM mt_events e JOIN (SELECT account_id,position,MAX(ts) AS ts FROM mt_events WHERE type='position_state' AND ${inl} GROUP BY account_id,position) m
   ON m.account_id=e.account_id AND m.position=e.position AND m.ts=e.ts WHERE e.type='position_state' ORDER BY e.event_id`).bind(...accs,...pos).all<State>()).results)states.set(s.account_id+'\n'+s.position,s);
 }
 const rates=await loadRates(d,currency,rows.map(r=>r.acc_currency)),date=pragueDate(now),map=await symbolMap(d,userId);
 const positions:OpenPosition[]=rows.map(r=>{
  const s=states.get(r.account_id+'\n'+base(r));let st:Record<string,unknown>|null=null;
  try{const j=s?JSON.parse(s.payload):null;st=j&&typeof j==='object'?j:null}catch{}
  const has=st!==null,updated=has?Number(s!.ts):null,floating=has?(num(st!.profit)??0)+(num(st!.swap)??0):null;
  const conv=floating===null?null:convert(floating,r.acc_currency,currency,date,rates);
  const risk=r.risk_money===null?null:convert(Number(r.risk_money),r.acc_currency,currency,date,rates);
  const sl=has?lvl(st!.sl):r.sl_last===null?null:Number(r.sl_last),tp=has?lvl(st!.tp):r.tp_last===null?null:Number(r.tp_last);
  return {id:r.id,accountId:r.account_id,account:r.acc_name||'••••'+String(r.acc_login).slice(-4),symbol:r.symbol,instrument:mapSymbol(r.symbol,ids,map),side:r.side,
   volume:has&&num(st!.volume)?num(st!.volume)!:Number(r.volume_max),openPrice:Number(r.open_price),price:has?lvl(st!.priceCurrent):null,sl,tp,profit:floating,accountCurrency:r.acc_currency,
   pnl:floating===null?null:conv??floating,converted:floating===null||conv!==null,riskMoney:risk,r:rMultiple(floating===null?null:conv,risk),
   openTs:Number(r.open_ts),updated,stale:isStale(updated,now)};
 });
 return {currency,positions,summary:summarize(positions)};
}
