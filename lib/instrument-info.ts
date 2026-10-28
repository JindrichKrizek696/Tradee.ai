// Identita instrumentů: odkud bereme cenu (poskytovatel, symbol, typ, zpoždění) a aliasy pro hledání (NQ, US100, XAUUSD…).
// Čisté funkce bez závislostí (klient i skripty); testy scripts/check-search.mjs a scripts/check-market-view.mjs.
// Pozor: id trhů (GC=F, ^NDX…) se nemění – simulace a historie skóre na nich stojí. Mění se jen to, co UI říká.

/** FX páry mimo 8měnový model (bez fundamentu a COT): jen technický model. Do měnových indexů, skóre v3 ani Laboratoře nevstupují. */
export const TECH_FX=['USD/CZK'] as const;
export const isTechFx=(id:string)=>(TECH_FX as readonly string[]).includes(id);
/** Yahoo symbol tam, kde neplatí pravidlo EURUSD=X (USD/CZK je na Yahoo kanonicky CZK=X). */
export const YAHOO_OVERRIDE:Record<string,string>={'USD/CZK':'CZK=X'};

export type SourceType='spot'|'futures'|'index'|'CFD'|'akcie'|'krypto'|'vlastní index';
export type DataSource={
 provider:string;symbol:string;type:SourceType;
 /** krátký popis do odznaku, např. „COMEX futures GC=F (Yahoo)“ */
 short:string;
 /** čím se cena liší od toho, co trader vidí u brokera; null = nic podstatného */
 note:string|null;
 delay:string;
};
const LIVE='živé ceny Tradee se obnovují po 15 min';
const FUT:Record<string,{ex:string;what:string;cfd:string}>={
 'GC=F':{ex:'COMEX',what:'zlato',cfd:'XAUUSD'},
 'SI=F':{ex:'COMEX',what:'stříbro',cfd:'XAGUSD'},
 'CL=F':{ex:'NYMEX',what:'ropa WTI',cfd:'USOIL / WTI'},
 'BZ=F':{ex:'NYMEX',what:'ropa Brent',cfd:'UKOIL / Brent'},
};
const IDX:Record<string,{name:string;fut:string;cfd:string}>={
 '^NDX':{name:'Nasdaq 100',fut:'NQ',cfd:'US100 / NAS100'},
 '^GSPC':{name:'S&P 500',fut:'ES',cfd:'US500 / SPX500'},
};
const FX_CURRENCIES=['USD','EUR','GBP','CHF','JPY','CAD','AUD','NZD'];

/** Zdroj ceny trhu pro odznak „zdroj dat“. Neznámé id → null. */
export function dataSource(id:string):DataSource|null{
 if(FX_CURRENCIES.includes(id))return {provider:'Tradee (výpočet z FX párů)',symbol:id,type:'vlastní index',short:`vlastní index ${id} z 7 FX párů`,note:'není to burzovní index (např. DXY), jen průměr páru vůči 7 měnám',delay:LIVE};
 const f=FUT[id];
 if(f)return {provider:'Yahoo Finance',symbol:id,type:'futures',short:`${f.ex} futures ${id} (Yahoo)`,note:`cena se liší od spotu/CFD u brokera (${f.cfd}) – futures mají basis a roll kontraktu`,delay:'Yahoo zpožďuje futures ~10 min; '+LIVE};
 const x=IDX[id];
 if(x)return {provider:'Yahoo Finance',symbol:id,type:'index',short:`index ${x.name} ${id} (Yahoo)`,note:`hotovostní index, ne futures ${x.fut} ani CFD ${x.cfd} – ty se od indexu liší (fair value, dividendy, swap)`,delay:LIVE};
 if(/^[A-Z]{3}\/[A-Z]{3}$/.test(id)){const sym=YAHOO_OVERRIDE[id]??id.replace('/','')+'=X';
  return {provider:'Yahoo Finance',symbol:sym,type:'spot',short:`FX kurz ${sym} (Yahoo)`,note:'indikativní mezibankovní kurz; broker má vlastní bid/ask a spread',delay:LIVE}}
 if(id.endsWith('-USD'))return {provider:'Yahoo Finance (alerty Binance)',symbol:id,type:'krypto',short:`krypto ${id} (Yahoo)`,note:'agregovaná spotová cena; alerty hlídají Binance '+id.replace('-USD','USDT'),delay:LIVE};
 if(/^[A-Z][A-Z.-]{0,5}$/.test(id))return {provider:'Yahoo Finance',symbol:id,type:'akcie',short:`akcie ${id} (Yahoo, US burza)`,note:'CFD na akcie u brokera mohou mít jinou cenu mimo obchodní hodiny',delay:LIVE};
 return null;
}
/** Text odznaku: „Data: COMEX futures GC=F (Yahoo), cena se liší od spotu/CFD u brokera“. */
export function sourceBadgeText(id:string):string{
 const s=dataSource(id);if(!s)return '';
 const short=s.type==='futures'?'cena se liší od spotu/CFD u brokera':s.type==='index'?'ne futures ani CFD':null;
 return 'Data: '+s.short+(short?', '+short:'');
}
/** Víceřádkový tooltip: poskytovatel, symbol, typ, zpoždění, rozdíl proti brokerovi. */
export function sourceTooltip(id:string):string{
 const s=dataSource(id);if(!s)return '';
 return [`Poskytovatel: ${s.provider}`,`Symbol: ${s.symbol}`,`Typ: ${s.type}`,`Zpoždění: ${s.delay}`,...(s.note?[`Pozor: ${s.note}`]:[])].join('\n');
}

