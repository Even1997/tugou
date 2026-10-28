const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../core/artboards.cjs'),L=require('../core/layers.cjs');
const shape=(id,extra={})=>L.createLayer('shape',{id,shape:'rect',name:id,x:10,y:20,width:100,height:80,color:'#ff0000',...extra});
const fixture=()=>({name:'工程',width:400,height:600,background:'#ffffff',assets:[],layers:[shape('a'),shape('b',{rotation:20,mask:{anchor:{matrix:[1,0,0,1,20,30],width:400,height:600},x:0,y:0,width:.5,height:1}})],selection:{paths:[{points:[1,2,3,4,5,6]}]},modules:[],recipes:[],jobs:[]});
test('legacy document wraps without mutating source, preserving local geometry and selection',()=>{
  const old=fixture(),snapshot=structuredClone(old),next=A.normalize(old),b=A.boards(next)[0];
  assert.deepEqual(old,snapshot);assert.equal(A.boards(next).length,1);
  const local=A.extract(next,b.id);assert.deepEqual(local.layers,old.layers);assert.deepEqual(local.selection,old.selection);assert.equal(local.width,400);
});
test('normalization is stable and adopts new root content from other workspaces',()=>{
  const doc=A.normalize(fixture());assert.equal(A.normalize(doc),doc);
  const next=A.normalize({...doc,layers:[...doc.layers,shape('new')]});assert.equal(A.owner(next,'new').id,'artboard-main');
});
test('moving an artboard to negative coordinates preserves local masks and edit round-trip',()=>{
  let doc=A.normalize(fixture());doc=A.update(doc,'artboard-main',{x:-2000,y:-1200});
  const local=A.extract(doc,'artboard-main');assert.deepEqual(local.layers,fixture().layers);
  local.layers=local.layers.map(l=>l.id==='a'?{...l,text:'changed',x:55}:l);
  const saved=A.replace(doc,'artboard-main',local);assert.equal(saved.name,'工程');assert.equal(saved.layers.find(l=>l.id==='a').x,55);
  assert.deepEqual(A.extract(saved,'artboard-main').layers,local.layers);assert.deepEqual(A.extract(saved,'artboard-main').selection,local.selection);
});
test('independent artboards keep dimensions, selection, background and layers',()=>{
  let doc=A.normalize(fixture()),result=A.create(doc,{width:1920,height:1080});doc=result.document;
  const second=A.extract(doc,result.id);second.background='#123456';second.layers=[shape('c')];second.selection={bitmap:{dataUrl:'data:image/png;base64,AA=='}};
  doc=A.replace(doc,result.id,second);assert.equal(A.owner(doc,'c').id,result.id);assert.equal(A.extract(doc,'artboard-main').width,400);assert.equal(doc.width,400);
  assert.equal(A.extract(doc,result.id).background,'#123456');assert.deepEqual(A.extract(doc,'artboard-main').selection,fixture().selection);
});
test('resize optionally scales all root transforms and world-anchored masks',()=>{
  let doc=A.update(A.normalize(fixture()),'artboard-main',{x:900,y:200});
  const normal=A.update(doc,'artboard-main',{width:800,height:1200});assert.equal(A.extract(normal,'artboard-main').layers[0].x,10);
  const scaled=A.extract(A.update(doc,'artboard-main',{width:800,height:1200},{scaleContent:true}),'artboard-main');
  assert.equal(scaled.layers[0].x,20);assert.equal(scaled.layers[0].scaleX,2);assert.equal(scaled.selection,undefined);
  assert.deepEqual(scaled.layers[1].mask.anchor.matrix,[2,0,0,2,40,60]);
});
test('copy remaps ids and mask links without changing local anchored masks',()=>{
  const doc=A.update(A.normalize(fixture()),'artboard-main',{x:-800,y:200}),copy=A.duplicate(doc,'artboard-main');
  const original=A.extract(doc,'artboard-main'),local=A.extract(copy.document,copy.id);
  assert.equal(local.layers.length,2);assert.notEqual(local.layers[0].id,original.layers[0].id);
  assert.deepEqual(local.layers[1].mask,original.layers[1].mask);assert.equal(new Set(copy.document.layers.map(l=>l.id)).size,copy.document.layers.length);
});
test('delete removes the whole subtree, retains another board and rejects last deletion',()=>{
  const first=A.normalize(fixture()),added=A.create(first),next=A.remove(added.document,'artboard-main');
  assert.equal(next.layers.length,1);assert.equal(next.layers[0].id,added.id);assert.throws(()=>A.remove(next,added.id),/至少/);
});
test('display coordinates are relative to active board with masks rebased',()=>{
  const doc=A.create(A.update(A.normalize(fixture()),'artboard-main',{x:-400,y:-300})).document,b=A.boards(doc)[1];
  const render=A.display(doc,b.id,A.extract(doc,b.id));assert.equal(render.infiniteWorkspace,true);assert.equal(A.boards(render)[1].x,0);
  assert.equal(A.boards(render)[0].x,-400-b.x);assert.equal(render.layers.find(l=>l.id==='b').mask.anchor.matrix[4],20-400-b.x);
});
test('invalid dimensions, nested boards and blank names fail before storing',()=>{
  const doc=A.normalize(fixture());for(const patch of [{width:1.5},{width:30001},{width:20000,height:20000},{width:0},{rotation:10},{name:' '},{background:'url(x)'}])assert.throws(()=>A.update(doc,'artboard-main',patch));
  assert.throws(()=>A.update(doc,'artboard-main',{parentId:'a'}));
  require('../core/storage.cjs').validateDocument(doc);
});
test('transfer into rotated nested group preserves board-relative world geometry and mask anchors',()=>{
  let doc=A.normalize(fixture()),added=A.create(doc);doc=added.document;
  const local=A.extract(doc,added.id);local.layers=[L.createLayer('group',{id:'rotated',name:'rotated',x:40,y:100,rotation:30})];doc=A.replace(doc,added.id,local);
  const source=A.owner(doc,'b'),destination=A.boards(doc)[1],before=L.worldMatrix(doc.layers,doc.layers.find(l=>l.id==='b'));
  const moved=A.relocate(doc,['b'],'rotated'),after=L.worldMatrix(moved.layers,moved.layers.find(l=>l.id==='b'));
  assert.ok(Math.abs(after[4]-before[4]-(destination.x-source.x))<1e-7);
  assert.ok(Math.abs(after[5]-before[5]-(destination.y-source.y))<1e-7);
  assert.equal(A.owner(moved,'b').id,added.id);
  assert.deepEqual(A.extract(moved,added.id).layers.find(l=>l.id==='b').mask,A.extract(doc,source.id).layers.find(l=>l.id==='b').mask);
});
test('locked boards reject transforms, resizing, deletion and incoming layers',()=>{
  let {document:doc,id}=A.create(A.normalize(fixture()));doc={...doc,layers:doc.layers.map(l=>l.id===id?{...l,locked:true}:l)};
  assert.throws(()=>A.update(doc,id,{width:800}),/解锁/);assert.throws(()=>A.remove(doc,id),/解锁/);assert.throws(()=>A.relocate(doc,['a'],id),/锁定/);
});
