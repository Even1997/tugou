const { app, BrowserWindow, ipcMain, dialog, safeStorage, protocol, nativeImage, clipboard, Menu, autoUpdater } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { ProjectStore, safePath, resourcePattern, atomicWrite, hash } = require('./core/storage.cjs');
const { AnalysisService } = require('./core/analysis.cjs');
const { ConnectionStore } = require('./core/connection.cjs');
const { TaskQueue } = require('./core/tasks.cjs');
const { GenerationService, saveImage } = require('./core/generation.cjs');
const { importImages } = require('./core/import-images.cjs');
const { LocalAIService } = require('./core/local-ai.cjs');
const { RuntimeInstaller } = require('./core/runtime-install.cjs');
const { ImageTaskService } = require('./core/image-tasks.cjs');
const { createRasterRunner } = require('./core/raster-runner.cjs');
const { CloudTaskService } = require('./core/cloud-tasks.cjs');
const { SemanticService } = require('./core/semantic.cjs');
const { cloudRunner } = require('./core/cloud-runner.cjs');
const { readLegacyCanvas } = require('./core/legacy-canvas-source.cjs');
const { migrateCanvases } = require('./core/legacy-canvas.cjs');
const {WorkflowService}=require('./core/workflow-service.cjs');
const {saveMedia,importMedia,mediaResponse}=require('./core/media.cjs');

app.setName('TugouIndependent');
if(process.platform==='win32')app.setAppUserModelId('app.tugou.studio');
app.setPath('userData', path.resolve(process.env.TUGOU_DATA_DIR || path.join(app.getPath('appData'), 'TugouIndependent')));
protocol.registerSchemesAsPrivileged([{ scheme: 'tugou-media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const acquired = app.requestSingleInstanceLock();
let window, dirty = false, closing = false, confirmingClose = false, tasks, quitting = false;
let mcpRequested=process.argv.includes('--mcp-enable'),enableAutomation;
if (!acquired) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    if(argv.includes('--mcp-enable')){mcpRequested=true;enableAutomation?.().catch(error=>dialog.showErrorBox('MCP 启用失败',error.message));}
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); if(argv.includes('--reload')) window.webContents.send('tugou:reload-request'); }
  });
  app.on('before-quit',()=>{quitting=true;});
  // Squirrel closes Mac windows before app.before-quit during an update.
  autoUpdater.on('before-quit-for-update',()=>{quitting=true;});
  app.on('activate',()=>{if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus();}});
  app.whenReady().then(boot).catch((error) => { dialog.showErrorBox('土狗启动失败', error.message); app.quit(); });
}

