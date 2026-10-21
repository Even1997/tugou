import path from "node:path";
import { readFile, writeFile, rename, mkdir, statfs } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ToolQueue } from "./tool-queue";
import { processImageTool, toolCapabilities, validateTool } from "./image-tools";
import { storeImageResource } from "./image-resources.js";

const state = globalThis as typeof globalThis & { studioTools?: Map<string, ToolQueue> };
export async function toolRequest(dataDir: string, action: string, payload: any) {
    if (action === "tool-capabilities") return toolCapabilities(dataDir);
    if (action === "tool-configure") {
        if (typeof payload?.runtime !== "string" || !path.isAbsolute(payload.runtime)) throw new Error("请选择已安装的模型绝对路径");
        const root = path.resolve(payload.runtime);
        const capability = await toolCapabilities(dataDir, root);
        if (!capability.upscale) throw new Error("目录缺少超分程序或模型，请运行桌面包内的 setup-image-tools.ps1 安装组件");
        const file = path.join(dataDir, "tool-runtime.json");
        let previous = {};
        try { previous = JSON.parse(await readFile(file, "utf8")); } catch {}
        await mkdir(dataDir, { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify({ ...previous, realesrgan: root }));
        await rename(`${file}.tmp`, file);
        return capability;
    }
    state.studioTools ??= new Map();
    let queue = state.studioTools.get(dataDir);
    if (!queue) {
        let root = path.join(dataDir, "tool-jobs");
        try { const config = JSON.parse(await readFile(path.join(dataDir, "tool-runtime.json"), "utf8")); if (typeof config.jobsDir === "string" && path.isAbsolute(config.jobsDir)) root = path.join(config.jobsDir, createHash("sha256").update(path.resolve(dataDir)).digest("hex").slice(0, 16)); } catch {}
        // Another request may have initialized while the configuration was read.
        queue = state.studioTools.get(dataDir) || new ToolQueue(root, (job, folder, signal, progress) => processImageTool(dataDir, job, folder, signal, progress));
        state.studioTools.set(dataDir, queue);
    }
    if (action === "tool-list") return queue.list(payload.projectId);
    if (action === "tool-cancel") return queue.cancel(payload.id, payload.projectId);
    if (action === "tool-result") return queue.result(payload.id, payload.projectId, payload.index);
    if (action === "tool-results") {
        const first = await queue.result(payload.id, payload.projectId);
        if (!first.job.outputs?.length) throw new Error("此任务没有拆分结果");
        const disk = await statfs(dataDir);
        if (disk.bavail * disk.bsize < first.job.outputs.reduce((sum, output) => sum + output.bytes, 0) + 64 * 1024 * 1024) throw new Error("素材目录空间不足，请释放空间后收集结果");
        const outputs = [];
        for (let index = 0; index < first.job.outputs.length; index++) {
            const result = index ? await queue.result(payload.id, payload.projectId, index) : first;
            outputs.push({ ...first.job.outputs[index], index, dataUrl: `/api/studio/resource/${await storeImageResource(dataDir, result.dataUrl)}` });
        }
        return { job: first.job, outputs };
    }
    if (action === "tool-source") return queue.source(payload.id, payload.projectId);
    if (action === "tool-retry") return queue.retry(payload.id, payload.projectId, payload.newId);
    if (action === "tool-submit") {
        validateTool(payload.tool, payload.options);
        const region = ["width", "height", "left", "top", "feather"];
        if (payload.tool === "split") return queue.submit({ ...payload, options: { splitMode: payload.options.splitMode, rows: payload.options.rows, columns: payload.options.columns, minArea: payload.options.minArea } });
        const keys: Record<string, string[]> = { upscale: ["scale", "model"], cutout: ["cutoutModel", "feather", "choke", "matte"], alpha: ["feather", "choke", "matte"], mattePair: ["feather", "choke", "matte"], resize: ["width", "height"], crop: ["width", "height", "left", "top"], tile: ["width", "height"], enhance: ["intensity"], lut: ["lut", "lutName", "intensity"], patch: region, texture: region, extract: region, extend: ["width", "height", "left", "top"], relight: ["lightType", "lightX", "lightY", "lightRadius", "angle", "exposure", "color"], pattern: ["width", "height", "pattern", "gap", "tileScale"] };
        const options = Object.fromEntries(keys[payload.tool].filter(key => payload.options[key] !== undefined).map(key => [key, payload.options[key]]));
        return queue.submit({ ...payload, options });
    }
    throw new Error("不支持的工具操作");
}
