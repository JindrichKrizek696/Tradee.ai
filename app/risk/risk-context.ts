'use client';
// Sdílená data rizika na klientu (/api/risk/context): jeden požadavek pro kalkulačku, graf, Deník i Dashboard; obnova po uložení profilu.
import {useEffect,useSyncExternalStore} from 'react';
import {applyOverride,type Instrument,type Override,type Spec} from '@/lib/risk/instruments';
import {makeRate,type RateFn} from '@/lib/risk/size';
import type {ProfileKind,Rules,RuleVersion,Status} from '@/lib/risk/account';
export type ClientProfile={id:string;name:string;kind:ProfileKind;currency:string;startBalance:number;startDate:string;balance:number|null;linkId:string|null;feeChallenge:number|null;feeActivation:number|null;archived:boolean;versions:RuleVersion[];rules:Rules;overrides:Record<string,Override>;status:(Status&{source:string})|null};
export type RiskContext={instruments:Instrument[];profiles:ClientProfile[];accounts:{id:string;name:string;platform:string;currency:string;balance:number|null;equity:number|null}[];quotes:Record<string,number>;ecb:Record<string,number>;currencies:string[]};
type State={data:RiskContext|null;error:string;loading:boolean;at:number};
let state:State={data:null,error:'',loading:false,at:0};
const subs=new Set<()=>void>();
const set=(s:Partial<State>)=>{state={...state,...s};subs.forEach(f=>f())};
export function reloadRisk(){
 set({loading:true});
 return fetch('/api/risk/context',{cache:'no-store'}).then(async r=>{const j=await r.json() as RiskContext&{error?:string};if(!r.ok)throw Error(j.error||'');set({data:j,error:'',loading:false,at:Date.now()})})
  .catch(e=>set({error:(e as Error).message||'Data účtů se nepodařilo načíst.',loading:false}));
}
const subscribe=(f:()=>void)=>{subs.add(f);return()=>{subs.delete(f)}};
/** Data rizika; načte je při prvním použití a obnoví, když jsou starší než 2 min. */
export function useRisk(enabled=true){
 const s=useSyncExternalStore(subscribe,()=>state,()=>state);
 useEffect(()=>{if(enabled&&!state.loading&&(!state.data&&!state.error||Date.now()-state.at>120_000))reloadRisk()},[enabled]);
 return s;
}
export const activeProfiles=(c:RiskContext|null)=>(c?.profiles||[]).filter(p=>!p.archived);
export const rateOf=(c:RiskContext|null):RateFn=>makeRate(c?.quotes||{},c?.ecb||{});
export function specOf(c:RiskContext|null,profileId:string|null,instrumentId:string):Spec|null{
 const i=c?.instruments.find(x=>x.id===instrumentId);if(!i)return null;
 const p=profileId?c!.profiles.find(x=>x.id===profileId):undefined;
 return applyOverride(i,p?.overrides[instrumentId]);
}
// vybraný profil pro graf a kalkulačku (pamatuje se v prohlížeči)
const PREF='tradee.risk.profile';
export const readProfilePref=()=>{try{return localStorage.getItem(PREF)||''}catch{return ''}};
export const writeProfilePref=(id:string)=>{try{localStorage.setItem(PREF,id)}catch{}window.dispatchEvent(new Event('tradee-risk-profile'))};
export function useProfilePref(){
 return useSyncExternalStore(f=>{window.addEventListener('tradee-risk-profile',f);window.addEventListener('storage',f);return()=>{window.removeEventListener('tradee-risk-profile',f);window.removeEventListener('storage',f)}},readProfilePref,()=>'');
}
/** výchozí riziko kalkulačky: max. riziko profilu, jinak 1 % */
export const defaultRiskPct=(p:ClientProfile|null|undefined)=>p?.rules.maxRiskPct??1;
