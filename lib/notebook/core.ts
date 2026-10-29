// Poznámky (Notebook v Journalingu): vlastní složky uživatele a v nich papíry s volným textem. Čisté funkce – testy scripts/check-notebook.mjs.
export type Folder={id:string;name:string};
// kind: 'note' = volný papír, 'noday' = „Den bez obchodu“ (den bez obchodu se stavem dne z etapy 1A); day = den záznamu (YYYY-MM-DD)
export type NoteMeta={id:string;folderId:string;title:string;excerpt:string;instrument:string|null;created:string;updated:string;kind?:NoteKind;day?:string|null};
export type Note=Omit<NoteMeta,'excerpt'>&{body:string};
export type NotePatch={folderId?:string;title?:string;body?:string;instrument?:string|null};
export const NOTE_KINDS={note:'Papír',noday:'Den bez obchodu'} as const;
export type NoteKind=keyof typeof NOTE_KINDS;
/** Složka, do které se zakládají dny bez obchodu (založí se sama, když chybí). */
export const DAY_FOLDER='Deník dne';
const csDay=(day:string)=>{const [y,m,d]=day.split('-').map(Number);return `${d}. ${m}. ${y}`};
export const dayEntryTitle=(day:string)=>`Den bez obchodu · ${csDay(day)}`;
/** Šablona papíru dne bez obchodu: stav dne, poznámka a otázky na konec dne (nic nehodnotí, jen pomáhá zapsat). */
export function dayEntryBody(statusLabel:string|null,note:string){
 return [`Stav dne: ${statusLabel||'nevyplněn'}`,note?`Poznámka: ${note}`:'', '','Co jsem dnes sledoval a proč jsem neobchodoval:','','Co trh udělal (stalo se něco z mých scénářů?):','','Na co se zaměřit zítra:',''].filter((l,i)=>i>1||l!=='').join('\n');
}
export const LIMITS={folders:30,notes:1000,name:40,title:120,body:20000,excerpt:140};
// návrhy do prázdného stavu (Jindra: Analýza, Začátek týdne, Konec týdne; páry si každý založí sám)
export const SUGGESTED=['Analýza','Začátek týdne','Konec týdne'] as const;
// text nesmí obsahovat nic, co failed() v lib/server.ts schovává jako technickou chybu (ER_, mysql, MariaDB…)
export const MISSING_TABLES='Poznámky ještě nejsou na serveru zapnuté (chybí migrace databáze). Dej prosím vědět správci.';
const CTRL=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;// řídicí znaky kromě tabulátoru a konce řádku
const oneLine=(s:string)=>s.replace(CTRL,'').replace(/\s+/g,' ').trim();
const lower=(s:string)=>s.toLocaleLowerCase('cs');
// název složky: jeden řádek, 1 až LIMITS.name znaků; jinak text chyby
export function cleanFolderName(v:unknown):string|{error:string}{
 const n=typeof v==='string'?oneLine(v):'';
 if(!n)return {error:'Zadej název složky.'};
 if(n.length>LIMITS.name)return {error:`Název složky může mít nejvýš ${LIMITS.name} znaků.`};
 return n;
}
// stejný název bez ohledu na velikost písmen (vlastní složka exceptId se nepočítá)
export const nameTaken=(folders:readonly Folder[],name:string,exceptId?:string)=>folders.some(f=>f.id!==exceptId&&lower(f.name)===lower(name));
export const suggestions=(folders:readonly Folder[])=>SUGGESTED.filter(s=>!nameTaken(folders,s));
// vstup z UI → očištěná změna papíru (jen poslaná pole), nebo text chyby; create=true doplní prázdný název a text
export function validateNote(v:unknown,ids:readonly string[],create=false):NotePatch|{error:string}{
 const o=v as {folderId?:unknown;title?:unknown;body?:unknown;instrument?:unknown}|null;
 if(!o||typeof o!=='object'||Array.isArray(o))return {error:'Neplatný papír.'};
 const out:NotePatch={};
 if(o.folderId!==undefined||create){if(typeof o.folderId!=='string'||!/^[\w-]{1,40}$/.test(o.folderId))return {error:'Chybí složka.'};out.folderId=o.folderId}
 if(o.title!==undefined||create){
  const t=o.title===undefined?'':o.title;if(typeof t!=='string')return {error:'Název musí být text.'};
  const s=oneLine(t);if(s.length>LIMITS.title)return {error:`Název může mít nejvýš ${LIMITS.title} znaků.`};out.title=s;
 }
 if(o.body!==undefined||create){
  const b=o.body===undefined?'':o.body;if(typeof b!=='string')return {error:'Text musí být text.'};
  const s=b.replace(/\r\n?/g,'\n').replace(CTRL,'');if(s.length>LIMITS.body)return {error:`Papír může mít nejvýš ${LIMITS.body.toLocaleString('cs-CZ')} znaků.`};out.body=s;
 }
 if(o.instrument!==undefined){
  if(o.instrument===null||o.instrument==='')out.instrument=null;
  else if(typeof o.instrument==='string'&&ids.includes(o.instrument))out.instrument=o.instrument;
  else return {error:'Neznámý trh.'};
 }
 if(!Object.keys(out).length)return {error:'Není co uložit.'};
 return out;
}
// pořadí složek od klienta: unikátní id, nejvýš LIMITS.folders
export function cleanOrder(v:unknown):string[]|{error:string}{
 if(!Array.isArray(v)||v.length>LIMITS.folders||v.some(x=>typeof x!=='string'||!x||x.length>40)||new Set(v).size!==v.length)return {error:'Neplatné pořadí.'};
 return v as string[];
}
// náhled textu do seznamu: jeden řádek, nejvýš LIMITS.excerpt znaků
export function excerpt(body:string){const s=oneLine(body);return s.length>LIMITS.excerpt?s.slice(0,LIMITS.excerpt-1).trimEnd()+'…':s}
export const noteLabel=(n:{title:string})=>n.title.trim()||'Bez názvu';
// DATETIME v UTC z DB („2026-10-12 18:02:37“) → ms
export const sqlMs=(s:string)=>Date.parse(s.replace(' ','T')+'Z');
// nejnovější papír nahoře (podle založení, pak id)
export const sortNotes=<T extends {id:string;created:string}>(notes:readonly T[])=>[...notes].sort((a,b)=>a.created<b.created?1:a.created>b.created?-1:a.id<b.id?1:a.id>b.id?-1:0);
export function folderCounts(notes:readonly {folderId:string}[]){const c:Record<string,number>={};for(const n of notes)c[n.folderId]=(c[n.folderId]||0)+1;return c}
// chybí tabulky (migrace 0024_notebook.sql na serveru ještě neproběhla)
export function isMissingTable(e:unknown){const x=e as {code?:unknown;errno?:unknown;message?:unknown}|null;return !!x&&(x.code==='ER_NO_SUCH_TABLE'||x.errno===1146||/Table '[^']*notebook_[^']*' doesn't exist/i.test(String(x.message??'')))}
