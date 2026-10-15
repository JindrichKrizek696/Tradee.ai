// Laboratoř · Simulace – databáze (lab_paper_*). Volá se z /api/laborator/paper za labGate a ze scripts/lab-paper.mjs (jen pro vlastníka).
// Všechny dotazy filtrují user_id vlastníka (a variantu A/B/C/D, migrace 0027); nikdy se nepoužívá ?as= (lib/admin/http.ts viewAs).
import type {Db} from '../mysql.ts';
import {PAPER_RULES,PAPER_VARIANTS,VARIANT_IDS,SWEEP_VARIANT_IDS,isVariantId,isBaseVariant,isSweepVariant,sweepVariant,markToMarket,paperStats,paperSummaryMd,type VariantId,type PaperVariant,type PaperTrade,type PaperStepResult,type PaperSnapshot,type ExitReason,type Direction,type PaperEquityPoint} from './paper.ts';
import {normalizeCombo,comboIndex,type SweepCombo} from './sweep.ts';

export const toSql=(ms:number,frac=false)=>{const s=new Date(ms).toISOString().replace('T',' ');return frac?s.slice(0,23):s.slice(0,19)};
export const fromSql=(s:unknown)=>s===null||s===undefined?null:Date.parse(String(s).replace(' ','T')+(String(s).endsWith('Z')?'':'Z'));
const num=(v:unknown)=>v===null||v===undefined?null:Number(v);
const json=<T,>(s:unknown,def:T):T=>{if(typeof s!=='string'||!s)return def;try{return JSON.parse(s) as T}catch{return def}};

// sweep = původ varianty S01… (kombinace a výsledek sweepu v době spuštění); u A–D null
export type SweepOrigin={sweepId:string|null;combo:number;params:SweepCombo;is:Record<string,number|null>|null;oos:Record<string,number|null>|null;nb:number|null;chance:number|null;at:string};
export type PaperAccount={variant:VariantId;startEquity:number;started:number;rulesVersion:string;active:boolean;sweep:SweepOrigin|null};
type AccRow={variant:string;start_equity:number;started:string;rules_version:string;active:number;rules:string|null};
const toAcc=(r:AccRow):PaperAccount=>{const j=json<{sweep?:unknown;origin?:SweepOrigin}>(r.rules,{}),c=normalizeCombo(j.sweep);
 return {variant:(isVariantId(r.variant)?r.variant:'A'),startEquity:Number(r.start_equity),started:fromSql(r.started)!,rulesVersion:r.rules_version,active:Number(r.active)===1,
  sweep:isSweepVariant(r.variant)&&c?{...(j.origin??{sweepId:null,combo:comboIndex(c),is:null,oos:null,nb:null,chance:null,at:''}),params:c}:null}};
