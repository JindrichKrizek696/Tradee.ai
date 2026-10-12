// Laboratoř · uložená pravidla (jen vlastník, lab_rules).
import {db,sameOrigin} from '@/lib/server';
import {labUser,labFailed,labNotFound,LAB_HEADERS} from '@/lib/lab/http';
import {listRules,saveRule,deleteRule,refreshSummary} from '@/lib/lab/store';
import {normalizeLabRule} from '@/lib/lab/rules';
import {LAB_LIMITS} from '@/lib/lab/core';
import {instruments} from '@/lib/markets';
const known=new Set(instruments.map(i=>i.id));
export async function GET(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;
 return Response.json({rules:await listRules(db(),u.id)},{headers:LAB_HEADERS})}catch(e){return labFailed(e)}}
export async function POST(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;sameOrigin(req);const d=db();
 const b=await req.json().catch(()=>({})) as {id?:unknown;name?:unknown;rule?:unknown;summary?:unknown};
 const name=typeof b.name==='string'?b.name.trim().slice(0,LAB_LIMITS.name):'';if(!name)throw Error('Pravidlo potřebuje název.');
 const id=await saveRule(d,u.id,typeof b.id==='string'&&b.id?b.id:null,name,normalizeLabRule(b.rule,known),b.summary);
 if(!id)return labNotFound();
 await refreshSummary(d,u.id).catch(e=>console.error(e));
 return Response.json({id,rules:await listRules(d,u.id)},{headers:LAB_HEADERS})}catch(e){return labFailed(e)}}
export async function DELETE(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;sameOrigin(req);const d=db();
 const id=new URL(req.url).searchParams.get('id')||'';if(!await deleteRule(d,u.id,id))return labNotFound();
 await refreshSummary(d,u.id).catch(e=>console.error(e));
 return Response.json({ok:true},{headers:LAB_HEADERS})}catch(e){return labFailed(e)}}
