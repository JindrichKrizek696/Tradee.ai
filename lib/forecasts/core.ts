// Prognózy FX párů: Trading Economics (stránky měn + přehled prognóz) a ING Think (tabulka na think.ing.com/forecasts).
// Čistá logika bez sítě; kontrola: node --experimental-strip-types scripts/check-forecasts.mjs. Stahuje scripts/refresh-forecasts.mjs → data/forecasts.json.
export type Pt={period:string;value:number};
export type TeForecast={q?:Pt;y12?:{value:number};quarters?:Pt[];current?:number;asOf?:string;url:string;derived?:boolean};
export type IngForecast={q1?:Pt;q2?:Pt;q3?:Pt;q4?:Pt;asOf:string;url:string;derived?:boolean};
export type PairForecast={te?:TeForecast;ing?:IngForecast};
export type Forecasts={updated:string|null;attemptedAt?:string;ingAttemptedAt?:string;pairs:Record<string,PairForecast>};

export const TE_BASE='https://tradingeconomics.com/';
export const TE_OVERVIEW='forecast/currency';
// Země → pár v orientaci Tradee (TE kotuje měnu země vůči USD, u JPY/CHF/CAD obráceně – ověřuje se podle textu stránky).
export const TE_PAGES=[
 {path:'euro-area/currency',pair:'EUR/USD'},{path:'united-kingdom/currency',pair:'GBP/USD'},{path:'japan/currency',pair:'USD/JPY'},
 {path:'switzerland/currency',pair:'USD/CHF'},{path:'canada/currency',pair:'USD/CAD'},{path:'australia/currency',pair:'AUD/USD'},{path:'new-zealand/currency',pair:'NZD/USD'},
];
export const ING_URL='https://think.ing.com/forecasts/';

const num=(s:string)=>Number(s.replace(/,/g,''));
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
export const htmlText=(h:string)=>h.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
export const invert=(v:number)=>1/v;
export const inverse=(pair:string)=>pair.split('/').reverse().join('/');

