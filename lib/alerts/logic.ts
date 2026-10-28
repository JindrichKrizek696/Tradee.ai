// Cenové alerty – čisté funkce bez DB a sítě: validace vstupu, vyhodnocení podmínky (překřížení z poslední ceny, špičky z 1m svíček),
// cooldown / jednorázovost / expirace, texty push a mailu. Testy: node --experimental-strip-types scripts/check-alerts.mjs
export const KINDS=['above','below','touch','pct','score'] as const;
export type Kind=typeof KINDS[number];
export type Channel='push'|'mail';
export const MAX_ACTIVE=50,COOLDOWN_MIN=15,COOLDOWN_MAX=1440,NOTE_MAX=500;
/** Tolerance „dotyku“ relativně k úrovni (0,01 % ≈ 1 pip u EUR/USD). */
export const TOUCH_TOL=1e-4;
export const PRICE_KINDS:readonly Kind[]=['above','below','touch'];
export type Alert={id:string;userId:string;instrument:string;kind:Kind;level:number|null;pct:number|null;op:string|null;note:string|null;cooldownMin:number|null;expiresAt:number|null;channels:Channel[];active:boolean;ended:'triggered'|'expired'|null;lastPrice:number|null;lastChecked:number|null;lastTriggered:number|null;created:number;updated:number};
export type AlertInput=Pick<Alert,'instrument'|'kind'|'level'|'pct'|'op'|'note'|'cooldownMin'|'expiresAt'|'channels'|'active'>;
/** 1m svíčka zúžená na čas začátku (ms) a extrémy. */
export type Bar={t:number;h:number;l:number};
export type Quote={price:number;prevClose:number|null;marketTime:number;bars:Bar[]};
export type Status='active'|'paused'|'triggered'|'expired';

const r4=(n:number)=>Math.round(n*1e4)/1e4;
export const changePct=(price:number,prev:number|null)=>prev&&prev>0&&Number.isFinite(price)?r4((price/prev-1)*100):null;
export const isPriceKind=(k:Kind)=>PRICE_KINDS.includes(k);

