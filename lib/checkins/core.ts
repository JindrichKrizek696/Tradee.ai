// Psychologické check-iny (nepovinné, krátké, bez hodnocení člověka): před seancí (energie, soustředění, nálada 1–5 + poznámka),
// před vstupem (FOMO? podle plánu? – dvě klepnutí) a po obchodu (zařazení). Soukromé: vidí je jen uživatel, žádný pohled správce.
// Čisté funkce – testy scripts/check-checkins.mjs.
export const KINDS={session:'Před seancí',entry:'Před vstupem',after:'Po obchodu'} as const;
export type Kind=keyof typeof KINDS;
export const SCALES=[['energy','Energie'],['focus','Soustředění'],['mood','Nálada']] as const;
export type Scale=typeof SCALES[number][0];
export const VERDICTS={plan:'Podle plánu',legit:'Legitimní ztráta',execution:'Chyba v exekuci',fomo:'FOMO',revenge:'Revenge',other:'Jiné'} as const;
export type Verdict=keyof typeof VERDICTS;
export const PRIVACY='Soukromé – vidíš jen ty. Check-iny se nikdy nesdílí, nevidí je ani správce.';
export const LIMITS={note:500,perDay:50};
export type Checkin={id:string;kind:Kind;day:string;ts:number;energy:number|null;focus:number|null;mood:number|null;fomo:boolean|null;plan:boolean|null;verdict:Verdict|null;tradeId:string|null;scenarioId:string|null;note:string};
export type CheckinInput=Omit<Checkin,'id'>;
const isDay=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'));
export const pragueDay=(ms:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
const scale=(v:unknown):number|null|undefined=>v===null||v===undefined||v===''?null:typeof v==='number'&&Number.isInteger(v)&&v>=1&&v<=5?v:undefined;
const yesNo=(v:unknown):boolean|null|undefined=>v===null||v===undefined?null:typeof v==='boolean'?v:undefined;
/** Vstup z API → záznam, nebo text chyby. Den a čas doplní server (now), den jde poslat (zpětný zápis). */
export function validateCheckin(raw:unknown,now:number):CheckinInput|string{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return 'Neplatný check-in.';
 const o=raw as Record<string,unknown>;
 if(typeof o.kind!=='string'||!Object.hasOwn(KINDS,o.kind))return 'Neznámý druh check-inu.';
 const kind=o.kind as Kind;
 const energy=scale(o.energy),focus=scale(o.focus),mood=scale(o.mood);
 if(energy===undefined||focus===undefined||mood===undefined)return 'Stupnice je 1 až 5.';
 const fomo=yesNo(o.fomo),plan=yesNo(o.plan);if(fomo===undefined||plan===undefined)return 'Odpověď ano / ne.';
 let verdict:Verdict|null=null;if(o.verdict!==undefined&&o.verdict!==null&&o.verdict!==''){if(typeof o.verdict!=='string'||!Object.hasOwn(VERDICTS,o.verdict))return 'Neznámé zařazení obchodu.';verdict=o.verdict as Verdict}
 const id=(v:unknown,max:number)=>v===undefined||v===null||v===''?null:typeof v==='string'&&v.length<=max&&/^[\w:.-]+$/.test(v)?v:undefined;
 const tradeId=id(o.tradeId,80),scenarioId=id(o.scenarioId,40);if(tradeId===undefined||scenarioId===undefined)return 'Neplatný odkaz na obchod nebo scénář.';
 const note=typeof o.note==='string'?o.note.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').trim():o.note===undefined||o.note===null?'':null;
 if(note===null)return 'Poznámka musí být text.';if(note.length>LIMITS.note)return `Poznámka může mít nejvýš ${LIMITS.note} znaků.`;
 const day=o.day===undefined||o.day===null?pragueDay(now):isDay(o.day)?o.day:null;if(!day)return 'Neplatný den.';
 if(day>pragueDay(now+864e5))return 'Check-in nejde zapsat do budoucnosti.';
 if(kind==='session'&&energy===null&&focus===null&&mood===null)return 'Vyber aspoň jednu hodnotu (energie, soustředění nebo nálada).';
 if(kind==='entry'&&fomo===null&&plan===null)return 'Odpověz aspoň na jednu otázku.';
 if(kind==='after'&&(!verdict||!tradeId))return 'Vyber, jak obchod zařadit.';
 return {kind,day,ts:now,energy:kind==='session'?energy:null,focus:kind==='session'?focus:null,mood:kind==='session'?mood:null,fomo:kind==='entry'?fomo:null,plan:kind==='entry'?plan:null,verdict:kind==='after'?verdict:null,tradeId,scenarioId,note};
}
/** Průměr stavu ze session check-inu (energie, soustředění, nálada); null = nic nevyplněno. */
export function stateOf(c:Pick<Checkin,'energy'|'focus'|'mood'>):number|null{const v=[c.energy,c.focus,c.mood].filter((x):x is number=>typeof x==='number');return v.length?v.reduce((a,b)=>a+b,0)/v.length:null}
export type Bucket={key:'low'|'mid'|'high';label:string;days:number;trades:number;avgProcess:number|null};
export const BUCKET_LABELS={low:'Nižší stav (1–2,5)',mid:'Střední stav (2,6–3,4)',high:'Vyšší stav (3,5–5)'} as const;
const bucketOf=(s:number)=>s<=2.5?'low' as const:s<3.5?'mid' as const:'high' as const;
const avg=(a:number[])=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null;
function pearson(xs:number[],ys:number[]):number|null{
 const n=xs.length;if(n<5)return null;const mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n;
 let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){sxy+=(xs[i]-mx)*(ys[i]-my);sx+=(xs[i]-mx)**2;sy+=(ys[i]-my)**2}
 return sx&&sy?Math.round(sxy/Math.sqrt(sx*sy)*100)/100:null;
}
export type Stats={sessions:number;entries:number;afters:number;buckets:Bucket[];correlation:number|null;pairs:number;verdicts:{verdict:Verdict;label:string;count:number;avgProcess:number|null}[];entry:{planYes:number;planNo:number;fomoYes:number;fomoNo:number;processPlanYes:number|null;processPlanNo:number|null};summary:string[]};
/** Stav vs. skóre procesu: den se session check-inem ↔ obchody toho dne s hodnoceným procesem. Formulace bez hodnocení člověka. */
export function checkinStats(list:readonly Checkin[],trades:readonly {id:string;day:string|null;process:number|null}[]):Stats{
 const sessions=list.filter(c=>c.kind==='session'),entries=list.filter(c=>c.kind==='entry'),afters=list.filter(c=>c.kind==='after');
 // poslední session check-in dne
 const dayState=new Map<string,number>();for(const c of [...sessions].sort((a,b)=>a.ts-b.ts)){const s=stateOf(c);if(s!==null)dayState.set(c.day,s)}
 const scored=trades.filter((t):t is {id:string;day:string;process:number}=>t.day!==null&&typeof t.process==='number');
 const acc:Record<Bucket['key'],{days:Set<string>;proc:number[]}>={low:{days:new Set(),proc:[]},mid:{days:new Set(),proc:[]},high:{days:new Set(),proc:[]}};
 const xs:number[]=[],ys:number[]=[];
 for(const [day,s] of dayState)acc[bucketOf(s)].days.add(day);
 for(const t of scored){const s=dayState.get(t.day);if(s===undefined)continue;acc[bucketOf(s)].proc.push(t.process);xs.push(s);ys.push(t.process)}
 const buckets=(['low','mid','high'] as const).map(k=>({key:k,label:BUCKET_LABELS[k],days:acc[k].days.size,trades:acc[k].proc.length,avgProcess:avg(acc[k].proc)}));
 const proc=new Map(trades.map(t=>[t.id,t.process]));
 const verdicts=(Object.keys(VERDICTS) as Verdict[]).map(v=>{const own=afters.filter(c=>c.verdict===v),ps=own.map(c=>proc.get(c.tradeId||'')).filter((x):x is number=>typeof x==='number');return {verdict:v,label:VERDICTS[v],count:own.length,avgProcess:avg(ps)}}).filter(v=>v.count>0);
 const ep=(yes:boolean)=>avg(entries.filter(c=>c.plan===yes&&c.tradeId).map(c=>proc.get(c.tradeId!)).filter((x):x is number=>typeof x==='number'));
 const entry={planYes:entries.filter(c=>c.plan===true).length,planNo:entries.filter(c=>c.plan===false).length,fomoYes:entries.filter(c=>c.fomo===true).length,fomoNo:entries.filter(c=>c.fomo===false).length,processPlanYes:ep(true),processPlanNo:ep(false)};
 const correlation=pearson(xs,ys),summary:string[]=[];
 const lo=buckets[0],hi=buckets[2];
 if(lo.trades>=3&&hi.trades>=3&&lo.avgProcess!==null&&hi.avgProcess!==null){const d=hi.avgProcess-lo.avgProcess;
  summary.push(Math.abs(d)<5?`Skóre procesu je ve dnech s nižším i vyšším stavem podobné (${lo.avgProcess} % a ${hi.avgProcess} %).`:`Ve dnech s ${d>0?'vyšším':'nižším'} stavem bylo skóre procesu v průměru o ${Math.abs(d)} b. vyšší (${d>0?hi.avgProcess:lo.avgProcess} % proti ${d>0?lo.avgProcess:hi.avgProcess} %). Je to souvislost, ne příčina.`)}
 else summary.push('Na porovnání stavu a procesu je zatím málo dat – stačí aspoň 3 hodnocené obchody ve dnech s nižším i vyšším stavem.');
 if(correlation!==null)summary.push(`Korelace stavu a skóre procesu: ${correlation.toLocaleString('cs-CZ')} (${pairsWord(xs.length)}). ${Math.abs(correlation)<0.2?'Slabá souvislost.':Math.abs(correlation)<0.5?'Mírná souvislost.':'Výraznější souvislost.'}`);
 if(entry.processPlanYes!==null&&entry.processPlanNo!==null)summary.push(`Obchody, u kterých jsi před vstupem odpověděl „podle plánu“, mají průměrný proces ${entry.processPlanYes} %, ostatní ${entry.processPlanNo} %.`);
 return {sessions:sessions.length,entries:entries.length,afters:afters.length,buckets,correlation,pairs:xs.length,verdicts,entry,summary};
}
const pairsWord=(n:number)=>`${n} ${n===1?'obchod':n>=2&&n<=4?'obchody':'obchodů'}`;
/** Řádek z DB → záznam. */
export function rowToCheckin(r:Record<string,unknown>):Checkin{
 const n=(k:string)=>r[k]===null||r[k]===undefined?null:Number(r[k]),b=(k:string)=>r[k]===null||r[k]===undefined?null:Number(r[k])===1;
 const kind=Object.hasOwn(KINDS,String(r.kind))?String(r.kind) as Kind:'session',v=String(r.verdict??'');
 return {id:String(r.id),kind,day:String(r.day).slice(0,10),ts:Number(r.ts),energy:n('energy'),focus:n('focus'),mood:n('mood'),fomo:b('fomo'),plan:b('plan'),verdict:Object.hasOwn(VERDICTS,v)?v as Verdict:null,tradeId:r.trade_id?String(r.trade_id):null,scenarioId:r.scenario_id?String(r.scenario_id):null,note:String(r.note??'')};
}
