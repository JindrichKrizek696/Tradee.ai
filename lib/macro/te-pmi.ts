// PMI ze stránek Trading Economics (meta description). Čistá logika; kontrola: node --experimental-strip-types scripts/check-te-pmi.mjs
// Stahuje scripts/refresh-te-pmi.mjs (max. 2× denně, sekvenčně) → data/te-pmi.json.
//
// Meta description stránky má tvar „Manufacturing PMI in Japan decreased to 54.10 points in September from 54.90 points in August
// of 2026. This page provides the latest reported value for - Japan Manufacturing PMI - …“. Bere se hodnota, předchozí hodnota,
// měsíc a název řady (kontrola, že stránka je opravdu ta správná řada – viz `expect`).
// Období: nejbližší výskyt uvedeného měsíce, který není po měsíci stažení (rok z textu je u přelomu roku nejednoznačný).
export type TEPmiValue={value:number;previous:number|null;period:string;fetchedAt:string;url:string;publisher:string;series:string};
export type TEPmiCurrency={mpmi?:TEPmiValue;spmi?:TEPmiValue};
export type TEPmi={updated:string;currencies:Record<string,TEPmiCurrency>};
export type TEPage={currency:string;id:'mpmi'|'spmi';path:string;publisher:string;expect:RegExp};

export const TE_BASE='https://tradingeconomics.com/';
const M_RE=/Manufacturing PMI|ISM Purchasing Managers/i,S_RE=/Services PMI|Non[- ]Manufacturing PMI|Performance Services Index|Services Pmi/i;
export const TE_PAGES:TEPage[]=[
 {currency:'USD',id:'mpmi',path:'united-states/business-confidence',publisher:'ISM',expect:/ISM Purchasing Managers/i},
 {currency:'USD',id:'spmi',path:'united-states/non-manufacturing-pmi',publisher:'ISM',expect:/ISM Non[- ]Manufacturing/i},
 {currency:'EUR',id:'mpmi',path:'euro-area/manufacturing-pmi',publisher:'HCOB',expect:M_RE},
 {currency:'EUR',id:'spmi',path:'euro-area/services-pmi',publisher:'HCOB',expect:S_RE},
 {currency:'GBP',id:'mpmi',path:'united-kingdom/manufacturing-pmi',publisher:'S&P Global',expect:M_RE},
 {currency:'GBP',id:'spmi',path:'united-kingdom/services-pmi',publisher:'S&P Global',expect:S_RE},
 {currency:'JPY',id:'mpmi',path:'japan/manufacturing-pmi',publisher:'S&P Global',expect:M_RE},
 {currency:'JPY',id:'spmi',path:'japan/services-pmi',publisher:'S&P Global',expect:S_RE},
 {currency:'CHF',id:'mpmi',path:'switzerland/manufacturing-pmi',publisher:'procure.ch',expect:M_RE},
 {currency:'CHF',id:'spmi',path:'switzerland/services-pmi',publisher:'procure.ch',expect:S_RE},
 {currency:'AUD',id:'mpmi',path:'australia/manufacturing-pmi',publisher:'S&P Global',expect:M_RE},
 {currency:'AUD',id:'spmi',path:'australia/services-pmi',publisher:'S&P Global',expect:S_RE},
 {currency:'CAD',id:'mpmi',path:'canada/manufacturing-pmi',publisher:'S&P Global',expect:M_RE},
 {currency:'CAD',id:'spmi',path:'canada/services-pmi',publisher:'S&P Global',expect:S_RE},
 {currency:'NZD',id:'mpmi',path:'new-zealand/manufacturing-pmi',publisher:'BusinessNZ PMI',expect:M_RE},
 {currency:'NZD',id:'spmi',path:'new-zealand/services-pmi',publisher:'BusinessNZ PSI',expect:S_RE},
];

const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const monthIdx=(s:string)=>MONTHS.indexOf(s.toLowerCase());
const decode=(s:string)=>s.replace(/&amp;/g,'&').replace(/&#39;|&#x27;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ');

/** Obsah <meta name="description"> z HTML (pořadí atributů libovolné); jinak null. */
export function teMetaDescription(html:string):string|null{
 for(const m of html.matchAll(/<meta\b[^>]*>/gi)){
  const tag=m[0];if(!/\bname\s*=\s*["']description["']/i.test(tag))continue;
  const c=/\bcontent\s*=\s*"([^"]*)"/i.exec(tag)??/\bcontent\s*=\s*'([^']*)'/i.exec(tag);
  if(c)return decode(c[1]);
 }
 return null;
}

const NUM='(-?\\d+(?:\\.\\d+)?)',PTS='\\s+(?:index\\s+)?points?';
const VERB='(?:increased|decreased|rose|fell|declined|dropped|climbed|jumped|slipped|eased|edged\\s+(?:up|down|higher|lower)|(?:was|remained|held|stayed)(?:\\s+(?:unchanged|steady|stable))?|stood|came\\s+in)';
const MAIN=new RegExp(VERB+'\\s+(?:to|at)\\s+'+NUM+PTS+'\\s+in\\s+([A-Za-z]+)(?:\\s+of\\s+(\\d{4}))?(?:\\s*,?\\s*from\\s+'+NUM+PTS+'\\s+in\\s+([A-Za-z]+))?(?:\\s+of\\s+(\\d{4}))?','i');

/** Rozbor meta description TE: hodnota, předchozí, období 'YYYY-MM' (vůči datu stažení) a název řady; jinak null. */
export function parseTEDescription(desc:string|null|undefined,now:number):{value:number;previous:number|null;period:string;series:string}|null{
 const m=MAIN.exec(desc||'');if(!m)return null;
 const value=Number(m[1]),mi=monthIdx(m[2]);if(!Number.isFinite(value)||mi<0)return null;
 let previous:number|null=m[4]!==undefined?Number(m[4]):null;
 if(m[5]!==undefined&&monthIdx(m[5])!==(mi+11)%12)previous=null; // „from … in <měsíc>“ musí být předchozí měsíc
 if(previous===null&&/unchanged|steady|stable/i.test(m[0]))previous=value;
 const d=new Date(now),cur=d.getUTCFullYear()*12+d.getUTCMonth();
 let o=d.getUTCFullYear()*12+mi;if(o>cur)o-=12;
 const s=/(?:value for|provides)\s*-\s*(.+?)\s*-/.exec(desc||'');
 return {value,previous,period:`${Math.floor(o/12)}-${String(o%12+1).padStart(2,'0')}`,series:s?s[1].trim():''};
}

/** Konec období 'YYYY-MM' (ms). */
export function monthEnd(period:string):number{const [y,m]=period.split('-').map(Number);return Date.UTC(y,m,0,23,59,59)}
