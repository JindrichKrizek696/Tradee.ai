// Obchodní hodiny burz (akcie a indexy) a krypta 24/7: otevřeno / zavřeno, příští otevření či zavření a časová osa
// v pražském čase. Pravidelné hodiny v místním čase burzy po–pá, letní čas podle IANA zón (USA a Evropa přecházejí
// v jiné týdny, Japonsko vůbec); svátky, aukce a mimořádné seance se neřeší. FX seance: sessions() v lib/dashboard.ts.
// Kontrola: node --experimental-strip-types scripts/check-market-hours.mjs
export type Venue={id:string;city:string;name:string;tz:string;/** minuty místního času [od, do) */sessions:[number,number][]};
export const EXCHANGES:Venue[]=[
 {id:'tse',city:'Tokio',name:'TSE',tz:'Asia/Tokyo',sessions:[[540,690],[750,930]]},// 9:00–11:30, polední pauza, 12:30–15:30
 {id:'xetra',city:'Frankfurt',name:'Xetra',tz:'Europe/Berlin',sessions:[[540,1050]]},// 9:00–17:30
 {id:'lse',city:'Londýn',name:'LSE',tz:'Europe/London',sessions:[[480,990]]},// 8:00–16:30
 {id:'nyse',city:'New York',name:'NYSE · Nasdaq',tz:'America/New_York',sessions:[[570,960]]},// 9:30–16:00
];
export type VenueState={id:string;city:string;name:string;open:boolean;lunch:boolean;/** okamžik příští změny (ms); null = nonstop */next:number|null;label:string;/** časová osa: [začátek, délka] v minutách pražského dne */segs:[number,number][]};
export const CRYPTO:VenueState={id:'crypto',city:'Krypto',name:'BTC · ETH · SOL',open:true,lunch:false,next:null,label:'nonstop 24/7, i o víkendu',segs:[[0,1440]]};

