const fs = require("node:fs/promises");
const { atomicWrite, safePath, validateDocument } = require("./storage.cjs");
const { referenceBytes } = require("./generation.cjs");
const { boundedBytes, imageExtension } = require("./image-api.cjs");
const {
  semanticItems,
  semanticPrompt,
  normalizeCategories,
} = require("./semantic-plan.cjs");
const fail = (message) =>
  Object.assign(Error(message), { safeMessage: message });
class SemanticService {
  constructor(projects, connections, tasks, cloud) {
    Object.assign(this, {
      projects,
      connections,
      tasks,
      cloud,
      root: projects.root,
    });
  }
  async analyze(projectId, document, sourceId) {
    await this.projects.read(projectId);
    validateDocument(document);
    const source = document.assets.find((a) => a.id === sourceId);
    if (!source) throw fail("请先选择来源素材");
    const busy = () =>
      this.tasks.tasks.some(
        (t) =>
          t.context?.kind === "semantic-analysis" &&
          t.context.projectId === projectId &&
          t.context.sourceId === sourceId &&
          ["queued", "running"].includes(t.status),
      );
    if (busy()) throw fail("此素材已有类别识别任务");
    const settings = await this.connections.readPrivate('analysis'),
      bytes = await referenceBytes(this.root, source);
    if (!settings.baseUrl || !settings.apiKey || !settings.analysisModel)
      throw fail("请在模型连接中配置视觉分析模型");
    if (bytes.length > 20 * 1024 * 1024)
      throw fail("识别图片超过 20 MiB，请先缩小");
    const ext = imageExtension(bytes),
      snapshot = structuredClone(source);
    if (busy()) throw fail("此素材已有类别识别任务");
    const task = await this.tasks.start(
      `识别类别 · ${source.name}`,
      async (cancelSignal, id) => {
        const signal = AbortSignal.any([
          cancelSignal,
          AbortSignal.timeout(180000),
        ]);
        const response = await fetch(
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
              max_tokens: 3000,
              messages: [
                { role: "system", content: semanticPrompt },
                {
                  role: "user",
                  content: [
                    { type: "text", text: "识别这张图的可独立提取对象。" },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${bytes.toString("base64")}`,
                      },
                    },
                  ],
                },
              ],
            }),
          },
        ).catch((e) => {
          throw signal.aborted
            ? e
            : fail("类别识别连接失败，请检查网络和模型连接");
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw fail(`类别识别失败（HTTP ${response.status}），不会自动重试`);
        }
        let categories;
        try {
          const payload = JSON.parse(
              (await boundedBytes(response, 1024 * 1024)).toString("utf8"),
            ),
            choice = payload.choices?.[0];
          if (choice?.finish_reason === "length")
            throw fail("类别识别结果被截断，请调整模型");
          const content = choice?.message?.content;
          if (typeof content !== "string") throw Error("format");
          categories = normalizeCategories(
            JSON.parse(
              content
                .trim()
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```$/, ""),
            ),
          );
        } catch (e) {
          throw e.safeMessage ? e : fail("类别识别返回格式无效，未覆盖方案");
        }
        signal.throwIfAborted();
        await atomicWrite(
          await safePath(this.root, "semantic-drafts", id + ".json"),
          JSON.stringify({
            id,
            projectId,
            sourceId,
            source: snapshot,
            categories,
            model: settings.analysisModel,
          }),
        );
        signal.throwIfAborted();
        return id;
      },
      {
        kind: "semantic-analysis",
        projectId,
        sourceId,
        model: settings.analysisModel,
      },
    );
    return { id: task.id };
  }
  async read(projectId, id) {
    const task = this.tasks.tasks.find(
      (t) =>
        t.id === id &&
        t.context?.kind === "semantic-analysis" &&
        t.context.projectId === projectId,
    );
    if (!task || task.status !== "completed")
      throw fail("类别识别尚未完成或不属于当前工程");
    await this.projects.read(projectId);
    const draft = await this.readFile(task);
    await this.projects.verifyResources([draft.source]);
    return draft;
  }
  async readFile(task) {
    const draft = JSON.parse(
      await fs.readFile(
        await safePath(this.root, "semantic-drafts", task.id + ".json"),
        "utf8",
      ),
    );
    if (
      draft.id !== task.id ||
      draft.projectId !== task.context.projectId ||
      draft.sourceId !== task.context.sourceId
    )
      throw fail("类别草稿归属无效");
    normalizeCategories(draft);
    return draft;
  }
  async recover() {
    for (const task of this.tasks.tasks.filter(
      (t) =>
        t.context?.kind === "semantic-analysis" && t.status === "interrupted",
    )) {
      try {
        await this.readFile(task);
        task.status = "completed";
        task.resultId = task.id;
        task.message = "已恢复类别建议，未重新请求模型";
      } catch {}
    }
    await this.tasks.persist();
  }
  async generate(projectId, document, sourceId, plan) {
    const items = semanticItems(plan),
      ids = [];
    for (const instruction of items) {
      try {
        ids.push(
          (
            await this.cloud.start(projectId, document, sourceId, {
              operation: "cloudSplit",
              instruction,
            })
          ).id,
        );
      } catch (e) {
        if (!ids.length) throw e;
        return {
          ids,
          error:
            e.safeMessage || "部分任务未能提交，请在任务列表核对后单独重试",
        };
      }
    }
    return { ids };
  }
}
module.exports = { SemanticService };

