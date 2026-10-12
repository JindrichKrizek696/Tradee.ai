// Přehled skóre: vypnuté složky (uživatel je nechce počítat). Čistá logika bez serverových importů; sdílí ji karta
// přehledu (app/score-breakdown.tsx) i /api/settings. Kontrola: node --experimental-strip-types scripts/check-overview-toggle.mjs
//
// Vypnutá složka se bere jako chybějící: vypadne z Bodů i z Celkem a váhy zapnutých se přepočtou – stejné pravidlo
// a vzorec, jakým model (lib/score/v3.ts, patička karty) zachází s chybějícími podklady:
//  Celkem = Σ(wᵢ · sᵢ/2) / Σw zapnutých dostupných · 100, příspěvek = wᵢ · sᵢ/2 / Σw · 100 (součet příspěvků = Celkem).
// Nic vypnuto (nebo vypnuté jen chybějící složky) → čísla beze změny, přesně jak je spočítal model.
// Výpočet skóre modelem ani karta skóre / heatmapa se tím nemění.
export type TogglePart={id:string;weight:number;value:number|null;contribution:number|null};
const ID=/^[A-Za-z][A-Za-z0-9]{0,31}$/;
/** Vypnutá id z localStorage / DB: jen rozumná id, bez duplicit, seřazená; cokoli jiného → []. Neznámá id nevadí (žádnou složku nevypnou). */
export function normalizeOff(raw:unknown):string[]{return Array.isArray(raw)?[...new Set(raw.filter((x):x is string=>typeof x==='string'&&ID.test(x)))].sort().slice(0,32):[]}
export function parseOff(s:string|null|undefined):string[]|null{if(!s)return null;try{return normalizeOff(JSON.parse(s))}catch{return null}}
export const toggleOff=(off:readonly string[],id:string)=>normalizeOff(off.includes(id)?off.filter(x=>x!==id):[...off,id]);
const round=(n:number,d:number)=>{const f=10**d,v=Math.sign(n)*Math.round(Math.abs(n)*f)/f;return v===0?0:v};

/** Body, Celkem a příspěvky přehledu jen ze zapnutých složek. `coverage` = součet vah dostupných složek (jako ve výsledku modelu). */
export function applyOff<P extends TogglePart>(r:{parts:P[];score:number|null;coverage:number},off:readonly string[]){
 const isOff=(p:P)=>off.includes(p.id),ok=r.parts.filter(p=>p.value!==null),on=ok.filter(p=>!isOff(p));
 const cut=on.length<ok.length,weights=on.reduce((s,p)=>s+p.weight,0),pts=(p:P)=>p.weight*(p.value as number)/2/weights*100;
 const parts=r.parts.map(p=>({...p,off:isOff(p),contribution:isOff(p)||p.contribution===null?null:cut?round(pts(p),2):p.contribution}));
 // pozastavené skóre (chybí podklady) zůstává pozastavené; vše dostupné vypnuto → bez skóre
 const score=!cut?r.score:r.score===null||!weights?null:round(on.reduce((s,p)=>s+pts(p),0),1);
 return {parts,score,cut,coverage:cut?weights:r.coverage,points:round(on.reduce((s,p)=>s+(p.value as number),0),4),counted:on.length,offCount:r.parts.filter(isOff).length};
}
