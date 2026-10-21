import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const base=process.env.STUDIO_TEST_URL,root=process.env.STUDIO_QUALITY_DIR;
if(base!=='http://127.0.0.1:3439'||!root||!path.isAbsolute(root))throw Error('Explicit isolated QA required');
await mkdir(root,{recursive:true});
const request=async(action,payload)=>{const r=await fetch(base+'/api/studio',{method:'POST',headers:{'content-type':'application/json','x-studio-request':'1'},body:JSON.stringify({action,payload})});if(!r.ok)throw Error(await r.text());return r.json()};
assert.ok((await request('list')).location.includes('atelier-qa'));
const sources=[['portrait-a',path.resolve('../../风格试验/C组-照片人物测试01/人物参考/01-person.png')],['portrait-b',path.resolve('../../风格试验/C组-照片人物测试01/人物参考/02-person.png')],['pet',path.join(root,'samples/chelsea.png')]];
const hash=b=>createHash('sha256').update(b).digest('hex'),measurements=[];
for(const[name,file]of sources){const original=await readFile(file),meta=await sharp(original).metadata(),source=await sharp(original).ensureAlpha().raw().toBuffer();
 for(const tool of name==='pet'?['cutout','upscale']:['cutout','upscale','alpha']){const projectId='photo-quality',options=tool==='cutout'?{feather:0,choke:0,matte:'none'}:tool==='alpha'?{feather:.3,choke:1,matte:'white'}:{scale:2,model:'general'},input=tool==='alpha'?await readFile(path.join(root,name+'-cutout.png')):original,dataUrl='data:image/png;base64,'+input.toString('base64');
  const sourceId=tool==='alpha'?name+'-grayscale-v2':name;
  let previous=(await request('tool-list',{projectId})).find(j=>j.sourceId===sourceId&&j.tool===tool&&j.status==='completed'&&JSON.stringify(j.options)===JSON.stringify(options));
  if(previous&&(await request('tool-source',{id:previous.id,projectId})).dataUrl!==dataUrl)previous=undefined;
  const id=previous?.id||name+'-'+tool+'-'+Date.now();if(!previous)await request('tool-submit',{id,projectId,sourceId,name,tool,options,dataUrl});
  let job;for(let i=0;i<600;i++){job=(await request('tool-list',{projectId})).find(j=>j.id===id);if(['completed','failed','cancelled'].includes(job?.status))break;await new Promise(r=>setTimeout(r,200));}assert.equal(job?.status,'completed',job?.error);
  const result=await request('tool-result',{id,projectId}),bytes=Buffer.from(result.dataUrl.split(',')[1],'base64'),output=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const scale=tool==='upscale'?2:1;assert.deepEqual([output.info.width,output.info.height],[meta.width*scale,meta.height*scale]);
  let transparent=0,soft=0,opaque=0;for(let n=0;n<output.data.length;n+=4){const a=output.data[n+3];if(a===0)transparent++;else if(a===255)opaque++;else soft++;if(tool==='cutout')for(let c=0;c<3;c++)assert.equal(output.data[n+c],source[n+c]);}
  const alphaStats=(await sharp(bytes).stats()).channels[3]||{min:255,max:255};
  // Lanczos resampling can make the maximum 254 rather than 255; validate range, not one exact opaque byte.
  if(tool==='cutout')assert.ok(alphaStats.min<=16&&alphaStats.max>=239&&soft>0);
  const outputFile=path.join(root,name+'-'+tool+'.png');await writeFile(outputFile,bytes);
  const black=await sharp(bytes).flatten({background:'#17191f'}).resize({height:500}).png().toBuffer(),white=await sharp(bytes).flatten({background:'#ffffff'}).resize({height:500}).png().toBuffer(),w=(await sharp(white).metadata()).width;
  const comparison=path.join(root,name+'-'+tool+'-backgrounds.png');await sharp({create:{width:w*2,height:500,channels:3,background:'#ffffff'}}).composite([{input:white,left:0,top:0},{input:black,left:w,top:0}]).png().toFile(comparison);
  measurements.push({name,tool,input:[meta.width,meta.height],output:[output.info.width,output.info.height],taskMs:Date.parse(job.finishedAt)-Date.parse(job.createdAt),reusedVerifiedResult:!!previous,alphaRange:[alphaStats.min,alphaStats.max],transparent,soft,opaque,originalRGBPreserved:tool==='cutout',file:outputFile,comparison});console.log(JSON.stringify(measurements.at(-1)));
 }
 assert.equal(hash(await readFile(file)),hash(original));
}
const result={at:new Date().toISOString(),channel:'offline packaged local tools, no model API requests',sources:{portraits:'User supplied local reference files; not a measured identity dataset',pet:'Chelsea, Stefan van der Walt, CC0; https://scikit-image.org/docs/stable/api/skimage.data#skimage.data.chelsea; https://raw.githubusercontent.com/scikit-image/scikit-image/v0.21.0/skimage/data/chelsea.png'},measurements,limits:'No ground-truth mattes or high-resolution originals. These checks prove dimensions, RGB/alpha mechanics and repeatable outputs; visual quality must be assessed separately.'};
await writeFile(new URL('../../docs/studio-evidence/atelier-photo-quality.json',import.meta.url),JSON.stringify(result,null,2));
