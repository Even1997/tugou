const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {encode,decode}=require('../core/cloud-pixels.cjs'),{cloudRunner}=require('../core/cloud-runner.cjs');
const report={checks:[],width:4096,height:4096,freeBytes:os.freemem()};
(async()=>{
 const n=4096,source=Buffer.alloc(n*n*4),mask=Buffer.alloc(source.length);
 for(let i=0;i<source.length;i+=4){const p=i/4,x=p%n,y=Math.floor(p/n),v=x>1024&&x<3072&&y>1024&&y<3072&&!(x>1500&&x<1800&&y>1500&&y<1800)?(x<1040?(x-1024)*16:255):0;source.set([x%251,y%239,37,p%256],i);mask.set([v,v,v,255],i);}
 const src=await encode({width:n,height:n,data:source}),raw=await encode({width:n,height:n,data:mask});
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-semantic-large-'));report.profile=root;
 const runner=cloudRunner(root),settings={operation:'cloudSplit',instruction:'中心主体'},start=performance.now();
 const result=await runner('finish',src,raw,settings,new AbortController().signal);report.durationMs=Math.round(performance.now()-start);
 const output=await decode(result.bytes);assert.equal(output.width,n);assert.equal(output.height,n);
 for(let i=0;i<source.length;i+=4){for(let k=0;k<3;k++)assert.equal(output.data[i+k],source[i+k]);assert.equal(output.data[i+3],Math.round(source[i+3]*mask[i]/255));}
 report.checks.push('16.78MP all RGB bytes and all alpha products exact including holes and graded edges');
 assert.equal((await fs.readdir(path.join(root,'cloud-jobs'))).length,0);report.checks.push('native temporary files cleaned');
})().catch(e=>{report.failure=e.stack;process.exitCode=1}).finally(async()=>fs.writeFile(path.resolve(__dirname,'../test-results/semantic-large.json'),JSON.stringify(report,null,2)));
