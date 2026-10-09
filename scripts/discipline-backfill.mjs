// Jednorázové (a idempotentní) vyhodnocení pravidel disciplíny pro existující MT obchody: node --experimental-strip-types scripts/discipline-backfill.mjs [account_id|--all]
import {readFileSync} from 'node:fs';
import {createDb} from '../lib/mysql.ts';
import {evaluateAccount} from '../lib/discipline/store.ts';
import {highNews} from '../lib/discipline/news.ts';
const env=Object.fromEntries(readFileSync(new URL('../.mariadb.env',import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
const d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
const json=f=>JSON.parse(readFileSync(new URL('../data/'+f,import.meta.url),'utf8'));
const f=json('fundamentals.json'),news=highNews(json('calendar.json').events,f.events,f.sources);
const arg=process.argv[2]||'--all';
const accounts=(await d.prepare(arg==='--all'?'SELECT id,user_id FROM mt_accounts':'SELECT id,user_id FROM mt_accounts WHERE id=?').bind(...(arg==='--all'?[]:[arg])).all()).results;
for(const a of accounts){const r=await evaluateAccount(d,a.user_id,a.id,undefined,news);console.log(a.id,'pozic',r.evaluated,'přidáno',r.added,'smazáno',r.removed)}
