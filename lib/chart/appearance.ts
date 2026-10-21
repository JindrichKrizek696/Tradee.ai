// Vzhled grafu trhu (ozubené kolečko v liště): barvy svíček (jako Barvy signálu, jedna z jejich předvoleb, nebo vlastní tělo / obrys / knot),
// barva čáry, pozadí, mřížka, nitkový kříž, poslední cena a odpočet do zavření svíčky. Ukládá se k účtu v drawing_prefs (klíč appearance).
// Čisté funkce – testy scripts/check-appearance.mjs.
import {getPalette,isPalette} from '../palettes.ts';

export const CANDLE_PARTS=['body','border','wick'] as const;
export type CandlePart=typeof CANDLE_PARTS[number];
export type PartColors={on:boolean;up:string;down:string};
export const GRID_LINES=['both','h','v','none'] as const;
export type GridLines=typeof GRID_LINES[number];
export const GRID_STYLES=['solid','dashed','dotted'] as const;
export type GridStyle=typeof GRID_STYLES[number];
export const CROSSHAIRS=['normal','magnet','hidden'] as const;
export type Crosshair=typeof CROSSHAIRS[number];
// src: 'app' = podle Barev signálu (mění se s nimi), id předvolby z lib/palettes, 'custom' = vlastní barvy těla, obrysu a knotu
// line / bg / gridColor: null = podle motivu; barvy #rrggbb nebo #rrggbbaa (průhlednost)
export type Appearance={src:string;body:PartColors;border:PartColors;wick:PartColors;line:string|null;bg:string|null;grid:GridLines;gridStyle:GridStyle;gridColor:string|null;crosshair:Crosshair;lastLine:boolean;lastLabel:boolean;countdown:boolean};
// výchozí = vzhled grafu před nastavením (tělo a knot v barvách signálu, bez obrysu, plná mřížka podle motivu)
export const APPEARANCE_DEFAULT:Appearance={src:'app',body:{on:true,up:'#16a34a',down:'#dc2626'},border:{on:false,up:'#16a34a',down:'#dc2626'},wick:{on:true,up:'#16a34a',down:'#dc2626'},line:null,bg:null,grid:'both',gridStyle:'solid',gridColor:null,crosshair:'normal',lastLine:true,lastLabel:true,countdown:false};

const COLOR=/^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
// barva nastavení: malými písmeny, plné krytí bez přípony ff
export const isColor=(v:unknown):v is string=>typeof v==='string'&&COLOR.test(v);
export const normColor=(c:string)=>{const v=c.toLowerCase();return v.length===9&&v.endsWith('ff')?v.slice(0,7):v};
// libovolná barva z CSS (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba()) → #rrggbb(aa); jiná null
export function toHex(c:string):string|null{
 const v=c.trim().toLowerCase(),h=v.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
 if(h)return normColor('#'+(h[1].length===3?h[1].split('').map(x=>x+x).join(''):h[1]));
 const r=v.match(/^rgba?\(([^)]+)\)$/);if(!r)return null;
 const p=r[1].split(/[\s,/]+/).filter(Boolean),n=p.slice(0,3).map(Number),a=p[3]===undefined?1:p[3].endsWith('%')?parseFloat(p[3])/100:Number(p[3]);
 if(n.length<3||!n.every(x=>Number.isFinite(x)&&x>=0&&x<=255)||!Number.isFinite(a))return null;
 const hx=(x:number)=>Math.round(x).toString(16).padStart(2,'0');
 return normColor('#'+n.map(hx).join('')+hx(Math.min(1,Math.max(0,a))*255));
}
// #rrggbb(aa) → základ a krytí 0–1
export const splitColor=(c:string)=>({hex:c.slice(0,7).toLowerCase(),a:c.length===9?parseInt(c.slice(7),16)/255:1});
// základ #rrggbb + krytí 0–1 → barva nastavení
export const withOpacity=(hex:string,a:number)=>normColor(hex.slice(0,7)+Math.round(Math.min(1,Math.max(0,a))*255).toString(16).padStart(2,'0'));
// barva pro graf: plná jako #rrggbb, průhledná jako rgba()
export function toCss(c:string){
 const {hex,a}=splitColor(c);if(a>=1)return hex;
 const n=parseInt(hex.slice(1),16);return `rgba(${n>>16},${(n>>8)&255},${n&255},${Math.round(a*1000)/1000})`;
}
// světlá barva (relativní jas > 0,5) – podle ní text na pozadí grafu a ve štítku odpočtu
export function isLight(c:string){
 const n=parseInt(splitColor(c).hex.slice(1),16),[r,g,b]=[n>>16,(n>>8)&255,n&255].map(x=>{const s=x/255;return s<=.03928?s/12.92:((s+.055)/1.055)**2.4});
 return .2126*r+.7152*g+.0722*b>.5;
}

// mřížka a okraje os na vlastním pozadí: jemná tmavá na světlém, jemná světlá na tmavém (barva motivu by nemusela být vidět, nebo by řvala)
export const canvasLine=(bg:string)=>isLight(bg)?'#00000017':'#ffffff17';

