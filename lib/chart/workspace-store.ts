// Pracovní plocha grafu v DB: záložky (chart_tabs, řádek na záložku, zavřené s closed_at) a rozvržení (chart_layouts). Uložení = celá sada najednou (2 dotazy).
import type {Db} from '../mysql.ts';
import {parseLayouts,parseWorkspace,type Layout,type Workspace} from './workspace.ts';
const sql=(ms:number)=>new Date(ms).toISOString().slice(0,19).replace('T',' ');
const utc=(s:unknown)=>s?Date.parse(String(s).replace(' ','T')+'Z'):0;
const json=(s:unknown)=>{try{return JSON.parse(String(s))}catch{return null}};
export async function loadWorkspace(d:Db,userId:string,ids:readonly string[]):Promise<Workspace>{
 const rows=(await d.prepare('SELECT id,pos,active,closed_at,data FROM chart_tabs WHERE user_id=? ORDER BY closed_at IS NOT NULL,pos,closed_at DESC').bind(userId).all<{id:string;pos:number;active:number;closed_at:string|null;data:string}>()).results;
 const open=rows.filter(r=>!r.closed_at),closed=rows.filter(r=>r.closed_at).sort((a,b)=>utc(b.closed_at)-utc(a.closed_at));
 const act=open.find(r=>Number(r.active))?.id??null;
 return parseWorkspace({
  tabs:open.map(r=>({...json(r.data),id:r.id})),
  closed:closed.map(r=>{const v=json(r.data)||{};return {tab:{...v.tab,id:r.id},drawings:v.drawings,closedAt:utc(r.closed_at)}}),
  active:act,
 },ids);
}
export async function saveWorkspace(d:Db,userId:string,ws:Workspace,now:number){
 const t=sql(now),vals:unknown[]=[],rows:string[]=[];
 ws.tabs.forEach((tab,i)=>{rows.push('(?,?,?,?,NULL,?,?)');vals.push(userId,tab.id,i,tab.id===ws.active?1:0,JSON.stringify(tab),t)});
 // zavřené: ID se může krýt s otevřenou záložkou jen výjimečně (obnovená kopie) – pak se zavřená přeskočí
 const openIds=new Set(ws.tabs.map(x=>x.id));
 ws.closed.forEach((c,i)=>{if(openIds.has(c.tab.id))return;openIds.add(c.tab.id);rows.push('(?,?,?,0,?,?,?)');vals.push(userId,c.tab.id,i,sql(c.closedAt||now),JSON.stringify({tab:c.tab,drawings:c.drawings}),t)});
 const keep=[...openIds];
 await d.prepare('DELETE FROM chart_tabs WHERE user_id=?'+(keep.length?' AND id NOT IN ('+keep.map(()=>'?').join(',')+')':'')).bind(userId,...keep).run();
 if(rows.length)await d.prepare('INSERT INTO chart_tabs(user_id,id,pos,active,closed_at,data,updated) VALUES'+rows.join(',')+' ON DUPLICATE KEY UPDATE pos=VALUES(pos),active=VALUES(active),closed_at=VALUES(closed_at),data=VALUES(data),updated=VALUES(updated)').bind(...vals).run();
}
export async function loadLayouts(d:Db,userId:string):Promise<Layout[]>{
 const rows=(await d.prepare('SELECT id,name,data FROM chart_layouts WHERE user_id=? ORDER BY pos,name').bind(userId).all<{id:string;name:string;data:string}>()).results;
 return parseLayouts(rows.map(r=>({...json(r.data),id:r.id,name:r.name})));
}
export async function saveLayouts(d:Db,userId:string,list:Layout[],now:number){
 const t=sql(now),keep=list.map(l=>l.id);
 await d.prepare('DELETE FROM chart_layouts WHERE user_id=?'+(keep.length?' AND id NOT IN ('+keep.map(()=>'?').join(',')+')':'')).bind(userId,...keep).run();
 if(list.length)await d.prepare('INSERT INTO chart_layouts(user_id,id,name,pos,data,updated) VALUES'+list.map(()=>'(?,?,?,?,?,?)').join(',')+' ON DUPLICATE KEY UPDATE name=VALUES(name),pos=VALUES(pos),data=VALUES(data),updated=VALUES(updated)')
  .bind(...list.flatMap((l,i)=>[userId,l.id,l.name,i,JSON.stringify({view:l.view,strategy:l.strategy}),t])).run();
}
