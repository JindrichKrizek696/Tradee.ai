import {identity,db,failed,sameOrigin} from '@/lib/server';
import {viewAs} from '@/lib/admin/http';
import {loadBars} from '@/lib/bars/query';
import {instruments} from '@/lib/markets';
import {runBacktest,BAR_MS,type BtBar} from '@/lib/backtest/engine';
import {rulesIssues} from '@/lib/backtest/rules';
import {metrics} from '@/lib/backtest/metrics';
import {buildContext,newsItems,type HistoryData,type MarketCot} from '@/lib/backtest/context';
import {parseRunRequest,warmupMs,planVsReality,thin,MAX_TRADES_STORED,MAX_EQUITY_POINTS} from '@/lib/backtest/request';
import {ownsStrategy,getRules,listRuns,saveRun} from '@/lib/backtest/store';
import {listJournal} from '@/lib/journal/store';
import {listReviews,listViolations} from '@/lib/discipline/store';
import history from '@/data/score-history.json';
import scoreMarket from '@/data/score-market.json';
import calendarAuto from '@/data/calendar.json';
import fundamentals from '@/data/fundamentals.json';
import type {AutoEvent,CuratedEvent} from '@/lib/calendar';
const headers={'Cache-Control':'private, no-store'},known=new Set(instruments.map(i=>i.id));
export async function GET(req:Request){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 const s=new URL(req.url).searchParams.get('strategy');
 return Response.json({runs:await listRuns(db(),v.userId,s||undefined)},{headers})}catch(e){return failed(e)}}
// Spustí backtest v jednom requestu, uloží běh (max 50 na uživatele) a vrátí ho i s plánem vs. realitou.
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req),d=db();
 const q=parseRunRequest(await req.json().catch(()=>null),known,Date.now());
 if(!await ownsStrategy(d,u.id,q.strategyId))return Response.json({error:'Strategie nenalezena.'},{status:404,headers});
 const rules0=q.rules??(await getRules(d,u.id,q.strategyId)).rules;
 const rules={...rules0,sizing:{...rules0.sizing,capital:q.capital,riskPct:Number.isFinite(q.riskPct)?q.riskPct:rules0.sizing.riskPct}};
 const issues=rulesIssues(rules);if(issues.length)throw Error('Pravidla nejsou v pořádku: '+issues.join(' '));
 const start=q.from-warmupMs(rules,q.tf),markets:{instrument:string;bars:BtBar[]}[]=[];
 // svíčky po dávkách (každý dotaz = jedno spojení)
 for(let i=0;i<q.markets.length;i+=6)markets.push(...await Promise.all(q.markets.slice(i,i+6).map(async instrument=>({instrument,bars:await loadBars(d,instrument,q.tf,start,q.to)}))));
 const context=buildContext({history:history as unknown as HistoryData,market:scoreMarket as unknown as MarketCot,news:newsItems(calendarAuto.events as AutoEvent[],fundamentals.events as CuratedEvent[],fundamentals.sources)});
 const res=runBacktest({rules,markets,tf:q.tf,from:q.from,to:q.to,capital:q.capital,context});
 const summary=metrics(res.trades,res.equity,q.capital),warnings=[...res.warnings];
 const empty=markets.filter(m=>!m.bars.some(b=>b.t>=q.from&&b.t<q.to)).map(m=>m.instrument);
 if(empty.length&&empty.length===markets.length)warnings.push('V archivu nejsou svíčky pro zvolené trhy a období.');
 const truncated=res.trades.length>MAX_TRADES_STORED;
 if(truncated)warnings.push(`Obchodů je ${res.trades.length}; v seznamu je posledních ${MAX_TRADES_STORED}, souhrn a křivka počítají všechny.`);
 // plán vs. realita: skutečné obchody se strategií (trade_reviews.strategy_id) zavřené ve stejném období + porušení pravidel
 const [j,reviews,violations]=await Promise.all([listJournal(d,u.id),listReviews(d,u.id),listViolations(d,u.id)]);
 const plan=planVsReality(j.trades,reviews,violations,q.strategyId,q.from,q.to,j.currency);
 const result={trades:truncated?res.trades.slice(-MAX_TRADES_STORED):res.trades,truncated,equity:thin(res.equity,MAX_EQUITY_POINTS),perMarket:res.perMarket,coverage:res.coverage,warnings,plan};
 const params={markets:q.markets,tf:q.tf,from:q.from,to:q.to,capital:q.capital,riskPct:rules.sizing.riskPct,barMs:BAR_MS[q.tf],rules};
 return Response.json({run:await saveRun(d,u.id,q.strategyId,params,summary,result)},{headers})}catch(e){return failed(e)}}
