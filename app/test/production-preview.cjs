const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
delete process.env.TUGOU_DATA_DIR;
const timer=setTimeout(()=>app.exit(1),20000);
app.on('browser-window-created',(_event,window)=>window.webContents.once('did-finish-load',async()=>{
  try {
    const js=code=>window.webContents.executeJavaScript(code,true);
    const list=await js('window.tugou.list()'), records=[];
    for(const item of list)records.push(await js(`window.tugou.open(${JSON.stringify(item.id)})`));
    const parents=records.filter(r=>r.origin?.format==='canvas-studio'), canvases=records.filter(r=>r.origin?.legacyCanvasId);
    assert.equal(parents.length,2); assert.equal(canvases.length,3);
    for(const parent of parents){
      assert.equal(parent.origin.canvasStatus,'migrated');
      assert.ok(parent.document.migratedCanvases.every(link=>canvases.some(c=>c.id===link.projectId)));
      const source=JSON.parse(await fs.readFile(path.join(app.getPath('appData'),'CanvasStudio/projects',`${parent.document.id}.json`),'utf8'));
      for(const key of Object.keys(source))assert.deepEqual(parent.document[key],source[key]);
    }
    assert.equal(canvases.reduce((n,c)=>n+c.document.tugouCanvas.nodes.length,0),19);
    assert.equal(canvases.reduce((n,c)=>n+c.document.tugouCanvas.edges.length,0),16);
    assert.equal(canvases.filter(c=>c.document.assets.length===4).length,2);
    const settings=await js('window.tugou.connection()');assert.ok(settings.hasKey&&!settings.apiKey);
    await fs.writeFile(path.join(__dirname,'../test-results/production-preview.json'),JSON.stringify({projects:parents.length,canvases:canvases.length,nodes:19,edges:16,originalFieldsEqual:true,canvasAssetAccess:true,sharedEncryptedSettings:true,realProductionProfileBoot:true},null,2));
    clearTimeout(timer);await js('window.tugou.window("close")');
  }catch(error){await fs.writeFile(path.join(__dirname,'../test-results/production-preview.json'),JSON.stringify({failure:error.message},null,2));clearTimeout(timer);app.exit(1);}
}));
require('../main.cjs');
