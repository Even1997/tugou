const fs = require("node:fs/promises");
const { atomicWrite, safePath, validateDocument } = require("./storage.cjs");
const {
  referenceBytes,
  imageExtension,
  boundedBytes,
} = require("./generation.cjs");
const {
  analysisPrompt,
  normalizeAnalysis,
  validateReview,
} = require("./analysis-draft.cjs");
const failure = (message) =>
  Object.assign(new Error(message), { safeMessage: message });

class AnalysisService {
  constructor(projects, connections, tasks) {
    Object.assign(this, { projects, connections, tasks });
    this.root = projects.root;
  }
  async start(projectId, document, assetId, instruction = "") {
    await this.projects.read(projectId);
    validateDocument(document);
    if (typeof instruction !== "string" || instruction.length > 4000)
      throw failure("分析要求请控制在 4000 字以内");
    const asset = document.assets.find((a) => a.id === assetId);
    if (!asset) throw failure("请先选择参考图");
    const busy = () =>
      this.tasks
        .list()
        .some(
          (t) =>
            t.context?.kind === "analysis" &&
            t.context.projectId === projectId &&
            t.context.assetId === assetId &&
            ["queued", "running"].includes(t.status),
        );
    if (busy()) throw failure("这张参考图已有分析任务");
    const settings = await this.connections.readPrivate('analysis');
    if (!settings.baseUrl || !settings.apiKey || !settings.analysisModel)
      throw failure("请先在模型连接中配置 API 地址、密钥和视觉分析模型");
    const bytes = await referenceBytes(this.root, asset);
    if (bytes.length > 20 * 1024 * 1024)
      throw failure("参考图超过 20 MiB，请先缩小后分析");
    const extension = imageExtension(bytes);
    if (busy()) throw failure("这张参考图已有分析任务");
    const context = {
      kind: "analysis",
      projectId,
      assetId,
      model: settings.analysisModel,
    };
    const task = await this.tasks.start(
      `分析 · ${asset.name || "参考图"}`,
      async (cancelSignal, id) => {
        const signal = AbortSignal.any([
          cancelSignal,
          AbortSignal.timeout(180000),
        ]);
        const text =
          instruction.trim() || "拆解实际画面，生成可独立替换的提示词模块。";
        await atomicWrite(
          await safePath(this.root, "analysis-requests", `${id}.json`),
          JSON.stringify({
            projectId,
            assetId,
            model: settings.analysisModel,
            instruction: text,
          }),
        );
        let response;
        try {
          response = await fetch(
            settings.baseUrl.replace(/\/$/, "") +
              (settings.baseUrl.endsWith("/v1") ? "" : "/v1") +
              "/chat/completions",
            {
              method: "POST",
              redirect: "error",
              signal,
              headers: {
                Authorization: `Bearer ${settings.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: settings.analysisModel,
                messages: [
                  { role: "system", content: analysisPrompt },
                  {
                    role: "user",
                    content: [
                      { type: "text", text },
                      {
                        type: "image_url",
                        image_url: {
                          url: `data:image/${extension === "jpg" ? "jpeg" : extension};base64,${bytes.toString("base64")}`,
                        },
                      },
                    ],
                  },
                ],
                max_tokens: 8000,
              }),
            },
          );
        } catch (error) {
          if (signal.aborted) throw error;
          throw failure("分析连接失败，请检查 API 地址和网络");
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw failure(`分析请求失败（HTTP ${response.status}），未自动重试`);
        }
        let analyzed;
        try {
          const payload = JSON.parse(
            (await boundedBytes(response, 1024 * 1024)).toString("utf8"),
          );
          const choice = payload.choices?.[0];
          if (choice?.finish_reason === "length")
            throw failure("分析输出被截断，请缩小分析范围后重试");
          const content = choice?.message?.content;
          if (typeof content !== "string") throw new Error("No content");
          analyzed = normalizeAnalysis(
            JSON.parse(
              content
                .trim()
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```$/, ""),
            ),
          );
        } catch (error) {
          throw error.safeMessage
            ? error
            : failure(
                "分析返回格式不支持，需要包含有效 JSON 的视觉 Chat Completions 响应",
              );
        }
        signal.throwIfAborted();
        await atomicWrite(
          await safePath(this.root, "analyses", `${id}.json`),
          JSON.stringify({
            id,
            ...context,
            createdAt: new Date().toISOString(),
            ...analyzed,
          }),
        );
        return id;
      },
      context,
    );
    return { id: task.id };
  }
  async read(projectId, id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw failure("分析编号无效");
    const task = this.tasks
      .list()
      .find(
        (t) =>
          t.id === id &&
          t.context?.kind === "analysis" &&
          t.context.projectId === projectId &&
          t.status === "completed",
      );
    if (!task) throw failure("分析尚未完成或不属于当前工程");
    const draft = JSON.parse(
      await fs.readFile(
        await safePath(this.root, "analyses", `${id}.json`),
        "utf8",
      ),
    );
    if (draft.id !== id || draft.projectId !== projectId)
      throw failure("分析归属校验失败");
    normalizeAnalysis(draft);
    return draft;
  }
  async results(projectId) {
    await this.projects.read(projectId);
    const results = [];
    for (const task of this.tasks
      .list()
      .filter(
        (t) =>
          t.context?.kind === "analysis" &&
          t.context.projectId === projectId &&
          t.status === "completed",
      )) {
      const draft = await this.read(projectId, task.id);
      try {
        draft.review = validateReview(
          JSON.parse(
            await fs.readFile(
              await safePath(this.root, "analysis-reviews", `${task.id}.json`),
              "utf8",
            ),
          ),
          draft.modules.length,
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      results.push(draft);
    }
    return results;
  }
  async saveReview(projectId, id, input) {
    const draft = await this.read(projectId, id),
      review = validateReview(input, draft.modules.length);
    await atomicWrite(
      await safePath(this.root, "analysis-reviews", `${id}.json`),
      JSON.stringify(review),
    );
    return review;
  }
  async recover() {
    for (const task of this.tasks.tasks) {
      if (task.context?.kind !== "analysis" || task.status !== "interrupted")
        continue;
      try {
        const draft = JSON.parse(
          await fs.readFile(
            await safePath(this.root, "analyses", `${task.id}.json`),
            "utf8",
          ),
        );
        if (draft.id !== task.id || draft.projectId !== task.context.projectId)
          continue;
        normalizeAnalysis(draft);
        task.status = "completed";
        task.resultId = task.id;
        task.message = "已恢复分析草稿，未重复请求模型";
      } catch {
        /* No completed result: retain the interrupted status. */
      }
    }
    await this.tasks.persist();
  }
}
module.exports = { AnalysisService };

