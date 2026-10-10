// Vykreslení kreseb grafu trhu jako primitiva série svíček (lightweight-charts v5 plugins API).
// Souřadnice počítá komponenta (project); primitivum jen kreslí a pamatuje si tvary pro výběr myší.
import type {ISeriesPrimitive,IPrimitivePaneView,IPrimitivePaneRenderer,ISeriesPrimitiveAxisView,SeriesAttachedParameter,PrimitiveHoveredItem,Time} from 'lightweight-charts';
import {fibLevels,fibLabel,hitTest,rayEnd,type Anchor,type DrawColor,type Drawing,type Pt,type Shape} from '@/lib/chart/drawings';
import {withAlpha} from '@/lib/chart/layers';

export type DrawPalette=Record<DrawColor,string>&{bg:string;text:string};
export type DrawEnv={project:(a:Anchor)=>Pt|null;price:(p:number)=>string;measureLines:(d:Drawing)=>string[]};
type CanvasRenderingTarget2D=Parameters<IPrimitivePaneRenderer['draw']>[0];
type Item={id:string;d:Drawing;shape:Shape};
const FONT='12px Inter Variable, Inter, system-ui, sans-serif';
// čitelný text na barevném štítku osy
function ink(color:string){
 const h=color.match(/^#([0-9a-f]{6})$/i);if(!h)return '#fff';
 const n=parseInt(h[1],16),l=(.299*(n>>16)+.587*((n>>8)&255)+.114*(n&255))/255;
 return l>.6?'#0b0c0e':'#fff';
}

export class DrawingsPrimitive implements ISeriesPrimitive<Time>{
 drawings:Drawing[]=[];temp:Drawing|null=null;draft:Drawing|null=null;selected:string|null=null;
 palette:DrawPalette={brand:'#245bff',bull:'#16a34a',bear:'#dc2626',amber:'#f59e0b',muted:'#6b7079',fg:'#0b0c0e',bg:'#fff',text:'#0b0c0e'};
 items:Item[]=[];size={w:0,h:0};
 private param:SeriesAttachedParameter<Time>|null=null;
 private axis:ISeriesPrimitiveAxisView[]=[];
 private views:IPrimitivePaneView[];
 constructor(public env:DrawEnv){
  const renderer:IPrimitivePaneRenderer={draw:t=>this.draw(t)};
  this.views=[{zOrder:()=>'top',renderer:()=>renderer}];
 }
 attached(p:SeriesAttachedParameter<Time>){this.param=p}
 detached(){this.param=null}
 update(){this.rebuildAxis();this.param?.requestUpdate()}
 paneViews(){return this.views}
 priceAxisViews(){return this.axis}
 private rebuildAxis(){
  const s=this.param?.series;
  this.axis=this.all().filter(d=>d.type==='hline').map(d=>{const c=this.palette[d.color];return {
   coordinate:()=>s?.priceToCoordinate(d.a[0].p)??-1e6,text:()=>s?s.priceFormatter().format(d.a[0].p):this.env.price(d.a[0].p),textColor:()=>ink(c),backColor:()=>c,
  }});
 }
 all(){return [...this.drawings,...(this.temp?[this.temp]:[]),...(this.draft?[this.draft]:[])]}
 // zásah pro kurzor knihovny (ruka/posun); výběr a tažení řeší komponenta přes hit()
 hitTest(x:number,y:number):PrimitiveHoveredItem|null{
  const h=this.hit({x,y},6);if(!h)return null;
  return {externalId:'d:'+h.id,zOrder:'top',cursorStyle:h.hit.part==='handle'?'grab':'move',itemType:'primitive'};
 }
 hit(p:Pt,tol:number){return hitTest(this.items.map(i=>({id:i.id,shape:i.shape})),p,this.size.w,this.size.h,tol)}

 private shape(d:Drawing,ctx:CanvasRenderingContext2D):Shape|null{
  const pts=d.a.map(a=>this.env.project(a));if(pts.some(p=>!p))return null;
  const P=pts as Pt[];
  if(d.type==='fib'){const ys=fibLevels(d.a[0],d.a[1]).map(l=>this.env.project({t:d.a[0].t,p:l.price})?.y??NaN);return {type:d.type,pts:P,levels:ys}}
  if(d.type==='text'){ctx.font='600 '+FONT;const w=ctx.measureText(d.text||'').width+8;return {type:d.type,pts:P,box:{x:P[0].x-4,y:P[0].y-11,w,h:22}}}
  return {type:d.type,pts:P,ray:d.ray};
 }
 private draw(target:CanvasRenderingTarget2D){
  target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>{
   const w=mediaSize.width,h=mediaSize.height;this.size={w,h};
   const items:Item[]=[];
   for(const d of this.all()){const s=this.shape(d,ctx);if(s)items.push({id:d.id,d,shape:s})}
   this.items=items;
   ctx.save();ctx.font=FONT;ctx.lineCap='round';
   for(const it of items)this.paint(ctx,it,w,h,it.id===this.selected);
   ctx.restore();
  });
 }
 private paint(ctx:CanvasRenderingContext2D,{d,shape}:Item,w:number,h:number,sel:boolean){
  const P=this.palette,c=P[d.color],[a,b]=shape.pts;
  ctx.strokeStyle=c;ctx.fillStyle=c;ctx.lineWidth=sel?2.5:2;ctx.setLineDash([]);
  const label=(text:string,x:number,y:number,align:CanvasTextAlign='left',base:CanvasTextBaseline='bottom')=>{ctx.textAlign=align;ctx.textBaseline=base;ctx.fillText(text,x,y)};
  switch(d.type){
   case 'trend':{const e=d.ray?rayEnd(a,b,w,h):b;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(e.x,e.y);ctx.stroke();break}
   case 'hline':{ctx.lineWidth=sel?2:1.5;ctx.beginPath();ctx.moveTo(0,a.y);ctx.lineTo(w,a.y);ctx.stroke();break}
   case 'rect':{
    const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),rw=Math.abs(a.x-b.x),rh=Math.abs(a.y-b.y);
    ctx.fillStyle=withAlpha(c,.14);ctx.fillRect(x,y,rw,rh);ctx.lineWidth=sel?1.5:1;ctx.strokeRect(x,y,rw,rh);break;
   }
   case 'fib':{
    const x0=Math.min(a.x,b.x),x1=Math.max(a.x,b.x),lv=fibLevels(d.a[0],d.a[1]),ys=shape.levels||[];
    ctx.lineWidth=1;
    for(let i=0;i<lv.length;i++){const y=ys[i];if(!Number.isFinite(y))continue;
     if(i<lv.length-1&&Number.isFinite(ys[i+1])){ctx.fillStyle=withAlpha(c,i%2?.05:.09);ctx.fillRect(x0,Math.min(y,ys[i+1]),x1-x0,Math.abs(ys[i+1]-y))}
     ctx.strokeStyle=c;ctx.beginPath();ctx.moveTo(x0,y);ctx.lineTo(x1,y);ctx.stroke();
     ctx.fillStyle=c;label(fibLabel(lv[i].level)+' ('+this.env.price(lv[i].price)+')',x0+4,y-2);
    }
    ctx.setLineDash([4,4]);ctx.globalAlpha=.6;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.globalAlpha=1;ctx.setLineDash([]);
    break;
   }
   case 'text':{
    const bx=shape.box!;
    if(sel){ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.strokeRect(bx.x,bx.y,bx.w,bx.h);ctx.setLineDash([])}
    ctx.font='600 '+FONT;label(d.text||'',a.x,a.y,'left','middle');ctx.font=FONT;break;
   }
   case 'measure':{
    const up=d.a[1].p>=d.a[0].p,tone=up?P.bull:P.bear;
    const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),rw=Math.abs(a.x-b.x),rh=Math.abs(a.y-b.y);
    ctx.fillStyle=withAlpha(tone,.13);ctx.fillRect(x,y,rw,rh);
    ctx.strokeStyle=tone;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    const lines=this.env.measureLines(d),lw=Math.max(...lines.map(l=>ctx.measureText(l).width))+16,lh=16,bh=lines.length*lh+8;
    let lx=(a.x+b.x)/2-lw/2,ly=up?y-bh-6:y+rh+6;
    if(ly<2)ly=y+rh+6;if(ly+bh>h-2)ly=Math.max(2,y-bh-6);lx=Math.max(2,Math.min(w-lw-2,lx));
    ctx.fillStyle=tone;ctx.beginPath();if(ctx.roundRect)ctx.roundRect(lx,ly,lw,bh,6);else ctx.rect(lx,ly,lw,bh);ctx.fill();
    ctx.fillStyle=ink(tone);lines.forEach((l,i)=>label(l,lx+lw/2,ly+4+lh*(i+1)-3,'center','bottom'));
    break;
   }
  }
  // úchyty vybrané kresby
  if(sel&&d.type!=='hline'&&d.type!=='text')for(const p of shape.pts){ctx.beginPath();ctx.arc(p.x,p.y,4.5,0,Math.PI*2);ctx.fillStyle=P.bg;ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle=c;ctx.stroke()}
  if(sel&&d.type==='hline'){ctx.beginPath();ctx.arc(w/2,a.y,4.5,0,Math.PI*2);ctx.fillStyle=P.bg;ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle=c;ctx.stroke()}
 }
}
