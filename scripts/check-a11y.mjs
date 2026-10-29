// Kontrola přístupnosti: node scripts/check-a11y.mjs
// Kontrast textu na modré (a modrého textu na pozadí) ≥ 4,5 : 1 ve světlém i tmavém motivu z tokenů app/theme.css,
// viditelný fokus, omezený pohyb, ikonová tlačítka s aria-label (hlavní obrazovky; graf a replay mají vlastní kontrolu).
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const root=new URL('..',import.meta.url).pathname,src=f=>readFileSync(join(root,f),'utf8');
const css=src('app/theme.css');
// tokeny: :root{…} = světlý, :root[data-theme=dark]{…} = tmavý (pozdější blok přepisuje dřívější)
const light={},dark={};
for(const m of css.matchAll(/:root(\[data-theme=dark\])?\{([^{}]*)\}/g))for(const v of m[2].matchAll(/(--t-[\w-]+):(#[0-9a-fA-F]{3,8})\b/g))(m[1]?dark:light)[v[1]]=v[2];
const D={...light,...dark};
const hex=h=>{h=h.replace('#','');if(h.length===3)h=[...h].map(c=>c+c).join('');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255)};
const lum=h=>{const c=hex(h).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]};
const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};
const pairs=[['--t-on-inverse','--t-inverse','bílý text na modrém tlačítku / vybraném stavu'],['--t-brand-fg','--t-accent-soft','modrý text na světle modrém štítku'],['--t-brand-fg','--t-surface','modrý odkaz na dlaždici'],['--t-brand-fg','--t-surface-2','modrý odkaz na šedé ploše'],['--t-brand-fg','--t-surface-3','modrý text na tlačítku'],['--t-brand','--t-surface','modrá jako text na dlaždici'],['--t-fg','--t-surface','text'],['--t-fg-2','--t-surface','vedlejší text'],['--t-muted','--t-surface','tlumený text']];
for(const [theme,t] of [['světlý',light],['tmavý',D]])for(const [fg,bg,what] of pairs){
 if(!t[fg]||!t[bg]){check(`${theme}: ${what} – tokeny existují`,false,[fg,bg]);continue}
 const r=ratio(t[fg],t[bg]);check(`${theme}: ${what} (${t[fg]} na ${t[bg]}) ${r.toFixed(2)} : 1 ≥ 4,5`,r>=4.5);
}
check('fokus: obrys v barvě s kontrastem ≥ 3 : 1 v obou motivech',ratio(light['--t-focus-ring'],light['--t-surface'])>=3&&ratio(D['--t-focus-ring'],D['--t-surface'])>=3&&/:focus-visible\{outline:2px solid var\(--t-focus-ring\)/.test(css));
check('omezený pohyb: prefers-reduced-motion vypne animace i přechody',/prefers-reduced-motion:reduce\)\{[^}]*animation-duration:\.01ms!important[^}]*transition-duration:\.01ms!important/.test(css));
check('pilulka navigace a hlavní tlačítka s bílým textem na --t-inverse',/:root \.t-pill\{background:var\(--t-inverse\)/.test(css)&&/\.t-btn\.primary,:root \.pf-page \.mt-btn\.primary\{background:var\(--t-inverse\)/.test(css));
check('chybová hláška čitelná v tmavém motivu',/\[data-theme=dark\] \.mt-alert\{color:#fca5a5\}/.test(css)&&ratio('#fca5a5',D['--t-bad-soft'])>=4.5);
// CSS: bílý text na --t-brand (v tmavém motivu 3,9 : 1) a modrý text na modrém pozadí
const cssFiles=[];const walk=(d,out,re)=>{for(const f of readdirSync(d)){const p=join(d,f);if(statSync(p).isDirectory())walk(p,out,re);else if(re.test(f))out.push(p)}};walk(join(root,'app'),cssFiles,/\.css$/);
const bad=[];
for(const f of cssFiles){if(/market-chart|replay/.test(f))continue;const s=readFileSync(f,'utf8');
 for(const m of s.matchAll(/([^{}]+)\{([^{}]*)\}/g)){const body=m[2],bg=/background(?:-color)?:\s*([^;!}]+)/.exec(body)?.[1]||'',col=/(?<![-\w])color:\s*([^;!}]+)/.exec(body)?.[1]||'';
  if(/var\(--t-brand\)/.test(bg)&&/^(#fff|#ffffff|white)$/.test(col.trim())&&!/:root /.test(m[1]))bad.push(f.slice(root.length)+' '+m[1].trim().slice(-60)+' (bílá na --t-brand)');
  if(/var\(--t-(brand|inverse)\)|#245bff/.test(bg)&&/var\(--t-(brand|brand-fg|inverse)\)|#245bff/.test(col))bad.push(f.slice(root.length)+' '+m[1].trim().slice(-60)+' (modrá na modré)')}}
const overridden=bad.filter(b=>!(/dashboard\.css \.t-pill/.test(b)||/desk\.css \.d-dash \.t-btn\.primary/.test(b)||/profile\.css \.pf-page \.mt-btn\.primary/.test(b)));
check('CSS: žádný bílý text na --t-brand ani modrá na modré (mimo přepsané v theme.css)',!overridden.length,overridden);
// ikonová tlačítka bez popisku
const tsx=[];walk(join(root,'app'),tsx,/\.tsx$/);
function* buttons(s){let i=0;for(;;){i=s.indexOf('<button',i);if(i<0)return;let k=i+7,d=0;for(;k<s.length;k++){const c=s[k];if(c==='{')d++;else if(c==='}')d--;else if(c==='>'&&d===0)break}
 const attrs=s.slice(i+7,k);if(attrs.endsWith('/')){i=k;continue}const e=s.indexOf('</button>',k);yield {at:i,attrs,inner:s.slice(k+1,e)};i=k}}
const unlabeled=[];
for(const f of tsx){if(/market-chart|chart-page|replay/.test(f))continue;const s=readFileSync(f,'utf8');
 for(const b of buttons(s)){if(/aria-label(ledby)?=/.test(b.attrs))continue;
  let t=b.inner.replace(/<[A-Z]\w*[^<>]*?\/>/g,'');t=/\{[^{}]*[A-Za-zá-ž][^{}]*\}/.test(t)?t.replace(/\{[^{}]*\}/g,'X'):t.replace(/\{[^{}]*\}/g,'');t=t.replace(/<[^>]+>/g,'').trim();
  if(!t)unlabeled.push(f.slice(root.length)+':'+(s.slice(0,b.at).split('\n').length))}}
check('ikonová tlačítka mají aria-label',!unlabeled.length,unlabeled);
// nové komponenty: přepínače a skupiny s rolemi
check('check-iny: stupnice jako radiogroup s popisky',/role="radiogroup" aria-label=\{label\+' \(1 nízká až 5 vysoká\)'\}/.test(src('app/checkins/checkins.tsx')));
check('průvodce: volby s aria-pressed / aria-checked',/aria-pressed=\{on\}/.test(src('app/onboarding/onboarding-page.tsx'))&&/aria-checked=\{value===k\}/.test(src('app/onboarding/onboarding-page.tsx')));
check('<Term>: ovladatelný klávesnicí (button) a s popiskem',/<button type="button" className="tm-btn"[^>]*aria-label=/.test(src('app/term.tsx')));

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
