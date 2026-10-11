// Kreslení v grafu trhu: typy, validace, styl, Fibonacci, měření, pozice, dotyk ceny, zjednodušení tahu, přichytávání a geometrie pro výběr. Čisté funkce – testy scripts/check-drawings.mjs.
// Kotvy jsou {t: ms UTC, p: cena}; graf pracuje v „čase grafu“ (sekundy posunuté na pražský čas) a v logických indexech svíček.
import {pragueOffsetMs} from '../journal/format.ts';
export const DRAW_TYPES=['trend','hline','rect','fib','text','measure','ray','hray','touch','path','brush','channel','long','short','prange','trange','fibext','pitchfork','gann'] as const;
export type DrawType=typeof DRAW_TYPES[number];
export const DRAW_COLORS=['brand','bull','bear','amber','muted','fg'] as const;
export type DrawColor=typeof DRAW_COLORS[number];
export type Anchor={t:number;p:number};
export const LINE_STYLES=['solid','dashed','dotted'] as const;
export type LineStyleName=typeof LINE_STYLES[number];
export const TEXT_ALIGNS=['top','middle','bottom'] as const;
export type TextAlign=typeof TEXT_ALIGNS[number];
export const TEXT_SIZES=['S','M','L'] as const;
export type TextSize=typeof TEXT_SIZES[number];
// styl kresby – všechna pole volitelná (staré kresby styl nemají a vykreslí se stejně jako dřív)
export type DrawStyle={
 lw?:1|2|3;ls?:LineStyleName;op?:number;
 fill?:boolean;border?:boolean;bc?:DrawColor;
 ta?:TextAlign;ts?:TextSize;tc?:DrawColor;
 extL?:boolean;extR?:boolean;
 risk?:number;
};
export type Drawing={id:string;type:DrawType;a:Anchor[];color:DrawColor;text?:string;ray?:boolean;s?:DrawStyle;tfs?:string[]};
export const MAX_DRAWINGS=200,MAX_TEXT=200,MAX_POINTS=300,MAX_PATH=100,MAX_TOTAL_POINTS=20000;
// počet kotev: pevný, nebo rozsah [min,max] (lomená čára, štětec)
export const ANCHORS:Record<DrawType,number|[number,number]>={trend:2,hline:1,rect:2,fib:2,text:1,measure:2,ray:2,hray:1,touch:1,path:[2,MAX_PATH],brush:[2,MAX_POINTS],channel:3,long:3,short:3,prange:2,trange:2,fibext:3,pitchfork:3,gann:2};
export const anchorRange=(t:DrawType):[number,number]=>{const n=ANCHORS[t];return typeof n==='number'?[n,n]:n};
export const DRAW_LABELS:Record<DrawType,string>={trend:'Trendová čára',hline:'Horizontála',rect:'Obdélník / zóna',fib:'Fibonacci',text:'Text',measure:'Měření',ray:'Paprsek',hray:'Horizontální paprsek',touch:'Úroveň do dotyku',path:'Lomená čára',brush:'Štětec',channel:'Paralelní kanál',long:'Long pozice',short:'Short pozice',prange:'Cenový rozsah',trange:'Časový rozsah',fibext:'Fibonacci extension',pitchfork:'Andrewsovy vidle',gann:'Gannova mřížka'};
export const COLOR_LABELS:Record<DrawColor,string>={brand:'Modrá',bull:'Zelená',bear:'Červená',amber:'Oranžová',muted:'Šedá',fg:'Text'};
export const FIB_LEVELS=[0,.236,.382,.5,.618,.786,1];
export const FIB_EXT_LEVELS=[0,.618,1,1.272,1.618,2,2.618];
export const GANN_DIV=[0,.25,.5,.75,1];
// časové rámce: dnešní i budoucí (M5, M15, H1, H4, D1, W1, MN)
const TF_RE=/^(?:[MHDW]\d{1,2}|MN)$/;
const ID=/^[A-Za-z0-9_-]{1,40}$/;
const num=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
// kotva: čas v rozumném rozsahu (1970–2200), cena konečná
const anchorOk=(a:unknown):a is Anchor=>!!a&&typeof a==='object'&&num((a as Anchor).t)&&num((a as Anchor).p)&&(a as Anchor).t>=0&&(a as Anchor).t<7258118400000&&Math.abs((a as Anchor).p)<1e12;

