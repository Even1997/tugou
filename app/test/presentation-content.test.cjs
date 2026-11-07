const test=require('node:test'),assert=require('node:assert/strict');
const ppt=require('../core/presentations.cjs'),C=require('../core/presentation-content.cjs');
const {batch,listCommands}=require('../core/automation-commands.cjs');
const base=()=>({id:'p',name:'内容测试',width:128,height:128,modules:[],recipes:[],assets:[],layers:[],jobs:[],presentations:[ppt.create()]});
const update=(d,command,args)=>batch(d,[{name:'result',command,args}]);
const patch=(s,text)=>C.setContent(s,{blocks:C.contentOf(s).blocks.map((b,i)=>i?b:{...b,text})});

test('MCP can create a content-first deck with no designed placeholders',()=>{
 const r=update(base(),'ppt.create',{name:'先写内容',layout:'blank'}),deck=r.document.presentations.at(-1);assert.equal(deck.slides[0].elements.length,0);
 const s=update(r.document,'ppt.content.update',{presentationId:deck.id,slideId:deck.slides[0].id,patch:{blocks:[{label:'标题',text:'功能范围'}]}}).document.presentations.at(-1).slides[0];assert.equal(s.elements.length,0);assert.equal(C.contentOf(s).blocks[0].text,'功能范围');
});

test('content drafts do not change layout; applying preserves all editable styles and notes',()=>{
 const s=ppt.slide('cover');s.notes='只在讲稿中的解释';s.elements[1].rotation=12;s.elements[1].fontSize=65;
 const original=structuredClone(s),draft=patch(s,'核对后的真实标题');assert.deepEqual(draft.elements,original.elements);assert.equal(C.contentStatus(draft).pending,1);
 const next=C.applyContent(draft);assert.equal(next.elements[1].text,'核对后的真实标题');assert.deepEqual({...next.elements[1],text:original.elements[1].text},original.elements[1]);assert.equal(next.notes,s.notes);assert.equal(C.contentStatus(next).pending,0);
 const deck=ppt.create();deck.slides=[next];assert.doesNotThrow(()=>ppt.validate([JSON.parse(JSON.stringify(deck))]));
});
test('canvas text synchronizes clean content; concurrent changes require explicit conflict confirmation',()=>{
 let s=C.setContent(ppt.slide('cover'),{objective:'核心观点'});s.elements[1].text='人工修改';assert.equal(C.contentOf(s).blocks[0].text,'人工修改');
 s=patch(s,'AI 草稿');s.elements[1].text='人工再次修改';assert.deepEqual(C.contentStatus(s),{pending:1,conflicts:1});assert.throws(()=>C.applyContent(s),e=>e.code==='CONTENT_CONFLICT');
 assert.equal(C.applyContent(s,{confirmConflicts:true}).elements[1].text,'AI 草稿');
 const accepted=patch(s,'人工再次修改');assert.equal(C.contentStatus(accepted).pending,0);assert.equal(C.contentOf(accepted).blocks[0].baseText,'人工再次修改');
});

test('editing a conflicting draft back to its original text preserves the explicit draft',()=>{
 let s=ppt.slide('cover'),original=s.elements[1].text;s=patch(s,'草稿改稿');s.elements[1].text='页面改稿';
 s=patch(s,original);assert.equal(C.contentOf(s).blocks[0].text,original);assert.deepEqual(C.contentStatus(s),{pending:1,conflicts:1});
 assert.throws(()=>C.applyContent(s),e=>e.code==='CONTENT_CONFLICT');assert.equal(C.applyContent(s,{confirmConflicts:true}).elements[1].text,original);
});

