const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { validateLocalSettings } = require("../core/local-ai.cjs");
const { runProcess } = require("../core/local-process.cjs");
const { applyResults, mergeResults } = require("../core/results.cjs");
const { TaskQueue } = require("../core/tasks.cjs");

test("AI settings use supported actual model scales and bound output pixels", () => {
  const size = { width: 1024, height: 1536 };
  assert.deepEqual(
    validateLocalSettings(
      { operation: "upscale", model: "anime", scale: 2, path: "../evil" },
      size,
    ),
    { operation: "upscale", model: "anime", scale: 2 },
  );
  assert.deepEqual(
    validateLocalSettings({ operation: "cutout", scale: 99 }, size),
    { operation: "cutout", model: "birefnet", edgeShrink: 0, edgeFeather: 0 },
  );
  for (const settings of [
    { operation: "bad" },
    ...[-1, 5, 0.5, NaN, '1'].map(edgeShrink => ({operation:'cutout',edgeShrink})),
    ...[-1, 5, NaN, Infinity, '1'].map(edgeFeather => ({operation:'cutout',edgeFeather})),
    { operation: "upscale", model: "general", scale: 2 },
    { operation: "upscale", model: "__proto__", scale: 4 },
    { operation: "upscale", model: "anime", scale: 0 },
  ])
    assert.throws(() => validateLocalSettings(settings, size));
  assert.throws(() =>
    validateLocalSettings(
      { operation: "upscale", model: "general", scale: 4 },
      { width: 3000, height: 3000 },
    ),
  );
});

test("local result is undoable without resurrection, remote outputs retain their prior history behavior", () => {
  const doc = {
    assets: [{ id: "source" }],
    name: "edited",
    unknown: { keep: true },
  };
  const history = {
    past: [{ ...doc, name: "earlier" }],
    future: [{ ...doc, name: "later" }],
  };
  const results = [
    { id: "remote", assets: [{ id: "generated" }] },
    { id: "local", kind: "local-tool", assets: [{ id: "processed" }] },
  ];
  const applied = applyResults(doc, history, results);
  assert.equal(applied.document.assets.length, 3);
  assert.equal(applied.document.tugouCanvas.nodes.length, 1);
  assert.equal(applied.history.past.length, 2);
  assert.equal(applied.history.future.length, 0);
  const undone = applied.history.past.at(-1);
  assert.deepEqual(
    undone.assets.map((a) => a.id),
    ["source", "generated"],
  );
  assert.deepEqual(mergeResults(undone, results), undone);
  assert.deepEqual(
    mergeResults(JSON.parse(JSON.stringify(undone)), results),
    undone,
  );
  assert.deepEqual(applied.document.unknown, doc.unknown);
  assert.deepEqual(
    history.past[0].assets,
    doc.assets,
    "history input is immutable",
  );
  assert.equal(
    applyResults(applied.document, applied.history, results).history.past
      .length,
    2,
  );
});

test("child abort stops owned process tree and timeout never returns success", async () => {
  const signal = new AbortController();
  let descendant;
  const start = Date.now();
  const running = runProcess(
    process.execPath,
    [
      "-e",
      'const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore",windowsHide:true}); console.log(c.pid);setInterval(()=>{},1000)',
    ],
    {
      signal: signal.signal,
      onLine: (line) => {
        descendant = Number(line);
        signal.abort();
      },
    },
  );
  await assert.rejects(running, (e) => e.name === "AbortError");
  assert.ok(Date.now() - start < 10000);
  assert.ok(descendant > 0);
  assert.throws(() => process.kill(descendant, 0));
  await assert.rejects(
    runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      timeout: 100,
    }),
    /超时/,
  );
  await assert.rejects(
    runProcess("tugou-does-not-exist", []),
    /本地组件运行失败/,
  );
});

test("local shutdown waits for child cleanup and preserves interruption without resubmitting", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tugou-ai-queue-"));
  const queue = new TaskQueue(root);
  await queue.init();
  let entered,
    cleaned = false;
  const ready = new Promise((r) => {
    entered = r;
  });
  const task = await queue.start(
    "local",
    async (signal) => {
      entered();
      await new Promise((r) =>
        signal.addEventListener(
          "abort",
          () =>
            setTimeout(() => {
              cleaned = true;
              r();
            }, 40),
          { once: true },
        ),
      );
    },
    { kind: "local-tool" },
  );
  await ready;
  await queue.shutdown();
  assert.equal(cleaned, true);
  assert.equal(queue.list()[0].status, "interrupted");
  const restarted = new TaskQueue(root);
  await restarted.init();
  assert.equal(restarted.list()[0].status, "interrupted");
  assert.equal(restarted.controllers.size, 0);
  await task.completion;
});

test("closing immediately after cancellation waits for the already-started native cleanup", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "tugou-ai-cancel-close-"),
  );
  const queue = new TaskQueue(root);
  await queue.init();
  let entered,
    cleaned = false;
  const ready = new Promise((r) => {
    entered = r;
  });
  const task = await queue.start(
    "native",
    async (signal) => {
      entered();
      await new Promise((r) =>
        signal.addEventListener(
          "abort",
          () =>
            setTimeout(() => {
              cleaned = true;
              r();
            }, 100),
          { once: true },
        ),
      );
    },
    { kind: "local-tool" },
  );
  await ready;
  await queue.cancel(task.id);
  await queue.shutdown();
  assert.equal(
    cleaned,
    true,
    "window closure must wait for native child cleanup even after cancellation",
  );
  assert.equal(queue.list()[0].status, "cancelled");
  await task.completion;
});
