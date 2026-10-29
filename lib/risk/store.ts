// DB vrstva profilů účtů, registru instrumentů a přepisů brokera (Db je parametr, vše filtruje user_id). Tabulky z migrace 0037.
// Bez migrace (chybí tabulka) čtení vrací prázdné profily a výchozí instrumenty, zápis srozumitelnou chybu.
import type {Db} from '../mysql.ts';
import {nowSql} from '../mt/store.ts';
import {pragueDate} from '../mt/trades.ts';
import {mergeInstruments,rowToInstrument,type Instrument,type Override} from './instruments.ts';
import {accountStatus,balancePoints,normalizeRules,rulesAt,sameRules,PROFILE_LIMITS,type ClosedTrade,type Point,type ProfileInput,type ProfileKind,type RuleVersion,type Rules,type Status} from './account.ts';
const missing=(e:unknown)=>/doesn't exist|ER_NO_SUCH_TABLE|Unknown column/i.test(String((e as Error)?.message));
const prep=(e:unknown)=>missing(e)?Error('Profily účtů se na serveru teprve připravují. Zkus to prosím později.'):e;
const uid=()=>'acp_'+crypto.randomUUID().replace(/-/g,'').slice(0,24);
export async function listInstruments(d:Db):Promise<Instrument[]>{
 let rows:Instrument[]=[];
 try{rows=(await d.prepare('SELECT * FROM instruments').all<Record<string,unknown>>()).results.map(rowToInstrument).filter((x):x is Instrument=>x!==null)}catch(e){if(!missing(e))throw e}
 return mergeInstruments(rows);
}
export type Profile={id:string;name:string;kind:ProfileKind;currency:string;startBalance:number;startDate:string;balance:number|null;linkId:string|null;feeChallenge:number|null;feeActivation:number|null;archived:boolean;versions:RuleVersion[];rules:Rules;overrides:Record<string,Override>};
type Row={id:string;name:string;kind:string;currency:string;start_balance:number;start_date:string;balance:number|null;link_id:string|null;fee_challenge:number|null;fee_activation:number|null;archived:number};
const n=(v:unknown)=>v===null||v===undefined?null:Number(v);
const ovFromRow=(r:Record<string,unknown>):Override=>{const o:Override={};
 for(const [k,c] of [['tickSize','tick_size'],['tickValue','tick_value'],['contractSize','contract_size'],['lotStep','lot_step'],['minLot','min_lot'],['commission','commission'],['spread','spread']] as const){const v=n(r[c]);if(v!==null)o[k]=v}
 if(r.broker_symbol)o.brokerSymbol=String(r.broker_symbol);return o};
