const { app } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
if (!require('./qa-paths.cjs').inside(process.env.TUGOU_DATA_DIR))
  throw new Error("QA profile required");
const out = path.resolve(__dirname, "../test-results"),
  report = {},
  timer = setTimeout(() => app.exit(1), 90000);
app.on("browser-window-created", (_event, window) =>
  window.webContents.once("did-finish-load", async () => {
    const js = (code) => window.webContents.executeJavaScript(code, true);
    try {
      const prior = JSON.parse(
        await fs.readFile(path.join(out, "advanced-desktop.json"), "utf8"),
      );
      const record = await js(
        `window.tugou.open(${JSON.stringify(prior.projectId)})`,
      );
      assert.deepEqual(record.document, prior.savedDocument);
      report.allDocumentFieldsEqualAfterRestart = true;
      await js(
        (await fs.readFile(path.join(out, "layer-engine-qa.js"), "utf8")) +
          ";void 0;",
      );
      report.selection = await js(
        `(async()=>{const {Selection:S,Compositor}=window.layerQA,engine=new Compositor(),mask=await S.selectionCanvas(${JSON.stringify(record.document)},engine),a=S.alphaOf(mask);engine.dispose();return{selected:a[30*256+30],disconnected:a[30*256+170],background:a[100*256+100]};})()`,
      );
      assert.deepEqual(report.selection, {
        selected: 255,
        disconnected: 255,
        background: 0,
      });
      report.performance = await js(`(async()=>{
      const S=window.layerQA.Selection,width=4096,height=4096,rgba=new Uint8Array(width*height*4);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;rgba[i]=x<2048?255:0;rgba[i+3]=255;}
      let beats=0;const interval=setInterval(()=>beats++,16),start=performance.now();
      const alpha=await S.calculateSelection({rgba,width,height,x:100,y:100,tolerance:0,contiguous:true,operation:'replace'});
      const wandMs=performance.now()-start, wandCorrect=alpha[100*width+100]===255&&alpha[100*width+3000]===0;
      const growStart=performance.now(),grown=await S.calculateSelection({alpha,width,height,radius:5});
      const growMs=performance.now()-growStart,growCorrect=grown[100*width+2052]===255&&grown[100*width+2053]===0;
      const controller=new AbortController(),cancelStart=performance.now();
      const pending=S.calculateSelection({alpha:grown,width,height,radius:20},controller.signal);setTimeout(()=>controller.abort(),10);
      let cancelled=false;try{await pending;}catch(e){cancelled=e.name==='AbortError';}
      clearInterval(interval);return{width,height,wandMs,growMs,beats,wandCorrect,growCorrect,cancelled,cancelMs:performance.now()-cancelStart};
    })()`);
      assert.ok(
        report.performance.wandCorrect &&
          report.performance.growCorrect &&
          report.performance.cancelled,
      );
      assert.ok(
        report.performance.beats > 2,
        "renderer remains responsive during worker computation",
      );
      assert.ok(
        report.performance.cancelMs < 1000,
        "cancellation completes promptly",
      );
      await fs.writeFile(
        path.join(out, "advanced-restart.json"),
        JSON.stringify(report, null, 2),
      );
      clearTimeout(timer);
      await js('window.tugou.window("close")');
    } catch (error) {
      report.failure = error.stack;
      await fs.writeFile(
        path.join(out, "advanced-restart.json"),
        JSON.stringify(report, null, 2),
      );
      clearTimeout(timer);
      app.exit(1);
    }
  }),
);
require("../main.cjs");
