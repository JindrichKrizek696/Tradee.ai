// Úvodní dotazník (/pruvodce): odpovědi → náhled toho, co se nastaví (vlaječky, navigace, panely Dashboardu, pole deníku,
// prázdná startovní strategie, návrh profilu účtu), použití, přeskočení a vrácení. Čisté funkce – testy scripts/check-onboarding.mjs.
// Zásada: riziko na obchod nemá výchozí hodnotu (null) – Tradee ho nikdy nedomýšlí.
import {normalizeNav,defaultNav,type Nav,type View} from '../nav.ts';
import {emptyContent,TIMEFRAMES,type Content,type Style as StrategyStyle} from '../strategy/core.ts';
export const MARKET_GROUPS={fx:'FX páry',index:'Akciové indexy',commodities:'Komodity (zlato, stříbro, ropa)',stock:'Akcie',crypto:'Krypto',czk:'Koruna (USD/CZK)'} as const;
export type MarketGroup=keyof typeof MARKET_GROUPS;
export const STYLES={scalp:'Scalping',day:'Day trading',swing:'Swing',position:'Poziční'} as const;
export type Style=keyof typeof STYLES;
export const TIMES={lt1:'Do 1 hodiny denně',h1to2:'1–2 hodiny denně',h2to4:'2–4 hodiny denně',gt4:'Víc než 4 hodiny denně'} as const;
export type TimeKey=keyof typeof TIMES;
export const ACCOUNTS={personal:'Osobní účet',challenge:'Challenge (zkouška u prop firmy)',funded:'Funded (účet prop firmy)'} as const;
export type AccountKind=keyof typeof ACCOUNTS;
export const TOOLS={mt5:'MetaTrader 5',mt4:'MetaTrader 4',tradingview:'TradingView',ctrader:'cTrader',t212:'Trading 212',ninjatrader:'NinjaTrader',sheet:'Tabulka / sešit',none:'Nic dalšího'} as const;
export type Tool=keyof typeof TOOLS;
export const ONB_TIMEFRAMES=TIMEFRAMES;
export const ZONES=['Europe/Prague','Europe/London','America/New_York','America/Chicago','UTC','Asia/Tokyo','Australia/Sydney'] as const;
export type Answers={markets:MarketGroup[];style:Style|null;time:TimeKey|null;timeframes:string[];tz:string;broker:string;account:AccountKind|null;tools:Tool[];riskPct:number|null};
export const emptyAnswers=(tz='Europe/Prague'):Answers=>({markets:[],style:null,time:null,timeframes:[],tz,broker:'',account:null,tools:[],riskPct:null});
const isTz=(tz:unknown):tz is string=>{if(typeof tz!=='string'||!tz||tz.length>64)return false;try{new Intl.DateTimeFormat('en-US',{timeZone:tz});return true}catch{return false}};
const keysOf=<T extends string>(v:unknown,allowed:Record<T,string>,max:number):T[]|null=>{if(v===undefined||v===null)return [];if(!Array.isArray(v)||v.length>max)return null;const out:T[]=[];for(const x of v){if(typeof x!=='string'||!Object.hasOwn(allowed,x))return null;if(!out.includes(x as T))out.push(x as T)}return out};
const oneOf=<T extends string>(v:unknown,allowed:Record<T,string>):T|null|undefined=>v===null||v===undefined||v===''?null:typeof v==='string'&&Object.hasOwn(allowed,v)?v as T:undefined;
/** Vstup z UI/DB → platné odpovědi, nebo text chyby. Prázdné riziko = null (žádná výchozí hodnota). */
export function validateAnswers(raw:unknown):Answers|string{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return 'Neplatné odpovědi.';
 const o=raw as Record<string,unknown>;
 const markets=keysOf(o.markets,MARKET_GROUPS,10);if(!markets)return 'Neznámý trh.';
 const tools=keysOf(o.tools,TOOLS,10);if(!tools)return 'Neznámý nástroj.';
 const style=oneOf(o.style,STYLES);if(style===undefined)return 'Neznámý styl obchodování.';
 const time=oneOf(o.time,TIMES);if(time===undefined)return 'Neznámá volba času.';
 const account=oneOf(o.account,ACCOUNTS);if(account===undefined)return 'Neznámý typ účtu.';
 const tfs:string[]=[];if(o.timeframes!==undefined&&o.timeframes!==null){if(!Array.isArray(o.timeframes)||o.timeframes.length>TIMEFRAMES.length)return 'Neplatné časové rámce.';for(const t of o.timeframes){if(!(TIMEFRAMES as readonly string[]).includes(t as string))return 'Neznámý časový rámec.';if(!tfs.includes(t as string))tfs.push(t as string)}}
 const timeframes=TIMEFRAMES.filter(t=>tfs.includes(t));
 const tz=o.tz===undefined||o.tz===null||o.tz===''?'Europe/Prague':o.tz;if(!isTz(tz))return 'Neznámá časová zóna.';
 const broker=typeof o.broker==='string'?o.broker.replace(/\s+/g,' ').trim():o.broker===undefined||o.broker===null?'':null;if(broker===null||broker.length>60)return 'Broker může mít nejvýš 60 znaků.';
 let riskPct:number|null=null;
 if(o.riskPct!==undefined&&o.riskPct!==null&&o.riskPct!==''){const n=typeof o.riskPct==='number'?o.riskPct:Number(String(o.riskPct).replace(',','.'));if(!Number.isFinite(n)||n<=0||n>100)return 'Riziko na obchod musí být mezi 0 a 100 % (nebo prázdné).';riskPct=Math.round(n*100)/100}
 return {markets,style,time,timeframes,tz,broker,account,tools:tools.includes('none')&&tools.length>1?tools.filter(t=>t!=='none'):tools,riskPct};
}
export function parseAnswers(s:string|null|undefined):Answers|null{if(!s)return null;try{const v=validateAnswers(JSON.parse(s));return typeof v==='string'?null:v}catch{return null}}

