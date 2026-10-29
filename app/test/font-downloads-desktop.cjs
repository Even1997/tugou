// Runs against source or a real Windows/macOS package, with an isolated profile.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const out=path.resolve(process.env.TUGOU_FONT_QA_OUT||'test-results/font-downloads-desktop');fs.mkdirSync(out,{recursive:true});
const profile=fs.realpathSync(fs.mkdtempSync(path.join(out,'profile-'))),main=path.resolve(process.env.TUGOU_TEST_APP||'desktop-main.cjs'),source=path.dirname(main);
process.env.TUGOU_DATA_DIR=profile;if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');app.setAppPath(source);
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require(path.join(source,'core/preference-values.cjs')).defaults,autoCheck:false,notifyTasks:false}));
const {builtinFonts}=require(path.join(source,'core/builtin-fonts.cjs')),{fontFaces}=require(path.join(source,'core/font-weights.cjs'));
const faceList=builtinFonts.flatMap(fontFaces),{assetName}=require(path.join(source,'core/font-downloads.cjs')),assets=new Map(faceList.map(f=>[assetName(f),f]));
const report={platform:process.platform,arch:process.arch,main,checks:[],errors:[]};let server,offline=false,requests=0,finished=false;
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name);};
function finish(code){if(finished)return;finished=true;server?.close();server?.closeAllConnections();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));app.exit(code);}
setTimeout(()=>{report.failure='timeout';finish(1);},240000);
(async()=>{
  server=http.createServer((req,res)=>{const face=assets.get(decodeURIComponent(req.url.slice(1)));if(!face){res.writeHead(404).end();return;}const bytes=fs.readFileSync(path.resolve('assets/fonts',face.file));res.writeHead(200,{'Content-Length':bytes.length});let offset=0;const timer=setInterval(()=>{if(res.destroyed){clearInterval(timer);return;}res.write(bytes.subarray(offset,offset+262144));offset+=262144;if(offset>=bytes.length){clearInterval(timer);res.end();}},20);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const originalFetch=global.fetch;
  global.fetch=(url,options)=>{if(String(url).includes('/releases/download/font-assets-v1/')){if(offline)return Promise.reject(Error('Offline test'));requests++;url=`http://127.0.0.1:${server.address().port}/${String(url).split('/').at(-1)}`;}return originalFetch(url,options);};
  app.on('browser-window-created',(_,w)=>{
    w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error'&&!e.message.includes('Offline test'))report.errors.push(e.message);});
    w.webContents.once('did-finish-load',async()=>{
      const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms)),wait=async s=>{for(let i=0;i<300;i++){if(await js(s))return;await delay(60);}throw Error('Timeout '+s);};
      const shot=async name=>{await delay(80);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());};
      const {bridge}=require(path.join(source,'core/mcp.cjs')),call=async(method,args={})=>{const r=await bridge(path.join(profile,'mcp-session.json'),method,args);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;},state=()=>call('get_state'),run=async(command,args={})=>call('run_command',{command,args,expectedRevision:(await state()).revision});
      const object=async id=>(await call('get_object',{kind:'layer',id})).object;
      try{
        await wait(`!!document.querySelector('.workspace-rail')`);const library=await run('font.library');
        check('complete catalog retains 55 families and 141 faces',library.builtin.length===55&&library.builtin.flatMap(f=>f.faces).length===141);
        check('fresh profile starts entirely in cloud state',library.builtin.every(f=>f.faces.every(face=>face.status==='cloud')));
        await run('project.create',{name:'按需字体离线验收'});const board=(await run('artboard.create',{name:'字体',width:900,height:300})).id;
        const id=(await run('layer.create',{artboardId:board,kind:'text',properties:{text:'春日来信 ABC abc',fontFamily:process.platform==='darwin'?'Helvetica':'Arial',fontSize:52,width:850,height:200,x:20,y:30,fontWeight:400}})).id;
        await run('workspace.show',{workspace:'layers',layerIds:[id]});await wait(`!!document.querySelector('.font-picker')`);
        await js(`document.querySelector('.font-picker [aria-label="字体"]').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
        await wait(`!!document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [data-font-id="lxgw-wenkai-regular"]')`);await shot('cloud');
        await js(`document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [data-font-id="lxgw-wenkai-regular"]').click()`);
        await wait(`Number(document.querySelector('.font-picker [role="progressbar"]')?.getAttribute('aria-valuenow'))>10`);check('cloud click displays circular download progress',true);await shot('progress');
        await wait(`!document.querySelector('.font-picker [role="progressbar"]')&&document.querySelector('.font-picker')?.textContent.includes('霞鹜文楷')`);
        for(let i=0;i<60&&(await object(id)).fontFamily!=='LXGW WenKai';i++)await delay(50);
        check('download finishes before applying the selected font',(await object(id)).fontFamily==='LXGW WenKai');
        check('downloaded face loses its cloud icon',await js(`!document.querySelector('.font-picker [data-font-id="lxgw-wenkai-regular"]')`));
        const preview=async()=>Buffer.from((await call('preview',{artboardId:board,maxSize:900})).data,'base64'),normal=await preview();
        await js(`document.body.click();document.querySelector('[aria-label="字体粗细"]').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
        await wait(`!!document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [data-font-id="lxgw-wenkai-500"]')`);
        check('uncached weights keep their own cloud indicators',true);
        await js(`document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [data-font-id="lxgw-wenkai-500"]').click()`);
        await wait(`!!document.querySelector('.font-picker [role="progressbar"]')`);await wait(`!document.querySelector('.font-picker [role="progressbar"]')`);
        for(let i=0;i<100&&(await object(id)).fontWeight!==500;i++)await delay(50);report.downloadRequests=requests;
        check('second weight is a separate verified download',(await object(id)).fontWeight===500&&requests===2);const medium=await preview();check('genuine weight changes rendered glyph pixels',!normal.equals(medium));
        await run('history.undo');check('font change remains undoable',(await object(id)).fontWeight===400);await run('history.redo');await run('project.save');
        offline=true;w.webContents.session.enableNetworkEmulation({offline:true});await js('location.reload()');await wait(`!!document.querySelector('.workspace-rail')`);
        check('saved project renders the same font after offline reload',(await preview()).equals(medium));check('offline reload makes no download request',requests===2);
        await run('artboard.export',{artboardId:board,path:'offline-font.png'});check('offline PNG export retains rendered glyphs',fs.readFileSync(path.join((await state()).filesRoot,'offline-font.png')).equals(medium));
        const response=await js(`window.tugou.fontCommand('font.download',{id:'mplus-1mn-regular'}).then(()=>null,e=>e.message)`);check('uncached font reports an offline error without modifying text',response?.includes('Offline')&&(await object(id)).fontWeight===500);
        offline=false;w.webContents.session.enableNetworkEmulation({offline:false});await run('font.download',{id:'mplus-1mn-regular'});check('MCP can retry the missing font',(await run('font.library')).builtin.find(f=>f.id==='mplus-1mn-regular').faces.find(f=>f.weight===400).status==='ready');
        for(const theme of ['dark','light']){await js(`document.querySelector('.rail-bottom button[aria-label="切换${theme==='light'?'浅':'深'}色主题"]')?.click()`);await wait(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`);await run('workspace.show',{workspace:'layers',layerIds:[id]});await wait(`!!document.querySelector('.font-picker')`);w.setSize(940,760);await js(`document.querySelector('.font-picker').scrollIntoView({block:'center'})`);await shot(theme);check(theme+' narrow font controls stay within panel',await js(`Array.from(document.querySelectorAll('.font-picker .ant-select')).every(e=>e.getBoundingClientRect().right<=innerWidth)`));}
        check('no unexpected renderer errors',report.errors.length===0);finish(0);
      }catch(e){report.failure=e.stack;console.error(e);await shot('failure').catch(()=>{});finish(1);}
    });
  });require(main);
})().catch(e=>{report.failure=e.stack;console.error(e);finish(1);});
