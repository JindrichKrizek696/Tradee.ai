// Session volume profile jako primitivum cenové série (lightweight-charts v5): profil každého období (seance, den, týden, měsíc)
// vlevo v jeho rozsahu svíček, sytěji uvnitř value area, POC přes celé období. Kreslí se pod svíčky; výpočet je v lib/chart/volume-profile.
import type {ISeriesPrimitive,IPrimitivePaneView,IPrimitivePaneRenderer,SeriesAttachedParameter,Time,Logical} from 'lightweight-charts';
import type {SessionProfile} from '@/lib/chart/volume-profile';
import {withAlpha} from '@/lib/chart/layers';

export type SvpPalette={up:string;down:string;poc:string};
// width = délka nejdelšího řádku v % šířky období; poc / va = čára POC a hranice value area
export type SvpOpts={width:number;poc:boolean;va:boolean};
type CanvasRenderingTarget2D=Parameters<IPrimitivePaneRenderer['draw']>[0];

export class SessionProfilePrimitive implements ISeriesPrimitive<Time>{
 sessions:SessionProfile[]=[];
 palette:SvpPalette={up:'#16a34a',down:'#dc2626',poc:'#f59e0b'};
 opts:SvpOpts={width:70,poc:true,va:true};
 private param:SeriesAttachedParameter<Time>|null=null;
 private views:IPrimitivePaneView[];
 constructor(){const renderer:IPrimitivePaneRenderer={draw:t=>this.draw(t)};this.views=[{zOrder:()=>'bottom',renderer:()=>renderer}]}
 attached(p:SeriesAttachedParameter<Time>){this.param=p}
 detached(){this.param=null}
 update(){this.param?.requestUpdate()}
 paneViews(){return this.views}
 private draw(target:CanvasRenderingTarget2D){
  const p=this.param;if(!p||!this.sessions.length)return;
  const ts=p.chart.timeScale(),s=p.series,vr=ts.getVisibleLogicalRange();if(!vr)return;
  const a=ts.logicalToCoordinate(0 as Logical),b=ts.logicalToCoordinate(1 as Logical);if(a===null||b===null)return;
  const half=Math.abs(b-a)/2,{up,down,poc}=this.palette,{width,poc:showPoc,va:showVa}=this.opts;
  target.useMediaCoordinateSpace(({context:ctx})=>{
   ctx.save();
   for(const sp of this.sessions){
    if(sp.to<vr.from-1||sp.from>vr.to+1)continue;
    const xa=ts.logicalToCoordinate(sp.from as Logical),xb=ts.logicalToCoordinate(sp.to as Logical);if(xa===null||xb===null)continue;
    const x0=xa-half,x1=xb+half,W=Math.max(4,(x1-x0)*width/100),pr=sp.profile;
    for(let i=0;i<pr.rows.length;i++){
     const r=pr.rows[i];if(!r.total)continue;
     const yt=s.priceToCoordinate(r.hi),yb=s.priceToCoordinate(r.lo);if(yt===null||yb===null)continue;
     const span=Math.abs(yb-yt),hh=Math.max(1,span>3?span-1:span),top=Math.min(yt,yb),len=W*r.total/pr.max,lu=len*r.up/r.total,al=i>=pr.vaFrom&&i<=pr.vaTo?.42:.18;
     ctx.fillStyle=withAlpha(up,al);ctx.fillRect(x0,top,lu,hh);
     ctx.fillStyle=withAlpha(down,al);ctx.fillRect(x0+lu,top,len-lu,hh);
    }
    const line=(price:number,dash:number[],lw:number,alpha:number)=>{const y=s.priceToCoordinate(price);if(y===null)return;ctx.globalAlpha=alpha;ctx.setLineDash(dash);ctx.lineWidth=lw;ctx.strokeStyle=poc;ctx.beginPath();ctx.moveTo(x0,y);ctx.lineTo(x1,y);ctx.stroke();ctx.globalAlpha=1};
    if(showVa){line(pr.vah,[3,3],1,.55);line(pr.val,[3,3],1,.55)}
    if(showPoc)line(pr.poc,[],1.5,.95);
   }
   ctx.restore();
  });
 }
}
