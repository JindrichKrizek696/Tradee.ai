// Laboratoř · uložení odpovědi týdenního AI analytika (volá scripts/lab-analyst.py): nová poznámka vlastníka
// „Týdenní analýza agentů <datum>“ (lib/lab/store.ts createNote), obnova „Shrnutí pro AI“ a krátký e-mail „Analýza týdne“ JEN vlastníkovi.
// Týdenní souhrn (18:00) odchází dřív, než analytik doběhne (18:30) → verdikt jde druhým krátkým mailem.
// node --experimental-strip-types scripts/lab-analyst-save.mjs --file odpoved.md [--dry] [--no-mail] [--owner-email x@y]
import {readFileSync} from 'node:fs';
import {loadEnv,openDb,ownerId} from './lab-history.mjs';
import {analysisVerdict,analysisTitle} from '../lib/lab/agents-report.ts';

const args=process.argv.slice(2),dry=args.includes('--dry'),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
const file=opt('--file');if(!file){console.error('lab-analyst-save: chybí --file');process.exit(1)}
const body=readFileSync(file,'utf8').trim();
if(body.length<40){console.error('lab-analyst-save: odpověď je prázdná nebo moc krátká – nic neukládám');process.exit(1)}
const now=Date.now(),title=analysisTitle(now),verdict=analysisVerdict(body);
if(dry){console.log(title,'\nVERDIKT:',verdict,'\n',body.length,'znaků');process.exit(0)}
const env=loadEnv('.auth.env','.mariadb.env','.notify.env');
const d=await openDb(env),owner=await ownerId(d,env,opt('--owner-email'));
if(!owner){console.error('lab-analyst-save: vlastník nenalezen');process.exit(1)}
const {createNote,refreshSummary}=await import('../lib/lab/store.ts');
const {LAB_LIMITS}=await import('../lib/lab/core.ts');
const id=await createNote(d,owner.id,{title,body:body.slice(0,LAB_LIMITS.body),tags:['agenti','analyza','ai']});
try{await refreshSummary(d,owner.id)}catch(e){console.error('lab-analyst-save: shrnutí pro AI',e.message)}
let mail=false;
if(!args.includes('--no-mail')&&env.RESEND_API_KEY){
 const esc=s=>String(s).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
 const html=`<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1b2a5a;max-width:640px"><h2 style="font-size:18px;margin:0 0 12px">Analýza týdne – agenti</h2><p style="white-space:pre-wrap">${esc(verdict)}</p><p><a href="https://tradee.eu/laborator#agents">Celá analýza v Laboratoři → Agenti</a></p><p style="font-size:12px;color:#777">Napsal AI analytik (Claude) jen z týdenního reportu; nic sám nemění.</p></div>`;
 try{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
  body:JSON.stringify({from:env.MAIL_FROM||'Tradee <info@dejny.eu>',to:[owner.email],subject:'Analýza týdne: '+verdict.slice(0,90),html,text:verdict+'\n\nCelá analýza: https://tradee.eu/laborator#agents'})});mail=r.ok;if(!r.ok)console.log('mail HTTP',r.status)}catch(e){console.log('mail chyba',e?.name||'neznámá')}
}
console.log(`lab-analyst-save: poznámka ${id} „${title}“, mail ${mail?'odeslán':'ne'}`);
process.exit(0);
