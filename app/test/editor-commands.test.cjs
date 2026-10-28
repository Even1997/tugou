const {test}=require('node:test'),assert=require('node:assert/strict');
const {deleteTarget,editorShortcut}=require('../core/editor-commands.cjs');
test('delete intent distinguishes selection, mask, empty mask and layers',()=>{
  for(const mask of [true,false])assert.equal(deleteTarget({selection:{},mask,hasMask:true}),'selection');
  assert.equal(deleteTarget({mask:true,hasMask:true}),'mask');assert.equal(deleteTarget({mask:true,hasMask:false}),'none');assert.equal(deleteTarget({mask:false}),'layers');
});
test('composition shortcuts use PS semantics with platform delete',()=>{
  for(const mod of ['ctrlKey','metaKey']){
    assert.equal(editorShortcut({key:'d',[mod]:true}),'deselect');assert.equal(editorShortcut({key:'J',[mod]:true}),'duplicate');assert.equal(editorShortcut({key:'I',[mod]:true,shiftKey:true}),'inverse');
  }
  assert.equal(editorShortcut({key:'x'}),'swapMaskInk');assert.equal(editorShortcut({key:'Backspace'},'win32'),null);assert.equal(editorShortcut({key:'Backspace'},'darwin'),'delete');assert.equal(editorShortcut({key:'Delete'},'win32'),'delete');assert.equal(editorShortcut({key:'d',ctrlKey:true,altKey:true}),null);
});
