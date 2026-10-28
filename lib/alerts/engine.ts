// Jeden běh kontroly alertů (scripts/alerts-check.mjs, cron každou minutu). Závislosti (DB, síť, odeslání) se vkládají,
// takže stejný běh jde pustit nad fixture (--dry --fixture) i v testech. Bezpečné při opakování: spuštění si alert „zabere“
// podmíněným UPDATE (aktivní, neupravený uživatelem od načtení, stejné poslední spuštění) – druhý běh ho už nespustí.
import {decide,conditionLabel,type Alert,type Quote,type Fired,type Step} from './logic.ts';
export type Loaded=Alert&{email?:string|null;name?:string|null};
export type Delivery={push:boolean|null;mail:boolean|null};
export type Deps={
 now:number;
 loadAlerts():Promise<Loaded[]>;
 fetchQuotes(ids:string[],limitMin:(id:string)=>number):Promise<{quotes:Map<string,Quote|null>;errors:string[]}>;
 scoreOf(id:string):number|null;
 meta(id:string):{name:string;group:string}|null;
 isOpen(id:string,group:string,now:number):boolean;
 expire(a:Loaded):Promise<boolean>;
 touch(a:Loaded,value:number):Promise<void>;
 claim(a:Loaded,s:Extract<Step,{action:'trigger'}>):Promise<boolean>;
 record(a:Loaded,s:Extract<Step,{action:'trigger'}>,label:string):Promise<number>;
 deliver(a:Loaded,f:Fired):Promise<Delivery>;
 delivered(eventId:number,d:Delivery):Promise<void>;
 log?(line:string):void;
};
export type Summary={alerts:number;instruments:number;closed:number;noData:number;updated:number;expired:number;triggered:number;push:number;mail:number;errors:string[]};
export async function runCheck(deps:Deps):Promise<Summary>{
 const now=deps.now,S:Summary={alerts:0,instruments:0,closed:0,noData:0,updated:0,expired:0,triggered:0,push:0,mail:0,errors:[]};
 const all=(await deps.loadAlerts()).filter(a=>a.active);S.alerts=all.length;
 // ceny jen pro trhy, které mají aktivní cenový / % alert a jsou teď otevřené (krypto vždy); skóre se počítá zvlášť
 const need=new Map<string,number>();
 for(const a of all){if(a.kind==='score')continue;const m=deps.meta(a.instrument);if(!m||!deps.isOpen(a.instrument,m.group,now))continue;
  const since=a.lastChecked===null?5:Math.ceil((now-a.lastChecked)/60000);need.set(a.instrument,Math.max(need.get(a.instrument)??0,since))}
 const ids=[...need.keys()];S.instruments=ids.length;
 const {quotes,errors}=ids.length?await deps.fetchQuotes(ids,id=>need.get(id)??5):{quotes:new Map<string,Quote|null>(),errors:[]};
 S.errors.push(...errors);
 const scores=new Map<string,number|null>();
 for(const a of all){
  try{
   const m=deps.meta(a.instrument);if(!m){S.noData++;continue}
   let score:number|null=null;
   if(a.kind==='score'){if(!scores.has(a.instrument))scores.set(a.instrument,deps.scoreOf(a.instrument));score=scores.get(a.instrument)??null}
   const open=a.kind==='score'||deps.isOpen(a.instrument,m.group,now);
   const s=decide(a,quotes.get(a.instrument)??null,score,now,open);
   if(s.action==='expire'){if(await deps.expire(a))S.expired++;continue}
   if(s.action==='skip'){if(s.reason==='trh zavřený')S.closed++;else S.noData++;continue}
   if(s.action==='update'){await deps.touch(a,s.value);S.updated++;continue}
   if(!await deps.claim(a,s))continue;
   const label=conditionLabel(a,m.name),eventId=await deps.record(a,s,label);S.triggered++;
   deps.log?.(`spuštěn ${a.id} · ${label} · ${s.price}`);
   const res=await deps.deliver(a,{id:a.id,instrument:a.instrument,name:m.name,group:m.group,kind:a.kind,level:a.level,pct:a.pct,op:a.op,note:a.note,price:s.price,oneShot:s.oneShot});
   if(res.push)S.push++;if(res.mail)S.mail++;
   await deps.delivered(eventId,res);
  }catch(e){S.errors.push(a.id+': '+((e as Error)?.message||'chyba'))}
 }
 return S;
}
