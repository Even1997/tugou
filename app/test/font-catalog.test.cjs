const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeFonts,fontFace}=require('../core/font-catalog.cjs');
const {createLayer,validateLayers}=require('../core/layers.cjs');
const {validate}=require('../core/automation-commands.cjs');
const {resourcesIn}=require('../core/storage.cjs');
test('font names deduplicate and reject control characters',()=>{
  assert.deepEqual(normalizeFonts([{family:'Arial'},{family:'arial'},{family:'Bad\nName'},{family:''}]).map(f=>f.family),['Arial']);
});
test('font resource is persisted and switching to a system family clears custom face',()=>{
  const resource={resource:'a'.repeat(64)+'.ttf',projectId:'project',jobId:'job'},l=createLayer('text',{id:'text',fontFamily:'Custom',fontResource:resource});
  validate('layer.update',{id:l.id,patch:{fontResource:resource}});assert.ok(resourcesIn({layers:[l]}).has(resource.resource));
  const a={id:l.id,patch:{fontFamily:'Arial'}};validate('layer.update',a).apply({layers:[l]},a);assert.equal(l.fontResource,undefined);
  assert.throws(()=>validate('layer.update',{id:l.id,patch:{fontResource:{...resource,resource:'../bad.ttf'}}}));
  assert.throws(()=>validateLayers([createLayer('shape',{fontResource:resource})]));
});
test('unbuilt font cannot produce a usable face',async()=>{
  await assert.rejects(fontFace({load:async()=>({}),result:async()=>({task:{status:'running'},job:{operation:'build'}})},{projectId:'x',jobId:'y'}),/先发布/);
});
test('custom font refuses changed bytes and paths outside registered job',async()=>{
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'font-catalog-'));
  try{
    await fs.writeFile(path.join(root,'font.ttf'),Buffer.from([0,1,0,0,0,0,0,0,0,0,0,0]));
    const artifact={file:'font.ttf',mimeType:'font/ttf',sha256:'f'.repeat(64)},service={root,load:async()=>({name:'Test',published:{fontResource:{jobId:'y'}}}),result:async()=>({dir:root,task:{status:'completed'},job:{operation:'build'},result:{artifacts:[artifact]}})};
    await assert.rejects(fontFace(service,{projectId:'x',jobId:'y'}),/校验失败/);
    artifact.file='../font.ttf';await assert.rejects(fontFace(service,{projectId:'x',jobId:'y'}));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