/** Stránka měny TE (text): kotace, aktuální hodnota, datum, cíl na konec čtvrtletí a za 12 měsíců (2 desetinná místa). */
export type TePage={quote:string;current:number;asOf:string;q:number;y12:number};
export function parseTePage(text:string):TePage|null{
 const c=text.match(/The ([A-Z]{3})\/([A-Z]{3}) exchange rate (?:\w+ ){0,3}?(?:to|at) ([\d,.]+) on ([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
 const q=text.match(/is expected to trade at ([\d,.]+) by the end of this quarter/),y=text.match(/we estimate it to trade at ([\d,.]+) in 12 months time/);
 if(!c||!q||!y)return null;
 const mi=MONTHS.indexOf(c[4].toLowerCase());if(mi<0)return null;
 const [cur,qq,yy]=[num(c[3]),num(q[1]),num(y[1])];if(![cur,qq,yy].every(v=>Number.isFinite(v)&&v>0))return null;
 return {quote:c[1]+'/'+c[2],current:cur,asOf:`${c[6]}-${String(mi+1).padStart(2,'0')}-${c[5].padStart(2,'0')}`,q:qq,y12:yy};
}
/** Převod hodnot stránky do orientace Tradee (přímo, nebo 1/x; jiná kotace = null). */
export function orientTe(p:TePage,pair:string):{current:number;q:number;y12:number;inverted:boolean}|null{
 if(p.quote===pair)return {current:p.current,q:p.q,y12:p.y12,inverted:false};
 if(p.quote===inverse(pair))return {current:invert(p.current),q:invert(p.q),y12:invert(p.y12),inverted:true};
 return null;
}

/** Přehled TE (/forecast/currency): konce čtyř čtvrtletí s přesností na 4–6 míst. Vstup = HTML (v RSC je JSON s uvozovkami escapovanými). */
export type TeOverview={periods:string[];symbols:Record<string,{last:number;f:number[]}>};
export function parseTeOverview(html:string):TeOverview|null{
 const periods=[...html.matchAll(/>\s*Q([1-4])\/(\d\d)\s*</g)].slice(0,4).map(m=>`20${m[2]}-Q${m[1]}`);
 const u=html.replace(/\\"/g,'"'),symbols:TeOverview['symbols']={};
 for(const m of u.matchAll(/"name":"([A-Z]{6})".{0,300}?"last":([\d.]+).{0,60}?"forecast1":([\d.]+),"forecast2":([\d.]+),"forecast3":([\d.]+),"forecast4":([\d.]+)/g))
  if(!symbols[m[1]])symbols[m[1]]={last:Number(m[2]),f:[3,4,5,6].map(i=>Number(m[i]))};
 return periods.length===4&&Object.keys(symbols).length?{periods,symbols}:null;
}

/** ING: tabulka „FX … G10 (eop) 3Q26F 4Q26F …“ na stránce prognóz. rok = rok vydání (z názvu PDF „October_2026_INGF.pdf“). */
export type IngTable={asOf:string;periods:string[];pairs:Record<string,number[]>};
export function parseIngFx(text:string,year:number):IngTable|null{
 const i=text.search(/FX Last updated:/);if(i<0)return null;
 const t=text.slice(i),u=t.match(/Last updated:\s*(\d{1,2})\s+([A-Z][a-z]+)/);if(!u)return null;
 const mi=MONTHS.indexOf(u[2].toLowerCase());if(mi<0)return null;
 const hdr=t.match(/\(eop\)\s+((?:[1-4]Q\d\dF\s+)+)/);if(!hdr)return null;
 const cols=hdr[1].trim().split(/\s+/),periods=cols.map(c=>`20${c.slice(2,4)}-Q${c[0]}`);
 const end=t.search(/EMEA \(eop\)/),body=end>0?t.slice(0,end):t,pairs:Record<string,number[]>={};
 const re=new RegExp(`\\b([A-Z]{3}/[A-Z]{3})((?:\\s+[\\d,]+(?:\\.\\d+)?){${cols.length}})(?!\\s*[\\d,])`,'g');
 for(const m of body.matchAll(re))pairs[m[1]]??=m[2].trim().split(/\s+/).map(num);
 if(!Object.keys(pairs).length)return null;
 return {asOf:`${year}-${String(mi+1).padStart(2,'0')}-${u[1].padStart(2,'0')}`,periods,pairs};
}

// ---- Převod do všech 28 párů Tradee
export const PAIRS=['EUR/USD','GBP/USD','USD/JPY','USD/CHF','USD/CAD','AUD/USD','NZD/USD','EUR/CAD','EUR/GBP','EUR/JPY','EUR/CHF','EUR/AUD','EUR/NZD','GBP/JPY','GBP/CHF','GBP/CAD','GBP/AUD','GBP/NZD','CHF/JPY','CAD/JPY','CAD/CHF','AUD/JPY','AUD/CAD','AUD/CHF','AUD/NZD','NZD/CHF','NZD/JPY','NZD/CAD'];
/** Kolik USD stojí 1 jednotka měny (z kotací daného horizontu); null, pokud chybí podklad. */
function usdPer(c:string,v:Record<string,number|undefined>):number|null{
 if(c==='USD')return 1;
 const d=v[c+'/USD'];if(d)return d;
 const r=v['USD/'+c];if(r)return 1/r;
 const e=v['EUR/'+c],eu=v['EUR/USD'];if(e&&eu)return eu/e; // např. CHF z EUR/CHF
 return null;
}
/** Hodnota páru z kotací horizontu: přímá kotace, obrácená, nebo přepočet přes USD (derived). Přepočet je přesná křížová aritmetika, ne samostatná předpověď zdroje. */
export function crossValue(pair:string,v:Record<string,number|undefined>):{value:number;derived:boolean}|null{
 if(v[pair])return {value:v[pair]!,derived:false};
 if(v[inverse(pair)])return {value:1/v[inverse(pair)]!,derived:false};
 const [a,b]=pair.split('/'),x=usdPer(a,v),y=usdPer(b,v);
 return x&&y?{value:x/y,derived:true}:null;
}
/** Zaokrouhlení hodnoty podle typu páru (JPY 3, ostatní 5 míst). */
export const rnd=(pair:string,v:number)=>{const d=pair.includes('JPY')?3:5;return Math.round(v*10**d)/10**d};
export const digits=(pair:string)=>pair.includes('JPY')?2:4;

export function periodEnd(period:string):string{ // '2026-Q4' → '2026-12-31'
 const m=period.match(/^(\d{4})-Q([1-4])$/);if(!m)throw Error('Neplatné období '+period);
 const mo=Number(m[2])*3;return new Date(Date.UTC(Number(m[1]),mo,0)).toISOString().slice(0,10);
}
export const quarterOf=(iso:string)=>`${iso.slice(0,4)}-Q${Math.floor((Number(iso.slice(5,7))-1)/3)+1}`;

/** Sestaví TE prognózu pro všech 28 párů. majors = výsledek parseTePage+orientTe podle páru, overview = parseTeOverview. */
export function buildTe(majors:Record<string,{current:number;q:number;y12:number;asOf:string;url:string}>,overview:TeOverview|null,today:string,overviewUrl:string):Record<string,TeForecast>{
 const out:Record<string,TeForecast>={},cur:Record<string,number|undefined>={},q:Record<string,number|undefined>={},y:Record<string,number|undefined>={};
 const qs:Record<string,number|undefined>[]=[{},{},{},{}];
 for(const [p,m] of Object.entries(majors)){cur[p]=m.current;q[p]=m.q;y[p]=m.y12}
 if(overview)for(const [sym,o] of Object.entries(overview.symbols)){const p=sym.slice(0,3)+'/'+sym.slice(3);if(PAIRS.includes(p)||PAIRS.includes(inverse(p)))o.f.forEach((val,i)=>{qs[i][p]=val});}
 for(const pair of PAIRS){
  const c=crossValue(pair,cur),fq=crossValue(pair,q),fy=crossValue(pair,y);
  if(!c&&!fq)continue;
  const quarters=overview?qs.map((m,i)=>{const r=crossValue(pair,m);return r?{period:overview.periods[i],value:rnd(pair,r.value)}:null}).filter((x):x is Pt=>!!x):[];
  const direct=!!majors[pair];
  const e:TeForecast={url:direct?TE_BASE+TE_PAGES.find(x=>x.pair===pair)!.path:TE_BASE+TE_OVERVIEW,asOf:direct?majors[pair].asOf:today};
  if(c)e.current=rnd(pair,c.value);
  if(quarters.length)e.q=quarters[0];else if(fq)e.q={period:quarterOf(today),value:rnd(pair,fq.value)};
  if(quarters.length)e.quarters=quarters;
  if(direct&&fy)e.y12={value:rnd(pair,fy.value)}; // u křížů by zaokrouhlení vstupů (2 místa) dalo nepřesnost → jen čtvrtletí
  if(!direct)e.derived=true;
  out[pair]=e;
 }
 return out;
}

/** ING: přímé kotace z tabulky, ostatní páry přepočtem přes USD (derived). Jen období od aktuálního čtvrtletí dál. */
export function buildIng(t:IngTable,url:string,today:string):Record<string,IngForecast>{
 const cur=quarterOf(today),keep=t.periods.map((p,i)=>({p,i})).filter(x=>x.p>=cur).slice(0,4),out:Record<string,IngForecast>={};
 for(const pair of PAIRS){
  const e:IngForecast={asOf:t.asOf,url};let any=false,derived=false;
  keep.forEach((k,n)=>{
   const v:Record<string,number|undefined>={};for(const [p,a] of Object.entries(t.pairs))v[p]=a[k.i];
   const r=crossValue(pair,v);if(!r)return;
   any=true;derived=derived||r.derived;
   (e as unknown as Record<string,Pt>)['q'+(n+1)]={period:k.p,value:rnd(pair,r.value)};
  });
  if(!any)continue;
  if(derived)e.derived=true;
  out[pair]=e;
 }
 return out;
}
/** Změna prognózy proti ceně v %. */
export const changePct=(forecast:number,spot:number)=>spot>0?(forecast/spot-1)*100:null;
