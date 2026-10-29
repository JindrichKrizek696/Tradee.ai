// Kontrola detailu sezonality (rozptyl, stabilita, detrend, dny v týdnu, CSV) a COT indexu (okna 26/52/156):
// node --experimental-strip-types scripts/check-season-cot.mjs
import {seasonDetail,monthOfYear,dayOfWeek,yearDrift,seasonCsv,LOOKBACKS} from '../lib/seasonality.ts';
import {cotSeries,cotIndex,cotBands,cotSnapshotText,COT_WINDOWS} from '../lib/cot-index.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const near=(a,b,e=1e-9)=>Math.abs(a-b)<e;

// ---- sezonalita: 10 let, říjen = 1..10 (+ trend), ostatní měsíce = 0.5
const yrs=Array.from({length:10},(_,i)=>2016+i);
const months={};for(let m=1;m<=12;m++)months[m]={years:yrs.map((y,i)=>({year:y,path:[],logReturn:m===10?i+1:0.5}))};
const price={asOf:'2026-10-02',checkedAt:'',sourceUrl:'https://src',reference:1,gma50:1,gma200:1,trend:0,months,currentMonth:10,currentYear:2026,currentPath:[],pricePath:[]};
check('lookbacky 3/5/10/15/20',LOOKBACKS.join()==='3,5,10,15,20',LOOKBACKS);
let s=seasonDetail(price,10,10);
check('průměr, medián, min/max',near(s.avg,5.5)&&near(s.median,5.5)&&s.min===1&&s.max===10&&s.n===10,s);
check('směrodatná odchylka (výběrová)',near(s.sd,Math.sqrt(82.5/9)),s.sd);
check('stabilita: obě poloviny stejný směr',s.first.n===5&&s.second.n===5&&near(s.first.avg,3)&&near(s.second.avg,8)&&s.stable===true,s);
check('bez varování při plném vzorku',s.warning===null,s.warning);
s=seasonDetail(price,10,5);
check('vzorek 5 let = posledních 5',s.n===5&&s.years[0].year===2021&&near(s.avg,8),s.years);
s=seasonDetail(price,10,20);
check('vzorek 20 let: použito 10 a varování',s.n===10&&s.requested===20&&/jen 10 let z požadovaných 20/.test(s.warning),s.warning);
s=seasonDetail(price,10,3);
check('vzorek 3 roky: varování malý vzorek',s.n===3&&/Malý vzorek/.test(s.warning)&&s.stable===null,s.warning);
const drift=yearDrift(price);
check('drift roku = průměr měsíců roku',near(drift.byYear.get(2016),(1+11*0.5)/12),drift.byYear.get(2016));
s=seasonDetail(price,10,10,true);
check('detrend odečte drift každého roku',near(s.years[0].value,1-(1+5.5)/12)&&s.detrend===true,s.years[0]);
const mix={...price,months:{...months,3:{years:yrs.map((y,i)=>({year:y,path:[],logReturn:i<5?-1:1}))}}};
check('nestabilní: poloviny s opačným znaménkem',seasonDetail(mix,3,10).stable===false,seasonDetail(mix,3,10));
const moy=monthOfYear(price,10);
check('měsíce v roce: 12 řádků',moy.length===12&&near(moy[9].avg,5.5)&&near(moy[0].avg,0.5),moy.map(m=>m.avg));
check('chybějící historie',seasonDetail(undefined,1,10).n===0&&/chybí/.test(seasonDetail(undefined,1,10).warning),null);
// dny v týdnu: pondělí 2026-10-05 … pátek 2026-10-09, po víkendu 12. 10.
const path=[['2026-10-02',100],['2026-10-05',101],['2026-10-06',101],['2026-10-07',100],['2026-10-08',100],['2026-10-09',102],['2026-10-12',102]].map(([date,value])=>({date,value}));
const dw=dayOfWeek(path);
check('dny v týdnu: výnos proti předchozímu obchodnímu dni',dw.rows[0].n===2&&near(dw.rows[0].avg,100*Math.log(1.01)/2)&&dw.rows[4].n===1&&near(dw.rows[4].avg,100*Math.log(1.02))&&dw.days===6,dw.rows);
const csv=seasonCsv({instrument:'EUR/USD',source:'ECB',asOf:'2026-10-02',detail:seasonDetail(price,10,20,true),moy,dow:dw});
check('CSV: parametry, použitá léta, detrend a varování',/použito let;10/.test(csv)&&/požadovaný vzorek \(let\);20/.test(csv)&&/bez trendu;ano/.test(csv)&&/varování;K dispozici/.test(csv)&&/\nPo;2;/.test(csv),csv.slice(0,400));

// ---- COT index
const hist=Array.from({length:60},(_,i)=>({date:new Date(Date.UTC(2025,8,2)+i*7*864e5).toISOString().slice(0,10),openInterest:1000,groups:{lev:{long:500+i*10,short:500,spread:0,net:i*10}}}));
const contract={contract:'X',code:'1',isProxy:false,sourceUrl:'',checkedAt:'',history:hist};
const pts=cotSeries(contract,'lev');
check('řada: změna za týden a datum zveřejnění (úterý + 3 dny)',pts.length===60&&pts[0].change===null&&pts[1].change===10&&pts[0].published==='2025-09-05',pts.slice(0,2));
check('okna 26/52/156',COT_WINDOWS.join()==='26,52,156',COT_WINDOWS);
let ix=cotIndex(pts,26);
check('index 26: nejvyšší hodnota v okně = 100',ix.index===100&&ix.n===26&&ix.short===false&&ix.min===340&&ix.max===590,ix);
check('percentil 26: aktuální nad všemi (shoda napůl)',near(ix.percentile,100*(25+.5)/26),ix.percentile);
check('pásma 20/80',near(ix.low,340+.2*250)&&near(ix.high,340+.8*250),ix);
ix=cotIndex(pts,156);
check('okno 156: jen 60 reportů → short',ix.n===60&&ix.short===true&&ix.requested===156&&ix.index===100,ix);
ix=cotIndex(pts,52,30);
check('index v historickém bodě',ix.n===31&&ix.index===100,ix);
const mid=cotIndex(pts.map((p,i)=>({...p,net:i===59?295:p.net})),52);
check('index uprostřed rozpětí',near(mid.index,100*(295-80)/(580-80)),mid);
check('málo dat → bez indexu',cotIndex(pts.slice(0,5),26).index===null,null);
check('klouzavá pásma pro graf',cotBands(pts,26).length===60,null);
const txt=cotSnapshotText({market:'EUR',report:'TFF',group:'Leveraged funds',contract:'EURO FX',p:pts.at(-1),idx:cotIndex(pts,156)});
check('snímek do scénáře: datum pozic i zveřejnění, index a kratší historie',/pozice k 2026-10-20/.test(txt)&&/zveřejněno 2026-10-23/.test(txt)&&/COT index 100/.test(txt)&&/kratší historie než 156/.test(txt),txt);

console.log(fails.length?`\n${fails.length} CHYB`:'\nVše v pořádku.');
if(fails.length)process.exit(1);
