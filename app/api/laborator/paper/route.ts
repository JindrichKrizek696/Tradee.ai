// Laboratoř · Simulace 100 000 Kč (jen vlastník, lab_paper_*), varianty A/B/C/D + S01…S20 ze „Hledání prahů“. GET = stav vybrané varianty
// (?variant=A…D|S01…, výchozí A) + porovnání všech (bez vedlejších efektů), ?instrument= = obchody jednoho trhu ze všech variant pro vrstvu grafu.
// POST {action:'reset',confirm:'RESTART',variant} = restart jedné varianty; {action:'remove',confirm:'ODEBRAT',variant:'S…'} = odebrání varianty
// ze sweepu (jen z vlastní stránky). Novou variantu ze sweepu zakládá POST /api/laborator/sweep.
import {db,sameOrigin} from '@/lib/server';
import {labUser,labFailed,labNotFound,LAB_HEADERS} from '@/lib/lab/http';
import {listTrades,paperView,resetPaper,removeSweepVariant,withMarks} from '@/lib/lab/paper-store';
import {refreshSummary} from '@/lib/lab/store';
import {isVariantId,isSweepVariant,isAgentVariant} from '@/lib/lab/paper';
import {liveQuotes} from '@/lib/live-store';
import {instruments} from '@/lib/markets';
const known=new Set(instruments.map(i=>i.id));
const quotesOf=async(d:ReturnType<typeof db>)=>(await liveQuotes(d).catch(()=>({quotes:{}}))).quotes;
export async function GET(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;const d=db();
 const sp=new URL(req.url).searchParams,inst=sp.get('instrument'),vq=sp.get('variant');
 if(inst!==null){if(!known.has(inst))return labNotFound();
  const [trades,quotes]=await Promise.all([listTrades(d,u.id,{instrument:inst}),quotesOf(d)]);
  return Response.json({trades:withMarks(trades.filter(t=>!t.voidReason),quotes).map(t=>({...t,variant:t.variant??'A',partsAtEntry:undefined}))},{headers:LAB_HEADERS})}
 if(vq!==null&&!isVariantId(vq))return labNotFound();
 const view=await paperView(d,u.id,await quotesOf(d),vq??'A');
 if(!view)return labNotFound(); // S… bez účtu
 const {V,...rest}=view;
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
  if(!isSweepVariant(variant))throw Error('Odebrat jde jen variantu ze sweepu (S…).');
  await removeSweepVariant(d,u.id,variant);
 }else throw Error('Neznámá akce.');
 await refreshSummary(d,u.id).catch(e=>console.error(e));
 return Response.json({ok:true},{headers:LAB_HEADERS});
}catch(e){return labFailed(e)}}
