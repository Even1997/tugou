const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {pngName,batchTargets,writeExclusive}=require('../core/image-export.cjs');
const {exportDefaultPath,rememberExportDirectory}=require('../core/image-export.cjs');
test('image destination survives reload and falls back for missing or invalid directories',async t=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-save-'));t.after(()=>fs.rm(profile,{recursive:true,force:true}));
 const fallback=path.join(profile,'pictures'),folder=path.join(profile,'中文 图片');await fs.mkdir(fallback);await fs.mkdir(folder);
 assert.equal(await exportDefaultPath(profile,fallback,'a.png'),path.join(fallback,'a.png'));
 await rememberExportDirectory(profile,path.join(folder,'original.png'));
 const fresh=require('../core/image-export.cjs');assert.equal(await fresh.exportDefaultPath(profile,fallback,'b.png'),path.join(folder,'b.png'));
 assert.equal(await exportDefaultPath(profile,fallback),folder);
 await fs.rmdir(folder);assert.equal(await exportDefaultPath(profile,fallback,'c.png'),path.join(fallback,'c.png'));
 for(const value of ['bad json',JSON.stringify({directory:'../elsewhere'}),JSON.stringify({directory:7})]){
  await fs.writeFile(path.join(profile,'image-export.json'),value);assert.equal(await exportDefaultPath(profile,fallback),fallback);
 }
});
test('safe cross-platform file names',()=>{assert.equal(pngName('CON'),'_CON');assert.equal(pngName('a/b:c*'),'a_b_c_');assert.equal(pngName('尾部. '),'尾部');assert.equal(pngName(''),'画板');assert.equal(pngName('x'.repeat(300)).length,100);});
test('batch avoids existing, case-insensitive and same-batch collisions',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-export-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'Board.png'),'original');
 const targets=await batchTargets(dir,['board','Board','同名','同名','../escape']);
 assert.deepEqual(targets.map(x=>path.basename(x)),['board (2).png','Board (3).png','同名.png','同名 (2).png','.._escape.png']);
 for(const p of targets)assert.equal(path.dirname(p),dir);
 await writeExclusive(targets[0],Buffer.from('new'));assert.equal(await fs.readFile(targets[0],'utf8'),'new');
 await assert.rejects(writeExclusive(targets[0],Buffer.from('overwrite')),e=>e.code==='EEXIST');
 assert.equal(await fs.readFile(targets[0],'utf8'),'new');assert.equal(await fs.readFile(path.join(dir,'Board.png'),'utf8'),'original');
 const race=(await batchTargets(dir,['race']))[0];await fs.writeFile(race,'external');await assert.rejects(writeExclusive(race,Buffer.from('overwrite')),e=>e.code==='EEXIST');assert.equal(await fs.readFile(race,'utf8'),'external');
 for(const names of [[],Array(501).fill('x'),[null],['x'.repeat(257)]])await assert.rejects(batchTargets(dir,names));
});
