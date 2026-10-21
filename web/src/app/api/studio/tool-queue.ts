import { mkdir, readFile, writeFile, rename, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ToolJob, ToolSubmission, ToolOutput } from "../../studio/tool-schema";

type Processor = (job: ToolJob, folder: string, signal: AbortSignal, progress: (value: number) => void) => Promise<{ width: number; height: number; outputs?: ToolOutput[] }>;
const validId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{1,80}$/.test(id);
const active = (job: ToolJob) => job.status === "queued" || job.status === "running";
function imageBytes(dataUrl: string) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
    if (!match || match[2].length > 200_000_000) throw new Error("输入图片无效或过大");
    return Buffer.from(match[2], "base64");
}
function imageDataUrl(input: Buffer) {
    const mime = input[0] === 0xff ? "jpeg" : input.toString("ascii", 0, 4) === "RIFF" ? "webp" : "png";
    return `data:image/${mime};base64,${input.toString("base64")}`;
}

/** One GPU task at a time. Inputs/results stay on disk; manifests never include credentials. */
export class ToolQueue {
    private jobs = new Map<string, ToolJob>();
    private hashes = new Map<string, string>();
    private writes = Promise.resolve();
    private submissions = Promise.resolve();
    private controller?: AbortController;
    private runningId?: string;
    private ready: Promise<void>;
    private root: string;
    private process: Processor;
    constructor(root: string, process: Processor) { this.root = root; this.process = process; this.ready = this.restore(); }
    private folder(id: string) {
        if (!validId(id)) throw new Error("任务 ID 无效");
        return path.join(this.root, id);
    }
    private async restore() {
        await mkdir(this.root, { recursive: true });
        for (const id of await readdir(this.root)) {
            if (!validId(id)) continue;
            try {
                const { job, hash } = JSON.parse(await readFile(path.join(this.folder(id), "job.json"), "utf8"));
                if (job.id !== id || !validId(job.projectId) || !validId(job.sourceId)) continue;
                if (active(job)) {
                    Object.assign(job, { status: "interrupted", error: "上次运行已中断，可重新处理；不会自动重复提交。", finishedAt: new Date().toISOString() });
                    await this.removeOutputs(id);
                }
                this.jobs.set(id, job); this.hashes.set(id, hash);
                await this.persist(job);
            } catch { /* Incomplete submission: no published manifest, no executable task. */ }
        }
    }
    private persist(job: ToolJob) {
        const content = JSON.stringify({ job, hash: this.hashes.get(job.id) });
        const file = path.join(this.folder(job.id), "job.json");
        const next = this.writes.catch(() => {}).then(async () => {
            await writeFile(`${file}.tmp`, content);
            await rename(`${file}.tmp`, file);
        });
        this.writes = next;
        return next;
    }
    private async removeOutputs(id: string) {
        for (const file of await readdir(this.folder(id)).catch(() => []))
            if (/^output(?:-\d+)?\.png$/.test(file)) await unlink(path.join(this.folder(id), file)).catch(() => {});
    }
    async list(projectId: string) {
        await this.ready;
        if (!validId(projectId)) throw new Error("工程 ID 无效");
        return [...this.jobs.values()].filter(j => j.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(job => {
            const { lut: _lut, ...options } = job.options;
            return structuredClone({ ...job, options });
        });
    }
    async submit(input: ToolSubmission) {
        await this.ready;
        if (!validId(input.id) || !validId(input.projectId) || !validId(input.sourceId) || typeof input.name !== "string" || input.name.length > 200) throw new Error("任务来源无效");
        const bytes = imageBytes(input.dataUrl);
        const needsSecondary = ["mattePair", "patch", "texture"].includes(input.tool);
        if (needsSecondary && (!validId(input.secondarySourceId) || input.secondarySourceId === input.sourceId)) throw new Error("请另选一张辅助图片");
        const secondary = needsSecondary ? imageBytes(input.secondaryDataUrl!) : undefined;
        const hash = createHash("sha256").update(bytes).update(secondary || "").update(JSON.stringify([input.projectId, input.sourceId, input.tool, input.options, input.secondarySourceId])).digest("hex");
        // Serialize publication so simultaneous retries cannot enqueue the same ID twice.
        const submission = this.submissions.catch(() => {}).then(async () => {
            if (this.jobs.has(input.id)) {
                if (this.hashes.get(input.id) !== hash) throw new Error("任务 ID 已用于不同输入");
                return structuredClone(this.jobs.get(input.id)!);
            }
            if ([...this.jobs.values()].filter(active).length >= 20) throw new Error("任务队列已满，请稍后再试");
            const folder = this.folder(input.id);
            await mkdir(folder, { recursive: true });
            await writeFile(path.join(folder, "input"), bytes);
            if (secondary) await writeFile(path.join(folder, "secondary"), secondary);
            const job: ToolJob = { id: input.id, projectId: input.projectId, sourceId: input.sourceId, name: input.name, tool: input.tool, options: structuredClone(input.options), status: "queued", progress: 0, createdAt: new Date().toISOString() };
            if (secondary) job.secondarySourceId = input.secondarySourceId;
            this.hashes.set(job.id, hash);
            await this.persist(job);
            this.jobs.set(job.id, job);
            return structuredClone(job);
        });
        this.submissions = submission.then(() => {}, () => {});
        const job = await submission;
        void this.drain();
        return job;
    }
    private async drain() {
        if (this.runningId) return;
        const job = [...this.jobs.values()].find(j => j.status === "queued");
        if (!job) return;
        this.runningId = job.id;
        const controller = this.controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error("处理超过 30 分钟，已停止")), 30 * 60_000);
        try {
            job.status = "running";
            await this.persist(job);
            controller.signal.throwIfAborted();
            const result = await this.process(structuredClone(job), this.folder(job.id), controller.signal, value => {
                if (!controller.signal.aborted && Number.isFinite(value)) job.progress = Math.max(job.progress, Math.min(99, value));
            });
            controller.signal.throwIfAborted();
            Object.assign(job, result, { status: "completed", progress: 100 });
        } catch (e) {
            if (job.status !== "cancelled") Object.assign(job, { status: "failed", error: String(controller.signal.reason?.message || (e instanceof Error ? e.message : "处理失败")).slice(0, 500) });
            await this.removeOutputs(job.id);
        } finally {
            clearTimeout(timeout);
            job.finishedAt = new Date().toISOString();
            try { await this.persist(job); }
            catch { job.status = "failed"; job.error = "任务记录保存失败，请检查磁盘空间"; }
            this.controller = undefined; this.runningId = undefined;
            void this.drain();
        }
    }
    async cancel(id: string, projectId: string) {
        await this.ready;
        const job = this.jobs.get(id);
        if (!job || job.projectId !== projectId) throw new Error("任务不存在");
        if (active(job)) {
            job.status = "cancelled"; job.finishedAt = new Date().toISOString();
            if (this.runningId === id) this.controller?.abort(new Error("已取消"));
            await this.persist(job);
        }
        return structuredClone(job);
    }
    async result(id: string, projectId: string, index = 0) {
        await this.ready;
        const job = this.jobs.get(id);
        if (!job || job.projectId !== projectId || job.status !== "completed") throw new Error("任务尚无可用结果");
        if (!Number.isInteger(index) || index < 0 || index >= (job.outputs?.length || 1)) throw new Error("结果序号无效");
        return { job: structuredClone(job), index, dataUrl: `data:image/png;base64,${(await readFile(path.join(this.folder(id), index ? `output-${index}.png` : "output.png"))).toString("base64")}` };
    }
    async source(id: string, projectId: string) {
        await this.ready;
        const job = this.jobs.get(id);
        if (!job || job.projectId !== projectId) throw new Error("任务不存在");
        const input = await readFile(path.join(this.folder(id), "input"));
        return { dataUrl: imageDataUrl(input) };
    }
    async retry(id: string, projectId: string, newId: string) {
        await this.ready;
        const job = this.jobs.get(id);
        if (!job || job.projectId !== projectId || !["failed", "cancelled", "interrupted"].includes(job.status)) throw new Error("当前任务无需重试");
        const source = await this.source(id, projectId);
        const secondaryDataUrl = job.secondarySourceId ? imageDataUrl(await readFile(path.join(this.folder(id), "secondary"))) : undefined;
        return this.submit({ ...job, id: newId, ...source, secondaryDataUrl });
    }
}
