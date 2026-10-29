const test=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp');
const {captureUi}=require('../core/ui-capture.cjs'),{validate,batch}=require('../core/automation-commands.cjs');
test('UI schemas reject arbitrary selectors, scripts, unbounded output and batched navigation',()=>{
  validate('ui.inspect',{limit:200});validate('ui.capture',{region:'modules',maxSize:1024});validate('ui.navigate',{nodeId:'a'});validate('ui.restore',{restoreToken:'t'});
  for(const [name,args] of [['ui.capture',{maxSize:9999}],['ui.inspect',{limit:9999}],['ui.navigate',{script:'alert(1)'}],['ui.navigate',{selector:'body'}],['ui.restore',{}]])assert.throws(()=>validate(name,args));
  assert.throws(()=>batch({},[{name:'nav',command:'ui.navigate',args:{workspace:'canvas'}}]));
});
test('capture masks sensitive pixels before cropping/resizing and returns coverage at device scale',async()=>{
  const buffer=await sharp({create:{width:800,height:600,channels:4,background:'white'}}).png().toBuffer();
  const before={revision:'p:1',projectId:'p',viewRevision:7,workspace:'settings',viewport:{width:400,height:300,deviceScaleFactor:2},rect:{x:0,y:0,width:200,height:200},region:'settings',redactedRegions:[{x:20,y:20,width:50,height:25}],coverage:{scope:'visible-viewport',offscreenContentIncluded:false},scrollAreas:[],dialogs:[],readiness:{ready:true}};
  let calls=0;const window={isDestroyed:()=>false,isMinimized:()=>false,isVisible:()=>true,webContents:{capturePage:async(_rect,opts)=>{calls++;assert.equal(opts.stayHidden,true);return {isEmpty:()=>false,toPNG:()=>buffer};}}};
  const image=await captureUi(window,async()=>before,{maxSize:400});assert.equal(calls,1);assert.equal(image.width,400);assert.equal(image.height,400);assert.equal(image.coverage.redactedRegions,1);assert.equal(image.coverage.offscreenContentIncluded,false);
  const pixels=await sharp(Buffer.from(image.data,'base64')).removeAlpha().raw().toBuffer();assert.deepEqual([...pixels.subarray((60*400+60)*3,(60*400+60)*3+3)],[37,40,48]);assert.deepEqual([...pixels.subarray(0,3)],[255,255,255]);
  let count=0;await assert.rejects(captureUi(window,async()=>({...before,viewRevision:++count}),{}),e=>e.code==='UI_CHANGED');
  await assert.rejects(captureUi(window,async()=>({...before,redactedRegions:[{x:++count,y:20,width:50,height:25}]}),{}),e=>e.code==='UI_CHANGED');
  await assert.rejects(captureUi({...window,isMinimized:()=>true},async()=>before,{}),e=>e.code==='WINDOW_NOT_VISIBLE');assert.equal(calls,7);
});
