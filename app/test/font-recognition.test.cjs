const test=require('node:test'),assert=require('node:assert/strict');
const {initialize,issue,draft,confidence}=require('../core/font-recognition.cjs');
const row=(character,score=1)=>({character,score,box:[2,2,40,40],warnings:[]});
test('valid glyphs are included by default regardless of library, count or sub-100 confidence',()=>{
 const rows=initialize(Array.from({length:600},(_,i)=>row(String.fromCodePoint(0x4e00+i),.999999)),null,50,50);
 assert.equal(rows.filter(e=>e.included).length,600);assert.ok(rows.every(e=>e.needsReview&&!e.reviewed));
 assert.equal(confidence(.999999),'99.99%');assert.equal(confidence(1),'100%');
 assert.equal(initialize([row('春')],null,50,50)[0].needsReview,false);
});
test('duplicate identities choose one best candidate; malformed candidates stay excluded for review',()=>{
 const rows=initialize([row('春',.8),row('春',.9),row(''),row('AB'),row(' '),{...row('信'),box:[0,0,100,100]}],null,50,50);
 assert.deepEqual(rows.map(e=>e.included),[false,true,false,false,false,false]);
 assert.ok(rows[0].needsReview);assert.ok(issue(rows[5],50,50));
});
test('review corrections, exclusions and added glyphs survive reload without claiming identity verified',()=>{
 const candidates=[row('春',.9),row('日',.8)];const rows=initialize(candidates,null,50,50);
 rows[0]={...rows[0],character:'来',reviewed:true};rows[1].included=false;rows.push({...row('信'),included:true,reviewed:true});
 const restored=initialize(candidates,draft(rows),50,50);
 assert.equal(restored[0].character,'来');assert.equal(restored[0].reviewed,true);assert.equal(restored[1].included,false);assert.equal(restored[2].character,'信');
 assert.equal(restored[0].identity,undefined);
});

test('historically rounded 100 percent remains reviewable',()=>{assert.equal(initialize([row('春')],null,50,50,false)[0].needsReview,true);assert.equal(confidence(1,false),'约 100%');});

test('editing an excluded OCR identity restores a valid glyph without a keep checkbox',()=>{
 const {edit}=require('../core/font-recognition.cjs');const before=[{...row('春'),included:false,reviewed:true}];
 const changed=edit(before,0,{character:'来'},50,50);assert.equal(changed[0].included,true);assert.equal(changed[0].reviewed,false);assert.equal(before[0].character,'春');
 assert.equal(edit(changed,0,{character:''},50,50)[0].included,false);
 assert.equal(edit(changed,0,{included:false},50,50)[0].included,false);
 assert.equal(edit(changed,0,{box:[0,0,100,100]},50,50)[0].included,false);
});
