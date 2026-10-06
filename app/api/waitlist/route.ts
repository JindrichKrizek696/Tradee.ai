import {db,sameOrigin,failed} from '@/lib/server';
import {normalizeEmail,redirectTo} from '@/lib/auth';
// Veřejný zápis na waitlist. Opakovaný zápis je tichý úspěch, aby nešlo zjistit, kdo už na seznamu je; `web` je honeypot.
export async function POST(req:Request){
 const form=!(req.headers.get('content-type')||'').includes('application/json');
 const done=(stav:string)=>form?redirectTo('/?stav='+stav,[],303):stav==='zapsano'?Response.json({ok:true}):Response.json({error:stav==='neplatny'?'Zadej platný e-mail.':'Zápis se nepovedl, zkus to znovu.'},{status:400});
 try{
  sameOrigin(req);
  const b=form?Object.fromEntries((await req.formData()).entries()):await req.json() as Record<string,unknown>;
  if(typeof b.web==='string'&&b.web)return done('zapsano');
  const email=normalizeEmail(b.email);if(!email)return done('neplatny');
  await db().prepare("INSERT IGNORE INTO waitlist(email,source,approved,created) VALUES(?,'form',0,NOW())").bind(email).run();
  return done('zapsano');
 }catch(e){if(!form)return failed(e);console.error(e);return done('chyba')}
}
