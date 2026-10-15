// Pracovní vlákno pro scripts/lab-sweep.mjs: připraví trhy ze stejných dat a počítá zadané části sweepu (grid / jedno náhodné opakování).
import {parentPort,workerData} from 'node:worker_threads';
import {prepareMarket,buildContext,gridRows,shuffleBest} from '../lib/lab/sweep.ts';
import {cotForInstrument} from '../lib/lab/study.ts';
const {bars,cot,markets,to}=workerData;
const ctx=buildContext(markets.filter(m=>bars[m]?.length>250).map(m=>prepareMarket(m,bars[m],cotForInstrument(cot,m))),{to});
let n=0;const tick=()=>{if(++n%250===0){parentPort.postMessage({progress:n});n=0}};
parentPort.on('message',t=>{
 if(t.kind==='grid')parentPort.postMessage({id:t.id,rows:gridRows(ctx,t.idx,tick),done:n});
 else parentPort.postMessage({id:t.id,best:shuffleBest(ctx,t.seed,t.idx,tick),done:n});
 n=0;
});
parentPort.postMessage({ready:true});