test('MCP acknowledges a draft matched by a canvas edit before the next canvas change',()=>{
 let d=base();const s=d.presentations[0].slides[0],a={presentationId:d.presentations[0].id,slideId:s.id,id:s.elements[1].id};d.presentations[0].slides[0]=patch(s,'同一内容');
 d=update(d,'ppt.element.update',{...a,patch:{text:'同一内容'}}).document;assert.equal(C.contentStatus(d.presentations[0].slides[0]).pending,0);
 d=update(d,'ppt.element.update',{...a,patch:{text:'后续修改'}}).document;assert.equal(C.contentOf(d.presentations[0].slides[0]).blocks[0].text,'后续修改');assert.equal(C.contentStatus(d.presentations[0].slides[0]).conflicts,0);
});
test('apply rejects locked pending text atomically but unchanged locked text is allowed',()=>{
 let s=patch(ppt.slide('cover'),'更新');s.elements[1].locked=true;const copy=structuredClone(s);
 assert.throws(()=>C.applyContent(s),e=>e.code==='LOCKED');assert.deepEqual(s,copy);
 s=patch(s,s.elements[1].text);assert.doesNotThrow(()=>C.applyContent(s));
});
test('blank page drafts create text once and can bind to an AI-designed existing element',()=>{
 let s=C.setContent(ppt.slide(),{objective:'功能边界',chartData:'示例数据，待确认',visuals:'使用已有截图',blocks:[{label:'标题',text:'系统功能'},{label:'正文',text:'资料待补充'}]});
 assert.equal(s.elements.length,0);assert.equal(C.contentStatus(s).pending,2);
 const e=ppt.element('text',{text:'系统功能',x:300,fontSize:55});s.elements.push(e);
 const blocks=s.content.blocks.map((b,i)=>i?b:{...b,elementId:e.id});s=C.setContent(s,{blocks});assert.equal(C.contentOf(s).blocks.length,2);
 s=C.applyContent(s);assert.equal(s.elements.length,2);assert.equal(s.elements[0].x,300);assert.equal(C.applyContent(s).elements.length,2);
});
test('duplicate remaps content links and deleting a text removes its outline entry',()=>{
 const s=patch(ppt.slide('cover'),'草稿'),copy=ppt.duplicate(s);assert.notEqual(copy.content.blocks[0].id,s.content.blocks[0].id);assert.equal(copy.content.blocks[0].elementId,copy.elements[1].id);assert.equal(C.contentStatus(copy).pending,1);assert.doesNotThrow(()=>C.validateContent(copy));
 copy.elements=copy.elements.filter(e=>e.id!==copy.content.blocks[0].elementId);assert.equal(C.contentOf(C.syncContent(copy)).blocks.length,1);
});
test('content rejects duplicate IDs, foreign bindings, excess text and invalid storage fields',()=>{
 const s=ppt.slide('cover'),b=C.contentOf(s).blocks[0];
 for(const blocks of [[b,b],[{...b,id:'other'},b],[{label:'正文',text:'x',elementId:'missing'}],[{label:'正文',text:'x'.repeat(10001)}]])assert.throws(()=>C.setContent(s,{blocks}));
 assert.throws(()=>C.setContent(s,{objective:'x'.repeat(10001)}));assert.throws(()=>C.validateContent({...s,content:{...C.contentOf(s),unexpected:1}}));
 let full=ppt.slide();full.elements=Array.from({length:200},()=>ppt.element('rect'));full=C.setContent(full,{blocks:[{label:'正文',text:'不能加入'}]});assert.throws(()=>C.applyContent(full),/200/);
});

test('content limit includes canvas text not yet stored in the outline',()=>{
 const d=base(),p=d.presentations[0];p.slides=[C.setContent(ppt.slide(),{blocks:Array.from({length:200},(_,i)=>({label:'正文',text:String(i)}))})];
 assert.throws(()=>update(d,'ppt.element.create',{presentationId:p.id,slideId:p.slides[0].id,kind:'text'}),/200/);
 const s=ppt.slide('cover');assert.throws(()=>C.validateContent({...s,content:{objective:'',chartData:'',visuals:'',blocks:[{id:s.elements[1].id,label:'草稿',text:'同 ID 未关联'}]}}),/重复/);
});
test('MCP content commands are strict, atomic, and preserve drafts through page order, copy and delete',()=>{
 let d=base();const a={presentationId:d.presentations[0].id,slideId:d.presentations[0].slides[0].id};
 const blocks=C.contentOf(d.presentations[0].slides[0]).blocks.map(({baseText,...b})=>({...b,text:'待审 '+b.text}));
 d=update(d,'ppt.content.update',{...a,patch:{objective:'目标',blocks}}).document;assert.equal(C.contentStatus(d.presentations[0].slides[0]).pending,2);
 assert.throws(()=>update(d,'ppt.content.update',{...a,patch:{blocks:[{label:'x',text:'x',baseText:'forged'}]}}));
 assert.throws(()=>batch(d,[{name:'good',command:'ppt.content.apply',args:a},{name:'bad',command:'ppt.content.update',args:{...a,patch:{blocks:[{label:'x',text:'x',elementId:'wrong'}]}}}]));assert.equal(C.contentStatus(d.presentations[0].slides[0]).pending,2);
 d=update(d,'ppt.content.apply',a).document;assert.equal(C.contentStatus(d.presentations[0].slides[0]).pending,0);
 const dup=update(d,'ppt.slide.duplicate',a);d=update(dup.document,'ppt.slide.move',{...a,slideId:dup.results.result.id,index:0}).document;assert.equal(d.presentations[0].slides[0].content.objective,'目标');
 const s=d.presentations[0].slides[1],id=s.elements.find(e=>e.kind==='text').id;d=update(d,'ppt.element.delete',{...a,id}).document;assert.equal(C.contentOf(d.presentations[0].slides[1]).blocks.length,1);
 for(const name of ['ppt.content.update','ppt.content.apply'])assert.equal(listCommands('ppt').find(c=>c.name===name).inputSchema.additionalProperties,false);
});


