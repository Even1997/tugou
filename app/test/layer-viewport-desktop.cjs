const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=path.resolve('test-results/layer-viewport');fs.mkdirSync(dir,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'tugou-viewport-')));
process.env.ESBUILD_WORKER_THREADS='0';
const baseline=process.argv.includes('--baseline'),report={runs:[],errors:[]};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

app.whenReady().then(async()=>{
  const w=new BrowserWindow({width:1440,height:900,show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,backgroundThrottling:false}});
  w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
  const js=code=>w.webContents.executeJavaScript(code,true);
  const wait=async code=>{for(let i=0;i<220;i++){if(await js(code))return;await delay(25);}throw Error('Timeout '+code);};
  const idle=()=>wait('viewportQA.canvas().dataset.rendering==="false"');
  const send=(type,p,extra)=>w.webContents.sendInputEvent({type,...p,...extra});
  try{
    await w.loadFile(path.resolve('renderer/index.html'));
    await js(`require(${JSON.stringify(path.resolve('test/line-tools-renderer.cjs'))});void 0`);
    w.show();w.webContents.debugger.attach('1.3');
    await w.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
    await wait('!!qa.mode');
    await js(`(${setup.toString()})(${JSON.stringify(process.cwd())});void 0`);
    await wait('!!viewportQA.canvas()');await idle();
    await w.capturePage();
    for(const mode of ['scroll','zoom','pan','scroll-wide']){
      await js('viewportQA.reset();void 0');await wait('viewportQA.atStart()');await idle();
      const p=await js(`viewportQA.begin(${JSON.stringify(mode)})`);
      if(mode==='pan'){
        await js(`document.querySelector('.layer-stage').focus();void 0`);
        send('keyDown',{}, {keyCode:'Space'});send('mouseMove',p);send('mouseDown',p,{button:'left',clickCount:1});
        for(let i=1;i<=60;i++){
          send('mouseMove',{x:p.x+i*2,y:p.y+Math.floor(i/2)},{modifiers:['leftButtonDown']});await delay(10);
        }
        send('mouseUp',{x:p.x+126,y:p.y+35},{button:'left',clickCount:1});send('keyUp',{}, {keyCode:'Space'});
        await wait('viewportQA.panReleased()');
      }else await js(`viewportQA.wheelBurst(${JSON.stringify(mode)},${JSON.stringify(p)})`);
      const run=await js(`viewportQA.end(${JSON.stringify(mode)})`);report.runs.push(run);
      await wait(baseline?'viewportQA.canvas().dataset.rendering==="false"':'viewportQA.settled()');
      run.final=await js('viewportQA.verify()');
      assert.ok(run.final.pixels&&run.final.history===0,`${mode} finishes at a clean render without editing the project`);
      if(!baseline){
        assert.ok(run.transforms>=12&&run.renders<run.visualFrames/2,`${mode} uses many more visual poses than full compositions`);
        assert.ok(run.final.position,`${mode} raster matches the final overlay coordinates`);
        if(mode==='scroll-wide')assert.ok(run.renders>0,'continuous large pan refreshes newly exposed content');
        if(mode==='pan')assert.deepEqual(run.final.view,{x:166,y:105,zoom:.5});
        else assert.ok(run.final.anchor,`${mode} retains all input deltas and zooms around the cursor`);
      }
    }
    assert.deepEqual(report.errors,[]);
  }catch(error){report.failure=error.stack;}
  fs.writeFileSync(path.join(dir,baseline?'before.json':'after.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));app.exit(report.failure?1:0);
});
setTimeout(()=>app.exit(2),60000).unref();

function setup(root){
  const {createLayer:L}=require(root+'/core/layers.cjs'),{Compositor}=require(root+'/renderer/composite.js'),{views}=require(root+'/renderer/ui-view.js');
  const layers=Array.from({length:16},(_,b)=>{
    const id=`board-${b}`;
    return [L('group',{id,artboard:true,x:b%4*900,y:Math.floor(b/4)*710,width:840,height:670,background:'#ffffff'}),
      ...Array.from({length:160},(_,i)=>L('shape',{id:`${id}-${i}`,parentId:id,x:8+i%16*49,y:10+Math.floor(i/16)*56,width:43,height:40,
        color:i%2?'#487bac':'#b6674e',opacity:i%7?.9:.56,rotation:i%6?0:8}))];
  }).flat();
  qa.load({...qa.doc,layers,width:840,height:670});qa.mode('boards');
  const canvas=()=>document.querySelector('canvas[aria-label="图层画布"]'),stage=()=>document.querySelector('.layer-stage');
  const view=()=>{const m=document.querySelector('.layer-overlay > g').transform.baseVal.consolidate().matrix;return {x:m.e,y:m.f,zoom:m.a};};
  const near=(a,b)=>Math.abs(a-b)<.001;
  const render=Compositor.prototype.render,draw=CanvasRenderingContext2D.prototype.drawImage;
  let metric,pose,exact,finalPose,frame,rendered,draws=0;
  Compositor.prototype.render=async function(doc,target,options){
    if(metric){metric.renders++;await new Promise(resolve=>setTimeout(resolve,40));}
    const result=await render.call(this,doc,target,options);rendered={doc,options};return result;
  };
  CanvasRenderingContext2D.prototype.drawImage=function(...args){
    draw.apply(this,args);if(this.canvas.getAttribute('aria-label')==='图层画布')draws++;
  };
  const wheel=e=>{
    if(e.ctrlKey){const zoom=exact.zoom*Math.exp(-e.deltaY*.002),k=zoom/exact.zoom;exact={x:pose.x-(pose.x-exact.x)*k,y:pose.y-(pose.y-exact.y)*k,zoom};}
    else{exact.x-=e.deltaX;exact.y-=e.deltaY;}
  };
  window.viewportQA={canvas,
    reset:()=>views.get('layers').restore({view:{x:40,y:70,zoom:.5},tool:'select'}),
    atStart:()=>view().zoom===.5&&view().x===40&&view().y===70&&rendered?.options.x===-80&&rendered.options.y===-140,
    settled(){
      const displayed=view(),opts=rendered?.options;
      return opts&&canvas().dataset.rendering==='false'&&!canvas().style.transform&&near(opts.scale,displayed.zoom*Math.min(devicePixelRatio,2))&&
        near(-opts.x*displayed.zoom,displayed.x)&&near(-opts.y*displayed.zoom,displayed.y);
    },
    begin(mode){
      const r=stage().getBoundingClientRect(),p={x:Math.round(r.left+300),y:Math.round(r.top+250)};
      pose={x:p.x-r.left,y:p.y-r.top};exact=view();stage().addEventListener('wheel',wheel);
      metric={renders:0,transforms:0,times:[]};let lastTransform=canvas().style.transform,lastDraw=draws;
      if(mode==='pan')stage().addEventListener('pointerup',()=>{if(metric)metric.released=true;},{once:true});
      const collect=now=>{
        const transform=canvas().style.transform;
        if(transform!==lastTransform||draws!==lastDraw)metric.times.push(now);
        if(transform&&transform!==lastTransform)metric.transforms++;
        lastTransform=transform;lastDraw=draws;frame=requestAnimationFrame(collect);
      };frame=requestAnimationFrame(collect);return p;
    },
    panReleased:()=>metric.released,
    async wheelBurst(mode,p){
      for(let i=1;i<=60;i++){
        stage().dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:p.x,clientY:p.y,
          deltaX:mode==='scroll-wide'?8:mode==='scroll'?2:0,deltaY:mode==='zoom'?(i<=30?-2:1):1,ctrlKey:mode==='zoom'}));
        await new Promise(requestAnimationFrame);
      }
    },
    end(mode){
      cancelAnimationFrame(frame);stage().removeEventListener('wheel',wheel);finalPose=exact;
      const {renders,times,transforms}=metric;metric=null;
      const gaps=times.slice(1).map((time,i)=>time-times[i]).sort((a,b)=>a-b);
      return {mode,renders,visualFrames:times.length,transforms,p95Ms:gaps.length?gaps[Math.floor((gaps.length-1)*.95)]:null};
    },
    async verify(){
      const displayed=view(),{doc,options}=rendered,c=document.createElement('canvas'),engine=new Compositor();
      await render.call(engine,doc,c,{...options,signal:undefined});engine.dispose();
      const pixels=c.toDataURL()===canvas().toDataURL();
      const result={pixels,history:qa.history.length,view:displayed,
        position:near(-options.x*displayed.zoom,displayed.x)&&near(-options.y*displayed.zoom,displayed.y),
        anchor:['x','y','zoom'].every(key=>near(displayed[key],finalPose[key]))};
      return result;
    }
  };
}
