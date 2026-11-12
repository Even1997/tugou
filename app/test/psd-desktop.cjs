// Isolated profile; real UI, compositor, PSD worker and filesystem, scripted native pickers only.
const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {writePsdBuffer,readPsd}=require('ag-psd');require('../core/psd-codec.cjs');
const out=path.resolve('test-results/psd');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(fs.realpathSync(out),'desktop-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;delete process.env.TUGOU_DEV_PREVIEW;
app.setAppPath(path.resolve('.'));
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,theme:'light',autoCheck:false,notifyTasks:false}));
const image=(w,h,c)=>({width:w,height:h,data:new Uint8ClampedArray(Array.from({length:w*h},()=>c).flat())});
const fixture=path.join(profile,'分层样稿.psd');
fs.writeFileSync(fixture,writePsdBuffer({width:96,height:64,children:[{name:'红色',left:7,top:8,imageData:image(32,24,[255,0,0,255])},{name:'分组',blendMode:'normal',children:[{name:'绿色',left:24,top:19,imageData:image(30,25,[0,255,0,255])}]},{name:'隐藏蓝色',hidden:true,left:10,top:10,opacity:.5,imageData:image(20,20,[0,0,255,255])}],imageData:image(96,64,[255,255,255,255])},{noBackground:true}));
let selectedFile=fixture,savePath=path.join(profile,'导出.psd'),cancelPicker=false;
dialog.showOpenDialog=async()=>({canceled:cancelPicker,filePaths:[selectedFile]});dialog.showSaveDialog=async()=>({canceled:cancelPicker,filePath:savePath});
require('esbuild').buildSync({stdin:{contents:'import {Compositor} from "./renderer/composite.js";import {renderPsd} from "./renderer/psd-transfer.js";window.psdQA={Compositor,renderPsd};',resolveDir:path.resolve('.'),loader:'js'},bundle:true,platform:'browser',format:'iife',outfile:path.join(out,'qa.js')});
const report={profile,checks:[],errors:[]};let finished=false;
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,'desktop-report.json'),JSON.stringify(report,null,2));app.exit(code);};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
dialog.showErrorBox=(a,b)=>{report.failure=a+': '+b;finish(1);};setTimeout(()=>{report.failure='timeout';finish(1)},120000);
app.on('browser-window-created',(_,w)=>{w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.on('console-message',event=>{if(event.level==='error')report.errors.push(event.message);});
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
    const wait=async s=>{for(let i=0;i<400;i++){if(await js(s))return;await delay(30);}throw Error('Timeout '+s);};
    const click=async label=>{await js(`(()=>{const b=[...document.querySelectorAll('button,summary')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Unavailable '+${JSON.stringify(label)});b.click()})()`);await delay(100);};
    const capture=async name=>{w.showInactive();await delay(180);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
    const openImport=async()=>{await js(`[...document.querySelectorAll('details')].filter(d=>d.querySelector('summary')?.textContent==='PSD').forEach(d=>d.open=true)`);await click('导入 PSD');};
    const noDialog=()=>wait(`!document.querySelector('.ant-modal')`);
    try{
      w.setSize(1180,800);await wait(`!!document.querySelector('.workspace-rail')`);await click('新建工程');await click('图层');
      const id=await js(`(async()=>(await tugou.list())[0].id)()`);
      await openImport();await capture('import-light');cancelPicker=true;await click('选择 PSD 文件');await wait(`!document.querySelector('.ant-modal [role=status]')`);check('cancel picker leaves project unchanged',!await js(`document.querySelector('[aria-label="保存"]').disabled===false`));cancelPicker=false;
      await click('选择 PSD 文件');await wait(`document.querySelector('.ant-modal [role=status]')?.textContent.includes('分层样稿')`);
      check('import preview shows layer count and requires explicit addition',await js(`document.querySelector('.psd-result').textContent.includes('4 层')&&[...document.querySelectorAll('.ant-modal button')].some(b=>b.textContent==='添加为新画板')`)&&(await js(`tugou.open(${JSON.stringify(id)})`)).document.layers.length===0);
      await click('添加为新画板');await noDialog();await wait(`!!document.querySelector('.layer-row')`);await click('保存');
      let saved=await js(`tugou.open(${JSON.stringify(id)})`);let board=saved.document.layers.find(l=>l.name==='分层样稿');assert.ok(board);
      const A=require('../core/artboards.cjs'),local=A.extract(saved.document,board.id);check('import adds editable nested image layers',local.layers.length===4&&local.layers.filter(l=>l.kind==='image').length===3&&local.layers.find(l=>l.name==='绿色').parentId===local.layers.find(l=>l.kind==='group').id);
      const count=saved.document.layers.length;await click('撤销');check('one undo removes entire PSD import',await js(`document.querySelectorAll('.layer-row').length<${count}`));await click('重做');await click('保存');check('redo restores import', (await js(`tugou.open(${JSON.stringify(id)})`)).document.layers.length===count);
      await js(fs.readFileSync(path.join(out,'qa.js'),'utf8'));
      const pixels=doc=>js(`(async()=>{const engine=new psdQA.Compositor(),c=document.createElement('canvas');await engine.render(${JSON.stringify(doc)},c);const result=[...c.getContext('2d').getImageData(0,0,c.width,c.height).data];engine.dispose();return result})()`);
      const before=await pixels(local);check('imported positioning and z-order render correctly',before[(10*96+10)*4]===255&&before[(22*96+27)*4+1]===255&&before[3]===0);
      await js(`document.querySelector('.layer-menu>summary[aria-label="PSD"]').parentElement.open=true`);await click('导出 PSD');await capture('export-light');await click('保存 PSD');await noDialog();
      const parsed=readPsd(fs.readFileSync(savePath),{useImageData:true,skipThumbnail:true});check('PSD export keeps top-level layers and hidden state',parsed.children.length===3&&parsed.children[2].hidden&&parsed.children[1].name==='分组');
      check('PSD composite equals rendered artwork',Buffer.from(parsed.imageData.data).equals(Buffer.from(before)));
      selectedFile=savePath;await openImport();await click('选择 PSD 文件');await wait(`document.querySelector('.ant-modal [role=status]')?.textContent.includes('3 层')`);await click('添加为新画板');await noDialog();await click('保存');saved=await js(`tugou.open(${JSON.stringify(id)})`);
      const reopened=A.extract(saved.document,saved.document.layers.find(l=>l.artboard&&l.name==='导出').id),after=await pixels(reopened);check('PSD import export reimport preserves visible RGBA exactly',Buffer.from(after).equals(Buffer.from(before)));
      selectedFile=fixture;await openImport();await click('选择 PSD 文件');await wait(`document.querySelector('.ant-modal [role=status]')?.textContent.includes('4 层')`);
      await click('撤销');await click('添加为新画板');await wait(`document.querySelector('.ant-modal [role=alert]')?.textContent.includes('工程已变化')`);
      check('stale import refuses to overwrite intervening edits',true);await click('取消');await click('重做');await click('保存');
      const shape=require('../core/layers.cjs').createLayer('shape',{name:'额外形状',shape:'rect',fill:true,color:'#ffaa00',x:45,y:30,width:16,height:20,rotation:15});
      const changed={...local,layers:[...local.layers,shape]};const expected=await pixels(changed);
      savePath=path.join(profile,'edited.psd');await js(`(async()=>{const input=await psdQA.renderPsd(${JSON.stringify(changed)},false,new AbortController().signal,()=>{}),target=await tugou.chooseExport('edited','psd');await tugou.psdWrite(crypto.randomUUID(),target.token,input);})()`);
      const editedPixels=readPsd(fs.readFileSync(savePath),{useImageData:true,skipThumbnail:true}).imageData.data;
      // PSD's 8-bit composite has a white matte; compare premultiplied colors, writer truncation plus reader rounding bounds the error to 1.5 steps.
      let error=0;for(let i=0;i<expected.length;i+=4){assert.equal(editedPixels[i+3],expected[i+3]);for(let c=0;c<3;c++)error=Math.max(error,Math.abs(expected[i+c]-editedPixels[i+c])*expected[i+3]/255);}
      report.compositeMaxPremultipliedError=error;check('rotated translucent edge composite differs by at most 1.5 8-bit steps',error<=1.5);

      selectedFile=path.join(profile,'broken.psd');fs.writeFileSync(selectedFile,'broken');await openImport();await click('选择 PSD 文件');await wait(`!!document.querySelector('.ant-modal [role=alert]')`);check('bad PSD shows actionable error without changing project',await js(`document.querySelector('.ant-modal [role=alert]').textContent.includes('PSD')`));await click('取消');
      const masked=path.join(profile,'mask.psd');fs.writeFileSync(masked,writePsdBuffer({width:8,height:8,children:[{name:'蒙版',imageData:image(8,8,[0,0,0,255]),mask:{imageData:image(8,8,[0,0,0,255])}}],imageData:image(8,8,[120,10,0,255])}));selectedFile=masked;
      await openImport();await click('选择 PSD 文件');await wait(`document.querySelector('.ant-modal [role=alert]')?.textContent.includes('蒙版')`);check('unsupported layer is blocked before project mutation',true);
      await js(`document.querySelector('.ant-modal .ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
      await wait(`!!document.querySelector('[data-option-value="merged"]')`);await js(`document.querySelector('[data-option-value="merged"]').click()`);
      await click('选择 PSD 文件');await wait(`document.querySelector('.ant-modal [role=status]')?.textContent.includes('1 层')`);
      check('merged fallback shows conversion warning before commit',await js(`document.querySelector('.ant-modal [role=status]').textContent.includes('不保留图层')`));await click('取消');
      check('cross-layer adjustment blocks layered export',await js(`(async()=>{try{await psdQA.renderPsd({...${JSON.stringify(local)},layers:[{id:'adjust',kind:'adjustment',name:'调整',blend:'source-over'}]},false,new AbortController().signal,()=>{});return false}catch(e){return e.message.includes('跨图层')}})()`));
      check('merged PSD export produces one pixel layer',await js(`(async()=>{const input=await psdQA.renderPsd(${JSON.stringify(local)},true,new AbortController().signal,()=>{});return input.layers.length===1&&input.layers[0].bytes.length===input.composite.length})()`));
      w.setSize(960,720);await click('切换深色主题');await openImport();await capture('import-dark-narrow');check('PSD dialog fits dark narrow desktop',await js(`(()=>{const e=document.querySelector('.ant-modal'),r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth+1})()`));await click('取消');
      const unsafe=await js(`(async()=>{const target=await tugou.chooseExport('bad','psd');try{await tugou.writeExport(target.token,new Uint8Array(32));return false}catch{return true}finally{await tugou.cancelExport(target.token)}})()`);check('generic image writer cannot bypass PSD validation',unsafe);
      check('no renderer errors',report.errors.length===0);finish(0);
    }catch(error){report.failure=error.stack;console.error(error);try{await capture('failure')}catch{}finish(1);}
  });
});require(process.env.TUGOU_TEST_APP?path.resolve(process.env.TUGOU_TEST_APP):'../desktop-main.cjs');
