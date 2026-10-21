import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import sharp from "sharp";
import { processImageTool } from "../src/app/api/studio/image-tools.ts";

const root = process.env.STUDIO_GPU_TEST_DIR;
if (!root || !path.isAbsolute(root)) throw Error("An explicit isolated output directory is required");
process.env.STUDIO_TOOL_RUNTIME ||= "D:/CanvasStudioRuntime/realesrgan-20220424";
const exec = promisify(execFile), measurements = [];
const input = await sharp("public/studio-demo/03-couple.png").resize({ height: 1536 }).png().toBuffer();
const source = await sharp(input).metadata();
for (const tool of ["upscale", "cutout"]) {
    const folder = path.join(root, `${tool}-${Date.now()}`); await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "input"), tool === "cutout" ? await sharp(input).flatten({ background: "white" }).png().toBuffer() : input);
    let peakNodeRss = 0, peakGpuMiB = 0, monitoring = false;
    const sample = async () => {
        peakNodeRss = Math.max(peakNodeRss, process.memoryUsage().rss);
        if (monitoring) return; monitoring = true;
        try { const { stdout } = await exec("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 2000 }); peakGpuMiB = Math.max(peakGpuMiB, Number(stdout.trim())); } catch {}
        monitoring = false;
    };
    await sample(); const gpuBaselineMiB = peakGpuMiB;
    const monitor = setInterval(sample, 1000), start = performance.now();
    const result = await processImageTool(root, { tool, options: { scale: 4, model: "illustration", feather: 0, choke: 0 }, id: tool }, folder, new AbortController().signal, () => {});
    clearInterval(monitor); await sample();
    const meta = await sharp(path.join(folder, "output.png")).metadata();
    assert.equal(meta.hasAlpha, true); assert.equal(result.width, source.width * (tool === "upscale" ? 4 : 1)); assert.equal(result.height, source.height * (tool === "upscale" ? 4 : 1));
    measurements.push({ tool, source: [source.width, source.height], output: [result.width, result.height], seconds: (performance.now() - start) / 1000, peakNodeRssMiB: peakNodeRss / 1048576, gpuBaselineMiB, peakTotalGpuMiB: peakGpuMiB, folder });
    console.log(JSON.stringify(measurements.at(-1)));
}
await writeFile("../docs/studio-evidence/atelier-large-results.json", JSON.stringify({ measurements, limits: "GPU 是全设备占用，Node RSS 不包含外部模型进程；不能作为完整进程树峰值。" }, null, 2));
