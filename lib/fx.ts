// Přepočet měn přes kurzy ECB (per_eur = kolik jednotek měny za 1 EUR).
export const CURRENCIES=['USD','EUR','CZK','GBP','CHF','JPY','AUD','CAD','NZD','PLN'] as const;
export const isCurrency=(c:unknown):c is string=>typeof c==='string'&&(CURRENCIES as readonly string[]).includes(c);
export type FxRow={date:string;currency:string;per_eur:number};
export type Rates=Map<string,{date:string;v:number}[]>;
export function makeRates(rows:FxRow[]):Rates{
 const by:Rates=new Map();
 for(const r of rows){const l=by.get(r.currency)||[];l.push({date:String(r.date).slice(0,10),v:Number(r.per_eur)});by.set(r.currency,l)}
 for(const l of by.values())l.sort((a,b)=>a.date.localeCompare(b.date));
 return by;
}
// Kurz platný k datu = poslední známý ≤ datum; před první hodnotou se použije první (starší obchody než historie kurzů).
export function rateOn(rates:Rates,currency:string,date:string):number|null{
 if(currency==='EUR')return 1;
 const l=rates.get(currency);if(!l||!l.length)return null;
 let lo=0,hi=l.length-1,ans=0;
 while(lo<=hi){const m=(lo+hi)>>1;if(l[m].date<=date){ans=m;lo=m+1}else hi=m-1}
 return l[ans].v;
}
export function convert(amount:number,from:string,to:string,date:string,rates:Rates):number|null{
 if(from===to)return amount;
 const a=rateOn(rates,from,date),b=rateOn(rates,to,date);
 return a&&b?Math.round(amount/a*b*100)/100:null;
}
