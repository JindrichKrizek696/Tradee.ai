// Laboratoř: historie týdenního COT z CFTC (Socrata) → tabulka lab_cot (jen pro studii signálů vlastníka).
// Měny: TFF Futures Only (gpe5-46if), skupiny leveraged + assetManagers. Komodity: Disaggregated Futures Only (72hh-3qpy),
// skupiny managedMoney + producers. Stejné kódy kontraktů jako scripts/refresh-score-data.py a refresh-expanded-data.py.
// Spuštění (VPS, jednou a pak klidně týdně): node --experimental-strip-types scripts/lab-cot-history.mjs [--dry] [--since 2006-01-01] [--owner-email x@y]
// Bez --owner-email se vlastník hledá podle OWNER_EMAIL v prostředí; user_id je jen pro jednotnost (data nejsou osobní).
import {readFileSync,existsSync} from 'node:fs';
const args=process.argv.slice(2),dry=args.includes('--dry'),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:undefined};
const since=opt('--since')||'2006-01-01';
const TFF={CAD:'090741',JPY:'097741',EUR:'099741',AUD:'232741',USD:'098662',NZD:'112741',GBP:'096742',CHF:'092741'};
const DISAGG={'GC=F':'088691','SI=F':'084691','CL=F':'067651'};
const TFF_GROUPS={leveraged:['lev_money_positions_long','lev_money_positions_short','lev_money_positions_spread'],assetManagers:['asset_mgr_positions_long','asset_mgr_positions_short','asset_mgr_positions_spread']};
const DIS_GROUPS={managedMoney:['m_money_positions_long_all','m_money_positions_short_all','m_money_positions_spread'],producers:['prod_merc_positions_long','prod_merc_positions_short',null]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function socrata(dataset,codes){
 const out=[];
 for(let offset=0;;offset+=50000){
  const q=new URLSearchParams({'$where':`cftc_contract_market_code in (${codes.map(c=>`'${c}'`).join(',')}) AND report_date_as_yyyy_mm_dd >= '${since}T00:00:00'`,'$order':'report_date_as_yyyy_mm_dd ASC','$limit':'50000','$offset':String(offset)});
  let rows;
  for(let a=0;;a++){try{const r=await fetch(`https://publicreporting.cftc.gov/resource/${dataset}.json?${q}`,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('HTTP '+r.status);rows=await r.json();break}catch(e){if(a>=3)throw e;await sleep(2000*2**a)}}
  if(!Array.isArray(rows))throw Error('CFTC: neočekávaná odpověď');
  out.push(...rows);if(rows.length<50000)return out;
 }
}
const int=v=>{const n=Number(v);return Number.isFinite(n)?Math.round(n):null};
function rowsFor(raw,map,groups){
 const out=[];
 for(const [market,code] of Object.entries(map))for(const r of raw.filter(r=>r.cftc_contract_market_code===code)){
  const date=String(r.report_date_as_yyyy_mm_dd||'').slice(0,10),oi=int(r.open_interest_all);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!oi||oi<=0)continue;
  for(const [grp,[l,s,sp]] of Object.entries(groups)){const L=int(r[l]),S=int(r[s]),SP=sp?int(r[sp])??0:0;if(L===null||S===null||L<0||S<0)continue;out.push({market,grp,date,code,oi,L,S,SP})}
 }
 return out;
}
const tff=rowsFor(await socrata('gpe5-46if',Object.values(TFF)),TFF,TFF_GROUPS);
const dis=rowsFor(await socrata('72hh-3qpy',Object.values(DISAGG)),DISAGG,DIS_GROUPS);
const all=[...tff,...dis];
const by=new Map();for(const r of all){const k=r.market+' '+r.grp;const v=by.get(k)||{n:0,first:r.date,last:r.date};v.n++;if(r.date<v.first)v.first=r.date;if(r.date>v.last)v.last=r.date;by.set(k,v)}
for(const [k,v] of by)console.log(k.padEnd(24),String(v.n).padStart(5),v.first,'→',v.last);
if(dry){console.log('dry: nic se neukládá,',all.length,'řádků');process.exit(0)}
const envFile=new URL('../.mariadb.env',import.meta.url);
if(!existsSync(envFile))throw Error('Chybí .mariadb.env');
const env=Object.fromEntries(readFileSync(envFile,'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
const {createDb}=await import('../lib/mysql.ts');
const d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
const ownerEmail=(opt('--owner-email')||process.env.OWNER_EMAIL||env.OWNER_EMAIL||'').trim().toLowerCase();
const owner=ownerEmail?await d.prepare('SELECT id FROM members WHERE LOWER(email)=?').bind(ownerEmail).first():null;
if(!owner)console.warn('Vlastník nenalezen (zadej --owner-email) – user_id zůstane prázdné, Laboratoř data i tak použije.');
const uid=owner?.id||'',now=new Date().toISOString().slice(0,19).replace('T',' ');
for(let i=0;i<all.length;i+=500){
 const ch=all.slice(i,i+500);
 await d.prepare('INSERT INTO lab_cot(user_id,market,grp,report_date,code,open_interest,long_pos,short_pos,spread_pos,fetched) VALUES '+ch.map(()=>'(?,?,?,?,?,?,?,?,?,?)').join(',')+' ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),code=VALUES(code),open_interest=VALUES(open_interest),long_pos=VALUES(long_pos),short_pos=VALUES(short_pos),spread_pos=VALUES(spread_pos),fetched=VALUES(fetched)')
  .bind(...ch.flatMap(r=>[uid,r.market,r.grp,r.date,r.code,r.oi,r.L,r.S,r.SP,now])).run();
}
console.log('lab_cot: uloženo',all.length,'řádků');
