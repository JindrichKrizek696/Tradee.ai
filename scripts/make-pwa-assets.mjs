// Vygeneruje PWA obrázky do public/pwa/ (maskable ikony, monochromatický odznak, screenshoty do manifestu).
// Spuštění: node scripts/make-pwa-assets.mjs   (potřebuje ImageMagick 7 – příkaz `magick`)
// Jen plné barvy: ImageMagick nevykreslí SVG přechody z loga, proto se značka kreslí jako polygony.
import {spawnSync} from 'node:child_process';
import {mkdirSync,existsSync} from 'node:fs';
const OUT='public/pwa';mkdirSync(OUT,{recursive:true});
const FONT=['/System/Library/Fonts/SFNS.ttf','/System/Library/Fonts/Helvetica.ttc'].find(existsSync);
const run=args=>{const r=spawnSync('magick',args,{stdio:'inherit'});if(r.status!==0)throw Error('magick selhal: '+args.join(' '))};
// značka Tradee (viewBox 340×232): tělo „T“ a modrý trojúhelník
const BODY=[[70,1],[217,1],[217,152],[138,231],[138,91],[159,70],[1,70]],TRI=[[243,1],[339,1],[243,97]];
const poly=(pts,s,x,y)=>'polygon '+pts.map(([a,b])=>`${(x+a*s).toFixed(2)},${(y+b*s).toFixed(2)}`).join(' ');
// značka o šířce w se středem v (cx,cy)
const mark=(w,cx,cy,body,tri)=>{const s=w/340,x=cx-w/2,y=cy-232*s/2;return ['-fill',body,'-draw',poly(BODY,s,x,y),'-fill',tri,'-draw',poly(TRI,s,x,y)]};
const INK='#111317',LIGHT='#f4f5f7',BLUE='#2a5cf5';

// maskable: plné pozadí přes celý čtverec, značka uvnitř bezpečné zóny (kruh o průměru 80 %); šířka 56 % → úhlopříčka ~68 %
for(const n of [192,512])run(['-size',`${n}x${n}`,`xc:${INK}`,...mark(n*.56,n/2,n/2,LIGHT,BLUE),'-strip','-depth','8',`${OUT}/icon-maskable-${n}.png`]);
// odznak pro Android: bílá silueta na průhledném pozadí (systém použije jen alfa kanál)
run(['-size','96x96','xc:none',...mark(78,48,48,'#fff','#fff'),'-strip',`${OUT}/badge-96.png`]);

// screenshoty: stylizovaný náhled aplikace v barvách světlého motivu (skutečný obsah je za přihlášením)
function shot(file,W,H,narrow){
 const a=['-size',`${W}x${H}`,'xc:#ebf0f9',
  '(','-size',`${Math.round(W*1.3)}x${Math.round(H*1.7)}`,'radial-gradient:#c9d8ff-#ebf0f9',')','-geometry',`+${Math.round(-W*.15)}+${Math.round(-H*.6)}`,'-composite'];
 const pad=narrow?40:64,top=narrow?60:40;
 a.push(...mark(narrow?64:56,pad+(narrow?32:28),top+28,'#0b0c0e','#245bff'));
 if(FONT)a.push('-font',FONT);
 a.push('-fill','#0b0c0e','-pointsize',narrow?'40':'34','-annotate',`+${pad+(narrow?84:76)}+${top+42}`,'Tradee');
 if(!narrow){ // navigační ostrůvek
  const nx=W/2-330;a.push('-fill','#ffffff','-draw',`roundrectangle ${nx},${top} ${nx+660},${top+54} 27,27`,'-fill','#ebf0f9','-draw',`roundrectangle ${nx+8},${top+8} ${nx+150},${top+46} 19,19`);
  ['Dashboard','Analýza trhů','Reporty','Kalendář','Deník'].forEach((t,i)=>a.push('-fill',i?'#687080':'#0b0c0e','-pointsize','17','-annotate',`+${nx+30+i*128}+${top+33}`,t));
 }
 const hy=narrow?220:170;
 a.push('-fill','#0b0c0e','-pointsize',narrow?'58':'50','-annotate',`+${pad}+${hy}`,narrow?'Síla měn\na COT pozice':'Síla měn, COT pozice a deník obchodů');
 a.push('-fill','#687080','-pointsize',narrow?'28':'24','-annotate',`+${pad}+${hy+(narrow?150:52)}`,narrow?'Veřejná data. Dohledatelné výpočty.\nVlastní rozhodnutí.':'Veřejná data. Dohledatelné výpočty. Vlastní rozhodnutí.');
 // karty
 const cards=narrow?[[pad,hy+260,W-pad,hy+760],[pad,hy+800,W-pad,H-80]]:[[pad,hy+110,W*.58,H-60],[W*.58+28,hy+110,W-pad,H-60]];
 for(const [x1,y1,x2,y2] of cards)a.push('-fill','#ffffff','-stroke','#e2e6ee','-strokewidth','2','-draw',`roundrectangle ${x1},${y1} ${x2},${y2} 28,28`,'-stroke','none');
 // karta 1: sloupce síly měn
 {const [x1,y1,x2,y2]=cards[0],vals=[.9,.62,.35,.12,-.18,-.4,-.66,-.85],cur=['USD','EUR','GBP','CHF','JPY','CAD','AUD','NZD'],mid=(y1+y2)/2+20,bw=(x2-x1-80)/vals.length;
  a.push('-fill','#0b0c0e','-pointsize',narrow?'30':'24','-annotate',`+${x1+32}+${y1+52}`,'Síla měn');
  a.push('-fill','#e2e6ee','-draw',`rectangle ${x1+40},${mid} ${x2-40},${mid+2}`);
  vals.forEach((v,i)=>{const bx=x1+40+i*bw+bw*.2,h=Math.abs(v)*((y2-y1)/2-90),c=v>0?'#16a34a':'#dc2626';
   a.push('-fill',c,'-draw',`roundrectangle ${bx.toFixed(1)},${(v>0?mid-h:mid+2).toFixed(1)} ${(bx+bw*.6).toFixed(1)},${(v>0?mid:mid+2+h).toFixed(1)} 6,6`,'-fill','#687080','-pointsize',narrow?'20':'16','-annotate',`+${(bx+bw*.3-(narrow?18:15)).toFixed(1)}+${y2-24}`,cur[i])});}
 // karta 2: křivka P/L
 {const [x1,y1,x2,y2]=cards[1],n=24,pts=[];let v=0;
  for(let i=0;i<n;i++){v+=Math.sin(i*1.7)*.6+.35;pts.push([x1+40+i*(x2-x1-80)/(n-1),y2-60-v*(y2-y1-160)/12])}
  a.push('-fill','#0b0c0e','-pointsize',narrow?'30':'24','-annotate',`+${x1+32}+${y1+52}`,'Deník · P/L');
  a.push('-fill','none','-stroke','#245bff','-strokewidth',narrow?'6':'5','-draw','polyline '+pts.map(p=>p.map(q=>q.toFixed(1)).join(',')).join(' '),'-stroke','none');}
 a.push('-strip','-depth','8',`${OUT}/${file}`);
 run(a);
}
shot('screenshot-narrow.png',750,1334,true);
shot('screenshot-wide.png',1440,900,false);
console.log('hotovo → '+OUT);
