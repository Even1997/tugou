import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";
import { processImageTool, toolCapabilities } from "../src/app/api/studio/image-tools.ts";

const root = process.env.STUDIO_GPU_TEST_DIR;
if (!root || !path.isAbsolute(root)) throw new Error("Set isolated STUDIO_GPU_TEST_DIR");
process.env.STUDIO_TOOL_RUNTIME ||= "D:/CanvasStudioRuntime/realesrgan-20220424";
const results = [];
assert.equal((await toolCapabilities(root)).upscale, true);
for (const model of ["illustration", "general"]) {
    const folder = path.join(root, model);
    await mkdir(folder, { recursive: true });
    const src = path.resolve("public/studio-demo/03-couple.png");
    const input = await sharp(src).resize({ height: 384 }).png().toFile(path.join(folder, "input"));
    const start = performance.now();
    const result = await processImageTool(root, { id: model, tool: "upscale", options: { scale: 2, model } }, folder, new AbortController().signal, () => {});
    assert.equal(result.width, input.width * 2); assert.equal(result.height, input.height * 2);
    const meta = await sharp(path.join(folder, "output.png")).metadata();
    assert.equal(meta.hasAlpha, true);
    const { data } = await sharp(path.join(folder, "output.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparent = 0, opaque = 0, nonblack = 0;
    for (let i = 0; i < data.length; i += 4) { if (data[i + 3] === 0) transparent++; if (data[i + 3] === 255) opaque++; if (data[i] + data[i + 1] + data[i + 2] > 30 && data[i + 3] > 200) nonblack++; }
    assert.ok(transparent > 0 && opaque > 0 && nonblack > 100);
    results.push({ model, width: result.width, height: result.height, seconds: (performance.now() - start) / 1000, transparent, opaque, nonblack, output: path.join(folder, "output.png") });
}
await writeFile(path.resolve("../docs/studio-evidence/atelier-gpu-results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
