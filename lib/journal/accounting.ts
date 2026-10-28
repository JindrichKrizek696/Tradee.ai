// Poctivé účtování výsledku: R z PŮVODNÍHO plánovaného rizika (ne z posunutého stopu), částečné výstupy, cenový vs. účetní BE a rozpad nákladů.
// Čisté funkce – testy scripts/check-journal-ideas.mjs.
import type {Side} from './ideas.ts';
const r2=(n:number)=>Math.round(n*100)/100;
export const UNKNOWN_R='neznámé R';
/** Původní riziko: plán (ruční / ze snímku plánu) má přednost, jinak riziko z PRVNÍHO stopu. Posunutý stop se nikdy nepoužije. */
export function originalRisk(o:{planned:number|null|undefined;firstStop:number|null|undefined}):number|null{
 if(o.planned!==null&&o.planned!==undefined&&o.planned>0)return o.planned;
 if(o.firstStop!==null&&o.firstStop!==undefined&&o.firstStop>0)return o.firstStop;
 return null;
}
export const rMultiple=(net:number|null,risk:number|null)=>net===null||risk===null||!(risk>0)?null:r2(net/risk);
/** Riziko do stopu z ceny: |vstup − stop| × objem × hodnota bodu; stop na špatné straně = null. */
export function riskFromStop(side:Side,entry:number,stop:number|null,qty:number,pointValue=1):number|null{
 if(stop===null)return null;const d=side==='buy'?entry-stop:stop-entry;return d>0&&qty>0?d*qty*pointValue:null;
}
/** R s částečnými výstupy (bez nákladů): Σ objem_i × (výstup_i − vstup) × směr ÷ (|vstup − původní stop| × celkový objem). */
export function partialR(o:{side:Side;entry:number;stop:number;exits:{price:number;qty:number}[]}):number|null{
 const risk=Math.abs(o.entry-o.stop),q=o.exits.reduce((a,e)=>a+e.qty,0);if(!(risk>0)||!(q>0))return null;
 const dir=o.side==='buy'?1:-1;
 return r2(o.exits.reduce((a,e)=>a+e.qty*(e.price-o.entry)*dir,0)/(risk*q));
}
/** Cenový BE = výstup na ceně vstupu (± tolerance); účetní BE = čistý výsledek po nákladech ≈ 0 (do 0,02 R, bez rizika do 1 jednotky měny). */
export type BeKind='price'|'accounting'|null;
export function breakEven(o:{side:Side|null;entry:number|null;exit:number|null;net:number|null;risk:number|null;tick?:number|null}):{kind:BeKind;label:string|null;net:number|null}{
 if(o.net===null)return {kind:null,label:null,net:null};
 const tolNet=o.risk&&o.risk>0?o.risk*0.02:1;
 if(Math.abs(o.net)<=tolNet)return {kind:'accounting',label:'účetní BE',net:o.net};
 if(o.entry!==null&&o.exit!==null){const tol=Math.max(o.tick&&o.tick>0?o.tick:0,Math.abs(o.entry)*0.00002);if(Math.abs(o.exit-o.entry)<=tol)return {kind:'price',label:'cenový BE',net:o.net}}
 return {kind:null,label:null,net:o.net};
}
// ---- náklady obchodu (záporné = náklad); null = neznámé
export const COST_KEYS=[['spread','Spread'],['commission','Komise'],['swap','Swap'],['slippage','Slippage'],['fee','Poplatky']] as const;
export type CostKey=typeof COST_KEYS[number][0];
export type Costs=Record<CostKey,number|null>;
export const emptyCosts=():Costs=>({spread:null,commission:null,swap:null,slippage:null,fee:null});
/** Náklady z MT/T212 doplněné ručními (ruční hodnota přebije zjištěnou). Komise, swap a poplatky z MT se berou, jak jsou (v čistém výsledku už jsou). */
export function mergeCosts(auto:Partial<Costs>,manual:Partial<Costs>|null):Costs{
 const out=emptyCosts();
 for(const [k] of COST_KEYS){const m=manual?.[k],a=auto[k];out[k]=m!==null&&m!==undefined&&Number.isFinite(m)?m:a!==null&&a!==undefined&&Number.isFinite(a)?a:null}
 return out;
}
export function costLines(c:Costs):{lines:{key:CostKey;label:string;value:number|null}[];known:number;total:number}{
 const lines=COST_KEYS.map(([key,label])=>({key,label,value:c[key]}));
 const known=lines.filter(l=>l.value!==null);
 return {lines,known:known.length,total:r2(known.reduce((a,l)=>a+(l.value as number),0))};
}
/** Hrubý výsledek (jen cena) = čistý − náklady, které jsou v čistém výsledku započtené (komise, swap, poplatky). */
export const grossOf=(net:number,c:Costs)=>r2(net-(c.commission??0)-(c.swap??0)-(c.fee??0));
export function parseCosts(raw:unknown):Partial<Costs>|string{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return 'Neplatné náklady.';
 const o=raw as Record<string,unknown>,out:Partial<Costs>={};
 for(const [k,label] of COST_KEYS){if(!(k in o))continue;const v=o[k];if(v===null||v===''){out[k]=null;continue}const n=typeof v==='string'?Number(v.replace(',','.').replace(/\s/g,'')):Number(v);if(!Number.isFinite(n)||Math.abs(n)>1e9)return `${label}: zadej číslo.`;out[k]=n}
 return out;
}
