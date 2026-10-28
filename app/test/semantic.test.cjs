const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http");
const { ProjectStore } = require("../core/storage.cjs"),
  { TaskQueue } = require("../core/tasks.cjs"),
  { CloudTaskService } = require("../core/cloud-tasks.cjs"),
  { SemanticService } = require("../core/semantic.cjs"),
  { cloudRunner } = require("../core/cloud-runner.cjs"),
  { saveImage, GenerationService } = require("../core/generation.cjs"),
  { encode, decode, prepare, finish } = require("../core/cloud-pixels.cjs"),
  { semanticItems, normalizeCategories } = require("../core/semantic-plan.cjs");
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tugou-semantic-test-")),
    projects = new ProjectStore(root);
  await projects.init();
  const tasks = new TaskQueue(root);
  await tasks.init();
  const requests = [];
  let behavior = "mixed",
    release;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bytes = Buffer.concat(chunks);
    if (req.url.endsWith("/chat/completions")) {
      const body = JSON.parse(bytes);
      requests.push({ kind: "vision", body });
      if (behavior === "wait") await new Promise((r) => (release = r));
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({ categories: ["左侧人物", "花束"] }),
              },
            },
          ],
        }),
      );
      return;
    }
    const form = await new Request("http://localhost" + req.url, {
      method: "POST",
      headers: req.headers,
      body: bytes,
    }).formData();
    requests.push({ kind: "image", prompt: form.get("prompt") });
    const data = Buffer.alloc(6 * 4 * 4);
    for (let i = 0; i < 24; i++) {
      const v = i % 6 < 2 ? 255 : i % 6 === 2 ? 128 : 0;
      data.set([v, v, v, 255], i * 4);
    }
    if (behavior === "mixed" && form.get("prompt").includes("花束"))
      data.set([255, 0, 0, 255], 0);
    res.end(
      JSON.stringify({
        data: [
          {
            b64_json: (await encode({ width: 6, height: 4, data })).toString(
              "base64",
            ),
          },
        ],
      }),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    release?.();
    await tasks.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const settings = {
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      apiKey: "test-private-key",
      model: "image-fixture",
      analysisModel: "vision-fixture",
    },
    connections = { readPrivate: async () => ({ ...settings }) };
  const inspect = (b) => ({
      width: b.readUInt32BE(16),
      height: b.readUInt32BE(20),
    }),
    cloud = new CloudTaskService(
      projects,
      connections,
      tasks,
      inspect,
      cloudRunner(root),
    ),
    semantic = new SemanticService(projects, connections, tasks, cloud);
  const data = Buffer.from(
      Array.from({ length: 24 }, (_, i) => [
        10 + i,
        90,
        180,
        [0, 64, 128, 255][i % 4],
      ]).flat(),
    ),
    sourceBytes = await encode({ width: 6, height: 4, data });
  const source = {
      id: "source",
      name: "样图",
      ...(await saveImage(root, sourceBytes, inspect)),
    },
    r = await projects.create("类别拆分"),
    document = { ...r.document, assets: [source], unknown: { keep: true } };
  await projects.save(r.id, document, r.revision);
  return {
    root,
    projects,
    tasks,
    cloud,
    semantic,
    settings,
    connections,
    inspect,
    requests,
    r,
    document,
    source,
    data,
    sourceBytes,
    behavior: (v) => (behavior = v),
    release: () => release?.(),
  };
}
test("semantic plan validates user-editable custom categories and exact limits", () => {
  assert.deepEqual(semanticItems("人物\n\n 宠物：左侧小狗 "), [
    "人物",
    "宠物：左侧小狗",
  ]);
  for (const s of [
    "",
    Array(13)
      .fill(0)
      .map((_, i) => String(i))
      .join("\n"),
    "人物\n人物",
    "a".repeat(401),
  ])
    assert.throws(() => semanticItems(s));
  assert.throws(() => normalizeCategories({ categories: ["a\nb"] }));
  assert.deepEqual(semanticItems("", true), []);
});
test("semantic extraction keeps source RGB and multiplies alpha, rejecting invalid masks", async () => {
  const data = Buffer.from([18, 29, 37, 0, 61, 72, 83, 128, 94, 105, 116, 255]),
    source = await encode({ width: 3, height: 1, data }),
    settings = { operation: "cloudSplit", instruction: "花束" };
  const mask = await encode({
    width: 3,
    height: 1,
    data: Buffer.from([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]),
  });
  assert.equal((await prepare(source, settings)).mask, undefined);
  const output = await decode(await finish(source, mask, settings));
  assert.deepEqual(
    [...output.data],
    [18, 29, 37, 0, 61, 72, 83, 64, 94, 105, 116, 255],
  );
  for (const rgba of [
    [255, 0, 0, 255],
    [128, 128, 128, 0],
    [0, 0, 0, 255],
    [255, 255, 255, 255],
  ])
    await assert.rejects(
      finish(
        source,
        await encode({
          width: 3,
          height: 1,
          data: Buffer.from([...rgba, ...rgba, ...rgba]),
        }),
        settings,
      ),
    );
});
test("vision proposals, per-category generation, isolated review/retry and persisted source snapshots", async (t) => {
  const f = await fixture(t),
    a = await f.semantic.analyze(f.r.id, f.document, "source");
  await f.tasks.execution;
  const draft = await f.semantic.read(f.r.id, a.id);
  assert.deepEqual(draft.categories, ["左侧人物", "花束"]);
  assert.equal(f.requests[0].body.model, "vision-fixture");
  assert.match(
    f.requests[0].body.messages[1].content[1].image_url.url,
    /data:image\/png;base64/,
  );
  const gen = new GenerationService(
    f.projects,
    f.connections,
    f.tasks,
    f.inspect,
  );
  assert.deepEqual(await gen.results(f.r.id), []);
  const generated = await f.semantic.generate(
    f.r.id,
    f.document,
    "source",
    draft.categories.join("\n"),
  );
  await f.tasks.execution;
  assert.equal(generated.ids.length, 2);
  assert.equal(
    f.tasks.tasks.find((t) => t.id === generated.ids[0]).status,
    "completed",
  );
  assert.equal(
    f.tasks.tasks.find((t) => t.id === generated.ids[1]).status,
    "review",
  );
  const raw = await f.cloud.review(generated.ids[1]);
  assert.equal(raw.job.settings.instruction, "花束");
  const current = await f.projects.read(f.r.id);
  await f.projects.save(
    f.r.id,
    {
      ...current.document,
      assets: [],
      imageToolSemanticPlans: { source: draft.categories.join("\n") },
    },
    current.revision,
  );
  f.behavior("ok");
  const retry = await f.cloud.retry(generated.ids[1]);
  await f.tasks.execution;
  assert.equal(
    f.tasks.tasks.find((t) => t.id === retry.id).status,
    "completed",
  );
  assert.equal(f.requests.filter((r) => r.kind === "image").length, 3);
  assert.equal(
    f.requests.filter((r) => r.prompt?.includes("左侧人物")).length,
    1,
  );
  const results = await gen.results(f.r.id);
  assert.equal(results.length, 2);
  for (const result of results) {
    const image = await decode(
      await fs.readFile(
        path.join(f.root, "resources", result.assets[0].resource),
      ),
    );
    for (let i = 0; i < 24; i++) {
      assert.deepEqual(
        image.data.subarray(i * 4, i * 4 + 3),
        f.data.subarray(i * 4, i * 4 + 3),
      );
      assert.equal(
        image.data[i * 4 + 3],
        Math.round(
          (f.data[i * 4 + 3] * (i % 6 < 2 ? 255 : i % 6 === 2 ? 128 : 0)) / 255,
        ),
      );
    }
  }
  const queue = new TaskQueue(f.root);
  await queue.init();
  const semantic = new SemanticService(f.projects, {}, queue, {});
  await semantic.recover();
  assert.deepEqual(
    (await semantic.read(f.r.id, a.id)).categories,
    draft.categories,
  );
  assert.equal(
    (await f.projects.read(f.r.id)).document.imageToolSemanticPlans.source,
    "左侧人物\n花束",
  );
  f.settings.model = "changed";
  await assert.rejects(f.cloud.retry(generated.ids[1]), /模型连接已改变/);
});
test("late recognition cancellation cannot overwrite category plan or recover as completed", async (t) => {
  const f = await fixture(t);
  f.behavior("wait");
  const task = await f.semantic.analyze(f.r.id, f.document, "source");
  for (let i = 0; i < 500 && !f.requests.length; i++)
    await new Promise((r) => setTimeout(r, 5));
  await f.tasks.cancel(task.id);
  f.release();
  await f.tasks.execution;
  assert.equal(f.tasks.tasks[0].status, "cancelled");
  await assert.rejects(f.semantic.read(f.r.id, task.id));
  const q = new TaskQueue(f.root);
  await q.init();
  await new SemanticService(f.projects, {}, q, {}).recover();
  assert.equal(q.tasks[0].status, "cancelled");
  assert.equal(f.requests.length, 1);
});
