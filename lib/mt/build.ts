// Skládání pozic z MT událostí. Čistá a deterministická funkce: stejné události (v libovolném pořadí, i duplicitní) → stejný výsledek.
import type {MtEvent,DealEvent,Side} from './protocol.ts';
export const POSITION_COLUMNS=['id','account_id','ticket','symbol','side','status','open_ts','close_ts','open_price','close_price_avg','volume_max','sl_initial','tp_initial','sl_last','tp_last','profit','commission','swap','fee','net','magic','comment','tags','open_reason','close_reason','mfe_money','mae_money','mfe_price','mae_price','mfe_partial','spread_entry','slippage_points','risk_money','risk_pct','rr_planned','r_result'] as const;
export type PositionRow={id:string;account_id:string;ticket:string;symbol:string;side:Side;status:'open'|'closed';open_ts:number;close_ts:number|null;open_price:number;close_price_avg:number|null;volume_max:number;sl_initial:number|null;tp_initial:number|null;sl_last:number|null;tp_last:number|null;profit:number;commission:number;swap:number;fee:number;net:number;magic:number;comment:string;tags:string;open_reason:string;close_reason:string|null;mfe_money:number|null;mae_money:number|null;mfe_price:number|null;mae_price:number|null;mfe_partial:number;spread_entry:number|null;slippage_points:number|null;risk_money:number|null;risk_pct:number|null;rr_planned:number|null;r_result:number|null};
export type ChangeRow={ts:number;kind:'open'|'add'|'partial_close'|'close'|'sl'|'tp';old_value:number|null;new_value:number|null;price:number|null;volume:number|null;reason:string|null};
export type Built={position:PositionRow;changes:ChangeRow[]};
const EPS=1e-9,GAP=600_000,INITIAL_SL_WINDOW=10_000;
const r2=(n:number)=>Math.round(n*100)/100;
const lvl=(n:number)=>n>0?n:null; // MT: SL/TP 0 = nenastaveno
export function extractTags(comment:string){return [...new Set((comment.match(/#[0-9A-Za-z_\u00C0-\u024F-]{2,30}/g)||[]).map(t=>t.slice(1).toLowerCase()))]}
// Ruční údaje (tagy, poznámka, screenshoty) zaniklého segmentu pozice → segment se stejným otevřením, jinak první segment.
export function carryTarget(oldOpenTs:number,built:{id:string;open_ts:number}[]):string|null{
 if(!built.length)return null;
 return (built.find(b=>b.open_ts===oldOpenTs)||built[0]).id;
}
// Sloučení ručních údajů zaniklého segmentu do cílového: tagy sjednotit (max 10, vejdou se do 400 znaků), poznámky spojit.
export function mergeManual(target:{tags_manual:string;note:string|null},from:{tags_manual:string;note:string|null}):{tags_manual:string;note:string|null}{
 const tags=[...new Set([...target.tags_manual.split(','),...from.tags_manual.split(',')].map(t=>t.trim()).filter(Boolean))].slice(0,10).join(',');
 const a=(target.note||'').trim()?target.note as string:'',b=(from.note||'').trim()?(from.note as string):'';
 const note=a&&b?(a.includes(b.trim())?a:a+'\n\n'+b):a||b||null;
 return {tags_manual:tags,note};
}

type Seg={row:PositionRow;changes:ChangeRow[];volume:number;inVol:number;inValue:number;outVol:number;outValue:number;first:DealEvent;initVol:number;lastStateTs:number|null};
function start(accountId:string,ticket:string,d:DealEvent,side:Side,volume:number):Seg{
 const row:PositionRow={id:accountId+':'+ticket,account_id:accountId,ticket,symbol:d.symbol,side,status:'open',open_ts:d.ts,close_ts:null,open_price:d.price,close_price_avg:null,volume_max:volume,sl_initial:lvl(d.sl),tp_initial:lvl(d.tp),sl_last:lvl(d.sl),tp_last:lvl(d.tp),profit:0,commission:0,swap:0,fee:0,net:0,magic:d.magic,comment:d.comment,tags:'',open_reason:d.reason,close_reason:null,mfe_money:null,mae_money:null,mfe_price:null,mae_price:null,mfe_partial:0,spread_entry:d.spread>0?d.spread:null,slippage_points:null,risk_money:null,risk_pct:null,rr_planned:null,r_result:null};
 if(d.priceRequested>0&&d.point>0)row.slippage_points=r2((side==='buy'?d.price-d.priceRequested:d.priceRequested-d.price)/d.point);
 return {row,changes:[{ts:d.ts,kind:'open',old_value:null,new_value:d.price,price:d.price,volume:Math.round(volume*1e8)/1e8,reason:d.reason}],volume,inVol:volume,inValue:volume*d.price,outVol:0,outValue:0,first:d,initVol:volume,lastStateTs:null};
}
const money=(s:Seg,d:DealEvent)=>{s.row.profit+=d.profit;s.row.commission+=d.commission;s.row.swap+=d.swap;s.row.fee+=d.fee};
function close(s:Seg,d:DealEvent,vol:number){
 s.outVol+=vol;s.outValue+=vol*d.price;s.volume=Math.max(0,s.volume-vol);
 const done=s.volume<=EPS;
 s.changes.push({ts:d.ts,kind:done?'close':'partial_close',old_value:null,new_value:null,price:d.price,volume:vol,reason:d.reason});
 if(done){s.row.status='closed';s.row.close_ts=d.ts;s.row.close_reason=d.reason}
 return done;
}
function finish(s:Seg):Built{
 const r=s.row,d=s.first;
 r.open_price=s.inVol>0?s.inValue/s.inVol:r.open_price;
 r.close_price_avg=s.outVol>0?s.outValue/s.outVol:null;
 r.volume_max=Math.round(r.volume_max*1e8)/1e8;
 r.profit=r2(r.profit);r.commission=r2(r.commission);r.swap=r2(r.swap);r.fee=r2(r.fee);r.net=r2(r.profit+r.commission+r.swap+r.fee);
 r.tags=extractTags(r.comment).join(',');
 // riziko a plánované R:R od prvního vstupu a počátečního SL/TP
 const lossSide=r.sl_initial!==null&&(r.side==='buy'?r.sl_initial<d.price:r.sl_initial>d.price);
 if(lossSide&&r.sl_initial!==null&&d.tickSize>0&&d.tickValue>0){r.risk_money=r2(Math.abs(d.price-r.sl_initial)/d.tickSize*d.tickValue*s.initVol);if(d.balance>0)r.risk_pct=r2(r.risk_money/d.balance*100)}
 if(lossSide&&r.sl_initial!==null&&r.tp_initial!==null&&Math.abs(d.price-r.sl_initial)>EPS)r.rr_planned=r2(Math.abs(r.tp_initial-d.price)/Math.abs(d.price-r.sl_initial));
 if(r.status==='closed'&&r.risk_money)r.r_result=r2(r.net/r.risk_money);
 if(r.status==='closed'&&r.close_ts!==null&&r.close_ts-(s.lastStateTs??r.open_ts)>GAP)r.mfe_partial=1;
 return {position:r,changes:s.changes};
}
const rank=(e:MtEvent)=>e.type==='deal'?(e.entry==='in'?0:e.entry==='inout'?1:2):e.type==='position_modify'?3:e.type==='position_state'?4:5; // pořadí při stejném čase
export function buildPositions(accountId:string,events:MtEvent[]):Built[]{
 const seen=new Set<string>(),sorted=[...events].filter(e=>!seen.has(e.id)&&seen.add(e.id)).sort((a,b)=>a.ts-b.ts||rank(a)-rank(b)||a.id.localeCompare(b.id,undefined,{numeric:true}));
 const out:Built[]=[];let cur:Seg|null=null,segs=0,pending:Extract<MtEvent,{type:'position_modify'}>[]=[];
 // posun SL/TP (posun hodiny EA) – použije se jako hodnota v čase ts
 const applyMod=(s:Seg,e:Extract<MtEvent,{type:'position_modify'}>,ts:number)=>{
  const r=s.row,sl=lvl(e.slNew),tp=lvl(e.tpNew),price=e.price>0?e.price:null;
  if(sl!==r.sl_last){s.changes.push({ts,kind:'sl',old_value:r.sl_last,new_value:sl,price,volume:null,reason:null});if(r.sl_initial===null&&ts-r.open_ts<=INITIAL_SL_WINDOW)r.sl_initial=sl;r.sl_last=sl}
  if(tp!==r.tp_last){s.changes.push({ts,kind:'tp',old_value:r.tp_last,new_value:tp,price,volume:null,reason:null});if(r.tp_initial===null&&ts-r.open_ts<=INITIAL_SL_WINDOW)r.tp_initial=tp;r.tp_last=tp}
 };
 // modify, který dorazil dřív než otevření (rozdíl hodin): do 10 s před otevřením platí jako v čase otevření
 const begin=(s:Seg,base:string)=>{for(const m of pending)if(m.position===base&&m.ts>=s.row.open_ts-INITIAL_SL_WINDOW)applyMod(s,m,s.row.open_ts);pending=[];return s};
 for(const e of sorted){
  if(e.type==='deal'){
   if(e.dealType!=='trade')continue;
   const base=e.position;
   if(e.entry==='in'){
    if(!cur){cur=begin(start(accountId,segs?`${base}:r${segs}`:base,e,e.side,e.volume),base);segs++}
    else if(e.ts===cur.row.open_ts){cur.volume+=e.volume;cur.inVol+=e.volume;cur.inValue+=e.volume*e.price;cur.initVol+=e.volume;cur.row.volume_max=Math.max(cur.row.volume_max,cur.volume);cur.changes[0].volume=Math.round(cur.initVol*1e8)/1e8} // MT4 řetězec: části původního vstupu
    else{cur.volume+=e.volume;cur.inVol+=e.volume;cur.inValue+=e.volume*e.price;cur.row.volume_max=Math.max(cur.row.volume_max,cur.volume);cur.changes.push({ts:e.ts,kind:'add',old_value:null,new_value:null,price:e.price,volume:e.volume,reason:e.reason})}
    money(cur,e);
   }else if(e.entry==='inout'){
    if(!cur)continue;
    const closing=cur.volume;money(cur,e);close(cur,e,closing);out.push(finish(cur));
    const rest=e.volume-closing;
    if(rest>EPS){cur=begin(start(accountId,`${base}:r${segs++}`,{...e,commission:0,swap:0,fee:0,profit:0},e.side,rest),base)}else cur=null;
   }else{
    if(!cur)continue;
    money(cur,e);
    if(close(cur,e,Math.min(e.volume,cur.volume))){out.push(finish(cur));cur=null}
   }
  }else if(e.type==='position_modify'){
   if(!cur){pending.push(e);continue}
   applyMod(cur,e,e.ts);
  }else if(e.type==='position_state'){
   if(!cur)continue;
   const r=cur.row;
   if(e.ts-(cur.lastStateTs??r.open_ts)>GAP)r.mfe_partial=1;
   cur.lastStateTs=e.ts;
   if(r.mfe_money===null||e.mfeMoney>r.mfe_money){r.mfe_money=r2(e.mfeMoney);r.mfe_price=e.mfePrice}
   if(r.mae_money===null||e.maeMoney<r.mae_money){r.mae_money=r2(e.maeMoney);r.mae_price=e.maePrice}
  }
 }
 if(cur)out.push(finish(cur));
 return out;
}
