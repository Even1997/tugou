const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const {
  RuntimeInstaller,
  installRoot,
} = require("../core/runtime-install.cjs");
const { LocalAIService } = require("../core/local-ai.cjs"),
  { TaskQueue } = require("../core/tasks.cjs");
const { encode, decode } = require("../core/cloud-pixels.cjs");
const manifest = require("../runtime/components.json");
(async () => {
  const parent = require('./qa-paths.cjs').path("installer-native");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "profile-")),
    tasks = new TaskQueue(root);
  await tasks.init();
  const local = new LocalAIService({ root }),
    installer = new RuntimeInstaller(local, tasks),
    owned = await installRoot(parent);
  const cache = path.join(owned, "cache/downloads");
  await fs.mkdir(cache, { recursive: true });
  // Large immutable artifacts are copied from an existing user runtime, then rehashed by production downloader.
  await fs.copyFile(
    "D:/CanvasStudioRuntime/segmentation/birefnet-general-fp16.onnx",
    path.join(cache, manifest.cutout.sha256),
  );
  await fs.copyFile(
    "D:/CanvasStudioRuntime/realesrgan-20220424/download.zip",
    path.join(cache, manifest.upscale.win32.sha256),
  );
  const report = {
    root,
    parent,
    cachedArtifacts: ["upscale", "cutout"],
    freshNetworkArtifacts: ["uv", "managed-python", "hashed-python-wheels"],
    checks: [],
  };
  try {
    const result = await installer.start(parent, { cutout: true });
    await tasks.execution;
    const task = tasks.list().find((t) => t.id === result.id);
    report.task = task;
    assert.equal(task.status, "completed", task.message);
    const status = await local.status();
    report.runtime = status;
    assert.equal(status.configured, true);
    assert.equal(status.cutout, true);
    assert.equal(status.models.length, 3);
    report.checks.push("real pinned dependencies and model probe");
    const input = path.join(root, "fixture.png"),
      data = Buffer.alloc(48 * 48 * 4);
    for (let i = 0; i < 48 * 48; i++)
      data.set([i % 255, 140, 180, i % 3 ? 255 : 0], i * 4);
    await fs.writeFile(input, await encode({ width: 48, height: 48, data }));
    const resource = path.basename(input),
      runtime = await local.runtime();
    await fs.mkdir(path.join(root, "resources"), { recursive: true });
    await fs.copyFile(input, path.join(root, "resources", resource));
    // The adapter receives validated resource bytes through a file URL only in this direct native probe.
    const { saveImage } = require("../core/generation.cjs");
    const asset = await saveImage(root, await fs.readFile(input), () => ({
      width: 48,
      height: 48,
    }));
    const bytes = await local.processInput(
      asset,
      { operation: "upscale", model: "anime", scale: 2 },
      runtime,
      new AbortController().signal,
      "installer-probe",
      () => {},
    );
    const output = await decode(bytes);
    assert.equal(output.width, 96);
    assert.equal(output.height, 96);
    assert.ok(output.data.some((v, i) => i % 4 === 3 && v < 255));
    report.checks.push("installed runtime performs actual 2x RGBA upscale");
    const reopened = new LocalAIService({ root });
    assert.deepEqual(await reopened.status(), status);
    report.checks.push("activated configuration survives service restart");
    assert.ok(
      (await fs.readdir(path.join(status.folder, "licenses"))).includes(
        "BiRefNet.txt",
      ),
    );
    report.checks.push("component notices preserved");
    report.ok = true;
  } catch (e) {
    report.error = e.stack;
    process.exitCode = 1;
  }
  await fs.writeFile(
    "test-results/installer-native.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      ok: report.ok,
      checks: report.checks,
      error: report.error,
      task: report.task?.message,
    }),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
