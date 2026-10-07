// Přepočítá pozice MT účtu z mt_events (po opravě skládání): node --experimental-strip-types scripts/mt-rebuild.mjs <account_id|--all>
import {readFileSync} from 'node:fs';
import {createDb} from '../lib/mysql.ts';
import {rebuildPositions} from '../lib/mt/store.ts';
const env=Object.fromEntries(readFileSync(new URL('../.mariadb.env',import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
const d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
const arg=process.argv[2];
if(!arg){console.error('Použití: mt-rebuild.mjs <account_id|--all>');process.exit(1)}
const accounts=arg==='--all'?(await d.prepare('SELECT id FROM mt_accounts').all()).results.map(r=>r.id):[arg];
for(const a of accounts){
 const ps=(await d.prepare('SELECT DISTINCT position FROM mt_events WHERE account_id=? AND position IS NOT NULL').bind(a).all()).results.map(r=>r.position);
 await rebuildPositions(d,a,ps);console.log(a,ps.length,'pozic přepočteno');
}
