// Reuse the previously paid response. No network calls.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { finishCloudImage } from '../src/app/api/studio/cloud-image-tools.js';
const root='D:/CanvasStudioLiveQA',report=JSON.parse(await readFile(root+'/live-edit.json','utf8'));
const source=await readFile(root+'/source.png'),generated=await readFile(root+'/provider-output.png');
assert.equal(createHash('sha256').update(source).digest('hex'),report.sourceSha256);
const url=b=>'data:image/png;base64,'+b.toString('base64'),signal=new AbortController().signal;
await assert.rejects(finishCloudImage(url(source),url(generated),report.operation,signal),/未拉伸/);
const start=performance.now(),output=Buffer.from((await finishCloudImage(url(source),url(generated),report.operation,signal,undefined,true)).split(',')[1],'base64');
const meta=await sharp(output).metadata();assert.deepEqual([meta.width,meta.height],[1024,1024]);
const before=await sharp(source).ensureAlpha().raw().toBuffer(),after=await sharp(output).ensureAlpha().raw().toBuffer();
let outsideChanged=0,insideChanged=0;
for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){
 const i=(y*1024+x)*4,changed=!before.subarray(i,i+4).equals(after.subarray(i,i+4));
 if(x>=280&&x<744&&y>=280&&y<744)insideChanged+=Number(changed);else outsideChanged+=Number(changed);
}
const center=Array.from(after.subarray((512*1024+512)*4,(512*1024+512)*4+4));
assert.equal(outsideChanged,0);assert.ok(insideChanged>10000);assert.ok(center[2]>center[0]+50);
await writeFile(root+'/aligned-output.png',output);
const result={status:'passed',at:new Date().toISOString(),sourceSha256:report.sourceSha256,providerSize:report.providerSize,targetSize:[1024,1024],explicitAlignment:true,outsideChanged,insideChanged,center,elapsedMs:Math.round(performance.now()-start),newRemoteRequests:0,limits:'Single cached live geometric edit; not broad model fidelity or packaged UI acceptance'};
await writeFile(new URL('../../docs/studio-evidence/atelier-live-edit-aligned.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
