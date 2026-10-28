const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { atomicWrite, safePath } = require("./storage.cjs");
const { hashFile } = require("./runtime-files.cjs");
const { referenceBytes } = require("./generation.cjs");
const { dimensions } = require("./image-tools.cjs");
const { runProcess } = require("./local-process.cjs");

const modelHash =
  "3654c741eb80bd926ada8fed1713b506ccf8d30eb1f6487e87eb9f234f33df09";
const models = {
  general: "realesrgan-x4plus",
  illustration: "realesrgan-x4plus-anime",
  anime: "realesr-animevideov3",
};
const failure = (message) =>
  Object.assign(new Error(message), { safeMessage: message });
function validateLocalSettings(settings, size) {
  const operation = settings?.operation;
  if (!["upscale", "cutout"].includes(operation))
    throw failure("不支持的本地 AI 工具");
  const value =
    operation === "upscale"
      ? { operation, model: settings.model, scale: settings.scale }
      : { operation };
  if (
    operation === "upscale" &&
    (!Object.hasOwn(models, value.model) ||
      ![2, 3, 4].includes(value.scale) ||
      (value.model !== "anime" && value.scale !== 4))
  )
    throw failure("超分模型或倍率无效");
  dimensions(size.width * (value.scale || 1), size.height * (value.scale || 1));
  return value;
}
class LocalAIService {
  constructor(projects) {
    this.root = projects.root;
  }
  async worker() {
    const file = await safePath(this.root, "runtime", "image-worker.py");
    await atomicWrite(
      file,
      await fs.readFile(path.join(__dirname, "../runtime/image-worker.py")),
    );
    return file;
  }
  async inspect(folder, provider, signal) {
    if (typeof folder !== "string" || !path.isAbsolute(folder))
      throw failure("请选择本地组件目录");
    const pythonDirectory = await safePath(
      folder,
      "segment-python",
      process.platform === "win32" ? "Scripts" : "bin",
    );
    // POSIX venv interpreters normally link to the system Python. Keep the venv
    // path for prefix detection; only this user-selected executable may be a link.
    const python = path.join(
      pythonDirectory,
      process.platform === "win32" ? "python.exe" : "python3",
    );
    if (!(await fs.stat(await fs.realpath(python))).isFile())
      throw failure("本地 Python 组件无效");
    await fs.access(python);
    const output = await runProcess(
      python,
      ["-I", "-u", await this.worker(), "probe"],
      { timeout: 30000, signal },
    );
    const probe = JSON.parse(output.trim().split("\n").at(-1));
    const selected =
      provider ||
      (probe.providers.includes("DmlExecutionProvider")
        ? "DmlExecutionProvider"
        : probe.providers.includes("CoreMLExecutionProvider")
          ? "CoreMLExecutionProvider"
          : "CPUExecutionProvider");
    if (
      ![
        "DmlExecutionProvider",
        "CoreMLExecutionProvider",
        "CPUExecutionProvider",
      ].includes(selected) ||
      !probe.providers.includes(selected)
    )
      throw failure("所选计算设备不可用");
    const model = await safePath(
      folder,
      "segmentation",
      "birefnet-general-fp16.onnx",
    );
    let cutout = false;
    try {
      cutout = (await hashFile(model, signal)) === modelHash;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    let executable;
    for (const name of ["realesrgan", "realesrgan-20220424"]) {
      const candidate = await safePath(
        folder,
        name,
        `realesrgan-ncnn-vulkan${process.platform === "win32" ? ".exe" : ""}`,
      );
      try {
        await fs.access(candidate);
        executable = candidate;
        break;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    const availableModels = [];
    if (executable)
      for (const [key, name] of Object.entries(models)) {
        const names =
          key === "anime" ? [2, 3, 4].map((n) => `${name}-x${n}`) : [name];
        try {
          for (const n of names)
            for (const ext of ["bin", "param"])
              await fs.access(
                await safePath(
                  path.dirname(executable),
                  "models",
                  `${n}.${ext}`,
                ),
              );
          availableModels.push(key);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
    return {
      folder,
      python,
      executable,
      model,
      cutout,
      memory:probe.memory,
      availableModels,
      provider: selected,
      providers: probe.providers.filter((p) =>
        [
          "DmlExecutionProvider",
          "CoreMLExecutionProvider",
          "CPUExecutionProvider",
        ].includes(p),
      ),
    };
  }
  async configure(folder, provider, signal) {
    const runtime = await this.inspect(folder, provider, signal);
    if (!runtime.cutout && !runtime.availableModels.length)
      throw failure("目录内没有可用的超分或主体模型");
    signal?.throwIfAborted();
    await atomicWrite(
      await safePath(this.root, "local-runtime.json"),
      JSON.stringify({ folder, provider: runtime.provider }),
    );
    return this.publicRuntime(runtime);
  }
  publicRuntime(r) {
    return {
      configured: true,
      memory:r.memory,
      folder: r.folder,
      cutout: r.cutout,
      models: r.availableModels,
      provider: r.provider,
      providers: r.providers,
    };
  }
  async runtime() {
    let saved;
    try {
      saved = JSON.parse(
        await fs.readFile(
          await safePath(this.root, "local-runtime.json"),
          "utf8",
        ),
      );
    } catch (e) {
      if (e.code === "ENOENT") throw failure("请先选择本地组件目录");
      throw e;
    }
    return this.inspect(saved.folder, saved.provider);
  }
  status() {
    // Share only in-flight probes; memory and component state stay fresh on refresh.
    this.statusRequest ??= this.runtime().then(runtime=>this.publicRuntime(runtime)).catch(e=>({
        configured: false,
        message: e.safeMessage || "本地组件不可用，请重新选择目录",
      })).finally(()=>{this.statusRequest=null;});
    return this.statusRequest;
  }
  async resolveRuntime(settings, snapshot) {
    const runtime = snapshot
      ? await this.inspect(snapshot.folder, snapshot.provider)
      : await this.runtime();
    if (
      settings.operation === "cutout"
        ? !runtime.cutout
        : !runtime.availableModels.includes(settings.model)
    )
      throw failure("所需模型缺失或校验失败，请检查本地组件");
    return runtime;
  }
  async execute(job, runtime, signal, id, onPart, onProgress) {
    for (let inputIndex = 0; inputIndex < job.inputs.length; inputIndex++) {
      signal.throwIfAborted();
      const stage = (message) =>
        onProgress(
          Math.floor((inputIndex * 100) / job.inputs.length),
          inputIndex + 1 + "/" + job.inputs.length + " · " + message,
        );
      const bytes = await this.processInput(
        job.inputs[inputIndex],
        job.settings,
        runtime,
        signal,
        id,
        stage,
      );
      signal.throwIfAborted();
      await onPart({ bytes, inputIndex, index: 0, count: 1 });
      onProgress(Math.floor(((inputIndex + 1) * 100) / job.inputs.length));
    }
  }
  async processInput(input, settings, runtime, signal, id, stage) {
    const job = await safePath(this.root, "local-jobs", id);
    await fs.mkdir(job, { recursive: true });
    const spec = {
      input: path.join(job, "input"),
      output: path.join(job, "output.png"),
      rgb: path.join(job, "rgb.png"),
      enhanced: path.join(job, "enhanced.png"),
      model: runtime.model,
      provider: runtime.provider,
      scale: settings.scale,
    };
    const specFile = path.join(job, "job.json"),
      script = await this.worker();
    const onLine = (line) => {
      try {
        const value = JSON.parse(line);
        if (typeof value.stage === "string" && !signal.aborted)
          stage(value.stage);
      } catch {}
    };
    const invoke = (mode) =>
      runProcess(runtime.python, ["-I", "-u", script, specFile, mode], {
        cwd: job,
        signal,
        onLine,
      });
    try {
      signal.throwIfAborted();
      if (
        os.freemem() <
        512 * 1024 * 1024 +
          input.width * input.height * (settings.scale || 1) ** 2 * 16
      )
        throw failure("可用内存不足，请降低倍率或关闭占用内存的应用");
      await atomicWrite(spec.input, await referenceBytes(this.root, input));
      await atomicWrite(specFile, JSON.stringify(spec));
      if (settings.operation === "cutout") await invoke("cutout");
      else {
        stage("准备原图");
        await invoke("prepare");
        stage("超分处理中");
        await runProcess(
          runtime.executable,
          [
            "-i",
            spec.rgb,
            "-o",
            spec.enhanced,
            "-n",
            models[settings.model],
            "-m",
            path.join(path.dirname(runtime.executable), "models"),
            "-s",
            String(settings.scale),
            "-t",
            "256",
            "-j",
            "1:1:1",
            "-f",
            "png",
          ],
          { cwd: job, signal },
        );
        stage("恢复透明通道");
        await invoke("finish");
      }
      signal.throwIfAborted();
      return await fs.readFile(spec.output);
    } catch (e) {
      if (e.output) {
        for (const line of e.output.split("\n"))
          try {
            const value = JSON.parse(line);
            if (value.error?.startsWith("精细抠图可用内存不足"))
              throw failure(value.error);
          } catch (error) {
            if (error.safeMessage) throw error;
          }
      }
      throw e;
    } finally {
      // Remove only files owned by this input, after its process tree has stopped.
      for (const file of [
        "input",
        "output.png",
        "rgb.png",
        "enhanced.png",
        "job.json",
      ])
        await fs.rm(path.join(job, file), { force: true }).catch(() => {});
      await fs.rmdir(job).catch(() => {});
    }
  }
}
module.exports = { LocalAIService, validateLocalSettings };
