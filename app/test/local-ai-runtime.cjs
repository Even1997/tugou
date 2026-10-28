const { app, nativeImage } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { ProjectStore, hash } = require("../core/storage.cjs");
const { TaskQueue } = require("../core/tasks.cjs");
const { LocalAIService } = require("../core/local-ai.cjs");
const { ImageTaskService } = require("../core/image-tasks.cjs");
const { GenerationService, saveImage } = require("../core/generation.cjs");
const { runProcess } = require("../core/local-process.cjs");
const output = path.resolve(__dirname, "../test-results");
const report = {
  checks: [],
  timings: {},
  outputs: [],
  platform: process.platform,
};
let tasks;
app.setPath(
  "userData",
  path.join(os.tmpdir(), `tugou-ai-runtime-shell-${process.pid}`),
);
app
  .whenReady()
  .then(async () => {
    report.profile = await fs.mkdtemp(
      path.join(os.tmpdir(), "tugou-ai-runtime-"),
    );
    const root = path.join(report.profile, "workspace"),
      store = new ProjectStore(root);
    await store.init();
    tasks = new TaskQueue(root);
    await tasks.init();
    const inspect = (b) => nativeImage.createFromBuffer(b).getSize();
    const engine = new LocalAIService(store);
    const service = new ImageTaskService(store, tasks, inspect, null, engine);
    const check = (name, v) => {
      assert.ok(v, name);
      report.checks.push(name);
    };
    const runtime = await engine.configure("D:/CanvasStudioRuntime");
    report.runtime = runtime;
    check(
      "installed pinned cutout and three native models available",
      runtime.cutout && runtime.models.length === 3,
    );
    const r = await store.create("本地 AI 隔离验收");
    const assets = [];
    for (const name of ["small", "white", "gray", "pattern", "transparent"]) {
      const b = await fs.readFile(
        path.join(output, "local-ai-fixtures", `${name}.png`),
      );
      assets.push({ id: name, name, ...(await saveImage(root, b, inspect)) });
    }
    const doc = { ...r.document, assets, unknown: { keep: true } };
    await store.save(r.id, doc, r.revision);
    const initial = JSON.stringify(doc),
      sourceHashes = assets.map((a) => a.resource);
  for (const model of ["anime", "general", "illustration"]) {
      const start = Date.now();
      const task = await service.start(r.id, doc, ["small"], {
        operation: "upscale",
        model,
        scale: model === "anime" ? 2 : 4,
      });
      await tasks.execution;
      const entry = tasks.list().find((t) => t.id === task.id);
      check(
        `${model} actual native task completes`,
        entry.status === "completed",
      );
      const result = JSON.parse(
        await fs.readFile(path.join(root, "results", `${task.id}.json`)),
      );
      const a = result.assets[0];
      const target = path.join(output, `local-ai-upscale-${model}.png`);
      await fs.copyFile(path.join(root, "resources", a.resource), target);
      check(
        `${model} true output dimensions`,
        a.width === 96 * (model === "anime" ? 2 : 4) &&
          a.height === 144 * (model === "anime" ? 2 : 4),
      );
      report.timings[model] = Date.now() - start;
      report.outputs.push({ name: model, path: target, ...a });
    }
    for (const name of ["white", "gray", "pattern", "transparent"]) {
      const start = Date.now();
      const task = await service.start(r.id, doc, [name], {
        operation: "cutout",
      });
      await tasks.execution;
      const entry = tasks.list().find((t) => t.id === task.id);
      report.lastTask = entry;
      check(`${name} actual ONNX task completes`, entry.status === "completed");
      const result = JSON.parse(
        await fs.readFile(path.join(root, "results", `${task.id}.json`)),
      );
      const target = path.join(output, `local-ai-cutout-${name}.png`);
      await fs.copyFile(
        path.join(root, "resources", result.assets[0].resource),
        target,
      );
      report.outputs.push({ name, path: target, ...result.assets[0] });
      report.timings[name] = Date.now() - start;
    }
    check("input document never mutated", JSON.stringify(doc) === initial);
    for (const [i, a] of assets.entries())
      check(
        `${a.id} source bytes unchanged`,
        hash(await fs.readFile(path.join(root, "resources", a.resource))) ===
          sourceHashes[i].split(".")[0],
      );
    const cancel = await service.start(r.id, doc, ["white"], {
      operation: "cutout",
    });
    for (
      let i = 0;
      i < 100 &&
      !tasks
        .list()
        .find((t) => t.id === cancel.id)
        .message?.includes("加载");
      i++
    )
      await new Promise((r) => setTimeout(r, 100));
    const at = Date.now();
    await tasks.cancel(cancel.id);
    await tasks.execution;
    report.timings.cancel = Date.now() - at;
    check(
      "running model cancellation discards output",
      tasks.list().find((t) => t.id === cancel.id).status === "cancelled",
    );
    check(
      "cancelled job has no result",
      !(await fs.readdir(path.join(root, "results"))).includes(
        cancel.id + ".json",
      ),
    );
    check(
      "owned job temporary files cleaned",
      (await fs.readdir(path.join(root, "local-jobs"))).length === 0,
    );
    // Recover a committed result journal after a simulated interrupted task marker.
    const entry = tasks.tasks[0];
    entry.status = "interrupted";
    delete entry.resultId;
    await tasks.persist();
    const restored = new TaskQueue(root);
    await restored.init();
    const generation = new GenerationService(store, {}, restored, inspect);
    await generation.recover();
    check(
      "committed local result recovered without inference",
      restored.list()[0].status === "completed",
    );
    check(
      "cancelled local task not recovered",
      restored.list().find((t) => t.id === cancel.id).status === "cancelled",
    );
    check(
      "all completed tools available via shared results IPC service",
      (await generation.results(r.id)).length === 7,
    );
    await tasks.shutdown();
    await fs.writeFile(
      path.join(output, "local-ai-runtime.json"),
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
      path.join(output, "local-ai-runtime.json"),
      JSON.stringify(report, null, 2),
    );
    app.exit(1);
  });