const ACC_COLS='variant,start_equity,started,rules_version,active,rules';
export async function getAccount(d:Db,uid:string,variant:VariantId='A'):Promise<PaperAccount|null>{
 const r=await d.prepare(`SELECT ${ACC_COLS} FROM lab_paper_accounts WHERE user_id=? AND variant=?`).bind(uid,variant).first<AccRow>();
 return r?toAcc(r):null;
}
export async function listAccounts(d:Db,uid:string):Promise<PaperAccount[]>{
 return (await d.prepare(`SELECT ${ACC_COLS} FROM lab_paper_accounts WHERE user_id=? ORDER BY variant`).bind(uid).all<AccRow>()).results.map(toAcc);
}
// pravidla varianty: A–D z kódu, S… z uložené kombinace (bez platné kombinace = null → varianta se neobchoduje)
export function variantOf(id:VariantId,acc?:PaperAccount|null):PaperVariant|null{
 if(isBaseVariant(id))return PAPER_VARIANTS[id];
 return acc?.sweep?sweepVariant(id,acc.sweep.params):null;
}
// všechny varianty vlastníka: A–D vždy, S… podle účtů (seřazené)
export const variantsOf=(accounts:PaperAccount[])=>[...VARIANT_IDS.map(v=>PAPER_VARIANTS[v]),...accounts.filter(a=>isSweepVariant(a.variant)).sort((a,b)=>a.variant.localeCompare(b.variant)).map(a=>variantOf(a.variant,a)).filter((v):v is PaperVariant=>!!v)];
const rulesJson=(V:PaperVariant,origin?:SweepOrigin)=>JSON.stringify({variant:V.id,name:V.name,kind:V.kind,groups:V.groups,rules:V.rules,text:V.text,...(V.sweep?{sweep:V.sweep,markets:V.markets,origin}:{})});
// nový účet varianty (start = první běh); u existujícího jen doplní uložená pravidla, když chybí (A z doby před 0027). Jen A–D; S… vzniká createSweepVariant.
export async function ensureAccount(d:Db,uid:string,now:number,variant:VariantId='A'):Promise<PaperAccount>{
 const a=await getAccount(d,uid,variant);
 if(!isBaseVariant(variant)){if(a)return a;throw Error('Varianta ze sweepu neexistuje.')}
 const V=PAPER_VARIANTS[variant];
 if(a){await d.prepare('UPDATE lab_paper_accounts SET rules=? WHERE user_id=? AND variant=? AND rules IS NULL').bind(rulesJson(V),uid,variant).run();return a}
 await d.prepare('INSERT IGNORE INTO lab_paper_accounts(user_id,variant,start_equity,started,rules_version,rules,active,updated) VALUES(?,?,?,?,?,?,1,?)').bind(uid,variant,V.rules.startEquity,toSql(now),V.rulesVersion,rulesJson(V),toSql(now)).run();
 await addLog(d,uid,now,`Start simulace ${variant} (${V.name}): ${V.rules.startEquity.toLocaleString('cs-CZ')} Kč, pravidla ${V.rulesVersion}.`,variant);
 return (await getAccount(d,uid,variant))!;
}
// „Pustit do simulace“: nová varianta S01…S20 z kombinace sweepu (start = teď, obchoduje od dalšího běhu cronu)
export async function createSweepVariant(d:Db,uid:string,now:number,combo:SweepCombo,origin:Omit<SweepOrigin,'params'>):Promise<VariantId>{
 const accs=(await listAccounts(d,uid)).filter(a=>isSweepVariant(a.variant));
 const dup=accs.find(a=>a.sweep&&comboIndex(a.sweep.params)===comboIndex(combo));
 if(dup)throw Error(`Tahle kombinace už běží jako ${dup.variant}.`);
 const id=SWEEP_VARIANT_IDS.find(v=>!accs.some(a=>a.variant===v));
 if(!id)throw Error(`Nejvýš ${SWEEP_VARIANT_IDS.length} variant ze sweepu – nejdřív nějakou odeber.`);
 const V=sweepVariant(id,combo);
 const r=await d.prepare('INSERT IGNORE INTO lab_paper_accounts(user_id,variant,start_equity,started,rules_version,rules,active,updated) VALUES(?,?,?,?,?,?,1,?)').bind(uid,id,V.rules.startEquity,toSql(now),V.rulesVersion,rulesJson(V,{...origin,params:combo}),toSql(now)).run();
 if(!r.meta.changes)throw Error('Variantu se nepodařilo založit, zkus to znovu.');
 await addLog(d,uid,now,`Start simulace ${id} (${V.name}) ze sweepu: ${V.rules.startEquity.toLocaleString('cs-CZ')} Kč, pravidla ${V.rulesVersion}.`,id);
 return id;
}
// odebrání varianty ze sweepu (jen S…): smaže účet, obchody, křivku i deník
export async function removeSweepVariant(d:Db,uid:string,variant:VariantId){
 if(!isSweepVariant(variant))throw Error('Odebrat jde jen variantu ze sweepu.');
 for(const t of ['lab_paper_trades','lab_paper_equity','lab_paper_log','lab_paper_accounts'])await d.prepare(`DELETE FROM ${t} WHERE user_id=? AND variant=?`).bind(uid,variant).run();
}

type TradeRow={id:string;variant:string;instrument:string;direction:string;opened:string;entry:number;sl:number;tp:number;risk_czk:number;confidence:number;score_at_entry:number;parts_at_entry:string;why:string;closed:string|null;exit_price:number|null;exit_reason:string|null;r:number|null;pnl_czk:number|null;pct:number|null;score_at_exit:number|null;result_note:string|null;rules_version:string};
const COLS='id,variant,instrument,direction,opened,entry,sl,tp,risk_czk,confidence,score_at_entry,parts_at_entry,why,closed,exit_price,exit_reason,r,pnl_czk,pct,score_at_exit,result_note,rules_version';
const toTrade=(r:TradeRow):PaperTrade=>({id:r.id,variant:isVariantId(r.variant)?r.variant:'A',instrument:r.instrument,direction:r.direction as Direction,opened:fromSql(r.opened)!,entry:Number(r.entry),sl:Number(r.sl),tp:Number(r.tp),riskCzk:Number(r.risk_czk),confidence:Number(r.confidence),
 scoreAtEntry:Number(r.score_at_entry),partsAtEntry:json<PaperSnapshot>(r.parts_at_entry,{method:'',coverage:0,alignment:0,freshness:0,atr:0,parts:[]}),why:r.why,
 closed:fromSql(r.closed),exit:num(r.exit_price),exitReason:(r.exit_reason as ExitReason|null)??null,r:num(r.r),pnlCzk:num(r.pnl_czk),pct:num(r.pct),scoreAtExit:num(r.score_at_exit),resultNote:r.result_note,rulesVersion:r.rules_version});
