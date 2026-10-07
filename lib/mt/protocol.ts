// Protokol EA TradeeSync → /api/mt/ingest (verze 1). Čistá validace bez závislostí.
export const MAX_EVENTS=500,MAX_BYTES=1_000_000,PROTOCOL=1;
export type Side='buy'|'sell';
export type AccountInfo={platform:'mt4'|'mt5';login:string;server:string;company:string;currency:string;leverage:number;mode:'demo'|'real'|'contest';name:string;ea:string};
export type DealEvent={id:string;type:'deal';ts:number;deal:string;position:string;order:string;symbol:string;side:Side;entry:'in'|'out'|'inout'|'out_by';volume:number;price:number;commission:number;swap:number;fee:number;profit:number;magic:number;comment:string;reason:string;dealType:string;sl:number;tp:number;digits:number;point:number;tickSize:number;tickValue:number;spread:number;priceRequested:number;balance:number};
export type ModifyEvent={id:string;type:'position_modify';ts:number;position:string;symbol:string;slOld:number;slNew:number;tpOld:number;tpNew:number;price:number};
export type OrderEvent={id:string;type:'order';ts:number;order:string;position:string;symbol:string;orderType:string;state:'placed'|'modified'|'canceled'|'expired'|'filled'|'rejected';volume:number;priceOpen:number;priceRequested:number;sl:number;tp:number;expiration:number;comment:string;magic:number};
export type AccountEvent={id:string;type:'account';ts:number;balance:number;equity:number;margin:number;leverage:number;currency:string};
export type PositionSnap={position:string;symbol:string;side:Side;volume:number;priceOpen:number;priceCurrent:number;sl:number;tp:number;profit:number;swap:number;mfePrice:number;maePrice:number;mfeMoney:number;maeMoney:number;spread:number;openTs:number};
export type StateEvent=PositionSnap&{id:string;type:'position_state';ts:number};
export type MtEvent=DealEvent|ModifyEvent|OrderEvent|AccountEvent|StateEvent;
export type Snapshot={ts:number;balance:number;equity:number;margin:number;positions:PositionSnap[]};
export type Batch={v:1;account:AccountInfo;events:MtEvent[];snapshot?:Snapshot};

// Druhy polí: id = ID (1–80 znaků [\w:.#-], číslo se převede na text), tk = ticket (1–40 znaků, stejný formát),
// sym = symbol (0–32, bez ctrl chars), txt = text (0–64, bez ctrl chars), mag = magic (konečné číslo, -9e18…9e18, chybí → 0),
// cur = měna (0–8 písmen, velká), n = konečné číslo (chybí → 0), ts = čas v ms 2000–2100, a|b = výčet; '?' = nepovinné.
type Spec=Record<string,string>;
const ACCOUNT:Spec={platform:'mt4|mt5',login:'id',server:'txt',company:'txt',currency:'cur',leverage:'n',mode:'demo|real|contest',name:'txt',ea:'txt'};
const SNAP_POS:Spec={position:'tk',symbol:'sym',side:'buy|sell',volume:'n',priceOpen:'n',priceCurrent:'n',sl:'n',tp:'n',profit:'n',swap:'n',mfePrice:'n',maePrice:'n',mfeMoney:'n',maeMoney:'n',spread:'n',openTs:'ts?'};
const EVENTS:Record<string,Spec>={
 deal:{deal:'tk',position:'tk',order:'tk?',symbol:'sym',side:'buy|sell',entry:'in|out|inout|out_by',volume:'n',price:'n',commission:'n',swap:'n',fee:'n',profit:'n',magic:'mag',comment:'txt',reason:'txt',dealType:'txt',sl:'n',tp:'n',digits:'n',point:'n',tickSize:'n',tickValue:'n',spread:'n',priceRequested:'n',balance:'n'},
 position_modify:{position:'tk',symbol:'sym',slOld:'n',slNew:'n',tpOld:'n',tpNew:'n',price:'n'},
 order:{order:'tk',position:'tk?',symbol:'sym',orderType:'txt',state:'placed|modified|canceled|expired|filled|rejected',volume:'n',priceOpen:'n',priceRequested:'n',sl:'n',tp:'n',expiration:'n',comment:'txt',magic:'mag'},
 account:{balance:'n',equity:'n',margin:'n',leverage:'n',currency:'cur'},
 position_state:SNAP_POS,
};
const MIN_TS=Date.UTC(2000,0,1),MAX_TS=Date.UTC(2100,0,1);

