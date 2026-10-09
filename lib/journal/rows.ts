// Řádky z DB → obchody deníku; validace vstupů z UI (čisté funkce).
import {convert,type Rates} from '../fx.ts';
import {pragueDate} from '../mt/trades.ts';
import type {JournalTrade,MtJournalRow,ManualJournalRow} from './types.ts';
const num=(v:unknown)=>v===null||v===undefined?null:Number(v);
const r2=(n:number)=>Math.round(n*100)/100;
export const splitTags=(...s:string[])=>[...new Set(s.join(',').split(',').map(t=>t.trim()).filter(Boolean))];
export function mtRowToTrade(r:MtJournalRow,currency:string,rates:Rates):JournalTrade{
 const close=Number(r.close_ts),open=Number(r.open_ts),date=pragueDate(close),net=Number(r.net),conv=convert(net,r.acc_currency,currency,date,rates),risk=num(r.risk_money);
 const perR=(v:number|null)=>v!==null&&risk!==null&&risk>0?r2(v/risk):null;
 return {id:'mt:'+r.id,source:'mt',accountId:r.account_id,account:r.acc_name||'••••'+String(r.acc_login).slice(-4),symbol:r.symbol,instrument:null,side:r.side==='sell'?'sell':'buy',openTs:open,closeTs:close,date,volume:Number(r.volume_max),net,accountCurrency:r.acc_currency,pnl:conv??net,converted:conv!==null,r:num(r.r_result),rr:num(r.rr_planned),riskPct:num(r.risk_pct),mfeR:perR(num(r.mfe_money)),maeR:perR(num(r.mae_money)),holdMs:Math.max(0,close-open),tags:splitTags(r.tags,r.tags_manual),hasNote:Number(r.has_note)>0,files:Number(r.files),checklist:null};
}
// ruční zápis: jen datum, trh, výsledek, poznámka; čas = poledne UTC daného dne (kvůli řazení)
export function manualRowToTrade(r:ManualJournalRow):JournalTrade{
 const date=String(r.date).slice(0,10);
 return {id:'man:'+r.id,source:'manual',accountId:'manual',account:'Ručně',symbol:r.instrument,instrument:null,side:null,openTs:null,closeTs:Date.parse(date+'T12:00:00Z'),date,volume:null,net:null,accountCurrency:null,pnl:Number(r.pnl),converted:true,r:null,rr:null,riskPct:null,mfeR:null,maeR:null,holdMs:null,tags:[],hasNote:!!r.note,files:0,checklist:null,note:r.note||''};
}
export function toJournalTrades(mt:MtJournalRow[],manual:ManualJournalRow[],currency:string,rates:Rates,checklists:Record<string,number|null>={}):JournalTrade[]{
 return [...mt.map(r=>mtRowToTrade(r,currency,rates)),...manual.map(manualRowToTrade)].map(t=>({...t,checklist:checklists[t.id]??null})).sort((a,b)=>b.closeTs-a.closeTs||a.id.localeCompare(b.id));
}
// ruční tagy: bez #, malá písmena, 2–30 znaků, max 10; neplatný tag = chyba (uživatel ho napsal)
export function cleanTags(v:unknown):string[]{
 if(!Array.isArray(v))throw new Error('Tagy musí být seznam.');
 const out=[...new Set(v.map(t=>typeof t==='string'?t.trim().replace(/^#/,'').toLowerCase():''))];
 if(out.length>10)throw new Error('Nejvýš 10 tagů na obchod.');
 for(const t of out)if(!/^[0-9a-zÀ-ɏ_-]{2,30}$/.test(t))throw new Error(`Tag „${t}": 2–30 znaků, jen písmena, číslice, _ nebo -.`);
 return out;
}
export function cleanNote(v:unknown,max:number):string{
 if(typeof v!=='string')throw new Error('Poznámka musí být text.');
 const s=v.trim();if(s.length>max)throw new Error(`Poznámka může mít nejvýš ${max} znaků.`);
 return s;
}
// id v URL: mt:<id pozice> nebo man:<id ručního zápisu>; přijme i zakódované (%3A)
export function parseJournalId(raw:string):{kind:'mt'|'man';id:string}|null{
 let s=raw;try{if(s.includes('%'))s=decodeURIComponent(s)}catch{return null}
 const m=s.match(/^(mt|man):(.+)$/);if(!m)return null;
 if(m[1]==='mt'&&/^[\w:.#-]{1,90}$/.test(m[2]))return {kind:'mt',id:m[2]};
 if(m[1]==='man'&&/^[\w-]{1,64}$/.test(m[2]))return {kind:'man',id:m[2]};
 return null;
}
export const MAX_FILE_BYTES=5*1024*1024,MAX_FILES=5,IMAGE_TYPES=['image/png','image/jpeg','image/webp'];
export function checkUpload(f:{type:string;size:number},existing:number):string|null{
 if(!IMAGE_TYPES.includes(f.type))return 'Nahraj obrázek PNG, JPEG nebo WebP.';
 if(!f.size)return 'Soubor je prázdný.';
 if(f.size>MAX_FILE_BYTES)return 'Obrázek může mít nejvýš 5 MB.';
 if(existing>=MAX_FILES)return 'K obchodu jde nahrát nejvýš 5 screenshotů.';
 return null;
}
