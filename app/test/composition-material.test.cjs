const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createLayer}=require('../core/layers.cjs'),{materialPlan}=require('../core/composition-material.cjs');
const {materialSource}=require('../core/materials.cjs'),{ProjectStore}=require('../core/storage.cjs'),{saveImage}=require('../core/generation.cjs');
const board=(id,patch={})=>createLayer('group',{id,name:id,artboard:true,x:0,y:0,width:320,height:240,background:'#ffffff',...patch});
const layer=(id,patch={})=>createLayer('shape',{id,name:id,parentId:'board',...patch});
const doc=layers=>({name:'工程',width:320,height:240,background:'#fff',modules:[],recipes:[],assets:[],jobs:[],layers:[board('board'),...layers]});
test('board snapshot uses its own size/background and excludes other artboards',()=>{
  const source=doc([layer('one'),board('other',{width:800}),layer('outside',{parentId:'other'})]),before=structuredClone(source);
  const result=materialPlan(source,'board');
  assert.equal(result.kind,'board');assert.equal(result.document.width,320);assert.equal(result.document.height,240);
  assert.equal(result.document.background,'#ffffff');assert.deepEqual(result.document.layers.map(l=>l.id),['one']);assert.deepEqual(source,before);
});
test('single layer keeps transform, opacity, effects and bitmap mask without siblings or board background',()=>{
  const mask={bitmap:{id:'mask',resource:'mask.png'},density:80},effects=[{type:'shadow',enabled:true}];
  const source=doc([layer('one',{rotation:30,opacity:.5,mask,effects,locked:true}),layer('two')]);
  const result=materialPlan(source,'one'),saved=result.document.layers[0];
  assert.equal(result.document.background,'transparent');assert.deepEqual(result.document.layers.map(l=>l.id),['one']);
  assert.equal(saved.rotation,30);assert.equal(saved.opacity,.5);assert.deepEqual(saved.mask,mask);assert.deepEqual(saved.effects,effects);
  assert.equal(result.name,'one');assert.equal(result.boardId,'board');assert.equal(result.document.width,320);
});
test('nested layers preserve ancestor transforms/masks and omit other branches',()=>{
  const source=doc([createLayer('group',{id:'group',parentId:'board',x:50,scaleX:2,opacity:.8,mask:{density:90}}),layer('one',{parentId:'group'}),layer('two',{parentId:'group'}),layer('three')]);
  const result=materialPlan(source,'one');assert.deepEqual(result.document.layers.map(l=>l.id),['group','one']);
  assert.equal(result.document.layers[0].x,50);assert.equal(result.document.layers[0].scaleX,2);assert.equal(result.document.layers[1].parentId,'group');
});
test('group exports retain child visibility and internal clipping/mask relations',()=>{
  const source=doc([createLayer('group',{id:'group',parentId:'board'}),layer('base',{parentId:'group'}),layer('clipped',{parentId:'group',clipping:true}),layer('masked',{parentId:'group',maskSourceId:'base'}),layer('hidden',{parentId:'group',visible:false}),layer('outside')]);
  const result=materialPlan(source,'group');assert.equal(result.document.layers.length,5);
  assert.equal(result.document.layers.find(l=>l.id==='clipped').clipping,true);assert.equal(result.document.layers.find(l=>l.id==='masked').maskSourceId,'base');
  assert.equal(result.document.layers.find(l=>l.id==='hidden').visible,false);
});
test('explicitly saving a hidden layer reveals only that layer and its ancestors in the snapshot',()=>{
  const source=doc([createLayer('group',{id:'group',parentId:'board',visible:false}),layer('one',{parentId:'group',visible:false})]);
  const result=materialPlan(source,'one');assert.ok(result.document.layers.every(l=>l.visible));assert.ok(source.layers.slice(1).every(l=>l.visible===false));
});
test('standalone adjustments and missing external dependencies fail with an actionable message',()=>{
  assert.throws(()=>materialPlan(doc([createLayer('adjustment',{id:'adj',parentId:'board'})]),'adj'),/调整图层/);
  assert.throws(()=>materialPlan(doc([layer('base'),layer('clipped',{clipping:true})]),'clipped'),/剪贴底层/);
  assert.throws(()=>materialPlan(doc([layer('base'),layer('masked',{maskSourceId:'base'})]),'masked'),/外部蒙版/);
  assert.throws(()=>materialPlan(doc([]),'missing'),/不存在/);
});
async function exporter(options={}){
  const code=(await fs.readFile(path.join(__dirname,'../renderer/save-composition-material.js'),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
  const f={disposed:0,writes:0,rendered:null};
  const context={materialPlan,window:{tugou:{storeRaster:async(bytes,name)=>{f.writes++;return options.store?options.store(bytes,name):{id:'asset',name,resource:'snapshot.png',width:320,height:240};}}},
    Compositor:class{async export(document,renderOptions){f.rendered={document,options:renderOptions};return options.render?options.render():[1,2,3];}dispose(){f.disposed++;}}};
  vm.runInNewContext(code+'\nthis.save=saveCompositionMaterial;',context);f.save=context.save;return f;
}
test('asset insertion uses the latest document, retains concurrent edits and marks the item as processed',async()=>{
  let finish;const f=await exporter({render:()=>new Promise(resolve=>{finish=resolve;})}),controller=new AbortController();
  let current={projectId:'project',document:doc([layer('one')]),disabled:false};
  const saving=f.save('one',{time:123,signal:controller.signal,read:()=>current,commit:document=>{current={...current,document};return true;}});
  current={...current,document:{...current.document,name:'新名称',layers:[...current.document.layers,layer('new')],assets:[{id:'existing'}]}};
  finish([1]);const asset=await saving;
  assert.equal(current.document.name,'新名称');assert.ok(current.document.layers.some(l=>l.id==='new'));assert.equal(current.document.assets.length,2);
  assert.equal(materialSource(asset),'processed');assert.equal(asset.layerSnapshot.layerId,'one');assert.equal(f.rendered.options.time,123);assert.equal(f.disposed,1);
});
test('project switch, cancellation and rejected commits never insert a result into the wrong document',async()=>{
  for(const mode of ['switch','cancel','busy','reject']){
    let commits=0,current={projectId:'a',document:doc([layer('one')]),disabled:false};const controller=new AbortController();
    const f=await exporter({store:async()=>{if(mode==='switch')current={...current,projectId:'b'};if(mode==='cancel')controller.abort();if(mode==='busy')current.disabled=true;return {id:'asset',name:'one'};}});
    await assert.rejects(f.save('one',{signal:controller.signal,read:()=>current,commit:()=>{commits++;return false;}}));
    assert.equal(commits,mode==='reject'?1:0);assert.equal(current.document.assets.length,0);assert.equal(f.disposed,1);
  }
});
test('render failure and pre-cancellation do not write a resource and always release the compositor',async()=>{
  for(const cancel of [false,true]){
    const f=await exporter({render:()=>{throw Error('字体加载失败');}}),controller=new AbortController();if(cancel)controller.abort();
    await assert.rejects(f.save('one',{signal:controller.signal,read:()=>({projectId:'p',document:doc([layer('one')])}),commit:()=>assert.fail('must not commit')}));
    assert.equal(f.writes,0);assert.equal(f.disposed,1);
  }
});
test('stored snapshot survives a real project save and reopen',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-material-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new ProjectStore(root);await store.init();const initial=await store.create('素材入库');
  let document={...initial.document,layers:doc([layer('one')]).layers};
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6wkkAAAAASUVORK5CYII=','base64');
  const f=await exporter({render:()=>png,store:async(bytes,name)=>({id:'snapshot',name,...await saveImage(root,Buffer.from(bytes),()=>({width:1,height:1}))})});
  await f.save('one',{signal:new AbortController().signal,read:()=>({projectId:initial.id,document}),commit:next=>{document=next;return true;}});
  await store.save(initial.id,document,initial.revision);const reopened=await store.read(initial.id);
  assert.equal(reopened.document.assets[0].layerSnapshot.layerId,'one');assert.equal(materialSource(reopened.document.assets[0]),'processed');
  assert.deepEqual(await fs.readFile(path.join(root,'resources',reopened.document.assets[0].resource)),png);
});