export async function listProfiles(d:Db,userId:string,today=pragueDate(Date.now())):Promise<Profile[]>{
 let rows:Row[];
 try{rows=(await d.prepare('SELECT id,name,kind,currency,start_balance,start_date,balance,link_id,fee_challenge,fee_activation,archived FROM account_profiles WHERE user_id=? ORDER BY archived,created,id').bind(userId).all<Row>()).results}catch(e){if(missing(e))return [];throw e}
 if(!rows.length)return [];
 const vers=(await d.prepare('SELECT profile_id,effective,rules,created FROM account_rule_versions WHERE user_id=? ORDER BY effective,id').bind(userId).all<{profile_id:string;effective:string;rules:string;created:string}>()).results;
 const ovs=(await d.prepare('SELECT * FROM instrument_overrides WHERE user_id=?').bind(userId).all<Record<string,unknown>>()).results;
 return rows.map(r=>{
  const versions:RuleVersion[]=vers.filter(v=>v.profile_id===r.id).map(v=>{let raw:unknown=null;try{raw=JSON.parse(v.rules)}catch{}return {effective:String(v.effective).slice(0,10),rules:normalizeRules(raw),created:String(v.created||'')}});
  const overrides:Record<string,Override>={};for(const o of ovs)if(o.profile_id===r.id)overrides[String(o.instrument_id)]=ovFromRow(o);
  return {id:r.id,name:r.name,kind:(['personal','challenge','funded'].includes(r.kind)?r.kind:'personal') as ProfileKind,currency:r.currency,startBalance:Number(r.start_balance),startDate:String(r.start_date).slice(0,10),balance:n(r.balance),linkId:r.link_id,feeChallenge:n(r.fee_challenge),feeActivation:n(r.fee_activation),archived:!!Number(r.archived),versions,rules:rulesAt(versions,today)??normalizeRules(null),overrides};
 });
}
// ---- data pro stav účtu
export type LinkedAccount={id:string;name:string;platform:string;currency:string;balance:number|null;equity:number|null};
export async function linkableAccounts(d:Db,userId:string):Promise<LinkedAccount[]>{
 return (await d.prepare('SELECT id,name,login,platform,currency,balance,equity FROM mt_accounts WHERE user_id=? ORDER BY created').bind(userId).all<{id:string;name:string;login:string;platform:string;currency:string;balance:number|null;equity:number|null}>()).results
  .map(a=>({id:a.id,name:a.name||'••••'+String(a.login).slice(-4),platform:a.platform,currency:a.currency,balance:n(a.balance),equity:n(a.equity)}));
}
const startTs=(date:string)=>Date.parse(date+'T00:00:00Z')-2*3600000; // s rezervou na zónu: obchody od půlnoci dne startu (i v Praze)
/** Uzavřené obchody, body zůstatku a aktuální zůstatek / equity profilu. */
export async function profileData(d:Db,userId:string,p:Pick<Profile,'linkId'|'startBalance'|'startDate'|'balance'>,accounts?:LinkedAccount[]):Promise<{balance:number;equity:number|null;points:Point[];trades:ClosedTrade[];source:'mt'|'trades'|'manual'}>{
 const from=startTs(p.startDate);
 if(p.linkId==='manual'){
  const trades=(await d.prepare("SELECT date,pnl FROM trades WHERE user_id=? AND date>=? AND NOT EXISTS(SELECT 1 FROM trade_meta m WHERE m.user_id=trades.user_id AND m.trade_id=CONCAT('man:',trades.id) AND m.mode='replay')").bind(userId,p.startDate).all<{date:string;pnl:number}>()).results.map(t=>({closeTs:Date.parse(String(t.date).slice(0,10)+'T12:00:00Z'),pnl:Number(t.pnl)}));
  const sum=trades.reduce((a,t)=>a+t.pnl,0);
  return {balance:p.balance??Math.round((p.startBalance+sum)*100)/100,equity:null,points:balancePoints(p.startBalance,trades),trades,source:'manual'};
 }
 const acc=p.linkId?(accounts??await linkableAccounts(d,userId)).find(a=>a.id===p.linkId):undefined;
 if(!acc)return {balance:p.balance??p.startBalance,equity:null,points:[],trades:[],source:'manual'};
 const trades=(await d.prepare("SELECT close_ts,net FROM mt_positions WHERE account_id=? AND status='closed' AND close_ts>=? ORDER BY close_ts").bind(acc.id,from).all<{close_ts:number;net:number}>()).results.map(t=>({closeTs:Number(t.close_ts),pnl:Number(t.net)}));
 const snaps=(await d.prepare('SELECT MAX(ts) AS ts,MAX(balance) AS bal,MAX(equity) AS hi,MIN(equity) AS lo FROM mt_snapshots WHERE account_id=? AND ts>=? GROUP BY ts DIV 3600000 ORDER BY 1').bind(acc.id,Math.max(from,Date.now()-400*86400000)).all<{ts:number;bal:number;hi:number;lo:number}>()).results;
 const sum=trades.reduce((a,t)=>a+t.pnl,0),calc=Math.round((p.startBalance+sum)*100)/100;
 if(snaps.length&&acc.balance!==null){
  // MT se snímky: hodinové body (max i min equity), zůstatek z EA
  const points:Point[]=snaps.flatMap(s=>[{ts:Number(s.ts),balance:Number(s.bal),equity:Number(s.hi)},{ts:Number(s.ts),balance:Number(s.bal),equity:Number(s.lo)}]);
  return {balance:acc.balance,equity:acc.equity,points,trades,source:'mt'};
 }
 return {balance:acc.balance??p.balance??calc,equity:acc.equity,points:balancePoints(p.startBalance,trades),trades,source:'trades'};
}
export async function profileStatus(d:Db,userId:string,p:Profile,accounts?:LinkedAccount[],now=Date.now()):Promise<Status&{source:string}>{
 const x=await profileData(d,userId,p,accounts);
 return {...accountStatus({rules:p.rules,start:p.startBalance,now,balance:x.balance,equity:x.equity,points:x.points,trades:x.trades}),source:x.source};
}
// ---- zápis
async function addVersion(d:Db,userId:string,profileId:string,effective:string,rules:Rules){
 const same=await d.prepare('SELECT id FROM account_rule_versions WHERE profile_id=? AND user_id=? AND effective=? ORDER BY id DESC LIMIT 1').bind(profileId,userId,effective).first<{id:number}>();
 if(same)await d.prepare('UPDATE account_rule_versions SET rules=?,created=? WHERE id=?').bind(JSON.stringify(rules),nowSql(),same.id).run();
 else await d.prepare('INSERT INTO account_rule_versions(profile_id,user_id,effective,rules,created) VALUES(?,?,?,?,?)').bind(profileId,userId,effective,JSON.stringify(rules),nowSql()).run();
}
async function checkLink(d:Db,userId:string,linkId:string|null,except?:string){
 if(!linkId)return;
 if(linkId!=='manual'&&!await d.prepare('SELECT id FROM mt_accounts WHERE id=? AND user_id=?').bind(linkId,userId).first())throw Error('Propojený účet nenalezen.');
 const clash=await d.prepare('SELECT id FROM account_profiles WHERE user_id=? AND link_id=? AND id<>?').bind(userId,linkId,except||'').first();
 if(clash)throw Error('Tento účet už má profil.');
}
export async function createProfile(d:Db,userId:string,v:ProfileInput):Promise<string>{
 try{
  const c=await d.prepare('SELECT COUNT(*) AS n FROM account_profiles WHERE user_id=?').bind(userId).first<{n:number}>();
  if(Number(c?.n||0)>=PROFILE_LIMITS.profiles)throw Error(`Nejvýš ${PROFILE_LIMITS.profiles} profilů.`);
  await checkLink(d,userId,v.linkId);
  const id=uid(),now=nowSql();
  await d.prepare('INSERT INTO account_profiles(id,user_id,name,kind,currency,start_balance,start_date,balance,link_id,fee_challenge,fee_activation,archived,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?)').bind(id,userId,v.name,v.kind,v.currency,v.startBalance,v.startDate,v.balance,v.linkId,v.feeChallenge,v.feeActivation,now,now).run();
  await addVersion(d,userId,id,v.startDate<v.effective?v.startDate:v.effective,v.rules);
  return id;
 }catch(e){throw prep(e)}
}
/** Uloží profil; změněná pravidla = nová verze s datem účinnosti (stejné datum přepíše). false = cizí / neexistuje. */
export async function updateProfile(d:Db,userId:string,id:string,v:ProfileInput,archived?:boolean):Promise<boolean>{
 try{
  const own=(await listProfiles(d,userId,v.effective)).find(p=>p.id===id);if(!own)return false;
  await checkLink(d,userId,v.linkId,id);
  await d.prepare('UPDATE account_profiles SET name=?,kind=?,currency=?,start_balance=?,start_date=?,balance=?,link_id=?,fee_challenge=?,fee_activation=?,archived=?,updated=? WHERE id=? AND user_id=?').bind(v.name,v.kind,v.currency,v.startBalance,v.startDate,v.balance,v.linkId,v.feeChallenge,v.feeActivation,archived===undefined?(own.archived?1:0):archived?1:0,nowSql(),id,userId).run();
  if(!sameRules(own.rules,v.rules))await addVersion(d,userId,id,v.effective,v.rules);
  return true;
 }catch(e){throw prep(e)}
}
export async function deleteProfile(d:Db,userId:string,id:string):Promise<boolean>{
 const own=await d.prepare('SELECT id FROM account_profiles WHERE id=? AND user_id=?').bind(id,userId).first().catch(e=>{throw prep(e)});
 if(!own)return false;
 await d.prepare('DELETE FROM instrument_overrides WHERE profile_id=? AND user_id=?').bind(id,userId).run();
 await d.prepare('DELETE FROM account_rule_versions WHERE profile_id=? AND user_id=?').bind(id,userId).run();
 await d.prepare('DELETE FROM account_profiles WHERE id=? AND user_id=?').bind(id,userId).run();
 return true;
}
/** Přepis brokera pro instrument v profilu; prázdný přepis ho smaže. */
export async function saveOverride(d:Db,userId:string,profileId:string,instrumentId:string,o:Override):Promise<boolean>{
 const own=await d.prepare('SELECT id FROM account_profiles WHERE id=? AND user_id=?').bind(profileId,userId).first().catch(e=>{throw prep(e)});
 if(!own)return false;
 if(!Object.keys(o).length){await d.prepare('DELETE FROM instrument_overrides WHERE profile_id=? AND instrument_id=? AND user_id=?').bind(profileId,instrumentId,userId).run();return true}
 await d.prepare('INSERT INTO instrument_overrides(user_id,profile_id,instrument_id,tick_size,tick_value,contract_size,lot_step,min_lot,commission,spread,broker_symbol,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE tick_size=VALUES(tick_size),tick_value=VALUES(tick_value),contract_size=VALUES(contract_size),lot_step=VALUES(lot_step),min_lot=VALUES(min_lot),commission=VALUES(commission),spread=VALUES(spread),broker_symbol=VALUES(broker_symbol),updated=VALUES(updated)')
  .bind(userId,profileId,instrumentId,o.tickSize??null,o.tickValue??null,o.contractSize??null,o.lotStep??null,o.minLot??null,o.commission??null,o.spread??null,o.brokerSymbol??null,nowSql()).run();
 return true;
}
// ---- disciplína: profil propojený s účtem (MT / T212)
export type AccountProfile={rules:Rules;start:number;startDate:string;versions:RuleVersion[]};
export async function profileForAccount(d:Db,userId:string,accountId:string):Promise<AccountProfile|null>{
 try{
  const r=await d.prepare('SELECT id,start_balance,start_date FROM account_profiles WHERE user_id=? AND link_id=? AND archived=0').bind(userId,accountId).first<{id:string;start_balance:number;start_date:string}>();
  if(!r)return null;
  const vers=(await d.prepare('SELECT effective,rules,created FROM account_rule_versions WHERE profile_id=? AND user_id=? ORDER BY effective,id').bind(r.id,userId).all<{effective:string;rules:string;created:string}>()).results
   .map(v=>{let raw:unknown=null;try{raw=JSON.parse(v.rules)}catch{}return {effective:String(v.effective).slice(0,10),rules:normalizeRules(raw),created:String(v.created||'')}});
  return {rules:rulesAt(vers,pragueDate(Date.now()))??normalizeRules(null),start:Number(r.start_balance),startDate:String(r.start_date).slice(0,10),versions:vers};
 }catch{return null}
}
/** zůstatek účtu na začátku dne z profilu: start + uzavřené obchody od startu do začátku dne */
export async function profileBalanceAt(d:Db,accountId:string,p:AccountProfile,dayStart:number):Promise<number|null>{
 try{
  const r=await d.prepare("SELECT COALESCE(SUM(net),0) AS s FROM mt_positions WHERE account_id=? AND status='closed' AND close_ts>=? AND close_ts<?").bind(accountId,startTs(p.startDate),dayStart).first<{s:number}>();
  return Math.round((p.start+Number(r?.s||0))*100)/100;
 }catch{return null}
}
// ---- přepočet měn: živé FX kurzy Tradee + poslední kurzy ECB
export async function fxContext(d:Db):Promise<{quotes:Record<string,number>;ecb:Record<string,number>}>{
 const quotes:Record<string,number>={},ecb:Record<string,number>={};
 try{for(const r of (await d.prepare("SELECT instrument,price FROM market_live WHERE instrument LIKE '___/___'").all<{instrument:string;price:number}>()).results)if(Number(r.price)>0)quotes[r.instrument]=Number(r.price)}catch(e){console.error('risk quotes',e)}
 try{for(const r of (await d.prepare('SELECT f.currency,f.per_eur FROM fx_rates f JOIN (SELECT currency,MAX(date) AS d FROM fx_rates GROUP BY currency) x ON x.currency=f.currency AND x.d=f.date').all<{currency:string;per_eur:number}>()).results)if(Number(r.per_eur)>0)ecb[r.currency]=Number(r.per_eur)}catch(e){console.error('risk ecb',e)}
 return {quotes,ecb};
}