test('single page input retains paragraphs and all existing content without changing layout',()=>{
 const s=C.setContent(ppt.slide('cover'),{objective:'核心观点',chartData:'数据来源',visuals:'现场图'});
 s.elements[1].text='标题\n\n第二段';const before=structuredClone(s);
 const initial=C.contentText(s);for(const value of ['核心观点','标题\n\n第二段',s.elements[2].text,'数据来源','现场图'])assert.ok(initial.includes(value));
 const draft=C.setContent(s,{text:'新的标题\n\n正文\n任意分段\n\n数据 25%'});
 assert.deepEqual(s,before);assert.deepEqual(draft.elements,s.elements);assert.equal(C.contentText(draft),draft.content.text);
 assert.equal(C.contentTitle(draft),'新的标题');assert.equal(C.contentStatus(draft).pending,1);
 draft.elements[1].text='页面单独修改';assert.equal(C.contentText(C.syncContent(draft)),draft.content.text);
 assert.throws(()=>C.applyContent(draft),e=>e.code==='CONTENT_REQUIRES_LAYOUT');
 const copied=ppt.duplicate(draft);assert.equal(C.contentText(copied),draft.content.text);assert.doesNotThrow(()=>C.validateContent(copied));
 assert.equal(C.contentText(C.setContent(draft,{text:''})), '');
 assert.equal(C.setContent(draft,{text:null}).content.text,undefined);
 assert.doesNotThrow(()=>C.setContent(s,{text:'文'.repeat(20000)}));
 for(const text of [123,{},'文'.repeat(2040001)])assert.throws(()=>C.setContent(s,{text}));
});

test('MCP freeform drafts survive unrelated updates and require explicit acknowledgement',()=>{
 let d=base();const a={presentationId:d.presentations[0].id,slideId:d.presentations[0].slides[0].id};
 d=update(d,'ppt.content.update',{...a,patch:{text:'完整内容\n\n保留分段'}}).document;
 d=update(d,'ppt.content.update',{...a,patch:{visuals:'截图'}}).document;
 assert.equal(C.contentText(d.presentations[0].slides[0]),'完整内容\n\n保留分段');
 assert.throws(()=>update(d,'ppt.content.apply',a),e=>e.code==='CONTENT_REQUIRES_LAYOUT');
 for(const text of [123,{},[]])assert.throws(()=>update(d,'ppt.content.update',{...a,patch:{text}}));
 d=update(d,'ppt.content.update',{...a,patch:{text:null}}).document;
 assert.equal(d.presentations[0].slides[0].content.text,undefined);
 assert.doesNotThrow(()=>update(d,'ppt.content.apply',a));
});


test('notes-first MCP branch preserves outline, editable elements and other pages',()=>{
 let d=base();const p=d.presentations[0],a={presentationId:p.id,slideId:p.slides[0].id};
 p.slides[0]=C.setContent(p.slides[0],{text:'已确认大纲\n第一节：系统功能'});p.slides.push(ppt.slide('content'));
 const before=structuredClone(d),r=update(d,'ppt.slide.update',{...a,patch:{notes:'本页说明系统功能及操作入口。'}}).document;
 assert.equal(r.presentations[0].slides[0].notes,'本页说明系统功能及操作入口。');
 assert.deepEqual(r.presentations[0].slides[0].content,before.presentations[0].slides[0].content);
 assert.deepEqual(r.presentations[0].slides[0].elements,before.presentations[0].slides[0].elements);
 assert.deepEqual(r.presentations[0].slides[1],before.presentations[0].slides[1]);assert.deepEqual(d,before);
});