const bool=(v:unknown,d:boolean)=>typeof v==='boolean'?v:d;
const pick=<T extends string>(list:readonly T[],v:unknown,d:T):T=>(list as readonly unknown[]).includes(v)?v as T:d;
const color=(v:unknown,d:string)=>isColor(v)?normColor(v):d;
const auto=(v:unknown)=>isColor(v)?normColor(v):null;
function part(v:unknown,d:PartColors):PartColors{
 const o=(v&&typeof v==='object'&&!Array.isArray(v)?v:{}) as Record<string,unknown>;
 return {on:bool(o.on,d.on),up:color(o.up,d.up),down:color(o.down,d.down)};
}
// tolerantní načtení (DB, localStorage i PUT): neplatné nebo chybějící hodnoty = výchozí, nic nespadne
export function readAppearance(raw:unknown):Appearance{
 const d=APPEARANCE_DEFAULT,o=(raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}) as Record<string,unknown>;
 return {src:o.src==='app'||o.src==='custom'||isPalette(o.src)?o.src as string:d.src,body:part(o.body,d.body),border:part(o.border,d.border),wick:part(o.wick,d.wick),
  line:auto(o.line),bg:auto(o.bg),grid:pick(GRID_LINES,o.grid,d.grid),gridStyle:pick(GRID_STYLES,o.gridStyle,d.gridStyle),gridColor:auto(o.gridColor),
  crosshair:pick(CROSSHAIRS,o.crosshair,d.crosshair),lastLine:bool(o.lastLine,d.lastLine),lastLabel:bool(o.lastLabel,d.lastLabel),countdown:bool(o.countdown,d.countdown)};
}
export const sameAppearance=(a:Appearance,b:Appearance)=>JSON.stringify(readAppearance(a))===JSON.stringify(readAppearance(b));

// barvy signálu aplikace a motiv (z CSS proměnných --bull / --bear a data-theme)
export type CandleCtx={dark:boolean;bull:string;bear:string};
// up / down pro předvolbu: 'app' = barvy signálu, předvolba v tmavém motivu své tmavé barvy (černá ↔ bílá)
export function sourcePair(src:string,ctx:CandleCtx):{up:string;down:string}{
 if(src==='app')return {up:ctx.bull,down:ctx.bear};
 const p=getPalette(src),c=ctx.dark&&p.dark?p.dark:p;return {up:c.bull,down:c.bear};
}
export type Resolved=Record<CandlePart,PartColors>;
// výsledné barvy těla, obrysu a knotu: u předvolby všechny tři v její dvojici, zapnutí podle nastavení; u vlastních uložené barvy
export function resolveCandles(a:Appearance,ctx:CandleCtx):Resolved{
 if(a.src==='custom')return {body:{...a.body},border:{...a.border},wick:{...a.wick}};
 const {up,down}=sourcePair(a.src,ctx);
 return {body:{on:a.body.on,up,down},border:{on:a.border.on,up,down},wick:{on:a.wick.on,up,down}};
}
// barvy hodnot v legendě (O H L C) jako svíčky: u Barev signálu null (texty aplikace), u předvolby ve světlém motivu její textové barvy
// (čitelné na bílé), v tmavém její tmavé barvy; u vlastních barvy těla bez průhlednosti
export function legendPair(a:Appearance,ctx:CandleCtx):{up:string;down:string}|null{
 if(a.src==='app')return null;
 if(a.src==='custom')return {up:splitColor(a.body.up).hex,down:splitColor(a.body.down).hex};
 const p=getPalette(a.src);return ctx.dark?sourcePair(a.src,ctx):{up:p.bullText,down:p.bearText};
}
// úprava jedné barvy u předvolby: z dvojice předvolby se stanou vlastní barvy (ostatní části zůstanou, jak vypadaly) a změní se jen ta jedna
export function setPartColor(a:Appearance,ctx:CandleCtx,p:CandlePart,side:'up'|'down',c:string):Appearance{
 const r=resolveCandles(a,ctx),hex=(x:string,d:string)=>toHex(x)??d;
 const base:Resolved=a.src==='custom'?r:{body:{...r.body,up:hex(r.body.up,a.body.up),down:hex(r.body.down,a.body.down)},border:{...r.border,up:hex(r.border.up,a.border.up),down:hex(r.border.down,a.border.down)},wick:{...r.wick,up:hex(r.wick.up,a.wick.up),down:hex(r.wick.down,a.wick.down)}};
 return {...a,src:'custom',...base,[p]:{...base[p],[side]:normColor(c)}};
}

// odpočet do zavření svíčky: konec svíčky (čas grafu, s) – u měsíčních (MN) začátek dalšího měsíce
export function barEnd(start:number,tfSec:number){
 if(tfSec<28*86400)return start+tfSec;
 const d=new Date(start*1000);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000;
}
// zbývající sekundy, nebo null, když svíčka už skončila (trh zavřený, data neaktuální) nebo ještě nezačala
export function closeIn(start:number,tfSec:number,now:number):number|null{
 const left=barEnd(start,tfSec)-now;return left>0&&now>=start?left:null;
}
// 59:07 · 3:59:07 · 2d 13h
export function fmtCountdown(sec:number){
 const s=Math.max(0,Math.floor(sec)),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),x=s%60,p=(n:number)=>String(n).padStart(2,'0');
 if(d>0)return d+'d '+h+'h';
 return h>0?h+':'+p(m)+':'+p(x):p(m)+':'+p(x);
}
