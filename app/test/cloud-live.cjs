// Explicit opt-in: one paid request per case; credentials stay in ConnectionStore memory.
const {app,safeStorage,nativeImage}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
const {ConnectionStore}=require('../core/connection.cjs');
const {ProjectStore}=require('../core/storage.cjs');
const {TaskQueue}=require('../core/tasks.cjs');
const {CloudTaskService}=require('../core/cloud-tasks.cjs');
const {cloudRunner}=require('../core/cloud-runner.cjs');
const {saveImage}=require('../core/generation.cjs');
const {decode}=require('../core/cloud-pixels.cjs');
const out=path.resolve('test-results/cloud-live');
const userRoot=path.join(path.resolve(process.env.TUGOU_DATA_DIR||'preview-data'),'workspace');
// Reuse only the OS-encrypted key material, never the user's mutable profile.
const syncFs=require('node:fs'),os=require('node:os');
const temp=syncFs.mkdtempSync(path.join(os.tmpdir(),'tugou-cloud-live-'));
const state=JSON.parse(syncFs.readFileSync(path.join(path.dirname(userRoot),'Local State'),'utf8'));
syncFs.writeFileSync(path.join(temp,'Local State'),JSON.stringify({os_crypt:state.os_crypt}));
app.setPath('userData',temp);
app.on('will-quit',()=>{if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('tugou-cloud-live-'))syncFs.rmSync(temp,{recursive:true,force:true,maxRetries:3});});
app.whenReady().then(async()=>{
  await fs.mkdir(out,{recursive:true});
  const connections=new ConnectionStore(userRoot,safeStorage);
  const publicSettings=await connections.publicSettings();
  console.log(JSON.stringify({model:publicSettings.model,hasKey:publicSettings.hasKey,configured:!!publicSettings.baseUrl}));
  const mode=process.argv.find(a=>a.startsWith('--case='))?.slice(7);
  if(!process.argv.includes('--run-live')||!['edit','extend','extend-context'].includes(mode))return;
  const dir=path.join(out,mode);
  // Never repeat a possibly charged request on a reused evidence folder.
  await fs.mkdir(dir);
  const projects=new ProjectStore(path.join(dir,'workspace'));await projects.init();
  const tasks=new TaskQueue(projects.root);await tasks.init();
  const inspect=b=>nativeImage.createFromBuffer(b).getSize();
  const service=new CloudTaskService(projects,connections,tasks,inspect,cloudRunner(projects.root));
  const project=await projects.create('真实云端验收 '+mode);
  const input=path.resolve('test-results/local-ai-fixtures/white.png');
  let sourceBytes,maskBytes,settings;
  if(mode==='edit'){
    sourceBytes=await sharp(input).resize(1024,1536).png().toBuffer();
    maskBytes=await sharp(Buffer.from('<svg width="1024" height="1536"><ellipse cx="448" cy="586" rx="145" ry="145" fill="white"/></svg>')).png().toBuffer();
    settings={operation:'cloudEdit',instruction:'Change the bridal bouquet flowers to vivid golden yellow sunflowers with dark brown centers. Keep the same delicate anime watercolor style. Preserve the hands, dress and all other content.',maskMode:'asset',maskId:'qa-mask',maskChannel:'alpha'};
  }else{
    sourceBytes=await sharp(input).extract({left:64,top:64,width:384,height:576}).resize(768,1152).png().toBuffer();
    settings={operation:'cloudExtend',width:1024,height:1536,left:128,top:128,instruction:'Continue the cropped wedding portrait seamlessly. Complete the hair, bridal veil and flowing dress beyond the existing edges, same watercolor anime illustration on clean off-white background. No extra people, no text.'};
  }
  await fs.writeFile(path.join(dir,'source.png'),sourceBytes);
  const source={id:'qa-source',name:'婚礼插画验收',...await saveImage(projects.root,sourceBytes,inspect)};
  const assets=[source];
  if(maskBytes){await fs.writeFile(path.join(dir,'mask.png'),maskBytes);assets.push({id:'qa-mask',name:'花束修改区',...await saveImage(projects.root,maskBytes,inspect)});}
  const document={...project.document,assets};
  const started=Date.now(),{id}=await service.start(project.id,document,source.id,settings);
  console.log('submitted '+mode+' '+id);
  await tasks.completions.get(id);
  const task=tasks.tasks.find(t=>t.id===id);
  const report={mode,id,model:publicSettings.model,status:task.status,message:task.message,elapsedMs:Date.now()-started,checks:[]};
  if(task.context.hasRaw){
    const raw=await service.readRaw(id);
    await fs.copyFile(path.join(projects.root,'resources',raw.asset.resource),path.join(dir,'raw.png'));
    report.returnedSize={width:raw.asset.width,height:raw.asset.height};
  }
  if(task.status==='completed'){
    const result=JSON.parse(await fs.readFile(path.join(projects.root,'results',id+'.json'),'utf8'));
    const bytes=await fs.readFile(path.join(projects.root,'resources',result.assets[0].resource));
    await fs.writeFile(path.join(dir,'result.png'),bytes);
    const src=await decode(sourceBytes),dst=await decode(bytes),mask=maskBytes?await decode(maskBytes):null;
    let protectedPixels=0,changedPixels=0;
    for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){
      const i=(y*src.width+x)*4,j=((y+(settings.top||0))*dst.width+x+(settings.left||0))*4;
      if(!mask||mask.data[i+3]===0){assert.deepEqual(dst.data.subarray(j,j+4),src.data.subarray(i,i+4));protectedPixels++;}
      else if(!dst.data.subarray(j,j+4).equals(src.data.subarray(i,i+4)))changedPixels++;
    }
    report.checks.push('protected RGBA exact','requested output size');
    assert.equal(dst.width,1024);assert.equal(dst.height,1536);
    if(mask){assert.ok(changedPixels>1000);report.checks.push('painted area changed');}
    report.protectedPixels=protectedPixels;report.changedPixels=changedPixels;
  }
  await fs.writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}).then(()=>app.quit()).catch(e=>{console.error(e.safeMessage||e.message);app.exit(1);});
