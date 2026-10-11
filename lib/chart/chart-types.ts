// Typy grafu trhu (svíčky, duté svíčky, OHLC sloupce, Heikin-Ashi, čára, plocha) a výpočet Heikin-Ashi. Čisté funkce – testy scripts/check-chart.mjs.
export const CHART_TYPES=['candles','hollow','bars','ha','line','area'] as const;
export type ChartType=typeof CHART_TYPES[number];
export const CHART_TYPE_LABELS:Record<ChartType,string>={candles:'Svíčky',hollow:'Duté svíčky',bars:'OHLC sloupce',ha:'Heikin-Ashi',line:'Čára',area:'Plocha'};
export const isChartType=(v:unknown):v is ChartType=>typeof v==='string'&&(CHART_TYPES as readonly string[]).includes(v);
export type OhlcBar={time:number;open:number;high:number;low:number;close:number};
// Heikin-Ashi: close = (O+H+L+C)/4, open = (předchozí HA open + HA close)/2 (první svíčka (O+C)/2), high/low včetně HA open/close
export function heikinAshi<T extends OhlcBar>(bars:T[]):OhlcBar[]{
 const out:OhlcBar[]=[];
 for(let i=0;i<bars.length;i++){
  const b=bars[i],close=(b.open+b.high+b.low+b.close)/4,prev=out[i-1];
  const open=prev?(prev.open+prev.close)/2:(b.open+b.close)/2;
  out.push({time:b.time,open,high:Math.max(b.high,open,close),low:Math.min(b.low,open,close),close});
 }
 return out;
}
// data série podle typu: OHLC (svíčky, sloupce), HA, nebo jen close (čára, plocha)
export function seriesData<T extends OhlcBar>(bars:T[],type:ChartType):(OhlcBar|{time:number;value:number})[]{
 if(type==='ha')return heikinAshi(bars);
 if(type==='line'||type==='area')return bars.map(b=>({time:b.time,value:b.close}));
 return bars.map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close}));
}
