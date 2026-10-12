// Import historie CFD účtu Trading 212 (CSV export). Čistá funkce bez DB – testy scripts/check-t212.mjs.
// Obchod = jeden řádek „Closed position“. SL/TP a důvod výstupu se dopočítají z řádků „Order“ se stejným Position ID.
export type T212Change={ts:number;old:number|null;new:number|null};
export type T212Trade={
 positionId:string;part:number;parts:number;symbol:string;instrument:string;side:'buy'|'sell';units:number;
 openTs:number;closeTs:number;entry:number;exit:number;accountCurrency:string;instrumentCurrency:string;exchangeRate:number|null;
 result:number;fxFee:number;overnight:number;dividend:number;spread:number;total:number;
 slInitial:number|null;tpInitial:number|null;slLast:number|null;tpLast:number|null;slChanges:T212Change[];tpChanges:T212Change[];
 openReason:'market'|'pending'|null;exitReason:'sl'|'tp'|'manual'|null;
 riskMoney:number|null;rrPlanned:number|null;r:number|null;
 /** v souboru je otevírací příkaz i příkaz, který pozici zavřel (jinak pozice začala před obdobím exportu) */
 complete:boolean;
};
export type T212Totals={count:number;wins:number;losses:number;result:number;fxFee:number;overnight:number;dividend:number;spread:number;total:number};
export type T212Parsed={
 trades:T212Trade[];currencies:string[];period:{from:number;to:number}|null;totals:T212Totals;
 cash:{deposits:number;withdrawals:number;transfersIn:number;transfersOut:number;interest:number};
 openPositions:number;rows:number;
};
export const MAX_T212_BYTES=5*1024*1024;
// Pojistka proti kvadratické práci u podvržených souborů: max. částí a pokynů na jednu pozici
export const MAX_PARTS_PER_POSITION=100,MAX_ORDERS_PER_POSITION=400;
const r2=(n:number)=>Math.round(n*100)/100;
const EPS=1e-9;

