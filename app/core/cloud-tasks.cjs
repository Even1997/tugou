const fs = require("node:fs/promises"),
  { randomUUID } = require("node:crypto");
const {
  safePath,
  atomicWrite,
  validateDocument,
  hash,
} = require("./storage.cjs");
const { saveImage, referenceBytes } = require("./generation.cjs");
const { requestImages } = require("./image-api.cjs");
const {
  cloudSettings,
  cloudPrompt,
  cloudNames,
} = require("./cloud-settings.cjs");
const fail = (message) =>
  Object.assign(Error(message), { safeMessage: message });
class CloudTaskService {
  constructor(projects, connections, tasks, inspectImage, run) {
    Object.assign(this, {
      projects,
      connections,
      tasks,
      inspectImage,
      run,
      root: projects.root,
    });
  }
  task(id) {
    const t = this.tasks.tasks.find(
      (t) => t.id === id && t.context?.kind === "cloud-tool",
    );
    if (!t) throw fail("云端任务不存在");
    return t;
  }
  async readRaw(id) {
    const task = this.task(id);
    const raw = JSON.parse(
      await fs.readFile(
        await safePath(this.root, "cloud-raw", id + ".json"),
        "utf8",
      ),
    );
    if (raw.id !== id || raw.job.projectId !== task.context.projectId)
      throw fail("任务数据不一致");
    await this.projects.read(raw.job.projectId);
    await this.projects.verifyResources(
      [raw.asset, raw.job.source, raw.job.mask].filter(Boolean),
    );
    return raw;
  }
  async review(id) {
    const raw = await this.readRaw(id);
    return {
      ...raw,
      resolvedTaskId:
        this.task(id).status === "completed"
          ? id
          : this.tasks.tasks.find(
              (t) =>
                t.context?.cloudParentId === id &&
                t.context?.action === "finish" &&
                t.status === "completed",
            )?.id,
    };
  }
  async recover() {
    for (const task of this.tasks.tasks.filter(
      (t) => t.context?.kind === "cloud-tool",
    )) {
      try {
        await this.readRaw(task.id);
        task.context.hasRaw = true;
        if (["interrupted", "failed"].includes(task.status)) {
          task.status = "review";
          task.message = "原始返回图已保留，请查看后继续；未重新请求模型";
        }
      } catch {}
    }
    await this.tasks.persist();
  }
  async prepare(projectId, document, sourceId, options) {
    await this.projects.read(projectId);
    validateDocument(document);
    const input =
      document.assets.find((a) => a.id === sourceId) ||
      document.assets.find((a) => a.toolResult?.source?.id === sourceId)
        ?.toolResult.source;
    if (!input) throw fail("请先选择素材");
    const source = {
      id: input.id,
      name: input.name,
      ...(await saveImage(
        this.root,
        await referenceBytes(this.root, input),
        this.inspectImage,
      )),
    };
    const { settings, size } = cloudSettings(options, source),
      connection = await this.connections.readPrivate('image');
    let mask;
    if (settings.operation === "cloudEdit" && settings.maskMode === "asset") {
      const inputMask =
        document.assets.find((a) => a.id === settings.maskId) ||
        document.assets.find((a) => a.toolResult?.mask?.id === settings.maskId)
          ?.toolResult.mask;
      if (!inputMask) throw fail("蒙版素材不存在，请重新选择");
      mask = {
        id: inputMask.id,
        name: inputMask.name,
        ...(await saveImage(
          this.root,
          await referenceBytes(this.root, inputMask),
          this.inspectImage,
        )),
      };
      if (mask.width !== source.width || mask.height !== source.height)
        throw fail('蒙版必须与每张来源图片尺寸一致');
    }
    if (!connection.baseUrl || !connection.model || !connection.apiKey)
      throw fail("请先在模型连接中填写 API 地址、密钥和生图模型");
    const job = {
      projectId,
      source,
      mask,
      settings,
      size,
      model: connection.model,
      endpoint: connection.baseUrl,
    };
    return { job, connection, key: hash(JSON.stringify(job)) };
  }
  async start(projectId, document, sourceId, options) {
    return this.submit(await this.prepare(projectId, document, sourceId, options));
  }
  async startBatch(projectId, document, sourceIds, options) {
    if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds.length > 64 || sourceIds.some(id => typeof id !== 'string'))
      throw fail('请选择 1–64 张来源图片');
    if (options?.operation === 'cloudSplit') throw fail('类别拆分请使用类别方案提交');
    // Validate every source and snapshot before any provider request is queued.
    const prepared = [];
    for (const id of new Set(sourceIds)) prepared.push(await this.prepare(projectId, document, id, options));
    if (prepared.some(p => this.tasks.tasks.some(t => t.context?.requestKey === p.key && ['queued', 'running'].includes(t.status))))
      throw fail('所选素材已有相同云端任务，请等待或取消');
    const batchId = randomUUID(), ids = [];
    for (const [index, p] of prepared.entries()) {
      p.job.batch = { batchId, batchIndex: index, batchCount: prepared.length };
      try { ids.push((await this.submit(p)).id); }
      catch (e) {
        if (!ids.length) throw e;
        return { batchId, ids, error: e.safeMessage || '部分任务未能提交，请在任务列表核对' };
      }
    }
    return { batchId, ids };
  }
  async cancelBatch(batchId) {
    if (typeof batchId !== 'string' || !batchId) throw fail('批次标识无效');
    const tasks = this.tasks.tasks.filter(t => t.context?.kind === 'cloud-tool' && t.context.batchId === batchId && ['queued', 'running'].includes(t.status));
    // Abort all controllers before waiting for journal writes; queued items must
    // not slip into execution while cancellation of their neighbour is saved.
    await Promise.all(tasks.map(t => this.tasks.cancel(t.id)));
    return tasks.length;
  }
  async submit({ job, connection, key }) {
    const { projectId, source, mask, settings, size } = job, sourceId = source.id;
    if (
      this.tasks.tasks.some(
        (t) =>
          t.context?.requestKey === key &&
          ["queued", "running"].includes(t.status),
      )
    )
      throw fail("相同云端任务正在处理，请等待或取消");
    const requestId = randomUUID();
    await atomicWrite(
      await safePath(this.root, "requests", "cloud-" + requestId + ".json"),
      JSON.stringify(job),
    );
    if (
      this.tasks.tasks.some(
        (t) =>
          t.context?.requestKey === key &&
          ["queued", "running"].includes(t.status),
      )
    )
      throw fail("相同云端任务正在处理，请等待或取消");
    const task = await this.tasks.start(
      `${source.name} · ${settings.operation === "cloudSplit" ? settings.instruction.slice(0, 80) : cloudNames[settings.operation]}`,
      async (signal, id) => {
        const entry = this.tasks.tasks.find((t) => t.id === id);
        try {
          entry.message = "准备上传图片";
          const prepared = await this.run(
            "prepare",
            await referenceBytes(this.root, source),
            null,
            settings,
            signal,
            false,
            mask ? await referenceBytes(this.root, mask) : undefined,
          );
          signal.throwIfAborted();
          job.source = {
            ...source,
            ...(await saveImage(
              this.root,
              prepared.canonical,
              this.inspectImage,
            )),
          };
          job.size = prepared.size;
          job.settings = prepared.settings;
          job.prompt = cloudPrompt(job.settings, job.size);
          await atomicWrite(
            await safePath(
              this.root,
              "requests",
              "cloud-" + requestId + ".json",
            ),
            JSON.stringify(job),
          );
          entry.context.requestedSize = `${job.size.width}x${job.size.height}`;
          entry.message = "模型处理中";
          const images = await requestImages(
            connection,
            {
              prompt: job.prompt,
              size: entry.context.requestedSize,
              images: [prepared.bytes],
              mask: prepared.mask,
            },
            AbortSignal.any([signal, AbortSignal.timeout(600000)]),
          );
          signal.throwIfAborted();
          if (images.length !== 1) throw fail("图像工具需要单张返回结果");
          const asset = {
            id: randomUUID(),
            name: `${source.name} · 模型原始图`,
            ...(await saveImage(this.root, images[0], this.inspectImage)),
          };
          const raw = { id, job, asset };
          await atomicWrite(
            await safePath(this.root, "cloud-raw", id + ".json"),
            JSON.stringify(raw),
          );
          signal.throwIfAborted();
          entry.context.hasRaw = true;
          entry.actualSizes = [`${asset.width}x${asset.height}`];
          await this.tasks.persist();
          try {
            entry.message = "合成保护区域";
            await this.complete(raw, id, signal, false);
            entry.message = "已完成，原图与模型原始返回均保留";
            return id;
          } catch (error) {
            if (signal.aborted) throw error;
            entry.message = error.safeMessage || error.message;
            return { review: true };
          }
        } catch (error) {
          throw signal.aborted
            ? error
            : fail(
                error.safeMessage ||
                  "云端图像处理失败，请检查连接、尺寸或本地内存",
              );
        }
      },
      {
        kind: "cloud-tool",
        engine: "cloud",
        projectId,
        sourceId,
        operation: settings.operation,
        model: connection.model,
        requestedSize: `${size.width}x${size.height}`,
        requestKey: key,
        requestId,
        ...job.batch,
      },
    );
    return { id: task.id };
  }
  async complete(raw, id, signal, fit) {
    const { job, asset } = raw;
    const result = await this.run(
      "finish",
      await referenceBytes(this.root, job.source),
      await referenceBytes(this.root, asset),
      job.settings,
      signal,
      fit,
      job.mask ? await referenceBytes(this.root, job.mask) : undefined,
    );
    signal.throwIfAborted();
    const output = await saveImage(this.root, result.bytes, this.inspectImage);
    if (output.width !== job.size.width || output.height !== job.size.height)
      throw fail("本地合成尺寸不符，未入库");
    const value = {
      id: randomUUID(),
      name: `${job.source.name} · ${job.settings.operation === "cloudSplit" ? job.settings.instruction.slice(0, 80) : cloudNames[job.settings.operation]}`,
      ...output,
      toolResult: {
        ...job.settings,
        ...job.batch,
        source: job.source,
        mask: job.mask,
        sourceId: job.source.id,
        taskId: id,
        cloudTaskId: raw.id,
        model: job.model,
        prompt: job.prompt,
        aligned: fit,
        createdAt: new Date().toISOString(),
      },
    };
    signal.throwIfAborted();
    await atomicWrite(
      await safePath(this.root, "results", id + ".json"),
      JSON.stringify({
        id,
        kind: "local-tool",
        projectId: job.projectId,
        assets: [value],
      }),
    );
    signal.throwIfAborted();
  }
  async resume(id, fit) {
    const raw = await this.readRaw(id),
      parent = this.task(id);
    if (typeof fit !== "boolean") throw fail("请选择原尺寸处理或明确缩小对齐");
    const active = this.tasks.tasks.find(
      (t) =>
        t.context?.cloudParentId === id &&
        t.context?.action === "finish" &&
        ["queued", "running", "completed"].includes(t.status),
    );
    if (active) return { id: active.id };
    if (parent.status === "completed") return { id: parent.id };
    const task = await this.tasks.start(
      `${raw.job.source.name} · 本地合成`,
      async (signal, taskId) => {
        try {
          await this.complete(raw, taskId, signal, fit);
          parent.context.resolvedTaskId = taskId;
          await this.tasks.persist();
          return taskId;
        } catch (error) {
          throw signal.aborted
            ? error
            : fail(error.safeMessage || error.message);
        }
      },
      {
        kind: "local-tool",
        engine: "cloud-finish",
        cloudParentId: id,
        action: "finish",
        projectId: raw.job.projectId,
        sourceId: raw.job.source.id,
        model: "本地处理 · 不请求模型",
      },
    );
    return { id: task.id };
  }
  async retry(id) {
    const task = this.task(id);
    if (!["failed", "cancelled", "interrupted", "review"].includes(task.status))
      throw fail("只能重新请求失败、中断、取消或待确认的任务");
    const job = JSON.parse(
      await fs.readFile(
        await safePath(
          this.root,
          "requests",
          "cloud-" + task.context.requestId + ".json",
        ),
        "utf8",
      ),
    );
    if (job.projectId !== task.context.projectId) throw fail("任务归属不一致");
    const connection = await this.connections.readPrivate('image');
    if (connection.baseUrl !== job.endpoint || connection.model !== job.model)
      throw fail("模型连接已改变，请恢复原模型连接，或从工具页按新连接提交");
    const current = await this.projects.read(job.projectId);
    const assets = current.document.assets.filter(
      (a) => a.id !== job.source.id && a.id !== job.mask?.id,
    );
    assets.push(job.source);
    if (job.mask) assets.push(job.mask);
    const prepared = await this.prepare(
      job.projectId,
      { ...current.document, assets },
      job.source.id,
      job.settings,
    );
    prepared.job.batch = job.batch;
    return this.submit(prepared);
  }
  async keepRaw(id) {
    const raw = await this.readRaw(id);
    const active = this.tasks.tasks.find(
      (t) =>
        t.context?.cloudParentId === id &&
        t.context?.action === "raw" &&
        ["queued", "running", "completed"].includes(t.status),
    );
    if (active) return { id: active.id };
    const task = await this.tasks.start(
      `${raw.job.source.name} · 保存原始图`,
      async (signal, taskId) => {
        signal.throwIfAborted();
        const asset = {
          ...raw.asset,
          generation: { taskId, cloudParentId: id, kind: "provider-original" },
        };
        await atomicWrite(
          await safePath(this.root, "results", taskId + ".json"),
          JSON.stringify({
            id: taskId,
            kind: "local-tool",
            projectId: raw.job.projectId,
            assets: [asset],
          }),
        );
        signal.throwIfAborted();
        return taskId;
      },
      {
        kind: "local-tool",
        engine: "cloud-raw",
        cloudParentId: id,
        action: "raw",
        projectId: raw.job.projectId,
        model: "原始返回 · 不请求模型",
      },
    );
    return { id: task.id };
  }
}
module.exports = { CloudTaskService };

