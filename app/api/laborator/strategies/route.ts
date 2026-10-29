// Laboratoř · Strategie (jen vlastník, lab_strategy_defs / lab_strategy_runs). GET = seznam definic (každá verze = řádek) s posledním
// výsledkem (bez vedlejších efektů), ?id= = jedna verze (JSON text) + poslední výsledek (s diagnostikou a ukázkovými obchody),
// ?bars=<trh>&tf=D1|H1&from=&to= = svíčky z archivu (market_bars) kolem ukázkového obchodu, nejvýš 600 svíček.
// Výpočet běží mimo web (scripts/lab-strategies.mjs na VPS).
// POST (jen z vlastní stránky: sameOrigin + sec-fetch-site): {action:'save',id?,text} = uložit / upravit definici (validace, nová verze
// při změně obsahu), {action:'simulate',id} = „Pustit do simulace“ → agent R01…R40 s neměnnou kopií aktuální verze,
// {action:'delete',id,confirm:'SMAZAT'} = smazat definici a její běhy (agenti R… zůstávají – mají vlastní kopii).
import {db,sameOrigin} from '@/lib/server';
import {labUser,labFailed,labNotFound,LAB_HEADERS} from '@/lib/lab/http';
import {listDefs,getDef,saveDef,deleteDef,latestRuns,getRun} from '@/lib/lab/strat-store';
import {createRuleVariant,listAccounts} from '@/lib/lab/paper-store';
import {refreshSummary} from '@/lib/lab/store';
import {isRuleVariant} from '@/lib/lab/paper';
import {defOutline,parseDefJson} from '@/lib/lab/rules-def';
import {loadBars} from '@/lib/bars/query';
const ID=/^[0-9a-f-]{36}$/,MARKET=/^[A-Za-z0-9^=\/.\-]{1,16}$/,BARS_MAX=600;
const bad=(error:string,errors?:string[])=>Response.json({error,errors},{status:400,headers:LAB_HEADERS});
export async function GET(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;const d=db();
 const q=new URL(req.url).searchParams,id=q.get('id'),mk=q.get('bars');
 if(mk!==null){
  const tf=q.get('tf'),from=Number(q.get('from')),to=Number(q.get('to'));
  if(!MARKET.test(mk)||(tf!=='D1'&&tf!=='H1')||!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return bad('Neplatný dotaz na svíčky.');
  if((to-from)/(tf==='D1'?86400000:3600000)>BARS_MAX*1.6)return bad('Příliš dlouhé období.');
  const rows=await loadBars(d,mk,tf,from,to);
  return Response.json({bars:rows.slice(-BARS_MAX).map(b=>[b.t,b.o,b.h,b.l,b.c])},{headers:LAB_HEADERS});
 }
 if(id!==null){
  if(!ID.test(id))return labNotFound();
  const def=await getDef(d,u.id,id);if(!def)return labNotFound();
  const run=await getRun(d,u.id,id).catch(()=>null);
  return Response.json({def:{id:def.id,name:def.name,version:def.version,text:def.text,errors:def.errors,updated:def.updated,outline:def.def?defOutline(def.def):[]},run},{headers:LAB_HEADERS});
 }
 const [defs,runs,accounts]=await Promise.all([listDefs(d,u.id),latestRuns(d,u.id),listAccounts(d,u.id).catch(()=>[])]);
 const running=accounts.filter(a=>isRuleVariant(a.variant)&&a.rule).map(a=>({variant:a.variant,defId:a.rule!.origin.defId,version:a.rule!.def.version,active:a.active}));
 return Response.json({defs:defs.map(x=>({id:x.id,name:x.name,version:x.version,updated:x.updated,valid:!!x.def,errors:x.errors.length,
  markets:x.def?.markets??[],data:x.def?.data??null,conditions:x.def?.conditions.length??0,variants:x.def?.variants.length??0,run:runs[x.id]??null})),running},{headers:LAB_HEADERS});
}catch(e){return labFailed(e)}}
export async function POST(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;sameOrigin(req);const d=db();
 const site=req.headers.get('sec-fetch-site');if(site&&site!=='same-origin')return labNotFound();
 const b=await req.json().catch(()=>({})) as {action?:unknown;id?:unknown;text?:unknown;confirm?:unknown};
 const id=typeof b.id==='string'&&ID.test(b.id)?b.id:null;
 if(b.action==='save'){
  if(typeof b.text!=='string'||b.text.length>250000)return bad('Chybí text definice (JSON).');
  const v=parseDefJson(b.text);if(!v.ok)return bad('Definice není platná.',v.errors);
  if(b.id!==undefined&&b.id!==null&&!id)return labNotFound();
  try{const r=await saveDef(d,u.id,id,JSON.parse(b.text));return Response.json({ok:true,...r},{headers:LAB_HEADERS})}
  catch(e){const errs=(e as {errors?:string[]}).errors;if(errs)return bad('Definice není platná.',errs);throw e}
 }
 if(!id)return labNotFound();
 if(b.action==='simulate'){
  const def=await getDef(d,u.id,id);if(!def)return labNotFound();
  if(!def.def)return bad('Definice není platná – nejdřív ji oprav.',def.errors);
  const run=await getRun(d,u.id,id).catch(()=>null),cur=run&&run.version===def.version?run:null,base=cur?.result.variants[0];
  const pick=(m:{trades:number;avgR:number|null;pf:number|null;maxDd:number}|undefined)=>m?{trades:m.trades,avgR:m.avgR,pf:m.pf,maxDd:m.maxDd}:null;
  const variant=await createRuleVariant(d,u.id,Date.now(),id,def.def,{runId:cur?.id??null,is:pick(base?.metrics.is),oos:pick(base?.metrics.oos),chance:cur?.result.chance?.median??null,robust:!!base?.robust,at:cur?.created??''});
  await refreshSummary(d,u.id).catch(e=>console.error(e));
  return Response.json({ok:true,variant},{headers:LAB_HEADERS});
 }
 if(b.action==='delete'){
  if(b.confirm!=='SMAZAT')return bad('Smazání je potřeba potvrdit.');
  if(!await deleteDef(d,u.id,id))return labNotFound();
  return Response.json({ok:true},{headers:LAB_HEADERS});
 }
 return bad('Neznámá akce.');
}catch(e){return labFailed(e)}}
