export const coreFactors = [
  {id:'decision',label:'Poslední krok sazeb',weight:2,rule:'+1 zvýšení, 0 ponechání, −1 snížení; nejde o překvapení vůči konsensu.'},
  {id:'guidance',label:'Výhled měnové politiky',weight:2,rule:'+1 explicitní výhled dalšího zpřísnění, 0 bez směrového závazku, −1 výhled uvolnění.'},
  {id:'activity',label:'Ekonomická aktivita',weight:1,rule:'+1 jasná odolnost nebo širší oživení, 0 smíšený obraz, −1 slabost nebo zpomalení pod potenciál.'},
  {id:'labor',label:'Pracovní trh',weight:1,rule:'+1 robustní nebo napjatý, 0 stabilní bez převahy, −1 utlumený či s volnou kapacitou.'},
] as const;
export type CoreFactor=typeof coreFactors[number]['id'];
export type Observation={value:string|null;period:string|null;checkedAt:string|null;sourceUrl:string;note:string};
export type FundamentalData={pairObservations?:Record<string,Record<string,Observation>>;indicators?:{id:string;label:string;description:string;sourceUrl:string}[];observations?:Record<string,Record<string,{value:string|null;period:string|null;checkedAt:string|null;sourceUrl:string;note:string}>>;schemaVersion:number;methodVersion:string;checkedAt:string;reviewCadenceHours:number;staleAfterHours:number;horizon:string;coverageNote:string;sources:Record<string,{label:string;url:string;publishedAt:string|null;checkedAt:string}>;currencies:Record<string,{bank:string;rate:string;decisionDate:string;source:string;facts:string[];scenario:string;risk:string;factors:Record<CoreFactor,{value:number|null;reason:string;source:string}>}>;events:{id:string;currency:string;at:string;title:string;source:string;watch:string;timeKnown:boolean;importance:string;consensus:string|null;actual:string|null}[];institutions:{name:string;date:string;source:string;currencies:string[];view:string;caveat:string}[];changes:{at:string;title:string;body:string}[];history:{at:string;methodVersion:string;values:Record<string,Record<CoreFactor,number|null>>}[]};
export function fundamentalScore(data:FundamentalData,instrument:string,now=Date.now()){
 if(instrument.split('/').length>2)throw new Error('Neplatný pár');const [base,quote]=instrument.split('/');const keys=Object.keys(data.currencies);if(!keys.includes(base)||(quote&&!keys.includes(quote))||base===quote)throw new Error('Neplatná měna');
 const comparison=quote?[quote]:keys.filter(c=>c!==base);const participants=[base,...comparison];
 const stale=!Number.isFinite(Date.parse(data.checkedAt))||now-Date.parse(data.checkedAt)>data.staleAfterHours*3600000;
 const parts=coreFactors.map(f=>{const observations=participants.map(c=>data.currencies[c].factors[f.id]);const valid=observations.every(x=>x&&x.value!==null&&Number.isFinite(x.value)&&[-1,0,1].includes(x.value)&&data.sources[x.source]&&now-Date.parse(data.sources[x.source].checkedAt)<=data.staleAfterHours*3600000);const value=valid?((observations[0].value as number)-observations.slice(1).reduce((s,x)=>s+(x.value as number),0)/comparison.length)*f.weight:null;return {...f,value:value===null?null:Math.round(value*10)/10}});
 const available=parts.filter(p=>p.value!==null).length;const score=available===4&&!stale?Math.round(parts.reduce((s,p)=>s+(p.value||0),0)*10)/10:null;
 return {score,parts,available,stale,base,quote,comparison,bias:score===null?'Neověřeno':score>0?'Bullish':score<0?'Bearish':'Vyrovnané'};
}
