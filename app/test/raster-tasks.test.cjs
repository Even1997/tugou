const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { ProjectStore, atomicWrite } = require("../core/storage.cjs");
const { TaskQueue } = require("../core/tasks.cjs");
const { ImageTaskService } = require("../core/image-tasks.cjs");
const { GenerationService, saveImage } = require("../core/generation.cjs");
const { applyResults, mergeResults } = require("../core/results.cjs");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function fixture(execute) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tugou-raster-unit-")),
    projects = new ProjectStore(root);
  await projects.init();
  const q = new TaskQueue(root);
  await q.init();
  // Storage/transaction tests use a dimension-inspection stub; actual PNG decoding is covered by desktop tests.
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  const inspect = () => ({ width: 1, height: 1 }),
    image = await saveImage(root, bytes, inspect),
    r = await projects.create("事务测试");
  const document = {
    ...r.document,
    assets: [
      { id: "a", name: "A", ...image },
      { id: "b", name: "B", ...image },
    ],
    future: { keep: true },
  };
  await projects.save(r.id, document, r.revision);
  return {
    root,
    projects,
    q,
    bytes,
    inspect,
    id: r.id,
    document,
    service: new ImageTaskService(projects, q, inspect, execute),
  };
}
test("batch commits complete ordered results from immutable whitelisted snapshots", async () => {
  let captured;
  const f = await fixture(async (job, signal, part, progress) => {
    captured = job;
    progress(20);
    for (let i = 0; i < job.inputs.length; i++)
      await part({ inputIndex: i, index: 0, count: 1, bytes: f.bytes });
  });
  const r = await f.service.start(f.id, f.document, ["a", "b"], {
    operation: "mirror",
    unsafePath: "outside",
    apiKey: "not-a-real-secret",
  });
  f.document.assets[0].name = "changed later";
  await f.q.execution;
  assert.equal(f.q.tasks[0].status, "completed");
  assert.equal(f.q.tasks[0].progress, 100);
  assert.equal(captured.inputs[0].name, "A");
  assert.deepEqual(captured.settings, { operation: "mirror" });
  const result = JSON.parse(
    await fs.readFile(path.join(f.root, "results", r.id + ".json")),
  );
  assert.equal(result.assets.length, 2);
  assert.equal(new Set(result.assets.map((a) => a.id)).size, 2);
  assert.ok(result.assets.every((a) => a.toolResult.batchId === r.id));
  const saved = await f.projects.read(f.id);
  assert.equal(saved.document.assets.length, 2);
  assert.equal(saved.document.future.keep, true);
  const applied = applyResults(saved.document, { past: [], future: [] }, [
    result,
  ]);
  assert.equal(applied.document.assets.length, 4);
  assert.equal(applied.history.past.length, 1);
  assert.equal(
    mergeResults(applied.history.past[0], [result]).assets.length,
    2,
  );
});
test("batch rejects invalid members before queueing and detects duplicate active requests", async () => {
  const entered = deferred(),
    release = deferred();
  const f = await fixture(async (job, signal, part) => {
    entered.resolve();
    await release.promise;
    for (let i = 0; i < job.inputs.length; i++)
      await part({ inputIndex: i, index: 0, count: 1, bytes: f.bytes });
  });
  await assert.rejects(
    f.service.start(f.id, f.document, ["a", "missing"], {
      operation: "mirror",
    }),
  );
  assert.equal(f.q.tasks.length, 0);
  await assert.rejects(
    f.service.start(f.id, f.document, ["a", "a"], { operation: "mirror" }),
  );
  await assert.rejects(
    f.service.start(f.id, f.document, ["a"], { operation: "__proto__" }),
  );
  await f.service.start(f.id, f.document, ["a"], { operation: "mirror" });
  await entered.promise;
  await assert.rejects(
    f.service.start(f.id, f.document, ["a"], { operation: "mirror" }),
    /相同/,
  );
  release.resolve();
  await f.q.execution;
});
test("partial failure publishes no result and retry uses original job snapshot", async () => {
  let attempt = 0;
  const f = await fixture(async (job, signal, part) => {
    attempt++;
    await part({ inputIndex: 0, index: 0, count: 1, bytes: f.bytes });
    if (attempt === 1) throw Error("第二张失败");
    await part({ inputIndex: 1, index: 0, count: 1, bytes: f.bytes });
  });
  const first = await f.service.start(f.id, f.document, ["a", "b"], {
    operation: "mirror",
  });
  await f.q.execution;
  assert.equal(f.q.tasks[0].status, "failed");
  await assert.rejects(
    fs.stat(path.join(f.root, "results", first.id + ".json")),
    { code: "ENOENT" },
  );
  const current = await f.projects.read(f.id);
  await f.projects.save(
    f.id,
    { ...current.document, assets: [], future: { keep: true, edited: true } },
    current.revision,
  );
  const retry = await f.service.retry(first.id);
  await f.q.execution;
  assert.equal(f.q.tasks[1].status, "completed");
  assert.equal(f.q.tasks[1].context.retriedFrom, first.id);
  const r = JSON.parse(
    await fs.readFile(path.join(f.root, "results", retry.id + ".json")),
  );
  assert.deepEqual(
    r.assets.map((a) => a.toolResult.source.name),
    ["A", "B"],
  );
  await assert.rejects(f.service.retry(retry.id), /只有/);
});
test("cancel plus shutdown preserves cancellation and never recovers a cancelled journal", async () => {
  const entered = deferred(),
    release = deferred();
  const f = await fixture(async (job, signal, part) => {
    await part({ inputIndex: 0, index: 0, count: 1, bytes: f.bytes });
    entered.resolve();
    await release.promise;
    signal.throwIfAborted();
  });
  const r = await f.service.start(f.id, f.document, ["a"], {
    operation: "mirror",
  });
  await entered.promise;
  await f.q.cancel(r.id);
  // Model a cancellation racing a fully durable result write. Cancelled status must still win.
  await atomicWrite(
    path.join(f.root, "results", r.id + ".json"),
    JSON.stringify({
      id: r.id,
      projectId: f.id,
      kind: "local-tool",
      assets: [f.document.assets[0]],
    }),
  );
  const shutdown = f.q.shutdown();
  release.resolve();
  await shutdown;
  assert.equal(f.q.tasks[0].status, "cancelled");
  const restored = new TaskQueue(f.root);
  await restored.init();
  const generation = new GenerationService(
    f.projects,
    null,
    restored,
    f.inspect,
  );
  await generation.recover();
  assert.equal(restored.tasks[0].status, "cancelled");
  assert.deepEqual(await generation.results(f.id), []);
});
test("restart restores a full durable batch once but leaves incomplete work interrupted", async () => {
  const f = await fixture(async (job, signal, part) => {
    await part({ inputIndex: 0, index: 0, count: 1, bytes: f.bytes });
  });
  const r = await f.service.start(f.id, f.document, ["a"], {
    operation: "mirror",
  });
  await f.q.execution;
  f.q.tasks[0].status = "running";
  await f.q.persist();
  const recovered = new TaskQueue(f.root);
  await recovered.init();
  const generation = new GenerationService(
    f.projects,
    null,
    recovered,
    f.inspect,
  );
  await generation.recover();
  assert.equal(recovered.tasks[0].status, "completed");
  assert.equal((await generation.results(f.id))[0].id, r.id);
  const result = (await generation.results(f.id))[0],
    applied = applyResults(f.document, { past: [], future: [] }, [result]);
  assert.equal(
    mergeResults(JSON.parse(JSON.stringify(applied.history.past[0])), [result])
      .assets.length,
    2,
  );
});
test("malformed or missing output groups never publish partial batches", async () => {
  for (const parts of [
    [],
    [{ inputIndex: 1, index: 0, count: 1 }],
    [{ inputIndex: 0, index: 0, count: 2 }],
    [{ inputIndex: 0, index: 1, count: 1 }],
  ]) {
    const f = await fixture(async (job, signal, emit) => {
      for (const p of parts) await emit({ ...p, bytes: f.bytes });
    });
    const r = await f.service.start(f.id, f.document, ["a"], {
      operation: "mirror",
    });
    await f.q.execution;
    assert.equal(f.q.tasks[0].status, "failed");
    await assert.rejects(
      fs.stat(path.join(f.root, "results", r.id + ".json")),
      { code: "ENOENT" },
    );
  }
});
test("simultaneously received local tasks remain separate undo steps with permanent receipts", () => {
  const doc = { assets: [], generationResultIds: [], future: { keep: true } },
    one = { id: "one", kind: "local-tool", assets: [{ id: "a" }, { id: "b" }] },
    two = { id: "two", kind: "local-tool", assets: [{ id: "c" }] };
  const applied = applyResults(doc, { past: [], future: [] }, [one, two]);
  assert.equal(applied.history.past.length, 2);
  assert.deepEqual(
    applied.history.past.map((d) => d.assets.map((a) => a.id)),
    [[], ["a", "b"]],
  );
  assert.deepEqual(
    applied.document.assets.map((a) => a.id),
    ["a", "b", "c"],
  );
  for (const h of applied.history.past)
    assert.deepEqual(mergeResults(h, [one, two]), h);
});
