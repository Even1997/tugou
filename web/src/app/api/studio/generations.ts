import path from "node:path";
import { statfs } from "node:fs/promises";
import sharp from "sharp";
import { GenerationQueue, generationInput } from "./generation-queue";
import { gateway, publicConfig } from "./gateway";
import { storeImageResource, imageDataUrl } from "./image-resources.js";
import { cloudOperation, cloudToolPrompt } from "../../studio/cloud-tool-input.js";
import { prepareCloudImage, finishCloudImage, validateCloudSource, normalizeImageOrientation, readSelectionCoverage } from "./cloud-image-tools.js";

const state = globalThis as typeof globalThis & { studioGenerations?: Map<string, GenerationQueue> };
export async function generationRequest(dataDir: string, action: string, payload: any) {
    state.studioGenerations ??= new Map();
    let queue = state.studioGenerations.get(dataDir);
    if (!queue) {
        queue = new GenerationQueue(path.join(dataDir, "generation-jobs"), async (job, signal, saveRaw) => {
            const references = [];
            for (const source of job.references) { signal.throwIfAborted(); references.push(await imageDataUrl(dataDir, source)); }
            const selectionMask = job.selectionMask ? await imageDataUrl(dataDir, job.selectionMask) : undefined;
            let response;
            if (job.resolution === "fit") {
                if (!job.rawResult || !job.operation) throw new Error("原始返回图不可用");
                response = { dataUrl: await imageDataUrl(dataDir, job.rawResult.dataUrl) };
            } else {
                const prepared = job.operation ? await prepareCloudImage(references[0], job.operation, signal, selectionMask) : undefined;
                response = await gateway("generate", { prompt: job.prompt, size: job.size, references: prepared ? [prepared.image] : references, mask: prepared?.mask, quality: job.quality, responseFormatB64Json: job.responseFormatB64Json }, signal, job);
                signal.throwIfAborted();
                if (job.operation) {
                    const rawName = await storeImageResource(dataDir, await normalizeImageOrientation(response.dataUrl));
                    const rawFile = path.join(dataDir, "resources", rawName), meta = await sharp(rawFile).metadata(), stats = await sharp(rawFile).stats();
                    await saveRaw({ id: crypto.randomUUID(), name: `${job.name} · 原始返回`, dataUrl: `/api/studio/resource/${rawName}`, width: meta.width!, height: meta.height!, hasAlpha: !stats.isOpaque, createdAt: new Date().toISOString(), generationJobId: `raw:${job.id}`, model: job.model, prompt: job.prompt });
                }
            }
            signal.throwIfAborted();
            const result = job.operation ? await finishCloudImage(references[0], response.dataUrl, job.operation, signal, selectionMask, job.resolution === "fit") : await normalizeImageOrientation(response.dataUrl);
            const name = await storeImageResource(dataDir, result);
            signal.throwIfAborted();
            const file = path.join(dataDir, "resources", name), meta = await sharp(file).metadata(), stats = await sharp(file).stats();
            return { id: job.id, name: job.name, dataUrl: `/api/studio/resource/${name}`, width: meta.width!, height: meta.height!, hasAlpha: !stats.isOpaque, createdAt: new Date().toISOString(),
                generationJobId: job.id, recipeId: job.recipeId, sourceNodeId: job.sourceNodeId, prompt: job.prompt, fingerprint: job.fingerprint, model: job.model,
                ...(job.operation ? { sourceAssetId: job.operation.sourceId, tool: `cloud-${job.operation.kind}`, toolOptions: { ...job.operation } } : {}) };
        });
        state.studioGenerations.set(dataDir, queue);
    }
    if (action === "generation-list") return queue.list(payload.projectId);
    if (action === "generation-get") return queue.get(payload.id, payload.projectId);
    if (action === "generation-cancel") return queue.cancel(payload.id, payload.projectId);
    if (action === "generation-resolve-size") return queue.resolveSize(payload.id, payload.projectId);
    if (action === "generation-submit" || action === "generation-retry") {
        const c = publicConfig();
        if (!c.hasApiKey || !c.model) throw new Error("请先在模型连接中配置API密钥与生成模型");
        let input = payload;
        if (action === "generation-retry") {
            const previous = await queue.get(payload.id, payload.projectId);
            if (!["failed", "interrupted", "cancelled", "review"].includes(previous.status)) throw new Error("当前任务无需重新生成");
            input = { ...previous, id: payload.newId };
        }
        // Normalize to immutable references before publishing a task; never persist a key or data URL.
        if (!Array.isArray(input.references) || input.references.length > 12) throw new Error("最多支持12张参考图");
        const references = [];
        for (const source of input.references) references.push(`/api/studio/resource/${await storeImageResource(dataDir, source)}`);
        if (input.selectionMask !== undefined) {
            if (input.operation?.kind !== "edit") throw new Error("只有局部修改可使用画面选区");
            const selectionMask = `/api/studio/resource/${await storeImageResource(dataDir, input.selectionMask)}`;
            await readSelectionCoverage(await imageDataUrl(dataDir, selectionMask), input.operation.sourceWidth, input.operation.sourceHeight);
            input = { ...input, selectionMask };
        }
        if (input.operation) {
            const operation = cloudOperation(input.operation);
            if (references.length !== 1) throw new Error("AI处理需要一张原图");
            await validateCloudSource(await imageDataUrl(dataDir, references[0]), operation);
            if (typeof input.prompt !== "string" || input.prompt.length > (action === "generation-retry" ? 32000 : 30000)) throw new Error("处理要求过长或无效");
            input = { ...input, operation, instruction: action === "generation-retry" ? input.instruction : input.prompt, prompt: action === "generation-retry" ? input.prompt : cloudToolPrompt(operation, input.prompt) };
        }
        const snapshot = generationInput({ ...input, references });
        const disk = await statfs(dataDir);
        if (disk.bavail * disk.bsize < 180 * 1024 * 1024) throw new Error("本机空间不足，请先释放至少180MB用于生成结果");
        return queue.submit(snapshot, c);
    }
    throw new Error("不支持的生成任务操作");
}
