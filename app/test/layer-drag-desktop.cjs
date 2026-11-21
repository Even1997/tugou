const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const out=path.resolve('test-results/layer-drag');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'tugou-drag-'));
app.setPath('userData',profile);process.env.ESBUILD_WORKER_THREADS='0';
const report={checks:[],errors:[]},delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};

app.whenReady().then(async()=>{
  const w=new BrowserWindow({width:1440,height:900,show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,backgroundThrottling:false}});
  w.webContents.on('console-message',event=>{if(event.level==='error')report.errors.push(event.message);});
  const js=code=>w.webContents.executeJavaScript(code,true);
  const wait=async code=>{for(let i=0;i<240;i++){if(await js(code))return;await delay(25);}throw Error('Timeout '+code);};
  const idle=()=>wait(`document.querySelector('canvas[aria-label="图层画布"]')?.dataset.rendering==='false'`);
  const placeView=async()=>{
    const started=await js('probe.started');
    await js('place();void 0');
    await wait(`probe.started>${started}&&probe.last.options.scale===.5*Math.min(devicePixelRatio,2)&&probe.last.options.x===-80&&probe.last.options.y===-150`);
    await idle();
  };
  const pointer=(type,x,y)=>w.webContents.sendInputEvent({type,x,y,...(type==='mouseMove'?{modifiers:['leftButtonDown']}:{button:'left',clickCount:1})});
  const key=keyCode=>{for(const type of ['keyDown','keyUp'])w.webContents.sendInputEvent({type,keyCode});};
  try{
    await w.loadFile(path.resolve('renderer/index.html'));
    await js(`require(${JSON.stringify(path.resolve('test/line-tools-renderer.cjs'))});void 0`);
    w.showInactive();w.webContents.debugger.attach('1.3');await w.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
    await wait('!!qa.mode');
    report.devicePixelRatio=await js('devicePixelRatio');
    const setup=root=>{
      const {createLayer:L}=require(root+'/core/layers.cjs'),{defaults}=require(root+'/core/effects.cjs');
      const {createAutosave}=require(root+'/core/autosave.cjs'),{Compositor}=require(root+'/renderer/composite.js'),{views}=require(root+'/renderer/ui-view.js');
      const render=Compositor.prototype.render,draw=CanvasRenderingContext2D.prototype.drawImage;
      const probe=window.probe={hold:false,active:0,maxActive:0,started:0,draws:0,aborts:0,writes:0};
      CanvasRenderingContext2D.prototype.drawImage=function(...args){
        const result=draw.apply(this,args);
        if(this.canvas.getAttribute('aria-label')==='图层画布')probe.draws++;
        return result;
      };
      Compositor.prototype.render=async function(document,canvas,options){
        probe.last={document,options};probe.started++;probe.maxActive=Math.max(probe.maxActive,++probe.active);
        if(probe.hold){probe.hold=false;await new Promise(resolve=>{probe.release=resolve;});delete probe.release;}
        try{return await render.call(this,document,canvas,options);}
        finally{probe.active--;if(options.signal?.aborted)probe.aborts++;}
      };
      const layers=[
        L('group',{id:'board0',name:'画板一',artboard:true,clipContent:true,x:0,y:0,width:540,height:400,background:'#ffffff'}),
        L('shape',{id:'target',parentId:'board0',x:50,y:52,width:70,height:66,color:'#bc3153',rotation:13,mask:{x:0,y:0,width:.72,height:1},effects:[defaults('shadow')]}),
        L('shape',{id:'above',parentId:'board0',x:130,y:50,width:135,height:90,opacity:.6,color:'#245490'}),
        L('group',{id:'board1',name:'画板二',artboard:true,clipContent:true,x:600,y:0,width:450,height:340,background:'#e4effa'}),
        L('shape',{id:'neighbor',parentId:'board1',x:22,y:19,width:82,height:71,color:'#34826b'}),
      ];
      window.fixture={...qa.doc,layers,width:540,height:400};qa.load(fixture);qa.mode('boards');
      window.withOtherAdjustment=()=>qa.load({...fixture,layers:[...fixture.layers,L('adjustment',{id:'other-adjustment',parentId:'board1',
        adjustment:{...require(root+'/core/adjustments.cjs').defaults('exposure'),exposure:1}})]});
      window.place=()=>views.get('layers').restore({view:{x:40,y:75,zoom:.5},tool:'select'});
      window.point=()=>{
        const r=document.querySelector('.layer-stage').getBoundingClientRect(),m=document.querySelector('.layer-overlay>g').transform.baseVal.consolidate().matrix;
        return {x:Math.round(r.left+m.e+75*m.a),y:Math.round(r.top+m.f+80*m.d)};
      };
      let record={id:'drag',revision:0,document:fixture},dirty=false;
      window.saveQueue=createAutosave({read:()=>record,dirty:()=>dirty,snapshot:()=>record.document,blocked:()=>false,
        status:()=>{},write:async(_id,document)=>{probe.writes++;return {document};},
        commit:(saved,unchanged)=>{probe.saved=saved.document;if(unchanged)dirty=false;}});
      qa.onChange=(document,options)=>{probe.options=options;record={...record,document};dirty=true;saveQueue.changed(!options?.deferSave);};
      window.pixelParity=async(fullOptions,document)=>{
        const fresh=new Compositor(),expected=window.document.createElement('canvas'),live=window.document.querySelector('canvas[aria-label="图层画布"]');
        const {signal,...options}=fullOptions;
        try{
          await render.call(fresh,document,expected,options);
          const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          const a=pixels(live),b=pixels(expected);let changed=0,max=0;
          for(let i=0;i<a.length;i++){if(a[i]!==b[i])changed++;max=Math.max(max,Math.abs(a[i]-b[i]));}
          return {changed,max,sameSize:live.width===expected.width&&live.height===expected.height};
        }finally{fresh.dispose();}
      };
    };
    await js(`(${setup.toString()})(${JSON.stringify(process.cwd())});void 0`);
    await idle();await placeView();
    for(const {id,name,selector,body} of [
      {id:'board1',name:'画板二',selector:'[data-board-label="board1"] > rect',body:true},
      {id:'board0',name:'画板一',selector:'.board-label-hit[data-board-id="board0"]'},
    ]){
      const click=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.left+${body?50:8}),y:Math.round(r.top+${body?50:8})};})()`);
      await js(`window.boardFrame=document.querySelector('canvas[aria-label="图层画布"]').toDataURL();probe.hold=true;void 0`);
      pointer('mouseDown',click.x,click.y);pointer('mouseUp',click.x,click.y);
      await wait(`!!probe.release&&document.querySelector('[data-board-label="${id}"] > rect')?.getAttribute('stroke')==='var(--accent)'`);
      check(`switching to ${id} retains the previous bitmap while the new frame is rendering`,await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(document.querySelector('canvas[aria-label="图层画布"]').toDataURL()===boardFrame))))`));
      check(`switching to ${id} updates the inspector without editing the document`,await js(`document.querySelector('[aria-label="画板名称"]').value===${JSON.stringify(name)}&&qa.history.length===0&&probe.writes===0`));
      await js('probe.release();delete window.boardFrame;void 0');await idle();
    }
    await js(`window.fullOptions=probe.last.options;document.querySelector('.layer-stage').focus();void 0`);
    key('Right');
    await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    check('an arrow key with only the board selected adds no undo entry',await js('qa.history.length===0'));
    const p=await js('point()');
    pointer('mouseDown',p.x,p.y);
    await wait(`document.querySelector('[data-tree-id="target"]')?.getAttribute('aria-selected')==='true'`);
    const originalHandle=await js(`Number(document.querySelector('.layer-overlay [data-handle="resize"]').getAttribute('cx'))`);
    await js('probe.hold=true;probe.maxActive=0;window.from=probe.started;window.draws=probe.draws;void 0');
    pointer('mouseMove',p.x+14,p.y+6);await wait('!!probe.release');
    for(let i=1;i<=12;i++){pointer('mouseMove',p.x+14+i*3,p.y+6+i);await delay(10);}
    await wait(`Math.abs(Number(document.querySelector('.layer-overlay [data-handle="resize"]').getAttribute('cx'))-${originalHandle+100})<.001`);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    check('high frequency input retains one live render and never records a draft',await js('probe.started===from+1&&probe.maxActive===1&&qa.history.length===0'));
    await js('probe.release();void 0');await idle();
    check('a completed preview is shown and the newest position follows it',await js('probe.started===from+2&&probe.draws===draws+2&&probe.maxActive===1&&probe.aborts===0'));
    check('the queued preview uses the last native pointer position',await js(`(()=>{const {x,y}=probe.last.document.layers.find(l=>l.id==='target');return x===150&&y===88;})()`));
    check('motion preview uses a smaller raster region',await js('probe.last.options.width<fullOptions.width/2&&probe.last.options.height<fullOptions.height/2'));
    report.previewPixels=await js('pixelParity(fullOptions,probe.last.document)');
    check('cropped preview preserves shadow, mask and overlapping layer pixels',report.previewPixels.sameSize&&report.previewPixels.changed===0);
    await js('probe.hold=true;window.draws=probe.draws;void 0');
    pointer('mouseMove',p.x+72,p.y+22);await wait('!!probe.release');
    pointer('mouseUp',p.x+96,p.y+28);
    await wait(`qa.doc.layers.find(l=>l.id==='target').x===242`);
    check('release uses pointerup coordinates and makes one deferred history record',await js(`qa.doc.layers.find(l=>l.id==='target').y===108&&qa.history.length===1&&probe.options.deferSave===true&&probe.draws===draws`));
    await js('probe.release();void 0');await idle();
    check('late drag frame cannot overwrite the final full render',await js('probe.aborts===1&&probe.draws===draws+1&&probe.last.options.width===fullOptions.width'));
    report.finalPixels=await js('pixelParity(fullOptions,probe.last.document)');
    check('final viewport matches a fresh full render byte for byte',report.finalPixels.sameSize&&report.finalPixels.changed===0);
    await delay(1750);check('drag does not schedule automatic persistence',await js('probe.writes===0'));
    await js('saveQueue.flush()');check('saving manually includes the final coordinates',await js(`probe.writes===1&&probe.saved.layers.find(l=>l.id==='target').x===242`));
    await js('qa.undo();void 0');await idle();check('one undo restores the original layer position',await js(`qa.doc.layers.find(l=>l.id==='target').x===50&&qa.history.length===0`));
    pointer('mouseDown',p.x,p.y);pointer('mouseMove',p.x+32,p.y+12);await delay(50);key('Escape');pointer('mouseUp',p.x+44,p.y+12);await idle();
    check('cancel drops pending motion and creates no history record',await js(`qa.doc.layers.find(l=>l.id==='target').x===50&&qa.history.length===0`));
    const stage="document.querySelector('.layer-stage')";
    await js(`window.addEventListener('pointerdown',e=>window.dragPointer=e.pointerId,{once:true,capture:true});void 0`);
    pointer('mouseDown',p.x,p.y);pointer('mouseMove',p.x+20,p.y+8);
    await wait(`${stage}.hasPointerCapture(window.dragPointer)&&probe.last.document.layers.find(l=>l.id==='target').x===90`);
    key('Right');
    await js(`${stage}.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-100}));void 0`);
    await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    check('wheel and arrow input during a drag preserve its scale and document',await js("document.querySelector('.layer-overlay>g').transform.baseVal.consolidate().matrix.a===.5&&qa.history.length===0"));
    await js("window.dispatchEvent(new Event('blur'));void 0");
    check('losing window focus releases the active drag immediately',await js(`!${stage}.hasPointerCapture(window.dragPointer)`));
    pointer('mouseUp',p.x+40,p.y+8);await idle();
    check('release after focus loss leaves coordinates and undo history intact',await js("qa.doc.layers.find(l=>l.id==='target').x===50&&qa.history.length===0"));
    const resize=await js(`(()=>{const r=document.querySelector('.layer-overlay [data-handle="resize"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    pointer('mouseDown',resize.x,resize.y);pointer('mouseMove',resize.x+20,resize.y+10);
    await wait("probe.last.document.layers.find(l=>l.id==='target').width!==70");
    await js(`${stage}.releasePointerCapture(window.dragPointer);void 0`);
    pointer('mouseMove',resize.x+25,resize.y+15);pointer('mouseUp',resize.x+25,resize.y+15);
    await wait("probe.last.document.layers.find(l=>l.id==='target').width===70");await idle();
    check('a resize interrupted by capture loss discards the preview',await js("qa.doc.layers.find(l=>l.id==='target').width===70&&qa.history.length===0"));
    const board=await js(`(()=>{const r=document.querySelector('.board-label-hit[data-board-id="board1"]').getBoundingClientRect();return {x:Math.round(r.left+8),y:Math.round(r.top+8)};})()`);
    pointer('mouseDown',board.x,board.y);pointer('mouseMove',board.x+22,board.y+12);await wait(`!!document.querySelector('[data-board-label="board1"]').getAttribute('transform')`);
    pointer('mouseUp',board.x+61,board.y+27);await wait('qa.history.length===1');await idle();
    report.board=await js(`(()=>{const {x,y}=qa.doc.layers.find(l=>l.id==='board1');return {x,y,history:qa.history.length,deferSave:probe.options.deferSave};})()`);
    check('board move uses exact release position and defers saving',report.board.x===722&&report.board.y===54&&report.board.history===1&&report.board.deferSave);
    await js(`qa.load({...fixture,layers:fixture.layers.map(l=>l.id==='board0'?{...l,layout:{snap:true,gridSize:20,guides:[{axis:'x',position:89}]}}:l.id==='target'?{...l,rotation:0}:l.id==='above'?{...l,maskSourceId:'target'}:l)});void 0`);
    await wait(`qa.doc.layers.find(l=>l.id==='above').maskSourceId==='target'`);await idle();await placeView();
    const linked=await js('point()'),started=await js('probe.started');
    pointer('mouseDown',linked.x,linked.y);pointer('mouseMove',linked.x+5,linked.y+6);
    await wait(`probe.started>${started}`);await idle();
    check('linked mask uses a full preview',await js('probe.last.options.width===fullOptions.width&&probe.last.options.height===fullOptions.height'));
    pointer('mouseUp',linked.x+17,linked.y+11);await wait('qa.history.length===1');await idle();
    check('release applies grid and guide snapping before recording the move',await js(`(()=>{const {x,y}=qa.doc.layers.find(l=>l.id==='target');return x===89&&y===80&&probe.options.deferSave===true;})()`));
    await js('withOtherAdjustment();void 0');await wait(`qa.doc.layers.some(l=>l.id==='other-adjustment')`);await idle();await placeView();
    const adjusted=await js('point()'),beforeAdjustmentDrag=await js('probe.started');
    pointer('mouseDown',adjusted.x,adjusted.y);pointer('mouseMove',adjusted.x+12,adjusted.y+10);
    await wait(`probe.started>${beforeAdjustmentDrag}`);await idle();
    check('an adjustment on another artboard keeps drag rendering regional',await js('probe.last.options.width<fullOptions.width/2&&probe.last.options.height<fullOptions.height/2'));
    const adjustmentPixels=await js('pixelParity(fullOptions,probe.last.document)');
    check('regional dragging with an adjustment on another artboard matches the full viewport',adjustmentPixels.sameSize&&adjustmentPixels.changed===0);
    pointer('mouseUp',adjusted.x+16,adjusted.y+13);await wait('qa.history.length===1');await idle();
    await js('qa.load(fixture);void 0');await idle();await placeView();
    await js(`window.controlsToggle=()=>[...document.querySelectorAll('label.check')].find(l=>l.textContent==='显示变换控件').querySelector('input');controlsToggle().click();void 0`);
    const neighbor=await js(`(()=>{const r=document.querySelector('[data-board-label="board1"] > rect').getBoundingClientRect();return {x:Math.round(r.left+25),y:Math.round(r.top+20)};})()`);
    pointer('mouseDown',neighbor.x,neighbor.y);
    await wait(`document.querySelector('[data-tree-id="neighbor"]')?.getAttribute('aria-selected')==='true'`);
    pointer('mouseMove',neighbor.x+14,neighbor.y+8);pointer('mouseUp',neighbor.x+20,neighbor.y+10);
    await wait('qa.history.length===1');await idle();
    check('one press selects and drags across boards with one deferred commit',await js(`(()=>{const l=qa.doc.layers.find(l=>l.id==='neighbor');return l.x===62&&l.y===39&&probe.options.deferSave===true;})()`));
    check('switching boards retains the selection tool settings',await js('!controlsToggle().checked'));
    const clickX=neighbor.x+20,clickY=neighbor.y+10;
    pointer('mouseDown',clickX,clickY);pointer('mouseMove',clickX+1,clickY+1);pointer('mouseUp',clickX+1,clickY+1);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    check('slight pointer jitter preserves selection and coordinates without history',await js(`qa.history.length===1&&qa.doc.layers.find(l=>l.id==='neighbor').x===62&&document.querySelector('[data-tree-id="neighbor"]').getAttribute('aria-selected')==='true'`));
    await js(`qa.load({...fixture,layers:fixture.layers.map(l=>l.id==='board1'?{...l,x:0}:l)});void 0`);await idle();await placeView();
    const overlap=await js('point()');
    pointer('mouseDown',overlap.x,overlap.y);pointer('mouseUp',overlap.x,overlap.y);
    await wait(`document.querySelector('[data-tree-id="neighbor"]').getAttribute('aria-selected')==='true'`);
    check('clicks in overlapping boards select the frontmost visible content',await js('qa.history.length===0'));
    await placeView();
    await js(`${stage}.addEventListener('pointerdown',()=>${stage}.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:11,deltaY:7})),{capture:true,once:true});void 0`);
    w.webContents.sendInputEvent({type:'mouseDown',...overlap,button:'middle',clickCount:1});
    w.webContents.sendInputEvent({type:'mouseUp',x:overlap.x+22,y:overlap.y+18,button:'middle',clickCount:1});
    await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");await idle();
    check('starting a hand pan in the same frame as a scroll preserves both movements',await js("(()=>{const m=document.querySelector('.layer-overlay>g').transform.baseVal.consolidate().matrix;return m.e===51&&m.f===86&&qa.history.length===0;})()"));
    key('Right');await wait("qa.doc.layers.find(l=>l.id==='neighbor').x===23");
    check('the next arrow key nudges the selected layer once',await js('qa.history.length===1'));
    await js("qa.load({...fixture,layers:fixture.layers.map(l=>l.id==='target'?{...l,locked:true}:l)});qa.select(['target']);void 0");
    await wait("document.querySelector('[data-tree-id=target]')?.getAttribute('aria-selected')==='true'");
    await js(`${stage}.focus();void 0`);key('Right');
    await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    check('nudging a locked layer leaves its coordinates and undo history intact',await js("qa.doc.layers.find(l=>l.id==='target').x===50&&qa.history.length===0"));
    await js('saveQueue.dispose();void 0');
    check('no renderer errors',report.errors.length===0);
  }catch(error){report.failure=error.stack;}
  fs.writeFileSync(path.join(out,'regression.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));app.exit(report.failure?1:0);
});
setTimeout(()=>app.exit(2),60000).unref();
