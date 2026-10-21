// One explicitly invoked live-provider check. Never auto-retry an uncertain paid request.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { cloudOperation, cloudToolPrompt } from '../src/app/studio/cloud-tool-input.js';
import { prepareCloudImage, finishCloudImage } from '../src/app/api/studio/cloud-image-tools.js';

const root = 'D:/CanvasStudioLiveQA', file = root + '/live-edit.json';
await mkdir(root, { recursive: true });
assert.equal(await readFile(file).then(() => true, e => { if(e.code === 'ENOENT') return false; throw e; }), false, 'Previous request exists; inspect it before any manual retry');
const request = async (action, payload) => {
    const response = await fetch('http://127.0.0.1:3418/api/studio', { method:'POST', headers:{'content-type':'application/json','x-studio-request':'1'}, body:JSON.stringify({action,payload}), signal:AbortSignal.timeout(660000) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
    return result;
};
const config = await request('config', {});
assert.ok(config.hasApiKey && config.model);
const sourceBytes = await sharp(Buffer.from('<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" fill="#faf6ef"/><rect x="40" y="40" width="120" height="120" fill="#123456"/><rect x="800" y="800" width="160" height="160" fill="#18aa66"/><circle cx="512" cy="512" r="190" fill="#dc3c3c"/></svg>')).ensureAlpha().png().toBuffer();
const source = 'data:image/png;base64,' + sourceBytes.toString('base64');
await writeFile(root + '/source.png', sourceBytes);
const operation = cloudOperation({kind:'edit',sourceId:'live-shapes',sourceWidth:1024,sourceHeight:1024,left:280,top:280,width:464,height:464});
const signal = new AbortController().signal, prepared = await prepareCloudImage(source, operation, signal);
const report = { status:'submitted', at:new Date().toISOString(), host:new URL(config.baseUrl).host, model:config.model, source:'Locally generated geometric shapes; no user photos', sourceSha256:createHash('sha256').update(sourceBytes).digest('hex'), operation, remoteRequests:1 };
await writeFile(file, JSON.stringify(report,null,2));
const start = Date.now();
try {
    const response = await request('generate', {prompt:cloudToolPrompt(operation,'将中央红色圆形改为纯蓝色圆形；保持圆形的中心、半径和边缘，其他内容不变。'),size:'1024x1024',references:[prepared.image],mask:prepared.mask});
    report.responseMs = Date.now()-start;
    const generated = Buffer.from(response.dataUrl.split(',')[1],'base64');
    await writeFile(root + '/provider-output.png', generated);
    const meta = await sharp(generated).metadata(); report.providerSize = [meta.width,meta.height];
    const result = await finishCloudImage(source,response.dataUrl,operation,signal);
    const resultBytes = Buffer.from(result.split(',')[1],'base64');
    await writeFile(root + '/protected-output.png',resultBytes);
    const before = await sharp(sourceBytes).ensureAlpha().raw().toBuffer(), after = await sharp(resultBytes).ensureAlpha().raw().toBuffer();
    let outsideChanged=0,insideChanged=0;
    for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){
        const index=(y*1024+x)*4, changed=!before.subarray(index,index+4).equals(after.subarray(index,index+4));
        if(x>=280&&x<744&&y>=280&&y<744)insideChanged+=Number(changed);else outsideChanged+=Number(changed);
    }
    const center=Array.from(after.subarray((512*1024+512)*4,(512*1024+512)*4+4));
    Object.assign(report,{outsideChanged,insideChanged,center});
    assert.equal(outsideChanged,0);assert.ok(insideChanged>10000);assert.ok(center[2]>center[0]+50,'Center did not change to blue');
    report.status='passed';
} catch(error) {
    report.status='failed';report.error=String(error.message).slice(0,500);
    process.exitCode=1;
} finally {
    report.finishedAt=new Date().toISOString();
    report.limits='One synthetic local-edit request only; no portrait fidelity, broad visual quality, other operations or provider async protocol acceptance';
    await writeFile(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
