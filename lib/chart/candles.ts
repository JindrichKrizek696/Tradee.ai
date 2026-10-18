// Svíčky grafu trhu (Yahoo): parsování, agregace H4, objem (i z futures u FX), stáří cache. Čisté funkce – testy scripts/check-chart.mjs.
// [čas ms UTC, open, high, low, close] a volitelně objem (jen když ho zdroj má; FX spot ho na Yahoo nemá)
export type Candle=[number,number,number,number,number]|[number,number,number,number,number,number];
export type Tf='M1'|'M5'|'M15'|'M30'|'H1'|'H2'|'H4'|'D1'|'W1'|'MN';
export const TFS:readonly Tf[]=['M1','M5','M15','M30','H1','H2','H4','D1','W1','MN'];
// zdroj svíček: Yahoo interval/range (range = plná historie, tail = jen čerstvý ocas, když je k dispozici archiv market_bars);
// base = archiv H1/D1, ze kterého se svíčky skládají; agg = jak se z báze agreguje
export type TfSource={interval:string;range:string;tail?:string;base?:'H1'|'D1';agg?:'H2'|'H4'|'W1'|'MN'};
export const TF_SOURCE:Record<Tf,TfSource>={
 M1:{interval:'1m',range:'7d'},M5:{interval:'5m',range:'60d'},M15:{interval:'15m',range:'60d'},M30:{interval:'30m',range:'60d'},
 H1:{interval:'60m',range:'700d',tail:'60d',base:'H1'},H2:{interval:'60m',range:'700d',tail:'60d',base:'H1',agg:'H2'},H4:{interval:'60m',range:'700d',tail:'60d',base:'H1',agg:'H4'},
 D1:{interval:'1d',range:'10y',tail:'1mo',base:'D1'},W1:{interval:'1d',range:'10y',tail:'1mo',base:'D1',agg:'W1'},MN:{interval:'1d',range:'10y',tail:'1mo',base:'D1',agg:'MN'},
};
export const TF_CAP:Record<Tf,number>={M1:3000,M5:3000,M15:3000,M30:3000,H1:3000,H2:3000,H4:3000,D1:3000,W1:3000,MN:3000};
export const HISTORY_FROM=Date.UTC(2020,0,1); // dlouhé TF (D1, W1, MN) nejdál do roku 2020
const H=3600000,DAY=86400000;
type YahooCandles={chart?:{result?:{timestamp?:number[];indicators?:{quote?:{open?:(number|null)[];high?:(number|null)[];low?:(number|null)[];close?:(number|null)[];volume?:(number|null)[]}[]}}[]|null}};
const ok=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
// odpověď /v8/finance/chart → svíčky; řádky s chybějící hodnotou se vynechají; nepoužitelná odpověď → []
export function parseYahoo(json:unknown):Candle[]{
 const res=(json as YahooCandles|null)?.chart?.result?.[0];if(!res)return [];
 const ts=res.timestamp||[],q=res.indicators?.quote?.[0];if(!q)return [];
 const out:Candle[]=[];
 ts.forEach((s,i)=>{const o=q.open?.[i],h=q.high?.[i],l=q.low?.[i],c=q.close?.[i],v=q.volume?.[i];if(ok(s)&&ok(o)&&ok(h)&&ok(l)&&ok(c))out.push(ok(v)&&v>0?[s*1000,o,h,l,c,v]:[s*1000,o,h,l,c])});
 return out.sort((a,b)=>a[0]-b[0]);
}
// obecná agregace: svíčky se seskupí podle klíče koše (začátek koše v ms UTC); koš = jedna svíčka z libovolného počtu vstupních, neúplný poslední koš zůstává
export function bucketAggregate(src:Candle[],key:(t:number)=>number):Candle[]{
 const out:Candle[]=[];
 for(const [t,o,h,l,c,v] of [...src].sort((a,b)=>a[0]-b[0])){
  const k=key(t),last=out[out.length-1];
  if(last&&last[0]===k){last[2]=Math.max(last[2],h);last[3]=Math.min(last[3],l);last[4]=c;if(v!==undefined)last[5]=(last[5]??0)+v}else out.push(v!==undefined?[k,o,h,l,c,v]:[k,o,h,l,c]);
 }
 return out;
}
const hours=(n:number)=>(t:number)=>Math.floor(t/(n*H))*n*H;
// hodinové svíčky → 2hodinové (UTC 0/2/4/…) a 4hodinové (UTC 0/4/8/…)
export const toH2=(h1:Candle[]):Candle[]=>bucketAggregate(h1,hours(2));
export const toH4=(h1:Candle[]):Candle[]=>bucketAggregate(h1,hours(4));
// denní svíčky Yahoo mají čas otevření podle burzy (FX 22–23 h UTC předchozího dne, akcie 13–14 h UTC) → pro koše se den určí posunem o 3 h
export const dayIndex=(t:number)=>Math.floor((t+3*H)/DAY);
// D1 → ISO týdny, otevření v pondělí 00:00 UTC
export const toW1=(d1:Candle[]):Candle[]=>bucketAggregate(d1,t=>{const d=dayIndex(t);return (d-((d+3)%7))*DAY});
// D1 → kalendářní měsíce, otevření prvního dne 00:00 UTC
export const toMN=(d1:Candle[]):Candle[]=>bucketAggregate(d1,t=>{const x=new Date(dayIndex(t)*DAY);return Date.UTC(x.getUTCFullYear(),x.getUTCMonth(),1)});
// Yahoo u FX párů (symbol …=X) vrací v denních svíčkách open ≈ close téhož dne (svíčky bez těla);
// forex se obchoduje nepřetržitě, takže open = close předchozího dne a high/low se o něj rozšíří
export function fixFxDailyOpen(src:Candle[]):Candle[]{
 return src.map((c,i)=>{if(!i)return c;const o=src[i-1][4];return [c[0],o,Math.max(c[2],o),Math.min(c[3],o),c[4],...c.slice(5)] as Candle});
}
// archiv + čerstvý ocas: ocas přepíše archiv od svého prvního času
export function mergeTail(base:Candle[],tail:Candle[]):Candle[]{
 if(!tail.length)return base;
 return [...base.filter(c=>c[0]<tail[0][0]),...tail];
}
// ze série báze (H1 / D1) složí svíčky cílového TF
export function buildTf(tf:Tf,series:Candle[]):Candle[]{
 const agg=TF_SOURCE[tf].agg;
 return agg==='H2'?toH2(series):agg==='H4'?toH4(series):agg==='W1'?toW1(series):agg==='MN'?toMN(series):series;
}
// FX spot nemá na Yahoo objem: hlavní páry berou objem z futures CME na stejnou měnu (USD/JPY, USD/CHF, USD/CAD jsou obrácené, ale objem je objem)
export const VOLUME_PROXY:Record<string,string>={'EUR/USD':'6E=F','GBP/USD':'6B=F','AUD/USD':'6A=F','NZD/USD':'6N=F','USD/JPY':'6J=F','USD/CHF':'6S=F','USD/CAD':'6C=F'};
// klíč koše pro spárování svíček podle intervalu zdroje (denní podle dne s posunem jako u W1/MN, jinak podle začátku intervalu)
const INTERVAL_MS:Record<string,number>={'1m':60000,'5m':300000,'15m':900000,'30m':1800000,'60m':H};
export const volumeKey=(interval:string)=>interval==='1d'?dayIndex:(t:number)=>Math.floor(t/(INTERVAL_MS[interval]??H));
// objem z jiné série (futures) do svíček podle koše; svíčka bez protějšku zůstane bez objemu, vlastní objem svíčky se nepřepisuje
export function withVolume(series:Candle[],vol:Candle[],key:(t:number)=>number):Candle[]{
 const m=new Map<number,number>();
 for(const c of vol){const v=c[5];if(v!==undefined&&v>0){const k=key(c[0]);m.set(k,(m.get(k)??0)+v)}}
 if(!m.size)return series;
 return series.map(c=>{if(c[5]!==undefined)return c;const v=m.get(key(c[0]));return v?[c[0],c[1],c[2],c[3],c[4],v]:c});
}
export const STALE_MS:Record<Tf,number>={M1:60000,M5:3*60000,M15:5*60000,M30:5*60000,H1:15*60000,H2:15*60000,H4:15*60000,D1:6*H,W1:6*H,MN:6*H};
export const stale=(tf:Tf,updatedMs:number,now:number)=>!(updatedMs>0)||now-updatedMs>=STALE_MS[tf];