// ---- aliasy hledání
export type Alias={id:string;label:string;hint?:string};
const A=(keys:string,id:string,label:string,hint?:string):[string,Alias][]=>keys.split(' ').map(k=>[k,{id,label,...(hint?{hint}:{})}]);
const NQ_HINT='NQ (futures) Tradee nemá – zobrazujeme index Nasdaq 100 (^NDX)';
const ES_HINT='ES (futures) Tradee nemá – zobrazujeme index S&P 500 (^GSPC)';
/** klíč = velká písmena a číslice bez mezer a interpunkce */
export const ALIASES:Record<string,Alias>=Object.fromEntries([
 ...A('NQ',  '^NDX','Nasdaq 100',NQ_HINT),
 ...A('NAS100 US100 USTEC TECH100 NDX NASDAQ NASDAQ100 USTECH','^NDX','Nasdaq 100'),
 ...A('ES','^GSPC','S&P 500',ES_HINT),
 ...A('SPX US500 SP500 SPX500 GSPC USA500','^GSPC','S&P 500'),
 ...A('GOLD XAUUSD XAU GC','GC=F','zlato'),
 ...A('SILVER XAGUSD XAG SI','SI=F','stříbro'),
 ...A('WTI USOIL CL XTIUSD CRUDE','CL=F','ropa WTI'),
 ...A('BRENT UKOIL BZ XBRUSD','BZ=F','ropa Brent'),
 ...A('BTC XBT BTCUSD XBTUSD BITCOIN','BTC-USD','Bitcoin'),
 ...A('ETH ETHUSD ETHER','ETH-USD','Ethereum'),
 ...A('SOL SOLUSD','SOL-USD','Solana'),
 ...A('DXY USDX','USD','USD index','DXY (ICE) Tradee nemá – zobrazujeme vlastní měnový index USD'),
 ...A('USDCZK CZK KORUNA','USD/CZK','USD/CZK'),
]);
const key=(q:string)=>q.normalize('NFD').replace(/\p{M}/gu,'').toUpperCase().replace(/[^A-Z0-9]+/g,'');
/** Přesný alias dotazu (nq, us100, xauusd…) → trh; jinak null. */
export function resolveAlias(q:string):Alias|null{const k=key(q);return k&&Object.hasOwn(ALIASES,k)?ALIASES[k]:null}
/** Aliasové výrazy trhu do klíčových slov hledání. */
export const aliasWords=(id:string)=>Object.entries(ALIASES).filter(([,a])=>a.id===id).map(([k])=>k.toLowerCase()).join(' ');
const lev=(a:string,b:string)=>{const d=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let p=d[0];d[0]=i;for(let j=1;j<=b.length;j++){const t=d[j];d[j]=Math.min(d[j]+1,d[j-1]+1,p+(a[i-1]===b[j-1]?0:1));p=t}}return d[b.length]};
/** Nejbližší aliasy k dotazu bez výsledku (překlep, začátek názvu): [{key:'NAS100',…}] max. n, různé trhy. */
export function suggestAliases(q:string,n=3):(Alias&{key:string})[]{
 const k=key(q);if(k.length<2)return [];
 const scored=Object.entries(ALIASES).map(([a,al])=>({key:a,...al,d:a.startsWith(k)?0:k.startsWith(a)&&a.length>=3?1:lev(k,a)})).filter(x=>x.d<=Math.max(1,Math.floor(k.length/3))).sort((a,b)=>a.d-b.d||a.key.length-b.key.length);
 const out:(Alias&{key:string})[]=[];for(const x of scored){if(out.some(o=>o.id===x.id))continue;out.push({key:x.key,id:x.id,label:x.label,...(x.hint?{hint:x.hint}:{})});if(out.length>=n)break}
 return out;
}
