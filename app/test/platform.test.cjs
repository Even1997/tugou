const test = require('node:test');
const assert = require('node:assert/strict');
const { isDeleteKey } = require('../core/shortcuts.cjs');
const {initialWindowBounds}=require('../core/desktop-platform.cjs');

test('startup window fits and centers in the display work area including scaled and negative-origin displays',()=>{
  assert.deepEqual(initialWindowBounds({x:0,y:0,width:1920,height:1040}),{x:320,y:120,width:1280,height:800,minWidth:940,minHeight:640});
  for(const area of [{x:0,y:0,width:1366,height:728},{x:-1536,y:32,width:1536,height:824},{x:0,y:0,width:1024,height:600}]){
    const b=initialWindowBounds(area);
    assert.ok(b.x>=area.x+24&&b.y>=area.y+24&&b.x+b.width<=area.x+area.width-24&&b.y+b.height<=area.y+area.height-24);
    assert.ok(b.minWidth<=b.width&&b.minHeight<=b.height);
    assert.ok(Math.abs((b.x-area.x)*2+b.width-area.width)<=1&&Math.abs((b.y-area.y)*2+b.height-area.height)<=1);
  }
});

test('Mac Delete key and Windows Forward Delete are recognized without treating Windows Backspace as deletion', () => {
  assert.equal(isDeleteKey({key:'Backspace'}, 'darwin'), true);
  assert.equal(isDeleteKey({key:'Backspace'}, 'win32'), false);
  for (const platform of ['darwin','win32']) {
    assert.equal(isDeleteKey({key:'Delete'}, platform), true);
    assert.equal(isDeleteKey({key:'a'}, platform), false);
  }
});
