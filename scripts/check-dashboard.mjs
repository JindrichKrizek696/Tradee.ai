// Kontrola výpočtů dashboardu bez prohlížeče: node --experimental-strip-types scripts/check-dashboard.mjs
import {readFileSync} from 'node:fs';
import {marketScore,instruments} from '../lib/markets.ts';
import {kpis,dataHealth,recentChanges,upcomingEvents,scoreSeries,greeting,vocative,bullishTrail} from '../lib/dashboard.ts';
const read=f=>JSON.parse(readFileSync(new URL('../data/'+f,import.meta.url),'utf8'));
const data=read('fundamentals.json'),core=read('score-market.json'),expanded=read('expanded-market.json'),history=read('score-history.json');
const market={...core,prices:{...core.prices,...expanded.prices},legacy:expanded.legacy,refresh:{attemptedAt:expanded.refresh.attemptedAt,issues:[...core.refresh.issues,...expanded.refresh.issues]}};
const now=Date.now();
const rows=instruments.map(i=>({...i,r:marketScore(data,market,i.id,now)}));
const k=kpis(rows,{'EUR/USD':'green','USD/CHF':'red','AAPL':'orange'});
console.log('kpis',{...k,strongest:k.strongest&&[k.strongest.id,k.strongest.r.score]});
console.log('bullishTrail',bullishTrail(history));
console.log('health',dataHealth(data,market,now));
console.log('changes',recentChanges(history,3));
console.log('events',upcomingEvents(data,now,3).map(e=>[e.at,e.currency,e.title,e.importance]));
console.log('series EUR/USD 3m',scoreSeries(history,'EUR/USD','score-v2.2','3m',now).length,'all',scoreSeries(history,'EUR/USD','score-v2.2','all',now).length);
console.log('greeting',greeting(new Date(now)),vocative('Jindřich Křížek'),vocative('Seedy'),vocative('Dan'),vocative('Marek'));
const bad=[k.bullish+k.bearish>rows.length,k.freshness<0||k.freshness>100,k.strongest&&rows.some(r=>r.r.score!==null&&Math.abs(r.r.score)>Math.abs(k.strongest.r.score))].filter(Boolean);
console.log(bad.length?'CHECK FAILED':'CHECK OK');