// variant = jen jedna varianta; bez ní všechny (vrstva grafu, týdenní souhrn)
export async function listTrades(d:Db,uid:string,o:{instrument?:string;variant?:VariantId}={}):Promise<PaperTrade[]>{
 const where=['user_id=?'],args:unknown[]=[uid];
 if(o.instrument){where.push('instrument=?');args.push(o.instrument)}
 if(o.variant){where.push('variant=?');args.push(o.variant)}
 return (await d.prepare(`SELECT ${COLS} FROM lab_paper_trades WHERE ${where.join(' AND ')} ORDER BY opened DESC`).bind(...args).all<TradeRow>()).results.map(toTrade);
}
// variant '*' = záznam pro všechny varianty (týdenní souhrn)
export async function addLog(d:Db,uid:string,at:number,text:string,variant:VariantId|'*'='A'){await d.prepare('INSERT INTO lab_paper_log(user_id,variant,at,text) VALUES(?,?,?,?)').bind(uid,variant,toSql(at),text.slice(0,variant==='*'?20000:2000)).run()}
export async function listLog(d:Db,uid:string,variant:VariantId='A',limit=60){return (await d.prepare("SELECT at,text FROM lab_paper_log WHERE user_id=? AND variant IN (?,'*') ORDER BY at DESC,id DESC LIMIT "+Math.max(1,Math.min(500,Math.floor(limit)))).bind(uid,variant).all<{at:string;text:string}>()).results.map(r=>({at:fromSql(r.at)!,text:r.text}))}
export async function lastWeekly(d:Db,uid:string){const r=await d.prepare("SELECT at,text FROM lab_paper_log WHERE user_id=? AND variant='*' AND text LIKE 'Týdenní souhrn%' ORDER BY at DESC,id DESC LIMIT 1").bind(uid).first<{at:string;text:string}>();return r?{at:fromSql(r.at)!,text:r.text}:null}
// equity křivka = uzavřený zůstatek + otevřený P&L v každém snímku
export async function equitySeries(d:Db,uid:string,variant?:VariantId):Promise<(PaperEquityPoint&{variant:VariantId})[]>{
 const rows=variant?(await d.prepare('SELECT variant,at,equity,open_pnl FROM lab_paper_equity WHERE user_id=? AND variant=? ORDER BY at').bind(uid,variant).all<{variant:string;at:string;equity:number;open_pnl:number}>()).results
  :(await d.prepare('SELECT variant,at,equity,open_pnl FROM lab_paper_equity WHERE user_id=? ORDER BY at').bind(uid).all<{variant:string;at:string;equity:number;open_pnl:number}>()).results;
 return rows.map(r=>({variant:isVariantId(r.variant)?r.variant:'A',t:fromSql(r.at)!,equity:Number(r.equity)+Number(r.open_pnl)}));
}

