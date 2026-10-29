const test = require('node:test'), assert = require('node:assert/strict');
const { cloudToolReadiness: ready } = require('../core/cloud-readiness.cjs');
const source = { width: 600, height: 400 };
const manager = { activeId: 'legacy', routes: { image: 'image', analysis: 'vision' }, connections: [
  { id: 'image', baseUrl: 'https://example.test', hasKey: true, model: 'editor' },
  { id: 'vision', baseUrl: 'https://example.test', hasKey: true, analysisModel: 'vision-model' },
  { id: 'legacy', baseUrl: 'https://example.test', hasKey: true, model: 'old-model' },
] };
test('cloud readiness follows separate purpose routes, supports legacy route and blocks missing credentials', () => {
  assert.equal(ready(null, {}, source).ready, false);
  assert.equal(ready(manager, { operation:'cloudEnhance' }, source).model, 'editor');
  assert.equal(ready(manager, {}, source, null, 'analysis').model, 'vision-model');
  assert.equal(ready({...manager, routes:{}}, {operation:'cloudEnhance'}, source).model, 'old-model');
  for (const field of ['baseUrl', 'hasKey', 'model']) {
    const next = structuredClone(manager); next.connections[0][field] = '';
    assert.equal(ready(next, {operation:'cloudEnhance'}, source).ready, false);
    assert.equal(ready(next, {}, source, null, 'analysis').ready, true);
  }
});
test('cloud edit and extend reject invalid inputs before submission', () => {
  const edit = {operation:'cloudEdit', instruction:'remove object', width:30, height:20};
  assert.equal(ready(manager, edit, source).ready, true);
  for (const patch of [{instruction:''},{left:599},{width:0},{maskMode:'asset',maskId:'missing'}])
    assert.equal(ready(manager, {...edit,...patch}, source).ready, false);
  assert.equal(ready(manager, {...edit,maskMode:'asset',maskId:'mask'}, source, {...source,width:20}).ready, false);
  assert.equal(ready(manager, {operation:'cloudExtend',width:600,height:400,left:0,top:0}, source).ready, false);
  assert.equal(ready(manager, {operation:'cloudExtend',width:800,height:600,left:100,top:100}, source).ready, true);
});
test('manual semantic plans need image route but not vision route, and validate every object', () => {
  const next = {...manager, routes:{...manager.routes,analysis:'missing'}};
  assert.equal(ready(next, {operation:'cloudSplit',instruction:'人物\n花束'}, source).ready, true);
  assert.equal(ready(next, {}, source, null, 'analysis').ready, false);
  for (const instruction of ['', '人物\n人物', '长'.repeat(401), Array.from({length:13},(_,i)=>String(i)).join('\n')])
    assert.equal(ready(manager, {operation:'cloudSplit',instruction}, source).ready, false);
});
