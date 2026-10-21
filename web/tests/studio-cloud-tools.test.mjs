import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createServer } from 'node:http';
import { cloudOperation, cloudOutputSize, cloudToolPrompt } from '../src/app/studio/cloud-tool-input.js';
import { validateCloudSource, prepareCloudImage, finishCloudImage, readSelectionCoverage } from '../src/app/api/studio/cloud-image-tools.js';
import { generationInput } from '../src/app/api/studio/generation-queue.ts';
import { gateway, setConfig } from '../src/app/api/studio/gateway.ts';

const op = { kind:'edit',sourceId:'source',sourceWidth:8,sourceHeight:6,left:2,top:1,width:3,height:4 };
const signal = () => new AbortController().signal;
const url = buffer => 'data:image/png;base64,'+buffer.toString('base64');
const buffer = source => Buffer.from(source.split(',')[1],'base64');
const rgba = async source => sharp(buffer(source)).ensureAlpha().raw().toBuffer();
async function sample(width=8,height=6) {
 const data=Buffer.alloc(width*height*4);
 for(let i=0;i<data.length;i+=4){data[i]=(i*7)%256;data[i+1]=80;data[i+2]=123;data[i+3]=[0,90,255][(i/4)%3]}
 return url(await sharp(data,{raw:{width,height,channels:4}}).png().toBuffer());
}
async function red(width,height){return url(await sharp({create:{width,height,channels:4,background:'#ff0000'}}).png().toBuffer())}

