const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
const {runPsd}=require('../core/psd-service.cjs');
(async()=>{
  const width=2048,height=2048,raw=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;raw[i]=x%256;raw[i+1]=y%256;raw[i+2]=(x+y)%256;raw[i+3]=255;}
  const bytes=await sharp(raw,{raw:{width,height,channels:4}}).png().toBuffer(),input={width,height,composite:bytes,layers:[{name:'渐变',blendMode:'normal',opacity:1,hidden:false,bytes},{name:'上层',blendMode:'multiply',opacity:.5,hidden:false,bytes}]};
  let last=performance.now(),maxGap=0,ticks=0,peakRss=process.memoryUsage().rss;
  const interval=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;peakRss=Math.max(peakRss,process.memoryUsage().rss)},10);
  try{
    const start=performance.now(),encoded=await runPsd({action:'encode',input},new AbortController().signal),encodedAt=performance.now();
    const result=await runPsd({action:'decode',bytes:encoded},new AbortController().signal),decodedAt=performance.now();assert.equal(result.layers.length,2);
    const control=new AbortController(),pending=runPsd({action:'decode',bytes:encoded},control.signal);await new Promise(r=>setTimeout(r,20));const cancelling=performance.now();control.abort();await assert.rejects(pending,/取消/);
    const report={dimensions:[width,height],layers:2,totalPixels:width*height*3,encodeMs:encodedAt-start,decodeMs:decodedAt-encodedAt,encodedBytes:encoded.length,maxHostHeartbeatGapMs:maxGap,hostHeartbeatTicks:ticks,peakProcessRssMiB:peakRss/1024/1024,cancelMs:performance.now()-cancelling};
    assert.ok(ticks>2&&maxGap<500,'host remains responsive while PSD worker runs');assert.ok(report.cancelMs<1000,'worker cancellation is prompt');
    await fs.mkdir(path.resolve('test-results/psd'),{recursive:true});await fs.writeFile(path.resolve('test-results/psd/performance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{clearInterval(interval);}
})().catch(error=>{console.error(error);process.exitCode=1});
