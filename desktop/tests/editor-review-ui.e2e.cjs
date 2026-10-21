const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const base=process.env.STUDIO_TEST_URL;
if(base!=='http://127.0.0.1:3437')throw Error('Isolated QA required');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'studio-review-')));app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(r=>setTimeout(r,ms)),results=[];
const request=async(action,payload)=>{const r=await fetch(base+'/api/studio',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Request':'1'},body:JSON.stringify({action,payload})});if(!r.ok)throw Error(await r.text());return r.json()};
app.whenReady().then(async()=>{
 const common={x:0,y:0,width:256,height:256,opacity:1,rotation:0,visible:true,locked:false,flipX:false,flipY:false,blend:'source-over'};
 const project={format:'canvas-studio',version:5,id:'review-group-qa',name:'审查分组保护',width:512,height:512,background:'transparent',assets:[],modules:[],recipes:[],jobs:[],layers:[]};
 const group={...common,id:'group',name:'特效组',kind:'group',effects:[{kind:'shadow',enabled:true,color:'#000000',opacity:.5,values:{distance:20,angle:90,blur:20}}]};
 const shape={...common,id:'shape',name:'色块',kind:'shape',shape:'rect',color:'#5078a0',parentId:'group'};
 const adjustment={...common,id:'adjustment',name:'反相',kind:'adjustment',adjustment:{kind:'invert',values:{}}};
 let win;
 try{
  for(const scenario of ['group','adjustment','merge']){
   if(win)win.destroy();
   const p={...project,id:'review-'+scenario+'-qa',name:'审查保护 '+scenario,updatedAt:new Date().toISOString(),background:scenario==='merge'?'#ffffff':'transparent',layers:scenario==='group'?[group,shape]:scenario==='adjustment'?[{...group,effects:undefined},shape,{...adjustment,parentId:'group'}]:[{...shape,parentId:undefined},adjustment]};
   await request('save',p);
   win=new BrowserWindow({width:1300,height:900,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
   const run=code=>win.webContents.executeJavaScript(code,true);
   const until=async(fn)=>{for(let i=0;i<200;i++){if(await fn())return;await wait(100);}throw Error('Timeout '+scenario)};
   await win.loadURL(base+'/studio');await until(()=>run('document.body.innerText.includes('+JSON.stringify(p.name)+')&&!!document.querySelector(".editor-stage canvas")'));
   if(scenario==='merge'){
    await run(`[...document.querySelectorAll('.layer-name')].find(e=>e.textContent.trim()==='色块').click()`);await wait(150);await run(`[...document.querySelectorAll('.layer-name')].find(e=>e.textContent.trim()==='反相').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`);
    await wait(200);await run(`document.querySelector('button[title="更多图层操作"]').click()`);await wait(200);await run(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()==='合并为图片').click()`);
    await until(()=>run('document.body.innerText.includes("调整图层也影响画布底色")'));
   }else{
    await run(`[...document.querySelectorAll('.layer-name')].find(e=>e.textContent.trim()==='特效组').click()`);await wait(150);await run(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='解除分组').click()`);
    await until(()=>run('document.body.innerText.includes("请保留分组")'));
   }
   assert.deepEqual((await request('open',{id:p.id})).layers,p.layers.map(l=>JSON.parse(JSON.stringify(l))));
   results.push({scenario,protected:true,layersUnchanged:true});
  }
  fs.writeFileSync(path.resolve(__dirname,'../../docs/studio-evidence/editor-review-ui-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));app.exit(0);
 }catch(e){console.error(e);app.exit(1)}
});
