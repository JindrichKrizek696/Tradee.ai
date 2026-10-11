// Footprint pro krypto (Binance): obchody (aggTrades) → cenové hladiny svíčky s nákupy a prodeji (taker), delta, POC a diagonální nerovnováhy.
// Čisté funkce – testy scripts/check-footprint.mjs. Stav svíčky se ukládá v DB (footprint_cache) a doplňuje po dávkách.
export const FP_TFS=['M5','M15','H1'] as const;
export type FpTf=typeof FP_TFS[number];
export const FP_TF_MS:Record<FpTf,number>={M5:300000,M15:900000,H1:3600000};
export const FP_INTERVAL:Record<FpTf,string>={M5:'5m',M15:'15m',H1:'1h'};
// historie: ~24 h pro M5/M15, ~3 dny pro H1
export const FP_HISTORY:Record<FpTf,number>={M5:288,M15:96,H1:72};
export const FP_SYMBOLS:Record<string,string>={'BTC-USD':'BTCUSDT','ETH-USD':'ETHUSDT','SOL-USD':'SOLUSDT'};
export const fpSymbol=(instrument:string)=>FP_SYMBOLS[instrument]??null;
export const isFpTf=(v:unknown):v is FpTf=>typeof v==='string'&&(FP_TFS as readonly string[]).includes(v);
// základní krok ukládání a žebříček kroků pro zobrazení (vybere se tak, aby svíčka měla ~10–25 řádků)
export const FP_BASE:Record<string,number>={BTCUSDT:5,ETHUSDT:.25,SOLUSDT:.01};
export const FP_LADDER:Record<string,number[]>={BTCUSDT:[5,10,25,50,100,250],ETHUSDT:[.25,.5,1,2,5,10],SOLUSDT:[.01,.02,.05,.1,.2,.5]};
export const IMBALANCE=3;

export type Trade={id:number;p:number;q:number;t:number;m:boolean};
// stav svíčky: OHLC z klines, další ID obchodu k načtení, hotovo, hladiny {index základního kroku: [nákup, prodej]}
export type FpState={t:number;o:number;h:number;l:number;c:number;v:number;next:number|null;done:boolean;n:number;b:Record<string,[number,number]>};
export type FpRow=[price:number,sell:number,buy:number,flags:number]; // flags: 1 = nákupní nerovnováha, 2 = prodejní
export type FpCandle={t:number;o:number;h:number;l:number;c:number;v:number;d?:number;poc?:number;rows?:FpRow[];live?:boolean};

