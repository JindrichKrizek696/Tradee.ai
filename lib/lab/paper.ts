// Laboratoř · Simulace: virtuální účet 100 000 Kč, který obchoduje podle nejsilnějších signálů Tradee (jen vlastník).
// Čistý a deterministický engine – jeden krok (výstupy, pak vstupy) z daného stavu, skóre, cen, svíček a zpráv.
// Běží z cronu (scripts/lab-paper.mjs po živých cenách každých 15 min), testy scripts/check-lab-paper.mjs.
// Pravidla se ukládají ke každému obchodu jako rules_version – pozdější změna pravidel nepřepíše historii.
import {atr} from '../backtest/indicators.ts';
import {spreadPrice} from '../backtest/rules.ts';
import {trendStates} from './study.ts';

export const PAPER_RULES_VERSION='paper-v1';
export const PAPER_RULES={
 startEquity:100000,riskPct:1,maxOpen:5,maxPerCurrencyDir:2,
 minScore:50,fxMinCoverage:70,fxMinAlignment:60,
 newsWindowMs:30*60000,staleQuoteMs:2*3600000,
 atrPeriod:14,slAtr:1.5,tpAtr:3,maxTradingDays:10,exitScore:20,cooldownMs:24*3600000,
} as const;
// maxCrypto = nejvýš otevřených krypto pozic (D); minExtAtr/minCot = vstup kontra (C)
export type PaperRules={-readonly [K in keyof typeof PAPER_RULES]:number}&{maxCrypto?:number;minExtAtr?:number;minCot?:number;gmaPeriod?:number};
// Pravidla v1 v textu pro UI a shrnutí pro AI (měnit jen spolu s PAPER_RULES_VERSION)
export const PAPER_RULES_TEXT=[
 'Virtuální účet 100 000 Kč (start = první běh simulace). Riziko 1 % aktuálního uzavřeného zůstatku na obchod.',
 'Nejvýš 5 otevřených pozic, nejvýš 1 na trh a nejvýš 2 pozice se stejnou měnou ve stejném směru (FX expozice; long EUR/USD = long EUR + short USD).',
 'Kandidáti: všechny obchodovatelné trhy s platným skóre (měnové indexy ne). Síla signálu = |skóre|, vstup při |skóre| ≥ 50, směr = znaménko. FX páry navíc pokrytí ≥ 70 % a shoda složek ≥ 60 %. Pořadí podle |skóre|, plní se volná místa.',
 'Nevstupuje se 30 min před ani po zprávě se signálem 3 v měnách trhu (ropa i zásoby EIA/OPEC), na zavřeném trhu (živá cena starší než 2 h) ani 24 h po uzavření obchodu na stejném trhu.',
 'Vstup = poslední živá cena ± polovina výchozího spreadu (z backtestu). SL = 1,5 × ATR14 (D1), TP = 3 × ATR14 (= 2 R).',
 'Výstupy každý běh: SL / TP podle H1 svíček a 15min bodů od vstupu (když svíčka zasáhne obojí, počítá se SL) a podle živé ceny; po 10 obchodních dnech; když skóre klesne pod +20 (long) / nad −20 (short) nebo se otočí. Cena výstupu = úroveň SL/TP, jinak živá cena ∓ polovina spreadu.',
 'P&L v Kč = R × riziko v Kč (R = pohyb od vstupu / vzdálenost SL). Abstrahuje od velikosti kontraktu a převodu měn – jako by šlo pozici vždy nastavit přesně na 1 % rizika. Ukládá se i čistý pohyb ceny v %.',
 'Jistota 0–100 % = 50 % síla skóre (|skóre|/100) + 20 % shoda složek + 15 % pokrytí + 15 % čerstvost (70 % podíl nezastaralých vah, 30 % stáří živé ceny: do 15 min plně, ve 2 h nula).',
];


