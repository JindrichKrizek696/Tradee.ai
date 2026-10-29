// Laboratoř · Strategie: schéma definice pravidlové strategie (JSON v DB lab_strategy_defs, nikdy v kódu) a její validace.
// Lehký modul bez závislostí (používá ho i stránka). Engine: lib/lab/strat-engine.ts, stavební bloky: lib/lab/strat-blocks.ts.
//
// Definice = {name, version, markets[], data:'D1'|'H1', tf:{context,zone,entry}, conditions[], anyOf?, entry, stop, targets, management, risk,
//  filters, costs?, variants?}. Každá podmínka je obecný blok (BLOCKS) s parametry a rolí 'required' / 'optional' / 'info'
//  (info = jen zdroj úrovní, např. cílové zóny – signál neblokuje a do hodnocení se nepočítá).
// Skupiny NEBO (schéma 2, zpětně kompatibilní): povinné podmínky se stejným `group` tvoří skupinu, ze které musí platit aspoň jedna;
//  totéž zapíše `anyOf: [[id, id…], …]` (každý vnitřní seznam = jedna skupina, normalizuje se na group 'or1', 'or2' …).
//  Vstup / stop smí odkazovat na id skupiny = úroveň PRVNÍ splněné podmínky skupiny (v pořadí definice).
// ZMĚNY CHOVÁNÍ (schéma 2): zone / order_block s atrMode 'auto' (výchozí) na vyšším TF agregovaném z H1 měří impulz proti ATR
//  z rozsahu svíček (high − low, bez gapů přes noc); D1 data a TF = data beze změny. Ostatní nové parametry mají výchozí hodnotu = staré chování.
// Validace vrací seznam chyb ve tvaru „cesta: zpráva“ – zprávy NIKDY neopakují hodnoty z definice (logy a výpisy nesmí nést pravidla).
export const DEF_SCHEMA_VERSION=2;
export type Tf='H1'|'H4'|'D1'|'W1'|'MN';
export const TFS:Tf[]=['H1','H4','D1','W1','MN'];
export const TF_RANK:Record<Tf,number>={H1:0,H4:1,D1:2,W1:3,MN:4};
export type DataTf='D1'|'H1';
export type TfRef='context'|'zone'|'entry'|Tf;
export type LevelKey='proximal'|'distal'|'mid'|'level'|'extreme'|'high'|'low';
export const LEVEL_KEYS:LevelKey[]=['proximal','distal','mid','level','extreme','high','low'];
export type SessionId='asia'|'london'|'ny';
export const SESSION_IDS:SessionId[]=['asia','london','ny'];
export type SessionDef={tz:string;from:string;to:string};
// výchozí seance (místní čas burzy, letní čas podle IANA zóny); přepsat jde ve filters.sessionDefs
export const DEFAULT_SESSIONS:Record<SessionId,SessionDef>={
 asia:{tz:'Asia/Tokyo',from:'09:00',to:'18:00'},
 london:{tz:'Europe/London',from:'08:00',to:'17:00'},
 ny:{tz:'America/New_York',from:'08:00',to:'17:00'},
};
export const SESSION_LABELS:Record<SessionId,string>={asia:'Asie (Tokio)',london:'Londýn',ny:'New York'};

// ---- katalog bloků: popisek (obecný), směrový ano/ne, jaké úrovně dává, parametry
type PNum={t:'num'|'int';min:number;max:number;def:number};
type PEnum={t:'enum';values:readonly string[];def:string};
type PBool={t:'bool';def:boolean};
type PStr={t:'str';def:string;max:number;opt?:boolean}; // opt = smí chybět (prázdné = výchozí chování)
type PRef={t:'ref'}; // id jiné podmínky
export type ParamSpec=PNum|PEnum|PBool|PStr|PRef;
export type BlockId='trend_swing'|'ma'|'atr_regime'|'zone'|'order_block'|'nested_zone'|'premium_discount'|'fvg'|'fib_band'|'round_number'|'prev_day'|
 'session_range'|'sweep'|'mss'|'engulfing'|'pin_bar'|'rel_strength'|'news_blackout'|'cot_index'|'seasonality'|'dxy_trend';
