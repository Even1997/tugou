const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { ProjectStore } = require("../core/storage.cjs");
const { TaskQueue } = require("../core/tasks.cjs");
const { ImageTaskService } = require("../core/image-tasks.cjs");
const { LocalAIService } = require("../core/local-ai.cjs");
const { saveImage } = require("../core/generation.cjs");
function png(width, height) {
  const b = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tugou-ai-batch-unit-")),
    projects = new ProjectStore(root);
  await projects.init();
  const tasks = new TaskQueue(root);
  await tasks.init();
  // Dimension headers exercise transaction boundaries; desktop tests decode actual model-produced PNGs.
  const inspect = (b) => ({
      width: b.readUInt32BE(16),
      height: b.readUInt32BE(20),
    }),
    r = await projects.create("AI 批量");
  const document = {
    ...r.document,
    assets: [
      { id: "a", name: "A", ...(await saveImage(root, png(2, 3), inspect)) },
      { id: "b", name: "B", ...(await saveImage(root, png(3, 2), inspect)) },
    ],
    future: { keep: true },
  };
  const engine = new LocalAIService(projects),
    events = [];
  let current = {
    folder: path.resolve(root, "runtime-first"),
    provider: "CPUExecutionProvider",
  };
  engine.resolveRuntime = async (settings, snapshot) => ({
    ...(snapshot || current),
  });
  engine.processInput = async (input, settings, runtime, signal, id, stage) => {
    signal.throwIfAborted();
    events.push({
      id: input.id,
      settings: { ...settings },
      runtime: { ...runtime },
    });
    stage("执行测试适配器");
    return png(
      input.width * (settings.scale || 1),
      input.height * (settings.scale || 1),
    );
  };
  const service = new ImageTaskService(projects, tasks, inspect, null, engine);
  return {
    root,
    projects,
    tasks,
    r,
    document,
    engine,
    events,
    service,
    configure: (v) => {
      current = v;
    },
    result: async (id) =>
      JSON.parse(await fs.readFile(path.join(root, "results", id + ".json"))),
  };
}
test("AI batch snapshots parameters and selected runtime, completes ordered full-size output", async () => {
  const f = await fixture(),
    settings = {
      operation: "upscale",
      model: "anime",
      scale: 3,
      apiKey: "never-persist",
      path: "outside",
    };
  const task = await f.service.start(f.r.id, f.document, ["a", "b"], settings);
  settings.scale = 2;
  f.document.assets[0].name = "edited";
  f.configure({ folder: "different", provider: "other" });
  await f.tasks.execution;
  assert.equal(f.tasks.tasks[0].status, "completed");
  const result = await f.result(task.id);
  assert.deepEqual(
    result.assets.map((a) => [a.width, a.height]),
    [
      [6, 9],
      [9, 6],
    ],
  );
  assert.deepEqual(
    f.events.map((e) => e.id),
    ["a", "b"],
  );
  assert.ok(f.events.every((e) => e.runtime.folder.endsWith("runtime-first")));
  assert.ok(
    result.assets.every(
      (a) => a.toolResult.scale === 3 && a.toolResult.batchId === task.id,
    ),
  );
  const text = await fs.readFile(
    path.join(
      f.root,
      "requests",
      "tool-" + f.tasks.tasks[0].context.requestId + ".json",
    ),
    "utf8",
  );
  assert.ok(!text.includes("never-persist") && !text.includes("outside"));
  assert.equal(JSON.parse(text).inputs[0].name, "A");
});
test("all AI members and runtime validate before queueing", async () => {
  const f = await fixture();
  await assert.rejects(
    f.service.start(f.r.id, f.document, ["a", "missing"], {
      operation: "upscale",
      model: "anime",
      scale: 2,
    }),
    /原图/,
  );
  await assert.rejects(
    f.service.start(f.r.id, f.document, ["a", "b"], {
      operation: "upscale",
      model: "general",
      scale: 2,
    }),
    /倍率/,
  );
  f.engine.resolveRuntime = async () => {
    throw Error("模型缺失");
  };
  await assert.rejects(
    f.service.start(f.r.id, f.document, ["a", "b"], { operation: "cutout" }),
    /模型缺失/,
  );
  assert.equal(f.tasks.tasks.length, 0);
  assert.equal(f.events.length, 0);
});
test("AI partial failure publishes nothing and retry uses original runtime after configuration and library changes", async () => {
  const f = await fixture(),
    real = f.engine.processInput;
  let fail = true;
  f.engine.processInput = async (...args) => {
    if (args[0].id === "b" && fail) throw Error("second failed");
    return real(...args);
  };
  const first = await f.service.start(f.r.id, f.document, ["a", "b"], {
    operation: "upscale",
    model: "anime",
    scale: 2,
  });
  await f.tasks.execution;
  assert.equal(f.tasks.tasks[0].status, "failed");
  await assert.rejects(f.result(first.id), { code: "ENOENT" });
  f.configure({ folder: "changed", provider: "changed" });
  f.document.assets = [];
  fail = false;
  const next = await f.service.retry(first.id);
  await f.tasks.execution;
  const result = await f.result(next.id);
  assert.equal(result.assets.length, 2);
  assert.ok(f.events.every((e) => e.runtime.folder.endsWith("runtime-first")));
  assert.equal(f.tasks.tasks[1].context.retriedFrom, first.id);
});
test("AI cancellation between inputs prevents publication and shutdown preserves cancellation", async () => {
  const f = await fixture(),
    real = f.engine.processInput;
  let ready;
  const entered = new Promise((r) => (ready = r));
  f.engine.processInput = async (...args) => {
    if (args[0].id === "b") {
      ready();
      await new Promise((r) =>
        args[3].addEventListener("abort", r, { once: true }),
      );
      args[3].throwIfAborted();
    }
    return real(...args);
  };
  const task = await f.service.start(f.r.id, f.document, ["a", "b"], {
    operation: "cutout",
    scale: 99,
  });
  await entered;
  await f.tasks.cancel(task.id);
  await f.tasks.shutdown();
  await f.tasks.execution;
  assert.equal(f.tasks.tasks[0].status, "cancelled");
  await assert.rejects(f.result(task.id), { code: "ENOENT" });
  assert.deepEqual(f.events[0].settings, { operation: "cutout" });
});
test("AI incorrect output size is rejected and unavailable snapshot runtime prevents retry", async () => {
  const f = await fixture();
  f.engine.processInput = async () => png(1, 1);
  const task = await f.service.start(f.r.id, f.document, ["a"], {
    operation: "upscale",
    model: "anime",
    scale: 2,
  });
  await f.tasks.execution;
  assert.equal(f.tasks.tasks[0].status, "failed");
  assert.match(f.tasks.tasks[0].message, /尺寸异常/);
  await assert.rejects(f.result(task.id), { code: "ENOENT" });
  f.engine.resolveRuntime = async () => {
    throw Error("original runtime missing");
  };
  await assert.rejects(f.service.retry(task.id), /original runtime missing/);
  assert.equal(f.tasks.tasks.length, 1);
});
test("AI cutout batch retains dimensions and validates every output before publication", async () => {
  const f = await fixture(),
    task = await f.service.start(f.r.id, f.document, ["a", "b"], {
      operation: "cutout",
      model: "ignored",
      scale: 4,
    });
  await f.tasks.execution;
  const result = await f.result(task.id);
  assert.deepEqual(
    result.assets.map((a) => [a.width, a.height]),
    [
      [2, 3],
      [3, 2],
    ],
  );
  assert.ok(
    f.events.every((e) => Object.keys(e.settings).join() === "operation"),
  );
});