// ---- varianty: každá má vlastní virtuální účet 100 000 Kč, křivku, obchody a uložená pravidla (rules_version)
// A = paper-v1 beze změny (existující účet). B/C/D začínají prvním během po nasazení (migrace 0027 – sloupec variant).
export type VariantId='A'|'B'|'C'|'D';
export const VARIANT_IDS:VariantId[]=['A','B','C','D'];
export const isVariantId=(v:unknown):v is VariantId=>typeof v==='string'&&(VARIANT_IDS as string[]).includes(v);
export type MarketGroup='fx'|'currency'|'commodities'|'index'|'crypto'|'stock';
// skupina trhu podle id (stejné dělení jako lib/markets.ts instruments)
export function marketGroup(id:string):MarketGroup{
 if(/^[A-Z]{3}\/[A-Z]{3}$/.test(id))return 'fx';
 if(/^[A-Z]{3}$/.test(id))return 'currency';
 if(id.startsWith('^'))return 'index';
 if(id.endsWith('=F'))return 'commodities';
 if(id.endsWith('-USD'))return 'crypto';
 return 'stock';
}
export type PaperVariant={id:VariantId;name:string;rulesVersion:string;kind:'score'|'contra';groups:MarketGroup[];rules:PaperRules;text:string[]};
export const CONTRA_RULES:PaperRules={...PAPER_RULES,minExtAtr:2,minCot:0.5,gmaPeriod:50};
export const CONTRA_TEXT=[
 'Kontra (mean reversion): hypotéza ze studie Laboratoře – když je trend „přepálený“, cena se spíš vrací k průměru. Obchoduje PROTI trendu.',
 'Trhy: FX páry, komodity a indexy (bez měnových indexů, akcií a krypta). Skóre Tradee se pro vstup nepoužívá, jen se zapíše.',
 'Vstup, když platí vše: trend D1 je ±2 (všechny 3 hlasy: cena vs GMA50, cena vs GMA200, GMA50 vs GMA200 – GMA = geometrický průměr close, stejně jako ve studii); živá cena je od GMA50 aspoň 2 × ATR14 (D1) ve směru trendu; a když je COT k dispozici, COT signál spekulantů má stejné znaménko jako trend a |COT| ≥ 0,5 (přeplněné pozice). Bez COT dat stačí trend a natažení.',
 'Směr = proti trendu (trend +2 → short, −2 → long). Pořadí podle natažení v ATR.',
 'Vstup = živá cena ± ½ spreadu. SL = 1,5 × ATR14 za vstupem (ve směru trendu), TP = 3 × ATR14 (= 2 R).',
 'Výstupy: SL / TP jako u A; návrat ceny ke GMA50 (živá cena dosáhne GMA50 = vybrání zisku, za mid ∓ ½ spreadu); po 10 obchodních dnech. Signál skóre výstup nespouští.',
 'Limity jako A: riziko 1 % zůstatku, nejvýš 5 pozic, 1 na trh, 2 se stejnou měnou ve stejném směru, 30 min kolem zpráv se signálem 3, zavřený trh, 24 h po uzavření na stejném trhu.',
 'Jistota 0–100 % = 40 % základ + 35 % natažení (2 ATR = 0, 4 ATR a víc = plně) + 25 % extrémnost COT (|COT| 0,5 = 0, 1 = plně; bez COT 0).',
];
export const PAPER_VARIANTS:Record<VariantId,PaperVariant>={
 A:{id:'A',name:'Základní',rulesVersion:PAPER_RULES_VERSION,kind:'score',groups:['fx','commodities','index','crypto','stock'],rules:PAPER_RULES,text:PAPER_RULES_TEXT},
 B:{id:'B',name:'Jen FX',rulesVersion:'paper-B-v1',kind:'score',groups:['fx'],rules:PAPER_RULES,
  text:['Rozdíl proti A: jen FX páry – bez měnových indexů, komodit, indexů, akcií a krypta. Stejné prahy: |skóre| ≥ 50, pokrytí ≥ 70 %, shoda ≥ 60 %. Vlastní účet 100 000 Kč.','Jinak stejně jako A:',...PAPER_RULES_TEXT]},
 C:{id:'C',name:'Kontra',rulesVersion:'paper-C-v1',kind:'contra',groups:['fx','commodities','index'],rules:CONTRA_RULES,text:CONTRA_TEXT},
 D:{id:'D',name:'Přísná',rulesVersion:'paper-D-v1',kind:'score',groups:['fx','commodities','index','crypto','stock'],rules:{...PAPER_RULES,minScore:65,maxCrypto:1},
  text:['Rozdíl proti A: vstup až při |skóre| ≥ 65 (místo 50) a nejvýš 1 otevřená krypto pozice. FX páry dál pokrytí ≥ 70 % a shoda ≥ 60 %. Vlastní účet 100 000 Kč.','Jinak stejně jako A:',...PAPER_RULES_TEXT]},
};

export type Direction='long'|'short';
export type ExitReason='sl'|'tp'|'time'|'signal'|'mean';
export const EXIT_LABELS:Record<ExitReason,string>={sl:'stop-loss',tp:'take-profit',time:'čas (10 obchodních dní)',signal:'signál zeslábl',mean:'návrat ke GMA50'};
export type PaperPart={id:string;label:string;weight:number;value:number|null;contribution:number|null;detail:string;status:string};
export type PaperSignal={score:number|null;coverage:number;alignment:number;method:string;parts:PaperPart[]};
export type ContraSnap={trend:number;gma50:number;extAtr:number;cot:number|null};
export type PaperSnapshot={method:string;coverage:number;alignment:number;freshness:number;atr:number;parts:PaperPart[];contra?:ContraSnap};
export type PaperQuote={price:number;marketTime:number};
export type PaperBar={t:number;o?:number;h:number;l:number;c:number};
export type PaperNews={at:number;currencies:string[]};
export type PaperTrade={
 id:string;instrument:string;direction:Direction;opened:number;entry:number;sl:number;tp:number;riskCzk:number;confidence:number;
 scoreAtEntry:number;partsAtEntry:PaperSnapshot;why:string;
 closed:number|null;exit:number|null;exitReason:ExitReason|null;r:number|null;pnlCzk:number|null;pct:number|null;scoreAtExit:number|null;resultNote:string|null;rulesVersion:string;variant?:VariantId;
};
export type PaperClose={id:string;closed:number;exit:number;exitReason:ExitReason;r:number;pnlCzk:number;pct:number;scoreAtExit:number|null;resultNote:string};
export type PaperInput={
 now:number;startEquity:number;trades:PaperTrade[];
 signals:Record<string,PaperSignal|undefined>;quotes:Record<string,PaperQuote|undefined>;
 h1?:Record<string,PaperBar[]|undefined>;points?:Record<string,[number,number][]|undefined>;d1:Record<string,PaperBar[]|undefined>;
 news:PaperNews[];names?:Record<string,string>;rules?:PaperRules;
 variant?:PaperVariant;cot?:Record<string,number|undefined>; // cot = COT signál trhu −1…+1 (jen varianta C)
};
export type PaperSkip={instrument:string;score:number;reason:string};
export type PaperStepResult={closes:PaperClose[];opens:PaperTrade[];skipped:PaperSkip[];log:string[];balance:number;openPnl:number;openCount:number};

