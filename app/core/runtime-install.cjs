const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { safePath, atomicWrite } = require("./storage.cjs");
const { verifiedDownload, extractArchive } = require("./runtime-files.cjs");
const { runProcess } = require("./local-process.cjs");
const manifest = require("../runtime/components.json");
const fail = (message) =>
  Object.assign(new Error(message), { safeMessage: message });
const active = (task) => ["queued", "running"].includes(task.status);
const readOptional = (file) =>
  fs.readFile(file, "utf8").catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });

async function installRoot(parent) {
  if (typeof parent !== "string" || !path.isAbsolute(parent))
    throw fail("请选择组件安装位置");
  const root = await safePath(parent, "tugou-components");
  try {
    await fs.mkdir(root);
    await atomicWrite(path.join(root, ".tugou-components"), "1");
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    if ((await readOptional(await safePath(root, ".tugou-components"))) !== "1")
      throw fail("目标目录已存在且不属于组件安装器，请选择其他位置");
  }
  return root;
}
async function lockRoot(root) {
  const file = await safePath(root, ".install.lock");
  try {
    const handle = await fs.open(file, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid }));
    await handle.close();
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const owner = JSON.parse(await fs.readFile(file, "utf8"));
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0)
      throw fail("组件安装锁无效，请选择其他安装位置");
    try {
      process.kill(owner.pid, 0);
      throw fail("该目录已有组件安装任务，请稍后重试");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await fs.unlink(file);
    return lockRoot(root);
  }
  return () => fs.unlink(file);
}
function runtimeEnvironment(root) {
  // Ignore user package indexes, Python selection and proxy credentials in UV/PIP settings.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(UV_|PIP_|PYTHON)/i.test(key),
    ),
  );
  return {
    ...env,
    UV_CACHE_DIR: path.join(root, "cache", "python"),
    UV_PYTHON_INSTALL_DIR: path.join(root, "python-managed"),
    UV_LINK_MODE: "copy",
  };
}
class RuntimeInstaller {
  constructor(localAI, tasks) {
    this.localAI = localAI;
    this.tasks = tasks;
    this.root = localAI.root;
  }
  async start(parent, options = {}) {
    if (
      this.tasks
        .list()
        .some((t) => t.context?.kind === "runtime-install" && active(t))
    )
      throw fail("已有组件安装任务");
    const target = manifest.uv[`${process.platform}-${process.arch}`];
    if (!target || !manifest.upscale[process.platform])
      throw fail("当前系统暂不支持自动安装，请选择已安装的组件目录");
    if (
      typeof options.cutout !== "boolean" ||
      ![
        "",
        undefined,
        "DmlExecutionProvider",
        "CoreMLExecutionProvider",
        "CPUExecutionProvider",
      ].includes(options.provider)
    )
      throw fail("组件安装选项无效");
    const root = await installRoot(parent),
      space = await fs.statfs(root);
    if (space.bavail * space.bsize < (options.cutout ? 3 : 2) * 1024 ** 3)
      throw fail(`安装位置至少需要 ${options.cutout ? 3 : 2} GB 可用空间`);
    const job = {
      id: randomUUID(),
      root,
      cutout: options.cutout,
      provider: options.provider || undefined,
      version: manifest.version,
      platform: process.platform,
      arch: process.arch,
    };
    await atomicWrite(
      await safePath(this.root, "runtime-installs", job.id + ".json"),
      JSON.stringify(job),
    );
    return this.enqueue(job);
  }
  async retry(id) {
    const task = this.tasks
      .list()
      .find((t) => t.id === id && t.context?.kind === "runtime-install");
    if (
      !task ||
      !["failed", "interrupted", "cancelled"].includes(task.status) ||
      this.tasks
        .list()
        .some((t) => t.context?.kind === "runtime-install" && active(t))
    )
      throw fail("该安装任务暂不可重试");
    const job = JSON.parse(
      await fs.readFile(
        await safePath(
          this.root,
          "runtime-installs",
          task.context.installId + ".json",
        ),
        "utf8",
      ),
    );
    if (
      job.version !== manifest.version ||
      job.platform !== process.platform ||
      job.arch !== process.arch
    )
      throw fail("组件版本或系统已变更，请重新选择安装位置");
    return this.enqueue(job);
  }
  async enqueue(job) {
    const task = await this.tasks.start(
      "安装本地组件",
      (signal, id) => this.execute(job, signal, id),
      { kind: "runtime-install", installId: job.id },
    );
    return { id: task.id };
  }
  async execute(job, signal, id) {
    let stage = "准备安装",
      lastProgress = 0;
    const progress = (percent, message, force = false) => {
      const task = this.tasks.tasks.find((t) => t.id === id);
      if (
        !task ||
        task.status !== "running" ||
        (!force && Date.now() - lastProgress < 1000)
      )
        return;
      lastProgress = Date.now();
      task.progress = percent;
      task.message = message;
      return this.tasks.persist();
    };
    const phase = async (message, percent) => {
      signal.throwIfAborted();
      stage = message;
      await progress(percent, message, true);
    };
    let unlock, config, before, installedConfig;
    try {
      await safePath(job.root);
      if (
        (await readOptional(await safePath(job.root, ".tugou-components"))) !==
        "1"
      )
        throw fail("组件安装位置失效，请重新选择");
      const space = await fs.statfs(job.root);
      if (space.bavail * space.bsize < 2 * 1024 ** 3)
        throw fail("组件安装位置空间不足，请释放至少 2 GB 后重试");
      unlock = await lockRoot(job.root);
      config = await safePath(this.root, "local-runtime.json");
      before = await readOptional(config);
      const release = await safePath(job.root, "releases", job.id),
        cache = await safePath(job.root, "cache", "downloads");
      if (before && JSON.parse(before).folder === release)
        throw fail("该组件目录正在使用，请重新选择位置安装新版本");
      await fs.mkdir(release, { recursive: true });
      const uv = manifest.uv[`${process.platform}-${process.arch}`],
        upscale = manifest.upscale[process.platform];
      const download = async (item, label, start, end) => {
        await phase(label, start);
        return verifiedDownload(item, cache, signal, (done, total) => {
          progress(
            Math.floor(start + ((end - start) * done) / total),
            `${label} · ${Math.floor((done / total) * 100)}%`,
          )?.catch(() => {});
        });
      };
      const bootstrap = await download(uv, "下载运行环境", 0, 10),
        bootstrapFolder = await safePath(release, "bootstrap");
      await extractArchive(bootstrap, bootstrapFolder, uv, signal);
      const uvExe = await safePath(bootstrapFolder, uv.only);
      if (process.platform !== "win32") await fs.chmod(uvExe, 0o755);
      const env = runtimeEnvironment(job.root),
        run = async (args) => {
          try {
            return await runProcess(uvExe, args, { env, signal, cwd: release });
          } catch (e) {
            if (signal.aborted) throw e;
            throw fail(
              `${stage}失败，请检查网络、磁盘空间或组件文件后继续安装`,
            );
          }
        };
      await phase("安装独立 Python", 12);
      await run([
        "python",
        "install",
        manifest.python,
        "--no-bin",
        "--no-registry",
        "--no-config",
      ]);
      await phase("创建组件环境", 20);
      const venv = await safePath(release, "segment-python");
      const python = path.join(
        venv,
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python3",
      );
      try {
        await fs.access(path.join(venv, "pyvenv.cfg"));
        await fs.access(python);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        await run([
          "venv",
          venv,
          "--allow-existing",
          "--python",
          manifest.python,
          "--managed-python",
          "--no-python-downloads",
          "--no-config",
        ]);
      }
      await phase("安装并校验图像依赖", 25);
      // Copy out of app.asar before passing a path to a native child process.
      const requirements = await safePath(release, "requirements.txt");
      await atomicWrite(
        requirements,
        await fs.readFile(path.join(__dirname, "../runtime", uv.requirements)),
      );
      await run([
        "pip",
        "sync",
        requirements,
        "--python",
        python,
        "--require-hashes",
        "--only-binary",
        ":all:",
        "--no-config",
        "--default-index",
        "https://pypi.org/simple",
      ]);
      const archive = await download(upscale, "下载超分组件", 40, 55);
      await phase("解压超分组件", 56);
      await extractArchive(
        archive,
        await safePath(release, "realesrgan"),
        upscale,
        signal,
      );
      if (process.platform !== "win32")
        await fs.chmod(
          await safePath(release, "realesrgan", "realesrgan-ncnn-vulkan"),
          0o755,
        );
      if (job.cutout) {
        const model = await download(manifest.cutout, "下载主体模型", 60, 90);
        const destination = await safePath(
          release,
          "segmentation",
          "birefnet-general-fp16.onnx",
        );
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(model, destination);
      }
      await phase("验证组件", 94);
      const notices = path.join(__dirname, "../runtime/component-notices");
      for (const name of await fs.readdir(notices))
        await atomicWrite(
          await safePath(release, "licenses", name),
          await fs.readFile(path.join(notices, name)),
        );
      const runtime = await this.localAI.inspect(release, job.provider, signal);
      if (
        runtime.availableModels.length !== 3 ||
        (job.cutout && !runtime.cutout)
      )
        throw fail("组件验证未通过，原配置已保留");
      await atomicWrite(
        await safePath(release, "installed.json"),
        JSON.stringify({
          version: job.version,
          platform: job.platform,
          arch: job.arch,
          cutout: job.cutout,
          completedAt: new Date().toISOString(),
        }),
      );
      signal.throwIfAborted();
      if ((await readOptional(config)) !== before)
        throw fail(
          "安装期间组件配置发生变化，已保留当前配置；可选择新组件目录启用",
        );
      const value = JSON.stringify({
        folder: release,
        provider: runtime.provider,
      });
      await atomicWrite(config, value);
      installedConfig = value;
      await progress(100, "组件已安装并启用", true);
      signal.throwIfAborted();
    } catch (e) {
      if (installedConfig && (await readOptional(config)) === installedConfig) {
        if (before === null) await fs.unlink(config);
        else await atomicWrite(config, before);
      }
      if (signal.aborted) throw e;
      throw e.safeMessage
        ? e
        : fail(`${stage}失败，原配置已保留；可重试继续安装`);
    } finally {
      await unlock?.();
    }
  }
}
module.exports = {
  RuntimeInstaller,
  installRoot,
  lockRoot,
  runtimeEnvironment,
};
