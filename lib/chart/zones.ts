// Zóna nabídky / poptávky jako objekt v grafu: proximální a distální hrana, stav počítaný z ceny (čekám → dotčena → mitigována X % → zneplatněna, ručně archiv),
// pravidlo mitigace per zóna (dotyk knotem / zavření v zóně / % průniku), historie změn stavu, vnoření do zóny vyššího TF, podklady pro scénář a alert.
// Čisté funkce – testy scripts/check-chart-workspace.mjs.
import {TFS} from './candles.ts';
export type ZoneKind='supply'|'demand';
export type ZoneRule='touch'|'close'|'pct';
export const ZONE_RULES:Record<ZoneRule,string>={touch:'dotyk (knot na proximální hraně)',close:'zavření svíčky v zóně',pct:'průnik o zadané %'};
export type ZoneState='waiting'|'touched'|'mitigated'|'invalid'|'archived';
export const ZONE_STATES:Record<ZoneState,string>={waiting:'čekám',touched:'dotčena',mitigated:'mitigována',invalid:'zneplatněna',archived:'archiv'};
export const ZONE_KINDS:Record<ZoneKind,string>={supply:'nabídka (supply)',demand:'poptávka (demand)'};
// metadata zóny v kresbě: k druh, rule pravidlo, pct práh průniku (1–100 %), at kdy vznikla (ms), par ruční rodič (ID zóny),
// arch kdy archivována, scn propojený scénář, al propojený alert
export type ZoneMeta={k:ZoneKind;rule:ZoneRule;pct?:number;at:number;par?:string;arch?:number;scn?:string;al?:string};
export type Edges={proximal:number;distal:number;hi:number;lo:number};
// poptávka: proximální = horní hrana (cena k ní klesá), distální = dolní; nabídka obráceně
export function zoneEdges(k:ZoneKind,a:{p:number}[]):Edges{
 const hi=Math.max(a[0].p,a[1]?.p??a[0].p),lo=Math.min(a[0].p,a[1]?.p??a[0].p);
 return k==='demand'?{proximal:hi,distal:lo,hi,lo}:{proximal:lo,distal:hi,hi,lo};
}
// druh nové zóny podle ceny: pod poslední cenou poptávka, nad ní nabídka
export const zoneKindFor=(a:{p:number}[],last:number|null):ZoneKind=>last===null?'demand':(a[0].p+(a[1]?.p??a[0].p))/2<=last?'demand':'supply';
export type ZBar={t:number;h:number;l:number;c:number};
export type ZoneEvent={t:number;state:ZoneState;depth:number};
export type ZoneEval={state:ZoneState;depth:number;history:ZoneEvent[];partial:boolean};
// průnik do zóny jako podíl hloubky (0 = proximální hrana, 1 = distální); záporný = mimo zónu
export function penetration(k:ZoneKind,e:Edges,price:number){
 const depth=Math.abs(e.distal-e.proximal)||Math.abs(e.proximal)*1e-9||1e-9;
 return k==='demand'?(e.proximal-price)/depth:(price-e.proximal)/depth;
}
// vyhodnocení stavu ze svíček, které začínají po from (ms UTC, konec báze zóny):
// zneplatněna = svíčka ZAVŘE za distální hranou (knot za ní ne); mitigována podle pravidla (touch: knot na proximální; close: zavření v zóně; pct: knot pronikne o pct %); jinak dotčena / čekám
export function evalZone(z:{k:ZoneKind;rule:ZoneRule;pct?:number;arch?:number},e:Edges,from:number,bars:ZBar[]):ZoneEval{
 const hist:ZoneEvent[]=[];let state:ZoneState='waiting',depth=0;
 const thr=Math.min(100,Math.max(1,z.pct??50))/100;
 const partial=!bars.length||bars[0].t>from;
 const set=(t:number,s:ZoneState)=>{if(s!==state){state=s;hist.push({t,state:s,depth:Math.round(Math.min(1,depth)*1000)/1000})}};
 for(const b of bars){
  if(b.t<=from)continue;
  if(z.arch!==undefined&&b.t>=z.arch)break;
  const wick=penetration(z.k,e,z.k==='demand'?b.l:b.h),close=penetration(z.k,e,b.c);
  if(wick<0)continue;
  depth=Math.max(depth,wick);
  if(close>1){set(b.t,'invalid');break}
  const mit=z.rule==='touch'?true:z.rule==='close'?close>0:depth>=thr;
  if(mit)set(b.t,'mitigated');else if(state==='waiting')set(b.t,'touched');
 }
 if(z.arch!==undefined){hist.push({t:z.arch,state:'archived',depth:Math.round(Math.min(1,depth)*1000)/1000});state='archived'}
 return {state,depth:Math.min(1,depth),history:hist,partial};
}
// popisek stavu: „mitigována 40 %“, „zneplatněna“…
export const stateText=(ev:{state:ZoneState;depth:number})=>ev.state==='mitigated'?'mitigována '+Math.round(ev.depth*100)+' %':ZONE_STATES[ev.state];
// pořadí TF (vyšší = delší); neznámý = -1
export const tfRank=(tf:string|undefined)=>tf?(TFS as readonly string[]).indexOf(tf):-1;
// vnoření: rodič = zóna vyššího TF, jejíž cenový rozsah celý obsahuje dítě (nejbližší vyšší TF, pak nejužší); ruční rodič má přednost, pokud existuje
export type ZoneRef={id:string;tf?:string;hi:number;lo:number;par?:string};
export function zoneParent(z:ZoneRef,all:ZoneRef[]):string|null{
 if(z.par&&all.some(x=>x.id===z.par&&x.id!==z.id))return z.par;
 const r=tfRank(z.tf);let best:ZoneRef|null=null;
 for(const p of all){
  if(p.id===z.id||tfRank(p.tf)<=r||r<0)continue;
  if(p.lo>z.lo||p.hi<z.hi)continue;
  if(!best||tfRank(p.tf)<tfRank(best.tf)||(tfRank(p.tf)===tfRank(best.tf)&&p.hi-p.lo<best.hi-best.lo))best=p;
 }
 return best?.id??null;
}
export function nestZones(all:ZoneRef[]):Map<string,string>{
 const m=new Map<string,string>();for(const z of all){const p=zoneParent(z,all);if(p)m.set(z.id,p)}return m;
}
// zóna vyššího TF na nižším TF: viditelná jen se zapnutým přepínačem, s popiskem původu („D1 zóna“); zóny stejného a nižšího TF vždy
export function htfVisible(otf:string|undefined,tf:string,show:boolean){const r=tfRank(otf),c=tfRank(tf);return r<=c||show}
export const htfLabel=(otf:string|undefined,tf:string)=>otf&&tfRank(otf)>tfRank(tf)?otf+' zóna':null;
// scénář ze zóny (POST /api/scenarios): poptávka → long, nabídka → short; vstup v zóně, zneplatnění za distální hranou
export function zoneScenario(instrument:string,k:ZoneKind,e:Edges,tf:string|undefined,fmt:(v:number)=>string){
 return {instrument,bias:k==='demand'?'long':'short',hypothesis:`Reakce z ${k==='demand'?'poptávkové':'nabídkové'} zóny${tf?' '+tf:''} (${fmt(e.lo)}–${fmt(e.hi)}). Vstup jen podle strategie, zóna sama o sobě není setup.`,levels:{entryFrom:e.lo,entryTo:e.hi,invalidation:e.distal,targets:[]}};
}
// alert na dotyk zóny (POST /api/alerts): kind touch na proximální hraně
export function zoneAlert(instrument:string,k:ZoneKind,e:Edges,tf:string|undefined,fmt:(v:number)=>string){
 return {instrument,kind:'touch',level:e.proximal,note:`Dotyk ${k==='demand'?'poptávkové':'nabídkové'} zóny${tf?' '+tf:''} (${fmt(e.lo)}–${fmt(e.hi)})`};
}
// validace metadat zóny (z DB / PUT); null = neplatné
const ID=/^[A-Za-z0-9_-]{1,40}$/;
export function parseZoneMeta(v:unknown):ZoneMeta|null{
 if(!v||typeof v!=='object'||Array.isArray(v))return null;
 const o=v as Record<string,unknown>;
 if(o.k!=='supply'&&o.k!=='demand')return null;
 if(o.rule!=='touch'&&o.rule!=='close'&&o.rule!=='pct')return null;
 const t=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&x>0&&x<7258118400000;
 if(!t(o.at))return null;
 const z:ZoneMeta={k:o.k,rule:o.rule,at:o.at as number};
 if(o.pct!==undefined){if(!Number.isInteger(o.pct)||(o.pct as number)<1||(o.pct as number)>100)return null;z.pct=o.pct as number}
 if(o.par!==undefined){if(typeof o.par!=='string'||!ID.test(o.par))return null;z.par=o.par}
 if(o.arch!==undefined){if(!t(o.arch))return null;z.arch=o.arch as number}
 if(o.scn!==undefined){if(typeof o.scn!=='string'||!/^[A-Za-z0-9_-]{1,60}$/.test(o.scn))return null;z.scn=o.scn}
 if(o.al!==undefined){if(typeof o.al!=='string'||!/^al_[a-z0-9]{1,40}$/.test(o.al))return null;z.al=o.al}
 return z;
}
