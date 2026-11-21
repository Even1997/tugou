const {app,BrowserWindow}=require('electron');
const path=require('node:path'),os=require('node:os'),fs=require('node:fs'),assert=require('node:assert/strict');
const out=path.resolve('test-results/layer-alignment');
app.setPath('userData',fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'tugou-align-')));
process.env.ESBUILD_WORKER_THREADS='0';
app.whenReady().then(async()=>{
  const w=new BrowserWindow({width:1440,height:900,show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,backgroundThrottling:false}});
  const errors=[],js=s=>w.webContents.executeJavaScript(s,true);
  const wait=async s=>{for(let i=0;i<180;i++){if(await js("Boolean("+s+")"))return;await new Promise(r=>setTimeout(r,30));}throw Error('Timeout '+s);};
  w.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
  try{
    await w.loadFile(path.resolve('renderer/index.html'));
    await js('require('+JSON.stringify(path.resolve('test/line-tools-renderer.cjs'))+');void 0');
    w.show();w.focus();await wait('!!qa.mode');
    assert.deepEqual(await js('('+selectionRasterParity.toString()+')('+JSON.stringify(process.cwd())+')'),[]);
    await js('('+fixture.toString()+')('+JSON.stringify(process.cwd())+');void 0');
    await wait("document.querySelector('[data-tree-id=a]')");
    await js("setView();document.querySelector('[data-tree-id=a] .layer-preview').click();void 0");
    await wait("bar()&&choice()==='board'&&visible()");
    await js("press('右对齐')");await wait("x('a')===230&&qa.history.length===1");
    await js("qa.undo();void 0");await wait("x('a')===20");
    await js("document.querySelector('[data-tree-id=b] .layer-preview').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));void 0");
    await wait("choice()==='objects'");
    await js("press('左对齐')");await wait("x('a')===20&&x('b')===20&&qa.history.length===1");
    await js("qa.undo();void 0");await wait("x('b')===100");
    async function choose(ref){
      await js("bar().querySelector('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));void 0");
      await wait("!!document.querySelector('[data-option-value="+ref+"]')");
      await js("document.querySelector('[data-option-value="+ref+"]').click();void 0");await wait("choice()==='"+ref+"'");
    }
    await choose('selection');await wait("!button('左对齐').disabled");
    await js("press('左对齐')");await wait("x('a')===60&&x('b')===140&&qa.history.length===1");
    await js("qa.undo();void 0");await wait("x('a')===20");
    await choose('board');await js("press('水平居中')");await wait("x('a')===80&&x('b')===160&&qa.history.length===1");
    await js("press('水平居中')");assert.equal(await js('qa.history.length'),1);
    await js("setView();void 0");await wait('visible()&&inside()');
    fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(path.join(out,'selected.png'),(await w.capturePage(await js('crop()'))).toPNG());
    await js("qa.select(['a','b','c']);void 0");await wait("!button('水平等距').disabled");
    await js("press('水平等距')");await wait("x('a')===0&&x('c')===240&&x('b')===125");
    await js("qa.select([]);void 0");await wait("!bar()");
    const point=await js("pickPoint()");const fire=type=>w.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});
    fire('mouseDown');fire('mouseUp');await wait('visible()');
    fire('mouseDown');w.webContents.sendInputEvent({type:'mouseMove',x:point.x+12,y:point.y,modifiers:['leftButtonDown']});await wait('!visible()');
    w.webContents.sendInputEvent({type:'mouseUp',x:point.x+12,y:point.y,button:'left',clickCount:1});await wait('visible()');
    await js("qa.theme('dark');void 0");await wait("document.documentElement.dataset.theme==='dark'");
    w.setContentSize(540,700);await wait("bar()?.dataset.compact==='true'&&inside()");
    fs.writeFileSync(path.join(out,'narrow-dark.png'),(await w.capturePage(await js('crop()'))).toPNG());
    await js("editNodes();void 0");await wait('!bar()');
    await js("qa.load({...qa.doc,layers:qa.doc.layers.map(l=>l.id==='board'?{...l,selection:undefined}:l.id==='a'?{...l,locked:true}:l)});qa.select(['a','b']);setView();void 0");
    await wait("visible()&&button('左对齐').disabled");
    await js("press('左对齐')");assert.equal(await js('qa.history.length'),0);
    await js("bar().querySelector('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));void 0");
    await wait("document.querySelector('[data-option-value=selection]')?.closest('.ant-select-item-option-disabled')");
    assert.deepEqual(errors,[]);console.log('PASS tree, canvas, three references, spacing, distribution, undo, no-op, 200% positioning, drag visibility');
    app.exit(0);
  }catch(e){console.error(e.stack,errors,await js("({count:qa.history.length,x:qa.doc.layers.map(l=>[l.id,l.x,l.y,l.width]),target:choice(),disabled:bar()&&button('右对齐').disabled,msg:document.querySelector('[role=alert],.message.error')?.textContent})").catch(()=>null));app.exit(1);}
});
async function selectionRasterParity(root){
  const {renderSelectionMask,selectionBounds,surface}=require(root+'/renderer/selection-raster.js');
  const width=530,height=518,bitmap=surface(149,121);
  bitmap.getContext('2d').fillRect(22,9,114,105);
  const paths=[
    {operation:'add',points:[5,7,518,9,490,459,22,515]},
    {operation:'subtract',points:[10.6,20.5,255.2,258.3,50.5,504.5]},
    {operation:'intersect',points:[-3,-2,470,17,494,491,5,483]},
    {operation:'add',points:[215.2,8.7,389.9,236.8,419,364.5,253.3,510]},
    {operation:'subtract',points:[30,3,50,3,50,510,30,510]},
    {operation:'add',points:[510,2,525,2,525,505,510,505]},
  ];
  const differences=[];
  for(const image of [null,bitmap])for(const inverted of [false,true])for(const feather of [0,2.3]){
    const reference=surface(width,height),ctx=reference.getContext('2d',{willReadFrequently:true});
    if(image)ctx.drawImage(image,0,0,width,height);
    for(const {operation,points} of paths){
      const tmp=surface(width,height),pathCtx=tmp.getContext('2d',{willReadFrequently:true});
      pathCtx.beginPath();pathCtx.moveTo(points[0],points[1]);
      for(let i=2;i<points.length;i+=2)pathCtx.lineTo(points[i],points[i+1]);
      pathCtx.closePath();pathCtx.fill();
      ctx.globalCompositeOperation={add:'source-over',subtract:'destination-out',intersect:'destination-in'}[operation];
      ctx.drawImage(tmp,0,0);tmp.width=tmp.height=1;
    }
    ctx.globalCompositeOperation='source-over';
    if(inverted){ctx.globalCompositeOperation='source-out';ctx.fillRect(0,0,width,height);ctx.globalCompositeOperation='source-over';}
    if(feather){
      const blur=surface(width,height),blurCtx=blur.getContext('2d');
      blurCtx.filter='blur('+feather+'px)';blurCtx.drawImage(reference,0,0);
      ctx.clearRect(0,0,width,height);ctx.drawImage(blur,0,0);blur.width=blur.height=1;
    }
    const doc={width,height,selection:{paths,inverted,feather,bitmap:!!image}};
    const actual=renderSelectionMask(doc,image);
    const left=ctx.getImageData(0,0,width,height).data,right=actual.getContext('2d').getImageData(0,0,width,height).data;
    let changed=0,first;
    for(let i=0;i<left.length;i++)if(left[i]!==right[i]){changed++;first??=[i,left[i],right[i]];}
    if(changed)differences.push({bitmap:!!image,inverted,feather,changed,first});
    if(!feather){
      let x=width,y=height,r=0,b=0;
      for(let i=0;i<width*height;i++)if(left[i*4+3]){
        const px=i%width,py=Math.floor(i/width);
        x=Math.min(x,px);y=Math.min(y,py);r=Math.max(r,px+1);b=Math.max(b,py+1);
      }
      const box=await selectionBounds(doc,image);
      if(box.x!==x||box.y!==y||box.width!==r-x||box.height!==b-y)throw Error('选区边界与完整掩罩不一致');
    }
    reference.width=reference.height=actual.width=actual.height=1;
  }
  return differences;
}
function fixture(root){
  const {createLayer}=require(root+'/core/layers.cjs'),{views}=require(root+'/renderer/ui-view.js');
  const board=createLayer('group',{id:'board',artboard:true,x:400,y:300,width:260,height:200,background:'#ffffff',clipContent:true,
    selection:{paths:[{operation:'add',points:[40,40,210,40,210,150,40,150]},{operation:'subtract',points:[0,0,60,0,60,200,0,200]}]}});
  const shape=(id,x,w)=>createLayer('shape',{id,name:id,parentId:'board',x,y:45,width:w,height:35});
  const other=createLayer('group',{id:'other',artboard:true,background:'transparent',x:0,y:0,width:140,height:100});
  qa.load({...qa.doc,layers:[other,board,shape('a',20,30),shape('b',100,20),shape('c',200,20)]});qa.mode('boards');qa.select(['a']);
  Object.assign(window,{
    setView:()=>views.get('layers').restore({view:{x:36,y:32,zoom:2},tool:'select'}),
    editNodes:()=>views.get('layers').restore({view:{x:30,y:16,zoom:2},tool:'nodes'}),
    bar:()=>document.querySelector('[aria-label="选中对象排版"]'),choice:()=>bar()?.querySelector('.studio-select').dataset.value,
    button:label=>bar().querySelector('[aria-label="'+label+'"]'),press:label=>button(label).click(),
    x:id=>qa.doc.layers.find(l=>l.id===id).x,
    visible:()=>!!bar()&&getComputedStyle(bar()).visibility==='visible',
    inside:()=>{const b=bar().getBoundingClientRect(),s=document.querySelector('.layer-stage').getBoundingClientRect();return b.left>=s.left&&b.right<=s.right+1&&b.top>=s.top&&b.bottom<=s.bottom+1;},
    crop:()=>{const r=bar().getBoundingClientRect();return {x:Math.floor(r.x)-2,y:Math.floor(r.y)-2,width:Math.ceil(r.width)+4,height:Math.ceil(r.height)+4};},
    pickPoint:()=>{const s=document.querySelector('.layer-stage').getBoundingClientRect();return {x:Math.round(s.left+36+(x('a')+15)*2),y:Math.round(s.top+32+60*2)};}
  });
}
