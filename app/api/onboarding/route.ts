import {identity,db,failed,sameOrigin} from '@/lib/server';
import {instruments} from '@/lib/markets';
import {validateAnswers,buildPreview} from '@/lib/onboarding/core';
import {getPrefs,getState,currentOf,saveDraft,skip,apply,revert,setPrefs,setStrategy,isMissing,MISSING} from '@/lib/onboarding/store';
import {createStrategy} from '@/lib/discipline/store';
import {saveVersion} from '@/lib/strategy/store';
const headers={'Cache-Control':'private, no-store'},ids=instruments.map(i=>i.id);
const markets=instruments.map(i=>({id:i.id,name:i.name,group:i.group}));
const fail=(e:unknown)=>failed(isMissing(e)?new Error(MISSING):e);
// GET: stav průvodce (status, odpovědi, panely, jde vrátit), aktuální navigace a vlaječky pro náhled. Bez migrace status 'unavailable'.
export async function GET(req:Request){try{const u=await identity(req),d=db();
 if(new URL(req.url).searchParams.get('prefs')==='1')return Response.json({prefs:await getPrefs(d,u.id)},{headers});
 try{if(new URL(req.url).searchParams.get('lite')==='1'){const s=await getState(d,u.id);return Response.json({status:s.status,canRevert:s.canRevert},{headers})}
  const [s,cur]=await Promise.all([getState(d,u.id),currentOf(d,u.id)]);return Response.json({...s,current:cur,markets},{headers})}
 catch(e){if(isMissing(e))return Response.json({status:'unavailable',answers:null,prefs:{dash:{off:[]},journal:{off:[]}},canRevert:false,strategyId:null},{headers});throw e}
}catch(e){return failed(e)}}
// PUT {answers}: rozpracované odpovědi (nic dalšího se nemění)
export async function PUT(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json().catch(()=>null) as {answers?:unknown}|null;
 const a=validateAnswers(b?.answers);if(typeof a==='string')throw Error(a);await saveDraft(db(),u.id,a);return Response.json({ok:true},{headers})}catch(e){return fail(e)}}
// PATCH {prefs}: panely Dashboardu a pole záznamu obchodu (i z Nastavení, bez průvodce)
export async function PATCH(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json().catch(()=>null) as {prefs?:unknown}|null;
 if(!b?.prefs||typeof b.prefs!=='object')throw Error('Není co uložit.');return Response.json({prefs:await setPrefs(db(),u.id,b.prefs)},{headers})}catch(e){return fail(e)}}
// POST {action}: apply (+ createStrategy), skip, revert, preview
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req),d=db(),b=await req.json().catch(()=>null) as {action?:unknown;answers?:unknown;createStrategy?:unknown}|null;
 const act=b?.action;
 if(act==='revert'){if(!await revert(d,u.id))throw Error('Není co vrátit – průvodce zatím nic nenastavil.');return Response.json({ok:true,...await getState(d,u.id)},{headers})}
 const a=b?.answers===undefined&&act==='skip'?null:validateAnswers(b?.answers);if(typeof a==='string')throw Error(a);
 if(act==='skip'){await skip(d,u.id,a);return Response.json({ok:true},{headers})}
 if(!a)throw Error('Chybí odpovědi.');
 if(act==='preview')return Response.json({preview:buildPreview(a,await currentOf(d,u.id),ids)},{headers});
 if(act!=='apply')throw Error('Neznámá akce.');
 const preview=await apply(d,u.id,a,ids);let strategyId:string|null=null;
 // prázdná startovní strategie jen na výslovné potvrzení; jméno nikdy nesáhne na existující strategii
 if(b?.createStrategy===true){
  let name=preview.strategy.name;for(let i=2;await d.prepare('SELECT id FROM strategies WHERE user_id=? AND name=?').bind(u.id,name).first();i++)name=`${preview.strategy.name} (${i})`;
  strategyId=await createStrategy(d,u.id,name);await saveVersion(d,u.id,strategyId,preview.strategy.content,'Založeno průvodcem – bloky jsou prázdné, doplň je.',ids);await setStrategy(d,u.id,strategyId);
 }
 return Response.json({ok:true,preview,strategyId},{headers});
}catch(e){return fail(e)}}
