// Odpočet do zavření svíčky jako primitivum cenové série (lightweight-charts v5): štítek na cenové ose hned pod štítkem poslední ceny
// (bez štítku ceny přímo na její úrovni), v barvě poslední svíčky. Skryje se, když svíčka už skončila (zavřený trh) – lib/chart/appearance closeIn.
import {MismatchDirection,type ISeriesPrimitive,type ISeriesPrimitiveAxisView,type SeriesAttachedParameter,type Time} from 'lightweight-charts';
import {chartTime} from '@/lib/journal/chart-data';
import {closeIn,fmtCountdown} from '@/lib/chart/appearance';

// výška štítku poslední ceny při písmu 12 px (písmo + horní a dolní odsazení knihovny)
const LABEL_H=17;
// knihovna kešuje podle reference pole – vypnutý odpočet vrací pořád stejné prázdné
const NONE:readonly ISeriesPrimitiveAxisView[]=[];
type Last={value:number;up:boolean};
export class CountdownPrimitive implements ISeriesPrimitive<Time>{
 on=false;
 // začátek poslední svíčky (čas grafu, s) a délka TF
 start:number|null=null;
 tfSec=3600;
 // pod štítkem ceny (true), nebo místo něj
 below=true;
 // barva štítku podle směru poslední svíčky (up / down), text kontrastní
 colors={up:'#16a34a',down:'#dc2626',upText:'#ffffff',downText:'#ffffff'};
 private param:SeriesAttachedParameter<Time>|null=null;
 private views:ISeriesPrimitiveAxisView[];
 constructor(){
  const view:ISeriesPrimitiveAxisView={
   coordinate:()=>-1e4,
   fixedCoordinate:()=>{const l=this.last(),y=l?this.param?.series.priceToCoordinate(l.value):null;return y==null?undefined:y+(this.below?LABEL_H:0)},
   text:()=>{const left=this.left();return left===null?'':fmtCountdown(left)},
   textColor:()=>this.last()?.up===false?this.colors.downText:this.colors.upText,
   backColor:()=>this.last()?.up===false?this.colors.down:this.colors.up,
   visible:()=>this.left()!==null&&this.last()!==null,
   tickVisible:()=>false,
  };
  this.views=[view];
 }
 attached(p:SeriesAttachedParameter<Time>){this.param=p}
 detached(){this.param=null}
 update(){this.param?.requestUpdate()}
 priceAxisViews(){return this.on?this.views:NONE}
 private left(){return this.on&&this.start!==null?closeIn(this.start,this.tfSec,chartTime(Date.now())):null}
 // poslední bod série: svíčka (open / close), u čáry a plochy hodnota (barva jako růst)
 private last():Last|null{
  const d=this.param?.series.dataByIndex(Number.MAX_SAFE_INTEGER,MismatchDirection.NearestLeft) as {open?:number;close?:number;value?:number}|null|undefined;
  if(!d)return null;
  if(typeof d.close==='number')return {value:d.close,up:d.close>=(d.open??d.close)};
  return typeof d.value==='number'?{value:d.value,up:true}:null;
 }
}
