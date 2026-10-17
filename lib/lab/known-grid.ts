// Laboratoř · „Známé strategie“ – rodiny strategií, jejich malé gridy parametrů a české popisy (lehký modul bez závislostí, používá ho i stránka).
// Engine (signály, simulace, hranice náhody): lib/lab/known.ts. Runner: scripts/lab-known.mjs → tabulka lab_known (migrace 0030).
export const KNOWN_VERSION='known-v1';
export type KnownFamily='donchian'|'macross'|'tsmom'|'rsi'|'bollinger'|'keltner'|'carry'|'cot'|'season';
export type KnownSet='fx'|'ci'|'all';
export type KnownCombo={family:KnownFamily;v:string;slAtr:number;hold:number;set:KnownSet};
export type KnownFamilyDef={id:KnownFamily;label:string;desc:string;v:string[];vLabels:Record<string,string>;slAtr:number[];hold:number[];sets:KnownSet[];needs?:'cot'|'rates'};
// hold = nejdéle držených svíček (pojistka); u trendových rodin velké, výstup obvykle dá signál nebo SL
export const KNOWN_FAMILIES:KnownFamilyDef[]=[
 {id:'donchian',label:'Donchian / Turtle breakout',v:['20/10','55/20'],vLabels:{'20/10':'průraz 20 d, výstup 10 d','55/20':'průraz 55 d, výstup 20 d'},slAtr:[2,3],hold:[60],sets:['fx','ci','all'],
  desc:'Klasika želv (Turtle traders): long, když denní close překročí maximum předchozích N dní (short pod minimem). Výstup, když close projde opačným kanálem kratšího okna (10 / 20 dní). Stop 2–3 × ATR, žádný take profit – zisky nechává běžet.'},
 {id:'macross',label:'Křížení klouzavých průměrů',v:['10/50','20/100','50/200'],vLabels:{'10/50':'SMA 10 / 50','20/100':'SMA 20 / 100','50/200':'SMA 50 / 200 („golden cross“)'},slAtr:[2,4],hold:[120],sets:['fx','ci','all'],
  desc:'Long v den, kdy rychlý SMA překříží pomalý zdola (short shora). Výstup při opačném křížení (a případně hned vstup opačně). Pomalý trendový systém – málo obchodů, dlouhé držení.'},
 {id:'tsmom',label:'Time-series momentum 12-1',v:['12-1','6-1'],vLabels:{'12-1':'výnos 12 měsíců bez posledního','6-1':'výnos 6 měsíců bez posledního'},slAtr:[3,5],hold:[260],sets:['fx','ci','all'],
  desc:'Moskowitz/Ooi/Pedersen (2012): na začátku každého měsíce se spočítá výnos trhu za posledních 12 (6) měsíců bez posledního měsíce. Kladný → long, záporný → short; drží se do dalšího měsíčního přepočtu, kdy se znaménko otočí. Široký stop jen jako jednotka rizika.'},
 {id:'rsi',label:'RSI mean reversion s filtrem MA200',v:['rsi2','rsi14'],vLabels:{rsi2:'RSI(2) < 10 / > 90, výstup přes SMA5',rsi14:'RSI(14) < 30 / > 70, výstup RSI 50'},slAtr:[2,3],hold:[5,10],sets:['fx','ci','all'],
  desc:'Connors RSI(2): kupuje krátkodobé přeprodání jen v dlouhodobém uptrendu (close nad SMA200) a prodává překoupení v downtrendu. RSI(14) varianta je pomalejší klasika 30/70. Krátké držení, výstup návratem (close nad SMA5 / RSI přes 50) nebo po N dnech.'},
 {id:'bollinger',label:'Bollinger band reversion',v:['20/2','20/2.5'],vLabels:{'20/2':'SMA20 ± 2 σ','20/2.5':'SMA20 ± 2,5 σ'},slAtr:[2,3],hold:[10,20],sets:['fx','ci','all'],
  desc:'Návrat k průměru: close pod dolním pásmem (SMA20 − k·σ) → long, nad horním → short. Výstup, když se close vrátí ke středu pásma (SMA20), jinak SL nebo časový limit. Bez trendového filtru.'},
 {id:'keltner',label:'Keltner channel breakout',v:['20/1.5','20/2'],vLabels:{'20/1.5':'EMA20 ± 1,5 × ATR20','20/2':'EMA20 ± 2 × ATR20'},slAtr:[2,3],hold:[60],sets:['fx','ci','all'],
  desc:'Průraz volatilitního kanálu: close nad EMA20 + m·ATR → long, pod EMA20 − m·ATR → short. Výstup, když close projde zpět přes EMA20. Trendový systém s adaptivní šířkou kanálu.'},
 {id:'carry',label:'FX carry',v:['diff1','diff2'],vLabels:{diff1:'rozdíl sazeb ≥ 1 p. b.',diff2:'rozdíl sazeb ≥ 2 p. b.'},slAtr:[3,5],hold:[260],sets:['fx'],needs:'rates',
  desc:'Long měna s vyšší úrokovou sazbou proti měně s nižší (3M mezibankovní sazby OECD z FRED, měsíčně, použitelné až od 1. dne druhého měsíce po konci měsíce – bez look-ahead). Přepočet na začátku měsíce; pozice se drží, dokud rozdíl nespadne pod polovinu prahu nebo se neotočí. Úrokový výnos (swap) se NEPOČÍTÁ – test měří jen pohyb ceny, skutečný carry by byl o swap lepší.'},
 {id:'cot',label:'COT extrémy (kontra)',v:['90/10','80/20'],vLabels:{'90/10':'percentil ≥ 90 / ≤ 10','80/20':'percentil ≥ 80 / ≤ 20'},slAtr:[2,3],hold:[10,20],sets:['fx','ci','all'],needs:'cot',
  desc:'Proti davu spekulantů: čistá pozice leveraged funds (měny) / managed money (zlato, stříbro, ropa) v % open interestu; když je v percentilu ≥ 90 za 3 roky (extrémně long), jde short, ≤ 10 → long. U páru rozdíl obou měn (s USD jen cizí měna). Report platí až od pondělí 21:00 UTC po úterním datu. Výstup, když se percentil vrátí přes 50, jinak SL / čas.'},
 {id:'season',label:'Sezonalita (nejlepší / nejhorší měsíc)',v:['10y','15y'],vLabels:{'10y':'posledních 10 let','15y':'posledních 15 let (aspoň 10)'},slAtr:[2,3],hold:[25],sets:['fx','ci','all'],
  desc:'Na začátku měsíce: je-li to podle předchozích (ne aktuálního) 10 / 15 let historicky nejlepší měsíc trhu a průměr je kladný → long, nejhorší a záporný → short. Drží se do konce měsíce.'},
];
export const KNOWN_FAMILY_IDS=KNOWN_FAMILIES.map(f=>f.id);
export const familyDef=(id:string)=>KNOWN_FAMILIES.find(f=>f.id===id)??null;
export const KNOWN_SET_LABELS:Record<KnownSet,string>={fx:'FX páry (28)',ci:'Komodity + indexy',all:'Vše'};
// pevná pravidla provedení (stejná jako sweep: vstup na open další svíčky, spread, gapy; portfolio nejvýš 5 pozic, korelační limit zapnutý)
export const KNOWN_MAX_OPEN=5,KNOWN_CAP=2,KNOWN_MIN_OOS_TRADES=30,KNOWN_MIN_OOS_PF=1.1;
// všechny kombinace (pořadí = index)
export const KNOWN_COMBOS:KnownCombo[]=KNOWN_FAMILIES.flatMap(f=>f.sets.flatMap(set=>f.hold.flatMap(hold=>f.slAtr.flatMap(slAtr=>f.v.map(v=>({family:f.id,v,slAtr,hold,set}))))));
export const KNOWN_SIZE=KNOWN_COMBOS.length;
export const knownKey=(c:KnownCombo)=>`${familyDef(c.family)?.label??c.family} · ${familyDef(c.family)?.vLabels[c.v]??c.v} · SL ${c.slAtr} ATR · max ${c.hold} d · ${KNOWN_SET_LABELS[c.set]}`;
export const knownIndex=(c:KnownCombo)=>KNOWN_COMBOS.findIndex(x=>x.family===c.family&&x.v===c.v&&x.slAtr===c.slAtr&&x.hold===c.hold&&x.set===c.set);
// sousedé: stejná rodina a sada, ±1 krok ve variantě, SL a držení
export function knownNeighbours(i:number):number[]{
 const c=KNOWN_COMBOS[i],f=familyDef(c.family)!,out:number[]=[];
 const step=<K extends 'v'|'slAtr'|'hold'>(k:K,list:KnownCombo[K][])=>{const j=list.indexOf(c[k]);for(const d of [-1,1])if(list[j+d]!==undefined){const n=knownIndex({...c,[k]:list[j+d]});if(n>=0)out.push(n)}};
 step('v',f.v);step('slAtr',f.slAtr);step('hold',f.hold);
 return out;
}
