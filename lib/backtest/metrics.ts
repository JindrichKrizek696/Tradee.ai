// Souhrn výsledků backtestu (čisté funkce, testy scripts/check-backtest.mjs).
import type {BacktestTrade,EquityPoint} from './engine.ts';
const r2=(n:number)=>Math.round(n*100)/100,r4=(n:number)=>Math.round(n*10000)/10000;
export type BacktestSummary={
 trades:number;wins:number;losses:number;winRate:number|null; // win = pnl > 0, loss = pnl < 0; winRate v %
 netPnl:number;netPct:number;finalEquity:number; // netPct = čistý P&L v % počátečního kapitálu
 avgR:number|null;totalR:number;expectancy:number|null; // expectancy = průměrný P&L na obchod v měně účtu (průměrné R = expectancy v R)
 profitFactor:number|null; // hrubý zisk / hrubá ztráta; null = žádná ztráta (nebo žádný obchod)
 avgWin:number|null;avgLoss:number|null;
 maxDrawdown:number;maxDrawdownPct:number; // z equity po uzavřených obchodech, od vrcholu (včetně počátečního kapitálu); v % z vrcholu
 longestLosingStreak:number;
};
export type DrawdownPoint={t:number;equity:number;dd:number;ddPct:number}; // dd ≤ 0 v měně, ddPct ≤ 0 v %
// equity → drawdown od průběžného vrcholu (pro graf)
export function drawdownSeries(equity:EquityPoint[]):DrawdownPoint[]{
 let peak=-Infinity;
 return equity.map(p=>{peak=Math.max(peak,p.equity);const dd=p.equity-peak;return {t:p.t,equity:p.equity,dd:r2(dd),ddPct:peak>0?r2(100*dd/peak):0}});
}
export function metrics(trades:BacktestTrade[],equity:EquityPoint[],capital:number):BacktestSummary{
 const n=trades.length,wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0);
 const gw=wins.reduce((s,t)=>s+t.pnl,0),gl=-losses.reduce((s,t)=>s+t.pnl,0),net=trades.reduce((s,t)=>s+t.pnl,0),totalR=trades.reduce((s,t)=>s+t.r,0);
 let streak=0,longest=0;for(const t of trades){if(t.pnl<0){streak++;longest=Math.max(longest,streak)}else streak=0}
 let maxDd=0,maxDdPct=0;for(const p of drawdownSeries([{t:0,equity:capital},...equity])){maxDd=Math.min(maxDd,p.dd);maxDdPct=Math.min(maxDdPct,p.ddPct)}
 return {
  trades:n,wins:wins.length,losses:losses.length,winRate:n?r2(100*wins.length/n):null,
  netPnl:r2(net),netPct:capital>0?r2(100*net/capital):0,finalEquity:r2(capital+net),
  avgR:n?r4(totalR/n):null,totalR:r4(totalR),expectancy:n?r2(net/n):null,
  profitFactor:gl>0?r2(gw/gl):null,avgWin:wins.length?r2(gw/wins.length):null,avgLoss:losses.length?r2(-gl/losses.length):null,
  maxDrawdown:r2(-maxDd),maxDrawdownPct:r2(-maxDdPct),longestLosingStreak:longest,
 };
}
