// Laboratoř · Simulace 100 000 Kč (jen vlastník, lab_paper_*). GET = stav (bez vedlejších efektů), ?instrument= = obchody jednoho trhu pro vrstvu grafu.
// POST {action:'reset',confirm:'RESTART'} = restart simulace (jen z vlastní stránky).
import {db,sameOrigin} from '@/lib/server';
import {labUser,labFailed,labNotFound,LAB_HEADERS} from '@/lib/lab/http';
import {listTrades,paperView,resetPaper,withMarks} from '@/lib/lab/paper-store';
import {refreshSummary} from '@/lib/lab/store';
import {PAPER_RULES,PAPER_RULES_TEXT,PAPER_RULES_VERSION} from '@/lib/lab/paper';
import {liveQuotes} from '@/lib/live-store';
import {instruments} from '@/lib/markets';
const known=new Set(instruments.map(i=>i.id));
const quotesOf=async(d:ReturnType<typeof db>)=>(await liveQuotes(d).catch(()=>({quotes:{}}))).quotes;
export async function GET(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;const d=db();
 const inst=new URL(req.url).searchParams.get('instrument');
 if(inst!==null){if(!known.has(inst))return labNotFound();
  const [trades,quotes]=await Promise.all([listTrades(d,u.id,inst),quotesOf(d)]);
  return Response.json({trades:withMarks(trades,quotes).map(t=>({...t,partsAtEntry:undefined}))},{headers:LAB_HEADERS})}
 const view=await paperView(d,u.id,await quotesOf(d));
 return Response.json({...view,now:Date.now(),rules:{version:PAPER_RULES_VERSION,values:PAPER_RULES,text:PAPER_RULES_TEXT},names:Object.fromEntries(instruments.map(i=>[i.id,i.name]))},{headers:LAB_HEADERS});
}catch(e){return labFailed(e)}}
export async function POST(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;sameOrigin(req);const d=db();
 const site=req.headers.get('sec-fetch-site');if(site&&site!=='same-origin')return labNotFound();
 const b=await req.json().catch(()=>({})) as {action?:unknown;confirm?:unknown};
 if(b.action!=='reset')throw Error('Neznámá akce.');
 if(b.confirm!=='RESTART')throw Error('Restart je potřeba potvrdit.');
 await resetPaper(d,u.id,Date.now());
 await refreshSummary(d,u.id).catch(e=>console.error(e));
 return Response.json({ok:true},{headers:LAB_HEADERS});
}catch(e){return labFailed(e)}}