// --- schopnosti stylu podle typu (co nabídnout v panelu) ---
export type Caps={line:boolean;fill:boolean;border:boolean;extend:boolean;risk:boolean};
const LINEISH:DrawType[]=['trend','ray','hline','hray','touch','path','brush','channel','fib','prange','trange','fibext','pitchfork','gann'];
export function capsOf(t:DrawType):Caps{
 return {
  line:LINEISH.includes(t)||t==='rect'||t==='long'||t==='short',
  fill:['rect','channel','fib','text','long','short','prange','trange','fibext','pitchfork','gann'].includes(t),
  border:['rect','long','short','text'].includes(t),
  extend:['trend','ray','channel','fib','rect','fibext','pitchfork'].includes(t),
  risk:t==='long'||t==='short',
 };
}
export type FullStyle={lw:1|2|3;ls:LineStyleName;op:number;fill:boolean;border:boolean;bc:DrawColor;ta:TextAlign;ts:TextSize;tc:DrawColor;extL:boolean;extR:boolean;risk:number|null};
// výchozí styl doplněný o uložené hodnoty (staré kresby: čáry 2 px, zóna s výplní i okrajem 1 px, text bez pozadí; pozice bez okraje)
export function styleOf(d:Pick<Drawing,'type'|'color'|'ray'|'s'>):FullStyle{
 const s=d.s||{},boxy=d.type==='rect'||d.type==='long'||d.type==='short';
 return {
  lw:s.lw??(boxy?1:2),ls:s.ls??'solid',op:s.op??1,
  fill:s.fill??d.type!=='text',border:s.border??d.type==='rect',bc:s.bc??d.color,
  ta:s.ta??(d.type==='text'?'middle':'top'),ts:s.ts??'M',tc:s.tc??d.color,
  extL:s.extL??false,extR:s.extR??(d.ray===true||d.type==='ray'||d.type==='pitchfork'),
  risk:s.risk??null,
 };
}
export const TEXT_PX:Record<TextSize,number>={S:10,M:12,L:16};
export const dashOf=(ls:LineStyleName,lw:number):number[]=>ls==='dashed'?[6+lw*2,4+lw]:ls==='dotted'?[.1,3+lw*1.5]:[];
// viditelnost na časovém rámci (bez seznamu = všude)
export const visibleOn=(d:Pick<Drawing,'tfs'>,tf:string)=>!d.tfs||d.tfs.includes(tf);
export const filterTf=<T extends Pick<Drawing,'tfs'>>(list:T[],tf:string)=>list.filter(d=>visibleOn(d,tf));
// přepnutí TF v seznamu viditelnosti; poslední zaškrtnutý nejde vypnout; všechny zaškrtnuté = bez seznamu
export function toggleTf(tfs:string[]|undefined,tf:string,all:readonly string[]):string[]|undefined{
 const cur=tfs?all.filter(x=>tfs.includes(x)):[...all];
 const next=cur.includes(tf)?cur.filter(x=>x!==tf):[...cur,tf];
 if(!next.length)return tfs;
 return all.every(x=>next.includes(x))?undefined:all.filter(x=>next.includes(x));
}

