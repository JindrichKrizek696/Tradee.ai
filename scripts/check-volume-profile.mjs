// Kontrola volume profilu: node --experimental-strip-types scripts/check-volume-profile.mjs
import {volumeProfile,hasVolume,sessionProfiles,periodKey,autoPeriod,barsBetween,dayOf} from '../lib/chart/volume-profile.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const near=(a,b,e=1e-9)=>Math.abs(a-b)<=e;
const bar=(time,o,h,l,c,volume)=>({time,open:o,high:h,low:l,close:c,volume});

// objem rovnoměrně přes rozsah svíčky
const p=volumeProfile([bar(0,10,20,10,20,100)],10);
check('rovnoměrné rozdělení: 10 řádků po 10',p.rows.length===10&&p.rows.every(r=>near(r.total,10)),p.rows.map(r=>r.total));
check('rostoucí svíčka = up objem',p.rows.every(r=>near(r.up,10)&&r.down===0));
check('součet = objem',near(p.total,100)&&p.mode==='volume');
// POC na řádku s nejvíc objemem
const q=volumeProfile([bar(0,10,20,10,20,100),bar(1,16,16,15,15,500)],10);
check('POC na řádku s nejvíc objemem',q.pocIndex===5&&near(q.poc,15.5),{poc:q.poc,i:q.pocIndex});
check('klesající svíčka = down objem',q.rows[5].down>0&&near(q.rows[5].down,500));
// value area 70 %: obsahuje POC a aspoň 70 % objemu
{const bars=[];for(let i=0;i<50;i++){const c=100+Math.sin(i/5)*5;bars.push(bar(i,c,c+1,c-1,c+.5,100+(i%7)*30))}
 const v=volumeProfile(bars,30,.7),inVa=v.rows.slice(v.vaFrom,v.vaTo+1).reduce((s,r)=>s+r.total,0);
 check('value area: obsahuje POC a ≥ 70 % objemu',v.vaFrom<=v.pocIndex&&v.vaTo>=v.pocIndex&&inVa>=v.total*.7-1e-6,{inVa,total:v.total});
 check('value area: VAH ≥ POC ≥ VAL',v.vah>=v.poc&&v.poc>=v.val);
 const all=volumeProfile(bars,30,1);check('value area 100 % = celý profil',all.vaFrom===0&&all.vaTo===29);}
// TPO bez objemu
const t=volumeProfile([bar(0,1,2,1,2),bar(1,1,1.5,1,1.2)],4);
check('bez objemu → TPO (svíčka váží 1)',t.mode==='tpo'&&near(t.total,2),t&&{mode:t.mode,total:t.total});
{const many=n=>Array.from({length:24},(_,i)=>bar(i,1,1,1,1,i<n?5:undefined));
 check('hasVolume: aspoň 75 % svíček (FX futures mají denní přestávku)',hasVolume(many(21))&&hasVolume(many(18))&&!hasVolume(many(17))&&!hasVolume([bar(0,1,1,1,1,5),bar(1,1,1,1,1)])&&!hasVolume([]));}
check('nulová šíře rozsahu: 1 řádek',volumeProfile([bar(0,5,5,5,5,10)],24).rows.length===1);
check('prázdné → null',volumeProfile([],24)===null&&volumeProfile([bar(0,1,2,1,2,0)],10,.7,'volume')===null);
check('počet řádků oříznutý 4–200',volumeProfile([bar(0,1,2,1,2,1)],1).rows.length===4&&volumeProfile([bar(0,1,2,1,2,1)],999).rows.length===200);

// období (čas grafu = pražský čas jako UTC, s)
const T=(d,h,m=0)=>Date.UTC(2026,9,d,h,m)/1000; // říjen 2026: 12. = pondělí
check('den: FX den začíná ve 23:00',periodKey('day',T(12,22,59))!==periodKey('day',T(12,23))&&periodKey('day',T(12,23))===periodKey('day',T(13,10))&&dayOf(T(13,0))===dayOf(T(12,23)));
check('týden: neděle 23:00 patří k pondělí',periodKey('week',T(11,23))===periodKey('week',T(12,9))&&periodKey('week',T(11,22))!==periodKey('week',T(11,23)));
check('měsíc',periodKey('month',T(31,12))!==periodKey('month',T(31,23))||periodKey('month',T(30,12))===periodKey('month',T(1,12)));
check('seance: Asie 22–8, Londýn 8–13, překryv 13–17, NY 17–22',periodKey('session',T(12,22))===periodKey('session',T(13,7))&&periodKey('session',T(13,8))!==periodKey('session',T(13,7))&&periodKey('session',T(13,13))!==periodKey('session',T(13,12))&&periodKey('session',T(13,17))!==periodKey('session',T(13,16))&&periodKey('session',T(13,21))!==periodKey('session',T(13,22)));
check('autoPeriod',autoPeriod('M15')==='day'&&autoPeriod('H1')==='day'&&autoPeriod('H4')==='week'&&autoPeriod('D1')==='month'&&autoPeriod('W1')===null);
{const bars=[];for(let h=0;h<48;h++)bars.push(bar(T(13,0)+h*3600,1,2,1,1.5,10));
 const s=sessionProfiles(bars,'day',10);
 check('session profily po dnech: 3 obchodní dny, indexy navazují',s.length===3&&s[0].from===0&&s[1].from===s[0].to+1&&s[2].to===47,s.map(x=>[x.from,x.to]));
 check('session profil: součet objemu za den',near(s[1].profile.total,240));}
check('barsBetween: oba směry, včetně krajů',barsBetween([bar(1,1,1,1,1),bar(2,1,1,1,1),bar(3,1,1,1,1)],3,2).length===2);
if(fails.length){console.log(`\n${fails.length} FAIL`);process.exit(1)}console.log('\nCHECK OK');
