// Maloobchod z oficiálních bezplatných zdrojů (otevřené licence). Čistá logika (bez I/O); kontrola: node --experimental-strip-types scripts/check-retail.mjs
// Stahuje scripts/refresh-retail.mjs (1× za 12 h) → data/retail-official.json.
//
// Zdroje (ověřeno, že fungují bez klíče):
//  USD  FRED RSAFS (Census MARTS, nominální, SA) – m/m z úrovní
//  EUR  Eurostat sts_trtu_m (EA20, G47, objem, SCA, PCH_PRE) – m/m přímo
//  GBP  ONS J5EK/DRSI (objem vč. pohonných hmot, SA, index) – m/m z indexu
//  CAD  StatCan WDS 20-10-0056-01 (celkové tržby, SA) – m/m z úrovní
//  JPY  METI Current Survey of Commerce (DB_MainA, maloobchod, SA m/m) – přímo z xlsx
//  CHF  OECD SDMX (CHE, G47 objem, SA) – m/m z indexu (BFS publikuje do OECD)
//  AUD  ABS Monthly Household Spending Indicator (HSI_M, celkem, SA, m/m) – nástupce Retail Trade
//  NZD  OECD SDMX (NZL, G47 objem, SA, čtvrtletně) – q/q z indexu (Stats NZ jen čtvrtletně)
export type RetailKind='m/m'|'q/q';
export type RetailValue={value:number;previous:number|null;unit:'%';kind:RetailKind;period:string;releasedAt?:string;fetchedAt:string;source:string;series:string;url:string};
export type RetailOfficial={updated:string;currencies:Record<string,RetailValue>};
export type Point=[period:string,value:number];
export type Change={value:number;previous:number|null;period:string};

const r2=(n:number)=>Math.round(n*100)/100;
/** Procentní změna posledního bodu proti předchozímu (a předchozí změna); řada se seřadí podle období. */
export function changeFromLevels(points:Point[]):Change|null{
 const p=points.filter(([,v])=>Number.isFinite(v)&&v!==0).sort((a,b)=>a[0].localeCompare(b[0]));
 if(p.length<2)return null;
 const pct=(i:number)=>r2((p[i][1]/p[i-1][1]-1)*100),n=p.length-1;
 return {value:pct(n),previous:n>=2?pct(n-1):null,period:p[n][0]};
}
/** Poslední dvě hodnoty řady, která už je změnou v % (Eurostat PCH_PRE, ABS, METI). */
export function lastChange(points:Point[]):Change|null{
 const p=points.filter(([,v])=>Number.isFinite(v)).sort((a,b)=>a[0].localeCompare(b[0]));
 return p.length?{value:r2(p.at(-1)![1]),previous:p.length>1?r2(p.at(-2)![1]):null,period:p.at(-1)![0]}:null;
}

/** Jednoduché CSV (uvozovky, čárky) → pole objektů podle hlavičky. */
export function parseCsv(text:string):Record<string,string>[]{
 const rows:string[][]=[];let row:string[]=[],f='',q=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(q){if(ch==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=ch;continue}
  if(ch==='"')q=true;else if(ch===','){row.push(f);f=''}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(f);f='';if(row.some(x=>x!==''))rows.push(row);row=[]}else f+=ch;
 }
 row.push(f);if(row.some(x=>x!==''))rows.push(row);
 const [h,...body]=rows;return h?body.map(r=>Object.fromEntries(h.map((k,i)=>[k.trim(),(r[i]??'').trim()]))):[];
}

/** FRED fredgraph.csv (observation_date/DATE, <ID>) → body 'YYYY-MM'. Vrací [] pro HTML/chybu. */
export function parseFredCsv(text:string):Point[]{
 if(!/^\s*(?:observation_date|DATE)\s*,/i.test(text))return [];
 return parseCsv(text).map(r=>{const v=Object.values(r);return [String(v[0]).slice(0,7),Number(v[1])] as Point}).filter(([p,v])=>/^\d{4}-\d{2}$/.test(p)&&Number.isFinite(v));
}

