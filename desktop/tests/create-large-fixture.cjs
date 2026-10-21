// Create a real file in a separate Chromium process; release its full canvas before import tests.
const {app,BrowserWindow}=require('electron');
const path=require('node:path'),os=require('node:os'),fs=require('node:fs');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'studio-fixture-')));app.disableHardwareAcceleration();
const output=path.resolve(__dirname,'../../.tools/large-image-fixture.png');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,backgroundThrottling:false}});
 try{
  await win.loadURL('data:text/html,<html></html>');
  const bytes=await win.webContents.executeJavaScript(`(()=>{
   const source=document.createElement('canvas');source.width=source.height=10000;
   const ctx=source.getContext('2d'),g=ctx.createLinearGradient(0,0,10000,10000);
   g.addColorStop(0,'#afc4dc');g.addColorStop(.5,'#f3e0bc');g.addColorStop(1,'#637b67');ctx.fillStyle=g;ctx.fillRect(0,0,10000,10000);
   for(let i=0;i<1000;i++){ctx.fillStyle='rgba('+(i*37%256)+','+(i*71%256)+','+(i*13%256)+',.18)';ctx.fillRect(i*997%10000,i*613%10000,41+i%83,35+i%61);}
   ctx.clearRect(2900,2900,200,200);ctx.clearRect(4800,4800,500,500);ctx.clearRect(4498,4498,8,8);
   ctx.fillStyle='#123456';ctx.fillRect(0,0,200,200);ctx.fillStyle='#fedcba';ctx.fillRect(9800,9800,200,200);ctx.fillStyle='#00ff00';ctx.fillRect(4500,4500,1,1);
   const bytes=Buffer.from(source.toDataURL().split(',')[1],'base64');require('node:fs').writeFileSync(${JSON.stringify(output)},bytes);source.width=source.height=0;return bytes.length;
  })()`);console.log(JSON.stringify({file:output,bytes}));app.exit(0);
 }catch(e){console.error(e);app.exit(1)}
});