// ---- pracovní prostor: panely Dashboardu a pole záznamu obchodu, které jde schovat (skrytí = jen zobrazení, data zůstávají)
export const DASH_PANELS=[
 ['trading','Můj trading','.d-mt'],['positions','Otevřené pozice','.d-op'],['discipline','Disciplína','.d-disc'],['risk','Riziko otevřených pozic','.d-risk'],
 ['accounts','Limity účtů','.rk-card'],['scenarios','Aktivní scénáře','.sg-dash'],['session','Seance','.js'],['breadth','Šíře trhu','.d-pulse'],
 ['movers','Co se dnes hýbe','.d-movers'],['signals','Nejsilnější signály','.d-watch'],['currencies','Síla měn','.d-ccy'],['stats','Statistiky měsíce','.d-perf'],
] as const;
export type DashPanel=typeof DASH_PANELS[number][0];
export const JOURNAL_FIELDS=[['risk','Plánované riziko'],['costs','Náklady'],['changes','Změny SL / TP'],['process','Hodnocení procesu'],['checkin','Check-in po obchodu']] as const;
export type JournalField=typeof JOURNAL_FIELDS[number][0];
export type Prefs={dash:{off:DashPanel[]};journal:{off:JournalField[]}};
export const defaultPrefs=():Prefs=>({dash:{off:[]},journal:{off:[]}});
const DASH_IDS=DASH_PANELS.map(p=>p[0]) as string[],JF_IDS=JOURNAL_FIELDS.map(f=>f[0]) as string[];
export function normalizePrefs(raw:unknown):Prefs{
 const o=raw&&typeof raw==='object'?raw as {dash?:{off?:unknown};journal?:{off?:unknown}}:{};
 const pick=(v:unknown,ids:string[])=>Array.isArray(v)?ids.filter(id=>v.includes(id)):[];
 return {dash:{off:pick(o.dash?.off,DASH_IDS) as DashPanel[]},journal:{off:pick(o.journal?.off,JF_IDS) as JournalField[]}};
}
export function parsePrefs(s:string|null|undefined):Prefs{if(!s)return defaultPrefs();try{return normalizePrefs(JSON.parse(s))}catch{return defaultPrefs()}}
/** CSS pro skryté panely Dashboardu (atribut data-off na .d-bento). */
export const dashHideCss=()=>DASH_PANELS.map(([id,,sel])=>`.d-bento[data-off~="${id}"]>${sel}`).join(',')+'{display:none!important}';

