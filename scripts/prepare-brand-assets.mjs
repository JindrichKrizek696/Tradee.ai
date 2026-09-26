// Jednorázová příprava brand assetů: přejmenování, vyříznutí maskotů z bílého pozadí, zmenšení.
import sharp from 'sharp';
import {mkdirSync, renameSync, existsSync, unlinkSync, statSync} from 'node:fs';
const src='public', out='public/brand'; mkdirSync(out,{recursive:true});
const map={
 '36300803-e3ff-47aa-85ca-baaef1c1264b.png':'bear-original.png',
 'fbf99909-6795-4aeb-a373-6c9aaecda49b.png':'bull-original.png',
 '8616235f-75c7-4814-a2f6-189ed95e3fcc.png':'mascots-pair-original.png',
 '33e7de03-a010-42c9-8a78-75d7caeed8bb.png':'mascots-wordmark.png',
 '18f78c64-b629-4a33-ac29-4fbb92ecbf8a.png':'mascots-pair-watermark.png',
 '09016f6e-f571-4c87-a0cd-6cab75e09634.png':'logo-chrome.png',
 'c6a1b3c7-8e7e-4465-aa18-929c8bd75491.png':'logo-chrome-wordmark.png',
 'd8b642e5-41d0-417d-9cea-d16c1d0cb9cd.png':'logo-concepts.png'};
for(const [from,to] of Object.entries(map)) if(existsSync(`${src}/${from}`)) renameSync(`${src}/${from}`,`${out}/${to}`);
// Odstranění bílého pozadí: téměř bílý pixel dostane alpha 0, měkký přechod pod prahem.
async function cutout(file){
 const {data,info}=await sharp(`${out}/${file}`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 for(let i=0;i<data.length;i+=4){const m=Math.min(data[i],data[i+1],data[i+2]);if(m>=240)data[i+3]=0;else if(m>222)data[i+3]=Math.round(255*(240-m)/18)}
 return sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).trim().png().toBuffer();
}
const bull=await sharp(await cutout('bull-original.png')).resize({height:520}).png().toBuffer();
const bear=await sharp(await cutout('bear-original.png')).resize({height:520}).png().toBuffer();
await sharp(bull).png({compressionLevel:9}).toFile(`${out}/bull.png`);
await sharp(bear).png({compressionLevel:9}).toFile(`${out}/bear.png`);
const bm=await sharp(bull).metadata(), rm=await sharp(bear).metadata();
const overlap=40;
await sharp({create:{width:bm.width+rm.width-overlap,height:520,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
 .composite([{input:bear,left:bm.width-overlap,top:0},{input:bull,left:0,top:0}])
 .resize({width:640}).png({compressionLevel:9}).toFile(`${out}/mascots-pair.png`);
for(const f of ['mascots-wordmark.png','mascots-pair-watermark.png','logo-chrome.png','logo-chrome-wordmark.png','logo-concepts.png','mascots-pair-original.png','bull-original.png','bear-original.png']){
 const tmp=`${out}/tmp-${f}`;
 await sharp(`${out}/${f}`).resize({width:1200,withoutEnlargement:true}).png({compressionLevel:9,palette:true}).toFile(tmp);
 unlinkSync(`${out}/${f}`); renameSync(tmp,`${out}/${f}`);
}
for(const f of ['mascots-pair.png','bull.png','bear.png','logo-chrome-wordmark.png']) console.log(f, Math.round(statSync(`${out}/${f}`).size/1024)+' KB');
