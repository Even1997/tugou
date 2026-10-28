const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {builtinFonts}=require('../core/builtin-fonts.cjs'),{requestedWeight,fontFaces,builtinFace,textFontWeight,nearestWeight}=require('../core/font-weights.cjs');
const {normalizeFonts}=require('../core/font-catalog.cjs'),{createLayer,validateLayers}=require('../core/layers.cjs'),{validate}=require('../core/automation-commands.cjs');
test('legacy bold remains bold and explicit weight wins independently of italic',()=>{
 assert.equal(requestedWeight({fontStyle:'bold italic'}),700);assert.equal(requestedWeight({fontStyle:'italic'}),400);
 assert.equal(textFontWeight({fontFamily:'Arial',fontStyle:'bold',fontWeight:300}),300);
 assert.equal(builtinFace({fontFamily:'思源黑体',fontStyle:'bold italic'}).weight,400);
 assert.equal(textFontWeight({fontFamily:'思源黑体',fontStyle:'bold italic'}),700);
 assert.equal(builtinFace({fontFamily:'思源黑体',fontStyle:'bold italic',fontWeight:700}).weight,700);
 assert.equal(builtinFace({fontFamily:'霞鹜文楷',fontWeight:900}).weight,500);
 assert.equal(builtinFace({fontFamily:'霞鹜文楷',fontResource:{}}),undefined);
 assert.equal(nearestWeight([300,500],400),300);
});
test('MCP and document validation accept weights and reject malformed values',()=>{
 const layer=createLayer('text',{id:'text'});
 for(const fontWeight of [250,350,400,600,700,900]){const a={id:'text',patch:{fontWeight}};validate('layer.update',a).apply({layers:[layer]},a);validateLayers([layer]);assert.equal(layer.fontWeight,fontWeight);}
 for(const fontWeight of [0,1001,NaN,300.5,'bold']){assert.throws(()=>validate('layer.update',{id:'text',patch:{fontWeight}}));assert.throws(()=>validateLayers([{...layer,fontWeight}]));}
});
test('local family metadata retains genuine intermediate weights',()=>{
 assert.deepEqual(normalizeFonts([{family:'Test',weights:[700,350,350,400,0,1001,'500']}])[0].weights,[350,400,700]);
});
test('each bundled weight has unique ID and authentic bytes with retained provenance',async()=>{
 const ids=new Set();
 for(const family of builtinFonts){const weights=new Set();for(const face of fontFaces(family)){
  assert.ok(!ids.has(face.id));ids.add(face.id);assert.ok(!weights.has(face.weight));weights.add(face.weight);
  const data=await fs.readFile(path.join(__dirname,'../assets/fonts',face.file));assert.equal(data.length,face.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),face.sha256);
  assert.ok((await fs.readFile(path.join(__dirname,'../assets/fonts',path.dirname(face.file),'SOURCE.md'),'utf8')).includes(face.sha256));
 }}
 assert.ok(ids.size>=53);
});
