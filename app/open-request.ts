'use client';
import {useEffect,useRef} from 'react';
// Předání „otevři tohle“ z vyhledávání komponentě, která se teprve vykreslí (sessionStorage) nebo už běží (událost tradee:open).
type Kind='note'|'event';
const KEY='tradee.open.';
const take=(kind:Kind)=>{try{const v=sessionStorage.getItem(KEY+kind);if(v)sessionStorage.removeItem(KEY+kind);return v}catch{return null}};
export function requestOpen(kind:Kind,id:string){try{sessionStorage.setItem(KEY+kind,id)}catch{}dispatchEvent(new CustomEvent('tradee:open',{detail:{kind}}))}
/** Zavolá fn(id), když vyhledávání požádá o otevření (i před vykreslením komponenty). */
export function useOpenRequest(kind:Kind,fn:(id:string)=>void){
 const cb=useRef(fn);
 useEffect(()=>{cb.current=fn});
 useEffect(()=>{const run=()=>{const id=take(kind);if(id)cb.current(id)};run();const on=(e:Event)=>{if((e as CustomEvent<{kind:Kind}>).detail?.kind===kind)run()};addEventListener('tradee:open',on);return()=>removeEventListener('tradee:open',on)},[kind]);
}
