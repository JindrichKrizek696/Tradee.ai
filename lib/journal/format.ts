// Formátování pro deník (čas Europe/Prague, čísla po česku).
export function fmtHold(ms:number|null){
 if(ms===null)return '–';
 const m=Math.round(ms/60000);if(m<60)return `${m} min`;
 const h=Math.floor(m/60);if(h<24)return m%60?`${h} h ${m%60} min`:`${h} h`;
 const d=Math.floor(h/24);return h%24?`${d} d ${h%24} h`:`${d} d`;
}
export const fmtNum=(n:number|null,digits=5)=>n===null?'–':n.toLocaleString('cs-CZ',{maximumFractionDigits:digits});
export const fmtR=(r:number|null)=>r===null?'–':(r>0?'+':'')+fmtNum(r,2)+' R';
const dt=new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
export const fmtDateTime=(ms:number)=>dt.format(ms);
export const fmtDate=(iso:string)=>{const [y,m,d]=iso.split('-');return `${Number(d)}. ${Number(m)}. ${y}`};
const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Prague',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
// o kolik ms je čas v Praze napřed před UTC (3600000 v zimě, 7200000 v létě)
export function pragueOffsetMs(ms:number){
 const p=Object.fromEntries(parts.formatToParts(ms).map(x=>[x.type,x.value]));
 return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-Math.floor(ms/1000)*1000;
}
export const tradesWord=(n:number)=>n===1?'obchod je':n>=2&&n<=4?'obchody jsou':'obchodů je';
// česká množná čísla: 1 výhra · 2–4 výhry · 0 / 5+ výher
export const plural=(n:number,[one,few,many]:readonly [string,string,string])=>n===1?one:n>=2&&n<=4?few:many;
