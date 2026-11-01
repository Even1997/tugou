const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {cleanupDefaults,validateCleanup}=require('../core/cleanup-settings.cjs');
const {localToolReadiness}=require('../core/local-readiness.cjs');
const {validate}=require('../core/automation-commands.cjs');
test('cleanup inputs reject invalid modes, rectangles, masks and display changes',()=>{
 const size={width:200,height:100},watermark={operation:'watermark',...cleanupDefaults.watermark};
 for(const patch of [{mode:'lama'},{radius:0},{radius:1.1},{mode:'mask',maskId:''},{mode:'region',left:190,width:20},{mode:'region',left:-1},{mode:'region',height:0}])assert.throws(()=>validateCleanup({...watermark,...patch},size));
 validateCleanup({...watermark,mode:'region',left:0,top:0,width:20,height:20},size);
 assert.throws(()=>validateCleanup(watermark,{width:5000,height:5000}));
 assert.throws(()=>validateCleanup({operation:'metadata',preserveDisplay:false},size));
});
test('cleanup readiness is independent of GPU tools and requires explicit installation',()=>{
 const s={operation:'metadata',...cleanupDefaults.metadata};
 assert.equal(localToolReadiness({configured:true,models:['general']},s).ready,false);
 assert.equal(localToolReadiness({configured:false,cleanup:{metadata:{ready:true}}},s).ready,true);
 assert.equal(localToolReadiness({cleanup:{metadata:{ready:true}}},{operation:'watermark',...cleanupDefaults.watermark}).ready,false);
});
test('MCP exposes both operations with bounded mode/radius and mandatory display preservation',()=>{
 for(const operation of ['metadata','watermark'])validate('image.process',{ids:['a'],requestId:operation,settings:{operation}});
 for(const settings of [{operation:'watermark',mode:'auto-download'},{operation:'watermark',radius:21},{operation:'metadata',preserveDisplay:false},{operation:'metadata',path:'C:/private'}])assert.throws(()=>validate('image.process',{ids:['a'],requestId:'r',settings}));
 validate('image.metadata',{id:'asset'});assert.throws(()=>validate('image.metadata',{id:'asset',path:'private'}));
});
test('MCP metadata inspection finds current project asset and rejects unknown IDs',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-cleanup-test-'));t.after(async()=>{assert.equal(path.dirname(await fs.realpath(root)),await fs.realpath(os.tmpdir()));assert.ok(path.basename(root).startsWith('tugou-cleanup-test-'));await fs.rm(root,{recursive:true,force:true});});
 const asset={id:'a',resource:'fixture'},seen=[];
 const dispatch=await require('../core/automation-host.cjs').createDispatcher({root,ui:async()=>({revision:'r',projectId:'p',document:{assets:[asset]}}),localAI:{cleanup:{inspect:async input=>{seen.push(input);return {count:1,fields:[]};}}}});
 assert.equal((await dispatch('run_command',{command:'image.metadata',args:{id:'a'}})).count,1);assert.deepEqual(seen,[asset]);
 await assert.rejects(()=>dispatch('run_command',{command:'image.metadata',args:{id:'missing'}}),e=>e.code==='NOT_FOUND');assert.equal(seen.length,1);
});
