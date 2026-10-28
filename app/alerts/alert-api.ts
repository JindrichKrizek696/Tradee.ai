'use client';
// Klient alertů: typy z API, volání a jednoduchá „sběrnice“ – po změně alertu se obnoví graf, detail, stránka /alerty i zvonek.
import {useCallback,useEffect,useState} from 'react';
import type {Alert} from '@/lib/alerts/logic';
export type ClientAlert=Omit<Alert,'userId'>;
export type AlertEvent={id:number;alertId:string;at:number;price:number;instrument:string;label:string;push:boolean|null;mail:boolean|null;read:boolean;scenarioId?:string};
// spuštěný alert propojený se scénářem otevře scénář, jinak graf / trh
export const eventHref=(e:AlertEvent,linkOf:(instrument:string)=>string)=>e.scenarioId?'/scenare#'+encodeURIComponent(e.scenarioId):linkOf(e.instrument);
export type AlertList={alerts:ClientAlert[];active:number;limit:number;pushAvailable:boolean};
const json={'Content-Type':'application/json'};
const EVT='tradee-alerts';
export const alertsChanged=()=>{try{window.dispatchEvent(new Event(EVT))}catch{}};
async function call<T>(url:string,init?:RequestInit):Promise<T>{
 const r=await fetch(url,{cache:'no-store',...init});const j=await r.json().catch(()=>({})) as T&{error?:string};
 if(!r.ok)throw Error(j.error||'Alert se nepodařilo uložit. Zkus to znovu.');return j;
}
export type Saved={alert:ClientAlert;warnings:string[]};
export const saveAlert=async(body:Record<string,unknown>,id?:string)=>{const r=await call<Saved>(id?'/api/alerts/'+encodeURIComponent(id):'/api/alerts',{method:id?'PATCH':'POST',headers:json,body:JSON.stringify(body)});alertsChanged();return r};
export const removeAlert=async(id:string)=>{await call('/api/alerts/'+encodeURIComponent(id),{method:'DELETE',headers:json});alertsChanged()};
export const loadEvents=(o:{unread?:boolean;alert?:string;limit?:number}={})=>call<{events:AlertEvent[];unread:number}>('/api/alerts/events?'+new URLSearchParams({...(o.unread?{unread:'1'}:{}),...(o.alert?{alert:o.alert}:{}),limit:String(o.limit??50)}));
export const readEvents=async(ids?:number[])=>{await call('/api/alerts/events',{method:'POST',headers:json,body:JSON.stringify({action:'read',...(ids?{ids}:{})})});alertsChanged()};
/** Alerty (jednoho trhu nebo všechny); obnoví se po každé změně odkudkoli na stránce. */
export function useAlerts(instrument?:string|null){
 const [data,setData]=useState<AlertList|null>(null),[error,setError]=useState(false);
 const load=useCallback(async()=>{try{const j=await call<AlertList>('/api/alerts'+(instrument?'?instrument='+encodeURIComponent(instrument):''));setData(j);setError(false)}catch{setError(true)}},[instrument]);
 useEffect(()=>{load();const f=()=>{load()};window.addEventListener(EVT,f);return()=>window.removeEventListener(EVT,f)},[load]);
 return {data,error,reload:load};
}
export const onAlertsChanged=(f:()=>void)=>{window.addEventListener(EVT,f);return()=>window.removeEventListener(EVT,f)};