const MIN=60000,WD_CS=['ne','po','út','st','čt','pá','so'],fmts=new Map<string,Intl.DateTimeFormat>();
/** Místní datum, den v týdnu (0 = ne) a minuta dne v zóně tz. */
export function local(tz:string,t:number){
 let f=fmts.get(tz);if(!f)fmts.set(tz,f=new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',hourCycle:'h23'}));
 const p=f.formatToParts(new Date(t)),g=(x:string)=>Number(p.find(q=>q.type===x)?.value||0),y=g('year'),mo=g('month'),d=g('day');
 return {y,mo,d,wd:new Date(Date.UTC(y,mo-1,d)).getUTCDay(),min:g('hour')%24*60+g('minute')};
}
/** Posun zóny vůči UTC v minutách v okamžiku t (Praha v létě +120). */
export function offset(tz:string,t:number){const l=local(tz,t);return Math.round((Date.UTC(l.y,l.mo-1,l.d,0,l.min)-Math.floor(t/MIN)*MIN)/MIN)}
/** Okamžik (ms) místního času y-mo-d + min v zóně tz; posun se ověří až v cílovém okamžiku (přechod na letní čas). */
export function zoned(tz:string,y:number,mo:number,d:number,min:number){const g=Date.UTC(y,mo-1,d,0,min),t=g-offset(tz,g)*MIN;return g-offset(tz,t)*MIN}

const hm=(m:number)=>`${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`;
const span=(m:number)=>m<60?`${m} min`:`${Math.floor(m/60)} h${m%60?' '+m%60+' min':''}`;
/** Čas v Praze; jiný pražský den než dnes → se zkratkou dne („po 1:00“). */
export function pragueAt(t:number,now:number){const a=local('Europe/Prague',t),b=local('Europe/Prague',now);return (a.y===b.y&&a.mo===b.mo&&a.d===b.d?'':WD_CS[a.wd]+' ')+hm(a.min)}

/** Seance burzy v okolí `now` (od včerejška na 8 dní dopředu, jen po–pá) jako okamžiky [od, do). */
function intervals(v:Venue,now:number){
 const l=local(v.tz,now),out:{from:number;to:number;day:number}[]=[];
 for(let k=-1;k<=8;k++){const day=new Date(Date.UTC(l.y,l.mo-1,l.d+k)),wd=day.getUTCDay();if(wd===0||wd===6)continue;
  for(const [a,b] of v.sessions)out.push({from:zoned(v.tz,day.getUTCFullYear(),day.getUTCMonth()+1,day.getUTCDate(),a),to:zoned(v.tz,day.getUTCFullYear(),day.getUTCMonth()+1,day.getUTCDate(),b),day:k})}
 return out;
}
export function venueState(v:Venue,now:number):VenueState{
 const list=intervals(v,now),cur=list.find(s=>s.from<=now&&now<s.to),nxt=list.find(s=>s.from>now)!;
 // polední pauza = mezi dvěma seancemi téhož místního dne
 const lunch=!cur&&list.some(s=>s.day===nxt.day&&s.to<=now),brk=!!cur&&list.some(s=>s.day===cur.day&&s.from>=cur.to);
 const next=cur?cur.to:nxt.from,left=Math.ceil((next-now)/MIN);
 const label=cur?(brk?'pauza za ':'zavírá za ')+span(left):(lunch?'polední pauza · otevírá ':'otevírá ')+pragueAt(next,now);
 // časová osa jako u FX: pravidelné hodiny převedené dnešním rozdílem posunů zóny a Prahy
 const diff=offset(v.tz,now)-offset('Europe/Prague',now);
 return {id:v.id,city:v.city,name:v.name,open:!!cur,lunch,next,label,segs:v.sessions.map(([a,b])=>[((a-diff)%1440+1440)%1440,b-a] as [number,number])};
}
/** Akcie a indexy: stav všech burz a souhrn pro odznak skupiny. */
export function exchanges(now:number){
 const list=EXCHANGES.map(v=>venueState(v,now)),open=list.filter(x=>x.open).length;
 return {list,open,label:open?`Burzy otevřené ${open}/${list.length}`:'Burzy zavřené'};
}

// ---- Obchodní hodiny pro simulaci Laboratoře (lib/lab/paper.ts): smí se v daném okamžiku otevírat / zavírat obchod?
// Yahoo o víkendu publikuje orientační FX kotace, takže test „cena starší než 2 h“ zavřený trh nepozná → pevný kalendář.
// FX páry, měnové indexy, komodity a neznámé trhy: ne 22:00 UTC → pá 21:00 UTC celoročně (bezpečně: o letním / zimním čase
// se tím ztratí nejvýš hodina na začátku nebo konci týdne). Komodity (CME futures GC/SI/CL/BZ) navíc denní pauza po–čt 21:00–22:00 UTC.
// Akcie a akciové indexy USA: NYSE 9:30–16:00 America/New_York po–pá mimo svátky (zkrácené seance se neřeší). Krypto 24/7.
const CURRENCIES=['USD','EUR','GBP','CHF','JPY','CAD','AUD','NZD']; // = lib/markets.ts fxCurrencies (bez importu – modul zůstává čistý)
export type MarketKind='fx'|'currency'|'commodities'|'index'|'stock'|'crypto';
const HOUR=3600000;
// skupina podle id (stejné dělení jako lib/markets.ts instruments a lib/lab/paper.ts marketGroup)
export function marketKind(id:string):MarketKind{
 if(/^[A-Z]{3}\/[A-Z]{3}$/.test(id))return 'fx';
 if(CURRENCIES.includes(id))return 'currency'; // ne /^[A-Z]{3}$/ – JPM je akcie
 if(id.startsWith('^'))return 'index';
 if(id.endsWith('=F'))return 'commodities';
 if(id.endsWith('-USD'))return 'crypto';
 return 'stock';
}
// svátky NYSE (celodenně zavřeno), místní datum New Yorku; přesunuté na pátek / pondělí, když svátek padne na víkend
export const US_HOLIDAYS=new Set([
 '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
 '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24',
]);
const iso=(y:number,mo:number,d:number)=>`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
/** NYSE pravidelná seance 9:30–16:00 New York, po–pá, mimo svátky. */
export function nyseOpen(t:number){const l=local('America/New_York',t);return l.wd>=1&&l.wd<=5&&l.min>=570&&l.min<960&&!US_HOLIDAYS.has(iso(l.y,l.mo,l.d))}
/** FX týden: ne 22:00 UTC → pá 21:00 UTC. */
export function fxOpen(t:number){const d=new Date(t),wd=d.getUTCDay(),h=d.getUTCHours();
 if(wd===6)return false;if(wd===0)return h>=22;if(wd===5)return h<21;return true}
/** Smí se na trhu v okamžiku t (ms, UTC) obchodovat? group = skupina z lib/markets.ts (bez ní podle id). */
export function isMarketOpen(id:string,group:string|null|undefined,t:number):boolean{
 const g=(group||marketKind(id)) as string;
 if(!Number.isFinite(t))return false;
 if(g==='crypto')return true;
 if(g==='stock'||g==='index')return nyseOpen(t);
 if(!fxOpen(t))return false;
 if(g==='commodities'){const d=new Date(t),wd=d.getUTCDay();if(wd>=1&&wd<=4&&d.getUTCHours()===21)return false}
 return true;
}
/** Byl trh mezi a (vyloučeno) a b (vyloučeno) někdy zavřený? Krok 15 min (zavřené úseky jsou celé hodiny / půlhodiny). */
export function closedBetween(id:string,group:string|null|undefined,a:number,b:number):boolean{
 if(!(b>a))return false;const STEP=HOUR/4;
 for(let x=Math.floor(a/STEP)*STEP+STEP;x<b;x+=STEP)if(!isMarketOpen(id,group,x))return true;
 return false;
}