async function boot() {
  const preferences=new (require('./core/preferences.cjs').Preferences)(app.getPath('userData'));await preferences.init();
  app.setAboutPanelOptions({applicationName:'土狗',iconPath:path.join(__dirname,'assets/brand/icon.png')});
  const root = path.join(app.getPath('userData'), 'workspace');
  const projects = new ProjectStore(root);
  const connections = new ConnectionStore(root, safeStorage);
  tasks = new TaskQueue(root);
  await projects.init();
  await tasks.init();
  const inspectImage = (bytes) => nativeImage.createFromBuffer(bytes).getSize();
  const generation = new GenerationService(projects, connections, tasks, inspectImage);
  const workflow=new WorkflowService(projects,connections,tasks,inspectImage);
  const localAI = new LocalAIService(projects);
  const installer = new RuntimeInstaller(localAI,tasks);
  const exports = new Map();
  await generation.recover();
  const cloud = new CloudTaskService(projects, connections, tasks, inspectImage, cloudRunner(root));
  await cloud.recover();
  const semantic = new SemanticService(projects,connections,tasks,cloud);
  await semantic.recover();
  const analysis = new AnalysisService(projects, connections, tasks);
  await analysis.recover();
  const entry = path.join(process.env.TUGOU_DATA_DIR && process.env.TUGOU_BUILD_DIR ? path.resolve(process.env.TUGOU_BUILD_DIR) : path.join(__dirname, 'dist'), 'index.html');
  const entryUrl = pathToFileURL(entry).href;
  const imageTools = new ImageTaskService(projects, tasks, inspectImage, createRasterRunner(path.dirname(entry)), localAI);
  protocol.handle('tugou-media', async (request) => {
    try {
      const url = new URL(request.url);
      const name = url.pathname.slice(1);
      if(url.hostname==='builtin-font'){
        const font=require('./core/builtin-fonts.cjs').builtinFonts.flatMap(require('./core/font-weights.cjs').fontFaces).find(f=>f.id===name);
        if(!font)return new Response(null,{status:404});
        const file=await require('./core/font-downloads.cjs').fontDownloads(root).file(font.id);
        if(!file)return new Response(null,{status:404});
        const bytes=await fs.readFile(file);
        if(bytes.length!==font.bytes||hash(bytes)!==font.sha256)throw Error('内置字体校验失败');
        return new Response(bytes,{headers:{'Access-Control-Allow-Origin':'*','Content-Type':font.file.endsWith('.otf')?'font/otf':font.file.endsWith('.ttc')?'font/collection':'font/ttf','Cache-Control':'private, max-age=31536000'}});
      }
      if (!['resource', 'original'].includes(url.hostname) || !resourcePattern.test(name)) return new Response(null, { status: 404 });
      const file = await safePath(root, 'resources', name);
      if(name.endsWith('.ttf')){
        if((await fs.stat(file)).size>32*1024*1024)return new Response(null,{status:413});
        const bytes=await fs.readFile(file);if(hash(bytes)!==name.split('.')[0])throw Error('字体校验失败');
        return new Response(bytes,{headers:{'Access-Control-Allow-Origin':'*','Content-Type':'font/ttf','Cache-Control':'private, max-age=31536000'}});
      }
      if(!/\.(png|jpe?g|webp)$/.test(name))return mediaResponse(file,request.headers.get('range'));
      if (url.hostname === 'original') {
        const bytes = await fs.readFile(file);
        if (hash(bytes) !== name.split('.')[0]) throw new Error('素材校验失败');
        return new Response(bytes, { headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': `image/${name.endsWith('.png') ? 'png' : name.endsWith('.webp') ? 'webp' : 'jpeg'}`, 'Cache-Control': 'private, max-age=31536000' } });
      }
      const thumbnail = await nativeImage.createThumbnailFromPath(file, { width: 384, height: 384 });
      return new Response(thumbnail.toPNG(), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=31536000' } });
    } catch { return new Response(null, { status: 404 }); }
  });
  window = new BrowserWindow({
    title: '土狗', width: 1380, height: 900, minWidth: 940, minHeight: 640, ...require('./core/desktop-platform.cjs').windowChrome(process.platform),
    backgroundColor: '#15171c', show: false, icon: path.join(__dirname, 'assets/brand/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  let activeOperations=0,settings;
  const handle = (name, action) => ipcMain.handle(`tugou:${name}`, async (event, ...args) => {
    if (window.isDestroyed() || event.sender.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== entryUrl) {
      return { ok: false, error: '请求来源无效' };
    }
    if(settings?.updates.state.status==='installing')return {ok:false,error:'UPDATE_INSTALLING'};
    activeOperations++;
    try { return { ok: true, value: await action(...args) }; }
    catch (error) { return { ok: false, error: error.message }; }
    finally { activeOperations--; }
  });
  let development;
  if(!app.isPackaged&&process.env.TUGOU_DEV_PREVIEW==='1'&&process.env.TUGOU_BUILD_DIR){
    const {DevPreview,buildPreview}=require('./core/dev-preview.cjs');
    development=new DevPreview({root:__dirname,output:path.dirname(entry),build:output=>buildPreview(__dirname,output),emit:state=>{
      if(!window.isDestroyed())window.webContents.send('tugou:dev-update',state);
      // A failed replacement cannot acknowledge restoration. Keep its checkpoint and
      // retry from it when a corrected build arrives, without reading from disk.
      if(development?.restoring&&state.status==='pending'){
        development.pending.css=false;
        setImmediate(()=>development.apply(state.version,development.snapshot).then(result=>{if(result.applied&&!window.isDestroyed())window.webContents.reload();}).catch(()=>{}));
      }
    }});
    development.start();window.once('closed',()=>development.close());
    const marker=path.join(app.getPath('userData'),'dev-preview-running.json');
    await fs.writeFile(marker,JSON.stringify({pid:process.pid,mode:'development'}));
    window.once('closed',()=>fs.unlink(marker).catch(()=>{}));
  }
  handle('devPreview',async(action,payload)=>{
    if(action==='restore')return {enabled:!!development,snapshot:development?.snapshot||null};
    if(action==='status')return development?.status()||{enabled:false};
    if(!development)throw Error('仅开发预览可用');
    if(action==='ready'){development.restoring=false;return true;}
    if(action==='apply'){
      if(activeOperations>1||tasks.list().some(t=>['running','queued'].includes(t.status))||!!subjectController||!!(automation&&(await automation).isBusy()))return {applied:false};
      const result=await development.apply(payload.version,payload.snapshot);
      if(result.applied&&!result.css){development.restoring=true;dirty=!!payload.snapshot.dirty;setImmediate(()=>window.webContents.reload());}
      return result;
    }
    throw Error('未知开发预览操作');
  });
  handle('list', () => projects.list());
  handle('deleteProject', (id, revision) => projects.remove(id, revision, tasks));
  const fonts=await require('./core/font-desktop.cjs').registerFonts({root,tasks,handle,dialog,window});
  handle('create', (name) => projects.create(name));
  handle('open', async(id) => {const record=await projects.read(id);await settings?.remember(record);return record;});
  handle('save', async(id, document, revision) => {const record=await projects.save(id, document, revision);await settings?.remember(record);return record;});
  handle('import', async () => {
    const choice = await dialog.showOpenDialog(window, { title: '只读导入旧版工程', properties: ['openFile'], filters: [{ name: '土狗工程', extensions: ['json'] }] });
    return choice.canceled ? null : projects.importLegacy(choice.filePaths[0]);
  });
  handle('connection', () => connections.publicSettings());
  handle('listConnections', () => connections.list());
  handle('listSuppliers', () => connections.listSuppliers());
  handle('saveConnections', settings => connections.saveManager(settings));
  handle('saveConnection', (settings) => connections.save(settings));
  handle('testConnection', settings => connections.probe(settings));
  handle('fetchModels', settings => connections.probe(settings, true));
  handle('tasks', () => tasks.list());
  handle('generateWorkflow',(id,document,nodeId)=>workflow.start(id,document,nodeId));
  handle('retryWorkflow',id=>workflow.retry(id));
  handle('importMedia',async()=>{const choice=await dialog.showOpenDialog(window,{title:'导入视频或音频',properties:['openFile','multiSelections'],filters:[{name:'视频和音频',extensions:['mp4','webm','weba','mp3','wav','ogg','m4a','flac']}]});return choice.canceled?[]:importMedia(root,choice.filePaths);});
  handle('importMediaPaths',async files=>{if(!Array.isArray(files)||files.length>32)throw Error('一次最多导入 32 个文件');const assets=[];for(const file of [...new Set(files)])assets.push(...await (/\.(png|jpe?g|webp)$/i.test(file)?importImages(root,[file],inspectImage):importMedia(root,[file])));return assets;});
  handle('storeMedia',async(bytes,name)=>saveMedia(root,Buffer.from(bytes),name));
  handle('importModel',async()=>{
    const choice=await dialog.showOpenDialog(window,{title:'导入本地模型',properties:['openFile'],filters:[{name:'3D 模型',extensions:['obj','fbx']}]});if(choice.canceled)return null;
    return require('./core/import-model.cjs').importModel(root,choice.filePaths[0]);
  });
  handle('exportAsset',async(projectId,document,assetId)=>{
    await projects.read(projectId);require('./core/storage.cjs').validateDocument(document);
    const asset=document.assets.find(a=>a.id===assetId);if(!asset)throw Error('素材不存在');
    const extension=asset.kind==='text'?'txt':asset.resource?.split('.').at(-1);
    const choice=await dialog.showSaveDialog(window,{title:'导出素材',defaultPath:String(asset.name||'素材').replace(/[<>:"/\\|?*]/g,'_')+'.'+extension,filters:[{name:'素材',extensions:[extension]}]});
    if(choice.canceled)return false;
    const bytes=asset.kind==='text'?Buffer.from(asset.text||''):await require('./core/generation.cjs').referenceBytes(root,asset);
    await atomicWrite(await safePath(path.dirname(choice.filePath),path.basename(choice.filePath)),bytes);return true;
  });
  handle('localToolsStatus', () => localAI.status());
  handle('subjectStatus',async size=>require('./core/subject-readiness.cjs').subjectReadiness(await localAI.status(),size,require('node:os').freemem()));
  let subjectController;
  handle('selectSubject', async reference => {
    if(subjectController)throw Error('主体识别正在进行');
    const controller=new AbortController();subjectController=controller;
    try {return await require('./core/subject-selection.cjs').selectSubject(localAI,reference,inspectImage,AbortSignal.any([controller.signal,AbortSignal.timeout(600000)]),stage=>{if(!controller.signal.aborted&&!window.isDestroyed())window.webContents.send('tugou:subject-progress',stage)});}
    finally {subjectController=null;}
  });
  handle('cancelSubject',()=>subjectController?.abort());
  app.on('before-quit',()=>subjectController?.abort());
  handle('installLocalTools', async options => {
    const choice = await dialog.showOpenDialog(window, { title: '选择组件安装位置', properties: ['openDirectory','createDirectory'] });
    return choice.canceled ? null : installer.start(choice.filePaths[0],options);
  });
  handle('retryRuntimeInstall', id => installer.retry(id));
  handle('configureLocalTools', async (provider) => {
    const choice = await dialog.showOpenDialog(window, { title: '选择本地 AI 组件目录', properties: ['openDirectory'] });
    return choice.canceled ? null : localAI.configure(choice.filePaths[0], provider);
  });
  handle('startLocalTool', (id, document, sourceIds, settings) => imageTools.start(id, document, Array.isArray(sourceIds) ? sourceIds : [sourceIds], settings));
  handle('startRasterTool', (id, document, sourceIds, settings) => imageTools.start(id, document, sourceIds, settings));
  handle('retryImageTool', id => imageTools.retry(id));
  handle('startCloudTool', (id, document, sourceId, settings) => cloud.start(id, document, sourceId, settings));
  handle('startCloudBatch', (id, document, sourceIds, settings) => cloud.startBatch(id, document, sourceIds, settings));
  handle('cancelCloudBatch', (id) => cloud.cancelBatch(id));
  handle('cloudReview', id => cloud.review(id));
  handle('resumeCloudTool', (id, fit) => cloud.resume(id, fit));
  handle('keepCloudRaw', id => cloud.keepRaw(id));
  handle('retryCloudTool', id => cloud.retry(id));
  handle('analyzeCategories', (id,document,sourceId)=>semantic.analyze(id,document,sourceId));
  handle('readCategories', (id,taskId)=>semantic.read(id,taskId));
  handle('splitCategories', (id,document,sourceId,plan)=>semantic.generate(id,document,sourceId,plan));
  handle('analyze', (id, document, assetId, instruction) => analysis.start(id, document, assetId, instruction));
  handle('analyses', id => analysis.results(id));
  handle('saveAnalysisReview', (id, taskId, review) => analysis.saveReview(id, taskId, review));
  handle('importImage', async (single=false) => {
    const choice = await dialog.showOpenDialog(window, { title: '导入素材', properties: single===true ? ['openFile'] : ['openFile', 'multiSelections'], filters: [{ name: '图片', extensions: ['png','jpg','jpeg','webp'] }] });
    if (choice.canceled) return [];
    return importImages(root,single===true ? choice.filePaths.slice(0,1) : choice.filePaths,inspectImage);
  });
  handle('importImagePaths', filenames => importImages(root,filenames,inspectImage));
  handle('storeRaster', async (bytes, name) => ({ id:randomUUID(),name:String(name||'合并图层'),...await saveImage(root,Buffer.from(bytes),inspectImage) }));
  handle('chooseExport', async (name) => {
    const choice=await dialog.showSaveDialog(window,{title:'导出原尺寸 PNG',defaultPath:`${String(name||'土狗').replace(/[<>:"/\\|?*]/g,'_')}.png`,filters:[{name:'PNG 图片',extensions:['png']}]});
    if(choice.canceled)return null;
    const target=await safePath(path.dirname(choice.filePath),path.basename(choice.filePath));
    const token=randomUUID();exports.set(token,target);return {token};
  });
  handle('cancelExport', token => exports.delete(token));
  handle('writeExport', async (token, bytes) => {
    const target=exports.get(token);if(!target)throw new Error('导出目标已失效，请重新选择');
    const buffer=Buffer.from(bytes);
    if(buffer.length<24||buffer.length>512*1024*1024||!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||buffer.readUInt32BE(16)*buffer.readUInt32BE(20)>100000000)throw new Error('导出内容不是有效尺寸的 PNG');
    await safePath(path.dirname(target),path.basename(target));await atomicWrite(target,buffer);exports.delete(token);return {name:path.basename(target),bytes:buffer.length};
  });
  handle('generate', (id, document, nodeId) => generation.start(id, document, nodeId));
  handle('generateAngle', (id, document, nodeId, assetId, params) => generation.angle(id, document, nodeId, assetId, params));
  handle('results', (id) => generation.results(id));
  handle('assetDetails', (id, document, assetId, nodeId) => generation.assetDetails(id,document,assetId,nodeId));
  handle('migrateCanvases', async () => {
    if (dirty) throw new Error('请先保存当前工程，再迁移旧画布');
    return migrateCanvases(projects, await readLegacyCanvas(path.join(app.getPath('appData'), 'CanvasStudio')), inspectImage);
  });
  handle('editCommand',action=>{if(['undo','redo','cut','copy','paste','selectAll'].includes(action))window.webContents[action]();});
  handle('copyText', (text) => { if (typeof text !== 'string') throw new Error('复制内容无效'); clipboard.writeText(text); });
  handle('cancelTask', (id) => tasks.cancel(id));
  handle('dirty', (value) => { dirty = value === true; });
  handle('window', (action) => {
    if (action === 'reload') { if(dirty) throw new Error('请先保存工程再刷新'); setImmediate(()=>window.webContents.reload()); }
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    else if (action === 'close') window.close();
    return { maximized: window.isMaximized() };
  });
  window.on('close', async (event) => {
    if (closing) return;
    event.preventDefault();
    if (process.platform === 'darwin' && !quitting) { window.hide(); return; }
    if (confirmingClose) return;
    confirmingClose = true;
    if (dirty && preferences.value.confirmClose) {
      const choice = await dialog.showMessageBox(window, { type: 'question', message: '工程有未保存的修改', detail: '返回后可使用顶部保存按钮。', buttons: ['返回保存', '放弃修改并关闭'], defaultId: 0, cancelId: 0 });
      if (choice.response !== 1) { confirmingClose = false; quitting=false; return; }
    }
    try { await tasks.shutdown(); }
    catch (error) { confirmingClose = false; quitting=false; dialog.showErrorBox('任务记录保存失败', error.message); return; }
    closing = true;
    window.close();
  });
  const refreshShortcuts=()=>{if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'土狗',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
    {label:'编辑',submenu:require('./core/mac-menu.cjs').editMenu(preferences.value.shortcuts,command=>window.webContents.send('tugou:command',command))},
    {label:'窗口',submenu:[{label:'关闭窗口',accelerator:'Cmd+W',click:()=>window.close()},{role:'minimize'},{role:'zoom'},{role:'front'}]}
  ]));};
  refreshShortcuts();
  window.once('ready-to-show', () => window.show());
  let automation;
  enableAutomation=()=>automation||=(async()=>{
    await require('./core/automation-startup.cjs').automationEnabled(app.getPath('userData'),true);
    return require('./core/automation-host.cjs').startAutomationHost({window,ipcMain,app,entryUrl,projects,connections,tasks,workflow,generation,analysis,localAI,imageTools,cloud,semantic,root,fonts});
  })().catch(error=>{automation=null;throw error;});
  try{if(await require('./core/automation-startup.cjs').automationEnabled(app.getPath('userData'),mcpRequested))await enableAutomation();}
  catch(error){dialog.showErrorBox('MCP 启用失败',error.message);}
  settings=await require('./core/settings-desktop.cjs').registerSettings({app,window,handle,preferences,projects,fonts,tasks,refreshShortcuts,
    isDirty:()=>dirty,isBusy:async()=>activeOperations>1||!!subjectController||!!(automation&&(await automation).isBusy()),
    enableMcp:enableAutomation,
    prepareMcpUpdate:async()=>{if(automation){await (await automation).prepareUpdate();automation=null;await require('node:timers/promises').setTimeout(1500);}},
    disableMcp:async()=>{if(automation){(await automation).close();automation=null;}await atomicWrite(path.join(app.getPath('userData'),'mcp-enabled.json'),JSON.stringify({enabled:false}));},
    mcpStatus:()=>({enabled:!!automation}),updater:require('electron-updater').autoUpdater});
  await window.loadFile(entry);
}
app.on('window-all-closed', () => app.quit());
