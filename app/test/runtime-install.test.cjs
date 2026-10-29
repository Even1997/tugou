const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { TaskQueue } = require("../core/tasks.cjs");
const files = require("../core/runtime-files.cjs"),
  processes = require("../core/local-process.cjs");
const originals = {
  download: files.verifiedDownload,
  extract: files.extractArchive,
  run: processes.runProcess,
};
test.mock.method(fs, "statfs", async () => ({
  bavail: 8 * 1024 ** 3,
  bsize: 1,
}));
const calls = [];
let behavior = "ok",
  release;
files.verifiedDownload = async (item, folder, signal) => {
  signal.throwIfAborted();
  await fs.mkdir(folder, { recursive: true });
  const target = path.join(folder, item.sha256);
  await fs.writeFile(target, "fixture");
  return target;
};
files.extractArchive = async (file, folder, options, signal) => {
  signal.throwIfAborted();
  await fs.mkdir(folder, { recursive: true });
  if (options.only)
    await fs.writeFile(path.join(folder, options.only), "fixture");
};
processes.runProcess = async (file, args, options) => {
  calls.push({ args, env: options.env });
  if (behavior === "fail") throw Error("fixture failure");
  if (behavior === "wait")
    await new Promise((resolve) => {
      release = resolve;
      options.signal.addEventListener("abort", resolve, { once: true });
    });
  options.signal.throwIfAborted();
};
delete require.cache[require.resolve("../core/runtime-install.cjs")];
const {
  RuntimeInstaller,
  installRoot,
  lockRoot,
  runtimeEnvironment,
} = require("../core/runtime-install.cjs");
files.verifiedDownload = originals.download;
files.extractArchive = originals.extract;
processes.runProcess = originals.run;
async function setup(t, inspect) {
  const parent = await fs.mkdtemp(
      path.join(os.tmpdir(), "tugou-installer-unit-"),
    ),
    root = path.join(parent, "workspace");
  await fs.mkdir(root);
  const config = path.join(root, "local-runtime.json");
  await fs.writeFile(
    config,
    '{"folder":"original","provider":"CPUExecutionProvider","unknown":true}',
  );
  const tasks = new TaskQueue(root);
  await tasks.init();
  const local = {
    root,
    inspect:
      inspect ||
      (async (folder) => ({
        folder,
        provider: "CPUExecutionProvider",
        availableModels: ["general", "illustration", "anime"],
        cutout: true,
        availableCutoutModels: ['birefnet', 'u2netp'],
      })),
  };
  const installer = new RuntimeInstaller(local, tasks),
    owned = await installRoot(parent),
    job = {
      id: "unit-release",
      root: owned,
      cutout: true,
      version: require("../runtime/components.json").version,
      platform: process.platform,
      arch: process.arch,
    };
  await fs.mkdir(path.join(root, "runtime-installs"));
  await fs.writeFile(
    path.join(root, "runtime-installs", job.id + ".json"),
    JSON.stringify(job),
  );
  t.after(async () => {
    release?.();
    await tasks.shutdown();
    await tasks.execution;
    await fs.rm(parent, { recursive: true, force: true });
  });
  return { root, parent, config, tasks, installer, owned, job };
}
// These cases test the installation transaction with process/download fixtures;
// installer-native.cjs independently executes real pinned runtimes.
test("installer failure and explicit retry preserve config then activate", async (t) => {
  behavior = "fail";
  calls.length = 0;
  const f = await setup(t),
    before = await fs.readFile(f.config, "utf8");
  const first = await f.installer.enqueue(f.job);
  await f.tasks.execution;
  assert.equal(f.tasks.list()[0].status, "failed");
  assert.equal(await fs.readFile(f.config, "utf8"), before);
  await assert.rejects(fs.access(path.join(f.owned, ".install.lock")));
  behavior = "ok";
  await f.installer.retry(first.id);
  await f.tasks.execution;
  assert.equal(f.tasks.list().at(-1).status, "completed");
  const config = JSON.parse(await fs.readFile(f.config, "utf8"));
  assert.ok(config.folder.endsWith("unit-release"));
  assert.ok(
    calls.some(
      (c) =>
        c.args.includes("--require-hashes") &&
        c.args.includes("--only-binary") &&
        c.args.includes("--default-index"),
    ),
  );
  assert.ok(
    calls.some(
      (c) => c.args.includes("--no-bin") && c.args.includes("--no-registry"),
    ),
  );
  const restarted = new TaskQueue(f.root);
  await restarted.init();
  assert.equal(restarted.list().at(-1).status, "completed");
});
test("upscale-only installation skips Python and retains existing cutout location", async t => {
  behavior = "ok"; calls.length = 0;
  const f = await setup(t);
  await f.installer.enqueue({ ...f.job, cutout: false, upscale: true });
  await f.tasks.execution;
  assert.equal(f.tasks.list().at(-1).status, "completed");
  assert.equal(calls.length, 0);
  const saved = JSON.parse(await fs.readFile(f.config, 'utf8'));
  assert.equal(saved.cutoutFolder, 'original');
  assert.ok(saved.folder.endsWith(f.job.id));
  assert.deepEqual(f.tasks.list().at(-1).context.components, ['upscale']);
});
test("cutout-only installation retains existing upscale location", async t => {
  behavior = "ok";
  const f = await setup(t, async folder => ({ folder, cutout: true, availableCutoutModels: ['birefnet', 'u2netp'], availableModels: [], provider: 'CPUExecutionProvider' }));
  await f.installer.enqueue({ ...f.job, cutout: true, upscale: false });
  await f.tasks.execution;
  assert.equal(f.tasks.list().at(-1).status, "completed");
  const saved = JSON.parse(await fs.readFile(f.config, 'utf8'));
  assert.equal(saved.folder, 'original');
  assert.ok(saved.cutoutFolder.endsWith(f.job.id));
  assert.deepEqual(f.tasks.list().at(-1).context.components, ['cutout']);
  await fs.access(path.join(saved.cutoutFolder, 'segmentation', 'u2netp.onnx'));
  await fs.access(path.join(saved.cutoutFolder, 'licenses', 'U2Net-APACHE.txt'));
  await assert.rejects(fs.access(path.join(saved.cutoutFolder, 'realesrgan')));
});
test('missing lightweight model cannot activate a partially installed cutout bundle',async t=>{
 const f=await setup(t,async folder=>({folder,cutout:true,availableCutoutModels:['birefnet'],availableModels:['general','illustration','anime']}));
 const before=await fs.readFile(f.config,'utf8');await f.installer.enqueue(f.job);await f.tasks.execution;
 assert.equal(f.tasks.list().at(-1).status,'failed');assert.equal(await fs.readFile(f.config,'utf8'),before);
});
test("cancel waits for owned installer process and does not activate", async (t) => {
  behavior = "wait";
  const f = await setup(t),
    before = await fs.readFile(f.config, "utf8");
  const task = await f.installer.enqueue(f.job);
  while (!release) await new Promise((r) => setTimeout(r, 5));
  await f.tasks.cancel(task.id);
  await f.tasks.shutdown();
  await f.tasks.execution;
  assert.equal(f.tasks.list().at(-1).status, "cancelled");
  assert.equal(await fs.readFile(f.config, "utf8"), before);
  await assert.rejects(fs.access(path.join(f.owned, ".install.lock")));
  behavior = "ok";
  release = null;
});
test("verification failure and concurrent configuration changes cannot activate", async (t) => {
  behavior = "ok";
  const f = await setup(t, async () => ({
      availableModels: [],
      cutout: false,
    })),
    before = await fs.readFile(f.config, "utf8");
  await f.installer.enqueue(f.job);
  await f.tasks.execution;
  assert.equal(await fs.readFile(f.config, "utf8"), before);
  f.installer.localAI.inspect = async (folder) => {
    await fs.writeFile(f.config, '{"folder":"user-selected"}');
    return {
      folder,
      availableModels: ["general", "illustration", "anime"],
      cutout: true,
      availableCutoutModels: ['birefnet', 'u2netp'],
      provider: "CPUExecutionProvider",
    };
  };
  await f.installer.retry(f.tasks.list().at(-1).id);
  await f.tasks.execution;
  assert.equal(f.tasks.list().at(-1).status, "failed");
  assert.equal(
    await fs.readFile(f.config, "utf8"),
    '{"folder":"user-selected"}',
  );
  assert.match(f.tasks.list().at(-1).message, /配置发生变化/);
});
test("installer refuses foreign directories, live locks and unsupported retries", async (t) => {
  const f = await setup(t);
  const unlock = await lockRoot(f.owned);
  await assert.rejects(lockRoot(f.owned), /已有组件安装任务/);
  await unlock();
  await fs.writeFile(
    path.join(f.owned, ".install.lock"),
    JSON.stringify({ pid: 2147483647 }),
  );
  const stale = await lockRoot(f.owned);
  await stale();
  await fs.writeFile(path.join(f.owned, ".tugou-components"), "foreign");
  await assert.rejects(installRoot(f.parent), /不属于组件安装器/);
  await assert.rejects(f.installer.retry("missing"), /不可重试/);
});
test("installer strips external Python and package-index environment", () => {
  process.env.UV_INDEX_URL = "https://invalid.example";
  process.env.PIP_EXTRA_INDEX_URL = "https://invalid.example";
  process.env.PYTHONPATH = "unexpected";
  const env = runtimeEnvironment("/owned");
  assert.equal(env.UV_INDEX_URL, undefined);
  assert.equal(env.PIP_EXTRA_INDEX_URL, undefined);
  assert.equal(env.PYTHONPATH, undefined);
  assert.ok(env.UV_CACHE_DIR.includes("owned"));
  delete process.env.UV_INDEX_URL;
  delete process.env.PIP_EXTRA_INDEX_URL;
  delete process.env.PYTHONPATH;
});

