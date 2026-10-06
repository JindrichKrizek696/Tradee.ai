// Seznam trhů: čisté výpočty pro top signály, heatmapu a tabulku.
export type Trend=1|-1|0|null;
export type MarketItem={id:string;name:string;group:string;score:number|null;trend:Trend;coverage:number;bias:string};
type RowLike={id:string;name:string;group:string;r:{score:number|null;coverage:number;bias:string;parts:{id:string;signal:number|null}[];price?:{trend?:number}|null}};
export type SortKey='name'|'score'|'coverage';
export type ScoreFilter='all'|'positive'|'negative'|'strong'|'missing';

export function toItem(row:RowLike):MarketItem{
 const t=row.r.parts.find(p=>p.id==='trend')?.signal;
 const v=row.r.price?.trend??0;
 return {id:row.id,name:row.name,group:row.group,score:row.r.score,coverage:row.r.coverage,bias:row.r.bias,trend:t===null||t===undefined?null:v>0?1:v<0?-1:0};
}

const byScoreDesc=(a:MarketItem,b:MarketItem)=>a.score===null?(b.score===null?a.name.localeCompare(b.name):1):b.score===null?-1:b.score-a.score;

export function topSignals(items:MarketItem[],n=5){
 const valid=items.filter(i=>i.score!==null&&i.score!==0);
 return {
  bull:valid.filter(i=>i.score!>0).sort(byScoreDesc).slice(0,n),
  bear:valid.filter(i=>i.score!<0).sort((a,b)=>a.score!-b.score!).slice(0,n),
 };
}

export const GROUP_ORDER=['fx','currency','index','crypto','stock'];
export function heatmapGroups(items:MarketItem[],labels:Record<string,string>){
 return GROUP_ORDER.map(g=>({group:g,label:labels[g]??g,items:items.filter(i=>i.group===g).sort(byScoreDesc)})).filter(g=>g.items.length);
}

export function sortItems(items:MarketItem[],key:SortKey,dir:1|-1){
 return [...items].sort((a,b)=>{
  if(key==='name')return dir*a.name.localeCompare(b.name,'cs');
  const x=key==='score'?a.score:a.coverage,y=key==='score'?b.score:b.coverage;
  if(x===null)return y===null?0:1;
  if(y===null)return -1;
  return dir*(x-y);
 });
}

export const normalize=(s:string)=>s.toUpperCase().replaceAll('/','').replace(/\s+/g,'');
export const matchesQuery=(i:MarketItem,q:string)=>!q.trim()||normalize(i.id+' '+i.name).includes(normalize(q));

export function filterItems(items:MarketItem[],f:{query:string;score:ScoreFilter;flag:string},flags:Record<string,string>){
 return items.filter(i=>matchesQuery(i,f.query)&&(f.flag==='all'||(flags[i.id]||'none')===f.flag)&&(
  f.score==='all'||f.score==='positive'&&i.score!==null&&i.score>0||f.score==='negative'&&i.score!==null&&i.score<0||
  f.score==='strong'&&i.score!==null&&Math.abs(i.score)>=40||f.score==='missing'&&i.score===null));
}

// Sytost barvy dlaždice: slabý signál 15 %, od |70| plná.
export const intensity=(score:number|null)=>score===null?0:0.15+0.85*Math.min(1,Math.abs(score)/70);

const rgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const lin=(c:number)=>{const s=c/255;return s<=0.03928?s/12.92:((s+0.055)/1.055)**2.4};
export const luminance=([r,g,b]:number[])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
export const contrast=(a:number[],b:number[])=>{const [x,y]=[luminance(a),luminance(b)].sort((m,n)=>n-m);return (x+0.05)/(y+0.05)};
// Barva smíchaná s podkladem podle sytosti (stejně jako rgba přes pozadí); světlý motiv bílá, tmavý povrch karty.
const WHITE=[255,255,255];
export const DARK_BASE=[18,21,28];
export const blend=(hex:string,alpha:number,base=WHITE)=>rgb(hex).map((c,i)=>Math.round(base[i]+(c-base[i])*alpha));
export const tileBackground=(hex:string,alpha:number,base=WHITE)=>{const [r,g,b]=blend(hex,alpha,base);return `rgb(${r},${g},${b})`};
// Text na dlaždici (tučný): bílý, dokud má vůči pozadí kontrast aspoň 3:1, jinak tmavý.
export const textOn=(hex:string,alpha:number,base=WHITE)=>contrast(blend(hex,alpha,base),WHITE)>=3?'#fff':'#141518';
export const hexContrastOnWhite=(hex:string)=>contrast(rgb(hex),[255,255,255]);
