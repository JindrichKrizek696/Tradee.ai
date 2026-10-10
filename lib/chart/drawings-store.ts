// Uložené kresby grafu v DB (chart_drawings, JSON per uživatel × trh).
import type {Db} from '../mysql.ts';
import {parseDrawings,type Drawing} from './drawings.ts';
const sql=(ms:number)=>new Date(ms).toISOString().slice(0,19).replace('T',' ');
export async function loadDrawings(d:Db,userId:string,instrument:string):Promise<Drawing[]>{
 const row=await d.prepare('SELECT data FROM chart_drawings WHERE user_id=? AND instrument=?').bind(userId,instrument).first<{data:string}>();
 if(!row)return [];
 let raw:unknown;try{raw=JSON.parse(String(row.data))}catch{return []}
 // poškozený záznam: vrátit jen platné kresby
 const all=parseDrawings(raw);if(all.ok)return all.drawings;
 return Array.isArray(raw)?raw.flatMap(x=>{const r=parseDrawings([x]);return r.ok?r.drawings:[]}):[];
}
export async function saveDrawings(d:Db,userId:string,instrument:string,drawings:Drawing[],now:number){
 if(!drawings.length){await d.prepare('DELETE FROM chart_drawings WHERE user_id=? AND instrument=?').bind(userId,instrument).run();return}
 await d.prepare('INSERT INTO chart_drawings(user_id,instrument,data,updated) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),updated=VALUES(updated)').bind(userId,instrument,JSON.stringify(drawings),sql(now)).run();
}