// ---------- formát
const nf=(v:number,min:number,max:number)=>v.toLocaleString('cs-CZ',{minimumFractionDigits:min,maximumFractionDigits:max});
/** Cena pro texty: FX 4–5 desetinných (JPY 3), jinak podle velikosti. */
export function fmtLevel(instrument:string,v:number){
 if(/^[A-Z]{3}\/[A-Z]{3}$/.test(instrument))return instrument.endsWith('JPY')?nf(v,3,3):nf(v,4,5);
 const a=Math.abs(v);return a<10?nf(v,2,5):a<1000?nf(v,2,2):nf(v,0,2);
}
const signed=(v:number,d=2)=>(v>0?'+':v<0?'−':'')+nf(Math.abs(v),0,d);
/** Popis podmínky: „EUR/USD nad 1,1250“, „Bitcoin dnes ≥ +3 %“, „EUR/USD skóre pod −20“. */
export function conditionLabel(a:Pick<Alert,'instrument'|'kind'|'level'|'pct'|'op'>,name:string){
 const L=a.level??0;
 switch(a.kind){
  case 'above':return `${name} nad ${fmtLevel(a.instrument,L)}`;
  case 'below':return `${name} pod ${fmtLevel(a.instrument,L)}`;
  case 'touch':return `${name} na ${fmtLevel(a.instrument,L)}`;
  case 'pct':return `${name} dnes ${a.op==='lte'?'≤':'≥'} ${signed(a.pct??0)} %`;
  case 'score':return `${name} skóre ${a.op==='below'?'pod':'nad'} ${signed(L,1)}`;
 }
}
export const slugOf=(id:string)=>id.replace(/\//g,'-');
export const SITE='https://tradee.eu';
/** Odkaz z upozornění: graf trhu, u měnového indexu (nemá graf) analýza trhů. */
export const alertLink=(instrument:string,group?:string)=>group==='currency'?SITE+'/#analyzer':SITE+'/graf/'+encodeURIComponent(slugOf(instrument));
/** Hodnota v textu u spuštění: cena, % změna nebo skóre. */
export function valueText(a:Pick<Alert,'instrument'|'kind'>,v:number){return a.kind==='pct'?signed(v)+' %':a.kind==='score'?signed(v,1):fmtLevel(a.instrument,v)}

// ---------- stav
export function statusOf(a:Pick<Alert,'active'|'ended'|'expiresAt'>,now:number):Status{
 if(a.active)return a.expiresAt!==null&&now>=a.expiresAt?'expired':'active';
 return a.ended==='triggered'?'triggered':a.ended==='expired'?'expired':'paused';
}
export const STATUS_LABEL:Record<Status,string>={active:'Aktivní',paused:'Pozastavený',triggered:'Spuštěný',expired:'Vypršelý'};

// ---------- validace
const num=(v:unknown)=>typeof v==='number'?v:typeof v==='string'&&v.trim()!==''?Number(v.replace(',','.').replace(/\s/g,'')):NaN;
export type Ctx={known:(id:string)=>string|null;/** skupina trhu nebo null = neznámý */price?:number|null;score?:number|null;changePct?:number|null;pushAvailable?:boolean;now:number};
/** Ověří a znormalizuje vstup (POST celý, PATCH sloučený se stávajícím). Chyba = throw Error s českou hláškou; varování vrací. */
export function validateAlert(raw:unknown,ctx:Ctx):{value:AlertInput;warnings:string[]}{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Neplatný alert.');
 const o=raw as Record<string,unknown>,warnings:string[]=[];
 const instrument=typeof o.instrument==='string'?o.instrument:'',group=ctx.known(instrument);
 if(!group)throw Error('Neznámý trh.');
 const kind=o.kind as Kind;if(!KINDS.includes(kind))throw Error('Neznámý typ alertu.');
 if(group==='currency'&&kind!=='score')throw Error('U měnového indexu jde nastavit jen alert na skóre.');
 let level:number|null=null,pct:number|null=null,op:string|null=null;
 if(isPriceKind(kind)){
  level=num(o.level);
  if(!Number.isFinite(level))throw Error('Zadej cenu (číslo).');
  if(level<=0||level>=1e9)throw Error('Cena musí být kladné číslo.');
  const p=ctx.price;
  if(p&&p>0){
   const dist=Math.abs(level/p-1);
   if(level>p*10||level<p/10)warnings.push(`Úroveň ${fmtLevel(instrument,level)} je řádově jinde než aktuální cena ${fmtLevel(instrument,p)} – nespletl ses?`);
   else if(dist>.5)warnings.push(`Úroveň je ${nf(dist*100,0,0)} % od aktuální ceny – zkontroluj, jestli je správně.`);
   if(kind==='above'&&p>=level)warnings.push('Cena už je nad touto úrovní – alert se spustí, až klesne pod ni a znovu ji překročí.');
   if(kind==='below'&&p<=level)warnings.push('Cena už je pod touto úrovní – alert se spustí, až vystoupá nad ni a znovu ji prorazí.');
  }
 }else if(kind==='pct'){
  pct=num(o.pct);op=o.op==='lte'?'lte':o.op==='gte'?'gte':null;
  if(!op)throw Error('Vyber ≥ nebo ≤.');
  if(!Number.isFinite(pct))throw Error('Zadej procenta (číslo).');
  if(Math.abs(pct)>50)throw Error('Denní změna musí být mezi −50 a +50 %.');
  if(Math.abs(pct)<.01)throw Error('Zadej nenulovou změnu v %.');
  const c=ctx.changePct;if(c!==null&&c!==undefined&&(op==='gte'?c>=pct:c<=pct))warnings.push('Podmínka už dnes platí – alert se spustí při příští kontrole.');
 }else{
  level=num(o.level);op=o.op==='below'?'below':o.op==='above'?'above':null;
  if(!op)throw Error('Vyber nad nebo pod.');
  if(!Number.isFinite(level))throw Error('Zadej skóre (číslo).');
  if(level<-100||level>100)throw Error('Skóre je v rozsahu −100 až +100.');
  const s=ctx.score;if(s!==null&&s!==undefined&&(op==='above'?s>=level:s<=level))warnings.push(`Skóre už je ${op==='above'?'nad':'pod'} touto hranicí – alert se spustí až po novém překřížení.`);
 }
 let note:string|null=null;
 if(o.note!==undefined&&o.note!==null){if(typeof o.note!=='string')throw Error('Poznámka musí být text.');note=o.note.trim().slice(0,NOTE_MAX)||null}
 let cooldownMin:number|null=null;
 if(o.cooldownMin!==undefined&&o.cooldownMin!==null&&o.cooldownMin!==''){
  const c=num(o.cooldownMin);
  if(!Number.isInteger(c)||c<COOLDOWN_MIN||c>COOLDOWN_MAX)throw Error('Opakování: odstup 15 minut až 24 hodin.');
  cooldownMin=c;
 }
 let expiresAt:number|null=null;
 if(o.expiresAt!==undefined&&o.expiresAt!==null&&o.expiresAt!==''){
  const t=typeof o.expiresAt==='number'?o.expiresAt:typeof o.expiresAt==='string'?Date.parse(o.expiresAt):NaN;
  if(!Number.isFinite(t))throw Error('Neplatné datum vypršení.');
  if(t<=ctx.now)throw Error('Datum vypršení musí být v budoucnosti.');
  if(t>ctx.now+2*366*86400000)throw Error('Vypršení nejdéle za dva roky.');
  expiresAt=Math.floor(t/1000)*1000;
 }
 let channels:Channel[];
 if(o.channels===undefined||o.channels===null)channels=ctx.pushAvailable?['push','mail']:['mail'];
 else{
  if(!Array.isArray(o.channels))throw Error('Neplatné kanály.');
  channels=(['push','mail'] as const).filter(c=>(o.channels as unknown[]).includes(c));
  if(!channels.length)throw Error('Vyber aspoň jeden kanál (push nebo e-mail).');
 }
 if(channels.includes('push')&&ctx.pushAvailable===false)warnings.push('Push na žádném zařízení nemáš zapnutý – zapni ho v Nastavení → Upozornění, jinak dorazí jen e-mail.');
 const active=o.active===undefined?true:o.active===true;
 return {value:{instrument,kind,level,pct,op,note,cooldownMin,expiresAt,channels,active},warnings};
}

// ---------- vyhodnocení
/** 1m svíčky od poslední kontroly (s rezervou na svíčku, která tehdy běžela). */
export function barsSince(bars:Bar[],since:number|null):Bar[]{if(since===null)return [];return bars.filter(b=>b.t>=since-60000&&Number.isFinite(b.h)&&Number.isFinite(b.l))}
/** Pozorovaná hodnota pro alert: cena (+ extrémy svíček od poslední kontroly), % změna dnes nebo skóre. null = není co hodnotit. */
export function observe(a:Pick<Alert,'kind'|'lastChecked'>,q:Quote|null,score:number|null):{value:number;hi:number|null;lo:number|null}|null{
 if(a.kind==='score')return score===null||!Number.isFinite(score)?null:{value:score,hi:null,lo:null};
 if(!q||!(q.price>0))return null;
 if(a.kind==='pct'){const c=changePct(q.price,q.prevClose);return c===null?null:{value:c,hi:null,lo:null}}
 const bs=barsSince(q.bars,a.lastChecked);
 return {value:q.price,hi:bs.length?Math.max(...bs.map(b=>b.h)):null,lo:bs.length?Math.min(...bs.map(b=>b.l)):null};
}
/** Splněno? Vrací cenu/hodnotu pro zprávu, nebo null. prev = hodnota z poslední kontroly (null = první kontrola). */
export function hit(a:Pick<Alert,'kind'|'level'|'pct'|'op'>,prev:number|null,o:{value:number;hi:number|null;lo:number|null}):number|null{
 const cur=o.value,H=Math.max(cur,o.hi??cur),L=Math.min(cur,o.lo??cur),lv=a.level??NaN;
 switch(a.kind){
  // překřížení: minule pod úrovní, teď (nebo špička svíčky mezi kontrolami) na ní / nad ní; první kontrola nic nespouští
  case 'above':return prev!==null&&prev<lv&&H>=lv?(cur>=lv?cur:H):null;
  case 'below':return prev!==null&&prev>lv&&L<=lv?(cur<=lv?cur:L):null;
  case 'touch':{const tol=Math.abs(lv)*TOUCH_TOL;
   if(prev===null)return Math.abs(cur-lv)<=tol?cur:null;
   return Math.min(L,prev)-tol<=lv&&lv<=Math.max(H,prev)+tol?(Math.abs(cur-lv)<=tol?cur:lv):null}
  // % změna: hrana „nesplněno → splněno“ (i hned po založení, když už platí)
  case 'pct':{const ok=(v:number)=>a.op==='lte'?v<=(a.pct as number):v>=(a.pct as number);return ok(cur)&&(prev===null||!ok(prev))?cur:null}
  case 'score':return prev===null?null:a.op==='below'?(prev>lv&&cur<=lv?cur:null):(prev<lv&&cur>=lv?cur:null);
 }
}
export const inCooldown=(a:Pick<Alert,'lastTriggered'|'cooldownMin'>,now:number)=>a.lastTriggered!==null&&a.cooldownMin!==null&&now-a.lastTriggered<a.cooldownMin*60000;
export type Step={id:string;action:'expire'}|{id:string;action:'skip';reason:string}|{id:string;action:'update';value:number}|{id:string;action:'trigger';value:number;price:number;oneShot:boolean};
/** Rozhodnutí pro jeden alert v jednom běhu. open = je trh otevřený (krypto vždy; skóre se neptá). */
export function decide(a:Alert,q:Quote|null,score:number|null,now:number,open:boolean):Step{
 if(!a.active)return {id:a.id,action:'skip',reason:'neaktivní'};
 if(a.expiresAt!==null&&now>=a.expiresAt)return {id:a.id,action:'expire'};
 if(a.kind!=='score'&&!open)return {id:a.id,action:'skip',reason:'trh zavřený'};
 const o=observe(a,q,score);if(!o)return {id:a.id,action:'skip',reason:'bez dat'};
 const v=hit(a,a.lastPrice,o);
 if(v===null||inCooldown(a,now))return {id:a.id,action:'update',value:o.value};
 return {id:a.id,action:'trigger',value:o.value,price:v,oneShot:a.cooldownMin===null};
}

// ---------- zprávy
const esc=(s:unknown)=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export type Fired={id:string;instrument:string;name:string;group?:string;kind:Kind;level:number|null;pct:number|null;op:string|null;note:string|null;price:number;oneShot:boolean};
const what=(f:Fired)=>f.kind==='pct'?'Změna dnes':f.kind==='score'?'Skóre Tradee':'Cena';
export function pushPayload(f:Fired){
 const label=conditionLabel(f,f.name);
 return {title:'Tradee alert: '+label,body:`${what(f)} ${valueText(f,f.price)}${f.note?' · '+f.note:''}`,url:alertLink(f.instrument,f.group),tag:'alert-'+f.id,requireInteraction:true};
}
export function mailContent(userName:string,f:Fired){
 const label=conditionLabel(f,f.name),subject='Tradee alert: '+label,hi=userName.trim()?`Ahoj ${userName.trim().split(/\s+/)[0]},`:'Ahoj,',link=alertLink(f.instrument,f.group);
 const line=`${what(f)}: ${valueText(f,f.price)}`,after=f.oneShot?'Alert byl jednorázový, teď je vypnutý.':'Alert se opakuje, další upozornění nejdřív po uplynutí odstupu.';
 const foot='Alerty spravuješ na tradee.eu/alerty.';
 const text=[hi,'',`Spustil se tvůj alert: ${label}.`,line,...(f.note?['Poznámka: '+f.note]:[]),'',link,'',after,foot].join('\n');
 const html=`<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1b2a5a;max-width:520px"><p>${esc(hi)}</p><p>Spustil se tvůj alert: <b>${esc(label)}</b></p><p>${esc(line)}</p>${f.note?`<p style="color:#555">Poznámka: ${esc(f.note)}</p>`:''}<p><a href="${esc(link)}" style="color:#245bff">Otevřít v Tradee</a></p><p style="font-size:12px;color:#777">${esc(after)} ${esc(foot)}</p></div>`;
 return {subject,html,text};
}
