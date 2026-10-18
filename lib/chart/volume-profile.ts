// Volume profile (fixed range i session): objem svíček rozdělený do cenových řádků, POC a value area jako v TradingView.
// Bez objemu (FX kříže, měnové indexy) se počítá čas na ceně (TPO: každá svíčka váží 1). Čisté funkce – testy scripts/check-volume-profile.mjs.
export type VpBar={time:number;open:number;high:number;low:number;close:number;volume?:number};
export type VpRow={lo:number;hi:number;up:number;down:number;total:number};
export type VpMode='volume'|'tpo';
export type Profile={rows:VpRow[];lo:number;hi:number;poc:number;pocIndex:number;vah:number;val:number;vaFrom:number;vaTo:number;total:number;max:number;mode:VpMode;bars:number};
export const VP_ROWS_MIN=4,VP_ROWS_MAX=200,VP_ROWS_DEFAULT=24,VP_VA_DEFAULT=70;

/** Objem je použitelný, když ho má aspoň 75 % svíček: futures u FX mají denní přestávku (~1 h bez objemu), ale archiv bez objemu by profil zkreslil. */
export function hasVolume(bars:readonly VpBar[]){
 if(!bars.length)return false;
 let n=0;for(const b of bars)if((b.volume??0)>0)n++;
 return n/bars.length>=.75;
}

/** Profil svíček: rows řádků mezi nejnižším low a nejvyšším high, objem svíčky rovnoměrně přes její rozsah; va = podíl objemu value area (0–1). */
export function volumeProfile(bars:readonly VpBar[],rows=VP_ROWS_DEFAULT,va=VP_VA_DEFAULT/100,mode?:VpMode):Profile|null{
 const list=bars.filter(b=>Number.isFinite(b.high)&&Number.isFinite(b.low)&&b.high>=b.low);
 if(!list.length)return null;
 const m:VpMode=mode??(hasVolume(list)?'volume':'tpo');
 let lo=Infinity,hi=-Infinity;for(const b of list){if(b.low<lo)lo=b.low;if(b.high>hi)hi=b.high}
 const n=hi>lo?Math.max(VP_ROWS_MIN,Math.min(VP_ROWS_MAX,Math.round(rows))):1,step=hi>lo?(hi-lo)/n:1;
 const out:VpRow[]=Array.from({length:n},(_,i)=>({lo:lo+i*step,hi:i===n-1&&hi>lo?hi:lo+(i+1)*step,up:0,down:0,total:0}));
 const at=(p:number)=>Math.min(n-1,Math.max(0,Math.floor((p-lo)/step)));
 for(const b of list){
  const w=m==='volume'?b.volume??0:1;if(!(w>0))continue;
  const side=b.close>=b.open?'up':'down';
  if(b.high===b.low||n===1){const r=out[at(b.low)];r[side]+=w;r.total+=w;continue}
  // podíl řádku = překryv řádku a rozsahu svíčky / rozsah svíčky
  for(let i=at(b.low);i<=at(b.high);i++){const r=out[i],part=(Math.min(b.high,r.hi)-Math.max(b.low,r.lo))/(b.high-b.low);if(part>0){r[side]+=w*part;r.total+=w*part}}
 }
 let total=0,max=0,poc=0;
 const mid=(n-1)/2;
 for(let i=0;i<n;i++){const t=out[i].total;total+=t;if(t>max||(t===max&&t>0&&Math.abs(i-mid)<Math.abs(poc-mid))){max=t;poc=i}}
 if(!(total>0))return null;
 // value area: od POC přidávat po dvou řádcích tu stranu (nahoru / dolů), která má víc objemu, dokud není va objemu
 const target=total*Math.min(1,Math.max(0,va));let acc=out[poc].total,up=poc+1,dn=poc-1;
 while(acc<target&&(up<n||dn>=0)){
  const su=(up<n?out[up].total:0)+(up+1<n?out[up+1].total:0),sd=(dn>=0?out[dn].total:0)+(dn-1>=0?out[dn-1].total:0);
  if(up<n&&(su>=sd||dn<0)){acc+=su;up+=2}else{acc+=sd;dn-=2}
 }
 const vaTo=Math.min(n-1,up-1),vaFrom=Math.max(0,dn+1);
 return {rows:out,lo,hi,poc:(out[poc].lo+out[poc].hi)/2,pocIndex:poc,vah:out[vaTo].hi,val:out[vaFrom].lo,vaFrom,vaTo,total,max,mode:m,bars:list.length};
}

// --- session volume profile: rozdělení svíček na období (čas grafu = pražský čas zakódovaný jako UTC, v sekundách) ---
export const VP_PERIODS=['session','day','week','month'] as const;
export type VpPeriod=typeof VP_PERIODS[number];
export const VP_PERIOD_LABELS:Record<VpPeriod,string>={session:'Seance',day:'Den',week:'Týden',month:'Měsíc'};
const DAY=86400;
// obchodní den FX začíná ve 23:00 Prahy (17:00 New York) → posun o hodinu; seance: Asie 22–8, Londýn 8–13, překryv 13–17, NY 17–22
export const dayOf=(time:number)=>Math.floor((time+3600)/DAY);
export function periodKey(period:VpPeriod,time:number):number{
 if(period==='day')return dayOf(time);
 if(period==='week')return Math.floor((dayOf(time)+3)/7); // 1. 1. 1970 byl čtvrtek → týdny od pondělí
 if(period==='month'){const d=new Date(dayOf(time)*DAY*1000);return d.getUTCFullYear()*12+d.getUTCMonth()}
 const s=time+2*3600,h=Math.floor(s%DAY/3600);
 return Math.floor(s/DAY)*4+(h<10?0:h<15?1:h<19?2:3); // posunuto o 2 h: 22–8 → 0–10
}
// výchozí období podle TF; na týdenním a měsíčním grafu session profil nedává smysl
export function autoPeriod(tf:string):VpPeriod|null{
 if(tf==='W1'||tf==='MN')return null;
 if(tf==='D1')return 'month';
 if(tf==='H2'||tf==='H4')return 'week';
 return 'day';
}
export type SessionProfile={key:number;from:number;to:number;profile:Profile};
/** Profily po obdobích: from/to = index první a poslední svíčky období v bars. */
export function sessionProfiles(bars:readonly VpBar[],period:VpPeriod,rows=VP_ROWS_DEFAULT,va=VP_VA_DEFAULT/100):SessionProfile[]{
 const out:SessionProfile[]=[];if(!bars.length)return out;
 // jeden režim pro všechna období (aby se profily daly porovnat)
 const mode:VpMode=hasVolume(bars)?'volume':'tpo';
 let start=0,key=periodKey(period,bars[0].time);
 const push=(end:number)=>{const p=volumeProfile(bars.slice(start,end+1),rows,va,mode);if(p)out.push({key,from:start,to:end,profile:p})};
 for(let i=1;i<bars.length;i++){const k=periodKey(period,bars[i].time);if(k!==key){push(i-1);start=i;key=k}}
 push(bars.length-1);
 return out;
}
// svíčky v časovém rozsahu (čas grafu, včetně krajů, nezávisle na pořadí)
export function barsBetween<T extends VpBar>(bars:readonly T[],t1:number,t2:number):T[]{const a=Math.min(t1,t2),b=Math.max(t1,t2);return bars.filter(x=>x.time>=a&&x.time<=b)}
