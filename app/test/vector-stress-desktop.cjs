const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const count=11998,baseline=process.argv.includes('--baseline'),out=path.resolve('test-results/vector-stress');
fs.mkdirSync(out,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'tugou-vector-')));
process.env.ESBUILD_WORKER_THREADS='0';
const spread=process.argv.includes('--spread'),canvasZoom=process.argv.includes('--zoom-2')?2:1;
const editIndex=process.argv.includes('--interior')?6030:0,styled=process.argv.includes('--styled');
const report={anchors:count,canvasZoom,editIndex,styled,distribution:spread?'wide':'ring',runs:[],bursts:[],errors:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  const w=new BrowserWindow({width:1440,height:900,show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,backgroundThrottling:false}});
  w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
  const js=s=>w.webContents.executeJavaScript(s,true);
  const wait=async s=>{for(let i=0;i<240;i++){if(await js(s))return;await sleep(25);}throw Error('timeout '+s);};
  try{
    await w.loadFile(path.resolve('renderer/index.html'));
    await js(`require(${JSON.stringify(path.resolve('test/line-tools-renderer.cjs'))});void 0`);
    w.show();w.focus();await wait('!!qa.mode');
    await js(`(${setup.toString()})(${JSON.stringify(process.cwd())},${count},${spread},${canvasZoom},${editIndex},${styled});void 0`);
    await wait('!!document.querySelector(".layer-stage")');
    await js("probe.reset();void 0");await wait("!!document.querySelector('[aria-label=锚点编号]')");if(editIndex)await js(`probe.pickIndex(${editIndex+1})`);await wait('probe.ready()');await w.capturePage();
    report.devicePixelRatio=await js('devicePixelRatio');
    report.controls=await js("document.querySelectorAll('.layer-overlay *').length");
    for(const mode of ['anchor','in','out','zoom']){
      const zoom=mode==='zoom',p=await js(`probe.start('${mode}')`);
      const fire=(type,x,y)=>w.webContents.sendInputEvent({type,x,y,...(type==='mouseMove'?{modifiers:['leftButtonDown']}:{button:'left',clickCount:1})});
      if(!zoom)fire('mouseDown',p.x,p.y);
      for(let i=1;i<=24;i++){
        if(zoom)await js(`probe.wheel(${i<=12?-8:8});void 0`);
        else fire('mouseMove',p.x+i*2,p.y+i);
        await js('probe.next()');
      }
      report.runs.push(await js('probe.metrics()'));
      if(!zoom){
        assert.equal(await js('qa.history.length'),0);
        if(!baseline){
          await wait(`probe.painted()&&probe.correct('${mode}',${p.x+48},${p.y+24},true)`);
          assert.ok(await js('probe.workerPainted()'));
          const parity=await js('probe.parity()');report.runs.at(-1).pixels=parity;assert.equal(parity.changed,0);
        }
        fire('mouseUp',p.x+50,p.y+25);await wait('qa.history.length===1');
        if(!baseline){await wait('probe.settled()');assert.equal((await js('probe.parity()')).changed,0);}
        assert.ok(await js(`probe.correct('${mode}',${p.x+50},${p.y+25})&&probe.deferred`));
        await js('qa.undo();void 0');await wait('probe.restored()');
      }else assert.equal(await js('qa.history.length'),0);
    }
    if(!baseline){
      for(const mode of ['anchor','in','out','zoom']){
        const p=await js(`probe.start('${mode}')`),fire=(type,x,y)=>w.webContents.sendInputEvent({type,x,y,...(type==='mouseMove'?{modifiers:['leftButtonDown']}:{button:'left',clickCount:1})});
        await js('probe.watch();void 0');
        if(mode==='zoom')await js("probe.scrollBurst()");
        else{
          fire('mouseDown',p.x,p.y);
          for(let i=1;i<=90;i++){fire('mouseMove',p.x+i,p.y+Math.round(i/3));await sleep(10);}
          fire('mouseUp',p.x+90,p.y+30);await wait('qa.history.length===1');
          assert.ok(await js(`probe.correct('${mode}',${p.x+90},${p.y+30})&&probe.deferred`));
        }
        const r=await js('probe.stop()');report.bursts.push(r);
        if(mode!=='zoom'){await js('qa.undo();void 0');await wait('probe.restored()');}
      }
      await wait('probe.restored()');
      const cancel=await js("probe.start('out')");
      w.webContents.sendInputEvent({type:'mouseDown',...cancel,button:'left',clickCount:1});
      w.webContents.sendInputEvent({type:'mouseMove',x:cancel.x+16,y:cancel.y+8,modifiers:['leftButtonDown']});
      await wait("!!document.querySelector('.edited-vector-segment')");
      w.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
      w.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
      w.webContents.sendInputEvent({type:'mouseUp',x:cancel.x+16,y:cancel.y+8,button:'left',clickCount:1});
      await wait("probe.original()&&probe.settled()&&!document.querySelector('.edited-vector-segment')");
      assert.equal((await js('probe.parity()')).changed,0);report.cancelled=true;
      await js("probe.reset();void 0");await wait('probe.restored()');
      const other=await js('probe.other()');
      for(const type of ['mouseDown','mouseUp'])w.webContents.sendInputEvent({type,x:other.x,y:other.y,button:'left',clickCount:1});
      await wait(`!!document.querySelector('[data-handle="vector:0:${other.index}:anchor"]')`);assert.equal(await js('qa.history.length'),0);
      report.precisePick=true;
      await js("probe.pickIndex(11998);void 0");await wait("!!document.querySelector('[data-handle=\"vector:0:11997:anchor\"]')");
      await js("probe.click('在此点后插入');void 0");await wait('probe.count()===11999');
      await js("probe.click('在此点后插入');void 0");await wait('probe.count()===12000');
      assert.ok(await js("probe.button('在此点后插入').disabled"));
      await js("probe.click('删除锚点');void 0");await wait('probe.count()===11999');
      await js('qa.undo();void 0');await wait('probe.count()===12000');
      report.topology=true;
      assert.ok(report.controls<2000,'editor overlay is bounded independently of raw path size');
      for(const r of report.bursts)assert.ok(r.poses>=24&&r.p95<65,JSON.stringify(r));
      for(const r of report.bursts.filter(r=>r.mode!=='zoom')){
        assert.ok(r.segmentPoses>=24&&r.segmentP95<40&&r.draws>=12&&r.paintP95<65,JSON.stringify(r));
      }
      for(const r of report.runs)assert.ok(r.p95<65,`${r.mode} p95 ${r.p95} ms`);
    }
    assert.deepEqual(report.errors,[]);
  }catch(e){report.failure=e.stack;report.state=await js('window.probe?.state()').catch(()=>null);}
  fs.writeFileSync(path.join(out,(baseline?'before':'after')+'-'+(report.devicePixelRatio||1)+(spread?'-wide':'')+(canvasZoom===2?'-zoom2':'')+(editIndex?'-interior':'')+(styled?'-styled':'')+'.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));app.exit(report.failure?1:0);
});
setTimeout(()=>{console.error('vector desktop timeout');app.exit(2);},180000).unref();

