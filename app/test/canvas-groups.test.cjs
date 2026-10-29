const test=require('node:test'),assert=require('node:assert/strict');
const {groupNodes,ungroupNodes,fitGroups}=require('../core/canvas-groups.cjs');
const node=(id,x,y,extra={})=>({id,type:'text',position:{x,y},data:{text:id},...extra});
const world=(nodes,id)=>{const n=nodes.find(n=>n.id===id),p=nodes.find(p=>p.id===n.parentId);return {x:n.position.x+(p?.position.x||0),y:n.position.y+(p?.position.y||0)};};
test('group uses type widths and measured sizes, preserving absolute positions',()=>{
 const source=[node('a',-200,50,{type:'image'}),node('b',500,-80,{measured:{width:630,height:780}})],before=structuredClone(source);
 const next=groupNodes(source,['a','b']),g=next[0];
 assert.ok(g.width>=500+630-g.position.x+24);assert.ok(g.height>=-80+780-g.position.y+24);
 for(const n of source)assert.deepEqual(world(next,n.id),n.position);
 assert.deepEqual(ungroupNodes(next,g.id).map(n=>n.position),source.map(n=>n.position));assert.deepEqual(source,before);
 const generated=groupNodes([source[0],node('c',0,0)],['a','c']);assert.ok(generated[0].width>=448);assert.ok(generated[0].height>=472);
});
test('late measurement grows frame in all directions without moving any child',()=>{
 const grouped=groupNodes([node('a',0,0),node('b',400,500)],['a','b']);
 const moved=grouped.map(n=>n.id==='a'?{...n,position:{x:-170,y:-90},measured:{width:750,height:800}}:n),before=structuredClone(moved);
 const next=fitGroups(moved),g=next[0];
 for(const n of next.slice(1)){assert.deepEqual(world(next,n.id),world(moved,n.id));assert.ok(n.position.x>=24&&n.position.y>=48);assert.ok(n.position.x+(n.measured?.width||300)+24<=g.width);assert.ok(n.position.y+(n.measured?.height||400)+24<=g.height);}
 assert.deepEqual(moved,before);assert.equal(fitGroups(next),next);assert.equal(g.style.width,g.width);assert.equal(g.style.height,g.height);
});
test('resized and overflowing children expand independently; unrelated groups stay untouched',()=>{
 const a=groupNodes([node('a',0,0),node('b',400,0)],['a','b']),b=groupNodes([node('c',1000,0),node('d',1400,0)],['c','d']);
 const source=[...a,...b].map(n=>n.id==='b'?{...n,width:800,height:900,measured:{width:820,height:930}}:n),next=fitGroups(source);
 assert.equal(next[3],b[0]);assert.equal(next[4],b[1]);assert.equal(next[5],b[2]);
 assert.ok(next[0].width>=next[2].position.x+820+24);assert.ok(next[0].height>=next[2].position.y+930+24);
 assert.equal(fitGroups([node('outside',0,0)])[0].id,'outside');
});
test('inward movement tightens every side without changing world positions',()=>{
 const original=groupNodes([node('a',0,0,{width:200,height:200}),node('b',800,800,{width:200,height:200})],['a','b']);
 const inward=original.map(n=>n.id==='a'?{...n,position:{x:124,y:148}}:n.id==='b'?{...n,position:{x:724,y:748}}:n),before=structuredClone(inward),next=fitGroups(inward);
 assert.equal(next[0].width,original[0].width-200);assert.equal(next[0].height,original[0].height-200);
 assert.equal(next[0].position.x,original[0].position.x+100);assert.equal(next[0].position.y,original[0].position.y+100);
 for(const id of ['a','b'])assert.deepEqual(world(next,id),world(inward,id));
 assert.deepEqual(inward,before);assert.equal(fitGroups(next),next);
 assert.deepEqual(ungroupNodes(next,next[0].id).map(n=>n.position),['a','b'].map(id=>world(inward,id)));
});
test('smaller nodes and late smaller measurements release unused frame space',()=>{
 const source=groupNodes([node('a',0,0,{measured:{width:700,height:900}}),node('b',100,100,{width:200,height:200})],['a','b']);
 const small=source.map(n=>n.id==='a'?{...n,measured:{width:300,height:320}}:n),next=fitGroups(small);
 assert.equal(next[0].width,348);assert.equal(next[0].height,392);
 const resized=next.map(n=>n.id==='a'?{...n,width:180,height:160,style:{width:180,height:160},measured:undefined}:n),fitted=fitGroups(resized);
 assert.equal(fitted[0].height,372);assert.equal(fitted[0].width,348);
 assert.equal(fitGroups(fitted),fitted);
});
