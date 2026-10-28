const fs=require('node:fs'),assert=require('node:assert/strict');
const {mapSelection}=require('../core/selection-map.cjs');
const width=10000,height=10000,alpha=new Uint8Array(width*height);
for(let y=0;y<height;y++)alpha.fill(y%256,y*width,(y+1)*width);
const start=performance.now();
const result=mapSelection({alpha,width,height,targetWidth:width,targetHeight:height,
  layers:[{id:'l',kind:'image',width,height,x:0,y:0,flipY:true}],layerId:'l'});
const elapsedMs=performance.now()-start;
for(let y=0;y<height;y++)for(let x=0;x<width;x++)assert.equal(result[y*width+x],(height-1-y)%256);
fs.writeFileSync(require('./qa-paths.cjs').path("mapping-batch/mapping-100mp.json"),JSON.stringify({pixels:width*height,elapsedMs,maxRssKiB:process.resourceUsage().maxRSS,allPixelsVerified:true},null,2));