const H=3600000,DAY=86400000;
const round=(v:number,d:number)=>{const f=10**d;return Math.round(v*f)/f};
const cz=(v:number,d=2)=>v.toLocaleString('cs-CZ',{maximumFractionDigits:d,minimumFractionDigits:0});
export const signed=(v:number,d=1)=>{const r=round(v,d);return (r>0?'+':r<0?'−':'')+cz(Math.abs(r),d)};
export const fmtCzk=(v:number)=>signed(round(v,0),0)+' Kč';
export const fmtPx=(v:number)=>cz(v,Math.abs(v)<10?5:Math.abs(v)<1000?3:2);
export const dirSign=(d:Direction)=>d==='long'?1:-1;

// ---- trh: měny pro zprávy a expozici, spread
const FX=/^([A-Z]{3})\/([A-Z]{3})$/;
export const isFxPair=(id:string)=>FX.test(id);
export function marketCurrencies(id:string):string[]{
 const m=id.match(FX);if(m)return [m[1],m[2]];
 if(id==='CL=F'||id==='BZ=F')return ['OIL','USD'];
 return ['USD']; // kovy, indexy, akcie, krypto: kotované v USD
}
// FX expozice: long A/B = +A, −B (ostatní trhy se do měnové expozice nepočítají)
export function legs(id:string,d:Direction):[string,number][]{const m=id.match(FX);if(!m)return [];const s=dirSign(d);return [[m[1],s],[m[2],-s]]}
export const halfSpread=(id:string,price:number)=>spreadPrice(id,price,{costs:{commissionPct:0,spread:{}}})/2;

// ---- čísla obchodu
export function atrLast(bars:PaperBar[],now:number,n:number=PAPER_RULES.atrPeriod):number|null{
 const b=[...bars].filter(x=>x.t<=now).sort((a,c)=>a.t-c.t);if(b.length<n+1)return null;
 const a=atr(b.map(x=>x.h),b.map(x=>x.l),b.map(x=>x.c),n),v=a[a.length-1];
 return Number.isFinite(v)&&v>0?v:null;
}
export const rOf=(t:Pick<PaperTrade,'direction'|'entry'|'sl'>,exit:number)=>dirSign(t.direction)*(exit-t.entry)/Math.abs(t.entry-t.sl);
export const pctOf=(t:Pick<PaperTrade,'direction'|'entry'>,exit:number)=>dirSign(t.direction)*(exit-t.entry)/t.entry*100;
// cena, za kterou by se pozice teď zavřela (long prodává na bid = mid − ½ spread)
export const exitAtMarket=(t:Pick<PaperTrade,'direction'|'instrument'>,mid:number)=>mid-dirSign(t.direction)*halfSpread(t.instrument,mid);
export function markToMarket(t:PaperTrade,mid:number){const px=exitAtMarket(t,mid),r=rOf(t,px);return {price:px,r,pnlCzk:r*t.riskCzk,pct:pctOf(t,px)}}
// pracovní dny (po–pá, UTC) po dni vstupu až do dne now včetně
export function tradingDays(from:number,to:number){
 let n=0;for(let d=Math.floor(from/DAY)+1;d<=Math.floor(to/DAY);d++){const w=new Date(d*DAY).getUTCDay();if(w!==0&&w!==6)n++}
 return n;
}

// ---- jistota (deterministická, 0–100)
export function staleWeight(parts:PaperPart[]){return parts.reduce((s,p)=>s+(p.status==='stale'?p.weight:0),0)}
export function freshnessOf(parts:PaperPart[],quoteAgeMs:number){
 const total=parts.reduce((s,p)=>s+p.weight,0)||100;
 const data=1-Math.min(1,staleWeight(parts)/total),quote=Math.max(0,Math.min(1,1-(quoteAgeMs/60000-15)/105));
 return 0.7*data+0.3*quote;
}
export function paperConfidence(x:{score:number;alignment:number;coverage:number;freshness:number}):number{
 const c=(v:number)=>Number.isFinite(v)?Math.max(0,Math.min(1,v)):0;
 return Math.round(100*(0.5*c(Math.abs(x.score)/100)+0.2*c(x.alignment/100)+0.15*c(x.coverage/100)+0.15*c(x.freshness)));
}

