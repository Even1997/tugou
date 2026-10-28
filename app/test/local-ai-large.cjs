const { app, nativeImage } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { ProjectStore } = require("../core/storage.cjs");
const { TaskQueue } = require("../core/tasks.cjs");
const { LocalAIService } = require("../core/local-ai.cjs");
const { ImageTaskService } = require("../core/image-tasks.cjs");
const { saveImage } = require("../core/generation.cjs");
const output = path.resolve(__dirname, "../test-results");
const report = { checks: [] };
let tasks;
app.setPath(
  "userData",
  path.join(os.tmpdir(), `tugou-ai-large-shell-${process.pid}`),
);
app
  .whenReady()
  .then(async () => {
    report.profile = await fs.mkdtemp(
      path.join(os.tmpdir(), "tugou-ai-large-"),
    );
    const store = new ProjectStore(path.join(report.profile, "workspace"));
    await store.init();
    tasks = new TaskQueue(store.root);
    await tasks.init();
    const inspect = (b) => nativeImage.createFromBuffer(b).getSize();
    const engine = new LocalAIService(store);
    const service = new ImageTaskService(store, tasks, inspect, null, engine);
    await engine.configure("D:/CanvasStudioRuntime");
    const r = await store.create("2K 超分验收");
    const asset = {
      id: "sample",
      name: "人物样图",
      ...(await saveImage(
        store.root,
        await fs.readFile(
          path.join(output, "local-ai-fixtures/transparent.png"),
        ),
        inspect,
      )),
    };
    const start = Date.now(),
      task = await service.start(
        r.id,
        { ...r.document, assets: [asset] },
        [asset.id],
        { operation: "upscale", model: "illustration", scale: 4 },
      );
    await tasks.execution;
    report.elapsedMs = Date.now() - start;
    const entry = tasks.list().find((t) => t.id === task.id);
    assert.equal(entry.status, "completed");
    report.checks.push("actual native 4x model completes");
    const result = JSON.parse(
      await fs.readFile(path.join(store.root, "results", task.id + ".json")),
    ).assets[0];
    assert.equal(result.width, 2048);
    assert.equal(result.height, 3072);
    report.checks.push("2048x3072 pixels persisted without resizing");
    report.asset = result;
    await fs.copyFile(
      path.join(store.root, "resources", result.resource),
      path.join(output, "local-ai-upscale-2k.png"),
    );
    const recovered = await saveImage(
      store.root,
      await fs.readFile(path.join(output, "local-ai-upscale-2k.png")),
      inspect,
    );
    assert.equal(recovered.resource, result.resource);
    report.checks.push(
      "full native PNG decodes and round-trips byte-identically",
    );
    await tasks.shutdown();
    await fs.writeFile(
      path.join(output, "local-ai-large.json"),
      JSON.stringify(report, null, 2),
    );
    app.exit(0);
  })
  .catch(async (e) => {
    report.failure = e.stack;
    if (tasks) {
      report.tasks = tasks.list();
      await tasks.shutdown();
    }
    await fs.writeFile(
      path.join(output, "local-ai-large.json"),
      JSON.stringify(report, null, 2),
    );
    app.exit(1);
  });
