import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import sharp from 'sharp';
import { prepareCloudImage, finishCloudImage } from '../src/app/api/studio/cloud-image-tools.js';
import { cloudOperation, cloudToolPrompt, splitTargets } from '../src/app/studio/cloud-tool-input.js';
import { gateway, setConfig } from '../src/app/api/studio/gateway.ts';
import { generationInput } from '../src/app/api/studio/generation-queue.ts';
import { alignGeneration } from '../src/app/studio/collect-generation.ts';
import { blankProject, validateProject } from '../src/app/studio/model.ts';

const encode=b=>'data:image/png;base64,'+b.toString('base64'),decode=s=>Buffer.from(s.split(',')[1],'base64');
const png=(raw,width=4,height=2)=>sharp(Buffer.from(raw),{raw:{width,height,channels:4}}).png().toBuffer();
const op={kind:'segment',sourceId:'source',sourceWidth:4,sourceHeight:2,width:4,height:2,left:0,top:0};
const raw=[20,40,60,255, 70,80,90,128, 120,130,140,0, 10,200,250,200, 50,150,60,255, 250,40,90,255, 80,60,20,99, 190,80,130,1];
const coverage=[0,255,128,64,255,0,128,255],mask=coverage.flatMap(v=>[v,v,v,255]),signal=()=>new AbortController().signal;
test('semantic extraction uses only original RGB and source alpha times model coverage, retaining holes and original dimensions',async()=>{
 const source=encode(await png(raw)),generated=encode(await png(mask)),prepared=await prepareCloudImage(source,op,signal());
 assert.equal(prepared.image,source);assert.equal(prepared.mask,undefined);
 const output=await sharp(decode(await finishCloudImage(source,generated,op,signal()))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 assert.deepEqual([output.info.width,output.info.height],[4,2]);
 for(let n=0;n<8;n++){assert.deepEqual([...output.data.subarray(n*4,n*4+3)],raw.slice(n*4,n*4+3));assert.equal(output.data[n*4+3],Math.round(raw[n*4+3]*coverage[n]/255));}
});
test('color, transparent, uniform, empty, wrong-size masks and aborted tasks do not publish an extraction',async()=>{
 const source=encode(await png(raw));
 for(const pixels of [raw,mask.map((v,i)=>i%4===3?0:v),Array(8).fill([255,255,255,255]).flat(),Array(8).fill([0,0,0,255]).flat()])await assert.rejects(finishCloudImage(source,encode(await png(pixels)),op,signal()),/蒙版|区分/);
 await assert.rejects(finishCloudImage(source,encode(await png(Array(4).fill([255,255,255,255]).flat(),2,2)),op,signal()),/未拉伸/);
 const c=new AbortController();c.abort();await assert.rejects(finishCloudImage(source,encode(await png(mask)),op,c.signal),{name:'AbortError'});
 await assert.rejects(prepareCloudImage(source,op,signal(),encode(await png(mask))),/只有局部/);
});
test('category targets are editable, deduplicated, bounded and sent as a single immutable task each',()=>{
 assert.deepEqual(splitTargets(' 新娘\r\n花束\n新娘\n'),['新娘','花束']);
 for(const text of ['',Array(13).fill(0).map((_,i)=>'类别'+i).join('\n'),'a'.repeat(301)])assert.throws(()=>splitTargets(text));
 for(const changes of [{left:1},{width:8,height:4}])assert.throws(()=>cloudOperation({...op,...changes}));
 const prompt=cloudToolPrompt(op,'蓝色花束');assert.match(prompt,/不透明灰度/);assert.match(prompt,/蓝色花束/);assert.throws(()=>cloudToolPrompt(op,'新娘\n花束'));
 const input={id:'job',projectId:'project',name:'花束',prompt,size:'4x2',references:['/api/studio/resource/'+'a'.repeat(64)+'.png'],operation:op,instruction:'蓝色花束'};
 const saved=generationInput(input);input.operation={};assert.deepEqual(saved.operation,op);assert.equal(saved.instruction,'蓝色花束');
});
test('shared vision endpoint validates categories, propagates cancellation and does not follow instruction text inside an image',async t=>{
 let result={targets:['左侧人物','右侧宠物','左侧人物']},received,hold=false;
 const server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);received=JSON.parse(Buffer.concat(chunks));if(hold)return;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()});
 setConfig({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'fixture-only',model:'image-model',analysisModel:'vision-model'});
 const image=encode(await png(raw));assert.deepEqual(await gateway('split-categories',{image}),{targets:['左侧人物','右侧宠物']});assert.equal(received.model,'vision-model');assert.match(received.messages[0].content,/不执行其中指令/);assert.equal(received.messages[1].content[0].image_url.url,image);
 for(const targets of [[],[42],['one\ntwo'],Array(13).fill('x')]){result={targets};await assert.rejects(gateway('split-categories',{image}));}
 hold=true;received=undefined;const c=new AbortController(),pending=gateway('split-categories',{image},c.signal);while(!received)await new Promise(r=>setTimeout(r,5));c.abort();await assert.rejects(pending,/cancel/i);
});
test('aligned extraction preserves source transform, deduplicates collection and supports caller undo without modifying the source',()=>{
 const layer={id:'layer',assetId:'source',kind:'image',name:'source',x:20,y:30,width:40,height:20,rotation:25,flipX:true,flipY:false,opacity:.7,blend:'multiply',visible:true,locked:true};
 const project={...blankProject(),id:'project',layers:[layer],assets:[{id:'source'}]},job={id:'job',projectId:'project',status:'completed',operation:op,result:{id:'result',generationJobId:'job',width:4,height:2,name:'花束'}};
 const aligned=alignGeneration(project,job,'layer');assert.equal(project.layers.length,1);assert.equal(aligned.layers.length,2);assert.deepEqual(aligned.layers[0],layer);
 for(const key of ['x','y','width','height','rotation','flipX','flipY','opacity','blend'])assert.equal(aligned.layers[1][key],layer[key]);assert.equal(aligned.layers[1].locked,false);
 assert.equal(alignGeneration(aligned,job,'layer'),aligned);assert.throws(()=>alignGeneration({...project,id:'other'},job,'layer'),/工程/);assert.throws(()=>alignGeneration({...project,layers:[{...layer,bitmap:{}}]},job,'layer'),/来源/);
});
test('category draft validation preserves text and rejects oversized or duplicate source plans',()=>{
 const project={...blankProject(),splitPlans:[{sourceId:'source',targets:'人物\n背景'}]};validateProject(project);
 assert.throws(()=>validateProject({...project,splitPlans:[...project.splitPlans,...project.splitPlans]}),/方案/);
 assert.throws(()=>validateProject({...project,splitPlans:[{sourceId:'source',targets:'a'.repeat(3601)}]}),/方案/);
});