// zápis jednoho kroku (idempotentní: vstup má id podle slotu 15 min, varianty a trhu, výstup jen u ještě otevřeného obchodu, snímek equity podle slotu)
export async function applyStep(d:Db,uid:string,now:number,slot:number,s:PaperStepResult,variant:VariantId='A'){
 for(const c of s.closes)await d.prepare('UPDATE lab_paper_trades SET closed=?,exit_price=?,exit_reason=?,r=?,pnl_czk=?,pct=?,score_at_exit=?,result_note=? WHERE id=? AND user_id=? AND variant=? AND closed IS NULL')
  .bind(toSql(c.closed,true),c.exit,c.exitReason,c.r,c.pnlCzk,c.pct,c.scoreAtExit,c.resultNote,c.id,uid,variant).run();
 for(const t of s.opens)await d.prepare(`INSERT IGNORE INTO lab_paper_trades(id,user_id,variant,instrument,direction,opened,entry,sl,tp,risk_czk,confidence,score_at_entry,parts_at_entry,why,rules_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(t.id,uid,variant,t.instrument,t.direction,toSql(t.opened,true),t.entry,t.sl,t.tp,t.riskCzk,t.confidence,t.scoreAtEntry,JSON.stringify(t.partsAtEntry),t.why,t.rulesVersion).run();
 await d.prepare('INSERT INTO lab_paper_equity(user_id,variant,at,equity,open_pnl,open_count) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE equity=VALUES(equity),open_pnl=VALUES(open_pnl),open_count=VALUES(open_count)').bind(uid,variant,toSql(slot),s.balance,s.openPnl,s.openCount).run();
 for(const l of s.log)await addLog(d,uid,now,l,variant);
}
// restart jedné varianty: smaže její obchody, křivku i deník a začne znovu se 100 000 Kč (ostatní varianty beze změny)
export async function resetPaper(d:Db,uid:string,now:number,variant:VariantId='A'){
 const acc=await getAccount(d,uid,variant),V=variantOf(variant,acc);
 if(!V)throw Error('Neznámá varianta.');
 for(const t of ['lab_paper_trades','lab_paper_equity','lab_paper_log'])await d.prepare(`DELETE FROM ${t} WHERE user_id=? AND variant=?`).bind(uid,variant).run();
 await d.prepare('INSERT INTO lab_paper_accounts(user_id,variant,start_equity,started,rules_version,rules,active,updated) VALUES(?,?,?,?,?,?,1,?) ON DUPLICATE KEY UPDATE start_equity=VALUES(start_equity),started=VALUES(started),rules_version=VALUES(rules_version),rules=VALUES(rules),active=1,updated=VALUES(updated)')
  .bind(uid,variant,V.rules.startEquity,toSql(now),V.rulesVersion,rulesJson(V,acc?.sweep??undefined),toSql(now)).run();
 await addLog(d,uid,now,`Simulace ${variant} restartována: ${V.rules.startEquity.toLocaleString('cs-CZ')} Kč, pravidla ${V.rulesVersion}.`,variant);
}

// pohled pro API, graf i shrnutí: otevřené pozice přeceněné živou cenou (mid ∓ ½ spread)
export type Quotes=Record<string,{price:number;marketTime:number}|undefined>;
export function withMarks(trades:PaperTrade[],quotes:Quotes){
 return trades.map(t=>{const q=t.closed===null?quotes[t.instrument]:undefined;return {...t,mark:q&&q.price>0?{...markToMarket(t,q.price),at:q.marketTime}:null}});
}
// stav všech variant z jednoho načtení (porovnání, týdenní souhrn, shrnutí pro AI)
export async function paperAll(d:Db,uid:string,quotes:Quotes){
 const [accounts,trades,equity]=await Promise.all([listAccounts(d,uid),listTrades(d,uid),equitySeries(d,uid)]);
 return variantsOf(accounts).map(V=>{
  const v=V.id,account=accounts.find(a=>a.variant===v)??null,mine=trades.filter(t=>(t.variant??'A')===v),eq=equity.filter(p=>p.variant===v).map(({t,equity})=>({t,equity}));
  const marked=withMarks(mine,quotes),open=marked.filter(t=>t.closed===null),closed=marked.filter(t=>t.closed!==null).sort((a,b)=>(b.closed??0)-(a.closed??0));
  const openPnl=open.reduce((s,t)=>s+(t.mark?.pnlCzk??0),0),start=account?.startEquity??PAPER_RULES.startEquity;
  return {variant:v,V,account,trades:mine,stats:paperStats(mine,start,openPnl,eq),equity:eq,open,closed};
 });
}
export async function paperView(d:Db,uid:string,quotes:Quotes,variant:VariantId='A'){
 const [all,log]=await Promise.all([paperAll(d,uid,quotes),listLog(d,uid,variant)]);
 const me=all.find(x=>x.variant===variant);
 if(!me)return null;
 const variants=all.map(({V,...x})=>({id:x.variant,name:V.name,kind:V.kind,rulesVersion:x.account?.rulesVersion??V.rulesVersion,started:x.account?.started??null,startEquity:x.account?.startEquity??V.rules.startEquity,stats:x.stats,equity:x.equity,sweep:x.account?.sweep??null}));
 return {variant,V:me.V,account:me.account,stats:me.stats,equity:me.equity,open:me.open,closed:me.closed,log,variants};
}
export async function paperSummary(d:Db,uid:string,quotes:Quotes){
 const [all,weekly]=await Promise.all([paperAll(d,uid,quotes),lastWeekly(d,uid).catch(()=>null)]);
 const parts=all.map(x=>paperSummaryMd({started:x.account?.started??null,stats:x.stats,open:x.open,closed:x.closed,variant:x.V}));
 return parts.join('\n')+(weekly?`\n## Poslední týdenní souhrn simulace (${toSql(weekly.at)} UTC)\n\n${weekly.text}\n`:'');
}
