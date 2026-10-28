const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../test-results"),
  operation =
    process.argv.find((a) => a.startsWith("--operation="))?.split("=")[1] ||
    "alpha",
  restart = process.argv.includes('--restart'),
  prior = restart ? JSON.parse(fs.readFileSync(path.join(output,'local-tools-'+operation+'-large.json'),'utf8')) : null,
  profile = prior?.profile || fs.mkdtempSync(path.join(os.tmpdir(), "tugou-local-large-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR = path.join(output, "local-tools-build");
const report = { profile, operation, checks: [], errors: [], memory: [] },
  finish = (code) => {
    fs.writeFileSync(
      path.join(output, "local-tools-" + operation + (restart ? '-large-restart.json' : '-large.json')),
      JSON.stringify(report, null, 2),
    );
    app.exit(code);
  };
const timer = setTimeout(() => {
  report.failure = "Timed out";
  finish(1);
}, 240000);
app.on("browser-window-created", (_, window) => {
  window.show = () => {};
  window.focus = () => {};
  window.webContents.setBackgroundThrottling(false);
  window.webContents.on("console-message", (_, d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
  window.webContents.on("render-process-gone", (_, d) => {
    report.failure = "Renderer gone: " + JSON.stringify(d);
    finish(1);
  });
  window.webContents.once("did-finish-load", async () => {
    let sampler;
    try {
      const js = (code) => window.webContents.executeJavaScript(code, true),
        check = (name, ok) => {
          assert.ok(ok, name);
          report.checks.push(name);
        };
      await js(
        fs.readFileSync(path.join(output, "local-tools-engine-qa.js"), "utf8") +
          ";void 0;",
      );
      sampler = setInterval(() => {
        for (const m of app.getAppMetrics()) {
          const old = report.memory.find((p) => p.pid === m.pid);
          if (old)
            old.peakKiB = Math.max(old.peakKiB, m.memory.peakWorkingSetSize);
          else
            report.memory.push({
              pid: m.pid,
              type: m.type,
              peakKiB: m.memory.peakWorkingSetSize,
            });
        }
      }, 100);
      if (restart) {
        report.id=prior.id;
        const record=await js(`tugou.open(${JSON.stringify(prior.id)})`),asset=record.document.assets[1];
        check('new process restores original and result resources',record.document.assets[0].resource===prior.result.input.resource&&asset.resource===prior.result.output.resource);
        const samples=await js(`(async()=>{const img=await toolsQA.loadOriginal(${JSON.stringify(asset)}),c=toolsQA.surface(1,1),x=c.getContext('2d',{willReadFrequently:true}),values=[];for(const [px,py] of [[0,0],[511,512],[512,512],[1000,1000],[5000,5000],[9999,9999]]){x.clearRect(0,0,1,1);x.drawImage(img,px,py,1,1,0,0,1,1);values.push([...x.getImageData(0,0,1,1).data]);}const result={width:img.naturalWidth,height:img.naturalHeight,values};img.src='';return result;})()`);
        check('new process decodes 100MP without downsampling',samples.width===10000&&samples.height===10000);
        check('new process restores identical sampled pixels',JSON.stringify(samples.values)===JSON.stringify(prior.result.samples));
      } else if (operation === "sample") {
        const file = process.env.TUGOU_TOOLS_SAMPLE;
        if (!file) throw Error("Sample file required");
        const source = {
          dataUrl:
            "data:image/png;base64," + fs.readFileSync(file).toString("base64"),
        };
        const result = await js(`toolsQA.sample(${JSON.stringify(source)})`);
        fs.writeFileSync(
          path.join(output, "local-tools-wedding.png"),
          Buffer.from(result.bytes),
        );
        delete result.bytes;
        report.result = result;
        check(
          "sample inner alpha processing never increases coverage",
          result.outputs[0].alphaIncreased === 0,
        );
        check(
          "sample lighting and LUT preserve every alpha",
          result.outputs.slice(1).every((o) => o.alphaDiff === 0),
        );
      } else {
        report.result = await js(
          `toolsQA.large(${JSON.stringify(operation)}).catch(e=>({error:String(e),message:e.message,stack:e.stack,name:e.name}))`,
        );
        if (report.result.error) throw Error(JSON.stringify(report.result));
        const r = report.result;
        check(
          "100MP output keeps requested dimensions",
          r.output.width === 10000 && r.output.height === 10000,
        );
        if (operation === "alpha")
          check(
            "100MP alpha keeps interior and clears border",
            r.samples[0][3] === 0 &&
              r.samples[3].join() === "64,128,192,255" &&
              r.samples[4].join() === "64,128,192,255",
          );
        if (operation === "lut")
          check(
            "100MP LUT changes channels at both tile sides",
            r.samples[3].join() === "191,127,63,255" &&
              r.samples[4].join() === "191,127,63,255",
          );
        if (operation === "light")
          check(
            "100MP light changes center and protects outer corner",
            r.samples[0].join() === "64,128,192,255" &&
              r.samples[4][0] > 64 &&
              r.samples[4][3] === 255,
          );
        if (operation === "pattern")
          check(
            "100MP pattern repeats without seams",
            r.samples.every((p,i) => p.join() === ([0,3,5].includes(i) ? "64,128,192,255" : "0,0,0,0")),
          );
        check(
          "renderer remains responsive while worker computes",
          r.ticks > 0 && r.maxHeartbeat < 1000,
        );
        const record = await js("tugou.create()");
        report.id = record.id;
        await js(
          `tugou.save(${JSON.stringify(record.id)},${JSON.stringify({ ...record.document, assets: [r.input, r.output], imageToolTest: { operation, settings: r.settings } })},${record.revision})`,
        );
        const restored = await js(`tugou.open(${JSON.stringify(record.id)})`);
        check(
          "large result and source persist in project",
          restored.document.assets.length === 2 &&
            restored.document.assets[1].resource === r.output.resource,
        );
      }
      check("test window never shown", !window.isVisible());
      check("no renderer errors", report.errors.length === 0);
      clearInterval(sampler);
      clearTimeout(timer);
      finish(0);
    } catch (e) {
      report.failure = e?.stack || String(e);
      clearInterval(sampler);
      clearTimeout(timer);
      finish(1);
    }
  });
});
require("../main.cjs");