const LEVEL_SRC=['prev_day','asia','london','ny','swing'] as const;
const STATUS=['fresh','fresh_or_touched','valid'] as const;
// ATR pro impulz zóny: true = klasický true range (s gapy), range = high − low svíčky (bez gapů), auto = range na vyšším TF agregovaném z H1, jinak true
const ATR_MODE=['auto','true','range'] as const;
// TF pro premium/discount: same = TF podmínky
const PD_TF=['same','context','zone','entry','H1','H4','D1','W1','MN'] as const;
export const ZONE_BLOCKS=['zone','order_block','fvg'] as const;
export const BLOCKS:Record<BlockId,{label:string;levels:LevelKey[];params:Record<string,ParamSpec>;needs?:'cot'|'news'|'other'|'dxy'|'d1'}>={
 trend_swing:{label:'Trend ze swingů (HH+HL / LH+LL)',levels:['high','low'],params:{n:{t:'int',min:1,max:10,def:2}}},
 ma:{label:'Klouzavý průměr',levels:['level'],params:{kind:{t:'enum',values:['ema','sma'],def:'ema'},period:{t:'int',min:2,max:400,def:50},mode:{t:'enum',values:['price','slope'],def:'price'},slopeBars:{t:'int',min:1,max:50,def:5}}},
 atr_regime:{label:'Volatilita (ATR proti průměru)',levels:[],params:{period:{t:'int',min:2,max:100,def:14},avg:{t:'int',min:5,max:400,def:50},op:{t:'enum',values:['above','below'],def:'above'},k:{t:'num',min:.1,max:5,def:1}}},
 zone:{label:'Zóna nabídky / poptávky',levels:['proximal','distal','mid'],params:{
  impulseK:{t:'num',min:.1,max:10,def:1.5},atrPeriod:{t:'int',min:2,max:100,def:14},maxBase:{t:'int',min:1,max:10,def:3},baseBodyRatio:{t:'num',min:.05,max:1,def:.5},
  swingN:{t:'int',min:1,max:10,def:2},requireBreak:{t:'bool',def:true},proximal:{t:'enum',values:['body','wick'],def:'body'},maxAge:{t:'int',min:1,max:5000,def:200},
  status:{t:'enum',values:STATUS,def:'fresh'},mitigation:{t:'enum',values:['wick','close'],def:'wick'},maxMitigationPct:{t:'num',min:0,max:100,def:50},
  invalidate:{t:'enum',values:['close','wick'],def:'close'},maxDistAtr:{t:'num',min:0,max:100,def:0},atrMode:{t:'enum',values:ATR_MODE,def:'auto'}}},
 order_block:{label:'Order block',levels:['proximal','distal','mid'],params:{
  impulseK:{t:'num',min:.1,max:10,def:1.5},atrPeriod:{t:'int',min:2,max:100,def:14},lookback:{t:'int',min:1,max:10,def:3},swingN:{t:'int',min:1,max:10,def:2},
  requireBreak:{t:'bool',def:true},proximal:{t:'enum',values:['body','wick'],def:'wick'},maxAge:{t:'int',min:1,max:5000,def:200},status:{t:'enum',values:STATUS,def:'fresh'},
  mitigation:{t:'enum',values:['wick','close'],def:'wick'},maxMitigationPct:{t:'num',min:0,max:100,def:50},invalidate:{t:'enum',values:['close','wick'],def:'close'},maxDistAtr:{t:'num',min:0,max:100,def:0},
  atrMode:{t:'enum',values:ATR_MODE,def:'auto'}}},
 nested_zone:{label:'Zóna nižšího TF uvnitř zóny vyššího TF',levels:['proximal','distal','mid'],params:{inner:{t:'ref'},outer:{t:'ref'},mode:{t:'enum',values:['contain','overlap'],def:'contain'},
  // pairs: nearest = jen vybraná (nejbližší) zóna každé podmínky (původní chování), all = všechny aktivní zóny vnitřní × všechny aktivní vnější;
  // containment: full = celá vnitřní uvnitř, proximal_inside = proximální hrana vnitřní uvnitř vnější, overlap = překryv, auto = podle mode
  pairs:{t:'enum',values:['nearest','all'],def:'nearest'},containment:{t:'enum',values:['auto','full','proximal_inside','overlap'],def:'auto'}}},
 premium_discount:{label:'Premium / discount v posledním swingu',levels:['high','low','mid'],params:{swingN:{t:'int',min:1,max:10,def:2},discount:{t:'num',min:0,max:1,def:.5},premium:{t:'num',min:0,max:1,def:.5},
  // rozsah = poslední potvrzený swing na rangeTf (jen uzavřené svíčky), pozice = close poslední uzavřené svíčky evalTf; same = TF podmínky
  rangeTf:{t:'enum',values:PD_TF,def:'same'},evalTf:{t:'enum',values:PD_TF,def:'same'}}},
 fvg:{label:'Fair value gap (3 svíčky)',levels:['proximal','distal','mid'],params:{minAtr:{t:'num',min:0,max:10,def:0},atrPeriod:{t:'int',min:2,max:100,def:14},maxAge:{t:'int',min:1,max:5000,def:50},maxFillPct:{t:'num',min:0,max:100,def:50}}},
 fib_band:{label:'Fibonacci pásmo posledního impulzu',levels:['proximal','distal','mid','extreme'],params:{swingN:{t:'int',min:1,max:10,def:2},from:{t:'num',min:0,max:1,def:.5},to:{t:'num',min:0,max:1.5,def:.786}}},
 round_number:{label:'Kulaté číslo',levels:['level'],params:{step:{t:'num',min:1e-6,max:1e6,def:.005},maxDistAtr:{t:'num',min:0,max:10,def:.25},atrPeriod:{t:'int',min:2,max:100,def:14}}},
 prev_day:{label:'Maximum / minimum předchozího dne',levels:['high','low'],params:{use:{t:'enum',values:['break','near','inside'],def:'near'},k:{t:'num',min:0,max:10,def:.5},atrPeriod:{t:'int',min:2,max:100,def:14}}},
 session_range:{label:'Rozsah seance',levels:['high','low'],params:{session:{t:'enum',values:SESSION_IDS,def:'asia'},use:{t:'enum',values:['break','near','inside'],def:'break'},k:{t:'num',min:0,max:10,def:.5},atrPeriod:{t:'int',min:2,max:100,def:14}}},
 sweep:{label:'Vybrání likvidity a návrat za úroveň',levels:['level','extreme'],params:{level:{t:'enum',values:LEVEL_SRC,def:'prev_day'},swingN:{t:'int',min:1,max:10,def:2},lookback:{t:'int',min:1,max:50,def:3}}},
 mss:{label:'Změna struktury s displacementem',levels:['level','extreme','mid'],params:{swingN:{t:'int',min:1,max:10,def:2},displacementK:{t:'num',min:0,max:10,def:1},atrPeriod:{t:'int',min:2,max:100,def:14},
  requireSweep:{t:'bool',def:true},sweepLevel:{t:'enum',values:LEVEL_SRC,def:'swing'},sweepLookback:{t:'int',min:1,max:50,def:3},within:{t:'int',min:1,max:100,def:10},lookback:{t:'int',min:1,max:100,def:3}}},
 engulfing:{label:'Pohlcení',levels:['level','extreme'],params:{lookback:{t:'int',min:1,max:20,def:1},wicks:{t:'bool',def:false}}},
 pin_bar:{label:'Pin bar',levels:['level','extreme'],params:{wickRatio:{t:'num',min:.3,max:.95,def:.6},bodyRatio:{t:'num',min:.01,max:.6,def:.3},closePos:{t:'num',min:.3,max:1,def:.66},lookback:{t:'int',min:1,max:20,def:1}}},
 rel_strength:{label:'Relativní síla proti jinému trhu od otevření seance',levels:[],needs:'other',params:{other:{t:'str',def:'',max:16},session:{t:'enum',values:[...SESSION_IDS,'day'],def:'london'},min:{t:'num',min:0,max:20,def:0}}},
 news_blackout:{label:'Bez důležitých zpráv v okně',levels:[],needs:'news',params:{minutes:{t:'int',min:0,max:1440,def:30},minSignal:{t:'int',min:1,max:3,def:3}}},
 cot_index:{label:'COT index (percentil za N týdnů)',levels:[],needs:'cot',params:{weeks:{t:'int',min:8,max:520,def:52},low:{t:'num',min:0,max:100,def:20},high:{t:'num',min:0,max:100,def:80},mode:{t:'enum',values:['trend','contrarian'],def:'trend'}}},
 seasonality:{label:'Sezonalita měsíce (jen předchozí roky)',levels:[],needs:'d1',params:{years:{t:'int',min:3,max:30,def:10},minAvg:{t:'num',min:0,max:20,def:0},minHit:{t:'num',min:0,max:1,def:.6}}},
 dxy_trend:{label:'Trend dolarového indexu',levels:[],needs:'dxy',params:{period:{t:'int',min:2,max:400,def:50},relation:{t:'enum',values:['auto','direct','inverse'],def:'auto'}}},
};
export const BLOCK_IDS=Object.keys(BLOCKS) as BlockId[];

