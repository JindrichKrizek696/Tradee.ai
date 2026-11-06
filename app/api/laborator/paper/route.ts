// Laboratoř · Simulace 100 000 Kč (jen vlastník, lab_paper_*), varianty A/B/C/D + S01…S20 ze „Hledání prahů“. GET = stav vybrané varianty
// (?variant=A…D|S01…, výchozí A) + porovnání všech (bez vedlejších efektů), ?instrument= = obchody jednoho trhu ze všech variant pro vrstvu grafu.
// POST {action:'reset',confirm:'RESTART',variant} = restart jedné varianty; {action:'remove',confirm:'ODEBRAT',variant:'S…'} = odebrání varianty
// ze sweepu nebo agenta strategie R… (jen z vlastní stránky). Novou variantu ze sweepu zakládá POST /api/laborator/sweep, agenta R… POST /api/laborator/strategies.
import {db,sameOrigin} from '@/lib/server';
import {labUser,labFailed,labNotFound,LAB_HEADERS} from '@/lib/lab/http';
import {listTrades,paperView,resetPaper,removeSweepVariant,removeRuleVariant,withMarks,listAccounts,variantOf,ruleMetaOf} from '@/lib/lab/paper-store';
import {simLabel} from '@/lib/lab/sim-labels';
import {refreshSummary} from '@/lib/lab/store';
import {defLabels} from '@/lib/lab/strat-store';
import type {DefLabel} from '@/lib/lab/sim-labels';
// názvy / verze / zdroje definic pro agenty R… bez zdroje v kopii (bez migrace 0035/0044 nebo při chybě prázdné)
const defsOf=async(d:ReturnType<typeof db>,uid:string):Promise<Record<string,DefLabel>>=>defLabels(d,uid).catch(()=>({}));
import {isVariantId,isSweepVariant,isAgentVariant,isRuleVariant} from '@/lib/lab/paper';
import {liveQuotes} from '@/lib/live-store';
import {instruments} from '@/lib/markets';
const known=new Set(instruments.map(i=>i.id));
const quotesOf=async(d:ReturnType<typeof db>)=>(await liveQuotes(d).catch(()=>({quotes:{}}))).quotes;
export async function GET(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;const d=db();
 const sp=new URL(req.url).searchParams,inst=sp.get('instrument'),vq=sp.get('variant');
 if(inst!==null){if(!known.has(inst))return labNotFound();
  const [trades,quotes,accounts,defs]=await Promise.all([listTrades(d,u.id,{instrument:inst}),quotesOf(d),listAccounts(d,u.id).catch(()=>[]),defsOf(d,u.id)]);
  // legenda vrstvy grafu: označení účtů (rodina, u R… název definice, verze, zdroj a směr)
  const vs=[...new Set(trades.map(t=>t.variant??'A'))],labels=Object.fromEntries(vs.map(v=>{const a=accounts.find(x=>x.variant===v)??null,V=variantOf(v,a);
   return [v,simLabel({id:v,name:V?.name??v,rule:V?ruleMetaOf(V,a):null},defs)]}));
  return Response.json({trades:withMarks(trades.filter(t=>!t.voidReason),quotes).map(t=>({...t,variant:t.variant??'A',partsAtEntry:undefined})),labels},{headers:LAB_HEADERS})}
 if(vq!==null&&!isVariantId(vq))return labNotFound();
 const view=await paperView(d,u.id,await quotesOf(d),vq??'A');
 if(!view)return labNotFound(); // S… bez účtu
 const {V,...rest}=view,defs=await defsOf(d,u.id);
 // zdroj agenta R…: z kopie, jinak dohledaný podle defId (agenti spuštění před zdrojem)
 rest.variants=rest.variants.map(v=>v.rule&&!v.rule.sourceLabel&&v.rule.defId&&defs[v.rule.defId]?.sourceLabel?{...v,rule:{...v.rule,sourceLabel:defs[v.rule.defId]!.sourceLabel}}:v);
 return Response.json({...rest,now:Date.now(),rules:{version:V.rulesVersion,name:V.name,values:V.rules,text:V.text},
  catalog:rest.variants.map(v=>({id:v.id,name:v.name,rulesVersion:v.rulesVersion,kind:v.kind})),
  names:Object.fromEntries(instruments.map(i=>[i.id,i.name]))},{headers:LAB_HEADERS});
}catch(e){return labFailed(e)}}
export async function POST(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;sameOrigin(req);const d=db();
 const site=req.headers.get('sec-fetch-site');if(site&&site!=='same-origin')return labNotFound();
 const b=await req.json().catch(()=>({})) as {action?:unknown;confirm?:unknown;variant?:unknown};
 const variant=b.variant===undefined?'A':b.variant;
 if(!isVariantId(variant))throw Error('Neznámá varianta.');
 if(isAgentVariant(variant))throw Error('Agenti populace jsou neměnní – nejde je restartovat ani odebrat (vyřazuje je jen týdenní evoluce, archivem).');
 if(b.action==='reset'){
  if(b.confirm!=='RESTART')throw Error('Restart je potřeba potvrdit.');
  await resetPaper(d,u.id,Date.now(),variant);
 }else if(b.action==='remove'){
  if(b.confirm!=='ODEBRAT')throw Error('Odebrání je potřeba potvrdit.');
  if(isRuleVariant(variant))await removeRuleVariant(d,u.id,variant); // agent strategie (R…)
  else{if(!isSweepVariant(variant))throw Error('Odebrat jde jen variantu ze sweepu (S…) nebo agenta strategie (R…).');
  await removeSweepVariant(d,u.id,variant)}
 }else throw Error('Neznámá akce.');
 await refreshSummary(d,u.id).catch(e=>console.error(e));
 return Response.json({ok:true},{headers:LAB_HEADERS});
}catch(e){return labFailed(e)}}
