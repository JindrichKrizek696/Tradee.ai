// Presety a výchozí vzhled nástrojů kreslení, vlastní barvy a oblíbené nástroje v DB (drawing_prefs, JSON per uživatel).
import type {Db} from '../mysql.ts';
import {emptyPrefs,parsePrefs,type DrawPrefs} from './drawings.ts';
const sql=(ms:number)=>new Date(ms).toISOString().slice(0,19).replace('T',' ');
export async function loadPrefs(d:Db,userId:string):Promise<DrawPrefs>{
 const row=await d.prepare('SELECT data FROM drawing_prefs WHERE user_id=?').bind(userId).first<{data:string}>();
 if(!row)return emptyPrefs();
 try{return parsePrefs(JSON.parse(String(row.data)))}catch{return emptyPrefs()}
}
export async function savePrefs(d:Db,userId:string,prefs:DrawPrefs,now:number){
 await d.prepare('INSERT INTO drawing_prefs(user_id,data,updated) VALUES(?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),updated=VALUES(updated)').bind(userId,JSON.stringify(prefs),sql(now)).run();
}