export type Role='required'|'optional'|'info';
export type Condition={id:string;block:BlockId;params:Record<string,number|string|boolean>;role:Role;tf:TfRef;group?:string};
export type Leg={from:string;key:LevelKey;share:number};
export type LevelRef={from:string;key:LevelKey};
export type StrategyDef={
 name:string;version:number;markets:string[];data:DataTf;tf:{context:Tf;zone:Tf;entry:Tf};
 conditions:Condition[];
 entry:{type:'limit'|'market_on_close';from:string|null;key:LevelKey;validBars:number;side:'both'|'long'|'short';legs:Leg[]|null};
 stop:{from:string;key:LevelKey;atrK:number;pct:number;atrPeriod:number;minAtrK:number}; // from = id podmínky | 'entry' | 'signal_bar'
 // type 'zone' = proximální hrana nejbližší protilehlé zóny podmínky `from` (zone / order_block / fvg; long → nabídka nad vstupem, short → poptávka pod);
 // když žádná není nebo má R:R pod minRR → fallback: none = bez obchodu, r = k R, swing = protilehlý swing
 targets:{type:'r'|'swing'|'level'|'zone';r:number;from:string|null;key:LevelKey;swingN:number;minRR:number;obstacle:LevelRef|null;partial:{atR:number;pct:number;moveToBE:boolean}|null;fallback:'none'|'r'|'swing'};
 management:{beAtR:number|null;timeExitBars:number|null;timeExitClock:{tz:string;at:string}|null;ambiguity:'conservative'|'optimistic'};
 risk:{basePct:number;byRating:{min:number;pct:number}[];minRating:number};
 filters:{sessions:SessionId[];sessionDefs:Partial<Record<SessionId,SessionDef>>;maxTradesPerDay:number|null;maxTradesPerWeek:number|null;stopAfterLosses:number|null;
  dailyLossR:number|null;weeklyLossR:number|null;maxOpen:number;news:{minutes:number;minSignal:number}|null;dayTz:string};
 costs:{spreadMult:number;commissionR:number};
 variants:{name:string;overrides:Record<string,number|string|boolean|null>}[];
};
export type DefCheck={ok:true;def:StrategyDef}|{ok:false;errors:string[]};
export const DEF_LIMITS={markets:60,conditions:30,variants:20,nameLen:120,jsonBytes:200000};

type O=Record<string,unknown>;
const isO=(v:unknown):v is O=>!!v&&typeof v==='object'&&!Array.isArray(v);
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const MARKET=/^[A-Za-z0-9^=\/.\-]{1,16}$/;
const HHMM=/^([01]\d|2[0-3]):[0-5]\d$/;
export function validTz(tz:unknown):tz is string{if(typeof tz!=='string'||!tz||tz.length>40)return false;try{new Intl.DateTimeFormat('en-US',{timeZone:tz});return true}catch{return false}}

