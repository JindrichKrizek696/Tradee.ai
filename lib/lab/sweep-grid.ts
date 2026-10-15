// Laboratoř · Hledání prahů – grid parametrů, popisky a index kombinací (lehký modul bez závislostí, používá ho i stránka).
// Engine a popis signálu/provedení: lib/lab/sweep.ts.
export const SWEEP_VERSION='sweep-v1';
export const SWEEP_WEIGHTS={trend:15,cot:15,season:5} as const;
export type SweepEntry='immediate'|'pullback'|'contra';
export type SweepExit='tp1.5'|'tp2'|'tp3'|'signal';
export type SweepSet='fx'|'ci'|'all';
export type SweepCombo={threshold:number;entry:SweepEntry;slAtr:number;exit:SweepExit;hold:number;corrCap:boolean;cooldown:boolean;set:SweepSet};
export const SWEEP_GRID={
 threshold:[30,40,50,60,70,80],
 entry:['immediate','pullback','contra'] as SweepEntry[],
 slAtr:[1,1.5,2],
 exit:['tp1.5','tp2','tp3','signal'] as SweepExit[],
 hold:[5,10,20],
 corrCap:[false,true],
 cooldown:[false,true],
 set:['fx','ci','all'] as SweepSet[],
};
export const SWEEP_DIMS=['threshold','entry','slAtr','exit','hold','corrCap','cooldown','set'] as const;
export type SweepDim=typeof SWEEP_DIMS[number];
export const SWEEP_SIZE=SWEEP_DIMS.reduce((n,k)=>n*SWEEP_GRID[k].length,1);
export const ENTRY_LABELS:Record<SweepEntry,string>={immediate:'Hned',pullback:'Pullback',contra:'Kontra'};
export const EXIT_LABELS:Record<SweepExit,string>={'tp1.5':'TP 1,5 R','tp2':'TP 2 R','tp3':'TP 3 R',signal:'Signálem (bez TP)'};
export const SET_LABELS:Record<SweepSet,string>={fx:'FX páry (28)',ci:'Komodity + indexy',all:'Vše'};
export const tpOf=(e:SweepExit)=>e==='signal'?null:Number(e.slice(2));
export const SWEEP_COMMODITIES=['GC=F','SI=F','CL=F','BZ=F'],SWEEP_INDICES=['^NDX','^GSPC'];
export const PULLBACK_BARS=5,CONTRA_EXT=2,MAX_OPEN=5,CAP_PER_GROUP=2,COOLDOWN_DAYS=5,MIN_OOS_TRADES=60,MIN_OOS_PF=1.1;
export const IS_FROM='2015-01-01',OOS_FROM='2023-01-01';

// ---- index kombinace (smíšená soustava, první dimenze se mění nejrychleji)
export function comboAt(i:number):SweepCombo{
 const o:Record<string,unknown>={};let x=i;
 for(const k of SWEEP_DIMS){const a=SWEEP_GRID[k] as readonly unknown[];o[k]=a[x%a.length];x=Math.floor(x/a.length)}
 return o as SweepCombo;
}
export function comboIndex(c:SweepCombo):number{
 let i=0,mul=1;
 for(const k of SWEEP_DIMS){const a=SWEEP_GRID[k] as readonly unknown[],j=a.indexOf(c[k]);if(j<0)return -1;i+=j*mul;mul*=a.length}
 return i;
}
export function comboKey(c:SweepCombo){return `${c.set}·${ENTRY_LABELS[c.entry]}·práh ${c.threshold}·SL ${c.slAtr} ATR·${EXIT_LABELS[c.exit]}·max ${c.hold} d${c.corrCap?'·kor. limit':''}${c.cooldown?'·ochlazení':''}`}
export function normalizeCombo(raw:unknown):SweepCombo|null{
 const x=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>,o:Record<string,unknown>={};
 for(const k of SWEEP_DIMS){const a=SWEEP_GRID[k] as readonly unknown[];if(!a.includes(x[k]))return null;o[k]=x[k]}
 return o as SweepCombo;
}
// sousedé: ±1 krok v číselných dimenzích (práh, SL, TP v R mezi TP variantami, držení); ostatní dimenze stejné
export function neighbours(i:number):number[]{
 const c=comboAt(i),out:number[]=[];
 const step=(k:'threshold'|'slAtr'|'hold')=>{const a=SWEEP_GRID[k],j=a.indexOf(c[k]);for(const d of [-1,1])if(a[j+d]!==undefined)out.push(comboIndex({...c,[k]:a[j+d]}))};
 step('threshold');step('slAtr');step('hold');
 const tps=['tp1.5','tp2','tp3'] as SweepExit[],j=tps.indexOf(c.exit);
 if(j>=0)for(const d of [-1,1])if(tps[j+d])out.push(comboIndex({...c,exit:tps[j+d]}));
 return out;
}
export const median=(v:number[])=>{if(!v.length)return null;const s=[...v].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};