test('restarting with an interrupted download never resumes until explicit retry', async t => {
  behavior='ok';const f=await setup(t),before=calls.length;
  await fs.writeFile(path.join(f.root,'tasks.json'),JSON.stringify([{id:'interrupted-install',status:'running',context:{kind:'runtime-install',installId:f.job.id,components:['cutout','upscale']}}]));
  const restarted=new TaskQueue(f.root);await restarted.init();
  assert.equal(restarted.list()[0].status,'interrupted');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,before);
  const installer=new RuntimeInstaller(f.installer.localAI,restarted);
  await installer.retry('interrupted-install');await restarted.execution;
  assert.equal(restarted.list().at(-1).status,'completed');assert.ok(calls.length>before);
  await restarted.shutdown();
});
test("low disk fails before submitting work and active releases are not modified", async (t) => {
  behavior = "ok";
  const f = await setup(t),
    before = await fs.readFile(f.config, "utf8");
  fs.statfs.mock.mockImplementation(async () => ({ bavail: 100, bsize: 1 }));
  try {
    await assert.rejects(
      f.installer.start(f.parent, { cutout: true }),
      /至少需要 3 GB/,
    );
    assert.equal(f.tasks.list().length, 0);
    assert.equal(await fs.readFile(f.config, "utf8"), before);
  } finally {
    fs.statfs.mock.mockImplementation(async () => ({
      bavail: 8 * 1024 ** 3,
      bsize: 1,
    }));
  }
  await fs.writeFile(
    f.config,
    JSON.stringify({ folder: path.join(f.owned, "releases", f.job.id) }),
  );
  const count = calls.length;
  await f.installer.enqueue(f.job);
  await f.tasks.execution;
  assert.match(f.tasks.list().at(-1).message, /正在使用/);
  assert.equal(calls.length, count);
});
test("cancellation during final activation restores exact previous config", async (t) => {
  behavior = "ok";
  const f = await setup(t),
    before = await fs.readFile(f.config, "utf8"),
    persist = f.tasks.persist.bind(f.tasks);
  let cancelled = false;
  f.tasks.persist = async () => {
    await persist();
    const task = f.tasks.tasks.at(-1);
    if (!cancelled && task?.progress === 100 && task.status === "running") {
      cancelled = true;
      await f.tasks.cancel(task.id);
    }
  };
  await f.installer.enqueue(f.job);
  await f.tasks.execution;
  assert.equal(f.tasks.list().at(-1).status, "cancelled");
  assert.equal(await fs.readFile(f.config, "utf8"), before);
});