// ---- varianta C (kontra): trend ±2, natažení od GMA50 v ATR, COT
// GMA = geometrický průměr close (průměr logaritmů) posledních n D1 svíček do now včetně – jako lib/lab/study.ts trendStates
export function gmaLast(bars:PaperBar[],now:number,n=50):number|null{
 const b=[...bars].filter(x=>x.t<=now&&x.c>0).sort((a,c)=>a.t-c.t);if(b.length<n)return null;
 let s=0;for(const x of b.slice(-n))s+=Math.log(x.c);return Math.exp(s/n);
}
export function trendLast(bars:PaperBar[],now:number):number|null{
 const b=[...bars].filter(x=>x.t<=now&&x.c>0).sort((a,c)=>a.t-c.t);if(b.length<200)return null;
 const st=trendStates(b.map(x=>x.c));return st[st.length-1]??null;
}
export type ContraSetup={trend:number;gma50:number;atr:number;extAtr:number;cot:number|null;direction:Direction};
// null + důvod = žádný vstup (pro přehled v --dry); jinak nastavení obchodu proti trendu
export function contraSetup(bars:PaperBar[],now:number,price:number,cot:number|null|undefined,rules:PaperRules=CONTRA_RULES):{setup:ContraSetup|null;reason:string}{
 const trend=trendLast(bars,now);if(trend===null)return {setup:null,reason:'méně než 200 denních svíček'};
 if(Math.abs(trend)<2)return {setup:null,reason:`trend ${signed(trend,0)} (potřeba ±2)`};
 const gma50=gmaLast(bars,now,rules.gmaPeriod??50),a=atrLast(bars,now,rules.atrPeriod);
 if(gma50===null||a===null)return {setup:null,reason:'chybí GMA50 / ATR'};
 const s=Math.sign(trend),extAtr=s*(price-gma50)/a;
 if(extAtr<(rules.minExtAtr??2))return {setup:null,reason:`natažení ${cz(round(extAtr,2),2)} ATR (potřeba ≥ ${cz(rules.minExtAtr??2,1)})`};
 const c=cot===undefined||cot===null||!Number.isFinite(cot)?null:cot;
 if(c!==null&&!(Math.sign(c)===s&&Math.abs(c)>=(rules.minCot??0.5)))return {setup:null,reason:`COT ${signed(c,2)} nepotvrzuje přeplnění ve směru trendu`};
 return {setup:{trend,gma50,atr:a,extAtr,cot:c,direction:s>0?'short':'long'},reason:''};
}
export function contraConfidence(x:{extAtr:number;cot:number|null}):number{
 const c=(v:number)=>Number.isFinite(v)?Math.max(0,Math.min(1,v)):0;
 return Math.round(100*(0.4+0.35*c((x.extAtr-2)/2)+0.25*(x.cot===null?0:c((Math.abs(x.cot)-0.5)/0.5))));
}
export function contraWhy(x:{instrument:string;name?:string;direction:Direction;setup:ContraSetup;confidence:number;price:number;entry:number;sl:number;tp:number;riskCzk:number;balance:number;score:number|null}):string{
 const st=x.setup,up=st.trend>0,label=x.name&&x.name!==x.instrument?x.name+' ('+x.instrument+')':x.instrument;
 return [
  `${label} ${x.direction} (kontra) – trend ${signed(st.trend,0)} (${up?'cena nad GMA50 i GMA200, GMA50 nad GMA200':'cena pod GMA50 i GMA200, GMA50 pod GMA200'}), jistota ${x.confidence} %.`,
  `Proč proti trendu: cena ${fmtPx(x.price)} je ${cz(round(st.extAtr,2),2)} × ATR14 (${fmtPx(st.atr)}) ${up?'nad':'pod'} GMA50 ${fmtPx(st.gma50)} (práh 2 ATR) – trh je natažený a podle studie Laboratoře se po takovém natažení cena spíš vrací k průměru.`,
  st.cot===null?'COT: pro tento trh není k dispozici, vstup jen podle trendu a natažení.':`COT: spekulanti ${signed(st.cot,2)} – ${up?'silně long':'silně short'} ve směru trendu (práh ±0,5), pozice jsou přeplněné.`,
  `Skóre Tradee: ${x.score===null?'–':signed(x.score,1)} (pro vstup se nepoužívá).`,
  `Plán: vstup ${fmtPx(x.entry)}, SL ${fmtPx(x.sl)} (1,5× ATR za vstupem), TP ${fmtPx(x.tp)} (2 R), dřív výstup při návratu ke GMA50 ${fmtPx(st.gma50)}, nejdéle 10 obchodních dní; riziko ${cz(round(x.riskCzk,0),0)} Kč (1 % z ${cz(round(x.balance,0),0)} Kč).`,
 ].join('\n');
}
export function contraResultNote(t:PaperTrade,c:{exitReason:ExitReason;exit:number;r:number;pnlCzk:number;pct:number;closed:number},gmaNow:number|null):string{
 const k=t.partsAtEntry.contra;
 return [`Výstup: ${EXIT_LABELS[c.exitReason]} za ${fmtPx(c.exit)} → ${signed(c.r,2)} R, ${fmtCzk(c.pnlCzk)} (${signed(c.pct,2)} % ceny), drženo ${tradingDays(t.opened,c.closed)} obch. dní.`,
  k?`Při vstupu natažení ${cz(round(k.extAtr,2),2)} ATR od GMA50 ${fmtPx(k.gma50)}${gmaNow!==null?`, teď GMA50 ${fmtPx(gmaNow)}`:''}${c.exitReason==='mean'?' – cena se vrátila k průměru (kontra vyšla).':c.exitReason==='sl'?' – trend pokračoval dál (kontra nevyšla).':'.'}`:''].filter(Boolean).join('\n');
}

