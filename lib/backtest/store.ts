// DB vrstva backtesteru: pravidla strategií a uložené běhy (Db je parametr, vše filtruje user_id).
import type {Db} from '../mysql.ts';
import {nowSql} from '../mt/store.ts';
import {normalizeRules,DEFAULT_RULES,type StrategyRules} from './rules.ts';
import {MAX_RUNS} from './request.ts';
const uid=()=>'bt_'+crypto.randomUUID().replace(/-/g,'').slice(0,24);
const parse=(s:unknown,fb:unknown)=>{try{return JSON.parse(String(s))}catch{return fb}};

export async function ownsStrategy(d:Db,userId:string,strategyId:string):Promise<boolean>{
 return !!await d.prepare('SELECT id FROM strategies WHERE id=? AND user_id=?').bind(strategyId,userId).first();
}
export async function getRules(d:Db,userId:string,strategyId:string):Promise<{rules:StrategyRules;saved:boolean;updated:string|null}>{
 const r=await d.prepare('SELECT rules,updated FROM strategy_rules WHERE strategy_id=? AND user_id=?').bind(strategyId,userId).first<{rules:string;updated:string}>();
 return r?{rules:normalizeRules(parse(r.rules,null)),saved:true,updated:r.updated}:{rules:DEFAULT_RULES,saved:false,updated:null};
}
export async function saveRules(d:Db,userId:string,strategyId:string,raw:unknown):Promise<StrategyRules>{
 const rules=normalizeRules(raw);
 await d.prepare('INSERT INTO strategy_rules(strategy_id,user_id,rules,updated) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE rules=VALUES(rules),updated=VALUES(updated)').bind(strategyId,userId,JSON.stringify(rules),nowSql()).run();
 return rules;
}

export type RunRow={id:string;strategyId:string;created:string;params:unknown;summary:unknown};
export type RunFull=RunRow&{result:unknown};
const toRow=(r:{id:string;strategy_id:string;created:string;params:string;summary:string})=>({id:r.id,strategyId:r.strategy_id,created:r.created,params:parse(r.params,{}),summary:parse(r.summary,{})});
// seznam bez `result` (velké); nejnovější první
export async function listRuns(d:Db,userId:string,strategyId?:string):Promise<RunRow[]>{
 const q=strategyId?' AND strategy_id=?':'',p=strategyId?[userId,strategyId]:[userId];
 return (await d.prepare(`SELECT id,strategy_id,created,params,summary FROM backtest_runs WHERE user_id=?${q} ORDER BY created DESC,id DESC LIMIT ${MAX_RUNS}`).bind(...p).all<{id:string;strategy_id:string;created:string;params:string;summary:string}>()).results.map(toRow);
}
export async function getRun(d:Db,userId:string,id:string):Promise<RunFull|null>{
 const r=await d.prepare('SELECT id,strategy_id,created,params,summary,result FROM backtest_runs WHERE id=? AND user_id=?').bind(id,userId).first<{id:string;strategy_id:string;created:string;params:string;summary:string;result:string}>();
 return r?{...toRow(r),result:parse(r.result,null)}:null;
}
export async function deleteRun(d:Db,userId:string,id:string):Promise<boolean>{
 return (await d.prepare('DELETE FROM backtest_runs WHERE id=? AND user_id=?').bind(id,userId).run()).meta.changes>0;
}
// uloží běh a smaže nejstarší nad limit (MariaDB neumí LIMIT v IN poddotazu → ID nad limitem se vybírají zvlášť)
export async function saveRun(d:Db,userId:string,strategyId:string,params:unknown,summary:unknown,result:unknown):Promise<RunFull>{
 const id=uid(),created=nowSql();
 await d.prepare('INSERT INTO backtest_runs(id,user_id,strategy_id,params,summary,result,created) VALUES(?,?,?,?,?,?,?)').bind(id,userId,strategyId,JSON.stringify(params),JSON.stringify(summary),JSON.stringify(result),created).run();
 const old=(await d.prepare(`SELECT id FROM backtest_runs WHERE user_id=? ORDER BY created DESC,id DESC LIMIT 1000 OFFSET ${MAX_RUNS}`).bind(userId).all<{id:string}>()).results.map(r=>r.id).filter(x=>x!==id);
 if(old.length)await d.prepare(`DELETE FROM backtest_runs WHERE user_id=? AND id IN (${old.map(()=>'?').join(',')})`).bind(userId,...old).run();
 return {id,strategyId,created,params,summary,result};
}
