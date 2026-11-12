// Load source modules at runtime for isolated interaction/pixel tests; no app build or user profile.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
process.env.ESBUILD_WORKER_THREADS='0';
const out=path.resolve(__dirname,'../test-results/line-tools');fs.mkdirSync(out,{recursive:true});app.setPath('userData',fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'tugou-lines-ui-')));
const report={checks:[],errors:[]};let w;
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);};
const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async s=>{for(let i=0;i<150;i++){if(await js(s))return;await delay(40);}throw Error('timeout: '+s);};
const click=async(label,selector='button')=>{await js(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('missing button '+${JSON.stringify(label)});b.click();})()`);await delay(90);};
const mouse=(type,p,extras={})=>w.webContents.sendInputEvent({type,x:Math.round(p.x),y:Math.round(p.y),...extras});
const drag=async(a,b,modifiers=[],cancel=false)=>{mouse('mouseMove',a);mouse('mouseDown',a,{button:'left',clickCount:1});for(let i=1;i<=6;i++){mouse('mouseMove',{x:a.x+(b.x-a.x)*i/6,y:a.y+(b.y-a.y)*i/6},{modifiers:['leftButtonDown',...modifiers]});await delay(25);}if(cancel){w.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await delay(50);}mouse('mouseUp',b,{button:'left',clickCount:1,modifiers});await delay(120);};
const bounds=selector=>js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
const center=async selector=>{const r=await bounds(selector);return{x:r.x+r.width/2,y:r.y+r.height/2};};
const shot=async name=>{
  await wait('!document.querySelector("canvas[aria-label=图层画布]")||document.querySelector("canvas[aria-label=图层画布]").dataset.rendering==="false"');
  const points=await js(`(()=>{const c=document.querySelector('canvas[aria-label=图层画布]');if(!c){const page=document.querySelector('.ppt-edit-page .ppt-stage');if(!page)return [];const r=page.getBoundingClientRect(),scale=r.width/1280;return qa.doc.presentations[0].slides[0].elements.map(l=>({x:r.x+(l.x+l.w*(l.linePoints[0]+l.linePoints[2])/2)*scale,y:r.y+(l.y+l.h*(l.linePoints[1]+l.linePoints[3])/2)*scale}));}const r=c.getBoundingClientRect(),t=document.querySelector('.layer-overlay>g').transform.baseVal.consolidate().matrix;return qa.doc.layers.map(l=>({x:r.x+t.e+(l.x+l.width*(l.linePoints[0]+l.linePoints[2])/2)*t.a,y:r.y+t.f+(l.y+l.height*(l.linePoints[1]+l.linePoints[3])/2)*t.d}));})()`);
  let screenshot,ready=false;
  for(let i=0;i<40;i++){
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');screenshot=await w.capturePage();const bitmap=screenshot.toBitmap(),{width}=screenshot.getSize();
    ready=points.every(p=>{for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++){const at=(Math.round(p.y+y)*width+Math.round(p.x+x))*4;if(bitmap[at+2]<220&&bitmap[at+3]>200)return true;}return false;});if(ready)break;await delay(50);
  }
  fs.writeFileSync(path.join(out,name+'.png'),screenshot.toPNG());if(name!=='failure')check(name+' screenshot contains rendered lines',ready);
};
app.whenReady().then(async()=>{
  w=new BrowserWindow({width:1440,height:960,show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,backgroundThrottling:false}});
  w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
  w.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}));
  try{
    await w.loadURL('file:///'+path.join(__dirname,'../renderer/index.html').replaceAll('\\','/'));
    await js(`require(${JSON.stringify(path.join(__dirname,'line-tools-renderer.cjs'))})`);w.showInactive();
    await wait('!!document.querySelector(".ppt-deck-card")');await click('打开 直线验收');await wait('!!document.querySelector(".ppt-edit-page .ppt-stage")');
    const screen=async(x,y)=>{const r=await bounds('.ppt-edit-page .ppt-stage');return{x:r.x+x*r.width/1280,y:r.y+y*r.width/1280};};
    await click('大纲');
    for(const [a,b,shift] of [[[180,160],[700,160],false],[[300,240],[300,580],false],[[900,200],[550,460],false],[[700,480],[950,525],true]]){
      await click('直线');await drag(await screen(...a),await screen(...b),shift?['shift']:[]);
    }
    const pptDoc=await js('qa.doc'),lines=pptDoc.presentations[0].slides[0].elements;report.pptDraw={count:lines.length,history:await js('qa.history.length')};check('PPT toolbar draws four lines as separate history operations',lines.length===4&&await js('qa.history.length===4'));
    const P=require('../core/presentations.cjs');const ends=lines.map(P.presentationLineEndpoints);
    check('horizontal and vertical PPT lines remain exact',Math.abs(ends[0][1].y-ends[0][0].y)<1&&Math.abs(ends[1][1].x-ends[1][0].x)<1);
    check('reverse PPT drag preserves direction',ends[2][0].x>ends[2][1].x&&ends[2][0].y<ends[2][1].y);
    check('PPT Shift constrains to horizontal',Math.abs(ends[3][0].y-ends[3][1].y)<1);
    const midpoint=await screen((ends[0][0].x+ends[0][1].x)/2,ends[0][0].y+4);mouse('mouseMove',midpoint);mouse('mouseDown',midpoint,{button:'left',clickCount:1});mouse('mouseUp',midpoint,{button:'left',clickCount:1});await delay(100);
    check('thin PPT line can be selected near its stroke without adding undo history',await js('qa.history.length===4&&document.querySelector(".ppt-edit-page .ppt-element.selected")?.dataset.elementId===qa.doc.presentations[0].slides[0].elements[0].id'));
    await click('图层');await js('document.querySelector(".ppt-layer-select").click()');await delay(80);
    let handle=await center('.ppt-edit-page [aria-label="直线起点"]');await drag(handle,{x:handle.x-70,y:handle.y-55});
    const changed=await js('qa.doc.presentations[0].slides[0].elements.at(-1)');const changedEnds=P.presentationLineEndpoints(changed);check('PPT endpoint editing leaves opposite end fixed',Math.hypot(changedEnds[1].x-ends[3][1].x,changedEnds[1].y-ends[3][1].y)<1);
    await click('撤销 PPT 修改');check('one undo restores endpoint edit',JSON.stringify(await js('qa.doc.presentations[0].slides[0].elements.at(-1)'))===JSON.stringify(lines[3]));await click('重做 PPT 修改');
    await click('直线');await drag(await screen(100,600),await screen(500,600),[],true);check('Escape cancels line creation without history',await js('qa.doc.presentations[0].slides[0].elements.length===4&&qa.history.length===5'));
    await js('document.querySelector(".ppt-layer-select").click()');await delay(80);await click('属性');await click('复制');check('PPT copy preserves line style and endpoints',await js('qa.doc.presentations[0].slides[0].elements.length===5'));await click('删除');check('PPT delete removes only selected line',await js('qa.doc.presentations[0].slides[0].elements.length===4'));
    await click('预览');await wait('!!document.querySelector(".ppt-player")');check('presentation player renders all lines',await js('document.querySelectorAll(".ppt-player .ppt-line-shape line").length===4'));await click('退出演示');
    await shot('ppt-light');await js('qa.theme("dark")');await delay(120);w.setSize(1060,780);await delay(120);await shot('ppt-dark');
    check('PPT line toolbar remains reachable in compact view',await js('(()=>{const n=[...document.querySelectorAll(".ppt-insert button")].find(n=>(n.getAttribute("aria-label")||n.textContent.trim())==="直线"),r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>0})()'));
    w.setSize(1440,960);await js('qa.mode("layers")');await wait('!!document.querySelector(".layer-stage")');await wait('document.querySelector("canvas[aria-label=图层画布]")?.dataset.rendering==="false"');
    const layerScreen=async(x,y)=>js(`(()=>{const s=document.querySelector('.layer-stage').getBoundingClientRect(),t=document.querySelector('.layer-overlay>g').transform.baseVal.consolidate().matrix;return {x:s.x+t.e+${x}*t.a,y:s.y+t.f+${y}*t.d};})()`);
    for(const [a,b] of [[[120,120],[650,120]],[[250,200],[250,520]],[[800,160],[450,400]]]){await click('形状','summary');await click('直线','.shape-picker-menu button');await drag(await layerScreen(...a),await layerScreen(...b));}
    check('layer picker creates visible lines and hides fill controls',await js('qa.doc.layers.length===3&&qa.doc.layers.every(l=>l.strokeWidth>0)&&!document.querySelector("[aria-label=启用形状填充]")&&!document.querySelector("[aria-label=形状填充开关]")'));
    const old=await js('qa.doc.layers.at(-1)');handle=await center('[data-handle="line-0"]');await drag(handle,{x:handle.x-50,y:handle.y+30});check('layer endpoint dragging changes geometry',JSON.stringify(await js('qa.doc.layers.at(-1).linePoints'))!==JSON.stringify(old.linePoints)||Math.abs((await js('qa.doc.layers.at(-1).width'))-old.width)>1);
    await js(`(()=>{const e=document.querySelector('[aria-label="描边宽度"]');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'6');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(90);await js(`(()=>{const e=document.querySelector('[aria-label="描边宽度"]');e.blur();e.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));})()`);await delay(90);check('selected layer line thickness is editable',await js('qa.doc.layers.at(-1).strokeWidth===6'));
    await click('形状','summary');await click('直线','.shape-picker-menu button');await drag(await layerScreen(100,600),await layerScreen(600,600),[],true);check('layer Escape leaves document intact',await js('qa.doc.layers.length===3'));
    await shot('layers-dark');report.livePixels=await js(`(()=>{const c=document.querySelector('canvas[aria-label=图层画布]'),t=document.querySelector('.layer-overlay>g').transform.baseVal.consolidate().matrix;return qa.doc.layers.map(l=>{const x=l.x+l.width*(l.linePoints[0]+l.linePoints[2])/2,y=l.y+l.height*(l.linePoints[1]+l.linePoints[3])/2;return {l,pixel:[...c.getContext('2d').getImageData((t.e+x*t.a)*c.width/c.clientWidth,(t.f+y*t.d)*c.height/c.clientHeight,1,1).data]};})})()`);check('all live layer lines are visible together',report.livePixels.every(p=>p.pixel[0]<220&&p.pixel[3]>200));await js('qa.theme("light")');await delay(120);await shot('layers-light');
    const pixels=await js('qa.pixels()');for(const [name,ok] of Object.entries(pixels))check(name,ok);
    check('no renderer errors',report.errors.length===0);
  }catch(e){report.failure=e.stack;console.error(e);if(w&&!w.isDestroyed())await shot('failure').catch(()=>{});}
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(report.failure?1:0);
});
setTimeout(()=>{console.error('line desktop test timeout');app.exit(1);},120000);
