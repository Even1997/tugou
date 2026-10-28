const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {builtinFonts,findBuiltinFont}=require('../core/builtin-fonts.cjs'),{fontLibrary}=require('../core/font-catalog.cjs');
test('bundled WenKai matches the official release bytes and retains upstream license',async()=>{
  const f=builtinFonts[0],bytes=await fs.readFile(path.join(__dirname,'../assets/fonts',f.file)),license=await fs.readFile(path.join(__dirname,'../assets/fonts/lxgw-wenkai/OFL.txt'),'utf8');
  assert.equal(bytes.length,f.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);assert.deepEqual([...bytes.subarray(0,4)],[0,1,0,0]);assert.match(license,/SIL OPEN FONT LICENSE Version 1.1/);assert.match(license,/The Klee Project Authors/);assert.match(license,/Copyright 2021-2026 LXGW/);
});
test('builtin identity resolves Chinese and English names without treating paths as fonts',()=>{
  for(const name of ['霞鹜文楷','霞鶩文楷','lxgw wenkai',' LXGWWenKai '])assert.equal(findBuiltinFont(name)?.id,'lxgw-wenkai-regular');
  assert.equal(findBuiltinFont('../LXGWWenKai-Regular.ttf'),undefined);assert.equal(findBuiltinFont(null),undefined);
});
test('every bundled font has unique identities, original bytes, source and full license',async()=>{
  const ids=new Set(),names=new Map();
  for(const f of builtinFonts){
    assert.ok(!ids.has(f.id));ids.add(f.id);
    for(const alias of [f.family,f.name,...f.aliases]){const key=alias.toLowerCase();assert.ok(!names.has(key)||names.get(key)===f.id,alias);names.set(key,f.id);assert.equal(findBuiltinFont(alias)?.id,f.id);}
    const root=path.join(__dirname,'../assets/fonts'),bytes=await fs.readFile(path.join(root,f.file));
    assert.equal(bytes.length,f.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);
    assert.ok([0x4f54544f,0x74746366,0x00010000].includes(bytes.readUInt32BE(0)),f.id);
    const license=await fs.readFile(path.join(root,f.licenseFile),'utf8');assert.ok(license.length>300);assert.match(license,/license|permission|利用|授[权權]/i);
    const source=await fs.readFile(path.join(root,path.dirname(f.file),'SOURCE.md'),'utf8');assert.ok(source.includes(f.sha256));assert.ok(source.includes(f.source));
  }
  assert.ok(ids.size>=53);
});
test('font library exposes builtins while keeping published custom fonts independent',async()=>{
  const result=await fontLibrary({dispatch:async()=>({projects:[{id:'custom'},{id:'unpublished'}]}),load:async id=>id==='custom'?{id,name:'霞鹜文楷',published:{fontResource:{jobId:'published'},sourceRevision:1}}:{id,name:'未发布'}});
  assert.equal(result.custom.length,1);assert.equal(result.custom[0].projectId,'custom');assert.equal(result.builtin[0].family,'LXGW WenKai');assert.ok(result.system.every(f=>!findBuiltinFont(f.family)));
});