function setup(root,count,spread,canvasZoom,editIndex,styled){
  const {createLayer}=require(root+'/core/layers.cjs'),{views}=require(root+'/renderer/ui-view.js');
  const nodes=Array.from({length:count},(_,i)=>{
    const t=2*Math.PI*i/count,r=.22+.02*Math.sin(t*41);
    const row=Math.floor(i/120),column=i%120;
    const x=spread ? .33+.64*(row%2?119-column:column)/119:.64+r*Math.cos(t);
    const y=spread ? .04+.90*(row+.12*Math.sin(column/3))/100:.5+r*Math.sin(t);
    return {x,y,in:[x+.0002*Math.sin(t),y-.0002*Math.cos(t)],out:[x-.0002*Math.sin(t),y+.0002*Math.cos(t)]};
  });
  nodes[0]={x:.2,y:.25,in:[.16,.27],out:[.24,.23]};
  if(editIndex){const n=nodes[editIndex];n.in=[n.x-.035,n.y+.03];n.out=[n.x+.035,n.y-.03];}
  const originalNode=nodes[editIndex];
  const board=createLayer('group',{id:'board',artboard:true,width:900,height:650,x:0,y:0,background:'#fff',clipContent:true});
  const layer=createLayer('shape',{id:'curve',parentId:'board',shape:'path',x:0,y:0,width:600,height:500,paths:[{closed:true,nodes}],fill:true,color:'#485aaf',strokeWidth:1});
  if(styled)Object.assign(layer,{opacity:.67,gradient:{angle:23,endColor:'#fc801a'},mask:{paths:[{points:[0,0,1,0,1,1,0,1]}]}});
  qa.load({...qa.doc,layers:[board,layer]});qa.mode('boards');qa.select(['curve']);
  const group=()=>document.querySelector('.layer-overlay>g'),stage=()=>document.querySelector('.layer-stage');
  const handle=mode=>document.querySelector('[data-handle="vector:0:'+editIndex+':'+mode+'"]');
  const node=()=>qa.doc.layers.find(l=>l.id==='curve').paths[0].nodes[editIndex];
  const {Compositor}=require(root+'/renderer/composite.js'),render=Compositor.prototype.render;
  const bitmap=Compositor.prototype.vectorBitmap;
  const view={x:canvasZoom===2?-140:30,y:canvasZoom===2?-100:50,zoom:canvasZoom};
  let rendered;
  Compositor.prototype.render=async function(doc,canvas,options){
    const result=await render.call(this,doc,canvas,options);
    if(!options.signal?.aborted)rendered={doc,options};
    return result;
  };
  let target,mode,last,previous,gaps=[],draws=0,frame,visual,paints,segments,rasters;
  Compositor.prototype.vectorBitmap=async function(layer,transform,frame){
    const start=performance.now(),result=await bitmap.call(this,layer,transform,frame);
    if(result)rasters?.push({ratio:frame.scale/canvasZoom,ms:performance.now()-start});
    return result;
  };
  const draw=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(...args){const result=draw.apply(this,args);if(this.canvas.getAttribute('aria-label')==='图层画布'){draws++;paints?.push(performance.now());}return result;};
  const value=()=>mode==='zoom'?group().getAttribute('transform'):target.getAttribute('cx')+','+target.getAttribute('cy');
  const probe=window.probe={
    reset(){if(editIndex){view.x=Math.round(stage().clientWidth*.45-originalNode.x*600*canvasZoom);view.y=Math.round(stage().clientHeight*.45-originalNode.y*500*canvasZoom);}views.get('layers').restore({view,tool:'nodes'});},
    ready:()=>handle('anchor')&&group().transform.baseVal.consolidate().matrix.a===canvasZoom&&document.querySelector('[aria-label=图层画布]').dataset.rendering==='false',
    start(next){
      mode=next;target=handle(mode==='zoom'?'anchor':mode);
      const r=target.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
      if(mode!=='zoom'&&document.elementFromPoint(x,y)!==target)throw Error('handle not hittable: '+mode);
      gaps=[];draws=0;last=value();previous=performance.now();return {x,y};
    },
    next(){return new Promise((resolve,reject)=>{const start=performance.now();
      const sample=()=>{const v=value();if(v!==last){const now=performance.now();gaps.push(now-previous);previous=now;last=v;resolve();}
        else if(performance.now()-start>5000)reject(Error('missing visible '+mode+' update'));else requestAnimationFrame(sample);};
      requestAnimationFrame(sample);
    });},
    wheel(deltaY){const r=stage().getBoundingClientRect();stage().dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,clientX:r.left+150,clientY:r.top+175,deltaY}));},
    watch(){
      visual=[];paints=[];segments=[];rasters=[];let lastSegment;
      const sample=now=>{
        const v=value(),segment=document.querySelector('.edited-vector-segment')?.getAttribute('d');
        if(v!==last){visual.push(now);last=v;}
        if(segment&&segment!==lastSegment){segments.push(now);lastSegment=segment;}
        frame=requestAnimationFrame(sample);
      };
      frame=requestAnimationFrame(sample);
    },
    async scrollBurst(){for(let i=0;i<90;i++){probe.wheel(i<45?-4:4);await new Promise(r=>setTimeout(r,10));}await new Promise(requestAnimationFrame);},
    stop(){
      cancelAnimationFrame(frame);
      const gaps=times=>times.slice(1).map((v,i)=>v-times[i]).sort((a,b)=>a-b);
      const p95=values=>+(values[Math.floor(.95*(values.length-1))]||0).toFixed(1);
      const visible=gaps(visual),paintP95=p95(gaps(paints));paints=null;
      const rasterP95=p95(rasters.map(r=>r.ms).sort((a,b)=>a-b)),minRatio=+Math.min(1,...rasters.map(r=>r.ratio)).toFixed(3);
      rasters=null;
      return {mode,poses:visual.length,draws,paintP95,rasterP95,minRatio,segmentPoses:segments.length,segmentP95:p95(gaps(segments)),p95:p95(visible),max:+(visible.at(-1)||0).toFixed(1)};
    },
    workerPainted:()=>Boolean(rendered.options.vectorDrag&&!rendered.options.vectorDrag.rasterFailed),
    state:()=>({history:qa.history.length,original:probe.original(),painted:probe.painted(),scale:rendered?.options.scale,segment:!!document.querySelector('.edited-vector-segment'),selected:document.querySelector('[aria-label=锚点编号]')?.value}),
    settled:()=>probe.painted()&&Math.abs(rendered.options.scale-canvasZoom*Math.min(2,devicePixelRatio))<1e-6&&rendered.doc.layers.find(l=>l.id==='curve').paths===qa.doc.layers.find(l=>l.id==='curve').paths,
    painted:()=>document.querySelector('[aria-label=图层画布]').dataset.rendering==='false'&&!!rendered,
    async parity(){
      const live=document.querySelector('[aria-label=图层画布]'),expected=document.createElement('canvas'),engine=new Compositor();
      try{await render.call(engine,rendered.doc,expected,{...rendered.options,vectorDrag:undefined,signal:undefined});
        const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data,a=pixels(live),b=pixels(expected);let changed=0,max=0;
        if(a.length!==b.length)throw Error('preview size differs');
        for(let i=0;i<a.length;i++)if(a[i]!==b[i]){changed++;max=Math.max(max,Math.abs(a[i]-b[i]));}
        return {changed,max};
      }finally{engine.dispose();}
    },
    other(){
      const m=group().getScreenCTM(),position=n=>new DOMPoint(n.x*600,n.y*500).matrixTransform(m);
      const r=stage().getBoundingClientRect(),candidate=nodes.find((n,i)=>{
        const p=position(n);
        if(i<50||p.x<r.left+24||p.x>r.right-24||p.y<r.top+24||p.y>r.bottom-24)return false;
        const hit=document.elementFromPoint(Math.round(p.x),Math.round(p.y));
        return hit?.closest('.layer-stage')===stage()&&!hit.closest('[data-handle],button,input');
      });
      if(!candidate)throw Error('No visible dense anchor available for picking');
      const p=position(candidate),x=Math.round(p.x),y=Math.round(p.y);
      let index=0,min=Infinity;
      nodes.forEach((n,i)=>{const q=position(n),d=(x-q.x)**2+(y-q.y)**2;if(d<min){index=i;min=d;}});
      return {x,y,index};
    },
    count:()=>qa.doc.layers.find(l=>l.id==='curve').paths[0].nodes.length,
    pickIndex(v){const el=document.querySelector('[aria-label="锚点编号"]');el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(v));el.dispatchEvent(new Event('input',{bubbles:true}));return new Promise(r=>requestAnimationFrame(()=>{el.blur();r();}));},
    button:label=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label),
    click(label){probe.button(label).click();},
    metrics(){const sorted=gaps.slice().sort((a,b)=>a-b);return {mode,poses:gaps.length,draws,median:+sorted[12].toFixed(1),p95:+sorted[22].toFixed(1),max:+sorted.at(-1).toFixed(1)};},
    correct(mode,x,y,preview=false){const n=preview?rendered.doc.layers.find(l=>l.id==='curve').paths[0].nodes[editIndex]:node(),v=group().getScreenCTM(),p=new DOMPoint(...(mode==='anchor'?[n.x,n.y]:n[mode]).map((a,i)=>a*(i===0?600:500))).matrixTransform(v);return Math.hypot(p.x-x,p.y-y)<1.5;},
    original:()=>qa.history.length===0&&JSON.stringify(node())===JSON.stringify(originalNode),
    restored:()=>probe.original()&&probe.ready()
  };
  qa.onChange=(_doc,options)=>{probe.deferred=options?.deferSave===true;};
}