function field(kind:string,v:unknown):[boolean,unknown]{
 const opt=kind.endsWith('?'),k=opt?kind.slice(0,-1):kind,missing=v===undefined||v===null||v==='';
 if(k==='n')return missing?[true,0]:[typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<1e15,v];
 if(k==='mag')return missing?[true,0]:[typeof v==='number'&&Number.isFinite(v),typeof v==='number'?Math.max(-9e18,Math.min(9e18,v)):v];
 if(k==='ts')return missing?[opt,0]:[typeof v==='number'&&Number.isInteger(v)&&v>=MIN_TS&&v<MAX_TS,v];
 if(k==='id'){if(missing)return [opt,''];const s=typeof v==='number'&&Number.isInteger(v)?String(v):v;return [typeof s==='string'&&/^[\w:.#-]{1,80}$/.test(s),s]}
 if(k==='tk'){if(missing)return [opt,''];const s=typeof v==='number'&&Number.isInteger(v)?String(v):v;return [typeof s==='string'&&/^[\w:.#-]{1,40}$/.test(s),s]}
 if(k==='sym'){const s=missing?'':v;return [typeof s==='string'&&s.length<=32&&!/[\u0000-\u001f]/.test(s),s]}
 if(k==='txt'){const s=missing?'':v;return [typeof s==='string'&&s.length<=64&&!/[\u0000-\u001f]/.test(s),s]}
 if(k==='cur'){const s=missing?'':v;return typeof s==='string'&&/^[A-Za-z]{0,8}$/.test(s)?[true,s.toUpperCase()]:[false,s]}
 if(missing)return [opt,''];
 return [typeof v==='string'&&k.split('|').includes(v),v];
}
function pick(spec:Spec,obj:unknown,path:string):Record<string,unknown>|string{
 if(!obj||typeof obj!=='object'||Array.isArray(obj))return `${path}: očekáván objekt.`;
 const o=obj as Record<string,unknown>,out:Record<string,unknown>={};
 for(const [name,kind] of Object.entries(spec)){const [ok,v]=field(kind,o[name]);if(!ok)return `${path}.${name}: neplatná hodnota.`;out[name]=v}
 return out;
}
const bad=(error:string)=>({ok:false as const,error});
export function parseBatch(raw:unknown):{ok:true;batch:Batch}|{ok:false;error:string}{
 const o=raw as Record<string,unknown>;
 if(!o||typeof o!=='object'||o.v!==PROTOCOL)return bad('Nepodporovaná verze protokolu (v).');
 const account=pick(ACCOUNT,o.account,'account');if(typeof account==='string')return bad(account);
 if(!account.login||!account.server)return bad('account: chybí login nebo server.');
 if(!Array.isArray(o.events))return bad('events musí být pole.');
 if(o.events.length>MAX_EVENTS)return bad(`Nejvýš ${MAX_EVENTS} událostí v dávce.`);
 const events:MtEvent[]=[];
 for(let i=0;i<o.events.length;i++){
  const e=o.events[i] as Record<string,unknown>|null,t=e&&typeof e==='object'?e.type:undefined,spec=typeof t==='string'&&Object.hasOwn(EVENTS,t)?EVENTS[t]:undefined;
  if(!spec)return bad(`events[${i}]: neznámý typ.`);
  const head=pick({id:'id',ts:'ts'},e,`events[${i}]`);if(typeof head==='string')return bad(head);
  const body=pick(spec,e,`events[${i}]`);if(typeof body==='string')return bad(body);
  events.push({...body,...head,type:t} as MtEvent);
 }
 let snapshot:Snapshot|undefined;
 if(o.snapshot!==undefined&&o.snapshot!==null){
  const s=o.snapshot as Record<string,unknown>,head=pick({ts:'ts',balance:'n',equity:'n',margin:'n'},s,'snapshot');if(typeof head==='string')return bad(head);
  if(!Array.isArray(s.positions)||s.positions.length>MAX_EVENTS)return bad(`snapshot.positions musí být pole (nejvýš ${MAX_EVENTS}).`);
  const positions:PositionSnap[]=[];
  for(let i=0;i<s.positions.length;i++){const p=pick(SNAP_POS,s.positions[i],`snapshot.positions[${i}]`);if(typeof p==='string')return bad(p);positions.push(p as PositionSnap)}
  snapshot={...(head as Omit<Snapshot,'positions'>),positions};
 }
 return {ok:true,batch:{v:1,account:account as AccountInfo,events,snapshot}};
}
export const snapshotEvents=(s:Snapshot):StateEvent[]=>s.positions.map(p=>({...p,id:`p:${p.position}:${s.ts}`,type:'position_state',ts:s.ts}));
export const eventPosition=(e:MtEvent)=>'position' in e?e.position:'';
