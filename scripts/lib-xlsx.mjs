// Minimální čtečka xlsx bez závislostí (zip přes centrální adresář + node:zlib) – jen hodnoty buněk jednoho listu.
import {inflateRawSync} from 'node:zlib';

function unzip(buf){
 let eocd=-1;for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--)if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break}
 if(eocd<0)throw Error('xlsx: chybí konec zip adresáře');
 const n=buf.readUInt16LE(eocd+10);let p=buf.readUInt32LE(eocd+16);const files=new Map();
 for(let k=0;k<n;k++){
  if(buf.readUInt32LE(p)!==0x02014b50)throw Error('xlsx: vadný adresář');
  const method=buf.readUInt16LE(p+10),csize=buf.readUInt32LE(p+20),nl=buf.readUInt16LE(p+28),el=buf.readUInt16LE(p+30),cl=buf.readUInt16LE(p+32),off=buf.readUInt32LE(p+42);
  const name=buf.toString('utf8',p+46,p+46+nl);
  files.set(name,()=>{const ln=buf.readUInt16LE(off+26),le=buf.readUInt16LE(off+28),s=off+30+ln+le,d=buf.subarray(s,s+csize);return (method===8?inflateRawSync(d):d).toString('utf8')});
  p+=46+nl+el+cl;
 }
 return files;
}
const unxml=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const colIdx=ref=>{let c=0;for(const ch of /^[A-Z]+/.exec(ref)[0])c=c*26+ch.charCodeAt(0)-64;return c-1};

/** List `sheetName` jako matice hodnot (řetězce / čísla / null). */
export function readXlsxSheet(buf,sheetName){
 const z=unzip(buf),get=n=>{const f=z.get(n);if(!f)throw Error('xlsx: chybí '+n);return f()};
 const wb=get('xl/workbook.xml'),rels=get('xl/_rels/workbook.xml.rels');
 const sh=[...wb.matchAll(/<sheet\b[^>]*>/g)].map(m=>m[0]).find(t=>unxml(/name="([^"]*)"/.exec(t)?.[1]??'')===sheetName);
 if(!sh)throw Error('xlsx: list '+sheetName+' nenalezen');
 const rid=/r:id="([^"]*)"/.exec(sh)[1];
 const rel=[...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m=>m[0]).find(t=>new RegExp(`Id="${rid}"`).test(t));
 const target=/Target="([^"]*)"/.exec(rel)[1].replace(/^\/?(xl\/)?/,'');
 const ss=z.has('xl/sharedStrings.xml')?[...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m=>unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t=>t[1]).join(''))):[];
 const rows=[];
 for(const rm of get('xl/'+target).matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)){
  const row=[];
  for(const cm of (rm[1]??'').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
   const attrs=cm[1],ref=/r="([A-Z]+)\d+"/.exec(attrs)?.[1];if(!ref)continue;
   const t=/t="([^"]*)"/.exec(attrs)?.[1],v=/<v>([\s\S]*?)<\/v>/.exec(cm[2]??'')?.[1],is=/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(cm[2]??'')?.[1];
   row[colIdx(ref)]=t==='s'?ss[Number(v)]??null:t==='inlineStr'?unxml(is??''):t==='str'?unxml(v??''):v===undefined?null:Number(v);
  }
  rows.push(Array.from(row,x=>x===undefined?null:x));
 }
 return rows;
}
