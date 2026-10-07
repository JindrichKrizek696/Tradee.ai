import {identity,db,failed,sameOrigin} from '@/lib/server';
import type {Trade} from '@/lib/trades';
import {makeRates,isCurrency,type FxRow} from '@/lib/fx';
import {mtTradesToCalendar,type MtClosedRow} from '@/lib/mt/trades';
const str=(s:unknown):s is string=>typeof s==='string';
export async function GET(req:Request){try{const u=await identity(req),d=db();
 const m=await d.prepare('SELECT currency FROM members WHERE id=?').bind(u.id).first<{currency:string|null}>();const currency=isCurrency(m?.currency)?m!.currency:'USD';
 const manual=(await d.prepare('SELECT id,date,instrument,pnl,note,created FROM trades WHERE user_id=? ORDER BY date,created').bind(u.id).all<Trade>()).results.map(t=>({...t,source:'manual' as const}));
 const mtRows=(await d.prepare(`SELECT p.id,p.ticket,p.symbol,p.net,p.close_ts,p.tags,p.tags_manual,p.note,a.currency AS acc_currency,a.name AS acc_name,a.login AS acc_login
  FROM mt_positions p JOIN mt_accounts a ON a.id=p.account_id WHERE a.user_id=? AND p.status='closed' ORDER BY p.close_ts`).bind(u.id).all<MtClosedRow>()).results;
 const curs=[...new Set([currency,...mtRows.map(r=>r.acc_currency)])].filter(c=>c&&c!=='EUR');
 const rates=makeRates(curs.length?(await d.prepare(`SELECT date,currency,per_eur FROM fx_rates WHERE currency IN (${curs.map(()=>'?').join(',')})`).bind(...curs).all<FxRow>()).results:[]);
 const trades=[...manual,...mtTradesToCalendar(mtRows,currency,rates)].sort((a,b)=>a.date.localeCompare(b.date)||a.created.localeCompare(b.created));
 return Response.json({trades,currency},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);const b=await req.json() as {date?:unknown;instrument?:unknown;pnl?:unknown;note?:unknown};
 if(!str(b.date)||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||isNaN(Date.parse(b.date)))throw Error('Zadej datum ve formátu RRRR-MM-DD.');
 if(!str(b.instrument)||!b.instrument.trim()||b.instrument.trim().length>40)throw Error('Zadej trh, nejvýše 40 znaků.');
 if(typeof b.pnl!=='number'||!Number.isFinite(b.pnl)||Math.abs(b.pnl)>1e9)throw Error('Výsledek musí být číslo.');
 const note=str(b.note)?b.note.trim().slice(0,500):'',id=crypto.randomUUID();
 await db().prepare('INSERT INTO trades(id,user_id,date,instrument,pnl,note,created) VALUES(?,?,?,?,?,?,?)').bind(id,u.id,b.date,b.instrument.trim(),Math.round(b.pnl*100)/100,note,new Date().toISOString()).run();
 return Response.json({ok:true,id})}catch(e){return failed(e)}}
export async function DELETE(req:Request){try{sameOrigin(req);const u=await identity(req);const {id}=await req.json() as {id?:unknown};if(!str(id))throw Error('Chybí id obchodu.');await db().prepare('DELETE FROM trades WHERE id=? AND user_id=?').bind(id,u.id).run();return Response.json({ok:true})}catch(e){return failed(e)}}
