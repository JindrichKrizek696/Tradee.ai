// Laboratoř · Simulace 100 000 Kč (jen vlastník, lab_paper_*), varianty A/B/C/D. GET = stav vybrané varianty (?variant=A…D, výchozí A)
// + porovnání všech (bez vedlejších efektů), ?instrument= = obchody jednoho trhu ze všech variant pro vrstvu grafu.
// POST {action:'reset',confirm:'RESTART',variant} = restart jedné varianty (jen z vlastní stránky).
import {db,sameOrigin} from '@/lib/server';
import {labUser,labFailed,labNotFound,LAB_HEADERS} from '@/lib/lab/http';
import {listTrades,paperView,resetPaper,withMarks} from '@/lib/lab/paper-store';
import {refreshSummary} from '@/lib/lab/store';
import {PAPER_VARIANTS,VARIANT_IDS,isVariantId} from '@/lib/lab/paper';
import {liveQuotes} from '@/lib/live-store';
import {instruments} from '@/lib/markets';
const known=new Set(instruments.map(i=>i.id));
const quotesOf=async(d:ReturnType<typeof db>)=>(await liveQuotes(d).catch(()=>({quotes:{}}))).quotes;
export async function GET(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;const d=db();
 const sp=new URL(req.url).searchParams,inst=sp.get('instrument'),vq=sp.get('variant');
 if(inst!==null){if(!known.has(inst))return labNotFound();
  const [trades,quotes]=await Promise.all([listTrades(d,u.id,{instrument:inst}),quotesOf(d)]);
  return Response.json({trades:withMarks(trades,quotes).map(t=>({...t,variant:t.variant??'A',partsAtEntry:undefined}))},{headers:LAB_HEADERS})}
 if(vq!==null&&!isVariantId(vq))return labNotFound();
 const variant=vq??'A',V=PAPER_VARIANTS[variant];
 const view=await paperView(d,u.id,await quotesOf(d),variant);
 return Response.json({...view,now:Date.now(),rules:{version:V.rulesVersion,name:V.name,values:V.rules,text:V.text},
  catalog:VARIANT_IDS.map(id=>({id,name:PAPER_VARIANTS[id].name,rulesVersion:PAPER_VARIANTS[id].rulesVersion,kind:PAPER_VARIANTS[id].kind})),
  names:Object.fromEntries(instruments.map(i=>[i.id,i.name]))},{headers:LAB_HEADERS});
}catch(e){return labFailed(e)}}
export async function POST(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;sameOrigin(req);const d=db();
 const site=req.headers.get('sec-fetch-site');if(site&&site!=='same-origin')return labNotFound();
 const b=await req.json().catch(()=>({})) as {action?:unknown;confirm?:unknown;variant?:unknown};
 if(b.action!=='reset')throw Error('Neznámá akce.');
 if(b.confirm!=='RESTART')throw Error('Restart je potřeba potvrdit.');
 const variant=b.variant===undefined?'A':b.variant;
 if(!isVariantId(variant))throw Error('Neznámá varianta.');
 await resetPaper(d,u.id,Date.now(),variant);
 await refreshSummary(d,u.id).catch(e=>console.error(e));
 return Response.json({ok:true},{headers:LAB_HEADERS});
}catch(e){return labFailed(e)}}
