// Čisté funkce upozornění na výzvy ke zdůvodnění: text push a mailu, odložení mailu (bez DB a bez sítě).
export type NotifyItem={id:number;tradeId:string;rule:string;detail?:Record<string,unknown>;trade:{symbol:string;net:number|null;currency:string|null}};
export const SITE='https://tradee.eu';
export const linkFor=(tradeId:string)=>`${SITE}/#journaling/${encodeURIComponent(tradeId)}`;
const esc=(s:unknown)=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const plural=(n:number,[one,few,many]:readonly [string,string,string])=>n===1?one:n>=2&&n<=4?few:many;
const SIGN:Record<string,string>={USD:'$',EUR:'€',CZK:'Kč',GBP:'£'};
const money=(n:number,cur:string|null)=>(n>0?'+':'')+n.toLocaleString('cs-CZ',{minimumFractionDigits:0,maximumFractionDigits:2})+' '+(cur?SIGN[cur]||cur:'');
/** Věta „co se stalo“ podle pravidla (shodně s oknem ve výzvě). */
export const ruleBody=(v:Pick<NotifyItem,'rule'|'trade'>)=>v.rule==='no_early_close'?`Zavřel jsi ${v.trade.symbol} dřív – proč?`:v.rule==='no_sl_widen'?`Posunul jsi SL u ${v.trade.symbol} proti sobě – proč?`:`Porušil jsi pravidlo u ${v.trade.symbol} – proč?`;
export const ruleLabel=(rule:string)=>rule==='no_early_close'?'Zavřeno dřív než SL/TP':rule==='no_sl_widen'?'SL posunut proti sobě':'Porušené pravidlo';
export function pushPayload(v:NotifyItem){return {title:'Tradee · zdůvodni obchod',body:ruleBody(v),url:linkFor(v.tradeId),tag:'v'+v.id}}
export function mailSubject(n:number){return `Tradee: ${n} ${plural(n,['obchod čeká','obchody čekají','obchodů čeká'])} na zdůvodnění`}
export function mailContent(name:string,items:NotifyItem[]){
 const subject=mailSubject(items.length),hi=name.trim()?`Ahoj ${name.trim().split(/\s+/)[0]},`:'Ahoj,';
 const result=(i:NotifyItem)=>i.trade.net===null||i.trade.net===undefined?'':money(i.trade.net,i.trade.currency);
 const intro=items.length===1?'jeden obchod čeká na tvoje zdůvodnění:':`${items.length} ${plural(items.length,['obchod','obchody','obchodů'])} čeká na tvoje zdůvodnění:`;
 const foot='Upozornění vypneš v Tradee v menu u avataru.';
 const text=[hi,'',intro,'',...items.map(i=>`- ${i.trade.symbol}${result(i)?' ('+result(i)+')':''} – ${ruleLabel(i.rule)}\n  ${linkFor(i.tradeId)}`),'',foot].join('\n');
 const li=items.map(i=>`<li style="margin:0 0 12px"><b>${esc(i.trade.symbol)}</b>${result(i)?` <span style="color:#555">(${esc(result(i))})</span>`:''}<br><span style="color:#555">${esc(ruleLabel(i.rule))}</span><br><a href="${esc(linkFor(i.tradeId))}" style="color:#245bff">Zdůvodnit v Tradee</a></li>`).join('');
 const html=`<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1b2a5a;max-width:520px"><p>${esc(hi)}</p><p>${esc(intro)}</p><ul style="padding-left:18px">${li}</ul><p style="font-size:12px;color:#777">${esc(foot)}</p></div>`;
 return {subject,html,text};
}
/** Mail smí odejít, jen když od posledního uběhla aspoň hodina (lastMail = čas v ms nebo null). */
export const dueForMail=(lastMail:number|null,now:number)=>lastMail===null||now-lastMail>=3600000;
const PUSH_HOSTS=['fcm.googleapis.com','updates.push.services.mozilla.com','push.services.mozilla.com','push.apple.com','notify.windows.com','web.push.apple.com'];
/** Ověří adresu odběru Web Push (ochrana proti SSRF: skript na VPS na ni posílá POST). Vrací normalizovanou adresu, nebo null. */
export function pushEndpoint(v:unknown):string|null{
 if(typeof v!=='string'||v.length>512)return null;
 let u:URL;try{u=new URL(v)}catch{return null}
 if(u.protocol!=='https:'||u.username||u.password||u.port!=='')return null;
 const h=u.hostname.toLowerCase().replace(/\.$/,'');
 if(!PUSH_HOSTS.some(s=>h===s||h.endsWith('.'+s)))return null;
 return u.href.length>512?null:u.href;
}
