// Offline rendering tests seed downloaded bytes; download behavior has its own HTTP tests.
const fs=require('node:fs'),path=require('node:path');
module.exports=(profile,fonts)=>{const cache=path.join(profile,'workspace/font-cache');fs.mkdirSync(cache,{recursive:true});for(const font of fonts)for(const face of require('../core/font-weights.cjs').fontFaces(font))fs.copyFileSync(path.join(__dirname,'../assets/fonts',face.file),path.join(cache,face.sha256));};
