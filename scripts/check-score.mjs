import assert from 'node:assert/strict';
import fs from 'node:fs';
import {scoreV2,cotStats,seasonalStats} from '../lib/score-engine.ts';
const data=JSON.parse(fs.readFileSync(new URL('../data/fundamentals.json',import.meta.url))),market=JSON.parse(fs.readFileSync(new URL('../data/score-market.json',import.meta.url)));
const now=Date.now(),cc=Object.keys(data.currencies);
for(const a of cc)for(const b of cc){if(a===b)continue;const x=scoreV2(data,market,a+'/'+b,now),y=scoreV2(data,market,b+'/'+a,now);assert.equal(x.coverage,y.coverage);assert.ok(Math.abs(x.known+y.known)<.0001,'Inverse score');assert.ok(Math.abs(x.known)<=100);assert.equal(x.parts.reduce((s,p)=>s+p.weight,0),100);assert.ok(x.bounds[0]<=x.known&&x.bounds[1]>=x.known);}
const base=scoreV2(data,market,'EUR/USD',now);assert.equal(base.coverage,100);assert.notEqual(base.score,null);
const stale=scoreV2(data,market,'EUR/USD',now+40*86400000);assert.equal(stale.score,null);assert.equal(stale.coverage,0);
const missing=structuredClone(market);delete missing.cot.EUR;const partial=scoreV2(data,missing,'EUR/USD',now);assert.equal(partial.coverage,85);assert.equal(partial.parts.find(p=>p.id==='cot').contribution,null);assert.ok(Math.abs(partial.known-(base.known-base.parts.find(p=>p.id==='cot').contribution))<1e-8,'No reweighting');
const badMacro=structuredClone(data);badMacro.currencies.EUR.factors.guidance.value=null;assert.equal(scoreV2(badMacro,market,'EUR/USD',now).score,null);
const future=structuredClone(market);future.cot.EUR.checkedAt=new Date(now+86400000).toISOString();assert.equal(scoreV2(data,future,'EUR/USD',now).coverage,85);
for(const c of cc){const cot=cotStats(market.cot[c]);assert.ok(cot&&cot.sample>=26);assert.equal(cot.group.net,cot.group.long-cot.group.short);assert.ok(cot.percentile>=0&&cot.percentile<=100);}
for(const p of Object.values(market.prices))for(let m=1;m<=12;m++){const s=seasonalStats(p,m);assert.equal(s.n,10);assert.ok(s.years.every(y=>y.year<new Date(now).getUTCFullYear()));assert.ok(s.years.every(y=>y.path.length===31));}
assert.throws(()=>scoreV2(data,market,'EUR/EUR',now));assert.throws(()=>scoreV2(data,market,'EUR/ABC',now));
console.log('PASS: 56 inverse pairs, ranges, missing/stale/future data, 8 COT series, 768 seasonal samples.');
console.log(JSON.stringify({eurusd:base.score,coverage:base.coverage,cot:base.parts.find(p=>p.id==='cot').contribution,priceDate:base.price.asOf}));
