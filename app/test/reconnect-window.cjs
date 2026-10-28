const {app}=require('electron'),fs=require('node:fs');
let win;
app.on('browser-window-created',(_event,w)=>{
  if(win)return;win=w;
  w.webContents.on('console-message',d=>{if(d.level==='error')process.send?.({error:d.message});});
  w.webContents.on('render-process-gone',(_e,d)=>process.send?.({error:JSON.stringify(d)}));
  w.webContents.once('did-finish-load',()=>process.send?.({ready:true}));
});
process.on('message',async msg=>{
  try{
    if(msg.close)win.close();
    if(msg.shot){fs.writeFileSync(msg.shot,(await win.capturePage()).toPNG());process.send?.({shot:msg.shot});}
  }catch(e){process.send?.({error:e.message});}
});
require(process.env.TUGOU_TEST_APP||'../desktop-main.cjs');
