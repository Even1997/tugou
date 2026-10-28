const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const code=require('esbuild').buildSync({entryPoints:[require.resolve('../renderer/generation-sizes.js')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const moduleScope={exports:{}};vm.runInNewContext(code,{module:moduleScope,exports:moduleScope.exports});
const {imageRatios,ratioOf,sizeOptions,sizeDescription}=moduleScope.exports;
test('every dropdown dimension exactly matches its selected ratio and remains a valid generation size',()=>{
  const {compileWorkflow,workflowNode}=require('../core/workflow-nodes.cjs');
  for(const [ratio,sizes]of imageRatios){const [rw,rh]=ratio.split(':').map(Number);for(const value of sizeOptions(sizes[0])){
    const [w,h]=value.split('x').map(Number);assert.equal(w*rh,h*rw);assert.equal(ratioOf(value),ratio);assert.ok(w*h<=100000000);assert.match(sizeDescription(value),new RegExp('^'+ratio));
    const node=workflowNode('config',{x:0,y:0});node.data.size=value;node.data.prompt='尺寸验收';
    assert.equal(compileWorkflow({modules:[],assets:[],tugouCanvas:{nodes:[node],edges:[]}},node.id).size,value);
  }}
});
test('existing exact-ratio sizes are retained without mixing ratios; auto and custom stay distinct',()=>{
  assert.equal(ratioOf('500x500'),'1:1');assert.ok(sizeOptions('500x500').includes('500x500'));assert.ok(sizeOptions('500x500').every(v=>ratioOf(v)==='1:1'));
  assert.equal(ratioOf('1500x1001'),'custom');assert.equal(ratioOf('0x0'),'custom');assert.equal(ratioOf('invalid'),'custom');
  assert.deepEqual(Array.from(sizeOptions('auto')),['auto']);assert.equal(sizeDescription('auto'),'自动尺寸');
  assert.equal(imageRatios.length,9);
});
