// Vykreslení kreseb grafu trhu jako primitiva série svíček (lightweight-charts v5 plugins API).
// Souřadnice počítá komponenta (project); primitivum jen kreslí a pamatuje si tvary pro výběr myší.
import type {ISeriesPrimitive,IPrimitivePaneView,IPrimitivePaneRenderer,ISeriesPrimitiveAxisView,SeriesAttachedParameter,PrimitiveHoveredItem,Time} from 'lightweight-charts';
import {TEXT_PX,channelOffset,channelLine,touchLabelAt,arrowHead,arrowEnds,dashOf,extendSeg,fibLevels,fibLabel,fibText,levelsOn,fibExtLevels,fibExtSpan,pitchfork,gannGrid,GANN_DIV,hasHandles,hitTest,edgeHandles,edgeCursor,positionLines,styleOf,visibleOn,colorOf,type NamedColor,type Anchor,type Box,type DrawColor,type Drawing,type FullStyle,type Pt,type Shape} from '@/lib/chart/drawings';
import {withAlpha} from '@/lib/chart/layers';
import type {Profile} from '@/lib/chart/volume-profile';

export type DrawPalette=Record<NamedColor,string>&{bg:string;text:string};
export type DrawEnv={
 project:(a:Anchor)=>Pt|null;price:(p:number)=>string;
 // popisky měření, cenového a časového rozsahu
 lines:(d:Drawing)=>string[];
 // úroveň do dotyku: x konce (null = pravý okraj) a popisek
 touch:(d:Drawing)=>{x:number|null;label:string};
 // velikost plochy grafu (px) při změně – plovoucí panel oblíbených se drží uvnitř
 size?:(w:number,h:number)=>void;
 // volume profile s pevným rozsahem: profil svíček mezi kotvami (null = žádné svíčky)
 profile?:(d:Drawing)=>Profile|null;
};
type CanvasRenderingTarget2D=Parameters<IPrimitivePaneRenderer['draw']>[0];
type Item={id:string;d:Drawing;shape:Shape;st:FullStyle};
const FAMILY='Inter Variable, Inter, system-ui, sans-serif';
const FONT='12px '+FAMILY;
// čitelný text na barevném štítku
function ink(color:string){
 const h=color.match(/^#([0-9a-f]{6})$/i);if(!h)return '#fff';
 const n=parseInt(h[1],16),l=(.299*(n>>16)+.587*((n>>8)&255)+.114*(n&255))/255;
 return l>.6?'#0b0c0e':'#fff';
}
const LINE_NOTE=new Set(['trend','ray','hline','hray','touch']);
function pill(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r=6){ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,r);else ctx.rect(x,y,w,h)}

