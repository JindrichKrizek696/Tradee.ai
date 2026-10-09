// DB vrstva otevřených pozic: mt_positions (status open) + poslední position_state z mt_events.
import type {Db} from '../mysql.ts';
import {userCurrency,loadRates} from '../rates-db.ts';
import {convert} from '../fx.ts';
import {pragueDate} from '../mt/trades.ts';
import {mapSymbol} from '../checklists/core.ts';
import {symbolMap} from '../checklists/store.ts';
import {rMultiple,isStale,summarize,currentRisk,slInProfit,riskSummary,type OpenPosition,type AccountInfo} from './open.ts';
type Row={id:string;account_id:string;ticket:string;symbol:string;side:'buy'|'sell';open_ts:number;open_price:number;volume_max:number;sl_initial:number|null;sl_last:number|null;tp_last:number|null;risk_money:number|null;acc_currency:string;acc_name:string;acc_login:string};
type Tick={tickSize:number;tickValue:number};
type State={account_id:string;position:string;payload:string;ts:number};
const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const lvl=(v:unknown)=>{const n=num(v);return n!==null&&n>0?n:null};
export async function openPositions(d:Db,userId:string,ids:readonly string[],now=Date.now()){
 const rows=(await d.prepare(`SELECT p.id,p.account_id,p.ticket,p.symbol,p.side,p.open_ts,p.open_price,p.volume_max,p.sl_initial,p.sl_last,p.tp_last,p.risk_money,a.currency AS acc_currency,a.name AS acc_name,a.login AS acc_login
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

 // tickSize/tickValue z otevíracího dealu (entry 'in'), jeden dotaz pro všechny pozice
 const ticks=new Map<string,Tick>();
 if(rows.length){
  const accs=[...new Set(rows.map(r=>r.account_id))],pos=[...new Set(rows.map(base))];
  for(const e of (await d.prepare(`SELECT account_id,position,payload FROM mt_events WHERE type='deal' AND JSON_VALUE(payload,'$.entry')='in' AND account_id IN (${accs.map(()=>'?').join(',')}) AND position IN (${pos.map(()=>'?').join(',')}) ORDER BY ts DESC,event_id DESC`).bind(...accs,...pos).all<{account_id:string;position:string;payload:string}>()).results){
   try{const j=JSON.parse(e.payload) as {entry?:unknown;tickSize?:unknown;tickValue?:unknown},ts=num(j.tickSize),tv=num(j.tickValue);
    if(j.entry==='in'&&ts!==null&&tv!==null&&ts>0&&tv>0)ticks.set(e.account_id+'\n'+e.position,{tickSize:ts,tickValue:tv})}catch{}
  }
 }
 const accRows=(await d.prepare('SELECT id,name,login,currency,balance,equity FROM mt_accounts WHERE user_id=? ORDER BY created').bind(userId).all<{id:string;name:string;login:string;currency:string;balance:number|null;equity:number|null}>()).results;
 const rates=await loadRates(d,currency,[...rows.map(r=>r.acc_currency),...accRows.map(a=>a.currency)]),date=pragueDate(now),map=await symbolMap(d,userId);
 const positions:OpenPosition[]=rows.map(r=>{
  const s=states.get(r.account_id+'\n'+base(r));let st:Record<string,unknown>|null=null;
  try{const j=s?JSON.parse(s.payload):null;st=j&&typeof j==='object'?j:null}catch{}
  const has=st!==null,updated=has?Number(s!.ts):null,floating=has?(num(st!.profit)??0)+(num(st!.swap)??0):null;
  const conv=floating===null?null:convert(floating,r.acc_currency,currency,date,rates);
  const sl=has?lvl(st!.sl):r.sl_last===null?null:Number(r.sl_last),tp=has?lvl(st!.tp):r.tp_last===null?null:Number(r.tp_last);
  const tk=ticks.get(r.account_id+'\n'+base(r)),volume=has&&num(st!.volume)?num(st!.volume)!:Number(r.volume_max),openPrice=Number(r.open_price);
  const accRisk=currentRisk({side:r.side,open:openPrice,sl,volume,tickSize:tk?.tickSize,tickValue:tk?.tickValue,riskInitial:r.risk_money===null?null:Number(r.risk_money),slInitial:r.sl_initial===null?null:Number(r.sl_initial),volumeMax:Number(r.volume_max)});
  const risk=accRisk===null?null:convert(accRisk,r.acc_currency,currency,date,rates);
  return {id:r.id,accountId:r.account_id,account:r.acc_name||'••••'+String(r.acc_login).slice(-4),symbol:r.symbol,instrument:mapSymbol(r.symbol,ids,map),side:r.side,
   volume,openPrice,price:has?lvl(st!.priceCurrent):null,sl,tp,profit:floating,accountCurrency:r.acc_currency,
   pnl:floating===null?null:conv??floating,converted:floating===null||conv!==null,riskMoney:risk,risk:accRisk,slInProfit:slInProfit(r.side,openPrice,sl),r:rMultiple(floating,r.risk_money===null?(accRisk||null):Number(r.risk_money)),
   openTs:Number(r.open_ts),updated,stale:isStale(updated,now)};
 });
 const accounts:AccountInfo[]=accRows.map(a=>{const eq=num(a.equity)!==null&&Number(a.equity)>0?Number(a.equity):num(a.balance)!==null&&Number(a.balance)>0?Number(a.balance):null;
  return {id:a.id,name:a.name||'••••'+String(a.login).slice(-4),currency:a.currency,equity:eq,equityConv:eq===null?null:convert(eq,a.currency,currency,date,rates)};
 });
 return {currency,positions,summary:summarize(positions),...riskSummary(positions,accounts)};
}
