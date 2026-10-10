// Kreslení v grafu trhu: typy, validace, Fibonacci, měření, přichytávání a geometrie pro výběr. Čisté funkce – testy scripts/check-drawings.mjs.
// Kotvy jsou {t: ms UTC, p: cena}; graf pracuje v „čase grafu“ (sekundy posunuté na pražský čas) a v logických indexech svíček.
import {pragueOffsetMs} from '../journal/format.ts';
export const DRAW_TYPES=['trend','hline','rect','fib','text','measure'] as const;
export type DrawType=typeof DRAW_TYPES[number];
export const DRAW_COLORS=['brand','bull','bear','amber','muted','fg'] as const;
export type DrawColor=typeof DRAW_COLORS[number];
export type Anchor={t:number;p:number};
export type Drawing={id:string;type:DrawType;a:Anchor[];color:DrawColor;text?:string;ray?:boolean};
export const MAX_DRAWINGS=200,MAX_TEXT=200;
export const ANCHORS:Record<DrawType,number>={trend:2,hline:1,rect:2,fib:2,text:1,measure:2};
export const DRAW_LABELS:Record<DrawType,string>={trend:'Trendová čára',hline:'Horizontála',rect:'Obdélník / zóna',fib:'Fibonacci',text:'Text',measure:'Měření'};
export const COLOR_LABELS:Record<DrawColor,string>={brand:'Modrá',bull:'Zelená',bear:'Červená',amber:'Oranžová',muted:'Šedá',fg:'Text'};
export const FIB_LEVELS=[0,.236,.382,.5,.618,.786,1];
const ID=/^[A-Za-z0-9_-]{1,40}$/;
const num=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
// kotva: čas v rozumném rozsahu (1970–2200), cena konečná
const anchorOk=(a:unknown):a is Anchor=>!!a&&typeof a==='object'&&num((a as Anchor).t)&&num((a as Anchor).p)&&(a as Anchor).t>=0&&(a as Anchor).t<7258118400000&&Math.abs((a as Anchor).p)<1e12;

export type Parsed={ok:true;drawings:Drawing[]}|{ok:false;error:string};
// validace a normalizace (neznámé klíče se zahodí); chyby česky
export function parseDrawings(input:unknown):Parsed{
 if(!Array.isArray(input))return {ok:false,error:'Kresby musí být seznam.'};
 if(input.length>MAX_DRAWINGS)return {ok:false,error:`Na jednom trhu může být nejvýš ${MAX_DRAWINGS} kreseb.`};
 const out:Drawing[]=[],ids=new Set<string>();
 for(const raw of input){
  if(!raw||typeof raw!=='object')return {ok:false,error:'Neplatná kresba.'};
  const d=raw as Record<string,unknown>;
  if(typeof d.id!=='string'||!ID.test(d.id)||ids.has(d.id))return {ok:false,error:'Neplatné nebo duplicitní ID kresby.'};
  if(typeof d.type!=='string'||!(DRAW_TYPES as readonly string[]).includes(d.type))return {ok:false,error:'Neznámý typ kresby.'};
  const type=d.type as DrawType;
  if(!Array.isArray(d.a)||d.a.length!==ANCHORS[type]||!d.a.every(anchorOk))return {ok:false,error:'Kresba má neplatné body (čas nebo cenu).'};
  if(typeof d.color!=='string'||!(DRAW_COLORS as readonly string[]).includes(d.color))return {ok:false,error:'Nepovolená barva kresby.'};
  const x:Drawing={id:d.id,type,a:(d.a as Anchor[]).map(a=>({t:a.t,p:a.p})),color:d.color as DrawColor};
  if(type==='text'){
   if(typeof d.text!=='string'||!d.text.trim())return {ok:false,error:'Text kresby nesmí být prázdný.'};
   if(d.text.length>MAX_TEXT)return {ok:false,error:`Text kresby může mít nejvýš ${MAX_TEXT} znaků.`};
   x.text=d.text;
  }
  if(type==='trend'&&d.ray===true)x.ray=true;
  ids.add(d.id);out.push(x);
 }
 return {ok:true,drawings:out};
}
export const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);

// --- čas ↔ logický index svíčky ---
// čas grafu (s) → ms UTC (inverze chartTime)
export function fromChartTime(sec:number){const local=sec*1000;let ms=local-pragueOffsetMs(local);ms=local-pragueOffsetMs(ms);return ms}
// čas grafu → logický index (zlomkový): uvnitř svíčky podíl z délky TF, v mezeře (víkend) konec předchozí svíčky, mimo načtený rozsah lineárně po TF
export function logicalOf(times:number[],tfSec:number,t:number):number{
 const n=times.length;if(!n)return 0;
 if(t<=times[0])return (t-times[0])/tfSec;
 if(t>=times[n-1])return n-1+(t-times[n-1])/tfSec;
 let lo=0,hi=n-1;while(hi-lo>1){const m=(lo+hi)>>1;if(times[m]<=t)lo=m;else hi=m}
 return lo+Math.min(1,(t-times[lo])/Math.min(tfSec,times[lo+1]-times[lo]));
}
// logický index → čas grafu
export function timeOfLogical(times:number[],tfSec:number,l:number):number{
 const n=times.length;if(!n)return 0;
 if(l<=0)return times[0]+l*tfSec;
 if(l>=n-1)return times[n-1]+(l-(n-1))*tfSec;
 const i=Math.floor(l);return times[i]+(l-i)*Math.min(tfSec,times[i+1]-times[i]);
}

