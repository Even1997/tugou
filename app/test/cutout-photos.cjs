const {app,nativeImage,BrowserWindow}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ProjectStore,hash}=require('../core/storage.cjs'),{TaskQueue}=require('../core/tasks.cjs'),{LocalAIService}=require('../core/local-ai.cjs'),{ImageTaskService}=require('../core/image-tasks.cjs'),{saveImage}=require('../core/generation.cjs'),{decode}=require('../core/cloud-pixels.cjs');
const {pathToFileURL}=require('node:url');
const base=require('./qa-paths.cjs').path("local-final"),report={checks:[],outputs:[]};let tasks;
app.setPath('userData',path.join(base,'photos-shell'));
app.on('window-all-closed',()=>{});
async function main(){
  const profile=await fs.mkdtemp(path.join(base,'cutout-photos-'));report.profile=profile;
  const store=new ProjectStore(path.join(profile,'workspace'));await store.init();tasks=new TaskQueue(store.root);await tasks.init();
  const local=new LocalAIService(store),native=JSON.parse(await fs.readFile(path.join(base,'cutout-native.json'))),runtime=await local.configure(native.runtime.folder);
  const inspect=b=>nativeImage.createFromBuffer(b).getSize(),service=new ImageTaskService(store,tasks,inspect,null,local),r=await store.create('照片参考抠图验收'),assets=[];
  const folder=path.resolve(__dirname,'../../../风格试验/C组-照片人物测试01/人物参考');
  for(const name of ['01-person','02-person'])assets.push({id:name,name,...await saveImage(store.root,await fs.readFile(path.join(folder,name+'.png')),inspect)});
  const document={...r.document,assets};await store.save(r.id,document,r.revision);
  const start=Date.now(),task=await service.start(r.id,document,assets.map(a=>a.id),{operation:'cutout'});await tasks.execution;report.batchMs=Date.now()-start;
  const finished=tasks.tasks.find(t=>t.id===task.id);assert.equal(finished.status,'completed',finished.message);
  const outputs=JSON.parse(await fs.readFile(path.join(store.root,'results',task.id+'.json'))).assets;report.checks.push('two original portrait references complete as a native batch');
  const html=[];
  for(let index=0;index<2;index++){
    const source=assets[index],output=outputs[index],inputBytes=await fs.readFile(path.join(store.root,'resources',source.resource)),bytes=await fs.readFile(path.join(store.root,'resources',output.resource)),a=await decode(inputBytes),b=await decode(bytes);
    assert.equal(a.width,b.width);assert.equal(a.height,b.height);
    let soft=0;for(let i=0;i<a.data.length;i+=4){for(let c=0;c<3;c++)assert.equal(a.data[i+c],b.data[i+c]);assert.ok(b.data[i+3]<=a.data[i+3]);if(b.data[i+3]>0&&b.data[i+3]<255)soft++}
    const subject=index===0?[[300,250],[250,500],[330,700]]:[[165,145],[165,300],[150,450]],background=index===0?[[20,20],[630,20],[630,450]]:[[10,10],[300,10],[300,400]];
    const alpha=([x,y])=>b.data[(y*b.width+x)*4+3];assert.ok(subject.every(p=>alpha(p)>=240)&&background.every(p=>alpha(p)<=5));assert.ok(soft>100);
    const filename=path.join(base,source.id+'-cutout.png');await fs.writeFile(filename,bytes);report.outputs.push({path:filename,width:b.width,height:b.height,softPixels:soft,subjectAlpha:subject.map(alpha),backgroundAlpha:background.map(alpha)});
    assert.equal(hash(inputBytes),source.resource.split('.')[0]);report.checks.push(source.id+': source bytes/RGB/dimensions retained, face/body opaque, sampled background removed, soft edges retained');
    html.push(`<section><h3>${source.name}</h3><div><figure><figcaption>原图</figcaption><img src="${pathToFileURL(path.join(folder,source.name+'.png')).href}"></figure><figure class="dark"><figcaption>深底边缘检查</figcaption><img src="${pathToFileURL(filename).href}"></figure><figure class="light"><figcaption>浅底边缘检查</figcaption><img src="${pathToFileURL(filename).href}"></figure></div></section>`);
  }
  const w=new BrowserWindow({show:false,width:1400,height:1150,webPreferences:{backgroundThrottling:false}});
  const review=path.join(base,'cutout-portrait-review.html');
  await fs.writeFile(review,`<meta charset="utf-8"><style>body{margin:20px;background:#252832;color:#fff;font:15px sans-serif}section>div{display:flex;gap:12px}figure{margin:0;padding:12px;width:30%;text-align:center}img{max-width:100%;height:340px;object-fit:contain}.dark{background:#111}.light{background:#ddd;color:#111}</style>${html.join('')}`);
  await w.loadFile(review);
  await w.webContents.executeJavaScript('Promise.all([...document.images].map(i=>i.decode()))');await w.capturePage();await new Promise(r=>setTimeout(r,80));await fs.writeFile(path.join(base,'cutout-portrait-review.png'),(await w.capturePage()).toPNG());assert.ok(!w.isVisible());w.destroy();
  assert.equal((await fs.readdir(path.join(store.root,'local-jobs'))).length,0);report.checks.push('temporary files cleaned; review window stayed hidden');
}
app.whenReady().then(main).catch(e=>{report.failure=e.stack}).finally(async()=>{if(tasks){await tasks.shutdown();report.tasks=tasks.list()}await fs.writeFile(path.join(base,'cutout-photos.json'),JSON.stringify(report,null,2));app.exit(report.failure?1:0)});
