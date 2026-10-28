const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const cp = require('node:child_process');
const children = [], spawn = cp.spawn;
cp.spawn = (...args) => {
  const child = spawn(...args);
  if (args[1]?.some(a => String(a).endsWith('cloud-worker.cjs'))) {
    const entry = { pid: child.pid, exited: false };
    child.on('close', () => { entry.exited = true; });
    children.push(entry);
  }
  return child;
};
const { cloudRunner } = require('../core/cloud-runner.cjs');
const { encode, decode } = require('../core/cloud-pixels.cjs');
const { TaskQueue } = require('../core/tasks.cjs');
const arbitrary=process.argv.includes('--mask');
const report = { checks: [], children, dimensions: '4096x4096', arbitrary, freeBytes: os.freemem(), timings: {} };
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tugou-cloud-large-'));
  report.profile = root;
  const n = 4096, data = Buffer.alloc(n*n*4);
  for (let i=0;i<data.length;i+=4) { data[i]=i/4%251; data[i+1]=91; data[i+2]=17; data[i+3]=i/4%256; }
  const source = await encode({ data, width:n, height:n });
  const runner = cloudRunner(root), settings = { operation:'cloudEdit', left:1024, top:1024, width:2048, height:2048, feather:0, instruction:'test' };
  let maskBytes,maskData;
  if(arbitrary){
    maskData=Buffer.alloc(n*n*4);
    for(let y=1024;y<3072;y++)for(let x=1024;x<3072;x++)if(x+y<5600&&!(x>1200&&x<1600&&y>1200&&y<1600))maskData[(y*n+x)*4+3]=Math.min(255,(x-1024)*16);
    maskBytes=await encode({width:n,height:n,data:maskData});
    Object.assign(settings,{maskMode:'asset',maskId:'large-mask',maskChannel:'alpha',invertMask:false});
  }
  let ticks=0; const timer=setInterval(()=>ticks++,10);
  try {
    let start=performance.now();
    const prepared=await runner('prepare',source,null,settings,new AbortController().signal,false,maskBytes);
    report.timings.prepareMs=Math.round(performance.now()-start);
    assert.equal(prepared.size.width,n);
    const mask=await decode(prepared.mask);
    assert.equal(mask.data[3],255); assert.equal(mask.data[(2048*n+2048)*4+3],0);
    report.checks.push('16MP source and mask dimensions/coverage preserved');
    const generatedData=Buffer.alloc(n*n*4); for(let i=0;i<generatedData.length;i+=4){generatedData[i]=200;generatedData[i+3]=255;}
    const generated=await encode({data:generatedData,width:n,height:n});
    start=performance.now();
    const output=await runner('finish',prepared.canonical,generated,prepared.settings,new AbortController().signal,false,maskBytes);
    report.timings.finishMs=Math.round(performance.now()-start);
    const actual=await decode(output.bytes);
    for(let y=0;y<n;y++){
      const first=y>=1024&&y<3072?1024:n;
      assert.deepEqual(actual.data.subarray(y*n*4,(y*n+first)*4),data.subarray(y*n*4,(y*n+first)*4));
      if(first<n) assert.deepEqual(actual.data.subarray((y*n+3072)*4,(y+1)*n*4),data.subarray((y*n+3072)*4,(y+1)*n*4));
    }
    assert.deepEqual([...actual.data.subarray((2048*n+2048)*4,(2048*n+2048)*4+4)],[200,0,0,255]);
    if(arbitrary){for(let i=0;i<maskData.length;i+=4)if(maskData[i+3]===0){for(let k=0;k<4;k++)assert.equal(actual.data[i+k],data[i+k]);}report.checks.push('every protected pixel of large polygon, hole and graded mask verified');}
    report.checks.push('16MP every protected RGBA byte and edited center verified');
    assert.ok(ticks>20); report.mainLoopTicks=ticks;
    const queue=new TaskQueue(root); await queue.init();
    const before=children.length;
    const task=await queue.start('cancel native', signal=>runner('prepare',source,null,settings,signal,false,maskBytes), {kind:'cloud-tool'});
    for(let i=0;children.length===before&&i<1000;i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(children.length,before+1);assert.equal(children.at(-1).exited,false);
    await queue.cancel(task.id); await queue.shutdown();
    assert.equal(queue.tasks[0].status,'cancelled');assert.equal(children.at(-1).exited,true);
    assert.equal((await fs.readdir(path.join(root,'cloud-jobs'))).length,0);
    report.checks.push('cancel then shutdown awaits actual owned native process exit and cleans files');
    const restored=new TaskQueue(root); await restored.init();
    assert.equal(restored.tasks[0].status,'cancelled');assert.equal(children.length,before+1);
    report.checks.push('restart retains cancellation without starting any child');
  } finally { clearInterval(timer); }
})().catch(e=>{ report.failure=e.stack; process.exitCode=1; }).finally(async()=>{
  await fs.writeFile(path.resolve(__dirname,`../test-results/${arbitrary?'cloud-mask-large-runtime':'cloud-large-runtime'}.json`),JSON.stringify(report,null,2));
});
