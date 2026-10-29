// Pracovní plocha grafu: záložky (pracovní kontexty = trh + TF + rozvržení), nedávno zavřené záložky i s kresbami a pojmenovaná rozvržení
// (viditelnost panelů, nástroje, indikátory, seance, volitelně verze strategie). Uložené per uživatel v DB (chart_tabs, chart_layouts).
// Čisté funkce – testy scripts/check-chart-workspace.mjs.
import {TFS,type Tf} from './candles.ts';
import {isChartType,type ChartType} from './chart-types.ts';
import {isFpTf,type FpTf} from './footprint.ts';
import {readStudies,type Studies} from './indicators.ts';
import {isSessionId,SESSION_DEFAULT,type SessionId} from './sessions.ts';
import {isChartTz,type ChartTz} from './tz.ts';
import {VP_PERIODS,type VpPeriod} from './volume-profile.ts';
import {DRAW_TYPES,MAX_DRAWINGS,parseDrawings,type DrawType,type Drawing} from './drawings.ts';

// --- pohled grafu: vše, co si záložka pamatuje kromě trhu ---
export type Layers={trades:boolean;news:boolean;score:boolean;sessions:boolean;paper:boolean};
export type Kind=ChartType|'footprint';
export type PaperPick='all'|'A'|'B'|'C'|'D';
export type Ind={vol:boolean;svp:boolean};
export type Svp={period:'auto'|VpPeriod;rows:number;va:number;width:number;poc:boolean;vaLines:boolean};
export type Zoom='cursor'|'right';
// panely: tree = Objekty v grafu, calc = rychlá kalkulačka pozice; focus = režim soustředění (skryté panely a lišty)
export type ChartView={tf:Tf;type:Kind;fpTf:FpTf;layers:Layers;paperVariant:PaperPick;ind:Ind;svp:Svp;studies:Studies;sessions:SessionId[];htf:boolean;log:boolean;tz:ChartTz;zoom:Zoom;tree:boolean;calc:boolean;focus:boolean;tools:DrawType[]|null};
export const SVP_DEFAULT:Svp={period:'auto',rows:24,va:70,width:70,poc:true,vaLines:true};
export const PAPER_PICKS:PaperPick[]=['all','A','B','C','D'];
export const VIEW_DEFAULT:ChartView={tf:'H4',type:'candles',fpTf:'M15',layers:{trades:true,news:true,score:true,sessions:true,paper:true},paperVariant:'all',ind:{vol:true,svp:false},svp:SVP_DEFAULT,studies:readStudies(null),sessions:[...SESSION_DEFAULT],htf:true,log:false,tz:'Europe/Prague',zoom:'cursor',tree:false,calc:false,focus:false,tools:null};
const int=(v:unknown,min:number,max:number,d:number)=>Number.isInteger(v)&&(v as number)>=min&&(v as number)<=max?v as number:d;
const obj=(v:unknown)=>(v&&typeof v==='object'&&!Array.isArray(v)?v:{}) as Record<string,unknown>;
export function readSvp(v:unknown):Svp{
 const o=obj(v);
 return {period:o.period==='auto'||(VP_PERIODS as readonly unknown[]).includes(o.period)?o.period as Svp['period']:'auto',rows:int(o.rows,4,200,24),va:int(o.va,10,100,70),width:int(o.width,10,100,70),poc:o.poc!==false,vaLines:o.vaLines!==false};
}
// tolerantní načtení pohledu (localStorage, DB, rozvržení): neznámé a neplatné hodnoty → výchozí
export function readView(raw:unknown,base:ChartView=VIEW_DEFAULT):ChartView{
 const v=obj(raw),D=base,L=obj(v.layers);
 const sessions=Array.isArray(v.sessions)?[...new Set(v.sessions.filter(isSessionId))]:D.sessions;
 const tools=Array.isArray(v.tools)?[...new Set(v.tools.filter((t):t is DrawType=>typeof t==='string'&&(DRAW_TYPES as readonly string[]).includes(t)))]:v.tools===null?null:D.tools;
 return {
  tf:(TFS as readonly unknown[]).includes(v.tf)?v.tf as Tf:D.tf,
  type:isChartType(v.type)||v.type==='footprint'?v.type as Kind:D.type,
  fpTf:isFpTf(v.fpTf)?v.fpTf:D.fpTf,
  layers:{...D.layers,...Object.fromEntries(Object.entries(L).filter(([k,x])=>k in D.layers&&typeof x==='boolean'))} as Layers,
  paperVariant:PAPER_PICKS.includes(v.paperVariant as PaperPick)?v.paperVariant as PaperPick:D.paperVariant,
  ind:{vol:v.ind?obj(v.ind).vol!==false:D.ind.vol,svp:v.ind?obj(v.ind).svp===true:D.ind.svp},
  svp:v.svp?readSvp(v.svp):D.svp,
  studies:v.studies?readStudies(v.studies):D.studies,
  sessions,
  htf:typeof v.htf==='boolean'?v.htf:D.htf,
  log:typeof v.log==='boolean'?v.log:D.log,
  tz:isChartTz(v.tz)?v.tz:D.tz,
  zoom:v.zoom==='right'||v.zoom==='cursor'?v.zoom:D.zoom,
  tree:typeof v.tree==='boolean'?v.tree:D.tree,
  calc:typeof v.calc==='boolean'?v.calc:D.calc,
  focus:typeof v.focus==='boolean'?v.focus:D.focus,
  tools,
 };
}