// ---- poznámky
const partText=(p:PaperPart)=>`${p.label} ${p.value===null?'':signed(p.value,1)+' '}(${signed(p.contribution??0,1)} b.${p.detail?'; '+p.detail.replace(/\s+/g,' ').trim().slice(0,160):''})`;
export function whyNote(x:{instrument:string;name?:string;direction:Direction;score:number;confidence:number;snap:PaperSnapshot;entry:number;sl:number;tp:number;riskCzk:number;balance:number}):string{
 const s=dirSign(x.direction),counted=x.snap.parts.filter(p=>p.contribution!==null&&p.contribution!==0);
 const pro=counted.filter(p=>Math.sign(p.contribution!)===s).sort((a,b)=>Math.abs(b.contribution!)-Math.abs(a.contribution!)||a.id.localeCompare(b.id)).slice(0,3);
 const con=counted.filter(p=>Math.sign(p.contribution!)===-s).sort((a,b)=>Math.abs(b.contribution!)-Math.abs(a.contribution!)||a.id.localeCompare(b.id));
 return [
  `${x.name&&x.name!==x.instrument?x.name+' ('+x.instrument+')':x.instrument} ${x.direction} – skóre ${signed(x.score,1)} (${x.snap.method}, pokrytí ${cz(x.snap.coverage,0)} %, shoda ${cz(x.snap.alignment,0)} %), jistota ${x.confidence} %.`,
  `Proč: ${pro.length?pro.map(partText).join(', '):'žádná jednotlivá složka nevyčnívá'}.`,
  `Rizika: ${con.length?con.slice(0,3).map(partText).join(', ')+(con.length>3?` a další ${con.length-3}`:''):'žádná započtená složka nejde proti'}.`,
  `Plán: vstup ${fmtPx(x.entry)}, SL ${fmtPx(x.sl)} (1,5× ATR ${fmtPx(x.snap.atr)}), TP ${fmtPx(x.tp)} (2 R), riziko ${cz(round(x.riskCzk,0),0)} Kč (1 % z ${cz(round(x.balance,0),0)} Kč), nejdéle 10 obchodních dní.`,
 ].join('\n');
}
export function resultNote(t:PaperTrade,c:{exitReason:ExitReason;exit:number;r:number;pnlCzk:number;pct:number;closed:number},now:PaperSignal|undefined):string{
 const lines=[`Výstup: ${EXIT_LABELS[c.exitReason]} za ${fmtPx(c.exit)} → ${signed(c.r,2)} R, ${fmtCzk(c.pnlCzk)} (${signed(c.pct,2)} % ceny), drženo ${tradingDays(t.opened,c.closed)} obch. dní.`];
 if(!now||now.score===null)lines.push(`Skóre při vstupu ${signed(t.scoreAtEntry,1)}, teď bez platného skóre.`);
 else{
  lines.push(`Skóre při vstupu ${signed(t.scoreAtEntry,1)} → při výstupu ${signed(now.score,1)}${Math.sign(now.score)!==Math.sign(t.scoreAtEntry)?' (otočilo se)':''}.`);
  const before=new Map(t.partsAtEntry.parts.map(p=>[p.id,p]));
  const ch=now.parts.map(p=>{const b=before.get(p.id);const d=(p.contribution??0)-(b?.contribution??0);return {p,b,d}}).filter(x=>Math.abs(x.d)>=1).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d)).slice(0,4);
  if(ch.length)lines.push('Změny složek: '+ch.map(({p,b,d})=>`${p.label} ${b?.contribution==null?'–':signed(b.contribution,1)} → ${p.contribution===null?'–':signed(p.contribution,1)} b. (${signed(d,1)})`).join(', ')+'.');
  else lines.push('Složky skóre se výrazně nezměnily.');
 }
 return lines.join('\n');
}

// ---- výstup jednoho obchodu: SL/TP podle svíček a bodů od vstupu, pak živá cena, pak čas a signál
export function checkExit(t:PaperTrade,inp:{now:number;h1?:PaperBar[];points?:[number,number][];quote?:PaperQuote;signal?:PaperSignal;rules?:PaperRules;gma50?:number|null}):Omit<PaperClose,'id'|'resultNote'|'scoreAtExit'>|null{
 const R=inp.rules??PAPER_RULES,now=inp.now,long=t.direction==='long';
 const firstBar=Math.ceil(t.opened/H)*H; // svíčka rozběhnutá před vstupem obsahuje ceny před ním → bere se až další
 const path=[...(inp.h1||[]).filter(b=>b.t>=firstBar&&b.t<=now).map(b=>({t:b.t,end:Math.min(now,b.t+H),h:b.h,l:b.l})),
  ...(inp.points||[]).filter(p=>p[0]>t.opened&&p[0]<=now).map(p=>({t:p[0],end:p[0],h:p[1],l:p[1]}))];
 const q=inp.quote;
 if(q&&q.marketTime>t.opened)path.push({t:Math.min(now,q.marketTime),end:now,h:q.price,l:q.price});
 path.sort((a,b)=>a.t-b.t);
 const done=(reason:ExitReason,exit:number,closed:number)=>{const r=rOf(t,exit);return {closed,exit,exitReason:reason,r:round(r,4),pnlCzk:round(r*t.riskCzk,2),pct:round(pctOf(t,exit),4)}};
 for(const b of path){
  const hitSl=long?b.l<=t.sl:b.h>=t.sl,hitTp=long?b.h>=t.tp:b.l<=t.tp;
  if(hitSl)return done('sl',t.sl,b.end); // obojí v jedné svíčce = konzervativně SL
  if(hitTp)return done('tp',t.tp,b.end);
 }
 if(!q||now-q.marketTime>R.staleQuoteMs)return null; // zavřený trh: čas i signál počkají na živou cenu
 const px=exitAtMarket(t,q.price);
 // kontra (C): návrat živé ceny ke GMA50 = vybrání zisku
 const g=inp.gma50;
 if(g!==undefined&&g!==null&&(long?q.price>=g:q.price<=g))return done('mean',px,now);
 if(tradingDays(t.opened,now)>=R.maxTradingDays)return done('time',px,now);
 const s=inp.signal?.score;
 if(s!==null&&s!==undefined&&Number.isFinite(s)&&(long?s<R.exitScore:s>-R.exitScore))return done('signal',px,now);
 return null;
}

