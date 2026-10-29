const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const {
  atomicWrite,
  safePath,
  hash,
  validateDocument,
} = require("./storage.cjs");
const { referenceBytes, saveImage } = require("./generation.cjs");
const { validateLocalSettings } = require("./local-ai.cjs");
const {
  operations,
  defaults,
  dimensions,
  outputGeometry,
  validateSettings,
  parseCube,
} = require("./image-tools.cjs");
const {
  compositionNames,
  compositionDefaults,
  validateComposition,
} = require("./image-composition.cjs");
const aiNames = { upscale: "AI 超分辨率", cutout: "主体抠图" };
const aiDefaults = { upscale: { model: "general", scale: 4 }, cutout: { model: 'birefnet', edgeShrink: 0, edgeFeather: 0 } };
const names = { ...operations, ...compositionNames, ...aiNames };
const fail = (message) =>
  Object.assign(new Error(message), { safeMessage: message });
function validateJob(job) {
  const { inputs, secondary, settings: s } = job;
  if (
    !s ||
    !Object.hasOwn(names, s.operation) ||
    !Array.isArray(inputs) ||
    !inputs.length ||
    inputs.length > 64
  )
    throw fail("请选择 1–64 张素材及有效工具");
  if (new Set(inputs.map((a) => a.id)).size !== inputs.length)
    throw fail("批量素材不能重复");
  for (const input of inputs) {
    dimensions(input.width, input.height);
    if (Object.hasOwn(aiNames, s.operation)) validateLocalSettings(s, input);
    else if (Object.hasOwn(compositionNames, s.operation))
      validateComposition(s, input.width, input.height, secondary);
    else {
      validateSettings(s);
      if (["resize", "extend", "rotate", "mirror"].includes(s.operation))
        outputGeometry(s, input.width, input.height);
    }
  }
  if (s.operation === "lut") parseCube(s.lutText);
}
class ImageTaskService {
  constructor(projects, tasks, inspectImage, execute, localAI) {
    Object.assign(this, {
      projects,
      tasks,
      inspectImage,
      execute,
      localAI,
      root: projects.root,
    });
  }
  async normalizeAsset(asset) {
    if (!asset || typeof asset.id !== "string")
      throw fail("原图已移除且没有历史快照");
    return {
      id: asset.id,
      name: typeof asset.name === "string" ? asset.name : "素材",
      ...(await saveImage(
        this.root,
        await referenceBytes(this.root, asset),
        this.inspectImage,
      )),
    };
  }
  async start(projectId, document, sourceIds, options) {
    await this.projects.read(projectId);
    validateDocument(document);
    if (
      !Array.isArray(sourceIds) ||
      sourceIds.length < 1 ||
      sourceIds.length > 64 ||
      new Set(sourceIds).size !== sourceIds.length
    )
      throw fail("请选择 1–64 张不同素材");
    if (!options || !Object.hasOwn(names, options.operation))
      throw fail("不支持的图像工具");
    const base =
      { ...defaults, ...compositionDefaults, ...aiDefaults }[
        options.operation
      ] || {};
    const settings = {
      operation: options.operation,
      ...Object.fromEntries(
        Object.keys(base).map((k) => [k, options[k] ?? base[k]]),
      ),
    };
    if (options.operation === "resize") settings.scale = options.scale;
    if (options.operation === "extend") settings.padding = options.padding;
    if (options.operation === "lut")
      settings.lutText = document.imageToolLuts?.find(
        (l) => l.id === settings.lutId,
      )?.text;
    const find = (id) =>
      document.assets.find((a) => a.id === id) ||
      document.assets
        .flatMap((a) => [a.toolResult?.source, a.toolResult?.secondary])
        .find((a) => a?.id === id);
    const inputs = [];
    for (const id of sourceIds)
      inputs.push(await this.normalizeAsset(find(id)));
    const secondary = ["mattePair", "texture", "patch"].includes(
      options.operation,
    )
      ? await this.normalizeAsset(find(settings.secondaryId))
      : undefined;
    const job = { projectId, inputs, secondary, settings };
    validateJob(job);
    let runtime;
    if (Object.hasOwn(aiNames, settings.operation)) {
      runtime = await this.localAI.resolveRuntime(settings, undefined, inputs.reduce((a,b) => a.width*a.height>b.width*b.height ? a : b));
      job.runtime = { folder: runtime.folder, cutoutFolder: runtime.cutoutFolder, provider: runtime.provider };
    }
    const requestId = randomUUID();
    await atomicWrite(
      await safePath(this.root, "requests", `tool-${requestId}.json`),
      JSON.stringify(job),
    );
    return this.enqueue(job, requestId, undefined, runtime);
  }
  async retry(id) {
    const previous = this.tasks.tasks.find((t) => t.id === id);
    if (
      !["raster", "local-ai"].includes(previous?.context?.engine) ||
      !["failed", "cancelled", "interrupted"].includes(previous.status)
    )
      throw fail("只有失败、取消或中断的图像任务可以重试");
    const requestId = previous.context.requestId;
    if (!/^[a-f0-9-]{36}$/.test(requestId || "")) throw fail("任务快照无效");
    const job = JSON.parse(
      await fs.readFile(
        await safePath(this.root, "requests", `tool-${requestId}.json`),
        "utf8",
      ),
    );
    if (job.projectId !== previous.context.projectId)
      throw fail("任务快照与工程不一致");
    if (
      Object.hasOwn(aiNames, job.settings?.operation) &&
      (!job.runtime ||
        typeof job.runtime.folder !== "string" ||
        typeof job.runtime.provider !== "string")
    )
      throw fail("本地组件快照无效，无法按原参数重试");
    await this.projects.read(job.projectId);
    validateJob(job);
    await this.projects.verifyResources([
      ...job.inputs,
      ...(job.secondary ? [job.secondary] : []),
    ]);
    const runtime = Object.hasOwn(aiNames, job.settings.operation)
      ? await this.localAI.resolveRuntime(job.settings, job.runtime, job.inputs.reduce((a,b) => a.width*a.height>b.width*b.height ? a : b))
      : undefined;
    return this.enqueue(job, requestId, id, runtime);
  }
  async enqueue(job, requestId, retriedFrom, runtime) {
    const key = hash(JSON.stringify(job));
    if (
      this.tasks.tasks.some(
        (t) =>
          t.context?.requestKey === key &&
          ["queued", "running"].includes(t.status),
      )
    )
      throw fail("相同图像任务正在处理，请等待或取消");
    const name = names[job.settings.operation];
    const isAI = Object.hasOwn(aiNames, job.settings.operation);
    const task = await this.tasks.start(
      job.inputs.length === 1
        ? `${job.inputs[0].name} · ${name}`
        : `${name} · ${job.inputs.length} 张`,
      async (signal, id) => {
        const outputs = [],
          counts = new Map();
        let nextInput = 0;
        const entry = this.tasks.tasks.find((t) => t.id === id);
        try {
          const execute = isAI
            ? (job, signal, part, progress) =>
                this.localAI.execute(job, runtime, signal, id, part, progress)
            : this.execute;
          await execute(
            job,
            signal,
            async (part) => {
              signal.throwIfAborted();
              if (
                part.inputIndex !== nextInput ||
                !Number.isInteger(part.index) ||
                !Number.isInteger(part.count) ||
                part.count < 1 ||
                part.count > 64 ||
                part.index < 0 ||
                part.index >= part.count
              )
                throw fail("处理结果顺序或数量无效");
              const prior = counts.get(nextInput) || {
                count: part.count,
                received: 0,
              };
              if (
                prior.count !== part.count ||
                prior.received !== part.index ||
                (job.settings.operation !== "split" && part.count !== 1)
              )
                throw fail("处理结果不完整");
              const input = job.inputs[nextInput],
                output = await saveImage(
                  this.root,
                  Buffer.from(part.bytes),
                  this.inspectImage,
                );
              let expected = input;
              if (job.settings.operation === "upscale")
                expected = {
                  width: input.width * job.settings.scale,
                  height: input.height * job.settings.scale,
                };
              if (
                ["resize", "extend", "rotate", "mirror"].includes(
                  job.settings.operation,
                )
              )
                expected = outputGeometry(
                  job.settings,
                  input.width,
                  input.height,
                );
              if (["crop", "pattern", "tile"].includes(job.settings.operation))
                expected = job.settings;
              if (
                output.width !== expected.width ||
                output.height !== expected.height
              )
                throw fail("处理结果尺寸异常，未入库");
              signal.throwIfAborted();
              const { lutText, ...settings } = job.settings;
              outputs.push({
                id: randomUUID(),
                name: `${input.name} · ${typeof part.name === "string" ? part.name.slice(0, 100) : name}`,
                ...output,
                toolResult: {
                  ...settings,
                  sourceId: input.id,
                  source: input,
                  secondary: job.secondary,
                  taskId: id,
                  batchId: id,
                  partIndex: part.index,
                  partCount: part.count,
                  inputIndex: nextInput,
                  bounds: part.bounds,
                  createdAt: new Date().toISOString(),
                },
              });
              counts.set(nextInput, {
                count: part.count,
                received: part.index + 1,
              });
              if (part.index + 1 === part.count) nextInput++;
            },
            (progress, stage) => {
              if (!signal.aborted && Number.isFinite(progress)) {
                entry.progress = Math.max(
                  entry.progress || 0,
                  Math.min(99, Math.max(0, Math.floor(progress))),
                );
                entry.message =
                  typeof stage === "string"
                    ? stage.slice(0, 120)
                    : `处理中 ${entry.progress}%`;
              }
            },
          );
          signal.throwIfAborted();
          if (nextInput !== job.inputs.length || !outputs.length)
            throw fail("图像结果不完整，未入库");
          await atomicWrite(
            await safePath(this.root, "results", `${id}.json`),
            JSON.stringify({
              id,
              kind: "local-tool",
              projectId: job.projectId,
              assets: outputs,
            }),
          );
          // A cancellation after the durable write still stays cancelled; recovery never publishes cancelled tasks.
          signal.throwIfAborted();
          entry.progress = 100;
          entry.message = `已完成 ${job.inputs.length} 张原图，${outputs.length} 张结果`;
          return id;
        } catch (error) {
          throw error.name === "AbortError"
            ? error
            : fail(error.safeMessage || error.message || "图像处理失败");
        }
      },
      {
        kind: "local-tool",
        engine: isAI ? "local-ai" : "raster",
        projectId: job.projectId,
        sourceId: job.inputs.length === 1 ? job.inputs[0].id : undefined,
        sourceIds: job.inputs.map((a) => a.id),
        operation: job.settings.operation,
        model: isAI ? `${name} · 本地` : "图像工具 · 本地",
        requestId,
        requestKey: key,
        retriedFrom,
      },
    );
    return { id: task.id };
  }
}
module.exports = { ImageTaskService, validateJob };