/** Eurostat JSON-stat (jedna řada, dimenze time) → body. */
export function parseEurostat(j:{value?:Record<string,number>;dimension?:{time?:{category?:{index?:Record<string,number>}}}}):Point[]{
 const idx=j?.dimension?.time?.category?.index??{},val=j?.value??{};
 return Object.entries(idx).filter(([,i])=>val[String(i)]!==undefined&&val[String(i)]!==null).map(([t,i])=>[t,Number(val[String(i)])] as Point);
}

const MON=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
/** ONS timeseries /data JSON (months: [{date:'2026 AUG',value:'103.6'}]) → body + datum vydání. */
export function parseOns(j:{months?:{date:string;value:string}[];description?:{releaseDate?:string}}):{points:Point[];releasedAt?:string}{
 const points=(j?.months??[]).map(m=>{const x=/^(\d{4})\s+([A-Z]{3})$/.exec(m.date.trim().toUpperCase());const mi=x?MON.indexOf(x[2]):-1;return [x&&mi>=0?`${x[1]}-${String(mi+1).padStart(2,'0')}`:'',Number(m.value)] as Point}).filter(([p,v])=>p&&Number.isFinite(v)&&String(v)!=='');
 return {points,releasedAt:j?.description?.releaseDate};
}

/** StatCan WDS getDataFromCubePidCoordAndLatestNPeriods → body + čas vydání posledního bodu. */
export function parseStatcan(j:{status?:string;object?:{vectorDataPoint?:{refPer:string;value:number|null;releaseTime?:string}[]}}[]):{points:Point[];releasedAt?:string}{
 const d=j?.[0];if(d?.status!=='SUCCESS')return {points:[]};
 const pts=(d.object?.vectorDataPoint??[]).filter(p=>p.value!==null&&Number.isFinite(Number(p.value)));
 const last=[...pts].sort((a,b)=>a.refPer.localeCompare(b.refPer)).at(-1);
 return {points:pts.map(p=>[p.refPer.slice(0,7),Number(p.value)] as Point),releasedAt:last?.releaseTime||undefined /* místní čas Ottawy */};
}

/** SDMX csvfile (OECD, ABS): řádky odpovídající filtru → body (TIME_PERIOD, OBS_VALUE); čtvrtletí 'YYYY-Qn' → 'YYYY Qn'. */
export function parseSdmxCsv(text:string,filter:Record<string,string>):Point[]{
 return parseCsv(text).filter(r=>Object.entries(filter).every(([k,v])=>r[k]===v)).map(r=>[r.TIME_PERIOD.replace(/^(\d{4})-Q([1-4])$/,'$1 Q$2'),Number(r.OBS_VALUE)] as Point).filter(([p,v])=>p&&Number.isFinite(v));
}

/** METI DB_MainA jako matice buněk: sloupec, kde řádek „Retail“ a pod ním „Seasonal adjustment … previous month“; měsíční řádky s kódem YYYY00MMMM. */
export function parseMeti(rows:(string|number|null)[][]):Point[]{
 let col=-1;
 for(let r=0;r<rows.length-1&&col<0;r++)for(let c=0;c<rows[r].length;c++)
  if(String(rows[r][c]??'').trim()==='Retail'&&/^Seasonal adjustment.*previous month/i.test(String(rows[r+1]?.[c]??'').trim())){col=c;break}
 if(col<0)return [];
 const out:Point[]=[];
 for(const row of rows){
  const m=/^(\d{4})00(\d{2})(\d{2})$/.exec(String(row[0]??'').trim());
  if(!m||m[2]!==m[3])continue;
  const v=Number(row[col]);if(row[col]===null||row[col]===''||!Number.isFinite(v))continue;
  out.push([`${m[1]}-${m[2]}`,v]);
 }
 return out;
}

/** Konec období ('YYYY-MM' nebo 'YYYY Qn') v ms; jinak NaN. */
export function retailPeriodEnd(period:string):number{
 let m=/^(\d{4})-(\d{2})$/.exec(period);if(m)return Date.UTC(+m[1],+m[2],0,23,59,59);
 m=/^(\d{4}) Q([1-4])$/.exec(period);if(m)return Date.UTC(+m[1],3*+m[2],0,23,59,59);
 return NaN;
}