/** CSV (RFC 4180): čárky, uvozovky se zdvojením, nové řádky uvnitř uvozovek, BOM, CRLF. */
export function parseCsv(text:string):string[][]{
 const s=text.charCodeAt(0)===0xfeff?text.slice(1):text,out:string[][]=[];
 let row:string[]=[],cell='',q=false;
 for(let i=0;i<s.length;i++){
  const c=s[i];
  if(q){if(c==='"'){if(s[i+1]==='"'){cell+='"';i++}else q=false}else cell+=c;continue}
  if(c==='"')q=true;
  else if(c===','){row.push(cell);cell=''}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&s[i+1]==='\n')i++;row.push(cell);cell='';if(row.length>1||row[0]!=='')out.push(row);row=[]}
  else cell+=c;
 }
 row.push(cell);if(row.length>1||row[0]!=='')out.push(row);
 return out;
}
// „Average price (instrument currency)“ → „average price“
const norm=(h:string)=>h.replace(/\(.*?\)/g,'').trim().toLowerCase().replace(/\s+/g,' ');
const COLS={type:'record type',date:'date',accCur:'account currency',instrument:'instrument',symbol:'symbol',insCur:'instrument currency',direction:'direction',units:'units',pid:'position id',orderId:'order id',orderType:'order type',intent:'intent',status:'status',created:'date created',opened:'date opened',closed:'date closed',avg:'average price',close:'close price',target:'target price',executed:'executed price',rate:'exchange rate',spread:'spread',result:'result',fx:'fx fee',afterFx:'result after fx fee',overnight:'overnight interest',dividend:'dividend adjustment',total:'total result',txType:'transaction type',amount:'amount'} as const;
type Col=keyof typeof COLS;type Row=Record<Col,string>;
const REQUIRED:Col[]=['type','pid','symbol','direction','units','opened','closed','avg','close','total'];
/** „2026-01-02 10:11:12+00:00“ (UTC) → ms; bez zóny = UTC */
export function parseTime(v:string):number|null{
 const s=v.trim();if(!s)return null;
 let iso=s.replace(' ','T');if(!/(Z|[+-]\d{2}:?\d{2})$/.test(iso))iso+='Z';
 const t=Date.parse(iso);return Number.isFinite(t)?t:null;
}
const num=(v:string)=>{const s=v.trim();if(!s)return null;const n=Number(s);return Number.isFinite(n)?n:null};
const n0=(v:string)=>num(v)??0;
type Order={type:string;intent:string;status:string;created:number;date:number;target:number|null;executed:number|null;units:number|null};
const exitOf=(t:string):'sl'|'tp'|'manual'=>t==='STOP LOSS'?'sl':t==='TAKE PROFIT'?'tp':'manual';
/** Úroveň aktivní při vstupu = poslední zadaná nejpozději v čase otevření (u čekajících příkazů dřív), jinak první zadaná po otevření; další zadání = posuny. */
function levels(list:Order[],openTs:number,closeTs:number){
 const all=list.filter(o=>o.target!==null&&o.created<=closeTs).sort((a,b)=>a.created-b.created);
 if(!all.length)return {initial:null,last:null,changes:[] as T212Change[]};
 let i=-1;for(let k=0;k<all.length;k++)if(all[k].created<=openTs+1000)i=k;
 if(i<0)i=0;
 const changes:T212Change[]=[];let cur=all[i].target as number;
 for(const o of all.slice(i+1))if(Math.abs((o.target as number)-cur)>EPS){changes.push({ts:Math.max(o.created,openTs),old:cur,new:o.target});cur=o.target as number}
 return {initial:all[i].target,last:cur,changes};
}
export function parseT212(text:string):T212Parsed{
 const rows=parseCsv(text);
 if(!rows.length)throw new Error('Soubor je prázdný.');
 const head=rows[0].map(norm),idx={} as Record<Col,number>;
 for(const [k,name] of Object.entries(COLS) as [Col,string][])idx[k]=head.indexOf(name);
 const missing=REQUIRED.filter(k=>idx[k]<0);
 if(missing.length)throw new Error('Tohle nevypadá jako export historie CFD účtu z Trading 212 (chybí sloupce: '+missing.map(k=>COLS[k]).join(', ')+').');
 const data:Row[]=rows.slice(1).map(r=>{const o={} as Row;for(const k of Object.keys(COLS) as Col[])o[k]=idx[k]>=0?(r[idx[k]]??'').trim():'';return o});
 const orders=new Map<string,Order[]>(),closed:Row[]=[];
 const cash={deposits:0,withdrawals:0,transfersIn:0,transfersOut:0,interest:0};
 for(const r of data){
  const type=r.type.toLowerCase();
  if(type==='order'&&r.pid){
   const created=parseTime(r.created)??parseTime(r.date);if(created===null)continue;
   const l=orders.get(r.pid)||[];l.push({type:r.orderType.toUpperCase(),intent:r.intent.toUpperCase(),status:r.status.toUpperCase(),created,date:parseTime(r.date)??created,target:num(r.target),executed:num(r.executed),units:num(r.units)});orders.set(r.pid,l);
  }else if(type==='closed position'&&r.pid)closed.push(r);
  else if(type==='transaction'){
   const a=n0(r.amount),t=r.txType.toLowerCase();
   if(t==='deposit')cash.deposits+=a;else if(t==='withdrawal'||t==='withdraw')cash.withdrawals+=-a;else if(a>=0)cash.transfersIn+=a;else cash.transfersOut+=-a;
  }else if(type==='interest on cash')cash.interest+=n0(r.amount);
 }
 const byPid=new Map<string,Row[]>();
 for(const r of closed){const l=byPid.get(r.pid)||[];if(l.length>=MAX_PARTS_PER_POSITION)throw Error(`Pozice ${r.pid} má víc než ${MAX_PARTS_PER_POSITION} částečných uzavření – soubor nevypadá jako export Trading 212.`);l.push(r);byPid.set(r.pid,l)}
 const trades:T212Trade[]=[];
 for(const [pid,list] of byPid){
  const parts=list.map(r=>({r,openTs:parseTime(r.opened),closeTs:parseTime(r.closed)??parseTime(r.date)})).filter((x):x is {r:Row;openTs:number;closeTs:number}=>x.openTs!==null&&x.closeTs!==null).sort((a,b)=>a.closeTs-b.closeTs);
  const os=orders.get(pid)||[];
  if(os.length>MAX_ORDERS_PER_POSITION)throw Error(`Pozice ${pid} má víc než ${MAX_ORDERS_PER_POSITION} pokynů – soubor nevypadá jako export Trading 212.`);
  const openOrder=os.find(o=>o.intent==='OPEN'&&o.status==='EXECUTED');
  const closers=os.filter(o=>o.intent==='CLOSE'&&o.status==='EXECUTED').sort((a,b)=>a.date-b.date),used=new Set<Order>();
  parts.forEach(({r,openTs,closeTs},part)=>{
   const side=r.direction.toLowerCase()==='sell'?'sell':'buy',units=Math.abs(n0(r.units)),entry=n0(r.avg),exit=n0(r.close);
   const sl=levels(os.filter(o=>o.type==='STOP LOSS'),openTs,closeTs),tp=levels(os.filter(o=>o.type==='TAKE PROFIT'),openTs,closeTs);
   // příkaz, který zavřel tuto část: stejná provedená cena jako výstup, jinak nejbližší čas (do 10 min), jinak první nevyužitý
   // (u SL/TP je „Date“ v exportu čas zadání, ne provedení)
   const free=closers.filter(o=>!used.has(o)),near=(o:Order)=>Math.abs(o.date-closeTs);
   const samePrice=free.filter(o=>o.executed!==null&&Math.abs(o.executed-exit)<=Math.abs(exit)*1e-9+EPS).sort((a,b)=>near(a)-near(b));
   const closer=samePrice[0]??free.filter(o=>near(o)<=600_000).sort((a,b)=>near(a)-near(b))[0]??free[0];
   if(closer)used.add(closer);
   const result=n0(r.result),fxFee=n0(r.fx),overnight=n0(r.overnight),dividend=n0(r.dividend),total=num(r.total)??r2(result+fxFee+overnight+dividend);
   // kurz: Result ≈ (výstup − vstup) × kusy × kurz; když chybí, dopočítat z výsledku
   const raw=(exit-entry)*units*(side==='buy'?1:-1);
   let rate=num(r.rate);if(!rate||rate<=0)rate=Math.abs(raw)>EPS?Math.abs(result/raw):null;
   const slI=sl.initial,lossSide=slI!==null&&(side==='buy'?slI<entry:slI>entry);
   const riskMoney=lossSide&&rate?r2(Math.abs(entry-(slI as number))*units*rate):null;
   const rrPlanned=lossSide&&tp.initial!==null&&Math.abs(entry-(slI as number))>EPS?r2(Math.abs(tp.initial-entry)/Math.abs(entry-(slI as number))):null;
   trades.push({positionId:pid,part,parts:parts.length,symbol:r.symbol.toUpperCase(),instrument:r.instrument,side,units,openTs,closeTs,entry,exit,accountCurrency:r.accCur.toUpperCase()||'USD',instrumentCurrency:r.insCur.toUpperCase(),exchangeRate:rate,
    result:r2(result),fxFee:r2(fxFee),overnight:r2(overnight),dividend:r2(dividend),spread:r2(n0(r.spread)),total:r2(total),
    slInitial:sl.initial,tpInitial:tp.initial,slLast:sl.last,tpLast:tp.last,slChanges:sl.changes,tpChanges:tp.changes,
    openReason:openOrder?(openOrder.type==='MARKET'?'market':'pending'):null,exitReason:closer?exitOf(closer.type):null,
    riskMoney,rrPlanned,r:riskMoney&&riskMoney>0?r2(total/riskMoney):null,complete:!!openOrder&&!!closer});
  });
 }
 trades.sort((a,b)=>a.closeTs-b.closeTs||a.positionId.localeCompare(b.positionId)||a.part-b.part);
 // otevřené pozice: otevírací příkaz bez uzavřené pozice v souboru
 let openPositions=0;for(const [pid,os] of orders)if(!byPid.has(pid)&&os.some(o=>o.intent==='OPEN'&&o.status==='EXECUTED'))openPositions++;
 const totals:T212Totals={count:trades.length,wins:0,losses:0,result:0,fxFee:0,overnight:0,dividend:0,spread:0,total:0};
 for(const t of trades){if(t.total>0)totals.wins++;else if(t.total<0)totals.losses++;totals.result+=t.result;totals.fxFee+=t.fxFee;totals.overnight+=t.overnight;totals.dividend+=t.dividend;totals.spread+=t.spread;totals.total+=t.total}
 for(const k of ['result','fxFee','overnight','dividend','spread','total'] as const)totals[k]=r2(totals[k]);
 for(const k of Object.keys(cash) as (keyof typeof cash)[])cash[k]=r2(cash[k]);
 return {trades,currencies:[...new Set(trades.map(t=>t.accountCurrency))].sort(),period:trades.length?{from:Math.min(...trades.map(t=>t.openTs)),to:Math.max(...trades.map(t=>t.closeTs))}:null,totals,cash,openPositions,rows:data.length};
}
/** Ticket pozice v Tradee: první uzavřená část = Position ID, další části :r1, :r2 … (stejně jako segmenty MT pozic). */
export const t212Ticket=(pid:string,n:number)=>n?`${pid}:r${n}`:pid;
/** Rozdělení na nové a duplicitní podle již uložených částí (Position ID + čas uzavření ± 1 s); nové dostanou volné tickety. */
export function planImport(trades:T212Trade[],existing:{ticket:string;close_ts:number}[]){
 const have=new Map<string,{n:number;close:number}[]>();
 for(const e of existing){const [base,rest]=String(e.ticket).split(':r');const l=have.get(base)||[];l.push({n:rest?Number(rest):0,close:Number(e.close_ts)});have.set(base,l)}
 const fresh:(T212Trade&{ticket:string})[]=[],dup:T212Trade[]=[];
 for(const t of trades){
  const l=have.get(t.positionId)||[];
  if(l.some(x=>Math.abs(x.close-t.closeTs)<=1000)){dup.push(t);continue}
  let n=0;while(l.some(x=>x.n===n))n++;
  l.push({n,close:t.closeTs});have.set(t.positionId,l);
  fresh.push({...t,ticket:t212Ticket(t.positionId,n)});
 }
 return {fresh,dup};
}
/** Obchod → řádek mt_positions (+ spread_cost) a průběh pro detail v deníku. */
export function t212Position(accountId:string,t:T212Trade&{ticket:string}){
 const position={id:accountId+':'+t.ticket,account_id:accountId,ticket:t.ticket,symbol:t.symbol.slice(0,32),side:t.side,status:'closed' as const,open_ts:t.openTs,close_ts:t.closeTs,open_price:t.entry,close_price_avg:t.exit,volume_max:t.units,
  sl_initial:t.slInitial,tp_initial:t.tpInitial,sl_last:t.slLast,tp_last:t.tpLast,profit:t.result,commission:0,swap:r2(t.overnight+t.dividend),fee:t.fxFee,net:t.total,magic:0,comment:t.instrument.slice(0,64),tags:'',
  open_reason:t.openReason??'',close_reason:t.exitReason,mfe_money:null,mae_money:null,mfe_price:null,mae_price:null,mfe_partial:0,spread_entry:null,slippage_points:null,
  risk_money:t.riskMoney,risk_pct:null,rr_planned:t.rrPlanned,r_result:t.r,spread_cost:t.spread};
 const changes=[{ts:t.openTs,kind:'open',old_value:null,new_value:t.entry,price:t.entry,volume:t.units,reason:t.openReason},
  ...t.slChanges.map(c=>({ts:c.ts,kind:'sl',old_value:c.old,new_value:c.new,price:null,volume:null,reason:null})),
  ...t.tpChanges.map(c=>({ts:c.ts,kind:'tp',old_value:c.old,new_value:c.new,price:null,volume:null,reason:null})),
  {ts:t.closeTs,kind:t.part<t.parts-1?'partial_close':'close',old_value:null,new_value:null,price:t.exit,volume:t.units,reason:t.exitReason}].sort((a,b)=>a.ts-b.ts);
 return {position,changes};
}