// ---- jeden krok simulace
export const slotOf=(now:number)=>Math.floor(now/(15*60000))*15*60000;
// A má id beze změny (existující obchody); B/C/D mají písmeno varianty (base36 je malými písmeny → bez kolize)
export const tradeId=(now:number,instrument:string,variant:VariantId='A')=>'p'+(variant==='A'?'':variant)+slotOf(now).toString(36)+'-'+instrument.replace(/[^A-Za-z0-9]/g,'');
export function paperStep(inp:PaperInput):PaperStepResult{
 const V=inp.variant??PAPER_VARIANTS.A,R=inp.rules??V.rules,contra=V.kind==='contra',now=inp.now,log:string[]=[],name=(id:string)=>inp.names?.[id]||id;
 const gmaOf=(id:string)=>contra?gmaLast(inp.d1[id]||[],now,R.gmaPeriod??50):null;
 const open=inp.trades.filter(t=>t.closed===null);
 // 1) výstupy
 const closes:PaperClose[]=[];
 for(const t of [...open].sort((a,b)=>a.opened-b.opened||a.id.localeCompare(b.id))){
  const g=gmaOf(t.instrument);
  const ex=checkExit(t,{now,h1:inp.h1?.[t.instrument],points:inp.points?.[t.instrument],quote:inp.quotes[t.instrument],signal:contra?undefined:inp.signals[t.instrument],rules:R,gma50:g});
  if(!ex)continue;
  const sig=inp.signals[t.instrument],note=contra?contraResultNote(t,ex,g):resultNote(t,ex,sig);
  closes.push({id:t.id,...ex,scoreAtExit:sig?.score??null,resultNote:note});
  log.push(`Zavřeno ${name(t.instrument)} ${t.direction}: ${EXIT_LABELS[ex.exitReason]}, ${signed(ex.r,2)} R, ${fmtCzk(ex.pnlCzk)}.`);
 }
 const closedIds=new Set(closes.map(c=>c.id));
 const still=open.filter(t=>!closedIds.has(t.id));
 let balance=inp.startEquity+inp.trades.reduce((s,t)=>s+(t.closed!==null?t.pnlCzk??0:0),0)+closes.reduce((s,c)=>s+c.pnlCzk,0);
 balance=round(balance,2);
 // 2) vstupy
 const opens:PaperTrade[]=[],skipped:PaperSkip[]=[];
 const held=new Set(still.map(t=>t.instrument));
 const lastClose=new Map<string,number>();
 for(const t of inp.trades)if(t.closed!==null)lastClose.set(t.instrument,Math.max(lastClose.get(t.instrument)??0,t.closed));
 for(const c of closes){const t=open.find(x=>x.id===c.id)!;lastClose.set(t.instrument,Math.max(lastClose.get(t.instrument)??0,c.closed))}
 const exposure=new Map<string,number>(); // "USD:+1" → počet
 const addExp=(id:string,d:Direction)=>{for(const [c,s] of legs(id,d)){const k=c+':'+s;exposure.set(k,(exposure.get(k)??0)+1)}};
 for(const t of still)addExp(t.instrument,t.direction);
 let crypto=still.filter(t=>marketGroup(t.instrument)==='crypto').length;
 const inGroup=(id:string)=>V.groups.includes(marketGroup(id));
 // kandidáti: skóre (A, B, D) = |skóre| ≥ práh; kontra (C) = trend ±2 + natažení od GMA50 (+ COT), pořadí podle natažení
 type Cand={id:string;direction:Direction;score:number;s?:PaperSignal;setup?:ContraSetup};
 const cands:Cand[]=contra
  ?Object.keys(inp.d1).filter(inGroup).sort().flatMap(id=>{const q=inp.quotes[id];if(!q||!(q.price>0))return [];
    const {setup}=contraSetup(inp.d1[id]||[],now,q.price,inp.cot?.[id],R);return setup?[{id,direction:setup.direction,score:round(setup.trend*setup.extAtr,2),setup}]:[]})
    .sort((a,b)=>b.setup!.extAtr-a.setup!.extAtr||a.id.localeCompare(b.id))
  :Object.entries(inp.signals).filter(([id,s])=>inGroup(id)&&s&&s.score!==null&&Number.isFinite(s.score)&&Math.abs(s.score)>=R.minScore)
    .map(([id,s])=>({id,s:s!,score:s!.score as number,direction:(s!.score as number)>0?'long' as Direction:'short' as Direction})).sort((a,b)=>Math.abs(b.score)-Math.abs(a.score)||a.id.localeCompare(b.id));
 for(const {id,s,score,direction,setup} of cands){
  const skip=(reason:string)=>skipped.push({instrument:id,score,reason});
  if(held.has(id)){skip('pozice už je otevřená');continue}
  if(s&&isFxPair(id)&&(s.coverage<R.fxMinCoverage||s.alignment<R.fxMinAlignment)){skip(`FX: pokrytí ${s.coverage} % / shoda ${s.alignment} % pod limitem`);continue}
  if(still.length+opens.length>=R.maxOpen){skip(`plno (${R.maxOpen} pozic)`);continue}
  if(R.maxCrypto!==undefined&&marketGroup(id)==='crypto'&&crypto>=R.maxCrypto){skip(`krypto: už ${crypto} otevřená (limit ${R.maxCrypto})`);continue}
  const lc=lastClose.get(id);if(lc!==undefined&&now-lc<R.cooldownMs){skip('24 h po uzavření obchodu');continue}
  const q=inp.quotes[id];if(!q||!(q.price>0)){skip('chybí živá cena');continue}
  if(now-q.marketTime>R.staleQuoteMs){skip('trh je zavřený (cena starší než 2 h)');continue}
  const ccy=marketCurrencies(id),n=inp.news.find(x=>Math.abs(x.at-now)<=R.newsWindowMs&&x.currencies.some(c=>ccy.includes(c)));
  if(n){skip(`zpráva ${new Date(n.at).toISOString().slice(11,16)} UTC (${n.currencies.join(', ')})`);continue}
  const over=legs(id,direction).find(([c,sg])=>(exposure.get(c+':'+sg)??0)>=R.maxPerCurrencyDir);
  if(over){skip(`expozice: už 2 pozice ${over[1]>0?'long':'short'} ${over[0]}`);continue}
  const a=setup?setup.atr:atrLast(inp.d1[id]||[],now,R.atrPeriod);if(a===null){skip('chybí denní svíčky pro ATR');continue}
  const sg=dirSign(direction),entry=q.price+sg*halfSpread(id,q.price),sl=entry-sg*R.slAtr*a,tp=entry+sg*R.tpAtr*a;
  const riskCzk=round(balance*R.riskPct/100,2);
  let t:PaperTrade;
  const common={id:tradeId(now,id,V.id),instrument:id,direction,opened:now,entry,sl,tp,riskCzk,
   closed:null,exit:null,exitReason:null,r:null,pnlCzk:null,pct:null,scoreAtExit:null,resultNote:null,rulesVersion:V.rulesVersion,variant:V.id};
  if(setup){
   const sig=inp.signals[id],confidence=contraConfidence(setup),freshness=sig?freshnessOf(sig.parts,now-q.marketTime):Math.max(0,Math.min(1,1-((now-q.marketTime)/60000-15)/105));
   const snap:PaperSnapshot={method:'contra-v1',coverage:sig?.coverage??0,alignment:sig?.alignment??0,freshness:round(freshness,3),atr:a,
    parts:[{id:'trend',label:'Trend D1',weight:0,value:setup.trend,contribution:null,detail:'GMA50/GMA200, 3 hlasy',status:'ok'},
     {id:'ext',label:'Natažení od GMA50',weight:0,value:round(setup.extAtr,2),contribution:null,detail:`GMA50 ${fmtPx(setup.gma50)}, ATR ${fmtPx(a)}`,status:'ok'},
     {id:'cot',label:'COT',weight:0,value:setup.cot===null?null:round(setup.cot,3),contribution:null,detail:'',status:setup.cot===null?'missing':'ok'}],
    contra:{trend:setup.trend,gma50:setup.gma50,extAtr:round(setup.extAtr,4),cot:setup.cot===null?null:round(setup.cot,4)}};
   const sc=sig?.score??null;
   t={...common,confidence,scoreAtEntry:sc??0,partsAtEntry:snap,why:contraWhy({instrument:id,name:inp.names?.[id],direction,setup,confidence,price:q.price,entry,sl,tp,riskCzk,balance,score:sc})};
   log.push(`Otevřeno ${name(id)} ${direction} (kontra) za ${fmtPx(entry)} (trend ${signed(setup.trend,0)}, natažení ${cz(round(setup.extAtr,2),2)} ATR, COT ${setup.cot===null?'–':signed(setup.cot,2)}, jistota ${confidence} %, riziko ${cz(round(riskCzk,0),0)} Kč).`);
  }else{
   const sig=s!,freshness=freshnessOf(sig.parts,now-q.marketTime),confidence=paperConfidence({score,alignment:sig.alignment,coverage:sig.coverage,freshness});
   const snap:PaperSnapshot={method:sig.method,coverage:sig.coverage,alignment:sig.alignment,freshness:round(freshness,3),atr:a,parts:sig.parts};
   t={...common,confidence,scoreAtEntry:score,partsAtEntry:snap,why:whyNote({instrument:id,name:inp.names?.[id],direction,score,confidence,snap,entry,sl,tp,riskCzk,balance})};
   log.push(`Otevřeno ${name(id)} ${direction} za ${fmtPx(entry)} (skóre ${signed(score,1)}, jistota ${confidence} %, riziko ${cz(round(riskCzk,0),0)} Kč).`);
  }
  if(V.id==='A')delete t.variant; // A beze změny (stejný objekt jako paper-v1)
  opens.push(t);held.add(id);addExp(id,direction);if(marketGroup(id)==='crypto')crypto++;
 }
 // 3) otevřený zisk/ztráta podle živé ceny
 let openPnl=0;
 for(const t of [...still,...opens]){const q=inp.quotes[t.instrument];if(q&&q.price>0)openPnl+=markToMarket(t,q.price).pnlCzk}
 return {closes,opens,skipped,log,balance,openPnl:round(openPnl,2),openCount:still.length+opens.length};
}