// ---- náhled
export const WATCH:Record<MarketGroup,string[]>={fx:['EUR/USD','GBP/USD','USD/JPY'],index:['^NDX','^GSPC'],commodities:['GC=F','CL=F'],stock:['AAPL','NVDA'],crypto:['BTC-USD','ETH-USD'],czk:['USD/CZK']};
export const WATCH_FLAG='orange';// „Vyhlížím konkrétní pozici“
export type Current={nav:Nav;flags:Record<string,string>;prefs:Prefs};
export type ProfileDraft={kind:AccountKind;name:string;tz:string;maxRiskPct:number|null;broker:string};
export type Preview={
 watch:{instrument:string;from:string;to:string}[];
 nav:Nav;navChanged:boolean;
 prefs:Prefs;
 strategy:{name:string;content:Content};
 profile:ProfileDraft|null;
 notes:string[];
};
const STRATEGY_STYLE:Record<Style,StrategyStyle>={scalp:'day',day:'day',swing:'swing',position:'swing'};
const NAV_ORDER:Record<'intraday'|'swing',View[]>={intraday:['dashboard','calendar','journal','analyzer','reports','journaling'],swing:['dashboard','analyzer','reports','journal','calendar','journaling']};
const intraday=(s:Style|null)=>s==='scalp'||s==='day';
/** Co odpovědi nastaví – nic se nezapisuje, jen se spočítá. marketIds = platná id trhů Tradee (vlaječky jen na existující). */
export function buildPreview(a:Answers,cur:Current,marketIds:readonly string[]):Preview{
 const notes:string[]=[];
 // vlaječky: zástupci vybraných skupin, jen kde ještě vlaječka není (nic, co už máš, se nepřepíše)
 const want=[...new Set(a.markets.flatMap(g=>WATCH[g]))].filter(id=>marketIds.includes(id));
 const watch=want.filter(id=>!cur.flags[id]||cur.flags[id]==='none').map(id=>({instrument:id,from:cur.flags[id]||'none',to:WATCH_FLAG}));
 // navigace: pořadí podle stylu, Reporty (COT, makro) schované, když nesleduješ FX, indexy ani komodity; málo času → Deník a Journaling sloučit
 let nav=cur.nav;
 if(a.style){
  const order=NAV_ORDER[intraday(a.style)?'intraday':'swing'];
  const macro=a.markets.some(g=>g==='fx'||g==='index'||g==='commodities'||g==='czk');
  const hidden=a.markets.length&&!macro?[...new Set([...cur.nav.hidden,'reports' as View])]:cur.nav.hidden.filter(v=>v!=='reports'||!macro);
  nav=normalizeNav({order,hidden,merge:a.time==='lt1'?true:cur.nav.merge});
 }else if(a.time==='lt1')nav=normalizeNav({...cur.nav,merge:true});
 const navChanged=JSON.stringify(nav)!==JSON.stringify(cur.nav);
 // panely Dashboardu
 const off=new Set<DashPanel>();
 if(a.markets.length&&!a.markets.includes('fx'))off.add('currencies');
 if(a.style==='swing'||a.style==='position')off.add('session');
 if(a.time==='lt1')off.add('movers');
 const synced=a.tools.some(t=>t==='mt4'||t==='mt5'||t==='t212');
 if(a.tools.length&&!synced){off.add('positions');off.add('risk');notes.push('Otevřené pozice a jejich riziko vidí Tradee jen z propojeného MetaTraderu nebo Trading 212 – panely schovám, zapneš je v Nastavení.')}
 const jOff=new Set<JournalField>();
 if(a.style==='scalp'&&!synced)jOff.add('changes');
 const prefs:Prefs=normalizePrefs({dash:{off:[...off]},journal:{off:[...jOff]}});
 // prázdná startovní strategie: jen rozsah (trhy, časové rámce, styl), bloky prázdné
 const content=emptyContent();
 content.scope.markets=want;content.scope.timeframes=[...a.timeframes];content.scope.style=a.style?STRATEGY_STYLE[a.style]:null;
 const strategy={name:a.style?`Moje strategie – ${STYLES[a.style]}`:'Moje strategie',content};
 const profile:ProfileDraft|null=a.account?{kind:a.account,name:(a.account==='personal'?'Osobní účet':a.account==='challenge'?'Challenge':'Funded')+(a.broker?` · ${a.broker}`:''),tz:a.tz,maxRiskPct:a.riskPct,broker:a.broker}:null;
 if(a.riskPct===null)notes.push('Riziko na obchod jsi nevyplnil – Tradee žádné výchozí nedoplní. Kalkulačka se na něj zeptá.');
 if(a.account&&a.account!=='personal')notes.push('Pravidla prop firmy (denní limit, drawdown, konzistence) zadáš v profilu účtu – každá firma je má jiná.');
 return {watch,nav,navChanged,prefs,strategy,profile,notes};
}
/** Zápisy při použití + stav k vrácení (jen to, co se mění). */
export type Snapshot={nav:Nav;flags:Record<string,string>;prefs:Prefs};
export function planApply(p:Preview,cur:Current):{writes:{nav:Nav|null;flags:{instrument:string;flag:string}[];prefs:Prefs};previous:Snapshot}{
 const flags=p.watch.map(w=>({instrument:w.instrument,flag:w.to}));
 const prevFlags=Object.fromEntries(p.watch.map(w=>[w.instrument,cur.flags[w.instrument]||'none']));
 return {writes:{nav:p.navChanged?p.nav:null,flags,prefs:p.prefs},previous:{nav:cur.nav,flags:prevFlags,prefs:cur.prefs}};
}
/** Vrácení: původní navigace, panely a vlaječky (jen ty, které průvodce nastavil a od té doby se nezměnily). */
export function planRevert(prev:Snapshot,cur:Current):{nav:Nav;flags:{instrument:string;flag:string}[];prefs:Prefs}{
 const flags=Object.entries(prev.flags).filter(([id])=>(cur.flags[id]||'none')===WATCH_FLAG).map(([instrument,flag])=>({instrument,flag}));
 return {nav:normalizeNav(prev.nav),flags,prefs:normalizePrefs(prev.prefs)};
}
export function parseSnapshot(s:string|null|undefined):Snapshot|null{
 if(!s)return null;try{const v=JSON.parse(s) as Partial<Snapshot>;if(!v||typeof v!=='object')return null;
  const flags:Record<string,string>={};if(v.flags&&typeof v.flags==='object')for(const [k,f] of Object.entries(v.flags))if(typeof f==='string'&&/^(none|red|orange|green)$/.test(f))flags[k]=f;
  return {nav:normalizeNav(v.nav),flags,prefs:normalizePrefs(v.prefs)}}catch{return null}
}
export const STATUSES=['new','draft','applied','skipped','reverted'] as const;
export type OnbStatus=typeof STATUSES[number];
/** Ukázat po přihlášení výzvu k průvodci? Jen dokud ho uživatel nepoužil ani nepřeskočil. */
export const shouldPrompt=(status:OnbStatus|null|'unavailable')=>status===null||status==='new'||status==='draft';
export {defaultNav};
