// Replay: seznam seancí a založení nové (trhy, start, rámce, režim, exekuce, replay účet z šablony nebo profilu, strategie).
import {identity,db,failed,sameOrigin} from '@/lib/server';
import {instruments as markets} from '@/lib/markets';
import {CURRENCIES} from '@/lib/fx';
import {listInstruments,listProfiles,fxContext} from '@/lib/risk/store';
import {defaultInstrumentFor} from '@/lib/risk/instruments';
import {TEMPLATES} from '@/lib/risk/account';
import {makeRate} from '@/lib/risk/size';
import {getVersion,latestVersion} from '@/lib/strategy/store';
import {parseSessionInput,buildSpecs,accountRules,LIMITS,type SessionConfig} from '@/lib/replay/core';
import {listSessions,createSession,countSessions,dataCheck} from '@/lib/replay/store';
import {TF_MS} from '@/lib/replay/clock';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){try{const u=await identity(req),d=db();
 const inst=await listInstruments(d);
 const list=(await listSessions(d,u.id)).map(s=>({id:s.id,name:s.name,mode:s.mode,status:s.status,symbols:s.symbols,baseTf:s.baseTf,start:s.start,clock:s.clock,rewinds:s.rewinds,resets:s.resets,journaled:s.journaled,updated:s.updated,summary:s.results?.summary??null,currency:s.config.account?.currency??''}));
 const mk=markets.filter(m=>defaultInstrumentFor(inst,m.id)).map(m=>({id:m.id,name:m.name,group:m.group}));
 return Response.json({sessions:list,markets:mk,templates:TEMPLATES.map(t=>({id:t.id,label:t.label,kind:t.kind})),currencies:CURRENCIES},{headers})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req),d=db(),now=Date.now();
 const inst=await listInstruments(d),ids=new Set(markets.filter(m=>defaultInstrumentFor(inst,m.id)).map(m=>m.id));
 const v=parseSessionInput(await req.json().catch(()=>null),ids,CURRENCIES,now);if(typeof v==='string')throw Error(v);
 if(await countSessions(d,u.id)>=LIMITS.sessions)throw Error(`Nejvýš ${LIMITS.sessions} seancí – smaž staré.`);
 for(const s of v.symbols){
  const c=await dataCheck(d,s,v.baseTf,v.start);
  if(!c.after)throw Error(`Pro ${s} nejsou v archivu svíčky ${v.baseTf} po startu.`);
  if(c.first!==null&&c.first>v.start+7*86400000)throw Error(`Archiv ${v.baseTf} pro ${s} začíná až ${new Date(c.first).toISOString().slice(0,10)} – zvol pozdější start${v.baseTf==='H1'?' nebo denní rámec':''}.`);
  if(c.before<2)throw Error(`Před startem chybí historie ${s} – zvol pozdější start.`);
 }
 let overrides={},profileRules=null,accName=TEMPLATES.find(t=>t.id===v.account.templateId)?.label??'Replay účet';
 if(v.account.source==='profile'){const p=(await listProfiles(d,u.id)).find(x=>x.id===v.account.profileId&&!x.archived);if(!p)throw Error('Profil účtu nenalezen.');overrides=p.overrides;profileRules=p.rules;accName=p.name}
 const fx=await fxContext(d),sp=buildSpecs(v.symbols,inst,overrides,v.exec,makeRate(fx.quotes,fx.ecb),v.account.currency);if(typeof sp==='string')throw Error(sp);
 let strategy:SessionConfig['strategy']=null;
 if(v.versionId||v.strategyId){const ver=v.versionId?await getVersion(d,u.id,v.versionId):await latestVersion(d,u.id,v.strategyId!);if(!ver)throw Error('Strategie nenalezena.');strategy={strategyId:ver.strategyId,versionId:ver.id,version:ver.version,name:ver.strategyName}}
 const config:SessionConfig={exec:{slippageTicks:v.exec.slippageTicks,swap:v.exec.swap,ambiguity:v.exec.ambiguity},execInput:v.exec,specs:sp.specs,
  account:{currency:v.account.currency,balance:v.account.balance,rules:accountRules(v.account,profileRules),name:accName,source:v.account.source,templateId:v.account.source==='template'?v.account.templateId:null,profileId:v.account.profileId},strategy,notes:sp.notes};
 // start na hranici svíčky základního rámce (hodiny = konec poslední uzavřené svíčky)
 const id=await createSession(d,u.id,{...v,start:Math.floor(v.start/TF_MS[v.baseTf])*TF_MS[v.baseTf]},config,now);
 return Response.json({ok:true,id},{headers})}catch(e){return failed(e)}}
