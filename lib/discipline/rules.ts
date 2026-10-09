// Disciplína: definice automatických pravidel a jejich vyhodnocení. Čisté funkce bez DB – testy scripts/check-discipline.mjs.
export type RuleId='sl_required'|'max_risk'|'max_trades_day'|'stop_after_losses'|'max_daily_loss'|'no_early_close'|'no_sl_widen'|'no_news';
export type RuleDef={id:RuleId;label:string;unit:'%'|'×'|null;def:{on:boolean;value:number|null};min?:number;max?:number;needsReason:boolean;help:string};
export const RULES:RuleDef[]=[
 {id:'sl_required',label:'Vždy SL',unit:null,def:{on:true,value:null},needsReason:false,help:'Obchod musí mít stop loss nastavený do 2 minut od vstupu.'},
 {id:'max_risk',label:'Max. riziko na obchod',unit:'%',def:{on:true,value:1},min:0.1,max:20,needsReason:false,help:'Riziko obchodu (vzdálenost SL × objem) nesmí překročit tento podíl zůstatku.'},
 {id:'max_trades_day',label:'Max. obchodů za den',unit:'×',def:{on:true,value:3},min:1,max:50,needsReason:false,help:'Počet obchodů otevřených za pražský den na jednom účtu; porušením je obchod, který limit překročil.'},
 {id:'stop_after_losses',label:'Stop po ztrátách v řadě',unit:'×',def:{on:true,value:2},min:1,max:20,needsReason:false,help:'Po tomto počtu uzavřených ztrátových obchodů v řadě už ten den neotevírat další.'},
 {id:'max_daily_loss',label:'Max. denní ztráta',unit:'%',def:{on:true,value:2},min:0.1,max:50,needsReason:false,help:'Po dosažení této ztráty (v % zůstatku na začátku dne) už ten den neotevírat další obchod.'},
 {id:'no_early_close',label:'Nezavírat předčasně',unit:null,def:{on:true,value:null},needsReason:true,help:'Pozice se SL nebo TP se nezavírá ručně dřív, než ji vyřídí SL či TP. Vyžaduje zdůvodnění.'},
 {id:'no_sl_widen',label:'Neposouvat SL proti sobě',unit:null,def:{on:true,value:null},needsReason:true,help:'Stop loss se nesmí posunout dál od vstupu (buy níž, sell výš). Vyžaduje zdůvodnění.'},
 {id:'no_news',label:'Neobchodovat kolem zpráv',unit:null,def:{on:false,value:null},needsReason:false,help:'Žádný vstup do 15 minut před ani po zprávě s vysokým dopadem v měně páru.'},
];
export type RuleSettings=Record<RuleId,{on:boolean;value:number|null}>;
export function normalizeSettings(raw:unknown):RuleSettings{
 const o=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
 const out={} as RuleSettings;
 for(const r of RULES){
  const v=Object.hasOwn(o,r.id)?o[r.id] as {on?:unknown;value?:unknown}|null:null;
  const src=v&&typeof v==='object'?v:{};
  const on=typeof src.on==='boolean'?src.on:r.def.on;
  let value:number|null=null;
  if(r.def.value!==null){const n=typeof src.value==='number'&&Number.isFinite(src.value)?src.value:r.def.value;value=Math.min(r.max!,Math.max(r.min!,n))}
  out[r.id]={on,value};
 }
 return out;
}
export type EvalTrade={id:string;accountId:string;side:'buy'|'sell';status:'open'|'closed';openTs:number;closeTs:number|null;openPrice:number;slInitial:number|null;tpInitial:number|null;riskPct:number|null;net:number;closeReason:string|null;balanceStart:number|null;slChanges:{ts:number;old:number|null;new:number|null}[];currencies:string[]};
export type Violation={rule:RuleId;detail:Record<string,unknown>;needsReason:boolean};
export const NEWS_WINDOW_MS=15*60*1000;
// 6písmenné FX páry (i s příponou .m, #, -ecn) → dvě měny; ostatní symboly → []
export function currenciesOf(symbol:string):string[]{
 const base=String(symbol||'').trim().toUpperCase().replace(/^[#.]+/,'').split(/[._+-]/)[0];
 const m=base.match(/^([A-Z]{3})([A-Z]{3})$/);return m?[m[1],m[2]]:[];
}
export function evaluate(t:EvalTrade,day:EvalTrade[],s:RuleSettings,news:{at:number;currencies:string[]}[]):Violation[]{
 const out:Violation[]=[];const need=(id:RuleId)=>RULES.find(r=>r.id===id)!.needsReason;
 const add=(rule:RuleId,detail:Record<string,unknown>={})=>out.push({rule,detail,needsReason:need(rule)});
 const earlier=day.filter(x=>x.status==='closed'&&x.closeTs!==null&&x.closeTs<t.openTs);
 if(s.sl_required.on&&t.slInitial===null)add('sl_required');
 if(s.max_risk.on&&t.riskPct!==null&&s.max_risk.value!==null&&t.riskPct>s.max_risk.value)add('max_risk',{riskPct:t.riskPct,limit:s.max_risk.value});
 if(s.max_trades_day.on&&s.max_trades_day.value!==null){const n=day.findIndex(x=>x.id===t.id)+1;if(n>s.max_trades_day.value)add('max_trades_day',{n,limit:s.max_trades_day.value})}
 if(s.stop_after_losses.on&&s.stop_after_losses.value!==null){
  const seq=[...earlier].sort((a,b)=>a.closeTs!-b.closeTs!);let losses=0;
  for(let i=seq.length-1;i>=0&&seq[i].net<0;i--)losses++;
  if(losses>=s.stop_after_losses.value)add('stop_after_losses',{losses,limit:s.stop_after_losses.value});
 }
 if(s.max_daily_loss.on&&s.max_daily_loss.value!==null&&t.balanceStart!==null&&t.balanceStart>0){
  const sum=earlier.reduce((a,x)=>a+x.net,0);const lossPct=-sum/t.balanceStart*100;
  if(lossPct>=s.max_daily_loss.value)add('max_daily_loss',{lossPct,limit:s.max_daily_loss.value});
 }
 if(s.no_early_close.on&&t.status==='closed'&&!['sl','tp','so'].includes(t.closeReason||'')&&(t.slInitial!==null||t.tpInitial!==null||t.slChanges.some(c=>c.new!==null)))add('no_early_close',{closeReason:t.closeReason});
 if(s.no_sl_widen.on){
  const c=t.slChanges.find(c=>c.old!==null&&c.new!==null&&(t.side==='buy'?c.new<c.old:c.new>c.old));
  if(c)add('no_sl_widen',{from:c.old,to:c.new,ts:c.ts});
 }
 if(s.no_news.on){const n=news.find(n=>Math.abs(n.at-t.openTs)<=NEWS_WINDOW_MS&&n.currencies.some(c=>t.currencies.includes(c)));if(n)add('no_news',{at:n.at})}
 return out;
}