// --- záložky ---
export type Tab={id:string;name:string;instrument:string;layoutId:string|null;view:ChartView};
export type Closed={tab:Tab;closedAt:number;drawings:Drawing[]};
export type Workspace={tabs:Tab[];closed:Closed[];active:string|null};
export const MAX_TABS=20,MAX_CLOSED=10,MAX_TAB_NAME=40,MAX_LAYOUTS=30,MAX_LAYOUT_NAME=40;
const ID=/^[A-Za-z0-9_-]{1,40}$/;
export const emptyWorkspace=():Workspace=>({tabs:[],closed:[],active:null});
export function newTab(id:string,instrument:string,view:ChartView=VIEW_DEFAULT):Tab{return {id,name:'',instrument,layoutId:null,view:{...view}}}
// název záložky: vlastní, jinak trh a TF
export const tabTitle=(t:Tab,name:(id:string)=>string=x=>x)=>t.name||name(t.instrument)+' · '+(t.view.type==='footprint'?t.view.fpTf:t.view.tf);
export function addTab(ws:Workspace,tab:Tab):Workspace{if(ws.tabs.length>=MAX_TABS)return ws;return {...ws,tabs:[...ws.tabs,tab],active:tab.id}}
// kopie záložky hned za původní (stejný trh, TF, pohled i rozvržení)
export function duplicateTab(ws:Workspace,id:string,newId:string):Workspace{
 const i=ws.tabs.findIndex(t=>t.id===id);if(i<0||ws.tabs.length>=MAX_TABS)return ws;
 const src=ws.tabs[i],copy:Tab={...src,id:newId,name:src.name?(src.name+' (kopie)').slice(0,MAX_TAB_NAME):'',view:JSON.parse(JSON.stringify(src.view))};
 return {...ws,tabs:[...ws.tabs.slice(0,i+1),copy,...ws.tabs.slice(i+1)],active:newId};
}
export function renameTab(ws:Workspace,id:string,name:string):Workspace{
 const n=name.replace(/\s+/g,' ').trim().slice(0,MAX_TAB_NAME);
 return {...ws,tabs:ws.tabs.map(t=>t.id===id?{...t,name:n}:t)};
}
// přesun záložky (tažením): z indexu from na index to
export function moveTab(ws:Workspace,from:number,to:number):Workspace{
 if(from===to||from<0||from>=ws.tabs.length)return ws;
 const tabs=[...ws.tabs],[t]=tabs.splice(from,1);tabs.splice(Math.max(0,Math.min(tabs.length,to)),0,t);
 return {...ws,tabs};
}
// zavření: záložka jde do nedávno zavřených (nejnovější první, nejvýš 10) i se snímkem kreseb jejího trhu; aktivní se stane soused
export function closeTab(ws:Workspace,id:string,drawings:Drawing[],now:number):Workspace{
 const i=ws.tabs.findIndex(t=>t.id===id);if(i<0)return ws;
 const tabs=ws.tabs.filter(t=>t.id!==id),closed=[{tab:ws.tabs[i],closedAt:now,drawings:drawings.slice(0,MAX_DRAWINGS)},...ws.closed].slice(0,MAX_CLOSED);
 const active=ws.active===id?(tabs[Math.min(i,tabs.length-1)]?.id??null):ws.active;
 return {tabs,closed,active};
}
// obnovení zavřené záložky (na konec, aktivní); vrací i snímek kreseb k doplnění
export function restoreTab(ws:Workspace,index:number,newId:(taken:string)=>string=x=>x):{ws:Workspace;drawings:Drawing[]}|null{
 const c=ws.closed[index];if(!c||ws.tabs.length>=MAX_TABS)return null;
 const id=ws.tabs.some(t=>t.id===c.tab.id)?newId(c.tab.id):c.tab.id;
 return {ws:{tabs:[...ws.tabs,{...c.tab,id}],closed:ws.closed.filter((_,j)=>j!==index),active:id},drawings:c.drawings};
}
// kresby po obnovení: k aktuálním kresbám trhu se doplní ty ze snímku, které mezitím zmizely (podle ID); nic se nepřepisuje
export function mergeDrawings(current:Drawing[],snapshot:Drawing[]):{drawings:Drawing[];added:number}{
 const have=new Set(current.map(d=>d.id)),add=snapshot.filter(d=>!have.has(d.id)).slice(0,Math.max(0,MAX_DRAWINGS-current.length));
 return {drawings:[...current,...add],added:add.length};
}
export function updateTab(ws:Workspace,id:string,p:Partial<Pick<Tab,'instrument'|'layoutId'>>&{view?:Partial<ChartView>}):Workspace{
 return {...ws,tabs:ws.tabs.map(t=>t.id!==id?t:{...t,...(p.instrument?{instrument:p.instrument}:{}),...('layoutId' in p?{layoutId:p.layoutId??null}:{}),view:p.view?{...t.view,...p.view}:t.view})};
}

