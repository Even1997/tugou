import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Asset } from "../../studio/model";
import type { GenerationInput, GenerationJob } from "../../studio/generation-schema";
import { resourceName } from "../../studio/resource-url.js";
import { validImageSize } from "../../studio/image-limits.js";
import { cloudOperation, cloudOutputSize, generationReviewSize } from "../../studio/cloud-tool-input.js";

const validId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{1,80}$/.test(id);
const active = (job: GenerationJob) => ["queued", "running"].includes(job.status);
type Processor = (job: GenerationJob, signal: AbortSignal, saveRaw: (asset: Asset) => Promise<void>) => Promise<Asset>;
export function generationInput(input: GenerationInput): GenerationInput {
    if (!validId(input.id) || !validId(input.projectId) || typeof input.name !== "string" || !input.name.trim() || input.name.length > 200) throw new Error("生成任务来源无效");
    if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 32000) throw new Error("提示词需为1至32000个字符");
    const size = /^(\d+)x(\d+)$/.exec(input.size || "");
    if (input.size !== "auto" && (!size || !validImageSize(Number(size[1]), Number(size[2])))) throw new Error("生成尺寸无效");
    if (!Array.isArray(input.references) || input.references.length > 12 || input.references.some(r => !resourceName(r))) throw new Error("参考图必须为已保存的本机素材，最多12张");
    const result: GenerationInput = { id: input.id, projectId: input.projectId, name: input.name, prompt: input.prompt, size: input.size, references: [...input.references] };
    if (input.operation !== undefined) {
        const op = cloudOperation(input.operation), output = cloudOutputSize(op);
        if (input.references.length !== 1 || input.size !== `${output.width}x${output.height}`) throw new Error("AI处理需要一张原图和对应输出尺寸");
        result.operation = op as GenerationInput["operation"];
        if (input.instruction !== undefined) {
            if (typeof input.instruction !== "string" || input.instruction.length > 30000) throw new Error("AI处理要求无效");
            result.instruction = input.instruction;
        }
    }
    if (input.selectionMask !== undefined) {
        if (result.operation?.kind !== "edit" || !resourceName(input.selectionMask)) throw new Error("画面选区必须为局部修改的本机蒙版");
        result.selectionMask = input.selectionMask;
    }
    if (input.quality !== undefined) {
        if (!["auto", "low", "medium", "high", "standard", "hd"].includes(input.quality)) throw new Error("生成质量无效");
        result.quality = input.quality;
    }
    if (input.responseFormatB64Json !== undefined) {
        if (typeof input.responseFormatB64Json !== "boolean") throw new Error("图片响应格式无效");
        result.responseFormatB64Json = input.responseFormatB64Json;
    }
    for (const key of ["recipeId", "sourceNodeId", "canvasProjectId"] as const) {
        if (input[key] !== undefined) { if (!validId(input[key])) throw new Error("生成来源标识无效"); result[key] = input[key]; }
    }
    if (input.fingerprint !== undefined) {
        if (typeof input.fingerprint !== "string" || input.fingerprint.length > 32000) throw new Error("来源版本无效");
        result.fingerprint = input.fingerprint;
    }
    return result;
}

