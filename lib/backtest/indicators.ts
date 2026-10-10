// Indikátory pro backtest (čisté funkce, testy scripts/check-backtest.mjs).
// Konvence: výstup má stejnou délku jako vstup, hodnota na indexu i používá jen data 0..i (žádné nahlížení do budoucna);
// dokud není dost dat (zahřívání) nebo okno obsahuje NaN, je hodnota NaN.
type Num=ArrayLike<number>;
const out=(n:number)=>new Float64Array(n).fill(NaN);

// prostý klouzavý průměr z posledních n hodnot včetně i; NaN v okně → NaN (okno se po NaN znovu naplní)
export function sma(v:Num,n:number):Float64Array{
 const r=out(v.length);let sum=0,valid=0;
 for(let i=0;i<v.length;i++){
  const x=v[i];
  if(Number.isNaN(x)){sum=0;valid=0;continue}
  sum+=x;valid++;
  if(valid>n){sum-=v[i-n];valid=n}
  if(valid===n)r[i]=sum/n;
 }
 return r;
}
// exponenciální průměr, k = 2/(n+1), start = SMA prvních n hodnot (na indexu n−1)
export function ema(v:Num,n:number):Float64Array{
 const r=out(v.length),k=2/(n+1);let prev=NaN,sum=0,valid=0;
 for(let i=0;i<v.length;i++){
  const x=v[i];
  if(Number.isNaN(x)){prev=NaN;sum=0;valid=0;continue}
  if(!Number.isNaN(prev)){prev=x*k+prev*(1-k);r[i]=prev;continue}
  sum+=x;valid++;
  if(valid===n){prev=sum/n;r[i]=prev}
 }
 return r;
}
// RSI (Wilder): první průměr zisků/ztrát = prostý průměr n změn (index n), dál avg = (avg·(n−1) + x)/n.
// Bez ztrát → 100, bez pohybu → 50.
export function rsi(close:Num,n:number):Float64Array{
 const r=out(close.length);if(close.length<=n)return r;
 let g=0,l=0;
 for(let i=1;i<=n;i++){const d=close[i]-close[i-1];if(d>0)g+=d;else l-=d}
 g/=n;l/=n;
 const val=()=>l===0?(g===0?50:100):100-100/(1+g/l);
 r[n]=val();
 for(let i=n+1;i<close.length;i++){const d=close[i]-close[i-1];g=(g*(n-1)+(d>0?d:0))/n;l=(l*(n-1)+(d<0?-d:0))/n;r[i]=val()}
 return r;
}
// true range: první svíčka h−l, dál max(h−l, |h−c₋₁|, |l−c₋₁|)
export function trueRange(h:Num,l:Num,c:Num):Float64Array{
 const r=new Float64Array(h.length);
 for(let i=0;i<h.length;i++)r[i]=i?Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])):h[i]-l[i];
 return r;
}
// ATR (Wilder): na indexu n−1 průměr prvních n TR, dál (atr·(n−1) + tr)/n
export function atr(h:Num,l:Num,c:Num,n:number):Float64Array{
 const tr=trueRange(h,l,c),r=out(tr.length);if(tr.length<n)return r;
 let a=0;for(let i=0;i<n;i++)a+=tr[i];a/=n;r[n-1]=a;
 for(let i=n;i<tr.length;i++){a=(a*(n-1)+tr[i])/n;r[i]=a}
 return r;
}
// maximum / minimum z okna n hodnot končícího na i (včetně i). Breakout „nad maximem předchozích N“ čte hodnotu na i−1.
function extreme(v:Num,n:number,max:boolean):Float64Array{
 const r=out(v.length),q=new Int32Array(v.length);let a=0,b=0; // monotónní fronta indexů
 for(let i=0;i<v.length;i++){
  while(b>a&&(max?v[q[b-1]]<=v[i]:v[q[b-1]]>=v[i]))b--;
  q[b++]=i;
  if(q[a]<=i-n)a++;
  if(i>=n-1)r[i]=v[q[a]];
 }
 return r;
}
export const highest=(v:Num,n:number)=>extreme(v,n,true);
export const lowest=(v:Num,n:number)=>extreme(v,n,false);
