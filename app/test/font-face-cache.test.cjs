const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{buildSync}=require('esbuild');
const {builtinFonts}=require('../core/builtin-fonts.cjs'),{fontFaces}=require('../core/font-weights.cjs');
function fixture(){
 const code=buildSync({entryPoints:[require.resolve('../renderer/font-face.js')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
 const document={fonts:new Set()},calls=[],downloads=[],module={exports:{}};
 class FontFace{constructor(family,source,{weight}){Object.assign(this,{family,source,weight});calls.push(this)}async load(){return this}}
 const window={tugou:{fontCommand:async(name,args)=>{assert.equal(name,'font.download');downloads.push(args.id);}}};
 vm.runInNewContext(code,{module,exports:module.exports,document,FontFace,window});return {...module.exports,document,calls,downloads};
}
test('font cache evicts unused weights and can reload an evicted face',async()=>{
 const f=fixture(),first={fontFamily:builtinFonts[0].family,fontWeight:300};
 const original=await f.loadTextFont(first);assert.equal(f.calls.length,1);assert.equal(await f.loadTextFont(first),original);assert.equal(f.calls.length,1);assert.equal(f.downloads.length,1);
 for(const family of builtinFonts)for(const face of fontFaces(family))await f.loadTextFont({fontFamily:family.family,fontWeight:face.weight});
 assert.ok(f.document.fonts.size<8);assert.ok(!f.document.fonts.has(original));assert.notEqual(await f.loadTextFont(first),original);
});
test('legacy bold has an isolated regular face so newly loaded bold cannot alter old documents',async()=>{
 const f=fixture(),base={fontFamily:'Source Han Sans SC'},old={...base,fontStyle:'bold'},modern={...base,fontWeight:700};
 const a=await f.loadTextFont(old),b=await f.loadTextFont(modern);assert.notEqual(a.family,b.family);assert.equal(a.weight,'400');assert.equal(b.weight,'700');
});
