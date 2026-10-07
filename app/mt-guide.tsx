'use client';
import {useEffect,useState} from 'react';
import {Check,Download,Loader2} from 'lucide-react';
export type GuideStatus={hasKey:boolean;live:boolean;hasTrade:boolean};
type Platform='mt5'|'mt4';type Os='win'|'mac'|'vps';
// Screenshoty kroků: klíč `${platforma}-${os}-${krok}` nebo `${platforma}-${krok}` → cesta k obrázku v public/landing/mt-guide/.
// Prázdné = průvodce bez obrázků. Přidání: soubor do public/landing/mt-guide/ a řádek sem, např. 'mt5-3':'/landing/mt-guide/mt5-3.webp'.
const GUIDE_IMAGES:Record<string,string>={};
const KEY='tradee.mtguide';
const C=({children}:{children:React.ReactNode})=><code>{children}</code>;
function Chips<T extends string>({value,set,opts,label}:{value:T;set:(v:T)=>void;opts:[T,string][];label:string}){
 return <div className="mt-chips" role="radiogroup" aria-label={label}>{opts.map(([v,l])=><button key={v} type="button" role="radio" aria-checked={value===v} className={value===v?'active':''} onClick={()=>set(v)}>{l}</button>)}</div>;
}
export function MtGuide({status}:{status:GuideStatus}){
 const [p,setP]=useState<Platform>('mt5'),[os,setOs]=useState<Os>('win');
 useEffect(()=>{try{const v=JSON.parse(localStorage.getItem(KEY)||'{}');if(v.p==='mt4'||v.p==='mt5')setP(v.p);if(v.os==='win'||v.os==='mac'||v.os==='vps')setOs(v.os)}catch{}},[]);
 const remember=(np:Platform,nos:Os)=>{setP(np);setOs(nos);try{localStorage.setItem(KEY,JSON.stringify({p:np,os:nos}))}catch{}};
 const n=p==='mt5'?'5':'4',name='MetaTrader '+n,mql=p==='mt5'?'MQL5':'MQL4',ex=p==='mt5'?'ex5':'ex4',algo=p==='mt5'?'Algo Trading':'AutoTrading',mac=os==='mac';
 const paste=mac?'⌘V':'Ctrl+V';
 const steps:{title:string;done?:boolean;body:React.ReactNode}[]=[
  {title:'Co je EA a co dělá',body:<>
   <p><b>EA (Expert Advisor)</b> je malý program, který běží uvnitř MetaTraderu. TradeeSync jen čte tvoje obchody a posílá je do Tradee. <b>Sám neobchoduje</b> – nemůže otevřít ani zavřít pozici a k penězům ani k heslu účtu nemá přístup.</p>
   <p>Potřebuješ {mac?'Mac':'počítač'}, na kterém běží {name}. Nemáš ho? Stáhni si ho na webu svého brokera (nebo na <a href={`https://www.metatrader${n}.com`} target="_blank" rel="noreferrer">metatrader{n}.com</a>) a otevři si zdarma <b>demo účet</b> – na něm si všechno vyzkoušíš bez rizika.</p>
   <p>Data se posílají, jen když MetaTrader běží. Obchody z mobilu nebo z doby, kdy byl {os==='vps'?'server':'počítač'} vypnutý, EA doplní po dalším spuštění.</p></>},
  {title:'Vytvoř si klíč',done:status.hasKey,body:<p>Klíč je heslo, podle kterého Tradee pozná, že data patří tobě. Níže v sekci <b>Klíče</b> napiš název (třeba „{os==='vps'?'VPS':mac?'MacBook':'Notebook'}“) a klikni na <b>Vytvořit klíč</b>. Klíč hned zkopíruj – zobrazí se jen jednou. Když ho ztratíš, vytvoř nový a starý zruš.</p>},
  {title:'Stáhni EA a vlož ho do MetaTraderu',body:<>
   <p><a className="mt-btn dark" href={`/downloads/TradeeSync.${ex}`} download><Download size={14}/> Stáhnout TradeeSync.{ex}</a></p>
   {os==='vps'&&<p>Na VPS se připoj přes <b>Vzdálenou plochu</b> a soubor stáhni přímo v prohlížeči na VPS (nebo ho přenes přes schránku Vzdálené plochy). Vestavěný hosting MetaQuotes (Virtual Hosting) jsme nezkoušeli – použij vlastní Windows VPS.</p>}
   <ol>
    <li>V {name} klikni nahoře na <b>Soubor → Otevřít složku dat</b> (File → Open Data Folder). {mac?'Otevře se Finder.':'Otevře se okno Průzkumníka.'}</li>
    <li>Otevři složku <C>{mql}</C> a v ní <C>Experts</C>.</li>
    <li>Stažený soubor <C>TradeeSync.{ex}</C> do ní přetáhni{mac?' ze Stažených souborů':''}.</li>
    <li>Vrať se do MetaTraderu. V okně <b>Navigátor</b> (Zobrazit → Navigátor) klikni pravým tlačítkem na <b>Expert Advisors</b> a vyber <b>Obnovit</b> (Refresh). TradeeSync se objeví v seznamu.</li>
   </ol>
   {mac&&<p className="mt-tip">MetaTrader na Macu běží v kompatibilní vrstvě, postup je ale stejný. Když se Finder neotevře: ve Finderu dej <b>Přejít → Přejít na složku</b> (⇧⌘G) a vlož <C>{`~/Library/Application Support/net.metaquotes.wine.metatrader${n}/drive_c/Program Files/MetaTrader ${n}/${mql}/Experts`}</C> (u verze od brokera se název složky může lišit).</p>}
   {p==='mt4'&&<p className="mt-tip">Jen pro MT4: dole v okně <b>Terminál</b> otevři záložku <b>Historie účtu</b> (Account History), klikni do ní pravým tlačítkem a vyber <b>Celá historie</b> (All History). Jinak EA neuvidí starší obchody.</p>}
   <p className="mt-tip">Stahuješ <C>.{ex}</C> – hotový program. Soubor <a href={`/downloads/TradeeSync.mq${n}`}>.mq{n}</a> je zdrojový kód; ten MetaTrader nespustí, slouží jen ke kontrole, co EA dělá.</p></>},
  {title:'Povol připojení k Tradee',body:<ol>
   <li>Nahoře klikni na <b>Nástroje → Možnosti</b> (Tools → Options) a otevři záložku <b>Expert Advisors</b>.</li>
   <li>Zaškrtni <b>{p==='mt5'?'Povolit algoritmické obchodování':'Povolit automatické obchodování'}</b> ({p==='mt5'?'Allow algorithmic trading':'Allow automated trading'}). TradeeSync přesto nic neobchoduje – bez toho by se vůbec nespustil.</li>
   <li>Zaškrtni <b>Povolit WebRequest pro uvedené URL</b> (Allow WebRequest for listed URL), dvakrát klikni na prázdný řádek pod ním a napiš <C>https://tradee.eu</C> (bez lomítka na konci). Potvrď <b>OK</b>.</li>
   <li>V horní liště zapni tlačítko <b>{algo}</b> – musí svítit zeleně.</li>
  </ol>},
  {title:'Spusť EA na grafu',body:<><ol>
   <li>Otevři libovolný graf (třeba EURUSD). Na symbolu nezáleží – EA posílá obchody ze všech párů na účtu.</li>
   <li>V Navigátoru chyť <b>TradeeSync</b> myší a přetáhni ho na graf.</li>
   <li>Otevře se okno nastavení. Na záložce <b>Obecné</b> (Common) nech zaškrtnuté {p==='mt5'?<b>Povolit algoritmické obchodování</b>:<b>Allow live trading</b>}.</li>
   <li>Na záložce <b>Vstupy</b> (Inputs) dvakrát klikni na hodnotu u <C>TradeeKey</C>, vlož svůj klíč ({paste}) a dej <b>OK</b>.</li>
  </ol>
  <p>Hotovo, když vpravo nahoře v grafu svítí ikona EA ({p==='mt5'?'modrá čepička':'usměvavý obličej'}) a vlevo nahoře je text <b>„TradeeSync 1.1.0: synchronizováno“</b>. Šedá ikona {p==='mt4'?'nebo smutný obličej ':''}znamená vypnuté {algo}. Graf nech otevřený – po dalším spuštění MetaTraderu EA naběhne samo.</p></>},
  {title:'Ověření',done:status.live&&status.hasTrade,body:<ul className="mt-checks">
   <li className={status.live?'ok':''}>{status.live?<Check size={16}/>:<Loader2 size={16} className="spin"/>} {status.live?'EA se ozvalo – účet je níže se zelenou tečkou.':'Čekám, až se EA ozve (do minuty po spuštění).'}</li>
   <li className={status.hasTrade?'ok':''}>{status.hasTrade?<Check size={16}/>:<Loader2 size={16} className="spin"/>} {status.hasTrade?<>Dorazil první obchod – najdeš ho v <a href="/#journal">Deníku</a>.</>:'Čekám na první obchod – na demo účtu otevři a zavři malou pozici, do minuty ji uvidíš.'}</li>
   {!(status.live&&status.hasTrade)&&<li className="mt-tip">Stránka se sama obnovuje každých 15 s.</li>}
  </ul>}];
 const trouble:[string,React.ReactNode][]=[
  ['TradeeSync není v Navigátoru',<>Klikni pravým na <b>Expert Advisors → Obnovit</b>. Zkontroluj, že soubor je ve složce <C>{mql}/Experts</C> té instalace MetaTraderu, kterou používáš (každý broker má vlastní složku dat), a že je to <C>.{ex}</C>, ne <C>.mq{n}</C>.</>],
  ['V grafu svítí „povol adresu https://tradee.eu…“',<>MetaTrader blokuje připojení. Projdi krok 4 – adresa musí být přesně <C>https://tradee.eu</C>.</>],
  ['„TradeeSync zastaven: Klíč neexistuje nebo byl zrušen“',<>Vytvoř nový klíč, v grafu otevři vlastnosti EA (klávesa F7) a na záložce Vstupy ho vlož do <C>TradeeKey</C>.</>],
  ['„…nemá schválený přístup“',<>Tvůj účet Tradee ještě čeká na schválení. Jakmile ho schválíme, EA začne posílat data samo.</>],
  ['Ikona EA je šedá (nebo smutný obličej)',<>Zapni <b>{algo}</b> v horní liště a ve vlastnostech EA (F7) na záložce Obecné povol {p==='mt5'?'algoritmické obchodování':'live trading'}.</>],
  ['Nevidím starší obchody (MT4)',<>V záložce Historie účtu nastav <b>Celá historie</b>, pak EA z grafu odeber a znovu přetáhni – obchody se doplní.</>],
  ['Účet se v Tradee neobjevuje',<>Zkontroluj internet. V MetaTraderu otevři okno <b>Nástroje</b> (Toolbox, {mac?'⌘T':'Ctrl+T'}) → záložka <b>Experti</b> (Experts) a najdi řádky začínající „TradeeSync“. Text chyby nám pošli, poradíme.</>]];
 return <section className="mt-card mt-guide">
  <h2>Jak propojit MetaTrader krok za krokem</h2>
  <div className="mt-choose"><Chips label="Verze MetaTraderu" value={p} set={v=>remember(v,os)} opts={[['mt5','MetaTrader 5'],['mt4','MetaTrader 4']]}/><Chips label="Kde MetaTrader běží" value={os} set={v=>remember(p,v)} opts={[['win','Windows'],['mac','Mac'],['vps','VPS']]}/></div>
  <ol className="mt-gsteps">{steps.map((s,i)=>{const im=GUIDE_IMAGES[`${p}-${os}-${i+1}`]||GUIDE_IMAGES[`${p}-${i+1}`];return <li key={s.title} className={s.done?'done':''}>
   <div className="mt-ghead"><span className="mt-num">{s.done?<Check size={14}/>:i+1}</span><h3>{s.title}</h3>{s.done&&<span className="mt-tag ok">hotovo</span>}</div>
   <div className="mt-gbody">{s.body}{im&&<img src={im} alt={`Krok ${i+1}: ${s.title}`} loading="lazy"/>}</div></li>})}</ol>
  <h3 className="mt-trouble-h">Něco nefunguje?</h3>
  <div className="mt-trouble">{trouble.map(([q,a])=><details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
 </section>;
}