test('cloud operations validate layout and immutable queue snapshot before sending',async()=>{
 for(const patch of [{kind:'other'},{sourceId:'../bad'},{left:-1},{width:1.5},{width:9},{sourceWidth:30001}])assert.throws(()=>cloudOperation({...op,...patch}));
 assert.throws(()=>cloudOperation({...op,kind:'upscale',left:0,top:0,width:16,height:13}));
 assert.throws(()=>cloudOperation({...op,kind:'outpaint',width:8,height:6}));
 assert.deepEqual(cloudOutputSize(op),{width:8,height:6});
 assert.ok(cloudToolPrompt(op,'换成蓝色').includes('换成蓝色'));
 const source=await sample();await assert.rejects(validateCloudSource(source,{...op,sourceWidth:9}),/尺寸或方向/);
 const input={id:'one',projectId:'project',name:'edit',prompt:'replace',instruction:'修改丝带',size:'8x6',references:['/api/studio/resource/'+'a'.repeat(64)+'.png'],operation:{...op,apiKey:'secret'}};
 const normalized=generationInput(input);assert.ok(!JSON.stringify(normalized).includes('secret'));assert.equal(normalized.instruction,'修改丝带');
 assert.throws(()=>generationInput({...input,size:'3x4'}));assert.throws(()=>generationInput({...input,references:[]}));
});
test('local edit transmits a matching transparent edit mask and preserves every RGBA byte outside selection',async()=>{
 const source=await sample(),prepared=await prepareCloudImage(source,op,signal());assert.equal(prepared.image,source);
 const mask=await rgba(prepared.mask),before=await rgba(source),after=await rgba(await finishCloudImage(source,await red(8,6),op,signal()));
 for(let y=0;y<6;y++)for(let x=0;x<8;x++){
  const offset=(y*8+x)*4,inside=x>=2&&x<5&&y>=1&&y<5;
  assert.equal(mask[offset+3],inside?0:255);
  assert.deepEqual([...after.subarray(offset,offset+4)],inside?[255,0,0,255]:[...before.subarray(offset,offset+4)]);
 }
});
test('outpaint transmits expanded canvas and preserves all original pixels including transparent RGB',async()=>{
 const source=await sample(),operation={...op,kind:'outpaint',width:12,height:10},prepared=await prepareCloudImage(source,operation,signal());
 const meta=await sharp(buffer(prepared.image)).metadata();assert.equal(meta.width,12);assert.equal(meta.height,10);
 const mask=await rgba(prepared.mask),before=await rgba(source),after=await rgba(await finishCloudImage(source,await red(12,10),operation,signal()));
 for(let y=0;y<10;y++)for(let x=0;x<12;x++){
  const offset=(y*12+x)*4,inside=x>=2&&x<10&&y>=1&&y<7;
  assert.equal(mask[offset+3],inside?255:0);
  const original=((y-1)*8+x-2)*4;
  assert.deepEqual([...after.subarray(offset,offset+4)],inside?[...before.subarray(original,original+4)]:[255,0,0,255]);
 }
});
test('enhance and creative upscale preserve source alpha; wrong model dimensions are rejected without resizing',async()=>{
 const source=await sample(),enhance={...op,kind:'enhance',left:0,top:0,width:8,height:6};
 const before=await rgba(source),after=await rgba(await finishCloudImage(source,await red(8,6),enhance,signal()));
 for(let i=3;i<before.length;i+=4)assert.equal(after[i],before[i]);
 const upscale={...enhance,kind:'upscale',width:16,height:12},result=await rgba(await finishCloudImage(source,await red(16,12),upscale,signal()));
 const alpha=await sharp(buffer(source)).ensureAlpha().extractChannel(3).resize(16,12).raw().toBuffer();
 for(let i=0;i<alpha.length;i++)assert.equal(result[i*4+3],alpha[i]);
 await assert.rejects(finishCloudImage(source,await red(8,6),upscale,signal()),/未拉伸/);
 const abort=new AbortController();abort.abort();await assert.rejects(prepareCloudImage(source,op,abort.signal));
});
test('Images edit adapter sends real mask bytes alongside expanded source and user instruction',async t=>{
 const source=await sample(),operation={...op,kind:'outpaint',width:12,height:10},prepared=await prepareCloudImage(source,operation,signal());let received;
 const server=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);received=await new Request('http://localhost'+req.url,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}).formData();res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{b64_json:buffer(await red(12,10)).toString('base64')}]}))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()});
 setConfig({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'fixture',model:'image-fixture'});
 await gateway('generate',{prompt:cloudToolPrompt(operation,'延伸花园'),size:'12x10',references:[prepared.image],mask:prepared.mask});
 assert.equal(received.get('size'),'12x10');assert.ok(received.get('prompt').includes('延伸花园'));
 assert.deepEqual(Buffer.from(await received.get('mask').arrayBuffer()),buffer(prepared.mask));
 assert.deepEqual(Buffer.from(await received.getAll('image[]')[0].arrayBuffer()),buffer(prepared.image));
});
test('arbitrary selection preserves holes and unselected hidden RGB, blends feathered alpha, and reverses API mask polarity',async()=>{
 const source=url(await sharp(Buffer.from([11,22,33,0, 0,0,255,128, 0,255,0,255]),{raw:{width:3,height:1,channels:4}}).png().toBuffer());
 const replacement=url(await sharp({create:{width:3,height:1,channels:4,background:{r:255,g:0,b:0,alpha:64/255}}}).png().toBuffer());
 const mask=url(await sharp(Buffer.from([255,255,255,0, 255,255,255,128, 255,255,255,255]),{raw:{width:3,height:1,channels:4}}).png().toBuffer());
 const operation={...op,sourceWidth:3,sourceHeight:1,width:3,height:1,left:0,top:0};
 const prepared=await prepareCloudImage(source,operation,signal(),mask),sent=await rgba(prepared.mask);
 assert.deepEqual([sent[3],sent[7],sent[11]],[255,127,0]);
 const output=await rgba(await finishCloudImage(source,replacement,operation,signal(),mask));
 assert.deepEqual([...output],[11,22,33,0, 85,0,170,96, 255,0,0,64]);
});
test('empty, wrong-size and non-PNG selection masks are rejected before a remote request',async()=>{
 const empty=url(await sharp({create:{width:8,height:6,channels:4,background:'#00000000'}}).png().toBuffer());
 await assert.rejects(readSelectionCoverage(empty,8,6),/未覆盖/);
 await assert.rejects(readSelectionCoverage(await red(8,6),8,7),/尺寸一致/);
 const jpg='data:image/jpeg;base64,'+(await sharp({create:{width:8,height:6,channels:3,background:'white'}}).jpeg().toBuffer()).toString('base64');
 await assert.rejects(readSelectionCoverage(jpg,8,6),/PNG/);
 const ref='/api/studio/resource/'+'a'.repeat(64)+'.png',input={id:'mask',projectId:'project',name:'masked',prompt:'edit',size:'8x6',references:[ref],operation:op,selectionMask:ref};
 assert.equal(generationInput(input).selectionMask,ref);
 assert.throws(()=>generationInput({...input,selectionMask:'https://remote/mask.png'}));assert.throws(()=>generationInput({...input,operation:undefined}));
});
