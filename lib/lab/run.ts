// Laboratoř · výpočty na serveru (načtení svíček + COT + skóre → studie / test pravidla). Volá se jen za labGate.
import type {Db} from '../mysql.ts';
import {loadBars} from '../bars/query.ts';
import {pairs} from '../score-engine.ts';
import {runBacktest,type BtBar} from '../backtest/engine.ts';
import {metrics} from '../backtest/metrics.ts';
import {thin} from '../backtest/request.ts';
import {runStudy,cotForInstrument,scoreForInstrument,computeSignals,type CotSource,type ScoreSnap,type StudyResult} from './study.ts';
import {labGateFor,toStrategyRules,type LabRule} from './rules.ts';

export const STUDY_SETS:Record<string,{label:string;markets:string[]}>={
 fx:{label:'FX páry (28)',markets:[...pairs]},
 fxc:{label:'FX + komodity',markets:[...pairs,'GC=F','SI=F','CL=F','BZ=F']},
 all:{label:'FX + komodity + indexy',markets:[...pairs,'GC=F','SI=F','CL=F','BZ=F','^GSPC','^NDX']},
};
export const SCORE_METHODS:Record<string,{label:string;methods:string[]|null}>={
 main:{label:'score-v3 + score-v2.2',methods:['score-v3','score-v2.2']},
 v3:{label:'jen score-v3',methods:['score-v3']},
 v22:{label:'jen score-v2.2',methods:['score-v2.2']},
 any:{label:'všechny metody',methods:null},
};
export type StudyParams={set:string;from:string;to:string;methods:string};
const DATE=/^\d{4}-\d{2}-\d{2}$/;
export function parseStudyParams(url:string):StudyParams{
 const q=new URL(url).searchParams,from=q.get('from')||'2015-01-01',to=q.get('to')||'';
 const set=q.get('set')||'fx',methods=q.get('methods')||'main';
 if(!STUDY_SETS[set])throw Error('Neznámá sada trhů.');
 if(!SCORE_METHODS[methods])throw Error('Neznámá metoda skóre.');
 if(!DATE.test(from)||(to&&!DATE.test(to)))throw Error('Datum zadej jako RRRR-MM-DD.');
 if(to&&to<=from)throw Error('Období „od“ musí být před „do“.');
 return {set,from,to,methods};
}
const ms=(s:string,end=false)=>Date.parse(s+'T00:00:00Z')+(end?86400000:0);
async function bars(d:Db,markets:string[],now:number){
 const out:{instrument:string;bars:BtBar[]}[]=[];
 for(let i=0;i<markets.length;i+=6)out.push(...await Promise.all(markets.slice(i,i+6).map(async instrument=>({instrument,bars:(await loadBars(d,instrument,'D1',0,now)).map(b=>({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c}))}))));
 return out;
}
export async function computeStudy(d:Db,p:StudyParams,cot:CotSource,snaps:ScoreSnap[],now=Date.now()):Promise<StudyResult>{
 const markets=STUDY_SETS[p.set].markets,methods=SCORE_METHODS[p.methods].methods;
 const data=await bars(d,markets,now);
 const res=runStudy(data.filter(m=>m.bars.length).map(m=>({instrument:m.instrument,bars:m.bars,cot:cotForInstrument(cot,m.instrument),score:scoreForInstrument(snaps,m.instrument,methods)})),ms(p.from),p.to?ms(p.to,true):now,now);
 const empty=data.filter(m=>!m.bars.length).map(m=>m.instrument);
 if(empty.length)res.notes.push(`Bez svíček v archivu: ${empty.join(', ')}.`);
 return res;
}
export async function testRule(d:Db,r:LabRule,cot:CotSource,snaps:ScoreSnap[],now=Date.now()){
 const data=(await bars(d,r.markets,now)).map(m=>({...m,bars:[...m.bars].sort((a,b)=>a.t-b.t)}));
 const from=ms(r.from),to=r.to?Math.min(ms(r.to,true),now):now;
 const fns=new Map(data.map(m=>[m.instrument,{cot:cotForInstrument(cot,m.instrument),score:scoreForInstrument(snaps,m.instrument,null)}]));
 const res=runBacktest({rules:toStrategyRules(r),markets:data,tf:'D1',from,to,capital:10000,
  gate:(inst,b)=>{const f=fns.get(inst);return labGateFor(r,computeSignals(b,f?.cot??null,f?.score??null))}});
 const summary=metrics(res.trades,res.equity,10000),warnings=[...res.warnings];
 if(r.conds.some(c=>c.type==='score'))warnings.push('Skóre Tradee má uložené snapshoty jen za krátké období – mimo něj podmínka neplatí.');
 if(r.conds.some(c=>c.type==='cot')||r.direction==='cot'){const no=r.markets.filter(m=>!fns.get(m)?.cot);if(no.length)warnings.push(`COT chybí pro: ${no.join(', ')}.`)}
 return {summary,equity:thin(res.equity,1500),perMarket:res.perMarket,warnings,trades:res.trades.slice(-200)};
}
