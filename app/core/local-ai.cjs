const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const sharp = require("sharp");
const { atomicWrite, safePath } = require("./storage.cjs");
const { hashFile } = require("./runtime-files.cjs");
const { referenceBytes } = require("./generation.cjs");
const { dimensions } = require("./image-tools.cjs");
const { runProcess } = require("./local-process.cjs");
const { localToolReadiness } = require("./local-readiness.cjs");

const cutoutModels = require('../runtime/cutout-models.json');
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
      : { operation, model: settings.model || 'birefnet', edgeShrink: settings.edgeShrink ?? 0, edgeFeather: settings.edgeFeather ?? 0 };
  if (operation === 'cutout' && !Object.hasOwn(cutoutModels, value.model))
    throw failure('抠图模型无效');
  if (operation === 'cutout' && (!Number.isInteger(value.edgeShrink) || value.edgeShrink < 0 || value.edgeShrink > 4 || !Number.isFinite(value.edgeFeather) || value.edgeFeather < 0 || value.edgeFeather > 4))
    throw failure('边缘收缩须为 0–4 px 整数，向内羽化须为 0–4 px');
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
    await atomicWrite(await safePath(this.root, 'runtime', 'cutout-models.json'), JSON.stringify(cutoutModels));
    return file;
  }
  async inspect(folder, provider, signal, cutoutFolder = folder) {
    if (typeof folder !== "string" || !path.isAbsolute(folder))
      throw failure("请选择本地组件目录");
    const pythonDirectory = await safePath(
      cutoutFolder,
      "segment-python",
      process.platform === "win32" ? "Scripts" : "bin",
    );
    // POSIX venv interpreters normally link to the system Python. Keep the venv
    // path for prefix detection; only this user-selected executable may be a link.
    const python = path.join(
      pythonDirectory,
      process.platform === "win32" ? "python.exe" : "python3",
    );
    let probe = { providers: [], memory: null }, cutoutReason = "";
    try {
      if (!(await fs.stat(await fs.realpath(python))).isFile())
        throw failure("本地 Python 组件无效");
      await fs.access(python);
      const output = await runProcess(
        python,
        ["-I", "-u", await this.worker(), "probe"],
        { timeout: 30000, signal },
      );
      probe = JSON.parse(output.trim().split("\n").at(-1));
    } catch (e) {
      signal?.throwIfAborted();
      cutoutReason = "抠图运行环境缺失或不可用，请安装抠图组件";
    }
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
      cutoutReason ||= "所选抠图计算设备不可用，请改为自动选择或 CPU";
    const modelPaths = {}, availableCutoutModels = [];
    for (const [key, profile] of Object.entries(cutoutModels)) {
      const file = await safePath(cutoutFolder, 'segmentation', profile.file);
      modelPaths[key] = file;
      try {
        if (!cutoutReason && (await hashFile(file, signal)) === profile.sha256) availableCutoutModels.push(key);
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    const cutout = availableCutoutModels.length > 0;
    if (!cutout) cutoutReason ||= "主体模型缺失或校验失败，请重新安装抠图组件";
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
      cutoutFolder,
      python,
      executable,
      model: modelPaths.birefnet,
      modelPaths,
      availableCutoutModels,
      cutout,
      cutoutReason,
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
    const status = {
      configured: true,
      memory:r.memory,
      folder: r.folder,
      cutoutFolder: r.cutoutFolder,
      cutout: r.cutout,
      cutoutModels: r.availableCutoutModels,
      cutoutReason: r.cutoutReason,
      models: r.availableModels,
      provider: r.provider,
      providers: r.providers,
    };
    return { ...status, readiness: {
      upscale: localToolReadiness(status, {operation:'upscale', model:'general'}),
      cutout: localToolReadiness(status, {operation:'cutout'}),
      cutoutLight: localToolReadiness(status, {operation:'cutout', model:'u2netp'}),
    } };
  }
  async runtime(provider) {
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
    return this.inspect(saved.folder, provider || saved.provider, undefined, saved.cutoutFolder);
  }
  status() {
    // Share only in-flight probes; memory and component state stay fresh on refresh.
    this.statusRequest ??= this.runtime().then(runtime=>this.publicRuntime(runtime)).catch(e=>({
        configured: false,
        message: e.safeMessage || "本地组件不可用，请重新选择目录",
      })).then(status=>({...status,downloadFolder:path.join(path.dirname(this.root),'components','tugou-components')})).finally(()=>{this.statusRequest=null;});
    return this.statusRequest;
  }
  async resolveRuntime(settings, snapshot, size) {
    const provider = settings.operation === 'cutout' && settings.model === 'u2netp' ? 'CPUExecutionProvider' : undefined;
    const runtime = snapshot
      ? await this.inspect(snapshot.folder, provider || snapshot.provider, undefined, snapshot.cutoutFolder)
      : await this.runtime(provider);
    const ready = localToolReadiness(this.publicRuntime(runtime), settings, size);
    if (!ready.ready) throw failure(ready.reason);
    return runtime;
  }
  async execute(job, runtime, signal, id, onPart, onProgress) {
    for (let inputIndex = 0; inputIndex < job.inputs.length; inputIndex++) {
      signal.throwIfAborted();
      const stage = (message, percent = 0) =>
        onProgress(
          Math.floor((inputIndex * 100 + percent) / job.inputs.length),
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
      model: settings.operation === 'cutout' ? runtime.modelPaths?.[settings.model || 'birefnet'] || runtime.model : runtime.model,
      cutoutModel: settings.model || 'birefnet',
      edgeShrink: settings.edgeShrink ?? 0,
      edgeFeather: settings.edgeFeather ?? 0,
      provider: runtime.provider,
      scale: settings.scale,
    };
    const specFile = path.join(job, "job.json"),
      script = settings.operation === "cutout" ? await this.worker() : null;
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
        stage("准备原图", 2);
        const source = await sharp(spec.input, { limitInputPixels: 100000000 }).rotate().ensureAlpha().png().toBuffer();
        const metadata = await sharp(source).metadata();
        dimensions(metadata.width * settings.scale, metadata.height * settings.scale);
        await sharp(source).removeAlpha().png().toFile(spec.rgb);
        signal.throwIfAborted();
        stage("超分处理中", 5);
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
            "0",
            "-j",
            "1:1:1",
            "-f",
            "png",
          ],
          { cwd: job, signal, onStderrLine: line => {
            const match = /^\s*(\d+(?:\.\d+)?)%\s*$/.exec(line);
            if (match && !signal.aborted) stage(`超分处理中 · ${Math.min(100, Number(match[1]))}%`, 5 + Math.min(100, Number(match[1])) * 0.85);
          } },
        );
        signal.throwIfAborted();
        stage("恢复透明通道", 92);
        const width = metadata.width * settings.scale, height = metadata.height * settings.scale;
        const enhanced = await sharp(spec.enhanced).metadata();
        if (enhanced.width !== width || enhanced.height !== height) throw failure("超分输出尺寸不正确，未导入结果");
        const alpha = await sharp(source).extractChannel('alpha').resize(width, height, { fit: 'fill' }).raw().toBuffer();
        const rgb = await sharp(spec.enhanced).removeAlpha().toColourspace('srgb').raw().toBuffer();
        await sharp(rgb, { raw: { width, height, channels: 3 } }).joinChannel(alpha, { raw: { width, height, channels: 1 } }).png().toFile(spec.output);
      }
      signal.throwIfAborted();
      return await fs.readFile(spec.output);
    } catch (e) {
      if (e.output) {
        for (const line of e.output.split("\n"))
          try {
            const value = JSON.parse(line);
            if (value.error === '抠图可用内存不足，请关闭占用内存的应用后重试')
              throw failure(value.error);
          } catch (error) {
            if (error.safeMessage) throw error;
          }
      }
      if (settings.operation === 'upscale' && e.safeMessage === '本地组件运行失败，请检查模型、显卡和可用内存')
        throw failure('超分引擎运行失败，请检查显卡驱动是否支持 Vulkan；也可使用分辨率调整进行普通缩放');
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
