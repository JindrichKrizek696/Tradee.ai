export type Trade={id:string;date:string;instrument:string;pnl:number;note:string;created:string;source?:'manual'|'mt';account?:string;accountCurrency?:string;net?:number;converted?:boolean};
export type DayCell={date:string;day:number;inMonth:boolean;pnl:number;count:number;isToday:boolean};
export type Week={days:DayCell[];total:number;count:number};
const iso=(d:Date)=>d.toISOString().slice(0,10);
export const CURRENCY_SIGN:Record<string,string>={USD:'$',EUR:'€',CZK:'Kč',GBP:'£',CHF:'CHF',JPY:'¥',AUD:'A$',CAD:'C$',NZD:'NZ$',PLN:'zł'};
export const fmtMoney=(n:number,cur='USD')=>(n>0?'+':'')+n.toLocaleString('cs-CZ',{minimumFractionDigits:0,maximumFractionDigits:2})+' '+(CURRENCY_SIGN[cur]||cur);
export const fmtUsd=(n:number)=>fmtMoney(n,'USD');
/** Mřížka měsíce: týdny pondělí–neděle, každý týden má součet všech sedmi dnů (i mimo měsíc). */
export function monthGrid(year:number,month:number,trades:Trade[],todayIso:string):Week[]{
 const byDay=new Map<string,{pnl:number;count:number}>();
 for(const t of trades){const x=byDay.get(t.date)||{pnl:0,count:0};x.pnl+=t.pnl;x.count++;byDay.set(t.date,x)}
 const first=new Date(Date.UTC(year,month-1,1)),offset=(first.getUTCDay()+6)%7,cur=new Date(first);cur.setUTCDate(1-offset);
 const weeks:Week[]=[];
 while(true){
  const days:DayCell[]=[];let total=0,count=0;
  for(let i=0;i<7;i++){const d=iso(cur),x=byDay.get(d);const cell:DayCell={date:d,day:cur.getUTCDate(),inMonth:cur.getUTCMonth()===month-1&&cur.getUTCFullYear()===year,pnl:x?.pnl||0,count:x?.count||0,isToday:d===todayIso};total+=cell.pnl;count+=cell.count;days.push(cell);cur.setUTCDate(cur.getUTCDate()+1)}
  weeks.push({days,total:Math.round(total*100)/100,count});
  if(cur.getUTCFullYear()>year||(cur.getUTCFullYear()===year&&cur.getUTCMonth()>month-1))break;
 }
 return weeks;
}
export function monthStats(trades:Trade[],year:number,month:number){
 const prefix=`${year}-${String(month).padStart(2,'0')}-`,list=trades.filter(t=>t.date.startsWith(prefix));
 const total=Math.round(list.reduce((s,t)=>s+t.pnl,0)*100)/100,wins=list.filter(t=>t.pnl>0).length;
 const byDay=new Map<string,number>();for(const t of list)byDay.set(t.date,(byDay.get(t.date)||0)+t.pnl);
 const best=byDay.size?Math.max(...byDay.values()):0,worst=byDay.size?Math.min(...byDay.values()):0;
 return {total,count:list.length,wins,winRate:list.length?100*wins/list.length:0,best:Math.round(best*100)/100,worst:Math.round(worst*100)/100,days:byDay.size,greenDays:[...byDay.values()].filter(v=>v>0).length};
}
/** Kumulativní P&L po dnech měsíce; u běžícího měsíce končí dneškem. */
export function monthCurve(trades:Trade[],year:number,month:number,todayIso:string){
 const prefix=`${year}-${String(month).padStart(2,'0')}-`,last=new Date(Date.UTC(year,month,0)).getUTCDate();
 const end=todayIso.startsWith(prefix)?Number(todayIso.slice(8,10)):todayIso<prefix?0:last;
 const out:number[]=[];let sum=0;
 for(let d=1;d<=end;d++){const day=prefix+String(d).padStart(2,'0');for(const t of trades)if(t.date===day)sum+=t.pnl;out.push(Math.round(sum*100)/100)}
 return out;
}
export type Period='week'|'month'|'year';
export type Bucket={label:string;pnl:number;cum:number|null;future:boolean};
const MONTHS_SHORT=['led','úno','bře','dub','kvě','čvn','čvc','srp','zář','říj','lis','pro'];
/** P&L za běžící týden (po–ne), měsíc nebo rok: denní / měsíční součty, kumulace do dneška a poměrové ukazatele. */
export function periodStats(trades:Trade[],period:Period,todayIso:string){
 const [y,m,d]=todayIso.split('-').map(Number),pad=(n:number)=>String(n).padStart(2,'0');
 let keys:string[],labels:string[];
 if(period==='year'){keys=MONTHS_SHORT.map((_,i)=>`${y}-${pad(i+1)}`);labels=MONTHS_SHORT}
 else if(period==='month'){const last=new Date(Date.UTC(y,m,0)).getUTCDate();keys=Array.from({length:last},(_,i)=>`${y}-${pad(m)}-${pad(i+1)}`);labels=keys.map(k=>String(Number(k.slice(8))))}
 else{const start=new Date(Date.UTC(y,m-1,d));start.setUTCDate(d-(start.getUTCDay()+6)%7);keys=Array.from({length:7},(_,i)=>{const x=new Date(start);x.setUTCDate(start.getUTCDate()+i);return iso(x)});labels=['Po','Út','St','Čt','Pá','So','Ne']}
 const key=(t:Trade)=>period==='year'?t.date.slice(0,7):t.date,range=new Set(keys),list=trades.filter(t=>range.has(key(t)));
 const sums=new Map<string,number>();for(const t of list)sums.set(key(t),(sums.get(key(t))||0)+t.pnl);
 const nowKey=period==='year'?todayIso.slice(0,7):todayIso,r2=(n:number)=>Math.round(n*100)/100;
 let cum=0;const buckets:Bucket[]=keys.map((k,i)=>{const pnl=r2(sums.get(k)||0),future=k>nowKey;if(!future)cum+=pnl;return {label:labels[i],pnl,future,cum:future?null:r2(cum)}});
 const wins=list.filter(t=>t.pnl>0),losses=list.filter(t=>t.pnl<0),gw=wins.reduce((s,t)=>s+t.pnl,0),gl=-losses.reduce((s,t)=>s+t.pnl,0);
 return {total:r2(gw-gl),count:list.length,wins:wins.length,winRate:list.length?100*wins.length/list.length:0,profitFactor:gl?gw/gl:null,avgWin:wins.length?r2(gw/wins.length):null,avgLoss:losses.length?r2(-gl/losses.length):null,buckets};
}
