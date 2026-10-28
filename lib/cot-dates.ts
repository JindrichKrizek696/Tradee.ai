// COT: CFTC zveřejňuje report v pátek 15:30 ET (21:30 Praha); pozice jsou k úterý téhož týdne (= datum reportu).
// Svátek v USA posune zveřejnění (obvykle o den); tady standardní úterý + 3 dny. Čisté funkce – testy scripts/check-score-v3.mjs.
export const COT_PUBLISH_LAG_DAYS=3;
const DAY=86400000,WD=['neděle','pondělí','úterý','středa','čtvrtek','pátek','sobota'];
const at=(iso:string)=>Date.parse(iso.slice(0,10)+'T00:00:00Z');
/** Datum zveřejnění (YYYY-MM-DD) k datu pozic. */
export const cotPublished=(reportDate:string)=>new Date(at(reportDate)+COT_PUBLISH_LAG_DAYS*DAY).toISOString().slice(0,10);
/** Začátek dne zveřejnění (ms UTC) – od něj se počítá stáří COT. */
export const cotPublishedAt=(reportDate:string)=>at(reportDate)+COT_PUBLISH_LAG_DAYS*DAY;
const dmw=(iso:string)=>{const d=new Date(at(iso));return `${WD[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth()+1}.`};
/** „pozice k úterý 6. 10.“ */
export const cotPositionsLabel=(reportDate:string)=>'pozice k '+dmw(reportDate);
/** „zveřejněno pátek 9. 10.“ */
export const cotPublishedLabel=(reportDate:string)=>'zveřejněno '+dmw(cotPublished(reportDate));
/** „pozice k úterý 6. 10. · zveřejněno pátek 9. 10.“ */
export const cotDatesLabel=(reportDate:string)=>cotPositionsLabel(reportDate)+' · '+cotPublishedLabel(reportDate);
