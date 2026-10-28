const {test}=require('node:test'),assert=require('node:assert/strict'),{ImageCache}=require('../core/image-cache.cjs');
const image=()=>({naturalWidth:10,naturalHeight:10});
test('decoded cache has LRU byte budget, deduplicates pending reads and skips oversize retention',async()=>{
  const c=new ImageCache(800);let calls=0;const loader=()=>{calls++;return image()};
  const [a,b]=await Promise.all([c.load('a',loader),c.load('a',loader)]);assert.equal(a,b);assert.equal(calls,1);
  await c.load('b',loader);await c.load('a',loader);await c.load('c',loader);assert.deepEqual([...c.keys()],['a','c']);assert.equal(c.bytes,800);assert.equal(c.evictions,1);
  await c.load('large',()=>({naturalWidth:100,naturalHeight:100}));assert.equal(c.bytes,800);assert.equal(c.size,2);c.clear();
  c.put('new',image());assert.equal(c.bytes,400);c.delete('new');assert.equal(c.bytes,0);
});
test('clear while decoding never resurrects entries; failures permit retry',async()=>{
  const c=new ImageCache(800);let resolve;const p=c.load('a',()=>new Promise(r=>resolve=r));await Promise.resolve();c.clear();resolve(image());await p;assert.equal(c.bytes,0);assert.equal(c.size,0);
  await assert.rejects(c.load('b',()=>{throw Error('decode')}));await c.load('b',image);assert.equal(c.bytes,400);
});
