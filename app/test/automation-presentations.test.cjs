const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {batch,validate,listCommands}=require('../core/automation-commands.cjs'),{createDispatcher}=require('../core/automation-host.cjs');
const base=()=>({id:'p',name:'PPT MCP',width:128,height:128,modules:[],recipes:[],assets:[],layers:[],jobs:[]});
const step=(name,command,args={})=>({name,command,args}),ref=(name,key='id')=>({$ref:name+'.'+key});
const apply=(d,command,args)=>batch(d,[step('r',command,args)]);
const setup=()=>batch(base(),[step('p','ppt.create',{name:'中文汇报'}),step('s','ppt.slide.create',{presentationId:ref('p'),layout:'blank'}),step('e','ppt.element.create',{presentationId:ref('p'),slideId:ref('s'),kind:'text',properties:{text:'正文',fontWeight:500}})]);

test('PPT MCP creates multiple decks and independent pages/elements using atomic references',()=>{
 const r=setup(),a={presentationId:r.results.p.id,slideId:r.results.s.id,id:r.results.e.id};
 const next=batch(r.document,[step('meta','ppt.slide.update',{...a,id:undefined,patch:{background:'#fafafa',notes:'讲稿'}})].map(s=>{delete s.args.id;return s}));
 assert.equal(next.document.presentations[0].slides[1].notes,'讲稿');
 let d=apply(next.document,'ppt.element.effects',{...a,effects:[{type:'shadow',color:'#334455'},{type:'innerShadow',opacity:30},{type:'stroke',size:6,color:'#ef2345'}]}).document;
 assert.equal(d.presentations[0].slides[1].elements[0].effects[2].position,'center');
 d=apply(d,'ppt.element.update',{...a,patch:{fontWeight:700,italic:true,visible:false,rotation:45}}).document;
 const copy=apply(d,'ppt.duplicate',{presentationId:a.presentationId});assert.equal(copy.document.presentations.length,2);assert.notEqual(copy.document.presentations[1].slides[1].elements[0].id,a.id);assert.deepEqual(copy.document.presentations[1].slides[1].elements[0].effects,d.presentations[0].slides[1].elements[0].effects);
 const slide=apply(d,'ppt.slide.duplicate',{presentationId:a.presentationId,slideId:a.slideId});assert.equal(slide.document.presentations[0].slides.length,3);
 d=apply(slide.document,'ppt.slide.move',{presentationId:a.presentationId,slideId:slide.results.r.id,index:0}).document;assert.equal(d.presentations[0].slides[0].id,slide.results.r.id);
 d=apply(d,'ppt.slide.delete',{presentationId:a.presentationId,slideId:slide.results.r.id}).document;assert.equal(d.presentations[0].slides.length,2);
});
test('PPT MCP protects types, bounds, locked elements, last page and atomic rollback',()=>{
 const r=setup(),a={presentationId:r.results.p.id,slideId:r.results.s.id,id:r.results.e.id},before=structuredClone(r.document);
 for(const patch of [{assetId:'image'},{w:7},{fontSize:241},{text:'x'.repeat(10001)},{fill:'#ffffff'},{unknown:true}])assert.throws(()=>apply(r.document,'ppt.element.update',{...a,patch}));
 for(const effects of [[{type:'shadow'},{type:'shadow'}],[{type:'stroke',size:-1}],[{type:'innerShadow',radius:101}],[{type:'shadow',blend:'multiply'}]])assert.throws(()=>apply(r.document,'ppt.element.effects',{...a,effects}));
 assert.throws(()=>batch(r.document,[step('rename','ppt.rename',{presentationId:a.presentationId,name:'不要提交'}),step('missing','ppt.element.delete',{...a,id:'missing'})]));assert.deepEqual(r.document,before);
 const locked=apply(r.document,'ppt.element.update',{...a,patch:{locked:true}}).document;
 for(const [command,args] of [['ppt.element.update',{...a,patch:{text:'禁止'}}],['ppt.element.effects',{...a,effects:[]}],['ppt.element.delete',a],['ppt.element.duplicate',a],['ppt.element.move',{...a,index:0}]])assert.throws(()=>apply(locked,command,args),e=>e.code==='LOCKED');
 assert.doesNotThrow(()=>apply(locked,'ppt.element.update',{...a,patch:{locked:false,visible:false}}));
 const first=r.document.presentations[0].slides[0].id;const d=apply(r.document,'ppt.slide.delete',{presentationId:a.presentationId,slideId:a.slideId}).document;assert.throws(()=>apply(d,'ppt.slide.delete',{presentationId:a.presentationId,slideId:first}));
 assert.throws(()=>apply(r.document,'ppt.element.create',{presentationId:a.presentationId,slideId:a.slideId,kind:'image'}));
});
test('PPT MCP reorders/duplicates/deletes elements and preserves shared font semantics',()=>{
 const r=setup(),a={presentationId:r.results.p.id,slideId:r.results.s.id,id:r.results.e.id};
 const fontResource={resource:'a'.repeat(64)+'.ttf',projectId:'font',jobId:'job'};
 let d=apply(r.document,'ppt.element.update',{...a,patch:{fontResource,fontFamily:'Custom',fontWeight:500}}).document;
 assert.equal(d.presentations[0].slides[1].elements[0].bold,false);
 d=apply(d,'ppt.element.update',{...a,patch:{fontFamily:'Arial',bold:true}}).document;assert.equal(d.presentations[0].slides[1].elements[0].fontResource,undefined);assert.equal(d.presentations[0].slides[1].elements[0].fontWeight,700);
 const copy=apply(d,'ppt.element.duplicate',a),id=copy.results.r.id;d=apply(copy.document,'ppt.element.move',{...a,id,index:0}).document;assert.equal(d.presentations[0].slides[1].elements[0].id,id);
 d=apply(d,'ppt.element.delete',{...a,id}).document;assert.equal(d.presentations[0].slides[1].elements.length,1);
 d=apply(d,'ppt.rename',{presentationId:a.presentationId,name:'改名'}).document;assert.equal(d.presentations[0].name,'改名');assert.equal(apply(d,'ppt.delete',{presentationId:a.presentationId}).document.presentations.length,0);
});
async function fixture(t){
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'ppt-mcp-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let state={projectId:'p',revision:'r1',document:setup().document},changing=false,reads=0,verified=[];
 const dispatch=await createDispatcher({root,filesRoot:root,tasks:{list:()=>[]},projects:{verifyResources:async r=>{verified.push(...r)}},ui:async(action,args,revision)=>{
  if(action==='snapshot'){if(changing&&++reads>1)state.revision='new';return structuredClone(state);}
  if(action==='commit'){assert.equal(revision,state.revision);state={...state,document:args.document,revision:state.revision+'x'};return structuredClone(state);}throw Error(action);
 }});
 return {root,dispatch,state:()=>state,changeDuringExport:()=>{changing=true;reads=0},verified,run:(command,args={})=>dispatch('run_command',{command,args,expectedRevision:state.revision})};
}
test('dispatcher queries are scoped to PPT and page, paginated and include layer style data',async t=>{
 const f=await fixture(t),p=f.state().document.presentations[0],s=p.slides[1];
 assert.equal((await f.run('ppt.list')).presentations[0].slides,2);assert.equal((await f.run('ppt.get',{presentationId:p.id,slideId:s.id})).slide.elements[0].text,'正文');
 assert.equal((await f.dispatch('query_objects',{kind:'slide',presentationId:p.id,limit:1})).nextOffset,1);
 assert.equal((await f.dispatch('query_objects',{kind:'slideElement',presentationId:p.id,slideId:s.id,search:'正文'})).total,1);
 assert.equal((await f.dispatch('get_object',{kind:'slideElement',presentationId:p.id,slideId:s.id,id:s.elements[0].id})).object.fontWeight,500);
 await assert.rejects(f.dispatch('query_objects',{kind:'slideElement',presentationId:p.id}),e=>e.code==='INVALID_ARGUMENT');
 await assert.rejects(f.dispatch('get_object',{kind:'slideElement',presentationId:p.id,slideId:p.slides[0].id,id:s.elements[0].id}),e=>e.code==='NOT_FOUND');
 await assert.rejects(f.dispatch('run_command',{command:'ppt.rename',args:{presentationId:p.id,name:'旧写入'},expectedRevision:'stale'}),e=>e.code==='CONFLICT');
 await f.run('ppt.element.update',{presentationId:p.id,slideId:s.id,id:s.elements[0].id,patch:{fontResource:{resource:'a'.repeat(64)+'.ttf',projectId:'font',jobId:'job'}}});assert.equal(f.verified[0].resource,'a'.repeat(64)+'.ttf');
});
test('PPT MCP export uses live snapshot, denies overwrite/path traversal and stale results',async t=>{
 const f=await fixture(t),p=f.state().document.presentations[0];await f.run('ppt.rename',{presentationId:p.id,name:'未保存的新标题'});
 const r=await f.run('ppt.export',{presentationId:p.id,path:'decks/result.pptx'});assert(r.bytes>1000);const zip=await require('jszip').loadAsync(await fs.readFile(r.path));assert.match(await zip.file('docProps/core.xml').async('string'),/未保存的新标题/);
 await assert.rejects(f.run('ppt.export',{presentationId:p.id,path:'decks/result.pptx'}),e=>e.code==='EEXIST');
 for(const file of ['../escape.pptx',path.join(f.root,'absolute.pptx'),'secret:stream.pptx','wrong.png'])await assert.rejects(f.run('ppt.export',{presentationId:p.id,path:file}));
 f.changeDuringExport();await assert.rejects(f.run('ppt.export',{presentationId:p.id,path:'stale.pptx'}),e=>e.code==='CONFLICT');await assert.rejects(fs.access(path.join(f.root,'stale.pptx')));
});
test('all PPT commands have strict schemas, no import/eval escape, and view/file actions reject batches',()=>{
 assert.equal(listCommands('ppt').length,22);for(const c of listCommands('ppt')){assert.equal(c.inputSchema.additionalProperties,false);assert.throws(()=>validate(c.name,{unexpected:1}));}
 const r=setup(),id=r.results.p.id;for(const [command,args] of [['ppt.open',{presentationId:id}],['ppt.preview',{presentationId:id}],['ppt.export',{presentationId:id,path:'a.pptx'}],['ppt.present',{action:'stop'}]])assert.throws(()=>apply(r.document,command,args),e=>e.code==='NON_TRANSACTIONAL');
 assert.throws(()=>validate('ppt.import',{}));validate('layer.effects',{id:'layer',effects:[{type:'stroke',position:'inside',size:5,color:'#ff0000'}]});
});