// ---- validace (vrací normalizovanou definici s doplněnými výchozími hodnotami, nebo seznam chyb bez hodnot)
export function validateDef(raw:unknown):DefCheck{
 const errs:string[]=[],E=(p:string,m:string)=>{if(errs.length<60)errs.push(`${p}: ${m}`)};
 if(!isO(raw))return {ok:false,errors:['definice: musí být JSON objekt']};
 try{if(JSON.stringify(raw).length>DEF_LIMITS.jsonBytes)return {ok:false,errors:[`definice: větší než ${DEF_LIMITS.jsonBytes} znaků`]}}catch{return {ok:false,errors:['definice: nejde serializovat']}}
 const known=['name','version','markets','data','tf','conditions','anyOf','entry','stop','targets','management','risk','filters','costs','variants','schema'];
 for(const k of Object.keys(raw))if(!known.includes(k))E(k,'neznámé pole');
 const num=(p:string,v:unknown,min:number,max:number,def:number|null,int=false):number=>{
  if(v===undefined||v===null){if(def===null){E(p,'chybí');return min}return def}
  if(typeof v!=='number'||!Number.isFinite(v)){E(p,'musí být číslo');return def??min}
  if(int&&!Number.isInteger(v)){E(p,'musí být celé číslo');return def??min}
  if(v<min||v>max){E(p,`mimo rozsah ${min}–${max}`);return def??min}
  return v;
 };
 const optNum=(p:string,v:unknown,min:number,max:number,int=false):number|null=>v===undefined||v===null?null:num(p,v,min,max,null,int);
 const en=<T extends string>(p:string,v:unknown,vals:readonly T[],def:T|null):T=>{if(v===undefined||v===null){if(def===null){E(p,'chybí');return vals[0]}return def}if(typeof v!=='string'||!vals.includes(v as T)){E(p,'neznámá hodnota');return def??vals[0]}return v as T};
 const name=typeof raw.name==='string'?raw.name.trim():'';
 if(!name||name.length>DEF_LIMITS.nameLen)E('name',`povinný text do ${DEF_LIMITS.nameLen} znaků`);
 const version=num('version',raw.version,1,1e6,1,true);
 const markets:string[]=[];
 if(!Array.isArray(raw.markets)||!raw.markets.length)E('markets','povinný neprázdný seznam');
 else{if(raw.markets.length>DEF_LIMITS.markets)E('markets',`nejvýš ${DEF_LIMITS.markets}`);raw.markets.slice(0,DEF_LIMITS.markets).forEach((m,i)=>{if(typeof m!=='string'||!MARKET.test(m))E(`markets[${i}]`,'neplatné id trhu');else if(markets.includes(m))E(`markets[${i}]`,'duplicita');else markets.push(m)})}
 const data=en('data',raw.data,['D1','H1'] as const,null);
 const tfo=isO(raw.tf)?raw.tf:{};if(!isO(raw.tf))E('tf','chybí objekt {context, zone, entry}');
 const tf={context:en('tf.context',tfo.context,TFS,null),zone:en('tf.zone',tfo.zone,TFS,null),entry:en('tf.entry',tfo.entry,TFS,null)};
 if(tf.entry!==data)E('tf.entry','musí být stejný jako data (D1 → D1, H1 → H1)');
 for(const k of ['context','zone'] as const)if(TF_RANK[tf[k]]<TF_RANK[tf.entry])E('tf.'+k,'nesmí být nižší než tf.entry');
 if(isO(raw.tf))for(const k of Object.keys(raw.tf))if(!['context','zone','entry'].includes(k))E('tf.'+k,'neznámé pole');
 const tfOf=(r:TfRef):Tf=>r==='context'||r==='zone'||r==='entry'?tf[r]:r;
 // podmínky
 const conds:Condition[]=[];
 if(!Array.isArray(raw.conditions)||!raw.conditions.length)E('conditions','povinný neprázdný seznam');
 else{
  if(raw.conditions.length>DEF_LIMITS.conditions)E('conditions',`nejvýš ${DEF_LIMITS.conditions}`);
  raw.conditions.slice(0,DEF_LIMITS.conditions).forEach((c,i)=>{
   const p=`conditions[${i}]`;if(!isO(c)){E(p,'musí být objekt');return}
   for(const k of Object.keys(c))if(!['id','block','params','role','tf','note','group'].includes(k))E(p+'.'+k,'neznámé pole');
   const id=typeof c.id==='string'?c.id:'c'+(i+1);
   if(c.id!==undefined&&(typeof c.id!=='string'||!ID.test(c.id)))E(p+'.id','id = písmeno + písmena/číslice/_/- (max 32)');
   if(conds.some(x=>x.id===id))E(p+'.id','duplicitní id');
   const block=en(p+'.block',c.block,BLOCK_IDS,null);
   const role=en(p+'.role',c.role,['required','optional','info'] as const,'required');
   let group:string|undefined;
   if(c.group!==undefined&&c.group!==null){if(typeof c.group!=='string'||!ID.test(c.group))E(p+'.group','id skupiny = písmeno + písmena/číslice/_/- (max 32)');else if(role!=='required')E(p+'.group','skupina NEBO jen u povinné podmínky');else group=c.group}
   const tfr=en(p+'.tf',c.tf,['context','zone','entry',...TFS] as const,'entry') as TfRef;
   if(TF_RANK[tfOf(tfr)]<TF_RANK[tf.entry])E(p+'.tf','nesmí být nižší než tf.entry');
   if(data==='D1'&&TF_RANK[tfOf(tfr)]<TF_RANK.D1)E(p+'.tf','D1 data nemají nižší TF než D1');
   const spec=BLOCKS[block]?.params??{},params:Condition['params']={};
   const rp=c.params===undefined?{}:isO(c.params)?c.params:(E(p+'.params','musí být objekt'),{});
   for(const k of Object.keys(rp))if(!(k in spec))E(`${p}.params.${k}`,'neznámý parametr bloku');
   for(const [k,s] of Object.entries(spec)){
    const v=rp[k],pp=`${p}.params.${k}`;
    if(s.t==='num'||s.t==='int')params[k]=num(pp,v,s.min,s.max,s.def,s.t==='int');
    else if(s.t==='enum')params[k]=en(pp,v,s.values,s.def);
    else if(s.t==='bool'){if(v!==undefined&&typeof v!=='boolean')E(pp,'musí být true/false');params[k]=typeof v==='boolean'?v:s.def}
    else if(s.t==='str'){if(v!==undefined&&(typeof v!=='string'||v.length>s.max))E(pp,'neplatný text');params[k]=typeof v==='string'?v:s.def}
    else if(s.t==='ref'){if(typeof v!=='string'||!ID.test(v))E(pp,'chybí id podmínky');params[k]=typeof v==='string'?v:''}
   }
   if(block==='rel_strength'&&(typeof params.other!=='string'||!MARKET.test(params.other as string)))E(p+'.params.other','neplatné id trhu');
   if(block==='cot_index'&&(params.low as number)>(params.high as number))E(p+'.params','low musí být ≤ high');
   if(block==='fib_band'&&(params.from as number)>(params.to as number))E(p+'.params','from musí být ≤ to');
   if(block==='premium_discount'&&(params.discount as number)>(params.premium as number))E(p+'.params','discount musí být ≤ premium');
   if(block==='premium_discount'){const own=tfOf(tfr),r=params.rangeTf==='same'?own:tfOf(params.rangeTf as TfRef),e=params.evalTf==='same'?own:tfOf(params.evalTf as TfRef);
    if(TF_RANK[r]<TF_RANK[e])E(p+'.params.rangeTf','rozsah nesmí být z nižšího TF než vyhodnocení');
    if(TF_RANK[e]<TF_RANK[tf.entry]||TF_RANK[r]<TF_RANK[tf.entry])E(p+'.params','TF nesmí být nižší než tf.entry')}
   if(BLOCKS[block]?.needs&&tfOf(tfr)!==tf.entry)E(p+'.tf','blok s externími daty se vyhodnocuje jen na tf.entry');
   if(block==='session_range'&&data==='D1')E(p+'.block','seance potřebují data H1');
   if(block==='sweep'||block==='mss'){const lv=block==='sweep'?params.level:params.sweepLevel;if(data==='D1'&&(lv==='asia'||lv==='london'||lv==='ny'))E(p+'.params','úroveň seance potřebuje data H1')}
   conds.push({id,block,params,role,tf:tfr,...(group?{group}:{})});
  });
  // anyOf: [[id…],[id…]] → skupiny 'or1', 'or2' … (každá podmínka nejvýš v jedné skupině)
  if(raw.anyOf!==undefined&&raw.anyOf!==null){
   if(!Array.isArray(raw.anyOf)||raw.anyOf.length>10)E('anyOf','seznam do 10 skupin (každá = seznam id podmínek)');
   else raw.anyOf.forEach((g,gi)=>{const p=`anyOf[${gi}]`;if(!Array.isArray(g)||g.length<2||g.length>DEF_LIMITS.conditions){E(p,'skupina = seznam aspoň 2 id podmínek');return}
    const gid='or'+(gi+1);if(conds.some(c=>c.id===gid)){E(p,'id podmínky koliduje se jménem skupiny');return}
    g.forEach((id,k)=>{const c=conds.find(x=>x.id===id);if(!c){E(`${p}[${k}]`,'neznámá podmínka');return}
     if(c.role!=='required')E(`${p}[${k}]`,'skupina NEBO jen z povinných podmínek');else if(c.group)E(`${p}[${k}]`,'podmínka už je v jiné skupině');else c.group=gid})});
  }
  // reference (nested_zone) jen na dřívější podmínky se zónou
  conds.forEach((c,i)=>{if(c.block!=='nested_zone')return;for(const k of ['inner','outer']){const r=conds.findIndex(x=>x.id===c.params[k]);
   if(r<0||r>=i)E(`conditions[${i}].params.${k}`,'musí odkazovat na dřívější podmínku');else if(!['zone','order_block','fvg'].includes(conds[r].block))E(`conditions[${i}].params.${k}`,'odkaz musí být zóna / order block / FVG')}});
  if(!conds.some(c=>c.role==='required'))E('conditions','aspoň jedna podmínka musí být required');
 }
 const groups=groupsOf(conds);
 for(const [g,m] of groups){if(conds.some(c=>c.id===g))E('conditions','id skupiny NEBO koliduje s id podmínky');if(m.length<2)E('conditions','skupina NEBO potřebuje aspoň 2 podmínky')}
 const condIds=new Set(conds.map(c=>c.id));
 // úroveň z podmínky, nebo ze skupiny NEBO (úroveň musí dávat každý člen skupiny)
 const levelOf=(p:string,from:unknown,key:unknown,allowSpecial:string[]=[]):{from:string;key:LevelKey}=>{
  const f=typeof from==='string'?from:'';
  if(!allowSpecial.includes(f)){
   const members=groups.get(f);
   if(members){const k=en(p+'.key',key,LEVEL_KEYS,null);if(!members.every(i=>BLOCKS[conds[i].block].levels.includes(k)))E(p+'.key','některý blok skupiny tuto úroveň nedává');return {from:f,key:k}}
   if(!condIds.has(f))E(p+'.from','neznámá podmínka');else{const c=conds.find(x=>x.id===f)!,k=en(p+'.key',key,LEVEL_KEYS,null);if(!BLOCKS[c.block].levels.includes(k))E(p+'.key','blok tuto úroveň nedává');return {from:f,key:k}}}
  return {from:f,key:en(p+'.key',key,LEVEL_KEYS,'level')};
 };
 // vstup
 const eo=isO(raw.entry)?raw.entry:(E('entry','chybí objekt'),{} as O);
 for(const k of Object.keys(eo))if(!['type','from','key','validBars','side','legs'].includes(k))E('entry.'+k,'neznámé pole');
 const etype=en('entry.type',eo.type,['limit','market_on_close'] as const,null);
 let efrom:string|null=null,ekey:LevelKey='proximal',legs:Leg[]|null=null;
 if(etype==='limit'){
  if(Array.isArray(eo.legs)){
   if(eo.legs.length<2||eo.legs.length>3)E('entry.legs','2–3 nohy');
   legs=eo.legs.slice(0,3).map((l,i)=>{const p=`entry.legs[${i}]`;if(!isO(l)){E(p,'musí být objekt');return {from:'',key:'proximal' as LevelKey,share:0}}const lv=levelOf(p,l.from,l.key);return {...lv,share:num(p+'.share',l.share,.01,1,null)}});
   const s=legs.reduce((a,l)=>a+l.share,0);if(Math.abs(s-1)>1e-6)E('entry.legs','součet share musí být 1');
   efrom=legs[0]?.from??null;ekey=legs[0]?.key??'proximal';
  }else{const lv=levelOf('entry',eo.from,eo.key);efrom=lv.from;ekey=lv.key}
 }else if(eo.legs!==undefined&&eo.legs!==null)E('entry.legs','dvě nohy jen u limitního vstupu');
 const entry={type:etype,from:efrom,key:ekey,validBars:num('entry.validBars',eo.validBars,1,500,10,true),side:en('entry.side',eo.side,['both','long','short'] as const,'both'),legs};
 // stop
 const so=isO(raw.stop)?raw.stop:(E('stop','chybí objekt'),{} as O);
 for(const k of Object.keys(so))if(!['from','key','atrK','pct','atrPeriod','minAtrK'].includes(k))E('stop.'+k,'neznámé pole');
 const sfrom=so.from===undefined?'entry':so.from,slv=levelOf('stop',sfrom,so.key??'level',['entry','signal_bar']);
 const stop={from:slv.from,key:slv.key,atrK:num('stop.atrK',so.atrK,0,20,0),pct:num('stop.pct',so.pct,0,500,0),atrPeriod:num('stop.atrPeriod',so.atrPeriod,2,100,14,true),minAtrK:num('stop.minAtrK',so.minAtrK,0,20,0)};
 if(stop.from==='entry'&&!(stop.atrK>0))E('stop.atrK','u stopu od vstupu musí být > 0');
 // cíle
 const to=isO(raw.targets)?raw.targets:(E('targets','chybí objekt'),{} as O);
 for(const k of Object.keys(to))if(!['type','r','from','key','swingN','minRR','obstacle','partial','fallback'].includes(k))E('targets.'+k,'neznámé pole');
 const ttype=en('targets.type',to.type,['r','swing','level','zone'] as const,'r');
 let tfrom:string|null=null,tkey:LevelKey='level';
 if(ttype==='level'){const lv=levelOf('targets',to.from,to.key);tfrom=lv.from;tkey=lv.key}
 if(ttype==='zone'){const c=conds.find(x=>x.id===to.from);if(!c)E('targets.from','neznámá podmínka');else if(!(ZONE_BLOCKS as readonly string[]).includes(c.block))E('targets.from','cíl zóna potřebuje podmínku zone / order_block / fvg');else tfrom=c.id;tkey='proximal'}
 const fallback=en('targets.fallback',to.fallback,['none','r','swing'] as const,'none');
 if(fallback!=='none'&&ttype!=='zone')E('targets.fallback','jen u cíle typu zone');
 let obstacle:LevelRef|null=null;
 if(to.obstacle!==undefined&&to.obstacle!==null){if(!isO(to.obstacle))E('targets.obstacle','musí být objekt');else obstacle=levelOf('targets.obstacle',to.obstacle.from,to.obstacle.key)}
 let partial:StrategyDef['targets']['partial']=null;
 if(to.partial!==undefined&&to.partial!==null){if(!isO(to.partial))E('targets.partial','musí být objekt');else{
  partial={atR:num('targets.partial.atR',to.partial.atR,.1,20,null),pct:num('targets.partial.pct',to.partial.pct,1,99,null),moveToBE:to.partial.moveToBE===undefined?true:to.partial.moveToBE===true};
  if(to.partial.moveToBE!==undefined&&typeof to.partial.moveToBE!=='boolean')E('targets.partial.moveToBE','musí být true/false')}}
 const targets={type:ttype,r:num('targets.r',to.r,.1,50,2),from:tfrom,key:tkey,swingN:num('targets.swingN',to.swingN,1,10,2,true),minRR:num('targets.minRR',to.minRR,0,50,0),obstacle,partial,fallback};
 if(partial&&ttype==='r'&&partial.atR>=targets.r)E('targets.partial.atR','musí být menší než targets.r');
 // řízení
 const mo=isO(raw.management)?raw.management:{};if(raw.management!==undefined&&!isO(raw.management))E('management','musí být objekt');
 for(const k of Object.keys(mo))if(!['beAtR','timeExitBars','timeExitClock','ambiguity'].includes(k))E('management.'+k,'neznámé pole');
 let clock:{tz:string;at:string}|null=null;
 if(mo.timeExitClock!==undefined&&mo.timeExitClock!==null){const c=mo.timeExitClock;if(!isO(c)||!validTz(c.tz)||typeof c.at!=='string'||!HHMM.test(c.at))E('management.timeExitClock','{tz: IANA zóna, at: "HH:MM"}');else clock={tz:c.tz,at:c.at}}
 const management={beAtR:optNum('management.beAtR',mo.beAtR,.1,20),timeExitBars:optNum('management.timeExitBars',mo.timeExitBars,1,5000,true),timeExitClock:clock,ambiguity:en('management.ambiguity',mo.ambiguity,['conservative','optimistic'] as const,'conservative')};
 // riziko
 const ro=isO(raw.risk)?raw.risk:{};if(raw.risk!==undefined&&!isO(raw.risk))E('risk','musí být objekt');
 for(const k of Object.keys(ro))if(!['basePct','byRating','minRating'].includes(k))E('risk.'+k,'neznámé pole');
 const byRating:{min:number;pct:number}[]=[];
 if(ro.byRating!==undefined&&ro.byRating!==null){if(!Array.isArray(ro.byRating)||ro.byRating.length>10)E('risk.byRating','seznam do 10 položek');else ro.byRating.forEach((x,i)=>{if(!isO(x)){E(`risk.byRating[${i}]`,'musí být objekt');return}byRating.push({min:num(`risk.byRating[${i}].min`,x.min,0,30,null,true),pct:num(`risk.byRating[${i}].pct`,x.pct,.01,5,null)})})}
 byRating.sort((a,b)=>a.min-b.min);
 const risk={basePct:num('risk.basePct',ro.basePct,.01,5,1),byRating,minRating:num('risk.minRating',ro.minRating,0,30,0,true)};
 // filtry
 const fo=isO(raw.filters)?raw.filters:{};if(raw.filters!==undefined&&!isO(raw.filters))E('filters','musí být objekt');
 for(const k of Object.keys(fo))if(!['sessions','sessionDefs','maxTradesPerDay','maxTradesPerWeek','stopAfterLosses','dailyLossR','weeklyLossR','maxOpen','news','dayTz'].includes(k))E('filters.'+k,'neznámé pole');
 const sessions:SessionId[]=[];
 if(fo.sessions!==undefined&&fo.sessions!==null){if(!Array.isArray(fo.sessions))E('filters.sessions','seznam seancí');else fo.sessions.forEach((s,i)=>{const v=en(`filters.sessions[${i}]`,s,SESSION_IDS,null);if(!sessions.includes(v))sessions.push(v)})}
 if(sessions.length&&data!=='H1')E('filters.sessions','vstupní okna seancí potřebují data H1');
 const sessionDefs:Partial<Record<SessionId,SessionDef>>={};
 if(fo.sessionDefs!==undefined&&fo.sessionDefs!==null){if(!isO(fo.sessionDefs))E('filters.sessionDefs','musí být objekt');else for(const [k,v] of Object.entries(fo.sessionDefs)){
  if(!SESSION_IDS.includes(k as SessionId)){E('filters.sessionDefs.'+k,'neznámá seance');continue}
  if(!isO(v)||!validTz(v.tz)||typeof v.from!=='string'||!HHMM.test(v.from)||typeof v.to!=='string'||!HHMM.test(v.to)||v.from===v.to){E('filters.sessionDefs.'+k,'{tz, from: "HH:MM", to: "HH:MM"}');continue}
  sessionDefs[k as SessionId]={tz:v.tz,from:v.from,to:v.to}}}
 let news:{minutes:number;minSignal:number}|null=null;
 if(fo.news!==undefined&&fo.news!==null){if(!isO(fo.news))E('filters.news','musí být objekt');else news={minutes:num('filters.news.minutes',fo.news.minutes,0,1440,30,true),minSignal:num('filters.news.minSignal',fo.news.minSignal,1,3,3,true)}}
 const dayTz=fo.dayTz===undefined?'America/New_York':fo.dayTz;if(!validTz(dayTz))E('filters.dayTz','neplatná časová zóna');
 const filters={sessions,sessionDefs,maxTradesPerDay:optNum('filters.maxTradesPerDay',fo.maxTradesPerDay,1,100,true),maxTradesPerWeek:optNum('filters.maxTradesPerWeek',fo.maxTradesPerWeek,1,500,true),
  stopAfterLosses:optNum('filters.stopAfterLosses',fo.stopAfterLosses,1,50,true),dailyLossR:optNum('filters.dailyLossR',fo.dailyLossR,.1,100),weeklyLossR:optNum('filters.weeklyLossR',fo.weeklyLossR,.1,500),
  maxOpen:num('filters.maxOpen',fo.maxOpen,1,100,99,true),news,dayTz:validTz(dayTz)?dayTz:'America/New_York'};
 // náklady
 const co=isO(raw.costs)?raw.costs:{};if(raw.costs!==undefined&&!isO(raw.costs))E('costs','musí být objekt');
 for(const k of Object.keys(co))if(!['spreadMult','commissionR'].includes(k))E('costs.'+k,'neznámé pole');
 const costs={spreadMult:num('costs.spreadMult',co.spreadMult,0,20,1),commissionR:num('costs.commissionR',co.commissionR,0,1,0)};
 // varianty (A/B přepisy parametrů)
 const variants:StrategyDef['variants']=[];
 if(raw.variants!==undefined&&raw.variants!==null){
  if(!Array.isArray(raw.variants)||raw.variants.length>DEF_LIMITS.variants)E('variants',`seznam do ${DEF_LIMITS.variants}`);
  else raw.variants.forEach((v,i)=>{const p=`variants[${i}]`;if(!isO(v)||typeof v.name!=='string'||!v.name.trim()||v.name.length>60||!isO(v.overrides)){E(p,'{name, overrides:{cesta: hodnota}}');return}
   const vname=String(v.name).trim();
   const ov:Record<string,number|string|boolean|null>={};
   for(const [k,x] of Object.entries(v.overrides)){if(!/^[A-Za-z0-9_.\-\[\]]{1,120}$/.test(k)||!(x===null||['number','string','boolean'].includes(typeof x))){E(`${p}.overrides`,'neplatná cesta nebo hodnota');continue}ov[k]=x as number|string|boolean|null}
   if(variants.some(x=>x.name===vname))E(p+'.name','duplicitní název');
   variants.push({name:vname,overrides:ov})});
 }
 if(errs.length)return {ok:false,errors:errs};
 const def:StrategyDef={name,version,markets,data,tf,conditions:conds,entry,stop,targets,management,risk,filters,costs,variants};
 // každá varianta musí dát platnou definici
 for(const [i,v] of variants.entries()){const r=applyOverrides(def,v.overrides);if(!r.ok)for(const e of r.errors.slice(0,5))errs.push(`variants[${i}]: ${e}`)}
 return errs.length?{ok:false,errors:errs}:{ok:true,def};
}