/** Durable local records for remote calls. No credentials and no automatic resubmission. */
export class GenerationQueue {
    private jobs = new Map<string, GenerationJob>();
    private hashes = new Map<string, string>();
    private writes = Promise.resolve();
    private submissions = Promise.resolve();
    private controller?: AbortController;
    private runningId?: string;
    private ready: Promise<void>;
    private root: string;
    private process: Processor;
    constructor(root: string, process: Processor) { this.root = root; this.process = process; this.ready = this.restore(); }
    private file(id: string) { if (!validId(id)) throw new Error("任务ID无效"); return path.join(this.root, `${id}.json`); }
    private async restore() {
        await mkdir(this.root, { recursive: true });
        for (const file of await readdir(this.root)) {
            if (!/^[\w-]{1,80}\.json$/.test(file)) continue;
            try {
                const { job, hash } = JSON.parse(await readFile(path.join(this.root, file), "utf8"));
                generationInput(job);
                if (file !== `${job.id}.json`) continue;
                if (active(job)) Object.assign(job, { status: job.rawResult ? "review" : "interrupted", finishedAt: new Date().toISOString(), error: job.rawResult ? "原始返回图已保留，可查看或继续本地处理。" : "应用已关闭。请先核对服务端请求记录；不会自动重复提交。" });
                this.jobs.set(job.id, job); this.hashes.set(job.id, hash); await this.persist(job);
            } catch { /* An incomplete manifest cannot trigger a paid request. */ }
        }
    }
    private persist(job: GenerationJob) {
        const content = JSON.stringify({ job, hash: this.hashes.get(job.id) }), file = this.file(job.id);
        const next = this.writes.catch(() => {}).then(async () => { await writeFile(`${file}.tmp`, content); await rename(`${file}.tmp`, file); });
        this.writes = next; return next;
    }
    async list(projectId: string) {
        await this.ready; if (!validId(projectId)) throw new Error("工程ID无效");
        return [...this.jobs.values()].filter(j => j.projectId === projectId).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(j => structuredClone(j));
    }
    async get(id: string, projectId: string) {
        await this.ready; const job = this.jobs.get(id);
        if (!job || job.projectId !== projectId) throw new Error("生成任务不存在");
        return structuredClone(job);
    }
    async submit(value: GenerationInput, connection: { baseUrl: string; model: string }) {
        await this.ready;
        const input = generationInput(value), { baseUrl, model } = connection;
        const hash = createHash("sha256").update(JSON.stringify({ ...input, baseUrl, model })).digest("hex");
        const submission = this.submissions.catch(() => {}).then(async () => {
            const existing = this.jobs.get(input.id);
            if (existing) { if (this.hashes.get(input.id) !== hash) throw new Error("任务ID已用于不同输入"); return structuredClone(existing); }
            if ([...this.jobs.values()].filter(active).length >= 20) throw new Error("生成队列已满，请稍后再试");
            const job: GenerationJob = { ...input, baseUrl, model, createdAt: new Date().toISOString(), status: "queued" };
            this.hashes.set(job.id, hash); await this.persist(job); this.jobs.set(job.id, job); return structuredClone(job);
        });
        this.submissions = submission.then(() => {}, () => {});
        const job = await submission; void this.drain(); return job;
    }
    private async drain() {
        if (this.runningId) return;
        const job = [...this.jobs.values()].find(j => j.status === "queued"); if (!job) return;
        this.runningId = job.id; const controller = this.controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error("等待超过10分钟；服务端可能仍在处理，请先核对请求记录")), 600000);
        try {
            job.status = "running"; await this.persist(job); controller.signal.throwIfAborted();
            const result = await this.process(structuredClone(job), controller.signal, async asset => {
                controller.signal.throwIfAborted();
                job.rawResult = structuredClone(asset); await this.persist(job);
                controller.signal.throwIfAborted();
            }); controller.signal.throwIfAborted();
            Object.assign(job, { result, status: "completed", error: undefined });
        } catch (error) {
            if (job.status !== "cancelled") Object.assign(job, { status: job.rawResult ? "review" : "failed", error: String(controller.signal.reason?.message || (error instanceof Error ? error.message : "生成失败")).slice(0,500) });
        } finally {
            clearTimeout(timeout); job.finishedAt = new Date().toISOString();
            try { await this.persist(job); } catch { job.status = "failed"; job.error = "结果记录保存失败，请检查磁盘；重试前核对服务端请求记录"; }
            this.controller = undefined; this.runningId = undefined; void this.drain();
        }
    }
    async resolveSize(id: string, projectId: string) {
        await this.get(id, projectId); const job = this.jobs.get(id)!;
        if (job.resolution === "fit" && (active(job) || job.status === "completed")) return structuredClone(job);
        if (active(job) || job.status === "completed" || !generationReviewSize(job)) throw new Error("仅支持将已保留的同等比例大图缩小对齐；原始图可单独保存");
        Object.assign(job, { resolution: "fit", status: "queued", error: undefined, finishedAt: undefined });
        await this.persist(job); void this.drain(); return structuredClone(job);
    }
    async cancel(id: string, projectId: string) {
        await this.get(id, projectId); const job = this.jobs.get(id)!;
        if (active(job)) {
            const running = job.status === "running";
            Object.assign(job, { status: "cancelled", finishedAt: new Date().toISOString(), error: running ? job.resolution === "fit" ? "已停止本地对齐，原始返回图保留。" : "已停止等待；服务端可能仍在处理或计费，请先核对请求记录。" : undefined });
            if (this.runningId === id) this.controller?.abort(new Error("已停止等待"));
            await this.persist(job);
        }
        return structuredClone(job);
    }
}
