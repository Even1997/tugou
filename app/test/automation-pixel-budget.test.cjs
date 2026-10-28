const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const code=require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../renderer/paint-target.js')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const mod=new Module(__filename);mod._compile(code,__filename);
const {paintTarget,fillMaskSelection}=mod.exports;
const make=(patch={})=>({id:'layer',kind:'shape',x:0,y:0,width:100,height:100,mask:{x:0,y:0,width:1,height:1},...patch});
const doc=layer=>({width:128,height:128,layers:[layer],assets:[],selection:{paths:[]}});
const options={target:'mask',maxPixels:16000000};
const forbidden={image(){assert.fail('must reject before decoding')},mask(){assert.fail('must reject before allocating mask')}};
test('MCP rejects oversized shape masks before brush or fill allocation',async()=>{
  const layer=make({width:100000,height:100000});
  await assert.rejects(paintTarget(doc(layer),layer,forbidden,options),{code:'RESOURCE_LIMIT'});
  await assert.rejects(fillMaskSelection(doc(layer),layer,forbidden,'hide',16000000),{code:'RESOURCE_LIMIT'});
});
test('MCP budgets unlocked mask anchor dimensions rather than layer bounds',async()=>{
  const layer=make({mask:{anchor:{width:100000,height:100000,matrix:[1,0,0,1,0,0]}}});
  await assert.rejects(paintTarget(doc(layer),layer,forbidden,options),{code:'RESOURCE_LIMIT'});
});
test('small mask cannot bypass image target budget and large image does not block small mask',async()=>{
  const small={width:32,height:32},layer=make({kind:'image',bitmap:{width:4096,height:4096},mask:{bitmap:small}});
  await assert.rejects(paintTarget(doc(layer),layer,forbidden,{...options,target:'image'}),{code:'RESOURCE_LIMIT'});
  const target=await paintTarget(doc(layer),layer,{image:async asset=>{assert.equal(asset,small);return {naturalWidth:32,naturalHeight:32}},mask:async(_l,_d,frame)=>{assert.equal(frame.width,32);return 'mask';}},options);
  assert.equal(target.image,'mask');assert.equal(target.width,32);
});
test('decoded image dimensions are checked when metadata is missing or inaccurate',async()=>{
  for(const bitmap of [{},{width:1,height:1}])for(const target of ['image','mask']){
    const layer=make({kind:'image',bitmap}),engine={image:async()=>({naturalWidth:4096,naturalHeight:4096}),mask:forbidden.mask};
    await assert.rejects(paintTarget(doc(layer),layer,engine,{...options,target}),{code:'RESOURCE_LIMIT'});
  }
});
test('pixel budget includes exact boundary and preserves ordinary UI behavior without a budget',async()=>{
  for(const width of [4000,4001]){
    const layer=make({width,height:4000}),engine={mask:async()=> 'mask'};
    if(width===4000)assert.equal((await paintTarget(doc(layer),layer,engine,options)).width,4000);
    else await assert.rejects(paintTarget(doc(layer),layer,forbidden,options),{code:'RESOURCE_LIMIT'});
    assert.equal((await paintTarget(doc(layer),layer,engine,{target:'mask'})).width,width);
  }
});
