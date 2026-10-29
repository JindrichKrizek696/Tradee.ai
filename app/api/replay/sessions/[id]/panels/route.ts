// Replay: datové panely v čase simulačních hodin seance (čas bere server ze seance, ne z dotazu) – skóre (nejbližší snímek ≤ hodiny),
// COT podle data zveřejnění, kalendář (termín / odhad / skutečnost tak, jak byly známé) a makro (poslední vydané hodnoty).
import history from '@/data/score-history.json';
import scoreMarket from '@/data/score-market.json';
import {identity,db,failed} from '@/lib/server';
import {scoresAt} from '@/lib/score/pit-api';
import {histBetween,revisionsFor} from '@/lib/calendar-hist-store';
import {getSession} from '@/lib/replay/store';
import {cotAt,calendarAt,macroAt,currenciesOf} from '@/lib/replay/panels';
type Ctx={params:Promise<{id:string}>};
const headers={'Cache-Control':'private, no-store'};
type CotRow={date:string;openInterest:number;groups:Record<string,{long:number;short:number;net:number}>};
export async function GET(req:Request,{params}:Ctx){try{const u=await identity(req),{id}=await params;if(!/^rp_[a-z0-9]{1,30}$/.test(id))return Response.json({error:'Seance nenalezena.'},{status:404,headers});
 const d=db(),s=await getSession(d,u.id,id);if(!s)return Response.json({error:'Seance nenalezena.'},{status:404,headers});
 const clock=s.clock,cur=currenciesOf(s.symbols);
 const score=await scoresAt(d,history as never,clock,s.symbols).then(r=>({source:r.source,items:Object.fromEntries(Object.entries(r.snapshots).map(([m,x])=>[m,{score:x.score,at:x.at,coverage:x.coverage,reconstructed:x.reconstructed,method:x.method}]))})).catch(e=>{console.error('replay score',e);return null});
 const cotSrc=(scoreMarket as unknown as {cot:Record<string,{history:CotRow[];isProxy?:boolean}>}).cot||{};
 const cot=cur.map(c=>cotSrc[c]&&!cotSrc[c].isProxy?cotAt(c,cotSrc[c].history,clock):null).filter(Boolean);
 let calendar=null,macro=null;
 try{
  const ev=await histBetween(d,clock-120*86400000,clock+72*3600000,8000),ch=await revisionsFor(d,ev.map(e=>e.id));
  calendar=calendarAt(ev,ch,clock,cur);macro=macroAt(ev,ch,clock,cur);
 }catch(e){console.error('replay calendar',e)}
 return Response.json({clock,score,cot,calendar,macro},{headers})}catch(e){return failed(e)}}
