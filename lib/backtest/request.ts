// Validace požadavku na backtest a plán vs. realita (čisté funkce, testy scripts/check-backtest-context.mjs).
import type {StrategyRules} from './rules.ts';
import {normalizeRules} from './rules.ts';
import type {BtTf} from './engine.ts';

export const MAX_MARKETS=30,MAX_RUNS=50,MAX_TRADES_STORED=20000,MAX_EQUITY_POINTS=5000;
export const MAX_SPAN_DAYS:Record<BtTf,number>={H1:730,D1:25*366};
export const MIN_CAPITAL=100,MAX_CAPITAL=1e9;
const DAY=86400000;
export type RunRequest={strategyId:string;markets:string[];tf:BtTf;from:number;to:number;capital:number;riskPct:number;rules:StrategyRules|null};

// čas jako ms (číslo) nebo ISO řetězec; 'YYYY-MM-DD' u `to` znamená celý den včetně
function parseTime(v:unknown,name:string,endOfDay:boolean):number{
 if(typeof v==='number'&&Number.isFinite(v))return v;
 if(typeof v==='string'&&v.trim()){const t=Date.parse(v);if(Number.isFinite(t))return endOfDay&&/^\d{4}-\d{2}-\d{2}$/.test(v.trim())?t+DAY:t}
 throw new Error(`Neplatné datum „${name}“.`);
}
export function parseRunRequest(raw:unknown,known:Set<string>,now:number):RunRequest{
 const b=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>;
 if(typeof b.strategyId!=='string'||!b.strategyId)throw new Error('Chybí strategie.');
 if(!Array.isArray(b.markets)||!b.markets.length)throw new Error('Vyber alespoň jeden trh.');
 const markets=[...new Set(b.markets.map(String))];
 if(markets.length>MAX_MARKETS)throw new Error(`Nejvýš ${MAX_MARKETS} trhů najednou.`);
 const bad=markets.find(m=>!known.has(m));if(bad)throw new Error(`Neznámý trh „${bad}“.`);
 if(b.tf!=='H1'&&b.tf!=='D1')throw new Error('Časový rámec musí být H1 nebo D1.');
 const tf=b.tf as BtTf,from=parseTime(b.from,'od',false),to=Math.min(parseTime(b.to,'do',true),now);
 if(!(to>from))throw new Error('Období „od“ musí být před „do“ (a před dneškem).');
 if(to-from<DAY)throw new Error('Období musí mít alespoň jeden den.');
 if(to-from>MAX_SPAN_DAYS[tf]*DAY)throw new Error(tf==='H1'?'H1 lze testovat nejvýš 2 roky.':'D1 lze testovat nejvýš 25 let.');
 const capital=b.capital===undefined?10000:Number(b.capital),riskPct=b.riskPct===undefined?NaN:Number(b.riskPct);
 if(!Number.isFinite(capital)||capital<MIN_CAPITAL||capital>MAX_CAPITAL)throw new Error(`Kapitál musí být ${MIN_CAPITAL} až ${MAX_CAPITAL.toLocaleString('cs-CZ')}.`);
 if(b.riskPct!==undefined&&(!Number.isFinite(riskPct)||riskPct<=0||riskPct>100))throw new Error('Riziko musí být větší než 0 a nejvýš 100 %.');
 const rules=b.rules===undefined||b.rules===null?null:normalizeRules(b.rules);
 return {strategyId:b.strategyId,markets,tf,from,to,capital,riskPct:Number.isFinite(riskPct)?riskPct:NaN,rules};
}

// kolik svíček před `from` načíst, aby se indikátory zahřály: nejdelší perioda × 3 + 50 (ATR 14 se vždy počítá)
export function warmupBars(r:StrategyRules):number{
 let m=14;
 for(const c of r.entry){
  if('period' in c)m=Math.max(m,c.period+(c.type==='atr'?14:0));
  if(c.type==='ma_cross')m=Math.max(m,c.fast,c.slow);
  if(c.type==='change')m=Math.max(m,c.bars);
 }
 return m*3+50;
}
// kalendářní rezerva: H1 u akcií má ~32 svíček týdně (6× řidší než 24/7), D1 ~5/7 dne
export const warmupMs=(r:StrategyRules,tf:BtTf)=>warmupBars(r)*(tf==='H1'?3600000*6:DAY*1.6);

// ---- plán vs. realita
export type PlanTrade={id:string;closeTs:number;instrument:string|null;pnl:number;r:number|null};
export type PlanVsReality={trades:number;wins:number;winRate:number|null;avgR:number|null;totalR:number;pnl:number;withR:number;violations:number;tradesWithViolations:number;currency:string};
export function planVsReality(trades:PlanTrade[],reviews:Record<string,{strategyId:string|null}|undefined>,violations:Record<string,unknown[]|undefined>,strategyId:string,from:number,to:number,currency:string):PlanVsReality{
 const mine=trades.filter(t=>t.closeTs>=from&&t.closeTs<to&&reviews[t.id]?.strategyId===strategyId);
 const wins=mine.filter(t=>t.pnl>0).length,rs=mine.filter(t=>t.r!==null&&Number.isFinite(t.r)).map(t=>t.r as number);
 const totalR=Math.round(rs.reduce((s,x)=>s+x,0)*100)/100,vio=mine.map(t=>violations[t.id]?.length||0);
 return {trades:mine.length,wins,winRate:mine.length?Math.round(1000*wins/mine.length)/10:null,avgR:rs.length?Math.round(100*totalR/rs.length)/100:null,totalR,
  pnl:Math.round(mine.reduce((s,t)=>s+t.pnl,0)*100)/100,withR:rs.length,violations:vio.reduce((s,x)=>s+x,0),tradesWithViolations:vio.filter(x=>x>0).length,currency};
}

// řidší křivka pro uložení/odpověď: zachová první a poslední bod
export function thin<T>(a:T[],max:number):T[]{
 if(a.length<=max)return a;
 const out:T[]=[],step=(a.length-1)/(max-1);
 for(let i=0;i<max;i++)out.push(a[Math.round(i*step)]);
 return out;
}
