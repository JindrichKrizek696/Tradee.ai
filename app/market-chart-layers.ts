// Vrstvy grafu trhu kreslené jako primitivum série svíček: seance (pásy v pozadí podle časového pásma trhu s DST) a boxy high/low seance.
// Pozice jsou v logických indexech svíček (lib/chart/drawings logicalOf), primitivum je jen převádí na pixely.
import type {ISeriesPrimitive,IPrimitivePaneView,IPrimitivePaneRenderer,SeriesAttachedParameter,Time,Logical} from 'lightweight-charts';
import {chartTime} from '@/lib/journal/chart-data';
import {logicalOf} from '@/lib/chart/drawings';
import {withAlpha} from '@/lib/chart/layers';
import {SESSION_PRESETS,sessionWindows,sessionBox,type SessionId} from '@/lib/chart/sessions';
type CanvasRenderingTarget2D=Parameters<IPrimitivePaneRenderer['draw']>[0];
export type SessionItem={l0:number;l1:number;color:string;kind:'band'|'box';hi?:number;lo?:number;label:string};
// okna vybraných seancí v rozsahu svíček → položky v logických indexech (svíčky v čase grafu, bars s t = ms UTC)
export function sessionItems(ids:readonly SessionId[],times:number[],bars:{t:number;h:number;l:number}[],tfSec:number):SessionItem[]{
 if(!times.length||!bars.length)return [];
 const from=bars[0].t,to=bars[bars.length-1].t+tfSec*1000,out:SessionItem[]=[];
 for(const id of ids){
  const p=SESSION_PRESETS[id];
  for(const w of sessionWindows(id,from,to)){
   const l0=logicalOf(times,tfSec,chartTime(w.start)),l1=logicalOf(times,tfSec,chartTime(w.end));
   if(l1<=l0)continue;
   if(p.kind==='box'){const b=sessionBox(w,bars);if(b)out.push({l0,l1,color:p.color,kind:'box',hi:b.hi,lo:b.lo,label:p.label.replace('Box ','')})}
   else out.push({l0,l1,color:p.color,kind:'band',label:p.label});
  }
 }
 return out;
}
export class SessionsPrimitive implements ISeriesPrimitive<Time>{
 items:SessionItem[]=[];alpha=.08;
 private param:SeriesAttachedParameter<Time>|null=null;
 private views:IPrimitivePaneView[];
 constructor(){const r:IPrimitivePaneRenderer={draw:t=>this.draw(t)};this.views=[{zOrder:()=>'bottom',renderer:()=>r}]}
 attached(p:SeriesAttachedParameter<Time>){this.param=p}
 detached(){this.param=null}
 update(){this.param?.requestUpdate()}
 paneViews(){return this.views}
 private draw(target:CanvasRenderingTarget2D){
  const p=this.param;if(!p||!this.items.length)return;
  const ts=p.chart.timeScale(),s=p.series;
  target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>{
   const w=mediaSize.width,h=mediaSize.height;
   for(const it of this.items){
    const x0=ts.logicalToCoordinate(it.l0 as Logical),x1=ts.logicalToCoordinate(it.l1 as Logical);
    if(x0===null||x1===null||x1<0||x0>w)continue;
    if(it.kind==='band'){ctx.fillStyle=withAlpha(it.color,this.alpha);ctx.fillRect(x0,0,x1-x0,h);continue}
    const yh=s.priceToCoordinate(it.hi!),yl=s.priceToCoordinate(it.lo!);if(yh===null||yl===null)continue;
    ctx.fillStyle=withAlpha(it.color,this.alpha*.8);ctx.fillRect(x0,yh,x1-x0,yl-yh);
    ctx.strokeStyle=withAlpha(it.color,.7);ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.strokeRect(x0,yh,x1-x0,yl-yh);ctx.setLineDash([]);
    if(x1-x0>40){ctx.font='600 10px Inter Variable, Inter, system-ui, sans-serif';ctx.fillStyle=withAlpha(it.color,.95);ctx.textAlign='left';ctx.textBaseline='bottom';ctx.fillText(it.label+' H/L',x0+3,yh-2)}
   }
  });
 }
}