export class DrawingsPrimitive implements ISeriesPrimitive<Time>{
 drawings:Drawing[]=[];temp:Drawing|null=null;draft:Drawing|null=null;selected:string|null=null;tf='';
 palette:DrawPalette={brand:'#245bff',bull:'#16a34a',bear:'#dc2626',amber:'#f59e0b',muted:'#6b7079',fg:'#0b0c0e',bg:'#fff',text:'#0b0c0e'};
 items:Item[]=[];size={w:0,h:0};
 private told={w:0,h:0};
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
  this.axis=this.all().filter(d=>d.type==='hline'||d.type==='hray'||d.type==='touch').map(d=>{const c=colorOf(this.palette,d.color);return {
   coordinate:()=>s?.priceToCoordinate(d.a[0].p)??-1e6,text:()=>s?s.priceFormatter().format(d.a[0].p):this.env.price(d.a[0].p),textColor:()=>ink(c),backColor:()=>c,
  }});
 }
 // kresby viditelné na aktuálním TF a neskryté (+ dočasné měření a rozkreslená kresba)
 all(){return [...this.drawings.filter(d=>!d.hide&&(!this.tf||visibleOn(d,this.tf))),...(this.temp?[this.temp]:[]),...(this.draft?[this.draft]:[])]}
 // zásah pro kurzor knihovny (ruka/posun); výběr a tažení řeší komponenta přes hit()
 hitTest(x:number,y:number):PrimitiveHoveredItem|null{
  const h=this.hit({x,y},6);if(!h)return null;
  return {externalId:'d:'+h.id,zOrder:'top',cursorStyle:h.hit.part==='handle'?'grab':h.hit.part==='edge'?edgeCursor(h.hit.edge):this.rrAt({x,y})===h.id?'pointer':'move',itemType:'primitive'};
 }
 // klik na popisek R:R pozice (otevře zadání R:R v panelu stylu)
 rrAt(p:Pt){for(let i=this.items.length-1;i>=0;i--){const b=this.items[i].shape.rrBox;if(b&&p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h)return this.items[i].id}return null}
 hit(p:Pt,tol:number){return hitTest(this.items.filter(i=>i.id!==this.draft?.id).map(i=>({id:i.id,shape:i.shape})),p,this.size.w,this.size.h,tol,this.selected)}

 private font(st:FullStyle,bold=true){return (bold?'600 ':'')+TEXT_PX[st.ts]+'px '+FAMILY}
 // zapnuté hladiny fib / extension s cenami
 private levels(d:Drawing,st:FullStyle){const on=levelsOn(st.lv);return d.type==='fib'?fibLevels(d.a[0],d.a[1],on):fibExtLevels(d.a[0],d.a[1],d.a[2]??d.a[1],on)}
 private shape(d:Drawing,st:FullStyle,ctx:CanvasRenderingContext2D,w:number,h:number):Shape|null{
  const pts=d.a.map(a=>this.env.project(a));if(pts.some(p=>!p))return null;
  const P=pts as Pt[],s:Shape={type:d.type,pts:P,ray:d.ray,extL:st.extL,extR:st.extR};
  // jen zapnuté hladiny (výběr myší, úchyty hran i poznámka)
  if(d.type==='fib'||d.type==='fibext')s.levels=this.levels(d,st).map(l=>this.env.project({t:d.a[0].t,p:l.price})?.y??NaN);
  if(d.type==='touch'){const t=this.env.touch(d);s.touchX=t.x??w}
  // volume profile: box = časový rozsah × cenový rozsah profilu; úchyty na levé a pravé hraně uprostřed výšky (cena kotev se nepoužívá)
  if(d.type==='vprofile'){
   const pr=this.env.profile?.(d),b=P[1]??P[0],x0=Math.min(P[0].x,b.x),x1=Math.max(P[0].x,b.x);
   const yt=pr?this.env.project({t:d.a[0].t,p:pr.hi})?.y:undefined,yb=pr?this.env.project({t:d.a[0].t,p:pr.lo})?.y:undefined;
   const top=yt??Math.min(P[0].y,b.y)-24,bot=yb??Math.max(P[0].y,b.y)+24,ym=(top+bot)/2;
   s.pts=[{x:P[0].x,y:ym},{x:b.x,y:ym}];s.box={x:x0,y:Math.min(top,bot),w:Math.max(1,x1-x0),h:Math.max(1,Math.abs(bot-top))};
  }
  if(d.type==='vprofile'){if(d.text)s.label=this.noteBox(d,st,s,ctx,w,h)}
  else if(d.type==='text'){
   ctx.font=this.font(st);const px=TEXT_PX[st.ts],tw=ctx.measureText(d.text||'').width+8,bh=px+10;
   const y=st.ta==='top'?P[0].y-bh:st.ta==='bottom'?P[0].y:P[0].y-bh/2;
   s.box={x:P[0].x-4,y,w:tw,h:bh};
  }else if(d.text)s.label=this.noteBox(d,st,s,ctx,w,h);
  return s;
 }
 // umístění poznámky: u čar střed úsečky nad/na/pod čarou, u ploch nad/uprostřed/pod obdélníkem
 private noteBox(d:Drawing,st:FullStyle,s:Shape,ctx:CanvasRenderingContext2D,w:number,h:number):Box{
  ctx.font=this.font(st);const px=TEXT_PX[st.ts],tw=ctx.measureText(d.text||'').width+10,bh=px+8,[a,b]=s.pts;
  let cx:number,top:number,bottom:number;
  if(LINE_NOTE.has(d.type)){
   let x0=a,x1=b??a;
   if(d.type==='hline'){x0={x:w-tw-8,y:a.y};x1={x:w-8,y:a.y}}
   else if(d.type==='hray')x1={x:Math.min(w,a.x+Math.max(160,(w-a.x)/2)),y:a.y};
   else if(d.type==='touch')x1={x:s.touchX??w,y:a.y};
   else{const [p,q]=extendSeg(a,b,w,h,false,false);x0=p;x1=q}
   cx=(x0.x+x1.x)/2;const cy=(x0.y+x1.y)/2;top=cy;bottom=cy;
  }else{
   let xs=s.pts.map(p=>p.x),ys=s.pts.map(p=>p.y);
   if(d.type==='vprofile'&&s.box){xs=[s.box.x,s.box.x+s.box.w];ys=[s.box.y,s.box.y+s.box.h]}
   if(d.type==='channel'){const off=channelOffset(a,b,s.pts[2]??b);xs=[a.x,b.x];ys=[a.y,b.y,a.y+off,b.y+off]}
   if((d.type==='fib'||d.type==='fibext')&&s.levels)ys=s.levels.filter(Number.isFinite);
   cx=(Math.min(...xs)+Math.max(...xs))/2;top=Math.min(...ys);bottom=Math.max(...ys);
  }
  const y=st.ta==='top'?top-bh-4:st.ta==='bottom'?bottom+4:(top+bottom)/2-bh/2;
  return {x:Math.max(2,Math.min(w-tw-2,cx-tw/2)),y,w:tw,h:bh};
 }
 private draw(target:CanvasRenderingTarget2D){
  target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>{
   const w=mediaSize.width,h=mediaSize.height;this.size={w,h};
   if(w!==this.told.w||h!==this.told.h){this.told={w,h};this.env.size?.(w,h)}
   const items:Item[]=[];
   for(const d of this.all()){const st=styleOf(d),s=this.shape(d,st,ctx,w,h);if(s)items.push({id:d.id,d,shape:s,st})}
   this.items=items;
   ctx.save();ctx.font=FONT;ctx.lineCap='round';ctx.lineJoin='round';
   for(const it of items){ctx.save();this.paint(ctx,it,w,h,it.id===this.selected);ctx.restore()}
   ctx.restore();
  });
 }
 private paint(ctx:CanvasRenderingContext2D,{d,shape,st}:Item,w:number,h:number,sel:boolean){
  const P=this.palette,c=colorOf(P,d.color),bc=colorOf(P,st.bc),[a,b]=shape.pts;
  const lw=st.lw+(sel?.5:0),dash=dashOf(st.ls,st.lw);
  ctx.globalAlpha=st.op;ctx.strokeStyle=c;ctx.fillStyle=c;ctx.lineWidth=lw;ctx.setLineDash(dash);
  const line=(p:Pt,q:Pt)=>{ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke()};
  const label=(text:string,x:number,y:number,align:CanvasTextAlign='left',base:CanvasTextBaseline='bottom')=>{ctx.textAlign=align;ctx.textBaseline=base;ctx.fillText(text,x,y)};
  // štítek s textem (pill) v barvě tone
  const tag=(lines:string[],cx:number,y:number,tone:string)=>{
   ctx.setLineDash([]);ctx.font=FONT;const lh=16,lwid=Math.max(...lines.map(l=>ctx.measureText(l).width))+16,bh=lines.length*lh+6;
   const lx=Math.max(2,Math.min(w-lwid-2,cx-lwid/2)),ly=Math.max(2,Math.min(h-bh-2,y));
   ctx.fillStyle=tone;pill(ctx,lx,ly,lwid,bh);ctx.fill();ctx.fillStyle=ink(tone);lines.forEach((l,i)=>label(l,lx+lwid/2,ly+3+lh*(i+1)-3,'center','bottom'));
   return {x:lx,y:ly,w:lwid,h:bh};
  };
  switch(d.type){
   case 'trend':case 'ray':{const [p,q]=extendSeg(a,b,w,h,st.extL,st.extR);line(p,q);break}
   case 'hline':line({x:0,y:a.y},{x:w,y:a.y});break;
   case 'hray':line(a,{x:w+10,y:a.y});break;
   case 'touch':{
    const t=this.env.touch(d),x1=shape.touchX??w;line(a,{x:x1,y:a.y});
    ctx.setLineDash([]);if(t.x!==null){ctx.beginPath();ctx.arc(x1,a.y,3,0,Math.PI*2);ctx.fill()}
    // popisek podle stylu (výchozí nad čarou u pravého konce)
    ctx.font=FONT;const L=touchLabelAt(a,x1,w,t.x!==null,st.la,st.lx,ctx.measureText(t.label).width);
    if(L.box){ctx.fillStyle=P.bg;pill(ctx,L.box.x,L.box.y,L.box.w,L.box.h,4);ctx.fill();ctx.fillStyle=c}
    label(t.label,L.x,L.y,L.align,L.base);
    break;
   }
   case 'path':case 'brush':{
    // lomená čára: volitelné šipky (plný trojúhelník podle tloušťky); čára končí u základny šipky
    const S=shape.pts,n=S.length,pts=[...S],ar=d.type==='path'&&n>=2?arrowEnds(st.arrow):{start:false,end:false};
    const room=n===2&&ar.start&&ar.end?Math.hypot(S[1].x-S[0].x,S[1].y-S[0].y)/2:Infinity;
    const hs=ar.start?arrowHead(S[1],S[0],st.lw,room):null,he=ar.end?arrowHead(S[n-2],S[n-1],st.lw,room):null;
    if(hs)pts[0]=hs.base;if(he)pts[n-1]=he.base;
    ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
    ctx.setLineDash([]);for(const k of [hs,he])if(k){ctx.beginPath();ctx.moveTo(k.tip.x,k.tip.y);ctx.lineTo(k.l.x,k.l.y);ctx.lineTo(k.r.x,k.r.y);ctx.closePath();ctx.fill()}
    break;
   }
   case 'channel':{
    const off=channelOffset(a,b,shape.pts[2]??b),[p,q]=extendSeg(a,b,w,h,st.extL,st.extR),p2={x:p.x,y:p.y+off},q2={x:q.x,y:q.y+off};
    if(st.fill){ctx.fillStyle=withAlpha(c,.1);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.lineTo(q2.x,q2.y);ctx.lineTo(p2.x,p2.y);ctx.closePath();ctx.fill()}
    line(p,q);line(p2,q2);
    // střední čára: volitelná, poloha 0–1 (výchozí půlka) a vlastní barva
    if(st.mid){const [m0,m1]=channelLine(p,q,off,st.midp);ctx.save();ctx.globalAlpha=st.op*.6;ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.strokeStyle=colorOf(P,st.midc);line(m0,m1);ctx.restore()}
    break;
   }
   case 'rect':{
    let x=Math.min(a.x,b.x),rw=Math.abs(a.x-b.x);const y=Math.min(a.y,b.y),rh=Math.abs(a.y-b.y);
    if(st.extL){rw+=x;x=0}if(st.extR)rw=Math.max(rw,w-x);
    if(st.fill){ctx.fillStyle=withAlpha(c,.14);ctx.fillRect(x,y,rw,rh)}
    if(st.border){ctx.strokeStyle=bc;ctx.strokeRect(x,y,rw,rh)}
    break;
   }
   case 'fib':{
    const x0=st.extL?0:Math.min(a.x,b.x),x1=st.extR?w:Math.max(a.x,b.x),lv=this.levels(d,st),ys=shape.levels||[];
    ctx.lineWidth=Math.max(1,st.lw-1+(sel?.5:0));
    for(let i=0;i<lv.length;i++){const y=ys[i];if(!Number.isFinite(y))continue;
     if(st.fill&&i<lv.length-1&&Number.isFinite(ys[i+1])){ctx.fillStyle=withAlpha(c,i%2?.05:.09);ctx.fillRect(x0,Math.min(y,ys[i+1]),x1-x0,Math.abs(ys[i+1]-y))}
     ctx.strokeStyle=c;line({x:x0,y},{x:x1,y});
     const tx=fibText(lv[i].level,this.env.price(lv[i].price),st.lb,st.pct);if(tx){ctx.fillStyle=c;label(tx,Math.min(a.x,b.x)+4,y-2)}
    }
    ctx.save();ctx.setLineDash([4,4]);ctx.lineWidth=1;ctx.globalAlpha=st.op*.6;line(a,b);ctx.restore();
    break;
   }
   case 'fibext':{
    const c3=shape.pts[2]??b,[x0,x1]=fibExtSpan(a,b,c3,w,st.extL,st.extR),lv=this.levels(d,st),ys=shape.levels||[];
    ctx.lineWidth=Math.max(1,st.lw-1+(sel?.5:0));
    for(let i=0;i<lv.length;i++){const y=ys[i];if(!Number.isFinite(y))continue;
     if(st.fill&&i<lv.length-1&&Number.isFinite(ys[i+1])){ctx.fillStyle=withAlpha(c,i%2?.05:.09);ctx.fillRect(x0,Math.min(y,ys[i+1]),x1-x0,Math.abs(ys[i+1]-y))}
     ctx.strokeStyle=c;line({x:x0,y},{x:x1,y});
     const tx=fibText(lv[i].level,this.env.price(lv[i].price),st.lb,st.pct);if(tx){ctx.fillStyle=c;label(tx,Math.max(x0,Math.min(c3.x,x1))+4,y-2)}
    }
    ctx.save();ctx.setLineDash([4,4]);ctx.lineWidth=1;ctx.globalAlpha=st.op*.6;line(a,b);line(b,c3);ctx.restore();
    break;
   }
   case 'pitchfork':{
    const c3=shape.pts[2]??b,f=pitchfork(a,b,c3),ext=(g:[Pt,Pt])=>extendSeg(g[0],g[1],w,h,st.extL,st.extR);
    const [u0,u1]=ext(f.upper),[l0,l1]=ext(f.lower),[m0,m1]=ext(f.mid);
    if(st.fill){ctx.fillStyle=withAlpha(c,.08);ctx.beginPath();ctx.moveTo(u0.x,u0.y);ctx.lineTo(u1.x,u1.y);ctx.lineTo(l1.x,l1.y);ctx.lineTo(l0.x,l0.y);ctx.closePath();ctx.fill()}
    line(m0,m1);line(u0,u1);line(l0,l1);
    ctx.save();ctx.globalAlpha=st.op*.6;ctx.lineWidth=1;ctx.setLineDash([4,4]);line(b,c3);ctx.restore();
    break;
   }
   case 'gann':{
    const g=gannGrid(a,b),x0=Math.min(a.x,b.x),y0=Math.min(a.y,b.y),gw=Math.abs(b.x-a.x),gh=Math.abs(b.y-a.y);
    if(st.fill){ctx.fillStyle=withAlpha(c,.07);ctx.fillRect(x0,y0,gw,gh)}
    ctx.save();ctx.lineWidth=1;ctx.globalAlpha=st.op*.55;
    for(let i=1;i<GANN_DIV.length-1;i++){line({x:g.xs[i],y:a.y},{x:g.xs[i],y:b.y});line({x:a.x,y:g.ys[i]},{x:b.x,y:g.ys[i]})}
    ctx.restore();
    ctx.strokeRect(x0,y0,gw,gh);for(const [p,q] of g.diag)line(p,q);
    if(gw>80&&gh>40){ctx.font=FONT;ctx.fillStyle=c;for(let i=1;i<GANN_DIV.length-1;i++)label(fibLabel(GANN_DIV[i]),Math.max(a.x,b.x)+4,g.ys[i]+4,'left','middle')}
    break;
   }
   case 'text':{
    const bx=shape.box!;
    if(st.fill){ctx.fillStyle=withAlpha(c,.16);pill(ctx,bx.x,bx.y,bx.w,bx.h,4);ctx.fill()}
    if(st.border){ctx.setLineDash([]);ctx.lineWidth=1;ctx.strokeStyle=bc;pill(ctx,bx.x,bx.y,bx.w,bx.h,4);ctx.stroke()}
    else if(sel){ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.strokeRect(bx.x,bx.y,bx.w,bx.h);ctx.setLineDash([])}
    ctx.font=this.font(st);ctx.fillStyle=colorOf(P,st.tc);label(d.text||'',bx.x+4,bx.y+bx.h/2,'left','middle');
    break;
   }
   case 'long':case 'short':{
    const sl=shape.pts[1],tp=shape.pts[2],x0=Math.min(a.x,sl.x),x1=Math.max(a.x,sl.x),bw=Math.max(1,x1-x0);
    const zone=(y0:number,y1:number,tone:string)=>{const y=Math.min(y0,y1),hh=Math.abs(y1-y0);
     if(st.fill){ctx.fillStyle=withAlpha(tone,.18);ctx.fillRect(x0,y,bw,hh)}
     if(st.border){ctx.strokeStyle=bc;ctx.strokeRect(x0,y,bw,hh)}};
    zone(a.y,tp.y,P.bull);zone(a.y,sl.y,P.bear);
    ctx.setLineDash([]);ctx.strokeStyle=c;ctx.lineWidth=Math.max(1.5,lw);line({x:x0,y:a.y},{x:x1,y:a.y});
    const L=positionLines(d.type,d.a,this.env.price,st.risk),cx=(x0+x1)/2,up=tp.y<a.y;
    tag([L.tp],cx,up?tp.y+4:tp.y-26,P.bull);tag([L.sl],cx,up?sl.y-26:sl.y+4,P.bear);shape.rrBox=tag([L.mid],cx,a.y-11,c);
    break;
   }
   case 'vprofile':{
    // histogram: řádek = objem (up zeleně, down červeně), uvnitř value area sytěji; POC čarou v barvě kresby, hranice value area čárkovaně
    const pr=this.env.profile?.(d),bx=shape.box!,x0=bx.x,x1=bx.x+bx.w;
    if(st.fill){ctx.fillStyle=withAlpha(c,.05);ctx.fillRect(x0,bx.y,bx.w,bx.h)}
    if(sel){ctx.save();ctx.setLineDash([4,4]);ctx.lineWidth=1;ctx.globalAlpha=st.op*.6;ctx.strokeRect(x0,bx.y,bx.w,bx.h);ctx.restore()}
    if(!pr){ctx.font=FONT;ctx.fillStyle=P.muted;label('V rozsahu nejsou svíčky',x0+4,bx.y+bx.h/2,'left','middle');break}
    const W=Math.max(8,bx.w*st.vw/100),right=st.vs==='right',yOf=(p:number)=>this.env.project({t:d.a[0].t,p})?.y;
    ctx.setLineDash([]);
    pr.rows.forEach((r,i)=>{
     const yt=yOf(r.hi),yb=yOf(r.lo);if(yt==null||yb==null||!r.total)return;
     const span=Math.abs(yb-yt),hh=Math.max(1,span>3?span-1:span),top=Math.min(yt,yb),len=W*r.total/pr.max,lu=len*r.up/r.total,ld=len-lu,al=i>=pr.vaFrom&&i<=pr.vaTo?.58:.26;
     ctx.fillStyle=withAlpha(P.bull,al);ctx.fillRect(right?x1-lu:x0,top,lu,hh);
     ctx.fillStyle=withAlpha(P.bear,al);ctx.fillRect(right?x1-lu-ld:x0+lu,top,ld,hh);
    });
    if(st.vva){const yh=yOf(pr.vah),yl=yOf(pr.val);ctx.save();ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.globalAlpha=st.op*.7;ctx.strokeStyle=c;if(yh!=null)line({x:x0,y:yh},{x:x1,y:yh});if(yl!=null)line({x:x0,y:yl},{x:x1,y:yl});ctx.restore()}
    if(st.vpoc){const yp=yOf(pr.poc);if(yp!=null){
     ctx.strokeStyle=c;ctx.lineWidth=lw;ctx.setLineDash(dash);const xe=st.extR?w:x1;line({x:x0,y:yp},{x:xe,y:yp});
     // popisek POC na podkladu (čitelný přes svíčky)
     ctx.setLineDash([]);ctx.font=FONT;const pt='POC '+this.env.price(pr.poc),tw=ctx.measureText(pt).width,px=Math.min(xe,w)-6-tw;
     ctx.fillStyle=P.bg;pill(ctx,px-4,yp-19,tw+8,16,4);ctx.fill();ctx.fillStyle=c;label(pt,px,yp-6,'left','bottom');
    }}
    if(pr.mode==='tpo'){ctx.font='10px '+FAMILY;ctx.fillStyle=P.muted;label('Čas na ceně (TPO) – trh nemá objem',x0+2,bx.y-3,'left','bottom')}
    break;
   }
   case 'prange':case 'trange':case 'measure':{
    const up=d.a[1].p>=d.a[0].p,tone=d.type==='measure'?(up?P.bull:P.bear):c;
    const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),rw=Math.abs(a.x-b.x),rh=Math.abs(a.y-b.y);
    if(st.fill){ctx.fillStyle=withAlpha(tone,.13);ctx.fillRect(x,y,rw,rh)}
    ctx.strokeStyle=tone;
    if(d.type==='measure'){ctx.lineWidth=1.5;ctx.setLineDash([]);line(a,b)}
    else{
     const arrow=(p:Pt,q:Pt)=>{line(p,q);const ang=Math.atan2(q.y-p.y,q.x-p.x),k=7;ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-k*Math.cos(ang-.45),q.y-k*Math.sin(ang-.45));ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-k*Math.cos(ang+.45),q.y-k*Math.sin(ang+.45));ctx.stroke();ctx.setLineDash(dash)};
     if(d.type==='prange'){line({x,y:a.y},{x:x+rw,y:a.y});line({x,y:b.y},{x:x+rw,y:b.y});arrow({x:x+rw/2,y:a.y},{x:x+rw/2,y:b.y})}
     else{line({x:a.x,y},{x:a.x,y:y+rh});line({x:b.x,y},{x:b.x,y:y+rh});arrow({x:a.x,y:y+rh/2},{x:b.x,y:y+rh/2})}
    }
    const lines=this.env.lines(d);ctx.font=FONT;const bh=lines.length*16+6;
    let ly=d.type==='trange'?y+rh+6:up?y-bh-6:y+rh+6;if(ly<2)ly=y+rh+6;if(ly+bh>h-2)ly=Math.max(2,y-bh-6);
    tag(lines,(a.x+b.x)/2,ly,tone);
    break;
   }
  }
  // poznámka u kresby
  if(d.type!=='text'&&d.text&&shape.label){
   const bx=shape.label;ctx.setLineDash([]);
   if(st.ta==='middle'){ctx.fillStyle=P.bg;pill(ctx,bx.x,bx.y,bx.w,bx.h,4);ctx.fill()}
   ctx.font=this.font(st);ctx.fillStyle=colorOf(P,st.tc);label(d.text,bx.x+bx.w/2,bx.y+bx.h/2,'center','middle');
  }
  // úchyty vybrané kresby
  ctx.globalAlpha=1;ctx.setLineDash([]);
  const handle=(p:Pt)=>{ctx.beginPath();ctx.arc(p.x,p.y,4.5,0,Math.PI*2);ctx.fillStyle=P.bg;ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle=c;ctx.stroke()};
  // úchyty uprostřed hran: malé obdélníčky (vodorovné nahoře/dole, svislé vlevo/vpravo), odlišné od kulatých rohů
  if(sel)for(const e of edgeHandles(shape)){const v=e.edge==='left'||e.edge==='right',ew=v?6:12,eh=v?12:6;
   pill(ctx,e.pt.x-ew/2,e.pt.y-eh/2,ew,eh,2);ctx.fillStyle=P.bg;ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle=c;ctx.stroke()}
  if(sel&&hasHandles(d.type))shape.pts.forEach(handle);
  if(sel&&d.type==='hline')handle({x:w/2,y:a.y});
  if(sel&&d.type==='brush'){ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.strokeStyle=c;const xs=shape.pts.map(p=>p.x),ys=shape.pts.map(p=>p.y);ctx.strokeRect(Math.min(...xs)-4,Math.min(...ys)-4,Math.max(...xs)-Math.min(...xs)+8,Math.max(...ys)-Math.min(...ys)+8)}
 }
}