// --- rozvržení: pojmenovaný pohled bez trhu a TF; použití na záložku přepíše jen klíče rozvržení ---
export const LAYOUT_KEYS=['type','layers','ind','svp','studies','sessions','htf','log','tz','zoom','tree','calc','focus','tools'] as const;
export type LayoutKey=typeof LAYOUT_KEYS[number];
export type LayoutView=Pick<ChartView,LayoutKey>;
export type StrategyRef={strategyId:string;versionId:string;label:string};
export type Layout={id:string;name:string;view:LayoutView;strategy:StrategyRef|null};
export function layoutView(v:ChartView):LayoutView{return Object.fromEntries(LAYOUT_KEYS.map(k=>[k,JSON.parse(JSON.stringify(v[k]))])) as LayoutView}
export function applyLayout(t:Tab,l:Layout):Tab{return {...t,layoutId:l.id,view:{...t.view,...layoutView(readView(l.view,t.view))}}}
// záložka se od svého rozvržení liší (tečka „neuložené změny rozvržení“)
export const layoutChanged=(t:Tab,l:Layout|undefined)=>!!l&&viewKey(layoutView(t.view))!==viewKey(layoutView(readView(l.view,t.view)));
// stabilní klíč pro porovnání (pořadí klíčů objektů nehraje roli)
export function viewKey(v:unknown):string{
 if(Array.isArray(v))return '['+v.map(viewKey).join(',')+']';
 if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+viewKey((v as Record<string,unknown>)[k])).join(',')+'}';
 return JSON.stringify(v)??'null';
}
// neuložené změny záložky = liší se od posledního úspěšně uloženého stavu
export function dirtyTabs(saved:Workspace|null,cur:Workspace):Set<string>{
 const out=new Set<string>(),m=new Map((saved?.tabs||[]).map(t=>[t.id,viewKey(t)]));
 for(const t of cur.tabs)if(m.get(t.id)!==viewKey(t))out.add(t.id);
 return out;
}
export type SaveState='saved'|'saving'|'error'|'idle';
export const SAVE_LABELS:Record<SaveState,string>={idle:'',saved:'Uloženo',saving:'Ukládám…',error:'Chyba synchronizace – zkusit znovu'};

