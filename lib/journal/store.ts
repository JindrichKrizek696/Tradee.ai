// DB dotazy deníku obchodů (Db je parametr).
import type {Db} from '../mysql.ts';
import {POSITION_COLUMNS} from '../mt/build.ts';
import {nowSql} from '../mt/store.ts';
import {userCurrency,loadRates} from '../rates-db.ts';
import {toJournalTrades} from './rows.ts';
import type {JournalAccount,JournalChange,JournalDetail,JournalFile,JournalList,JournalPosition,ManualJournalRow,MtJournalRow} from './types.ts';
export async function listJournal(d:Db,userId:string):Promise<JournalList>{
 const currency=await userCurrency(d,userId);
 const accounts:JournalAccount[]=(await d.prepare('SELECT id,name,login,platform,currency FROM mt_accounts WHERE user_id=? ORDER BY created').bind(userId).all<{id:string;name:string;login:string;platform:string;currency:string}>()).results.map(a=>({id:a.id,name:a.name||'••••'+String(a.login).slice(-4),platform:a.platform,currency:a.currency}));
 const mt=(await d.prepare(`SELECT p.id,p.account_id,p.symbol,p.side,p.open_ts,p.close_ts,p.volume_max,p.net,p.r_result,p.rr_planned,p.risk_pct,p.risk_money,p.mfe_money,p.mae_money,p.tags,p.tags_manual,
  (p.note IS NOT NULL AND p.note<>'') AS has_note,(SELECT COUNT(*) FROM mt_position_files f WHERE f.position_id=p.id) AS files,a.currency AS acc_currency,a.name AS acc_name,a.login AS acc_login
  FROM mt_positions p JOIN mt_accounts a ON a.id=p.account_id WHERE a.user_id=? AND p.status='closed'`).bind(userId).all<MtJournalRow>()).results;
 const manual=(await d.prepare('SELECT id,date,instrument,pnl,note,created FROM trades WHERE user_id=?').bind(userId).all<ManualJournalRow>()).results;
 const rates=await loadRates(d,currency,mt.map(r=>r.acc_currency));
 return {currency,accounts,trades:toJournalTrades(mt,manual,currency,rates)};
}
export async function ownsPosition(d:Db,userId:string,positionId:string){
 return !!await d.prepare('SELECT p.id FROM mt_positions p JOIN mt_accounts a ON a.id=p.account_id WHERE p.id=? AND a.user_id=?').bind(positionId,userId).first();
}
export async function journalDetail(d:Db,userId:string,positionId:string):Promise<JournalDetail|null>{
 const p=await d.prepare(`SELECT ${POSITION_COLUMNS.map(c=>'p.'+c).join(',')},p.tags_manual,p.note,a.currency AS acc_currency,a.name AS acc_name,a.login AS acc_login,a.platform FROM mt_positions p JOIN mt_accounts a ON a.id=p.account_id WHERE p.id=? AND a.user_id=?`).bind(positionId,userId).first<Record<string,unknown>>();
 if(!p)return null;
 const changes=(await d.prepare('SELECT ts,kind,old_value,new_value,price,volume,reason FROM mt_position_changes WHERE position_id=? ORDER BY ts,id').bind(positionId).all<JournalChange>()).results.map(c=>({...c,ts:Number(c.ts)}));
 const bars=await d.prepare('SELECT tf,data FROM mt_position_bars WHERE account_id=? AND position=?').bind(p.account_id,String(p.ticket).split(':r')[0]).first<{tf:string;data:string}>();
 const files=(await d.prepare('SELECT id,name,size,type FROM mt_position_files WHERE position_id=? ORDER BY created,id').bind(positionId).all<JournalFile>()).results.map(f=>({...f,size:Number(f.size)}));
 const {acc_login,...rest}=p;
 const position={...rest,open_ts:Number(p.open_ts),close_ts:p.close_ts===null?null:Number(p.close_ts),magic:Number(p.magic),mfe_partial:Number(p.mfe_partial),acc_name:String(p.acc_name||'')||'••••'+String(acc_login).slice(-4)} as unknown as JournalPosition;
 return {position,changes,bars:bars?{tf:bars.tf,data:JSON.parse(bars.data)}:null,files};
}
export async function updateMtJournal(d:Db,userId:string,positionId:string,u:{tags?:string[];note?:string}){
 if(!await ownsPosition(d,userId,positionId))return false;
 if(u.tags)await d.prepare('UPDATE mt_positions SET tags_manual=? WHERE id=?').bind(u.tags.join(','),positionId).run();
 if(u.note!==undefined)await d.prepare('UPDATE mt_positions SET note=? WHERE id=?').bind(u.note||null,positionId).run();
 return true;
}
export async function updateManualNote(d:Db,userId:string,id:string,note:string){
 if(!await d.prepare('SELECT id FROM trades WHERE id=? AND user_id=?').bind(id,userId).first())return false;
 await d.prepare('UPDATE trades SET note=? WHERE id=? AND user_id=?').bind(note,id,userId).run();
 return true;
}
export async function countFiles(d:Db,positionId:string){const r=await d.prepare('SELECT COUNT(*) AS n FROM mt_position_files WHERE position_id=?').bind(positionId).first<{n:number}>();return Number(r?.n||0)}
export async function addFile(d:Db,f:{id:string;positionId:string;userId:string;r2Key:string;name:string;size:number;type:string}){
 await d.prepare('INSERT INTO mt_position_files(id,position_id,user_id,r2_key,name,size,type,created) VALUES(?,?,?,?,?,?,?,?)').bind(f.id,f.positionId,f.userId,f.r2Key,f.name,f.size,f.type,nowSql()).run();
}
export async function ownFile(d:Db,userId:string,fileId:string){
 return d.prepare('SELECT id,position_id,r2_key,type FROM mt_position_files WHERE id=? AND user_id=?').bind(fileId,userId).first<{id:string;position_id:string;r2_key:string;type:string}>();
}
export async function deleteFile(d:Db,fileId:string){await d.prepare('DELETE FROM mt_position_files WHERE id=?').bind(fileId).run()}