// ---- statistiky a shrnutí pro AI
export type PaperEquityPoint={t:number;equity:number};
export function maxDrawdownPct(points:PaperEquityPoint[]):number{
 let peak=-Infinity,dd=0;for(const p of points){peak=Math.max(peak,p.equity);if(peak>0)dd=Math.min(dd,(p.equity-peak)/peak*100)}
 return round(dd,2);
}
export function paperStats(trades:PaperTrade[],startEquity:number,openPnl:number,equity:PaperEquityPoint[]){
 const closed=trades.filter(t=>t.closed!==null),wins=closed.filter(t=>(t.pnlCzk??0)>0).length;
 const realized=closed.reduce((s,t)=>s+(t.pnlCzk??0),0),balance=startEquity+realized,now=balance+openPnl;
 return {startEquity,balance:round(balance,2),equity:round(now,2),openPnl:round(openPnl,2),returnPct:round((now-startEquity)/startEquity*100,2),
  trades:closed.length,open:trades.length-closed.length,wins,winRate:closed.length?round(wins/closed.length*100,1):null,
  avgR:closed.length?round(closed.reduce((s,t)=>s+(t.r??0),0)/closed.length,2):null,totalR:round(closed.reduce((s,t)=>s+(t.r??0),0),2),
  maxDrawdownPct:maxDrawdownPct([{t:0,equity:startEquity},...equity,{t:Number.MAX_SAFE_INTEGER,equity:now}])};
}
export type PaperStats=ReturnType<typeof paperStats>;
const iso=(t:number)=>new Date(t).toISOString().slice(0,16).replace('T',' ');
export function paperSummaryMd(x:{started:number|null;stats:PaperStats;open:(PaperTrade&{mark?:{price:number;r:number;pnlCzk:number}|null})[];closed:PaperTrade[];variant?:PaperVariant}):string{
 const V=x.variant??PAPER_VARIANTS.A,s=x.stats,out=[`## Simulace 100 000 Kč · varianta ${V.id} – ${V.name} (paper trading)`,''];
 if(x.started===null){out.push('_Simulace ještě neběžela._','');return out.join('\n')}
 out.push(`Start ${iso(x.started)} UTC, pravidla ${V.rulesVersion}. Equity ${cz(round(s.equity,0),0)} Kč (${signed(s.returnPct,2)} %), otevřený P&L ${fmtCzk(s.openPnl)}, uzavřených ${s.trades}, win rate ${s.winRate===null?'–':cz(s.winRate,1)+' %'}, průměr ${s.avgR===null?'–':signed(s.avgR,2)+' R'}, max. drawdown ${cz(s.maxDrawdownPct,2)} %.`,'');
 out.push(`Pravidla ${V.id} (${V.rulesVersion}):`,...V.text.map(t=>'- '+t),'');
 out.push(`### ${V.id} · otevřené pozice (${x.open.length})`,'');
 if(!x.open.length)out.push('_Žádné._','');
 for(const t of x.open)out.push(`#### ${t.instrument} ${t.direction} · otevřeno ${iso(t.opened)} UTC`,`Vstup ${fmtPx(t.entry)}, SL ${fmtPx(t.sl)}, TP ${fmtPx(t.tp)}, jistota ${t.confidence} %${t.mark?`, teď ${fmtPx(t.mark.price)} = ${signed(t.mark.r,2)} R / ${fmtCzk(t.mark.pnlCzk)}`:''}.`,'',t.why,'');
 out.push(`### ${V.id} · posledních ${Math.min(20,x.closed.length)} uzavřených`,'');
 if(!x.closed.length)out.push('_Zatím žádné._','');
 for(const t of x.closed.slice(0,20))out.push(`#### ${t.instrument} ${t.direction} · ${iso(t.opened)} → ${t.closed===null?'?':iso(t.closed)} UTC · ${t.r===null?'–':signed(t.r,2)+' R'} · ${t.pnlCzk===null?'–':fmtCzk(t.pnlCzk)}`,'',t.why,'',t.resultNote||'','');
 return out.join('\n').trim()+'\n';
}

// ---- převod výsledku skóre (lib/markets marketScore) na signál simulace
type ScorePartIn={id:string;label:string;weight:number;value?:number|null;signal?:number|null;contribution:number|null;detail?:string;status?:string};
export function toPaperSignal(r:{score:number|null;coverage:number;alignment:number;method:string;parts:ScorePartIn[]}):PaperSignal{
 const v3=r.method==='score-v3';
 return {score:r.score,coverage:r.coverage,alignment:r.alignment,method:r.method,parts:r.parts.map(p=>({id:p.id,label:p.label,weight:p.weight,
  value:v3?(p.value??null):p.signal===null||p.signal===undefined?null:round(p.signal*2,2),contribution:p.contribution===null?null:round(p.contribution,2),
  detail:v3?String(p.detail||'').slice(0,240):'',status:v3?String(p.status||'ok'):p.signal===null?'missing':'ok'}))};
}