export type Parsed={ok:true;drawings:Drawing[]}|{ok:false;error:string};
const BAD_STYLE={ok:false as const,error:'Neplatný styl kresby.'};
// styl: neznámé klíče se zahodí, hodnoty mimo povolené → chyba
function parseStyle(v:unknown):{ok:true;s?:DrawStyle}|{ok:false;error:string}{
 if(v===undefined||v===null)return {ok:true};
 if(typeof v!=='object'||Array.isArray(v))return BAD_STYLE;
 const r=v as Record<string,unknown>,s:DrawStyle={};
 const color=(x:unknown)=>typeof x==='string'&&(DRAW_COLORS as readonly string[]).includes(x);
 const bool=(k:'fill'|'border'|'extL'|'extR')=>{if(r[k]===undefined)return true;if(typeof r[k]!=='boolean')return false;s[k]=r[k] as boolean;return true};
 if(r.lw!==undefined){if(r.lw!==1&&r.lw!==2&&r.lw!==3)return BAD_STYLE;s.lw=r.lw}
 if(r.ls!==undefined){if(!(LINE_STYLES as readonly unknown[]).includes(r.ls))return BAD_STYLE;s.ls=r.ls as LineStyleName}
 if(r.op!==undefined){if(!num(r.op)||r.op<.1||r.op>1)return BAD_STYLE;s.op=Math.round(r.op*100)/100}
 if(!bool('fill')||!bool('border')||!bool('extL')||!bool('extR'))return BAD_STYLE;
 if(r.bc!==undefined){if(!color(r.bc))return BAD_STYLE;s.bc=r.bc as DrawColor}
 if(r.tc!==undefined){if(!color(r.tc))return BAD_STYLE;s.tc=r.tc as DrawColor}
 if(r.ta!==undefined){if(!(TEXT_ALIGNS as readonly unknown[]).includes(r.ta))return BAD_STYLE;s.ta=r.ta as TextAlign}
 if(r.ts!==undefined){if(!(TEXT_SIZES as readonly unknown[]).includes(r.ts))return BAD_STYLE;s.ts=r.ts as TextSize}
 if(r.risk!==undefined){if(!num(r.risk)||r.risk<0||r.risk>1e9)return BAD_STYLE;s.risk=r.risk}
 return {ok:true,s:Object.keys(s).length?s:undefined};
}
// validace a normalizace (neznámé klíče se zahodí); chyby česky
export function parseDrawings(input:unknown):Parsed{
 if(!Array.isArray(input))return {ok:false,error:'Kresby musí být seznam.'};
 if(input.length>MAX_DRAWINGS)return {ok:false,error:`Na jednom trhu může být nejvýš ${MAX_DRAWINGS} kreseb.`};
 const out:Drawing[]=[],ids=new Set<string>();let points=0;
 for(const raw of input){
  if(!raw||typeof raw!=='object')return {ok:false,error:'Neplatná kresba.'};
  const d=raw as Record<string,unknown>;
  if(typeof d.id!=='string'||!ID.test(d.id)||ids.has(d.id))return {ok:false,error:'Neplatné nebo duplicitní ID kresby.'};
  if(typeof d.type!=='string'||!(DRAW_TYPES as readonly string[]).includes(d.type))return {ok:false,error:'Neznámý typ kresby.'};
  const type=d.type as DrawType,[min,max]=anchorRange(type);
  if(!Array.isArray(d.a)||d.a.length<min||d.a.length>max||!d.a.every(anchorOk))return {ok:false,error:'Kresba má neplatné body (čas nebo cenu).'};
  points+=d.a.length;if(points>MAX_TOTAL_POINTS)return {ok:false,error:'Kresby mají dohromady příliš mnoho bodů.'};
  if(typeof d.color!=='string'||!(DRAW_COLORS as readonly string[]).includes(d.color))return {ok:false,error:'Nepovolená barva kresby.'};
  const x:Drawing={id:d.id,type,a:(d.a as Anchor[]).map(a=>({t:a.t,p:a.p})),color:d.color as DrawColor};
  // text: povinný u textu, u ostatních kreseb volitelná poznámka
  if(type==='text'&&(typeof d.text!=='string'||!d.text.trim()))return {ok:false,error:'Text kresby nesmí být prázdný.'};
  if(d.text!==undefined&&d.text!==null&&d.text!==''){
   if(typeof d.text!=='string')return {ok:false,error:'Neplatný text kresby.'};
   if(d.text.length>MAX_TEXT)return {ok:false,error:`Text kresby může mít nejvýš ${MAX_TEXT} znaků.`};
   if(d.text.trim())x.text=d.text;
  }
  if(type==='trend'&&d.ray===true)x.ray=true;
  const st=parseStyle(d.s);if(!st.ok)return st;if(st.s)x.s=st.s;
  if(d.tfs!==undefined&&d.tfs!==null){
   if(!Array.isArray(d.tfs)||!d.tfs.length||d.tfs.length>12||!d.tfs.every(v=>typeof v==='string'&&TF_RE.test(v))||new Set(d.tfs).size!==d.tfs.length)return {ok:false,error:'Neplatné časové rámce kresby.'};
   x.tfs=[...d.tfs] as string[];
  }
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
// --- Fibonacci extension: a→b je impuls, c bod korekce; hladina = c + (b − a) × úroveň ---
export function fibExtLevels(a:Anchor,b:Anchor,c:Anchor){return FIB_EXT_LEVELS.map(level=>({level,price:c.p+(b.p-a.p)*level}))}

// vodorovný rozsah hladin extension (px): od bodu c doprava o šířku impulsu (aspoň 40 px), volitelně k okrajům
export function fibExtSpan(a:Pt,b:Pt,c:Pt,w:number,extL:boolean,extR:boolean):[number,number]{
 const x0=extL?0:c.x,x1=extR?w:c.x+Math.max(40,Math.abs(b.x-a.x));
 return [Math.min(x0,x1),Math.max(x0,x1)];
}
// --- Andrewsovy vidle (pixely): medián z a přes střed b–c, rovnoběžky přes b a c; vrací úsečky [začátek, konec] stejné délky jako a→střed ---
export type Seg=[Pt,Pt];
export function pitchfork(a:Pt,b:Pt,c:Pt):{mid:Seg;upper:Seg;lower:Seg;m:Pt}{
 const m={x:(b.x+c.x)/2,y:(b.y+c.y)/2},dx=m.x-a.x,dy=m.y-a.y;
 return {m,mid:[a,m],upper:[b,{x:b.x+dx,y:b.y+dy}],lower:[c,{x:c.x+dx,y:c.y+dy}]};
}
// --- Gannova mřížka (pixely): obdélník z rohů a, b; dělení po čtvrtinách a obě úhlopříčky ---
export function gannGrid(a:Pt,b:Pt):{xs:number[];ys:number[];diag:Seg[]}{
 const xs=GANN_DIV.map(k=>a.x+(b.x-a.x)*k),ys=GANN_DIV.map(k=>a.y+(b.y-a.y)*k);
 return {xs,ys,diag:[[a,b],[{x:a.x,y:b.y},{x:b.x,y:a.y}]]};
}

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
const pctFmt=(v:number)=>Math.abs(v).toLocaleString('cs-CZ',{maximumFractionDigits:2});
const signOf=(v:number)=>v>0?'+':v<0?'−':'';
// velikost pipu: FX páry 0,0001 (JPY 0,01); u ostatních trhů pipy nedávají smysl
export function pipSize(instrument:string):number|null{
 if(!/^[A-Z]{3}\/[A-Z]{3}$/.test(instrument)||/^X(AU|AG|PT|PD)\//.test(instrument))return null;
 return instrument.includes('JPY')?.01:.0001;
}
// cenový rozsah: „+0,0123 (+1,23 %) · 123 pips“
export function priceRangeLine(a:Anchor,b:Anchor,price:(v:number)=>string,pip:number|null){
 const dp=b.p-a.p,s=signOf(dp),pct=a.p?dp/Math.abs(a.p)*100:0;
 const pips=pip?' · '+s+Math.abs(dp/pip).toLocaleString('cs-CZ',{maximumFractionDigits:1})+' pips':'';
 return `${s}${price(Math.abs(dp))} (${s}${pctFmt(pct)} %)${pips}`;
}
// časový rozsah: „24 svíček · 1 d“
export const timeRangeLine=(a:Anchor,b:Anchor,la:number,lb:number)=>{const n=Math.round(lb-la);return `${n} ${candlesWord(n)} · ${fmtDuration(b.t-a.t)}`};

// --- pozice (long/short): a[0] vstup, a[1] SL, a[2] TP; a[1].t = a[2].t = konec boxu ---
// z tahu vstup → druhý bod: SL na ceně druhého bodu (na správné straně), TP s R:R 2
export function positionFrom(type:'long'|'short',entry:Anchor,b:Anchor,rr=2):Anchor[]{
 const risk=Math.abs(b.p-entry.p)||Math.abs(entry.p)*.002||1,dir=type==='long'?1:-1;
 const end=b.t===entry.t?b.t+1:b.t;
 return [entry,{t:end,p:entry.p-dir*risk},{t:end,p:entry.p+dir*risk*rr}];
}
export type PosStats={risk:number;reward:number;rr:number;slPct:number;tpPct:number;valid:boolean;amount:number|null;profit:number|null};
export function positionStats(type:'long'|'short',a:Anchor[],amount:number|null=null):PosStats{
 const [e,sl,tp]=a,risk=Math.abs(e.p-sl.p),reward=Math.abs(tp.p-e.p),dir=type==='long'?1:-1;
 const valid=dir*(e.p-sl.p)>0&&dir*(tp.p-e.p)>0,rr=risk?reward/risk:0;
 const pct=(v:number)=>e.p?v/Math.abs(e.p)*100:0;
 return {risk,reward,rr,slPct:pct(risk),tpPct:pct(reward),valid,amount,profit:amount!==null?amount*rr:null};
}
export function positionLines(type:'long'|'short',a:Anchor[],price:(v:number)=>string,amount:number|null=null){
 const s=positionStats(type,a,amount),money=(v:number)=>v.toLocaleString('cs-CZ',{maximumFractionDigits:2});
 return {
  tp:`Cíl ${price(a[2].p)} · ${price(s.reward)} (${pctFmt(s.tpPct)} %)`+(s.profit!==null?' · zisk '+money(s.profit):''),
  sl:`Stop ${price(a[1].p)} · ${price(s.risk)} (${pctFmt(s.slPct)} %)`+(s.amount!==null?' · riziko '+money(s.amount):''),
  mid:(type==='long'?'Long':'Short')+` · R:R ${s.rr.toLocaleString('cs-CZ',{maximumFractionDigits:2,minimumFractionDigits:2})}`+(s.valid?'':' · SL/TP na špatné straně'),
 };
}
// posun úchytu: u pozice se konec boxu (čas SL i TP) drží společně
export function moveHandle(d:Drawing,index:number,a:Anchor):Drawing{
 if((d.type==='long'||d.type==='short')&&index>0){
  const t=a.t;return {...d,a:d.a.map((x,i)=>i===index?{t,p:a.p}:i>0?{t,p:x.p}:x)};
 }
 return {...d,a:d.a.map((x,i)=>i===index?a:x)};
}

// --- úroveň do dotyku: od svíčky kotvy doprava k první pozdější svíčce, jejíž high/low cenu protne ---
export function firstTouch(bars:{high:number;low:number}[],from:number,price:number):number|null{
 for(let i=Math.max(0,Math.floor(from)+1);i<bars.length;i++){const b=bars[i];if(b.low<=price&&b.high>=price)return i}
 return null;
}

// --- zjednodušení tahu štětce (Douglas–Peucker v pixelech); vrací indexy zachovaných bodů ---
export function simplify(pts:Pt[],tol:number):number[]{
 const n=pts.length;if(n<=2)return pts.map((_,i)=>i);
 const keep=new Uint8Array(n);keep[0]=keep[n-1]=1;
 const stack:[number,number][]=[[0,n-1]];
 while(stack.length){
  const [s,e]=stack.pop()!;let best=-1,dist=tol;
  for(let i=s+1;i<e;i++){const d=distToSegment(pts[i],pts[s],pts[e]);if(d>dist){dist=d;best=i}}
  if(best>=0){keep[best]=1;stack.push([s,best],[best,e])}
 }
 const out:number[]=[];for(let i=0;i<n;i++)if(keep[i])out.push(i);return out;
}
// zjednodušit tak, aby zbylo nejvýš max bodů (tolerance se zvyšuje)
export function simplifyMax(pts:Pt[],max=MAX_POINTS,tol=1.5):number[]{
 let idx=simplify(pts,tol);
 while(idx.length>max&&tol<1e6){tol*=1.6;idx=simplify(pts,tol)}
 return idx;
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
// úsečka s volitelným prodloužením vlevo (za a) a vpravo (za b)
export function extendSeg(a:Pt,b:Pt,w:number,h:number,left:boolean,right:boolean):[Pt,Pt]{
 return [left?rayEnd(b,a,w,h):a,right?rayEnd(a,b,w,h):b];
}
// kanál: svislý posun (px) rovnoběžky procházející bodem c vůči přímce a→b
export function channelOffset(a:Pt,b:Pt,c:Pt){
 const dx=b.x-a.x;if(!dx)return c.x-a.x;
 return c.y-(a.y+(b.y-a.y)*(c.x-a.x)/dx);
}
const inPoly=(p:Pt,poly:Pt[])=>{let ins=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)ins=!ins}return ins};
// tvar kresby v pixelech (body podle kotev; fib má navíc y hladin; text box; popisek poznámky; konec úrovně do dotyku)
export type Box={x:number;y:number;w:number;h:number};
export type Shape={type:DrawType;pts:Pt[];ray?:boolean;extL?:boolean;extR?:boolean;levels?:number[];box?:Box;label?:Box;touchX?:number};
export type Hit={part:'body'}|{part:'handle';index:number};
const inBox=(p:Pt,b:Box,tol:number)=>p.x>=b.x-tol&&p.x<=b.x+b.w+tol&&p.y>=b.y-tol&&p.y<=b.y+b.h+tol;
const rectOf=(a:Pt,b:Pt):Box=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)});
// úchyty: bez úchytů je horizontála, text a štětec
export const hasHandles=(t:DrawType)=>t!=='hline'&&t!=='text'&&t!=='brush';
// zásah: nejdřív úchyty, pak tělo; tol v px
export function hitShape(s:Shape,p:Pt,w:number,h:number,tol=6):Hit|null{
 if(hasHandles(s.type))for(let i=0;i<s.pts.length;i++)if(Math.hypot(p.x-s.pts[i].x,p.y-s.pts[i].y)<=tol+2)return {part:'handle',index:i};
 if(s.label&&inBox(p,s.label,0))return {part:'body'};
 const [a,b]=s.pts,extR=s.extR??s.ray??false,extL=s.extL??false;
 const seg=(x:Pt,y:Pt)=>distToSegment(p,x,y)<=tol;
 const body=(ok:boolean):Hit|null=>ok?{part:'body'}:null;
 switch(s.type){
  case 'hline':return body(Math.abs(p.y-a.y)<=tol);
  case 'hray':return body(Math.abs(p.y-a.y)<=tol&&p.x>=a.x-tol);
  case 'touch':return body(Math.abs(p.y-a.y)<=tol&&p.x>=a.x-tol&&p.x<=(s.touchX??w)+tol);
  case 'trend':case 'ray':{const [x,y]=extendSeg(a,b,w,h,extL,s.type==='ray'?(s.extR??true):extR);return body(seg(x,y))}
  case 'path':case 'brush':{for(let i=1;i<s.pts.length;i++)if(seg(s.pts[i-1],s.pts[i]))return {part:'body'};return null}
  case 'channel':{
   const off=channelOffset(a,b,s.pts[2]??b),[x,y]=extendSeg(a,b,w,h,extL,extR),x2={x:x.x,y:x.y+off},y2={x:y.x,y:y.y+off};
   return body(seg(x,y)||seg(x2,y2)||inPoly(p,[x,y,y2,x2]));
  }
  case 'rect':{
   const r=rectOf(a,b);if(extL){r.w+=r.x;r.x=0}if(extR)r.w=Math.max(r.w,w-r.x);
   return body(inBox(p,r,tol));
  }
  case 'measure':case 'prange':case 'trange':return body(inBox(p,rectOf(a,b),tol));
  case 'long':case 'short':{
   const x0=Math.min(a.x,b.x),x1=Math.max(a.x,b.x),ys=[a.y,b.y,s.pts[2].y];
   return body(inBox(p,{x:x0,y:Math.min(...ys),w:x1-x0,h:Math.max(...ys)-Math.min(...ys)},tol));
  }
  case 'fib':{
   const x0=extL?0:Math.min(a.x,b.x),x1=extR?w:Math.max(a.x,b.x);
   if(p.x<x0-tol||p.x>x1+tol)return null;
   if(seg(a,b))return {part:'body'};
   return body((s.levels||[]).some(y=>Math.abs(p.y-y)<=tol));
  }
  case 'text':return body(!!s.box&&inBox(p,s.box,tol));
  case 'fibext':{
   const c=s.pts[2]??b,[x0,x1]=fibExtSpan(a,b,c,w,extL,extR);
   if(seg(a,b)||seg(b,c))return {part:'body'};
   if(p.x<x0-tol||p.x>x1+tol)return null;
   return body((s.levels||[]).some(y=>Math.abs(p.y-y)<=tol));
  }
  case 'pitchfork':{
   const f=pitchfork(a,b,s.pts[2]??b),ln=(g:Seg)=>{const [x,y]=extendSeg(g[0],g[1],w,h,extL,extR);return seg(x,y)};
   return body(ln(f.mid)||ln(f.upper)||ln(f.lower)||seg(b,s.pts[2]??b));
  }
  case 'gann':return body(inBox(p,rectOf(a,b),tol));
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
 const sign=signOf(m.dp);
 return [`${sign}${price(Math.abs(m.dp))} (${sign}${pctFmt(m.pct)} %)`,`${m.bars} ${candlesWord(m.bars)} · ${fmtDuration(m.ms)}`];
}
