// Laboratoř · Hledání prahů (jen vlastník, lab_sweeps). GET = poslední sweep (nebo ?id=) + seznam posledních 10 (bez vedlejších efektů).
// Výpočet běží mimo web (scripts/lab-sweep.mjs na VPS, několik minut). POST {action:'simulate',sweepId,combo} = „Pustit do simulace“:
// založí variantu S01…S20 jen pro ROBUSTNÍ kombinaci daného sweepu (jen z vlastní stránky: sameOrigin + sec-fetch-site).
import {db,sameOrigin} from '@/lib/server';
import {labUser,labFailed,labNotFound,LAB_HEADERS} from '@/lib/lab/http';
import {getSweep,listSweeps} from '@/lib/lab/sweep-store';
import {createSweepVariant,listAccounts} from '@/lib/lab/paper-store';
import {refreshSummary} from '@/lib/lab/store';
import {comboAt,SWEEP_SIZE,F} from '@/lib/lab/sweep';
import {isSweepVariant} from '@/lib/lab/paper';
const ID=/^[0-9a-f-]{36}$/;
export async function GET(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;const d=db();
 const id=new URL(req.url).searchParams.get('id');
 if(id!==null&&!ID.test(id))return labNotFound();
 const [sweep,list,accounts]=await Promise.all([getSweep(d,u.id,id),listSweeps(d,u.id),listAccounts(d,u.id).catch(()=>[])]);
 if(id!==null&&!sweep)return labNotFound();
 const running=accounts.filter(a=>isSweepVariant(a.variant)&&a.sweep).map(a=>({variant:a.variant,combo:a.sweep!.combo,sweepId:a.sweep!.sweepId}));
 return Response.json({sweep,list,running},{headers:LAB_HEADERS});
}catch(e){return labFailed(e)}}
export async function POST(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;sameOrigin(req);const d=db();
 const site=req.headers.get('sec-fetch-site');if(site&&site!=='same-origin')return labNotFound();
 const b=await req.json().catch(()=>({})) as {action?:unknown;sweepId?:unknown;combo?:unknown};
 if(b.action!=='simulate')throw Error('Neznámá akce.');
 if(typeof b.sweepId!=='string'||!ID.test(b.sweepId))throw Error('Neznámý sweep.');
 const i=Number(b.combo);if(!Number.isInteger(i)||i<0||i>=SWEEP_SIZE)throw Error('Neznámá kombinace.');
 const s=await getSweep(d,u.id,b.sweepId);if(!s)throw Error('Sweep nenalezen.');
 const row=s.result.rows[i];
 if(!row||row[F.robust]!==1)throw Error('Do simulace jde pustit jen robustní kombinace.');
 const pick=(k:string[])=>Object.fromEntries(k.map(f=>[f,row[s.result.fields.indexOf(f)]??null]));
 const variant=await createSweepVariant(d,u.id,Date.now(),comboAt(i),{sweepId:s.id,combo:i,
  is:pick(['isN','isAvg','isPf','isDd']),oos:pick(['oosN','oosAvg','oosPf','oosDd']),nb:row[F.nb],chance:s.result.chance?.median??null,at:s.created});
 await refreshSummary(d,u.id).catch(e=>console.error(e));
 return Response.json({ok:true,variant},{headers:LAB_HEADERS});
}catch(e){return labFailed(e)}}
