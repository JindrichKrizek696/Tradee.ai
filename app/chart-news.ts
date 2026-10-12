// Nadcházející zprávy kalendáře jako pás dole v grafu (primitivum cenové série, lightweight-charts v5): štítek se zemí (US, EU…), rámeček podle síly – červená silná, oranžová střední.
// Pozice = logický index svíčky, i za poslední svíčkou (budoucnost); zprávy blízko sebe se skládají do řádků nad sebou. Najetí a klik přes hitTest: 'n:<id>' zpráva, 'n+' šipka s počtem dalších zpráv vpravo.
// Vybraná zpráva (otevřený detail, i proběhlá) má svislou čárkovanou čáru přes graf.
import type {ISeriesPrimitive,IPrimitivePaneView,IPrimitivePaneRenderer,PrimitiveHoveredItem,SeriesAttachedParameter,Time,Logical} from 'lightweight-charts';
import {withAlpha} from '@/lib/chart/layers';

export type NewsStripItem={id:string;logical:number;label:string;strong:boolean};
export type NewsPalette={high:string;mid:string;bg:string;fg:string};
type Target=Parameters<IPrimitivePaneRenderer['draw']>[0];
type Hit={id:string;x:number;y:number;w:number;h:number};
const FAMILY='Inter Variable, Inter, system-ui, sans-serif',H=16,GAP=3,PAD=5,ROWS=3;

export class NewsStripPrimitive implements ISeriesPrimitive<Time>{
 items:NewsStripItem[]=[];last=-1;bottom=0;
 selected:{logical:number;strong:boolean}|null=null;
 palette:NewsPalette={high:'#dc2626',mid:'#d97706',bg:'#fff',fg:'#0b0c0e'};
 private param:SeriesAttachedParameter<Time>|null=null;
 private hits:Hit[]=[];
 private views:IPrimitivePaneView[];
 constructor(){
  const renderer:IPrimitivePaneRenderer={draw:t=>this.draw(t)};
  // 'normal' = nad svíčkami, pod kresbami
  this.views=[{zOrder:()=>'normal',renderer:()=>renderer}];
 }
 attached(p:SeriesAttachedParameter<Time>){this.param=p}
 detached(){this.param=null;this.hits=[]}
 paneViews(){return this.views}
 update(){this.param?.requestUpdate()}
 hitTest(x:number,y:number):PrimitiveHoveredItem|null{
  for(let i=this.hits.length-1;i>=0;i--){const h=this.hits[i];if(x>=h.x-2&&x<=h.x+h.w+2&&y>=h.y-2&&y<=h.y+h.h+2)return {externalId:h.id,zOrder:'normal',cursorStyle:'pointer',itemType:'marker',hitTestPriority:2,distance:0}}
  return null;
 }
 private draw(target:Target){
  target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>{
   const p=this.param,hits:Hit[]=[];this.hits=hits;if(!p)return;
   const ts=p.chart.timeScale(),w=mediaSize.width,h=mediaSize.height,P=this.palette,base=h-this.bottom-PAD;
   ctx.save();
   if(this.selected){
    const x=ts.logicalToCoordinate(this.selected.logical as Logical);
    if(x!==null&&x>=0&&x<=w){const cx=Math.round(x)+.5;ctx.strokeStyle=withAlpha(this.selected.strong?P.high:P.mid,.75);ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(cx,0);ctx.lineTo(cx,h-this.bottom);ctx.stroke();ctx.setLineDash([])}
   }
   ctx.font='600 10px '+FAMILY;ctx.textAlign='center';ctx.textBaseline='middle';
   const rows:number[]=[],shown:{it:NewsStripItem;x:number;bw:number}[]=[];let more=0;
   const badge=(id:string,label:string,cx:number,y:number,bw:number,color:string,strong:boolean)=>{
    const x=Math.round(cx-bw/2)+.5,yy=Math.round(y)+.5;
    ctx.beginPath();ctx.roundRect(x,yy,bw,H,4);ctx.fillStyle=P.bg;ctx.fill();ctx.fillStyle=withAlpha(color,strong?.2:.12);ctx.fill();
    ctx.lineWidth=strong?1.75:1.25;ctx.strokeStyle=color;ctx.stroke();
    if(label){ctx.fillStyle=P.fg;ctx.fillText(label,cx,yy+H/2+.5)}else{ctx.beginPath();ctx.arc(cx,yy+H/2,3,0,Math.PI*2);ctx.fillStyle=color;ctx.fill()}
    hits.push({id,x:cx-bw/2,y,w:bw,h:H});
   };
   for(const it of this.items){
    const x=ts.logicalToCoordinate(it.logical as Logical);if(x===null)continue;
    if(x>w){more++;continue}
    if(x>=0)shown.push({it,x,bw:it.label?Math.max(H,Math.ceil(ctx.measureText(it.label).width)+10):H});
   }
   // šipka s počtem dalších zpráv za pravým okrajem (jen když je vidět současnost); štítky pod ní jdou o řádek výš
   const lx=this.last>=0?ts.logicalToCoordinate(this.last as Logical):null,moreLabel='+'+more+' ›',moreW=Math.ceil(ctx.measureText(moreLabel).width)+12;
   const chipLeft=more&&lx!==null&&lx<=w?w-moreW-4:Infinity;
   for(const {it,x,bw} of shown){
    // první řádek, kde se štítek nepřekryje s předchozím ani se šipkou; nad ROWS řádků se už překrývá v horním
    let row=ROWS-1;
    for(let i=0;i<ROWS;i++){if(i===0&&x+bw/2>chipLeft-2)continue;const r=rows[i];if(r===undefined||r<x-bw/2-2){row=i;break}}
    rows[row]=x+bw/2;
    badge('n:'+it.id,it.label,x,base-H-row*(H+GAP),bw,it.strong?P.high:P.mid,it.strong);
   }
   if(chipLeft<Infinity){
    const label=moreLabel,bw=moreW,cx=w-bw/2-4,y=base-H;
    const x=Math.round(cx-bw/2)+.5;
    ctx.beginPath();ctx.roundRect(x,Math.round(y)+.5,bw,H,8);ctx.fillStyle=P.bg;ctx.fill();ctx.lineWidth=1;ctx.strokeStyle=withAlpha(P.fg,.35);ctx.stroke();
    ctx.fillStyle=P.fg;ctx.fillText(label,cx,Math.round(y)+.5+H/2+.5);
    hits.push({id:'n+',x:cx-bw/2,y,w:bw,h:H});
   }
   ctx.restore();
  });
 }
}