// ---- varianty: cesta „conditions.<id>.params.<klíč>“, „conditions.<id>.role“ nebo pole definice („targets.r“, „stop.atrK“ …)
export function applyOverrides(def:StrategyDef,ov:Record<string,number|string|boolean|null>):DefCheck{
 const x=JSON.parse(JSON.stringify(def)) as O&{conditions:O[]},errs:string[]=[];
 for(const [path,val] of Object.entries(ov)){
  const parts=path.split('.');
  let cur:O|undefined=x as O;
  if(parts[0]==='conditions'){const c=x.conditions.find(c=>c.id===parts[1]);if(!c){errs.push(`${path}: neznámá podmínka`);continue}cur=c;parts.splice(0,2)}
  if(!parts.length||parts.some(p=>p==='__proto__'||p==='constructor'||p==='prototype')){errs.push(`${path}: neplatná cesta`);continue}
  for(const p of parts.slice(0,-1)){const n:unknown=cur?.[p];if(!isO(n)){cur=undefined;break}cur=n}
  if(!cur||parts.at(-1)===undefined){errs.push(`${path}: neplatná cesta`);continue}
  cur[parts.at(-1)!]=val;
 }
 if(errs.length)return {ok:false,errors:errs};
 delete (x as O).variants;
 return validateDef(x);
}
// definice + varianty → seznam běhů (základ = index 0)
export function defRuns(def:StrategyDef):{name:string;def:StrategyDef}[]{
 const out=[{name:'základ',def}];
 for(const v of def.variants){const r=applyOverrides(def,v.overrides);if(r.ok)out.push({name:v.name,def:r.def})}
 return out;
}
// JSON text → kontrola (pro editor a import)
export function parseDefJson(text:string):DefCheck{
 let raw:unknown;
 try{raw=JSON.parse(text)}catch(e){const m=/position (\d+)/.exec(String((e as Error).message));return {ok:false,errors:['JSON: syntaktická chyba'+(m?` (znak ${m[1]})`:'')]}}
 return validateDef(raw);
}
// obecný popis (bez parametrů) – pro seznam, poznámky simulace a shrnutí
// skupiny NEBO: id → indexy členů (v pořadí definice)
export function groupsOf(conds:Pick<Condition,'group'>[]):Map<string,number[]>{
 const m=new Map<string,number[]>();conds.forEach((c,i)=>{if(!c.group)return;const a=m.get(c.group);if(a)a.push(i);else m.set(c.group,[i])});return m;
}
export const condLabel=(c:Pick<Condition,'block'|'tf'>,def:Pick<StrategyDef,'tf'>)=>`${BLOCKS[c.block].label} (${c.tf==='context'||c.tf==='zone'||c.tf==='entry'?def.tf[c.tf]:c.tf})`;
export function defOutline(def:StrategyDef):string[]{
 const req=def.conditions.filter(c=>c.role==='required').length,opt=def.conditions.filter(c=>c.role==='optional').length,info=def.conditions.length-req-opt,gr=groupsOf(def.conditions).size;
 return [
  `Data ${def.data} (kontext ${def.tf.context}, zóny ${def.tf.zone}, vstup ${def.tf.entry}); trhů ${def.markets.length}.`,
  `Podmínek ${def.conditions.length}: povinných ${req}${gr?` (z toho ${gr} ${gr===1?'skupina':'skupiny'} NEBO)`:''}, volitelných ${opt}${info?`, jen úrovně ${info}`:''} (hodnocení = počet splněných volitelných).`,
  `Vstup ${def.entry.type==='limit'?`limitem na úrovni podmínky, platnost ${def.entry.validBars} svíček${def.entry.legs?`, ${def.entry.legs.length} nohy se sdíleným stopem`:''}`:'na zavření signální svíčky'}; stop ${def.stop.from==='entry'?'od vstupu':'od úrovně'}${def.stop.atrK?` ± ${def.stop.atrK} × ATR`:''}${def.stop.pct?` ± ${def.stop.pct} % vzdálenosti`:''}.`,
  `Cíl ${def.targets.type==='r'?def.targets.r+' R':def.targets.type==='swing'?'protilehlý swing':def.targets.type==='zone'?`nejbližší protilehlá zóna${def.targets.fallback!=='none'?` (jinak ${def.targets.fallback==='r'?def.targets.r+' R':'swing'})`:''}`:'úroveň podmínky'}${def.targets.minRR?`, min. R:R ${def.targets.minRR}`:''}${def.targets.partial?`, částečný výstup ${def.targets.partial.pct} % na ${def.targets.partial.atR} R${def.targets.partial.moveToBE?' + stop na BE':''}`:''}${def.management.beAtR?`, BE od ${def.management.beAtR} R`:''}${def.management.timeExitBars?`, časový výstup po ${def.management.timeExitBars} svíčkách`:''}${def.management.timeExitClock?', časový výstup v daný čas':''}.`,
  `Riziko ${def.risk.basePct} %${def.risk.byRating.length?' (podle hodnocení)':''}${def.filters.sessions.length?`; vstupy jen v seancích ${def.filters.sessions.map(s=>SESSION_LABELS[s]).join(', ')}`:''}${def.filters.maxTradesPerDay?`; max ${def.filters.maxTradesPerDay} obchodů/den`:''}${def.filters.news?'; bez vstupu kolem důležitých zpráv':''}.`,
 ];
}