// --- validace (PUT přísně, DB tolerantně) ---
type R<T>={ok:true;v:T}|{ok:false;error:string};
function parseTab(raw:unknown,ids:readonly string[]):Tab|null{
 const o=obj(raw);
 if(typeof o.id!=='string'||!ID.test(o.id)||typeof o.instrument!=='string'||!ids.includes(o.instrument))return null;
 const name=typeof o.name==='string'?o.name.replace(/\s+/g,' ').trim().slice(0,MAX_TAB_NAME):'';
 return {id:o.id,name,instrument:o.instrument,layoutId:typeof o.layoutId==='string'&&ID.test(o.layoutId)?o.layoutId:null,view:readView(o.view)};
}
function parseClosed(raw:unknown,ids:readonly string[]):Closed|null{
 const o=obj(raw),tab=parseTab(o.tab,ids);if(!tab)return null;
 const at=typeof o.closedAt==='number'&&Number.isFinite(o.closedAt)?o.closedAt:0;
 const d=parseDrawings(Array.isArray(o.drawings)?o.drawings:[]);
 return {tab,closedAt:at,drawings:d.ok?d.drawings:[]};
}
export function parseWorkspace(raw:unknown,ids:readonly string[]):Workspace{
 const o=obj(raw),seen=new Set<string>(),tabs:Tab[]=[];
 for(const x of Array.isArray(o.tabs)?o.tabs:[]){const t=parseTab(x,ids);if(t&&!seen.has(t.id)&&tabs.length<MAX_TABS){seen.add(t.id);tabs.push(t)}}
 const closed=(Array.isArray(o.closed)?o.closed:[]).map(x=>parseClosed(x,ids)).filter((x):x is Closed=>!!x).slice(0,MAX_CLOSED);
 const active=typeof o.active==='string'&&tabs.some(t=>t.id===o.active)?o.active:tabs[0]?.id??null;
 return {tabs,closed,active};
}
export function validateWorkspace(raw:unknown,ids:readonly string[]):R<Workspace>{
 const o=obj(raw);
 if(!Array.isArray(o.tabs))return {ok:false,error:'Záložky musí být seznam.'};
 if(o.tabs.length>MAX_TABS)return {ok:false,error:`Nejvýš ${MAX_TABS} záložek grafu.`};
 if(o.closed!==undefined&&(!Array.isArray(o.closed)||o.closed.length>MAX_CLOSED))return {ok:false,error:'Neplatné zavřené záložky.'};
 const tabs:Tab[]=[],seen=new Set<string>();
 for(const x of o.tabs){const t=parseTab(x,ids);if(!t)return {ok:false,error:'Neplatná záložka (trh nebo ID).'};if(seen.has(t.id))return {ok:false,error:'Duplicitní ID záložky.'};seen.add(t.id);tabs.push(t)}
 const closed:Closed[]=[];
 for(const x of (o.closed as unknown[]|undefined)||[]){
  const c=obj(x);if(Array.isArray(c.drawings)){const d=parseDrawings(c.drawings);if(!d.ok)return {ok:false,error:d.error}}
  const p=parseClosed(x,ids);if(!p)return {ok:false,error:'Neplatná zavřená záložka.'};closed.push(p);
 }
 const active=typeof o.active==='string'&&seen.has(o.active)?o.active:tabs[0]?.id??null;
 return {ok:true,v:{tabs,closed,active}};
}
function parseStrategy(v:unknown):StrategyRef|null{
 const o=obj(v);
 if(typeof o.strategyId!=='string'||!/^[A-Za-z0-9_-]{1,48}$/.test(o.strategyId)||typeof o.versionId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(o.versionId))return null;
 return {strategyId:o.strategyId,versionId:o.versionId,label:typeof o.label==='string'?o.label.slice(0,80):''};
}
export function parseLayout(raw:unknown):Layout|null{
 const o=obj(raw);
 if(typeof o.id!=='string'||!ID.test(o.id))return null;
 const name=typeof o.name==='string'?o.name.replace(/\s+/g,' ').trim():'';
 if(!name||name.length>MAX_LAYOUT_NAME)return null;
 return {id:o.id,name,view:layoutView(readView(o.view)),strategy:o.strategy?parseStrategy(o.strategy):null};
}
export function parseLayouts(raw:unknown):Layout[]{
 const out:Layout[]=[],seen=new Set<string>();
 for(const x of Array.isArray(raw)?raw:[]){const l=parseLayout(x);if(l&&!seen.has(l.id)&&out.length<MAX_LAYOUTS){seen.add(l.id);out.push(l)}}
 return out;
}
export function validateLayouts(raw:unknown):R<Layout[]>{
 if(!Array.isArray(raw))return {ok:false,error:'Rozvržení musí být seznam.'};
 if(raw.length>MAX_LAYOUTS)return {ok:false,error:`Nejvýš ${MAX_LAYOUTS} rozvržení.`};
 const out:Layout[]=[],seen=new Set<string>(),names=new Set<string>();
 for(const x of raw){
  const l=parseLayout(x);if(!l)return {ok:false,error:`Rozvržení musí mít název 1–${MAX_LAYOUT_NAME} znaků.`};
  if(seen.has(l.id))return {ok:false,error:'Duplicitní ID rozvržení.'};
  if(names.has(l.name.toLowerCase()))return {ok:false,error:`Rozvržení „${l.name}“ už existuje.`};
  seen.add(l.id);names.add(l.name.toLowerCase());out.push(l);
 }
 return {ok:true,v:out};
}
