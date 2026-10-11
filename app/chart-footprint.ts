// Footprint krypta jako primitivum cenové série (lightweight-charts v5): každá svíčka = sloupec buněk „prodej × nákup“.
// Při malém přiblížení (buňky < ~10 px) nekreslí nic a graf ukazuje běžné svíčky; stav hlásí přes onMode.
import type {ISeriesPrimitive,IPrimitivePaneView,IPrimitivePaneRenderer,SeriesAttachedParameter,Time,Logical} from 'lightweight-charts';
import {fmtVol,type FpCandle} from '@/lib/chart/footprint';
import {withAlpha} from '@/lib/chart/layers';

export type FpPalette={bull:string;bear:string;bg:string;fg:string;muted:string;poc:string};
type CanvasRenderingTarget2D=Parameters<IPrimitivePaneRenderer['draw']>[0];
const FAMILY='Inter Variable, Inter, system-ui, sans-serif';
export const FP_MIN_ROW=10,FP_MIN_COL=28,FP_DELTA_H=18;
const signed=(v:number)=>(v>0?'+':v<0?'−':'')+fmtVol(Math.abs(v));

export class FootprintPrimitive implements ISeriesPrimitive<Time>{
 // klíč = čas grafu (s) svíčky
 data=new Map<number,FpCandle>();tick=0;mode=false;
 palette:FpPalette={bull:'#16a34a',bear:'#dc2626',bg:'#fff',fg:'#0b0c0e',muted:'#6b7079',poc:'#f59e0b'};
 private param:SeriesAttachedParameter<Time>|null=null;
 private views:IPrimitivePaneView[];
 constructor(public onMode:(on:boolean)=>void){
  const renderer:IPrimitivePaneRenderer={draw:t=>this.draw(t)};
  // 'normal' = nad svíčkami, pod kresbami (ty jsou 'top'); značky se připojují až po footprintu, takže zůstanou nad ním
  this.views=[{zOrder:()=>'normal',renderer:()=>renderer}];
 }
 attached(p:SeriesAttachedParameter<Time>){this.param=p}
 detached(){this.param=null;this.setMode(false)}
 paneViews(){return this.views}
 update(){this.param?.requestUpdate()}
 private setMode(on:boolean){if(on!==this.mode){this.mode=on;queueMicrotask(()=>this.onMode(on))}}
 private draw(target:CanvasRenderingTarget2D){
  target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>{
   const p=this.param,w=mediaSize.width,h=mediaSize.height,tick=this.tick;
   if(!p||!this.data.size||!(tick>0)){this.setMode(false);return}
   const ts=p.chart.timeScale(),s=p.series,P=this.palette;
   const a=ts.logicalToCoordinate(0 as Logical),b=ts.logicalToCoordinate(1 as Logical);
   const any=this.data.values().next().value as FpCandle,y0=s.priceToCoordinate(any.c),y1=s.priceToCoordinate(any.c+tick);
   if(a==null||b==null||y0==null||y1==null){this.setMode(false);return}
   const spacing=Math.abs(b-a),rowH=Math.abs(y0-y1);
   const on=rowH>=FP_MIN_ROW&&spacing>=FP_MIN_COL;this.setMode(on);if(!on)return;
   const colW=Math.max(8,Math.min(spacing*.92,spacing-3)),candleW=3,cellL=candleW+3,num=rowH>=11&&colW>=58;
   const font=Math.max(9,Math.min(11,Math.floor(rowH-2)));
   ctx.save();ctx.textBaseline='middle';
   // pás delty svíček dole
   const dy=h-FP_DELTA_H;
   const shown:{x:number;d:number}[]=[];
   for(const [time,c] of this.data){
    if(!c.rows?.length)continue;
    const x=ts.timeToCoordinate(time as Time);if(x==null||x<-colW||x>w+colW)continue;
    const left=x-colW/2,top=s.priceToCoordinate(c.rows[0][0]+tick),bot=s.priceToCoordinate(c.rows[c.rows.length-1][0]);
    if(top==null||bot==null)continue;
    // podklad sloupce zakryje běžnou svíčku pod ním
    ctx.fillStyle=P.bg;ctx.fillRect(left,top,colW,bot-top);
    let maxV=0;for(const r of c.rows)maxV=Math.max(maxV,r[1]+r[2]);
    for(const [price,sell,buy,flags] of c.rows){
     const yt=s.priceToCoordinate(price+tick),yb=s.priceToCoordinate(price);if(yt==null||yb==null)continue;
     const hh=yb-yt,tot=sell+buy,cx=left+cellL+(colW-cellL)/2,cy=yt+hh/2;
     if(tot>0){ctx.fillStyle=withAlpha(buy>=sell?P.bull:P.bear,Math.round((.08+.5*tot/(maxV||1))*100)/100);ctx.fillRect(left+cellL,yt+.5,colW-cellL,Math.max(1,hh-1))}
     // nerovnováha: proužek u okraje (nákup vpravo, prodej vlevo)
     if(flags&1){ctx.fillStyle=P.bull;ctx.fillRect(left+colW-3,yt+1,3,Math.max(1,hh-2))}
     if(flags&2){ctx.fillStyle=P.bear;ctx.fillRect(left+cellL,yt+1,3,Math.max(1,hh-2))}
     if(c.poc===price){ctx.strokeStyle=P.poc;ctx.lineWidth=1.5;ctx.strokeRect(left+cellL+.75,yt+.75,colW-cellL-1.5,Math.max(1,hh-1.5))}
     if(num&&tot>0){
      const sx=fmtVol(sell),bx=fmtVol(buy);
      ctx.font=((flags&2)?'700 ':'500 ')+font+'px '+FAMILY;ctx.textAlign='right';ctx.fillStyle=(flags&2)?P.bear:P.fg;ctx.fillText(sx,cx-5,cy);
      ctx.font=((flags&1)?'700 ':'500 ')+font+'px '+FAMILY;ctx.textAlign='left';ctx.fillStyle=(flags&1)?P.bull:P.fg;ctx.fillText(bx,cx+5,cy);
      ctx.font='400 '+font+'px '+FAMILY;ctx.textAlign='center';ctx.fillStyle=P.muted;ctx.fillText('×',cx,cy);
     }
    }
    // úzká svíčka vlevo ve sloupci (knot + tělo)
    const up=c.c>=c.o,yh=s.priceToCoordinate(c.h),yl=s.priceToCoordinate(c.l),yo=s.priceToCoordinate(c.o),yc=s.priceToCoordinate(c.c);
    if(yh!=null&&yl!=null&&yo!=null&&yc!=null){
     ctx.fillStyle=up?P.bull:P.bear;ctx.fillRect(left+candleW/2-.5,yh,1,yl-yh);ctx.fillRect(left,Math.min(yo,yc),candleW,Math.max(1,Math.abs(yc-yo)));
    }
    if(typeof c.d==='number')shown.push({x,d:c.d});
   }
   if(shown.length){
    ctx.fillStyle=withAlpha(P.bg,.92);ctx.fillRect(0,dy,w,FP_DELTA_H);
    ctx.strokeStyle=withAlpha(P.muted,.35);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,dy+.5);ctx.lineTo(w,dy+.5);ctx.stroke();
    ctx.font='600 '+Math.min(11,font)+'px '+FAMILY;ctx.textAlign='center';
    for(const {x,d} of shown){ctx.fillStyle=d>0?P.bull:d<0?P.bear:P.muted;ctx.fillText(colW>=34?signed(d):d>0?'+':d<0?'−':'·',x,dy+FP_DELTA_H/2)}
    ctx.textAlign='left';ctx.fillStyle=P.muted;ctx.font='500 10px '+FAMILY;ctx.fillText('Δ',4,dy+FP_DELTA_H/2);
   }
   ctx.restore();
  });
 }
}
