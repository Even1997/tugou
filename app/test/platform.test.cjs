const test = require('node:test');
const assert = require('node:assert/strict');
const { isDeleteKey } = require('../core/shortcuts.cjs');

test('Mac Delete key and Windows Forward Delete are recognized without treating Windows Backspace as deletion', () => {
  assert.equal(isDeleteKey({key:'Backspace'}, 'darwin'), true);
  assert.equal(isDeleteKey({key:'Backspace'}, 'win32'), false);
  for (const platform of ['darwin','win32']) {
    assert.equal(isDeleteKey({key:'Delete'}, platform), true);
    assert.equal(isDeleteKey({key:'a'}, platform), false);
  }
});
