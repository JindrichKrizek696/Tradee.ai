// DB dotazy administrace (Db jako parametr).
import type {Db} from '../mysql.ts';
import {personStatus,isOldEa} from './rules.ts';
export type Overview={users:{total:number;approved:number;pending:number;blocked:number;admins:number};mt:{accounts:number;online:number;trades1d:number;trades7d:number;trades30d:number};waitlist7d:number};
export type Person={email:string;name:string;created:string|null;status:'owner'|'pending'|'approved'|'blocked';role:string|null;lastLogin:string|null;mtAccounts:number;memberId:string|null;isOwner:boolean};
export type AdminMtAccount={id:string;ownerEmail:string;ownerName:string;memberId:string;platform:string;mode:string;company:string;server:string;login:string;eaVersion:string;oldEa:boolean;lastSeen:string|null;online:boolean;positions:number;open:number;currency?:string;balance?:number|null;equity?:number|null};
export type AuditRow={at:string;action:string;actor:string;target:string;detail:string};
const n=(v:unknown)=>Number(v||0);
const ONLINE_MIN=20,DAY=86400000;
export async function audit(d:Db,actorId:string,action:string,targetId:string,detail=''){
 await d.prepare('INSERT INTO admin_audit(actor_id,action,target_id,detail,at) VALUES(?,?,?,?,UTC_TIMESTAMP())').bind(actorId,action,targetId.slice(0,254),detail.slice(0,255)).run();
}
export async function overview(d:Db,owner:string,now=Date.now()):Promise<Overview>{
 const u=await d.prepare('SELECT COUNT(*) total,SUM(approved=1 AND blocked=0) approved,SUM(approved=0 AND blocked=0) pending,SUM(blocked=1) blocked,SUM(created>=NOW()-INTERVAL 7 DAY) w7 FROM waitlist WHERE LOWER(email)<>?').bind(owner).first<Record<string,unknown>>();
 const a=await d.prepare("SELECT COUNT(*) n FROM members WHERE role='admin'").first<{n:number}>();
 const m=await d.prepare(`SELECT COUNT(*) accounts,SUM(last_seen>=UTC_TIMESTAMP()-INTERVAL ${ONLINE_MIN} MINUTE) online FROM mt_accounts`).first<Record<string,unknown>>();
 const t=await d.prepare("SELECT SUM(close_ts>=?) d1,SUM(close_ts>=?) d7,SUM(close_ts>=?) d30 FROM mt_positions WHERE status='closed'").bind(now-DAY,now-7*DAY,now-30*DAY).first<Record<string,unknown>>();
 return {users:{total:n(u?.total)+(owner?1:0),approved:n(u?.approved),pending:n(u?.pending),blocked:n(u?.blocked),admins:n(a?.n)},mt:{accounts:n(m?.accounts),online:n(m?.online),trades1d:n(t?.d1),trades7d:n(t?.d7),trades30d:n(t?.d30)},waitlist7d:n(u?.w7)};
}
// waitlist i členové bez řádku ve waitlistu (starší účty); čekající nahoře
export async function people(d:Db,owner:string):Promise<Person[]>{
 const rows=(await d.prepare(`SELECT w.email,w.name,w.created,w.approved,w.blocked,m.id member_id,m.role,m.last_login,(SELECT COUNT(*) FROM mt_accounts a WHERE a.user_id=m.id) mt FROM waitlist w LEFT JOIN members m ON LOWER(m.email)=LOWER(w.email)
  UNION ALL SELECT m.email,m.name,NULL,0,0,m.id,m.role,m.last_login,(SELECT COUNT(*) FROM mt_accounts a WHERE a.user_id=m.id) FROM members m WHERE NOT EXISTS(SELECT 1 FROM waitlist w WHERE LOWER(w.email)=LOWER(m.email))`).all<Record<string,unknown>>()).results;
 const out=rows.map(r=>{const email=String(r.email),isOwner=!!owner&&email.toLowerCase()===owner;return {email,name:String(r.name||''),created:r.created?String(r.created):null,status:personStatus({approved:n(r.approved),blocked:n(r.blocked),isOwner}),role:r.role?String(r.role):null,lastLogin:r.last_login?String(r.last_login):null,mtAccounts:n(r.mt),memberId:r.member_id?String(r.member_id):null,isOwner}});
 const rank={pending:0,blocked:1,approved:2,owner:3};
 return out.sort((a,b)=>rank[a.status]-rank[b.status]||String(b.created||'').localeCompare(String(a.created||'')));
}
export async function personByEmail(d:Db,email:string){
 type P={email:string;approved:number;blocked:number;member_id:string|null};
 const w=await d.prepare('SELECT w.email,w.approved,w.blocked,m.id member_id FROM waitlist w LEFT JOIN members m ON LOWER(m.email)=LOWER(w.email) WHERE LOWER(w.email)=LOWER(?)').bind(email).first<P>();
 return w||d.prepare('SELECT m.email,0 approved,0 blocked,m.id member_id FROM members m WHERE LOWER(m.email)=LOWER(?)').bind(email).first<P>();
}
// člen bez řádku ve waitlistu: řádek se vytvoří (jméno z members)
const memberName="(SELECT name FROM members WHERE LOWER(email)=LOWER(?) LIMIT 1)";
export async function setApproved(d:Db,email:string){await d.prepare(`INSERT INTO waitlist(email,name,source,approved,approved_at,created) VALUES(?,${memberName},'admin',1,NOW(),NOW()) ON DUPLICATE KEY UPDATE approved=1,approved_at=COALESCE(approved_at,NOW())`).bind(email,email).run()}
export async function setBlocked(d:Db,email:string,blocked:boolean){await d.prepare(`INSERT INTO waitlist(email,name,source,approved,blocked,created) VALUES(?,${memberName},'admin',0,?,NOW()) ON DUPLICATE KEY UPDATE blocked=VALUES(blocked)`).bind(email,email,blocked?1:0).run()}
export async function setRole(d:Db,memberId:string,role:'admin'|'member'){await d.prepare('UPDATE members SET role=? WHERE id=?').bind(role,memberId).run()}
// zůstatek, equity a měnu jen pro vlastníka (ostatním se pole vůbec nepošlou)
export async function mtAccounts(d:Db,withMoney:boolean):Promise<AdminMtAccount[]>{
 const rows=(await d.prepare(`SELECT a.id,a.platform,a.mode,a.company,a.server,a.login,a.ea_version,a.last_seen,a.currency,a.balance,a.equity,a.user_id,m.email,m.name,
  a.last_seen>=UTC_TIMESTAMP()-INTERVAL ${ONLINE_MIN} MINUTE online,(SELECT COUNT(*) FROM mt_positions p WHERE p.account_id=a.id) positions,(SELECT COUNT(*) FROM mt_positions p WHERE p.account_id=a.id AND p.status='open') open
  FROM mt_accounts a LEFT JOIN members m ON m.id=a.user_id ORDER BY a.last_seen DESC`).all<Record<string,unknown>>()).results;
 return rows.map(r=>{const base:AdminMtAccount={id:String(r.id),ownerEmail:String(r.email||''),ownerName:String(r.name||''),memberId:String(r.user_id),platform:String(r.platform),mode:String(r.mode),company:String(r.company||''),server:String(r.server||''),login:'••••'+String(r.login).slice(-4),eaVersion:String(r.ea_version||''),oldEa:isOldEa(r.ea_version?String(r.ea_version):null),lastSeen:r.last_seen?String(r.last_seen):null,online:!!n(r.online),positions:n(r.positions),open:n(r.open)};
  return withMoney?{...base,currency:String(r.currency||''),balance:r.balance===null?null:Number(r.balance),equity:r.equity===null?null:Number(r.equity)}:base});
}
export async function auditLog(d:Db,limit=100):Promise<AuditRow[]>{
 return (await d.prepare(`SELECT a.at,a.action,a.detail,COALESCE(ma.email,a.actor_id) actor,COALESCE(mt.email,a.target_id) target FROM admin_audit a LEFT JOIN members ma ON ma.id=a.actor_id LEFT JOIN members mt ON mt.id=a.target_id ORDER BY a.id DESC LIMIT ${Math.max(1,Math.min(500,Math.floor(limit)))}`).all<Record<string,unknown>>()).results.map(r=>({at:String(r.at),action:String(r.action),actor:String(r.actor),target:String(r.target),detail:String(r.detail||'')}));
}
