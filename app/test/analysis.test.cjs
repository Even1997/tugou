const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http");
const { ProjectStore } = require("../core/storage.cjs");
const { TaskQueue } = require("../core/tasks.cjs");
const { AnalysisService } = require("../core/analysis.cjs");
const { GenerationService } = require("../core/generation.cjs");
const {
  normalizeAnalysis,
  applyAnalysis,
} = require("../core/analysis-draft.cjs");
const { compileRecipe } = require("../core/prompts.cjs");
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
const answer = {
  summary: "有宠物和人物的请柬",
  uncertainties: ["日期不清晰"],
  modules: [
    { name: "公共画风", kind: "画风", text: "柔和轮廓与平涂" },
    { name: "人物", kind: "character", text: "圆脸、短发" },
    { name: "宠物", kind: "pet", text: "棕白小狗" },
    { name: "光", kind: "lighting", text: "柔和侧光" },
  ],
};
async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "tugou-analysis-test-"),
  );
  const projects = new ProjectStore(root);
  await projects.init();
  const tasks = new TaskQueue(root);
  await tasks.init();
  const requests = [];
  let mode = "ok",
    release;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      url: req.url,
      headers: req.headers,
      body: JSON.parse(Buffer.concat(chunks)),
    });
    if (mode === "wait")
      await new Promise((r) => {
        release = r;
      });
    if (mode === "error") {
      res.writeHead(403);
      res.end("analysis-secret");
      return;
    }
    if (mode === "large") {
      res.setHeader("Content-Length", "2097152");
      res.end("x".repeat(2097152));
      return;
    }
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: mode === "truncated" ? "length" : "stop",
            message: {
              content:
                mode === "malformed" ? "not-json" : JSON.stringify(answer),
            },
          },
        ],
      }),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const connections = {
    readPrivate: async () => ({
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      apiKey: "analysis-secret",
      model: "image-model",
      analysisModel: "vision-model",
    }),
  };
  const service = new AnalysisService(projects, connections, tasks),
    record = await projects.create("分析测试");
  const document = {
    ...record.document,
    assets: [
      { id: "source", name: "参考图", dataUrl: `data:image/png;base64,${png}` },
    ],
    opaque: { future: [1, 2] },
    modules: [{ id: "old", kind: "other", name: "旧模块", text: "保留" }],
  };
  t.after(async () => {
    release?.();
    await tasks.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    const parent = await fs.realpath(os.tmpdir());
    if (
      path.dirname(root) !== parent ||
      !path.basename(root).startsWith("tugou-analysis-test-")
    )
      throw new Error("Unsafe cleanup");
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  return {
    root,
    projects,
    tasks,
    requests,
    service,
    connections,
    record,
    document,
    mode: (value) => {
      mode = value;
    },
    release: () => release?.(),
  };
}
const done = async (f) => {
  await f.tasks.execution;
  return f.tasks.list().at(-1);
};
const arrived = async (f) => {
  for (let i = 0; i < 100 && !f.requests.length; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.ok(f.requests.length);
};
const review = (draft) => ({
  modules: draft.modules.map((m) => ({ ...m, enabled: true, global: false })),
  createRecipe: true,
  recipeName: "审阅配方",
  reference: false,
});

test("analysis uses shared vision model and only selected image; normalized draft has separate extensible modules", async (t) => {
  const f = await fixture(t);
  await f.service.start(f.record.id, f.document, "source", "人物动作分别分析");
  assert.equal((await done(f)).status, "completed");
  const request = f.requests[0];
  assert.equal(request.url, "/v1/chat/completions");
  assert.equal(request.body.model, "vision-model");
  assert.equal(request.body.messages[1].content[0].text, "人物动作分别分析");
  assert.equal(
    request.body.messages[1].content[1].image_url.url,
    `data:image/png;base64,${png}`,
  );
  assert.match(request.body.messages[0].content, /不预设半身/);
  const [draft] = await f.service.results(f.record.id);
  assert.equal(draft.modules[0].kind, "style");
  assert.equal(draft.modules[3].kind, "lighting");
  assert.equal(draft.modules[0].global, undefined);
  assert.deepEqual(draft.uncertainties, answer.uncertainties);
  assert.ok(
    !(await fs.readFile(path.join(f.root, "tasks.json"), "utf8")).includes(
      "analysis-secret",
    ),
  );
});
test("reviewed imports preserve concurrent edits and unknown fields, create pinned recipe, and reject duplicate import", async (t) => {
  const f = await fixture(t);
  await f.service.start(f.record.id, f.document, "source");
  await done(f);
  const [draft] = await f.service.results(f.record.id),
    choices = review(draft);
  choices.modules[1].text = "人工修订人物";
  choices.modules[2].enabled = false;
  const edited = {
    ...f.document,
    name: "分析期间改名",
    modules: [{ ...f.document.modules[0], text: "分析期间编辑" }],
  };
  const next = applyAnalysis(edited, draft, choices);
  assert.equal(next.name, edited.name);
  assert.deepEqual(next.opaque, edited.opaque);
  assert.deepEqual(next.modules[0], edited.modules[0]);
  assert.equal(next.modules.length, 4);
  assert.equal(next.modules[2].text, "人工修订人物");
  assert.equal(next.recipes.length, 1);
  assert.deepEqual(next.recipes[0].references, []);
  assert.ok(next.modules.slice(1).every((m) => m.global === false));
  assert.match(
    compileRecipe(next, next.recipes[0]).prompt,
    /人工修订人物[\s\S]*柔和轮廓与平涂/,
  );
  assert.throws(() => applyAnalysis(next, draft, choices), /已加入/);
  const saved = await f.projects.save(f.record.id, next, 1);
  assert.deepEqual((await f.projects.read(saved.id)).document, next);
  assert.deepEqual(
    applyAnalysis(edited, draft, choices),
    next,
    "restoring pre-import document permits deterministic redo",
  );
});
test("review edits persist independently and restart recovery neither resubmits nor routes drafts into image results", async (t) => {
  const f = await fixture(t);
  await f.service.start(f.record.id, f.document, "source");
  await done(f);
  const [draft] = await f.service.results(f.record.id),
    choices = review(draft);
  choices.modules[0].text = "修订画风";
  choices.modules[3].enabled = false;
  await f.service.saveReview(f.record.id, draft.id, choices);
  f.tasks.tasks[0].status = "running";
  await f.tasks.persist();
  const queue = new TaskQueue(f.root);
  await queue.init();
  const analysis = new AnalysisService(f.projects, f.connections, queue),
    generation = new GenerationService(
      f.projects,
      f.connections,
      queue,
      () => ({}),
    );
  await generation.recover();
  await analysis.recover();
  assert.equal(queue.list()[0].status, "completed");
  assert.deepEqual(await generation.results(f.record.id), []);
  assert.equal(
    (await analysis.results(f.record.id))[0].review.modules[0].text,
    "修订画风",
  );
  assert.equal(
    (await analysis.results(f.record.id))[0].review.modules[3].enabled,
    false,
  );
  assert.equal(f.requests.length, 1);
  const other = await f.projects.create("其他工程");
  await assert.rejects(
    analysis.saveReview(other.id, draft.id, choices),
    /不属于/,
  );
});
test("cancelled analysis discards late response and duplicate active source is rejected", async (t) => {
  const f = await fixture(t);
  f.mode("wait");
  const task = await f.service.start(f.record.id, f.document, "source");
  await arrived(f);
  await assert.rejects(
    f.service.start(f.record.id, f.document, "source"),
    /已有分析/,
  );
  await f.tasks.cancel(task.id);
  f.release();
  assert.equal((await done(f)).status, "cancelled");
  assert.deepEqual(await f.service.results(f.record.id), []);
  assert.equal(f.requests.length, 1);
});
test("provider errors, malformed, truncated and oversized outputs never publish drafts or leak provider text", async (t) => {
  const f = await fixture(t);
  for (const mode of ["error", "malformed", "truncated", "large"]) {
    f.mode(mode);
    await f.service.start(f.record.id, f.document, "source");
    const result = await done(f);
    assert.equal(result.status, "failed", mode);
    assert.ok(!result.message.includes("analysis-secret"));
  }
  assert.deepEqual(await f.service.results(f.record.id), []);
  assert.equal(f.requests.length, 4);
});
test("invalid inputs and empty selections fail before project mutation or network submission", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.service.start(f.record.id, f.document, "absent"),
    /选择参考图/,
  );
  await assert.rejects(
    f.service.start(f.record.id, f.document, "source", "x".repeat(4001)),
    /4000/,
  );
  assert.equal(f.requests.length, 0);
  assert.throws(
    () =>
      normalizeAnalysis({ modules: [{ name: "", kind: "style", text: "a" }] }),
    /格式无效/,
  );
  const draft = {
      id: "12345678-1234-1234-1234-123456789012",
      assetId: "source",
      ...normalizeAnalysis(answer),
    },
    choices = review(draft);
  choices.modules.forEach((m) => {
    m.enabled = false;
  });
  assert.throws(() => applyAnalysis(f.document, draft, choices), /至少选择/);
  assert.equal(f.document.modules.length, 1);
});
