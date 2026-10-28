// Vyhledávání v celém Tradee (lupa / Ctrl+K): skládání textu bez diakritiky, skóre shody a zvýraznění. Čisté funkce, testuje scripts/check-search.mjs.
export type Searchable={title:string;subtitle?:string;keywords?:string;boost?:number};

// po znacích (každý znak → jeden znak), aby indexy ve složeném textu seděly na originál při zvýraznění
const foldChar=(c:string)=>{const f=c.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();return f.length===1?f:c.toLowerCase().length===1?c.toLowerCase():c};
export const fold=(s:string)=>Array.from(s,foldChar).join('');
// slova pro hledání: písmena a číslice, ostatní (lomítka, tečky, pomlčky) dělí slova
export const words=(s:string)=>fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
export const compact=(s:string)=>words(s).join('');
export const tokens=(q:string)=>words(q).slice(0,8);

/** Skóre shody (0 = neodpovídá). Každé slovo dotazu musí sedět na začátek některého slova, nebo být ve spojeném textu (eurusd ~ EUR/USD). */
export function score(item:Searchable,q:string){
 const qs=tokens(q);if(!qs.length)return 0;
 const tw=words(item.title),tc=tw.join(''),qc=qs.join(''),rest=words((item.subtitle||'')+' '+(item.keywords||'')),all=[...tw,...rest];
 let s=0;
 if(tc===qc)s=100;
 else if(tc.startsWith(qc))s=85;
 else if(qs.every(t=>tw.some(w=>w.startsWith(t))))s=qs.length===1&&tw[0]?.startsWith(qs[0])?75:65;
 else if(qc.length>=3&&tc.includes(qc))s=55;
 else if(qs.every(t=>all.some(w=>w.startsWith(t))))s=40;
 else if(qs.every(t=>all.some(w=>w.includes(t)))||compact(rest.join(' ')).includes(qc))s=qc.length>=3?22:0;
 return s?s+(item.boost||0):0;
}

/** Seřadí shody: skóre, pak kratší název (přesnější), pak původní pořadí. byDate: při stejném skóre drží pořadí zdroje (obchody, události – podle data). */
export function rank<T extends Searchable>(items:T[],q:string,limit=Infinity,byDate=false):T[]{
 return items.map((it,i)=>({it,i,s:score(it,q)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s||(byDate?0:a.it.title.length-b.it.title.length)||a.i-b.i).slice(0,limit).map(x=>x.it);
}

/** Úseky názvu se zvýrazněním slov z dotazu (bez ohledu na diakritiku). */
export function highlight(text:string,q:string):{t:string;hit:boolean}[]{
 const f=fold(text),marks=new Array<boolean>(text.length).fill(false);
 for(const t of tokens(q)){let from=0,i;while((i=f.indexOf(t,from))>=0){const start=i===0||!/[\p{L}\p{N}]/u.test(f[i-1]);if(start){for(let k=i;k<i+t.length;k++)marks[k]=true;break}from=i+1}}
 const out:{t:string;hit:boolean}[]=[];
 for(let i=0;i<text.length;i++){const last=out[out.length-1];if(last&&last.hit===marks[i])last.t+=text[i];else out.push({t:text[i],hit:marks[i]})}
 return out;
}

// česká jména měn, ať najde „libra“, „jen“ nebo „euro“
export const CURRENCY_WORDS:Record<string,string>={USD:'americký dolar usa',EUR:'euro eurozóna',GBP:'britská libra británie',JPY:'japonský jen japonsko',CHF:'švýcarský frank švýcarsko',AUD:'australský dolar austrálie',NZD:'novozélandský dolar nový zéland',CAD:'kanadský dolar kanada'};
export const currencyWords=(id:string)=>(id.match(/[A-Z]{3}/g)||[]).map(c=>CURRENCY_WORDS[c]||'').join(' ');
// aliasy trhů (NQ, US100, XAUUSD, WTI, DXY…) – zdroj lib/instrument-info.ts
export {resolveAlias,aliasWords,suggestAliases,ALIASES,type Alias} from './instrument-info.ts';
