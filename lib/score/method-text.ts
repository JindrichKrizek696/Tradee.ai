// Jediný zdroj textů metodiky skóre v3 (záložka Výpočet skóre, legenda Analýzy trhů, patička přehledu složek, karta skóre, tooltipy).
// Texty se skládají z konstant výpočtu (WEIGHTS, MIN_COVERAGE, LIMITS, THRESHOLDS), takže si nemohou odporovat s kódem.
// Statická landing stránka (public/landing/index.html) se kontroluje proti stejným vahám ve scripts/check-pit.mjs.
import {WEIGHTS,MIN_COVERAGE,LIMITS,COMPONENTS,type ComponentId} from './v3.ts';
import {ROWS} from '../fundamentals/breakdown.ts';
const DAY=86400000;
const LABEL:Record<ComponentId,string>={rates:'úrokové sazby',cot:'COT',trend:'trend',inflation:'inflace',employment:'zaměstnanost',gdp:'HDP',mpmi:'mPMI',spmi:'sPMI',retailSales:'Retail Sales',seasonality:'sezonalita',retailPositions:'retail pozice (kontrariánsky)'};
/** Skupiny pro landing a přehled: fundament / pozice / cena. */
export const GROUPS={fundament:['rates','inflation','employment','gdp','mpmi','spmi','retailSales'],pozice:['cot','retailPositions'],cena:['trend','seasonality']} as const satisfies Record<string,readonly ComponentId[]>;
export const groupWeight=(g:keyof typeof GROUPS)=>GROUPS[g].reduce((s,id)=>s+WEIGHTS[id],0);
export const FORMULA='Skóre = Σ(váha × složka / 2) / součet vah dostupných složek × 100, rozsah −100…+100.';
export const weightsList=()=>COMPONENTS.map(id=>`${LABEL[id]} ${WEIGHTS[id]} %`).join(', ');
const METHOD_MISSING_SHORT=`Chybějící nebo zastaralé složky se nepočítají a váhy ostatních se přepočtou; pod ${MIN_COVERAGE} % dostupných vah je skóre pozastaveno.`;
export const METHOD={
 summary:`Jedenáct složek −2…+2 s pevnými vahami: ${weightsList()}. ${FORMULA} Vlastní měnové indexy průměrují složky párů vůči sedmi ostatním měnám; nejde o oficiální burzovní index.`,
 missing:`Chybějící nebo zastaralá složka se nezapočítá (není nula) a váhy ostatních se přepočtou. Pod ${MIN_COVERAGE} % dostupných vah je skóre pozastaveno.`,
 freshness:(staleAfterHours:number)=>`Limity stáří: COT ${LIMITS.cot/DAY} dní od zveřejnění (CFTC v pátek 15:30 ET, pozice k úterý; = ${LIMITS.cot/DAY+3} dní od data pozic), retail pozice ${LIMITS.retailPositions/3600000} h od snímku, měsíční makro ${LIMITS.monthly/DAY} dní a čtvrtletní řady (HDP) ${LIMITS.quarterly/DAY} dní od konce období, denní trend ${LIMITS.trend/DAY} dní, sazby a hodnocení trhu práce podle ověření zdroje banky do ${staleAfterHours} h.`,
 card:`${FORMULA} Body u složek dávají dohromady celkové skóre.`,
 paused:`Skóre je pozastaveno, dokud nebude dostupných alespoň ${MIN_COVERAGE} % vah.`,
 legend:`FX páry a měnové indexy mají skóre v3 z 11 složek s pevnými vahami (${COMPONENTS.map(id=>LABEL[id].replace(' (kontrariánsky)','')).join(', ')}); chybějící data se vynechají (nepočítají se jako nula) a pod ${MIN_COVERAGE} % dostupných vah je skóre pozastaveno. Akcie, indexy, krypto, komodity a USD/CZK (bez fundamentu) mají technický model.`,
 breakdownFoot:(direction:string)=>`Body = prostý součet hodnot složek (každá −2…+2). Celkem = Σ(váha × složka / 2) / součet vah dostupných složek × 100, rozsah −100…+100. Příspěvek v bodech je podíl složky na tomto čísle; součet příspěvků = skóre. ${METHOD_MISSING_SHORT} Přepínačem u složky ji vypneš z Bodů i Celkem tohoto přehledu (počítá se pak jako chybějící); volba se pamatuje a platí pro všechny trhy. ${direction}.`,
 pit:'Stav k datu ukazuje skóre přesně tak, jak bylo uložené v daném čase (nejbližší snímek ≤ zvolený čas), včetně tehdejších vstupů. Záznamy před zavedením plných snímků jsou označené „rekonstruováno z historie“ – mají skóre a příspěvky, ale ne vstupní čísla.',
};
/** Popis složky pro tooltip (z ROWS – stejný text jako v přehledu). */
export const componentInfo=(id:string)=>ROWS.find(r=>r.id===id)?.info??'';
