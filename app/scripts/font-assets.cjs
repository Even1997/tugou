// Prepare immutable font assets and their original licenses for the resource-only release.
const fs=require('node:fs/promises'),path=require('node:path'),{hashFile}=require('../core/runtime-files.cjs');
const {builtinFonts}=require('../core/builtin-fonts.cjs'),{fontFaces}=require('../core/font-weights.cjs'),{assetName}=require('../core/font-downloads.cjs');
(async()=>{
  const source=path.resolve(__dirname,'../assets/fonts'),out=path.resolve(process.argv[2]||'test-results/font-assets-v1');await fs.mkdir(out,{recursive:true});
  const manifest=[],licenses=[];
  for(const font of builtinFonts){
    licenses.push(`${font.name} / ${font.family}\n${font.source}\n${await fs.readFile(path.join(source,font.licenseFile),'utf8')}\n${await fs.readFile(path.join(source,path.dirname(font.file),'SOURCE.md'),'utf8')}`);
    for(const face of fontFaces(font)){
      const file=path.join(source,face.file);if((await fs.stat(file)).size!==face.bytes||await hashFile(file)!==face.sha256)throw Error('Font source changed: '+face.id);
      const asset=assetName(face);await fs.copyFile(file,path.join(out,asset));manifest.push({id:face.id,family:font.family,weight:face.weight,asset,bytes:face.bytes,sha256:face.sha256,source:font.source});
    }
  }
  await fs.writeFile(path.join(out,'FONT-LICENSES.txt'),licenses.join('\n\n--------------------\n\n'));
  await fs.writeFile(path.join(out,'catalog.json'),JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({directory:out,families:builtinFonts.length,faces:manifest.length,assets:new Set(manifest.map(f=>f.asset)).size,bytes:manifest.reduce((n,f)=>n+f.bytes,0)}));
})().catch(error=>{console.error(error);process.exitCode=1;});
