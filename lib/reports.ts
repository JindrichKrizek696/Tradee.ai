// Čistá logika stránky Reporty (přehled bank, kalendář, retail) – kontrola: scripts/check-reports.mjs
type Factor={value:number|null;reason:string;source:string};
type Event={id:string;currency?:string;at:string;title:string;importance?:string};
export type Tone='hawk'|'dove'|'neutral'|'unknown';

export function stance(v:number|null|undefined):{label:string;tone:Tone}{
 return v===1?{label:'Jestřábí',tone:'hawk'}:v===-1?{label:'Holubičí',tone:'dove'}:v===0?{label:'Neutrální',tone:'neutral'}:{label:'Neověřeno',tone:'unknown'};
}

/** Součet čtyř makro vstupů banky (-4…+4). Chybějící vstup se nenahrazuje nulou. */
export function mood(factors:Record<string,Factor>):{label:string;tone:Tone;score:number|null}{
 const vals=Object.values(factors).map(f=>f?.value);
 if(!vals.length||vals.some(v=>v===null||v===undefined))return {label:'Neověřeno',tone:'unknown',score:null};
 const s=(vals as number[]).reduce((a,b)=>a+b,0);
 return s>=2?{label:'Jestřábí',tone:'hawk',score:s}:s===1?{label:'Mírně jestřábí',tone:'hawk',score:s}:s<=-2?{label:'Holubičí',tone:'dove',score:s}:s===-1?{label:'Mírně holubičí',tone:'dove',score:s}:{label:'Neutrální',tone:'neutral',score:s};
}

const MEETING=/rozhodnutí|sazb|FOMC|OCR|zasedání/i;
export const isMeeting=(e:{title:string})=>MEETING.test(e.title);
/** Nejbližší budoucí rozhodnutí centrální banky pro měnu. */
export function nextMeeting<E extends Event>(events:E[],currency:string,now:number):E|undefined{
 return events.filter(e=>e.currency===currency&&isMeeting(e)&&Date.parse(e.at)>now).sort((a,b)=>a.at.localeCompare(b.at))[0];
}

/** Nadcházející události od nejbližší; proběhlé v posledních 3 h zůstávají kvůli výsledku. */
export function upcoming<E extends Event>(events:E[],now:number):E[]{
 return events.filter(e=>Date.parse(e.at)>now-3*3600000).sort((a,b)=>a.at.localeCompare(b.at));
}


/** "Long 87 % / short 13 %" → {long:87,short:13}; neznámý formát → null. */
export function parseRetail(value:string):{long:number;short:number}|null{
 const m=/long\s*([\d,.]+)\s*%.*?short\s*([\d,.]+)\s*%/i.exec(value||'');
 if(!m)return null;
 const n=(s:string)=>Number(s.replace(',','.'));
 const long=n(m[1]),short=n(m[2]);
 return Number.isFinite(long)&&Number.isFinite(short)?{long,short}:null;
}