const fin=(v:unknown)=>{const n=typeof v==='string'?Number(v):v;return typeof n==='number'&&Number.isFinite(n)?n:NaN};
// odpověď /api/v3/aggTrades → obchody (m=true: kupující je maker → taker prodává)
export function parseAggTrades(json:unknown):Trade[]{
 if(!Array.isArray(json))return [];
 const out:Trade[]=[];
 for(const r of json){if(!r||typeof r!=='object')continue;const x=r as Record<string,unknown>,id=fin(x.a),p=fin(x.p),q=fin(x.q),t=fin(x.T);
  if([id,p,q,t].every(Number.isFinite)&&p>0&&q>=0)out.push({id,p,q,t,m:x.m===true})}
 return out;
}
// odpověď /api/v3/klines → [čas, o, h, l, c, objem]
export function parseKlines(json:unknown):[number,number,number,number,number,number][]{
 if(!Array.isArray(json))return [];
 return json.flatMap(r=>{if(!Array.isArray(r))return [];const v=[0,1,2,3,4,5].map(i=>fin(r[i]));return v.every(Number.isFinite)?[v as [number,number,number,number,number,number]]:[]});
}
// index hladiny pro cenu (dolní hrana; drobná tolerance kvůli plovoucí čárce)
export const bucketIndex=(price:number,step:number)=>Math.floor(price/step+1e-9);
export const roundTo=(v:number,step:number)=>{const d=Math.max(0,Math.ceil(-Math.log10(step)-1e-9));return Number((Math.round(v/step)*step).toFixed(Math.min(8,d+1)))};
const vol=(v:number)=>Math.round(v*1e4)/1e4;
export const emptyState=(t:number,o:number,h:number,l:number,c:number,v:number):FpState=>({t,o,h,l,c,v,next:null,done:false,n:0,b:{}});
// přidat obchody do stavu svíčky [t, end); vrací, zda dávka sahá za konec svíčky
export function addTrades(s:FpState,trades:Trade[],base:number,end:number):{reachedEnd:boolean}{
 let reachedEnd=false;
 for(const tr of trades){
  if(tr.t>=end){reachedEnd=true;continue}
  if(tr.t<s.t)continue;
  const k=String(bucketIndex(tr.p,base)),cell=s.b[k]??(s.b[k]=[0,0]);
  if(tr.m)cell[1]=vol(cell[1]+tr.q);else cell[0]=vol(cell[0]+tr.q);
  s.n++;
 }
 if(trades.length)s.next=Math.max(s.next??0,trades[trades.length-1].id+1);
 return {reachedEnd};
}
// krok zobrazení: medián rozsahu svíček / krok + 1 ≈ 12 řádků (z žebříčku symbolu); větší buňky jsou čitelnější
export function chooseTick(ranges:number[],ladder:number[],target=12):number{
 const r=ranges.filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b);if(!r.length)return ladder[0];
 const med=r[Math.floor(r.length/2)];let best=ladder[0],dist=Infinity;
 for(const t of ladder){const d=Math.abs(med/t+1-target);if(d<dist-1e-9){dist=d;best=t}}
 return best;
}
// hladiny svíčky v kroku tick (shora dolů, souvislé – prázdné mezery jako nuly), delta, POC a nerovnováhy
export function footprintOf(b:FpState['b'],base:number,tick:number,ratio=IMBALANCE):{rows:FpRow[];delta:number;total:number;poc:number|null}{
 const k=Math.max(1,Math.round(tick/base)),agg=new Map<number,[number,number]>();
 for(const [key,[buy,sell]] of Object.entries(b)){const i=Math.floor(Number(key)/k),c=agg.get(i)??[0,0];c[0]+=buy;c[1]+=sell;agg.set(i,c)}
 if(!agg.size)return {rows:[],delta:0,total:0,poc:null};
 const idx=[...agg.keys()],lo=Math.min(...idx),hi=Math.max(...idx);
 const lv:{i:number;buy:number;sell:number}[]=[];
 for(let i=lo;i<=hi;i++){const c=agg.get(i)??[0,0];lv.push({i,buy:vol(c[0]),sell:vol(c[1])})}
 let delta=0,total=0,poc=lv[0];
 for(const x of lv){delta+=x.buy-x.sell;total+=x.buy+x.sell;if(x.buy+x.sell>poc.buy+poc.sell)poc=x}
 const rows:FpRow[]=lv.map((x,j)=>{
  let f=0;const below=lv[j-1],above=lv[j+1];
  // nákup na hladině vs. prodej o hladinu níž; prodej vs. nákup o hladinu výš
  if(below&&x.buy>0&&x.buy>=ratio*below.sell)f|=1;
  if(above&&x.sell>0&&x.sell>=ratio*above.buy)f|=2;
  return [roundTo(x.i*k*base,base),x.sell,x.buy,f] as FpRow;
 }).reverse();
 return {rows,delta:vol(delta),total:vol(total),poc:roundTo(poc.i*k*base,base)};
}
// stav → svíčka pro klienta (hladiny jen u hotové nebo živé svíčky)
export function toCandle(s:FpState,base:number,tick:number,live:boolean):FpCandle{
 const c:FpCandle={t:s.t,o:s.o,h:s.h,l:s.l,c:s.c,v:s.v};
 if(live)c.live=true;
 if(s.done||live){const f=footprintOf(s.b,base,tick);if(f.rows.length){c.rows=f.rows;c.d=f.delta;c.poc=f.poc??undefined}}
 return c;
}
// krátký zápis objemu pro buňku: 1234 → 1,2k; 0,0123 → 0,012
export function fmtVol(v:number){
 const a=Math.abs(v);
 if(a>=1e6)return (v/1e6).toLocaleString('cs-CZ',{maximumFractionDigits:1})+'M';
 if(a>=1e4)return Math.round(v/1e3).toLocaleString('cs-CZ')+'k';
 if(a>=1e3)return (v/1e3).toLocaleString('cs-CZ',{maximumFractionDigits:1})+'k';
 if(a>=100)return Math.round(v).toLocaleString('cs-CZ');
 if(a>=1)return v.toLocaleString('cs-CZ',{maximumFractionDigits:1});
 return v.toLocaleString('cs-CZ',{maximumSignificantDigits:2});
}