// --- Fibonacci: 1 u prvního bodu, 0 u druhého ---
export function fibLevels(a:Anchor,b:Anchor){return FIB_LEVELS.map(level=>({level,price:b.p+(a.p-b.p)*level}))}
export const fibLabel=(level:number)=>level.toLocaleString('cs-CZ',{maximumFractionDigits:3});

// --- měření ---
export type Measure={dp:number;pct:number;bars:number;ms:number};
export function measure(a:Anchor,b:Anchor,la:number,lb:number):Measure{
 return {dp:b.p-a.p,pct:a.p?(b.p-a.p)/Math.abs(a.p)*100:0,bars:Math.round(lb-la),ms:b.t-a.t};
}
// délka česky: „2 d 5 h“, „45 min“
export function fmtDuration(ms:number){
 const neg=ms<0,m=Math.round(Math.abs(ms)/60000),d=Math.floor(m/1440),h=Math.floor(m%1440/60),mi=m%60;
 const s=[d?d+' d':'',h?h+' h':'',mi&&!d?mi+' min':''].filter(Boolean).join(' ')||'0 min';
 return (neg?'−':'')+s;
}

// --- magnet: nejbližší O/H/L/C svíčky ---
export function snapPrice(bar:{open:number;high:number;low:number;close:number}|null|undefined,p:number){
 if(!bar)return p;let best=p,dist=Infinity;
 for(const v of [bar.open,bar.high,bar.low,bar.close]){const x=Math.abs(v-p);if(x<dist){dist=x;best=v}}
 return best;
}

// --- geometrie pro výběr (pixely) ---
export type Pt={x:number;y:number};
export function distToSegment(p:Pt,a:Pt,b:Pt){
 const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
 const k=len?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len)):0;
 return Math.hypot(p.x-(a.x+k*dx),p.y-(a.y+k*dy));
}
// prodloužení úsečky a→b za b dostatečně daleko za okraj plochy (polopřímka; kreslení ořízne plátno)
export function rayEnd(a:Pt,b:Pt,w:number,h:number):Pt{
 const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(!len)return b;
 const k=(2*Math.hypot(w,h)+Math.hypot(b.x,b.y))/len;
 return {x:b.x+dx*k,y:b.y+dy*k};
}
// tvar kresby v pixelech (body podle kotev; fib má navíc y hladin; text box)
export type Shape={type:DrawType;pts:Pt[];ray?:boolean;levels?:number[];box?:{x:number;y:number;w:number;h:number}};
export type Hit={part:'body'}|{part:'handle';index:number};
// zásah: nejdřív úchyty, pak tělo; tol v px
export function hitShape(s:Shape,p:Pt,w:number,h:number,tol=6):Hit|null{
 for(let i=0;i<s.pts.length;i++)if(s.type!=='hline'&&Math.hypot(p.x-s.pts[i].x,p.y-s.pts[i].y)<=tol+2)return {part:'handle',index:i};
 const [a,b]=s.pts;
 switch(s.type){
  case 'hline':return Math.abs(p.y-a.y)<=tol?{part:'body'}:null;
  case 'trend':return distToSegment(p,a,s.ray?rayEnd(a,b,w,h):b)<=tol?{part:'body'}:null;
  case 'rect':case 'measure':{
   const x0=Math.min(a.x,b.x)-tol,x1=Math.max(a.x,b.x)+tol,y0=Math.min(a.y,b.y)-tol,y1=Math.max(a.y,b.y)+tol;
   return p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1?{part:'body'}:null;
  }
  case 'fib':{
   const x0=Math.min(a.x,b.x),x1=Math.max(a.x,b.x);
   if(p.x<x0-tol||p.x>x1+tol)return null;
   if(distToSegment(p,a,b)<=tol)return {part:'body'};
   return (s.levels||[]).some(y=>Math.abs(p.y-y)<=tol)?{part:'body'}:null;
  }
  case 'text':{const bx=s.box;return bx&&p.x>=bx.x-tol&&p.x<=bx.x+bx.w+tol&&p.y>=bx.y-tol&&p.y<=bx.y+bx.h+tol?{part:'body'}:null}
 }
}
// nejvyšší zasažená kresba (poslední nakreslená je nahoře)
export function hitTest(shapes:{id:string;shape:Shape}[],p:Pt,w:number,h:number,tol=6):{id:string;hit:Hit}|null{
 for(let i=shapes.length-1;i>=0;i--){const hit=hitShape(shapes[i].shape,p,w,h,tol);if(hit)return {id:shapes[i].id,hit}}
 return null;
}
// posun kotev o Δ logického indexu a Δ ceny (přes převodní funkce); horizontála jen v ceně
export function translate(d:Drawing,dl:number,dp:number,toL:(t:number)=>number,fromL:(l:number)=>number):Drawing{
 return {...d,a:d.a.map(a=>({t:d.type==='hline'||!dl?a.t:fromL(toL(a.t)+dl),p:a.p+dp}))};
}
// popisky měření: „+0,0123 (+1,23 %)“ a „24 svíček · 1 d“
export const candlesWord=(n:number)=>{const a=Math.abs(n);return a===1?'svíčka':a>=2&&a<=4?'svíčky':'svíček'};
export function measureLines(m:Measure,price:(v:number)=>string){
 const sign=m.dp>0?'+':m.dp<0?'−':'';
 return [`${sign}${price(Math.abs(m.dp))} (${sign}${Math.abs(m.pct).toLocaleString('cs-CZ',{maximumFractionDigits:2})} %)`,`${m.bars} ${candlesWord(m.bars)} · ${fmtDuration(m.ms)}`];
}
