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
