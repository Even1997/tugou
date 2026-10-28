const { app } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { createHash } = require("node:crypto");
if (!require('./qa-paths.cjs').inside(process.env.TUGOU_DATA_DIR))
  throw new Error("QA profile required");
const timer = setTimeout(() => app.exit(1), 20000),
  out = path.resolve(__dirname, "../test-results");
app.on("browser-window-created", (_event, window) =>
  window.webContents.once("did-finish-load", async () => {
    try {
      const js = (code) => window.webContents.executeJavaScript(code, true);
      const prior = JSON.parse(
        await fs.readFile(path.join(out, "layers-desktop.json"), "utf8"),
      );
      const record = await js(
        `window.tugou.open(${JSON.stringify(prior.projectId)})`,
      );
      assert.deepEqual(record.document, prior.savedDocument);
      await js(
        (await fs.readFile(path.join(out, "layer-engine-qa.js"), "utf8")) +
          ";void 0;",
      );
      const pixels = await js(
        `(async()=>{const c=new window.layerQA.Compositor(),out=document.createElement('canvas');await c.render(${JSON.stringify(record.document)},out,{scale:.25});const data=[...out.getContext('2d').getImageData(0,0,out.width,out.height).data];c.dispose();return data;})()`,
      );
      const before = await fs.readFile(path.join(out, "layers-saved.rgba"));
      for (const [name, rgba] of [
        ["before", before],
        ["after", pixels],
      ]) {
        const png = await js(
          `(()=>{const c=document.createElement('canvas');c.width=256;c.height=384;const ctx=c.getContext('2d');ctx.putImageData(new ImageData(new Uint8ClampedArray(${JSON.stringify([...rgba])}),256,384),0,0);return c.toDataURL().split(',')[1];})()`,
        );
        await fs.writeFile(
          path.join(out, `layers-restart-${name}.png`),
          Buffer.from(png, "base64"),
        );
      }
      let max = 0,
        differing = 0;
      for (let i = 0; i < pixels.length; i++) {
        max = Math.max(max, Math.abs(pixels[i] - before[i]));
        if (pixels[i] !== before[i]) differing++;
      }
      await fs.writeFile(
        path.join(out, "layers-restart-pixels.json"),
        JSON.stringify({
          max,
          differing,
          sameHash:
            createHash("sha256").update(Buffer.from(pixels)).digest("hex") ===
            prior.savedPixelHash,
        }),
      );
      assert.ok(
        max <= 3,
        `Restart pixel difference ${max}, differing channels ${differing}`,
      );
      await fs.writeFile(
        path.join(out, "layers-restart.json"),
        JSON.stringify(
          {
            actualProcessRestart: true,
            allDocumentFieldsEqual: true,
            compositePixelMaxError: max,
            compositeDifferingChannels: differing,
            layers: record.document.layers.length,
            assets: record.document.assets.length,
            maskAndPerspectiveRestored: true,
            guidesRestored: true,
          },
          null,
          2,
        ),
      );
      clearTimeout(timer);
      await js('window.tugou.window("close")');
    } catch (error) {
      await fs.writeFile(
        path.join(out, "layers-restart.json"),
        JSON.stringify({ failure: error.stack }),
      );
      clearTimeout(timer);
      app.exit(1);
    }
  }),
);
require("../main.cjs");
