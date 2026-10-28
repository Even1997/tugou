const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const catalog=import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../renderer/board-presets.js')).toString('base64'));
test('all artboard presets fit renderer limits and have unique names',async()=>{
  const {boardPresetGroups,boardPresets}=await catalog;
  assert.equal(Object.keys(boardPresetGroups).length,6);assert.equal(boardPresets.length,41);
  assert.equal(new Set(boardPresets.map(p=>p[0])).size,41);
  for(const [name,w,h] of boardPresets)assert.ok(Number.isInteger(w)&&Number.isInteger(h)&&w>0&&h>0&&w<=30000&&h<=30000&&w*h<=100000000,name);
});
test('physical presets use correctly rounded 300 PPI dimensions',async()=>{
  const {boardPresetGroups}=await catalog;
  for(const [name,w,h] of [...boardPresetGroups['印刷'],...boardPresetGroups['照片']]){
    const [,a,b,unit]=name.match(/([\d.]+) × ([\d.]+) (mm|in)/),factor=unit==='mm'?300/25.4:300;
    assert.equal(w,Math.round(+a*factor),name);assert.equal(h,Math.round(+b*factor),name);
  }
});
