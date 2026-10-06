import type {FundamentalData} from './fundamentals';
import type {MarketData} from './score-engine';
import type {marketScore} from './markets';
export type Row={id:string;name:string;group:string;r:ReturnType<typeof marketScore>};
export type SnapshotLike={at:string;scores:Record<string,{score:number|null;method:string}>};
export type HistoryLike={snapshots:SnapshotLike[]};
export type Range='1w'|'1m'|'3m'|'all';
export function greeting(now:Date){const h=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',hour:'numeric',hour12:false}).format(now));return h>=5&&h<11?'Dobré ráno':h>=11&&h<18?'Dobré odpoledne':'Dobrý večer'}
export function vocative(name:string){const n=name.trim().split(/\s+/)[0]||'tradere';if(/^Jind[rř]ich$/i.test(n)||/^Jindra$/i.test(n))return 'Jindro';if(/a$/i.test(n))return n.slice(0,-1)+'o';if(/[^aeiouy]$/i.test(n)&&!/(ch|k|h|g)$/i.test(n))return n+'e';if(/(k|h|g|ch)$/i.test(n))return n+'u';return n}
export function kpis(rows:Row[],flags:Record<string,string>){
 const scored=rows.filter(r=>r.r.score!==null);
 const bullish=scored.filter(r=>(r.r.score as number)>0).length,bearish=scored.filter(r=>(r.r.score as number)<0).length;
 const strongest=scored.reduce<Row|null>((b,r)=>!b||Math.abs(r.r.score as number)>Math.abs(b.r.score as number)?r:b,null);
 const freshness=rows.length?Math.round(100*rows.filter(r=>r.r.coverage===100).length/rows.length):0;
 const active=Object.entries(flags).filter(([,f])=>f&&f!=='none');
 return {bullish,bearish,strongest,freshness,scored:scored.length,total:rows.length,flagged:active.length,inTrade:active.filter(([,f])=>f==='green').length,waiting:active.filter(([,f])=>f==='red').length,looking:active.filter(([,f])=>f==='orange').length};
}
export function bullishTrail(history:HistoryLike,points=10){return history.snapshots.slice(-points).map(s=>Object.values(s.scores).filter(x=>x.score!==null&&x.score>0).length)}
export function bearishTrail(history:HistoryLike,points=10){return history.snapshots.slice(-points).map(s=>Object.values(s.scores).filter(x=>x.score!==null&&x.score<0).length)}
export function scoreSeries(history:HistoryLike,instrument:string,method:string,range:Range,now:number){
 const days={'1w':7,'1m':30,'3m':92,all:Infinity}[range],from=now-days*86400000;
 return history.snapshots.filter(s=>s.scores[instrument]?.method===method&&s.scores[instrument].score!==null&&(range==='all'||Date.parse(s.at)>=from)).map(s=>({at:s.at,score:s.scores[instrument].score as number}));
}
export type Health={label:string;ok:boolean;detail:string;usage:number};
const ageHours=(stamp:string|undefined,now:number)=>{const t=Date.parse(stamp||'');return Number.isFinite(t)?Math.max(0,(now-t)/3600000):Infinity};
const latest=(stamps:(string|undefined)[])=>stamps.filter((s):s is string=>!!s).sort().at(-1);
export const relative=(h:number)=>h===Infinity?'bez záznamu':h<1?'před chvílí':h<48?`před ${Math.round(h)} h`:`před ${Math.round(h/24)} dny`;
export function dataHealth(data:FundamentalData,market:MarketData,now:number):Health[]{
 const mk=(label:string,a:number,limit:number,extra:string):Health=>({label,ok:a<=limit,detail:relative(a)+' · '+extra,usage:a===Infinity?100:Math.min(100,Math.round(100*a/limit))});
 const fl=data.staleAfterHours||72;
 const issues=market.refresh?.issues?.length||0;
 return [
  mk('Fundament',ageHours(data.checkedAt,now),fl,`limit ${fl} h`),
  mk('COT report',ageHours(latest(Object.values(market.cot||{}).map(x=>x.history.at(-1)?.date)),now),11*24,'limit 11 dní'),
  mk('Cenové řady',ageHours(latest(Object.values(market.prices||{}).map(x=>x.asOf)),now),7*24,'limit 7 dní'),
  mk('Kontrola podkladů',ageHours(market.refresh?.attemptedAt,now),4,issues?`${issues} zdrojů čeká na obnovu`:'každé 4 h'),
 ];
}
export type Change={at:string;instrument:string;from:number|null;to:number|null;delta:number};
export function recentChanges(history:HistoryLike,limit=5):Change[]{
 const [prev,cur]=history.snapshots.slice(-2);if(!prev||!cur)return [];
 return Object.entries(cur.scores).map(([id,s])=>{const from=prev.scores[id]?.score??null,to=s.score;return {at:cur.at,instrument:id,from,to,delta:from!==null&&to!==null?to-from:0}}).filter(x=>x.from!==x.to).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,limit);
}
// Šíře trhu: kolik trhů se skóre je bullish a kolik bearish.
export type Breadth={bull:number;bear:number;flat:number;scored:number;summary:string};
export function breadth(rows:Row[]):Breadth{
 const s=rows.filter(r=>r.r.score!==null),bull=s.filter(r=>(r.r.score as number)>0).length,bear=s.filter(r=>(r.r.score as number)<0).length,gap=Math.abs(bull-bear);
 const summary=bull===bear?'Vyrovnaný poměr':`${gap<=2?'Mírná':gap<=6?'Zřetelná':'Výrazná'} převaha ${bull>bear?'bullish':'bearish'}`;
 return {bull,bear,flat:s.length-bull-bear,scored:s.length,summary};
}
export function topSignals(rows:Row[],limit=5){
 const s=rows.filter(r=>r.r.score!==null&&r.r.score!==0);
 return {bull:s.filter(r=>(r.r.score as number)>0).sort((a,b)=>(b.r.score as number)-(a.r.score as number)).slice(0,limit),bear:s.filter(r=>(r.r.score as number)<0).sort((a,b)=>(a.r.score as number)-(b.r.score as number)).slice(0,limit)};
}
// Obchodní seance FX v místním čase burzovních center; časová osa a stavy v pražském čase.
export type SessionState={id:string;city:string;open:boolean;start:number;length:number;label:string};
const SESSIONS=[{id:'sydney',city:'Sydney',tz:'Australia/Sydney',from:7,to:16},{id:'tokyo',city:'Tokio',tz:'Asia/Tokyo',from:9,to:18},{id:'london',city:'Londýn',tz:'Europe/London',from:8,to:17},{id:'newyork',city:'New York',tz:'America/New_York',from:8,to:17}];
const WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],WD_CS=['ne','po','út','st','čt','pá','so'];
function clock(tz:string,now:number){const f=new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',hour:'numeric',minute:'numeric',hour12:false}).formatToParts(new Date(now)),g=(t:string)=>f.find(p=>p.type===t)?.value||'0';return {wd:WD.indexOf(g('weekday')),min:Number(g('hour'))%24*60+Number(g('minute'))}}
const hm=(m:number)=>`${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`;
const span=(m:number)=>m<60?`${m} min`:`${Math.floor(m/60)} h${m%60?' '+m%60+' min':''}`;
export function sessions(now:number){
 const prg=clock('Europe/Prague',now),pragueWeek=prg.wd*1440+prg.min;
 // FX týden běží od neděle 17:00 do pátku 17:00 newyorského času; mimo něj žádná seance neobchoduje.
 const ny=clock('America/New_York',now),fxOpen=!(ny.wd===6||(ny.wd===5&&ny.min>=17*60)||(ny.wd===0&&ny.min<17*60));
 const at=(inMin:number)=>{const t=pragueWeek+inMin,d=Math.floor(t/1440)%7;return (Math.floor(t/1440)===prg.wd?'':WD_CS[d]+' ')+hm(t%1440)};
 const list:SessionState[]=SESSIONS.map(s=>{
  const c=clock(s.tz,now),diff=((c.wd*1440+c.min-pragueWeek)%10080+10080+5040)%10080-5040,weekday=c.wd>=1&&c.wd<=5;
  const hours=weekday&&c.min>=s.from*60&&c.min<s.to*60,open=hours&&fxOpen;
  let label;if(hours&&!fxOpen)label='čeká na otevření FX';else if(open)label='zavírá za '+span(s.to*60-c.min);else{let days=c.min<s.from*60&&weekday?0:1;while(((c.wd+days)%7+7)%7===0||(c.wd+days)%7===6)days++;label='otevírá '+at(days*1440+s.from*60-c.min)}
  return {id:s.id,city:s.city,open,start:((s.from*60-diff)%1440+1440)%1440,length:(s.to-s.from)*60,label};
 });
 return {list,nowMin:prg.min,fxOpen};
}
export function upcomingEvents(data:FundamentalData,now:number,limit:number){return [...data.events].filter(e=>Date.parse(e.at)>=now-3*3600000).sort((a,b)=>a.at.localeCompare(b.at)).slice(0,limit)}
export const importanceLabel=(s:string)=>/high|vysok/i.test(s)?['high','Vysoká']:/med|stř/i.test(s)?['medium','Střední']:['low','Nízká'];
