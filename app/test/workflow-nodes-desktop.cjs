const {app,dialog,clipboard}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {encode}=require('../core/cloud-pixels.cjs');
const base=path.resolve(__dirname,'../test-results/workflow-nodes');fs.mkdirSync(base,{recursive:true});
require('./workflow-fixtures.cjs').write(base);
const profile=fs.mkdtempSync(path.join(base,'desktop-'));process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.resolve(__dirname,'../test-results/workflow-build');
if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;
const report={profile,checks:[],errors:[]},requests=[];let png,copied='';clipboard.writeText=s=>copied=s;
const server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();requests.push({url:req.url,raw});
  if(req.url.endsWith('/chat/completions'))res.end(JSON.stringify({choices:[{message:{content:'可编辑的婚礼文案'}}]}));
  else if(req.url.includes('/images/')){let count=1;try{count=JSON.parse(raw).n;}catch{}res.end(JSON.stringify({data:Array.from({length:count},()=>({b64_json:png.toString('base64')}))}));}
  else if(req.url.endsWith('/audio/speech'))res.end(fs.readFileSync(path.join(base,'sample.wav')));
  else if(req.url==='/v1/videos'&&req.method==='POST')res.end(JSON.stringify({id:'video-1',status:'queued'}));
  else if(req.url==='/v1/videos/video-1')res.end(JSON.stringify({id:'video-1',status:'completed'}));
  else if(req.url==='/v1/videos/video-1/content')res.end(fs.readFileSync(path.join(base,'sample.mp4')));else{res.statusCode=404;res.end();}
});
const finish=code=>{fs.writeFileSync(path.join(base,process.env.TUGOU_TEST_APP?'packaged-workflow.json':'desktop.json'),JSON.stringify(report,null,2));server.closeAllConnections();server.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},180000);
app.on('web-contents-created',(_,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message);}));
app.on('browser-window-created',(_,w)=>{
  w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
    const wait=async s=>{for(let i=0;i<750;i++){if(await js(`(async()=>Boolean(await (${s})))()`))return;await delay(40);}throw Error('timeout '+s);};
    const check=(label,v)=>{assert.ok(v,label);report.checks.push(label);};
    const click=async(label,selector='button')=>{await js(`{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)});if(!e||e.disabled)throw Error('missing '+${JSON.stringify(label)});e.click()}`);await delay(120);};
    const set=async(label,value)=>{await js(`{const e=document.querySelector('[aria-label="${label}"]');if(!e)throw Error('missing field ${label}');const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))}`);await delay(100);};
    const save=async()=>{await delay(150);if(await js('[...document.querySelectorAll("button")].some(e=>e.getAttribute("aria-label")==="保存"&&!e.disabled)'))await click('保存');await wait('document.querySelector(".statusbar [role=status]").textContent==="已保存"');return(await js(`tugou.open(${JSON.stringify(report.id)})`)).document;};
    const load=async()=>{await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'canvas'}))`);const ready=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await ready;await wait('document.querySelector(".react-flow__pane")');};
    const snapshot=async name=>{await w.capturePage();await delay(120);fs.writeFileSync(path.join(base,name+'.png'),(await w.capturePage()).toPNG());};
    const choose=async label=>{await click('添加节点');await click(label,'.ant-dropdown:not(.ant-dropdown-hidden) [role=menuitem]');};
    const select=async id=>{await click('适应画布');await delay(250);await js(`document.querySelector('[data-id="${id}"]').click()`);await delay(120);};
    try{
      png=await encode({width:256,height:128,data:Buffer.alloc(256*128*4,210)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
      report.id=await js('(async()=>{const r=await tugou.create("完整节点验收");return r.id})()');
      await js(`tugou.saveConnection({baseUrl:'http://127.0.0.1:${server.address().port}/v1',apiKey:'fixture-no-real-key',model:'image',textModel:'text',videoModel:'video',audioModel:'audio'})`);await load();
      const ids={};
      for(const [type,label,action] of [['textgen','文本生成','生成文本'],['image','图片生成','生成图片'],['video','视频生成','生成视频'],['audio','音频参考','生成语音'],['panorama','全景图','生成图片'],['config','生成台','开始生成']]){
        if(type==='panorama'){
          const doc=await save(),legacy=require('../core/workflow-nodes.cjs').workflowNode('panorama',{x:0,y:0});doc.tugouCanvas.nodes.push(legacy);
          await js(`(async()=>{const r=await tugou.open('${report.id}');await tugou.save(r.id,${JSON.stringify(doc)},r.revision)})()`);await load();await select(legacy.id);
        }else await choose(label);
        let doc=await save(),node=doc.tugouCanvas.nodes.at(-1);ids[type]=node.id;check(label+(type==='panorama'?' existing node remains readable':' creates a real typed node'),node.type===type);
        await set('节点提示词',label+' 测试内容');if(type==='image')await set('生成数量',2);if(type==='audio')await set('音频格式','wav');if(type==='config')await set('生成类型','text');
        await click(action);await wait(`(await tugou.tasks()).some(t=>t.context.nodeId===${JSON.stringify(node.id)}&&t.status==='completed')`);await delay(1400);doc=await save();
        node=doc.tugouCanvas.nodes.find(n=>n.id===node.id);check(label+' returns a persisted usable result',Boolean(node.data.outputAssetId)&&doc.assets.some(a=>a.id===node.data.outputAssetId));
        if(type==='image')check('batch count actually produces two assets',node.data.outputAssetIds.length===2);
        if(type==='textgen'){await set('节点文本','修改后的文案');await click('复制文本结果');check('copy text result uses clipboard bridge',copied==='修改后的文案');}
        if(type==='video'||type==='audio'){await wait(`document.querySelector('.canvas-inspector ${type==='video'?'video':'audio'}')?.readyState>=1`);check(type+' media metadata loads and native controls are present',await js(`document.querySelector('.canvas-inspector ${type==='video'?'video':'audio'}').controls`));}
      }
      let doc=await save();check('shared connection covers all four model modes',new Set((await js('tugou.tasks()')).map(t=>t.context.model)).size===4);
      const {workflowNode}=require('../core/workflow-nodes.cjs');
      const desk=workflowNode('config',{x:650,y:100}),middle=workflowNode('textgen',{x:330,y:100});
      desk.data.name='配置节点';desk.data.mode='text';middle.data.prompt='完整全身';
      const words={id:'desk-words',type:'text',position:{x:20,y:40},data:{name:'人物',text:'保留人物五官'}},reference={id:'desk-ref',type:'asset',position:{x:20,y:240},data:{assetId:doc.tugouCanvas.nodes.find(n=>n.id===ids.image).data.outputAssetId,role:'人物参考'}};
      const person={id:'desk-person',type:'module',position:{x:20,y:440},data:{binding:{moduleId:'person',snapshot:{id:'person',name:'新娘',kind:'character',text:'杏眼长发',global:false}}}},action={id:'desk-action',type:'module',position:{x:330,y:440},data:{binding:{moduleId:'action',snapshot:{id:'action',name:'牵手',kind:'action',text:'轻轻牵手',global:false}}}};
      doc.modules.push(person.data.binding.snapshot,action.data.binding.snapshot,{id:'desk-style',name:'C 版画风',kind:'style',text:'柔和手绘',global:true});
      const originalGraph=structuredClone(doc.tugouCanvas);
      doc.tugouCanvas={...doc.tugouCanvas,nodes:[words,reference,middle,desk,person,action],edges:[{id:'words-mid',source:words.id,target:middle.id},{id:'ref-mid',source:reference.id,target:middle.id},{id:'mid-desk',source:middle.id,target:desk.id},{id:'person-mid',source:person.id,target:middle.id},{id:'action-mid',source:action.id,target:middle.id}]};
      await js(`(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});await tugou.save(r.id,${JSON.stringify(doc)},r.revision)})()`);await load();await select(desk.id);
      check('old configuration node displays as generation desk without rewriting its name',await js(`document.querySelector('[data-id="${desk.id}"] header').innerText.trim()==='生成台'`)&&(await save()).tugouCanvas.nodes.find(n=>n.id===desk.id).data.name==='配置节点');
      await click('输入来源',`[data-id="${desk.id}"] button`);
      await js(`document.querySelector('.desk-popover details[data-source-node="desk-words"] summary').click()`);
      check('generation desk summarizes indirect text and reference inputs on the card',await js(`document.querySelector('[data-id="${desk.id}"]').innerText.includes('1 个参考')&&document.querySelector('.desk-popover').innerText.includes('保留人物五官')`));
      check('source groups show character action and global style with actual source identifiers',await js(`document.querySelector('.canvas-inspector [data-source-node="desk-person"] summary').textContent.includes('人物')&&document.querySelector('.canvas-inspector [data-source-node="desk-action"] summary').textContent.includes('动作')&&document.querySelector('.canvas-inspector [data-source-module="desk-style"]').textContent.includes('全局模块')`));
      await js(`document.querySelector('.canvas-inspector [data-source-node="desk-ref"] summary').click()`);
      await wait(`document.querySelector('.canvas-inspector [data-source-node="desk-ref"] img')?.naturalWidth>0`);
      check('reference provenance shows original node role and thumbnail',await js(`document.querySelector('.canvas-inspector [data-source-node="desk-ref"]').innerText.includes('人物参考')`));
      await click('输入来源',`[data-id="${desk.id}"] button`);
      await click('合成提示词','.canvas-inspector summary');check('full assembled prompt is reviewable',await js('document.querySelector("[aria-label=合成提示词]").value.includes("完整全身")'));
      await click('适应画布');await delay(300);await snapshot('generation-desk');
      const beforeTasks=(await js('tugou.tasks()')).length;
      await click('开始生成',`[data-id="${desk.id}"] button`);await wait(`(await tugou.tasks()).some(t=>t.context.nodeId===${JSON.stringify(desk.id)}&&t.status==='completed')`);await delay(1400);doc=await save();
      check('generation desk submits only one task and saves the result', (await js('tugou.tasks()')).length===beforeTasks+1&&doc.tugouCanvas.nodes.find(n=>n.id===desk.id).data.outputAssetId&&doc.assets.some(a=>a.generation?.nodeId===desk.id&&a.name.startsWith('生成台')));
      const payload=JSON.parse(requests.filter(r=>r.url.endsWith('/chat/completions')).at(-1).raw);
      check('model receives the multi-level prompt and actual image reference',JSON.stringify(payload).includes('保留人物五官')&&JSON.stringify(payload).includes('完整全身')&&JSON.stringify(payload).includes('data:image/'));
      await select(words.id);await set('画布自由提示词','修改后的人物五官');await select(desk.id);
      check('upstream edits refresh assembled preview',await js(`document.querySelector('.canvas-inspector [data-source-node="desk-words"]').textContent.includes('修改后的人物五官')`));
      doc=await save();doc.tugouCanvas=originalGraph;
      await js(`(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});await tugou.save(r.id,${JSON.stringify(doc)},r.revision)})()`);await load();
      await select(ids.image);await click('图片工具');await click('复制提示词');check('generated image node exposes shared image tools and exact prompt',copied==='图片生成 测试内容');await click('原图与提示词');await wait('document.body.innerText.includes("素材详情")');await click('关闭素材详情');
      await select(ids.video);await click('媒体工具');await wait('document.querySelector(".ant-modal video")?.readyState>=2');await click('提取视频帧');await wait('document.body.innerText.includes("结果已加入素材库和画布")');await click('关闭媒体工具');
      doc=await save();check('video frame extraction creates a real image',doc.assets.some(a=>a.name.includes('视频帧')&&a.width===128&&a.height===72));
      await select(ids.video);await click('媒体工具');await wait('document.querySelector(".ant-modal video")?.readyState>=2');await set('片段开始',0.1);await set('片段结束',0.7);await click('截取片段');await wait('document.body.innerText.includes("结果已加入素材库和画布")');await click('关闭媒体工具');
      doc=await save();check('video trim creates an encoded video',doc.assets.some(a=>a.name.includes('片段')&&a.kind==='video'&&a.bytes>1000));
      await select(ids.video);await click('媒体工具');await wait('document.querySelector(".ant-modal video")?.readyState>=2');await click('提取音轨');await wait('document.body.innerText.includes("结果已加入素材库和画布")');await click('关闭媒体工具');
      doc=await save();check('video audio extraction creates an audio-only file',doc.assets.some(a=>a.name.includes('音轨')&&a.kind==='audio'&&a.bytes>1000));
      await select(ids.video);await click('媒体工具');await wait('document.querySelector(".ant-modal video")?.readyState>=2');await click('截取片段');await click('取消处理');await wait('![...document.querySelectorAll("button")].some(e=>e.textContent==="取消处理")');await click('关闭媒体工具');check('cancelled media trim does not publish a partial asset',(await save()).assets.length===doc.assets.length);
      await select(ids.audio);await click('媒体工具');await wait('document.querySelector(".ant-modal audio")?.readyState>=2');await set('片段开始',0.1);await set('片段结束',0.6);await click('截取片段');await wait('document.body.innerText.includes("结果已加入素材库和画布")');await click('关闭媒体工具');
      doc=await save();check('audio trim produces playable audio media',doc.assets.some(a=>a.name.includes('片段')&&a.kind==='audio'&&a.bytes>1000));
      await select(ids.panorama);await click('环视全景');await wait('document.querySelector("[data-scene-view] canvas")');await snapshot('panorama');await click('关闭全景查看');
      check('panorama viewer opens and closes',!(await js('document.querySelector("[data-scene-view]")')));
      await choose('3D 导演台');doc=await save();ids.director=doc.tugouCanvas.nodes.at(-1).id;await click('打开导演台');await wait('document.querySelector("[data-scene-view] canvas")');
      await click('添加角色');await set('角色姿势','walking');await set('角色体型','child');await click('添加方块');await set('position-0',2);await set('镜头视角',60);await click('添加机位');await snapshot('director');
      await click('截图送入画布');await delay(350);await click('关闭3D 导演台');doc=await save();let director=doc.tugouCanvas.nodes.find(n=>n.id===ids.director);
      check('director persists editable actors objects and cameras',director.data.scene.objects.length===2&&director.data.scene.cameras.length===2&&director.data.scene.cameras[0].fov===60);
      check('director capture enters library and canvas',doc.assets.some(a=>a.name==='场景截图')&&director.data.outputAssetId);
      check('actor body and pose persist',director.data.scene.objects[0].body==='child'&&director.data.scene.objects[0].pose.leftLeg===.5);
      await select(ids.director);await click('打开导演台');await click('动画轨道','summary');await click('保存关键帧');await set('关键帧时间',1);await set('场景物体',director.data.scene.objects[1].id);await set('position-0',4);await click('保存关键帧');await set('动画预览',.5);
      await set('多方位截图',4);await wait('[...document.querySelectorAll("button")].some(e=>e.textContent==="截图送入画布"&&!e.disabled)');await click('关闭3D 导演台');doc=await save();
      check('multi-view capture publishes four separate images',doc.assets.filter(a=>/^场景截图 [1-4]$/.test(a.name)).length===4);
      check('animation saves two distinct scene keyframes',doc.tugouCanvas.nodes.find(n=>n.id===ids.director).data.scene.frames[1].objects[1].position[0]===4);
      const objFile=path.join(base,'model.obj');fs.writeFileSync(objFile,'v -1 0 0\nv 1 0 0\nv 0 2 0\nf 1 2 3\n');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[objFile]});await select(ids.director);await click('打开导演台');await click('导入模型');await delay(500);await click('截图送入画布');await wait('[...document.querySelectorAll("button")].some(e=>e.textContent==="截图送入画布"&&!e.disabled)');await click('关闭3D 导演台');doc=await save();
      check('imported OBJ is stored as a project resource',doc.tugouCanvas.nodes.find(n=>n.id===ids.director).data.scene.objects.some(o=>o.kind==='model'&&fs.existsSync(path.join(profile,'workspace','resources',o.resource))));
      await select(ids.director);await click('打开导演台');await wait('document.querySelector("[data-scene-view] canvas")');await set('录制秒数',1);await click('录制机位视频');await wait('[...document.querySelectorAll("button")].some(e=>e.textContent==="录制机位视频")');await click('关闭3D 导演台');doc=await save();
      check('director records actual local video',doc.assets.some(a=>a.name.startsWith('机位录制.')&&a.kind==='video'&&a.bytes>1000));
      await select(ids.director);await click('打开导演台');await set('录制秒数',10);await click('录制机位视频');await delay(150);await click('取消录制');await wait('[...document.querySelectorAll("button")].some(e=>e.textContent==="录制机位视频")');await click('关闭3D 导演台');
      check('cancelled recording does not publish partial media',(await save()).assets.length===doc.assets.length);
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.join(base,'sample.wav')]});await choose('导入视频或音频');await delay(200);doc=await save();check('media import produces library asset and reference node',doc.assets.at(-1).kind==='audio'&&doc.tugouCanvas.nodes.at(-1).data.assetId===doc.assets.at(-1).id);
      const output=path.join(base,'export.wav');dialog.showSaveDialog=async()=>({canceled:false,filePath:output});await js(`tugou.exportAsset(${JSON.stringify(report.id)},${JSON.stringify(doc)},${JSON.stringify(doc.assets.at(-1).id)})`);check('media exports exact original bytes',fs.readFileSync(output).equals(fs.readFileSync(path.join(base,'sample.wav'))));
      const saved=JSON.stringify(doc);await load();doc=await save();check('reload preserves all node types scene data and media',JSON.stringify(doc)===saved);
      await click('素材库');await wait('document.querySelector(".asset-grid")');await snapshot('library');check('mixed media library renders',await js('document.body.innerText.includes("视频")&&document.body.innerText.includes("音频")'));
      await click('图层合成');await delay(150);check('image-only editor remains usable with mixed assets',await js('Boolean(document.querySelector(".layer-stage"))'));
      check('no renderer errors',report.errors.length===0);check('test window stays hidden',!w.isVisible());finish(0);
    }catch(e){report.failure=e.stack;report.text=await js('document.body.innerText');await snapshot('failure');finish(1);}
  });
});
require(process.env.TUGOU_TEST_APP||'../desktop-main.cjs');
