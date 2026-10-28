const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http");
const { ProjectStore } = require("../core/storage.cjs"),
  { TaskQueue } = require("../core/tasks.cjs");
const { CloudTaskService } = require("../core/cloud-tasks.cjs"),
  { cloudRunner } = require("../core/cloud-runner.cjs");
const { GenerationService, saveImage } = require("../core/generation.cjs"),
  { encode, decode } = require("../core/cloud-pixels.cjs");
const { applyResults } = require("../core/results.cjs");
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tugou-cloud-unit-")),
    store = new ProjectStore(root);
  await store.init();
  const tasks = new TaskQueue(root);
  await tasks.init();
  const requests = [];
  let behavior = "ok",
    release,
    allowConnection = true;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const form = await new Request("http://localhost" + req.url, {
      method: "POST",
      headers: req.headers,
      body: Buffer.concat(chunks),
    }).formData();
    const record = {
      url: req.url,
      model: form.get("model"),
      prompt: form.get("prompt"),
      size: form.get("size"),
      image: Buffer.from(await form.get("image[]").arrayBuffer()),
      mask: form.get("mask")
        ? Buffer.from(await form.get("mask").arrayBuffer())
        : undefined,
    };
    requests.push(record);
    if (behavior === "wait") await new Promise((r) => (release = r));
    if (behavior === "error" || (behavior === 'first-error' && requests.length === 1)) {
      res.writeHead(401);
      res.end("dummy-private-key");
      return;
    }
    const [w, h] = record.size.split("x").map(Number),
      width = behavior === "large" || (behavior === 'first-large' && requests.length === 1) ? w * 2 : w,
      height = behavior === "large" || (behavior === 'first-large' && requests.length === 1) ? h * 2 : h;
    const bytes = await encode({
      width,
      height,
      data: Buffer.from(
        Array.from({ length: width * height }, () => [200, 10, 40, 179]).flat(),
      ),
    });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    release?.();
    await tasks.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const inspect = (b) => ({
    width: b.readUInt32BE(16),
    height: b.readUInt32BE(20),
  });
  const connections = {
    readPrivate: async () => {
      if (!allowConnection) throw Error("offline");
      return {
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        model: "fixture-edit",
        apiKey: "dummy-private-key",
      };
    },
  };
  const service = new CloudTaskService(
    store,
    connections,
    tasks,
    inspect,
    cloudRunner(root),
  );
  const r = await store.create("云端工具验收"),
    data = Buffer.from(
      Array.from({ length: 24 }, (_, i) => [
        10 + i * 3,
        40,
        180,
        [0, 64, 128, 255][i % 4],
      ]).flat(),
    ),
    sourceBytes = await encode({ width: 6, height: 4, data });
  const source = {
      id: "source",
      name: "原图",
      ...(await saveImage(root, sourceBytes, inspect)),
    },
    document = { ...r.document, assets: [source], future: { keep: true } };
  await store.save(r.id, document, r.revision);
  return {
    root,
    store,
    tasks,
    service,
    r,
    document,
    requests,
    data,
    source,
    sourceBytes,
    inspect,
    behavior: (v) => {
      behavior = v;
    },
    offline: () => {
      allowConnection = false;
    },
    release: () => release?.(),
    result: async (id) =>
      JSON.parse(await fs.readFile(path.join(root, "results", id + ".json"))),
  };
}
test('cloud batch preflights all sources, deduplicates, groups results and retries only explicitly', async t => {
  const f=await fixture(t);
  f.document.assets.push({...f.source,id:'second',name:'第二张'});
  await assert.rejects(f.service.cancelBatch(undefined),/标识无效/);
  await assert.rejects(f.service.startBatch(f.r.id,f.document,['source','missing'],{operation:'cloudEnhance'}));
  assert.equal(f.tasks.tasks.length,0);assert.equal(f.requests.length,0);
  const batch=await f.service.startBatch(f.r.id,f.document,['source','second','source'],{operation:'cloudEnhance'});
  await f.tasks.execution;
  assert.equal(batch.ids.length,2);assert.equal(f.requests.length,2);
  for(const [i,id] of batch.ids.entries()) {
    assert.equal(f.tasks.tasks.find(t=>t.id===id).status,'completed');
    const result=await f.result(id);
    assert.equal(result.assets[0].toolResult.batchId,batch.batchId);
    assert.equal(result.assets[0].toolResult.batchIndex,i);
  }
  const restarted=new TaskQueue(f.root);await restarted.init();
  assert.equal(restarted.tasks.length,2);assert.equal(f.requests.length,2);
  assert.ok(!(await fs.readFile(path.join(f.root,'tasks.json'),'utf8')).includes('dummy-private-key'));
});
test('cloud batch cancellation stops queued requests; manual retry preserves its batch', async t => {
  const f=await fixture(t);
  f.document.assets.push({...f.source,id:'second',name:'第二张'});
  f.behavior('wait');
  const batch=await f.service.startBatch(f.r.id,f.document,['source','second'],{operation:'cloudEnhance'});
  for(let i=0;i<300&&!f.requests.length;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(f.requests.length,1);
  assert.equal(await f.service.cancelBatch(batch.batchId),2);
  f.release();await f.tasks.execution;
  assert.ok(f.tasks.tasks.every(t=>t.status==='cancelled'));assert.equal(f.requests.length,1);
  f.behavior('ok');
  const retry=await f.service.retry(batch.ids[1]);await f.tasks.execution;
  assert.equal(f.requests.length,2);
  assert.equal((await f.result(retry.id)).assets[0].toolResult.batchId,batch.batchId);
});
test('cloud batch checks every mask dimension before making requests', async t => {
  const f=await fixture(t);
  const small=await encode({width:2,height:2,data:Buffer.alloc(16,255)});
  f.document.assets.push({id:'small',name:'small',...await saveImage(f.root,small,f.inspect)});
  await assert.rejects(f.service.startBatch(f.r.id,f.document,['source','small'],{operation:'cloudEdit',instruction:'换色',maskMode:'asset',maskId:'source'}),/尺寸一致/);
  assert.equal(f.tasks.tasks.length,0);assert.equal(f.requests.length,0);
});
test('cloud batch isolates provider failure and size review without blocking later items', async t => {
  for(const behavior of ['first-error','first-large']) {
    const f=await fixture(t);f.behavior(behavior);
    f.document.assets.push({...f.source,id:'second',name:'第二张'});
    const batch=await f.service.startBatch(f.r.id,f.document,['source','second'],{operation:'cloudEnhance'});
    await f.tasks.execution;
    assert.deepEqual(f.tasks.tasks.map(t=>t.status),[behavior==='first-error'?'failed':'review','completed']);
    assert.equal(f.requests.length,2);
    if(behavior==='first-large') {
      f.offline();const finished=await f.service.resume(batch.ids[0],true);await f.tasks.execution;
      assert.equal(f.requests.length,2);
      assert.equal((await f.result(finished.id)).assets[0].toolResult.batchId,batch.batchId);
    } else {
      const retried=await f.service.retry(batch.ids[0]);await f.tasks.execution;
      assert.equal(f.requests.length,3);assert.equal((await f.result(retried.id)).assets[0].toolResult.batchIndex,0);
    }
  }
});
test("arbitrary mask snapshot survives changed source list and offline review recovery", async (t) => {
  const f = await fixture(t),
    data = Buffer.alloc(6 * 4 * 4);
  for (let i = 0; i < 24; i++)
    data[i * 4 + 3] = i % 3 === 0 ? 0 : i % 3 === 1 ? 128 : 255;
  const mask = {
    id: "mask",
    name: "蒙版",
    ...(await saveImage(
      f.root,
      await encode({ width: 6, height: 4, data }),
      f.inspect,
    )),
  };
  f.document.assets.push(mask);
  f.behavior("large");
  const task = await f.service.start(f.r.id, f.document, "source", {
    operation: "cloudEdit",
    instruction: "test",
    maskMode: "asset",
    maskId: mask.id,
  });
  f.document.assets.pop();
  await f.tasks.execution;
  assert.equal(f.tasks.tasks.at(-1).status, "review");
  const sent = await decode(f.requests[0].mask);
  for (let i = 0; i < 24; i++)
    assert.equal(sent.data[i * 4 + 3], 255 - data[i * 4 + 3]);
  const raw = await f.service.review(task.id);
  assert.equal(raw.job.mask.resource, mask.resource);
  const reloaded = new TaskQueue(f.root);
  await reloaded.init();
  const service = new CloudTaskService(
    f.store,
    {},
    reloaded,
    f.inspect,
    cloudRunner(f.root),
  );
  await service.recover();
  const finished = await service.resume(task.id, true);
  await reloaded.execution;
  assert.equal(reloaded.tasks.at(-1).status, "completed");
  assert.equal(f.requests.length, 1);
  const result = await f.result(finished.id);
  assert.equal(result.assets[0].toolResult.mask.resource, mask.resource);
  const output = await decode(
    await fs.readFile(
      path.join(f.root, "resources", result.assets[0].resource),
    ),
  );
  for (let i = 0; i < 24; i += 3)
    assert.deepEqual(
      output.data.subarray(i * 4, i * 4 + 4),
      f.data.subarray(i * 4, i * 4 + 4),
    );
  const historyDoc = {
    ...f.document,
    assets: [...f.document.assets, ...result.assets],
  };
  const again = await f.service.start(f.r.id, historyDoc, "source", {
    operation: "cloudEdit",
    instruction: "test",
    maskMode: "asset",
    maskId: mask.id,
  });
  await f.tasks.execution;
  assert.equal(
    (await f.service.review(again.id)).job.mask.resource,
    mask.resource,
  );
});
test("invalid or empty mask prevents provider request", async (t) => {
  const f = await fixture(t),
    mask = {
      id: "empty",
      name: "空蒙版",
      ...(await saveImage(
        f.root,
        await encode({ width: 6, height: 4, data: Buffer.alloc(6 * 4 * 4) }),
        f.inspect,
      )),
    };
  f.document.assets.push(mask);
  const options = {
    operation: "cloudEdit",
    instruction: "test",
    maskMode: "asset",
    maskId: mask.id,
  };
  await f.service.start(f.r.id, f.document, "source", options);
  await f.tasks.execution;
  assert.equal(f.tasks.tasks.at(-1).status, "failed");
  assert.match(f.tasks.tasks.at(-1).message, /没有可修改区域/);
  assert.equal(f.requests.length, 0);
  await assert.rejects(
    f.service.start(f.r.id, f.document, "source", {
      ...options,
      maskId: "missing",
    }),
    /蒙版素材不存在/,
  );
});
test("cloud edit sends actual image/mask bytes, protects pixels, persists no key, merges as one undo", async (t) => {
  const f = await fixture(t),
    task = await f.service.start(f.r.id, f.document, "source", {
      operation: "cloudEdit",
      left: 2,
      top: 1,
      width: 2,
      height: 2,
      instruction: "红花",
    });
  await f.tasks.execution;
  assert.equal(f.tasks.tasks[0].status, "completed");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "/v1/images/edits");
  assert.match(f.requests[0].prompt, /红花/);
  const mask = await decode(f.requests[0].mask);
  assert.equal(mask.data[3], 255);
  assert.equal(mask.data[(1 * 6 + 2) * 4 + 3], 0);
  const result = await f.result(task.id),
    pixels = (
      await decode(
        await fs.readFile(
          path.join(f.root, "resources", result.assets[0].resource),
        ),
      )
    ).data;
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 6; x++)
      if (x < 2 || x >= 4 || y < 1 || y >= 3) {
        const i = (y * 6 + x) * 4;
        assert.deepEqual(pixels.subarray(i, i + 4), f.data.subarray(i, i + 4));
      }
  const applied = applyResults(f.document, { past: [], future: [] }, [result]);
  assert.equal(applied.document.assets.length, 2);
  assert.equal(applied.document.tugouCanvas.nodes.length, 0);
  assert.equal(applied.history.past.length, 1);
  assert.ok(applied.document.future.keep);
  assert.ok(
    !(await fs.readFile(path.join(f.root, "tasks.json"), "utf8")).includes(
      "dummy-private-key",
    ),
  );
  for (const n of await fs.readdir(path.join(f.root, "requests")))
    assert.ok(
      !(await fs.readFile(path.join(f.root, "requests", n), "utf8")).includes(
        "dummy-private-key",
      ),
    );
  assert.deepEqual(
    await fs.readFile(path.join(f.root, "resources", f.source.resource)),
    f.sourceBytes,
  );
});
test("all other cloud modes send declared sizes and exact extension mask", async (t) => {
  const f = await fixture(t);
  for (const options of [
    { operation: "cloudEnhance" },
    { operation: "cloudUpscale", scale: 2 },
    { operation: "cloudExtend", width: 10, height: 8, left: 2, top: 2 },
  ]) {
    const task = await f.service.start(f.r.id, f.document, "source", options);
    await f.tasks.execution;
    assert.equal(f.tasks.tasks.at(-1).status, "completed");
    const result = await f.result(task.id);
    assert.equal(
      f.requests.at(-1).size,
      `${result.assets[0].width}x${result.assets[0].height}`,
    );
  }
  const request = f.requests.at(-1),
    frame = await decode(request.image),
    mask = await decode(request.mask);
  assert.equal(frame.width, 10);
  assert.equal(mask.data[3], 0);
  assert.equal(mask.data[(2 * 10 + 2) * 4 + 3], 255);
});
test("dimension mismatch preserves raw bytes, offline explicit fit and raw collection remain separately undoable and deduplicated", async (t) => {
  const f = await fixture(t);
  f.behavior("large");
  const task = await f.service.start(f.r.id, f.document, "source", {
    operation: "cloudEnhance",
  });
  await f.tasks.execution;
  assert.equal(f.tasks.tasks[0].status, "review");
  await assert.rejects(f.result(task.id), { code: "ENOENT" });
  const raw = await f.service.review(task.id);
  assert.equal(raw.asset.width, 12);
  f.offline();
  const original = await f.service.keepRaw(task.id);
  await f.tasks.execution;
  assert.equal((await f.service.keepRaw(task.id)).id, original.id);
  const rejected = await f.service.resume(task.id, false);
  await f.tasks.execution;
  assert.equal(
    f.tasks.tasks.find((t) => t.id === rejected.id).status,
    "failed",
  );
  const fit = await f.service.resume(task.id, true);
  await f.tasks.execution;
  assert.equal(f.tasks.tasks.find((t) => t.id === fit.id).status, "completed");
  assert.equal((await f.service.resume(task.id, true)).id, fit.id);
  delete f.tasks.tasks.find((t) => t.id === task.id).context.resolvedTaskId;
  assert.equal((await f.service.review(task.id)).resolvedTaskId, fit.id);
  const collected = await f.result(original.id),
    aligned = await f.result(fit.id);
  assert.equal(collected.assets[0].resource, raw.asset.resource);
  assert.equal(aligned.assets[0].width, 6);
  assert.equal(f.requests.length, 1);
  const applied = applyResults(f.document, { past: [], future: [] }, [
    collected,
    aligned,
  ]);
  assert.equal(applied.history.past.length, 2);
  assert.equal(applied.document.assets.length, 3);
});
test("raw review recovers after actual queue reload without provider request or connection", async (t) => {
  const f = await fixture(t);
  f.behavior("large");
  const task = await f.service.start(f.r.id, f.document, "source", {
    operation: "cloudEnhance",
  });
  await f.tasks.execution;
  f.tasks.tasks[0].status = "running";
  await f.tasks.persist();
  const restarted = new TaskQueue(f.root);
  await restarted.init();
  await new GenerationService(f.store, {}, restarted, f.inspect).recover();
  const service = new CloudTaskService(
    f.store,
    {},
    restarted,
    f.inspect,
    cloudRunner(f.root),
  );
  await service.recover();
  assert.equal(restarted.tasks[0].status, "review");
  assert.equal((await service.review(task.id)).asset.width, 12);
  assert.equal(f.requests.length, 1);
});
test("cloud cancellation rejects late output, duplicate concurrent submission makes one paid request, HTTP error hides response body", async (t) => {
  const f = await fixture(t);
  f.behavior("wait");
  const outcomes = await Promise.allSettled([
    f.service.start(f.r.id, f.document, "source", {
      operation: "cloudEnhance",
    }),
    f.service.start(f.r.id, f.document, "source", {
      operation: "cloudEnhance",
    }),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  const task = outcomes.find((x) => x.status === "fulfilled").value;
  for (let i = 0; i < 500 && !f.requests.length; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(f.requests.length, 1);
  await f.tasks.cancel(task.id);
  f.release();
  await f.tasks.execution;
  assert.equal(f.tasks.tasks[0].status, "cancelled");
  await assert.rejects(f.result(task.id), { code: "ENOENT" });
  f.behavior("error");
  await f.service.start(f.r.id, f.document, "source", {
    operation: "cloudEnhance",
  });
  await f.tasks.execution;
  assert.equal(f.tasks.tasks[1].status, "failed");
  assert.match(f.tasks.tasks[1].message, /401/);
  assert.ok(!f.tasks.tasks[1].message.includes("dummy-private-key"));
  assert.equal(f.requests.length, 2);
});
