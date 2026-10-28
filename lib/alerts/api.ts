// Společné pro API alertů: kontext validace (známé trhy, poslední cena z market_live) a odpovědi.
import type {Db} from '../mysql.ts';
import {instruments} from '../markets.ts';
import type {Ctx} from './logic.ts';
const GROUP=new Map(instruments.map(i=>[i.id,i.group]));
export const H={headers:{'Cache-Control':'private, no-store'}};
export const known=(id:string)=>GROUP.get(id)??null;
/** Kontext pro varování: poslední živá cena (Yahoo 15 min) z DB, skóre jen jako nápověda z klienta (číslo). */
export async function ctxFor(d:Db,instrument:unknown,hint:unknown,now:number):Promise<Omit<Ctx,'pushAvailable'>>{
 let price:number|null=null,changePct:number|null=null;
 if(typeof instrument==='string'&&known(instrument)){try{const r=await d.prepare('SELECT price,change_pct FROM market_live WHERE instrument=?').bind(instrument).first<{price:number;change_pct:number}>();if(r){price=Number(r.price)||null;changePct=Number.isFinite(Number(r.change_pct))?Number(r.change_pct):null}}catch{}}
 const h=hint&&typeof hint==='object'?hint as Record<string,unknown>:{},score=typeof h.score==='number'&&Number.isFinite(h.score)?h.score:null;
 return {known,price,changePct,score,now};
}
export const notFound=()=>Response.json({error:'Alert nenalezen. Možná byl smazán v jiném okně.'},{status:404,headers:{'Cache-Control':'no-store'}});
