import sharp from "sharp";
import { spawn } from "node:child_process";
import { readFile, access, unlink, statfs } from "node:fs/promises";
import path from "node:path";
import { freemem } from "node:os";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { validImageSize } from "../../studio/image-limits.js";
import { parseCube, applyCubeRgba } from "./cube-lut.js";
import { regionImage } from "./region-tools.js";
import { lightImage, patternImage } from "./creative-tools.js";
import { splitImage } from "./split-image.js";
import { growCoverage } from "../../studio/coverage-morphology.js";
import type { ToolJob, ToolOptions } from "../../studio/tool-schema";

const kinds = ["upscale", "cutout", "alpha", "mattePair", "resize", "crop", "tile", "enhance", "lut", "patch", "texture", "extract", "extend", "relight", "pattern", "split"];
const integer = (n: unknown, min = 1, max = 30000): n is number => Number.isInteger(n) && Number(n) >= min && Number(n) <= max;
export function validateTool(tool: string, o: ToolOptions) {
    if (!kinds.includes(tool) || !o || typeof o !== "object" || Array.isArray(o)) throw new Error("工具参数无效");
    if (tool === "split" && (!["alpha", "grid"].includes(o.splitMode!) || !integer(o.minArea, 1, 1_000_000) || !integer(o.rows, 1, 16) || !integer(o.columns, 1, 16) || o.rows! * o.columns! > 64)) throw new Error("拆分参数无效：最多 64 格，最小面积为 1–1000000 像素");
    if (tool === "upscale" && (![2, 4].includes(o.scale!) || !["general", "illustration"].includes(o.model!))) throw new Error("请选择放大倍率与模型");
    if (tool === "cutout" && o.cutoutModel !== undefined && !["standard", "detail"].includes(o.cutoutModel)) throw new Error("抠图识别模式无效");
    if (["resize", "crop", "tile", "patch", "texture", "extract", "extend", "pattern"].includes(tool) && (!integer(o.width) || !integer(o.height) || !validImageSize(o.width, o.height))) throw new Error("目标尺寸超过 30000 边长或 1 亿像素");
    const bounded = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
    if (tool === "relight" && (!["linear", "radial"].includes(o.lightType!) || !bounded(o.lightX, 0, 1) || !bounded(o.lightY, 0, 1) || !bounded(o.lightRadius, .05, 2) || !bounded(o.angle, -180, 180) || !bounded(o.exposure, -3, 3) || !/^#[a-f0-9]{6}$/i.test(o.color || ""))) throw new Error("打光参数无效");
    if (tool === "pattern" && (!["repeat", "mirror", "half-drop"].includes(o.pattern!) || !integer(o.gap, 0, 4096) || !bounded(o.tileScale, .05, 4))) throw new Error("图案排列参数无效");
    if (["crop", "patch", "texture", "extract", "extend"].includes(tool) && (!integer(o.left, 0) || !integer(o.top, 0))) throw new Error("选区或偏移位置无效");
    if (["enhance", "lut"].includes(tool) && (!Number.isFinite(o.intensity) || o.intensity! < 0 || o.intensity! > 1)) throw new Error("强度应为 0–1");
    if (tool === "lut") {
        parseCube(o.lut!);
        if (o.lutName !== undefined && (typeof o.lutName !== "string" || o.lutName.length > 200)) throw new Error("LUT 文件名过长");
    }
    if (["alpha", "cutout", "mattePair", "patch", "texture", "extract"].includes(tool)) {
        if (o.feather !== undefined && (!Number.isFinite(o.feather) || o.feather < 0 || o.feather > 10)) throw new Error("羽化应为 0–10 像素");
        if (o.choke !== undefined && !integer(o.choke, -10, 10)) throw new Error("边缘收缩应为 -10–10 像素");
        if (o.matte !== undefined && !["none", "white", "black"].includes(o.matte)) throw new Error("边缘底色无效");
    }
}

export function checkToolMemory(pixels: number, available = freemem()) {
    const required = pixels * 16 + 256 * 1024 * 1024;
    if (available < required) throw new Error(`当前可用内存不足，处理需要约 ${(required / 1024 ** 3).toFixed(1)} GB 空闲内存；请关闭占用内存的程序后重试。`);
}

/** Only alpha changes by default. Removing a known matte is an explicit user choice. */
async function refineAlpha(input: Buffer, o: ToolOptions, signal: AbortSignal) {
    const meta = await sharp(input).metadata();
    if (!meta.hasAlpha) throw new Error("原素材没有透明通道，请先抠图");
    const { data, info } = await sharp(input).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const shape = { width: info.width, height: info.height, channels: 1 as const };
    const original = Buffer.alloc(info.width * info.height);
    for (let i = 0; i < original.length; i++) original[i] = data[i * 4 + 3];
    // Alpha is continuous coverage; binary morphology can invert growth and corrupt soft edges.
    const coverage = o.choke ? growCoverage(original, info.width, info.height, -o.choke) : original;
    let mask = sharp(Buffer.from(coverage.buffer, coverage.byteOffset, coverage.byteLength), { raw: shape });
    if (o.feather) mask = mask.blur(Math.max(.3, o.feather));
    const alpha = await mask.toColourspace("b-w").raw().toBuffer();
    signal.throwIfAborted();
    for (let i = 0; i < original.length; i++) {
        if (i % 262144 === 0) { await yieldToLoop(); signal.throwIfAborted(); }
        if (o.matte && o.matte !== "none") {
            const a = original[i] / 255, background = o.matte === "white" ? 255 : 0;
            for (let c = 0; c < 3; c++) data[i * 4 + c] = a > 0 ? Math.round(Math.max(0, Math.min(255, (data[i * 4 + c] - background * (1 - a)) / a))) : 0;
        }
        data[i * 4 + 3] = alpha[i];
    }
    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
}
async function runtimeRoot(dataDir: string) {
    if (process.env.STUDIO_TOOL_RUNTIME) return path.resolve(process.env.STUDIO_TOOL_RUNTIME);
    try { const config = JSON.parse(await readFile(path.join(dataDir, "tool-runtime.json"), "utf8")); return path.resolve(config.realesrgan); }
    catch { throw new Error("请先安装本地超分组件并配置模型目录"); }
}
export async function toolCapabilities(dataDir: string, selectedRoot?: string) {
    let cutout = false;
    let cutoutDetail = false;
    try { const root = path.dirname(selectedRoot || await runtimeRoot(dataDir)); await Promise.all(["segment-python/Scripts/python.exe", "segmentation/segment.py", "segmentation/isnet-general-use.onnx"].map(p => access(path.join(root, p)))); cutout = true; } catch {}
    try { const root = path.dirname(selectedRoot || await runtimeRoot(dataDir)); await Promise.all(["segment-python/Scripts/python.exe", "segmentation/segment-birefnet.py", "segmentation/birefnet-general-fp16.onnx"].map(p => access(path.join(root, p)))); cutoutDetail = true; } catch {}
    try {
        const root = selectedRoot || await runtimeRoot(dataDir);
        await Promise.all(["realesrgan-ncnn-vulkan.exe", "models/realesrgan-x4plus.bin", "models/realesrgan-x4plus.param", "models/realesrgan-x4plus-anime.bin", "models/realesrgan-x4plus-anime.param"].map(p => access(path.join(root, p))));
        return { upscale: true, cutout, cutoutDetail, runtime: root, error: "" };
    } catch (e) { return { upscale: false, cutout, cutoutDetail, runtime: "", error: (e as Error).message }; }
}
function run(executable: string, args: string[], cwd: string, signal: AbortSignal, progress: (value: number) => void) {
    return new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
        let error = "";
        const cancel = () => child.kill();
        signal.addEventListener("abort", cancel, { once: true });
        child.stderr.on("data", bytes => {
            const text = bytes.toString(); error = (error + text).slice(-2500);
            const matches = [...text.matchAll(/([\d.]+)%/g)];
            if (matches.length) progress(10 + Number(matches.at(-1)![1]) * .8);
        });
        child.once("error", e => { signal.removeEventListener("abort", cancel); reject(e); });
        child.once("close", code => {
            signal.removeEventListener("abort", cancel);
            if (signal.aborted) reject(signal.reason);
            else if (code !== 0) reject(new Error(`本地图片处理失败（${code}）：${error.slice(-500)}`));
            else resolve();
        });
    });
}
export async function processImageTool(dataDir: string, job: ToolJob, folder: string, signal: AbortSignal, progress: (n: number) => void) {
    const o = job.options;
    validateTool(job.tool, o);
    const source = path.join(folder, "input"), normalized = path.join(folder, "normalized.png"), output = path.join(folder, "output.png");
    const temporary = [normalized, path.join(folder, "rgb.png"), path.join(folder, "upscaled.png")];
    try {
        signal.throwIfAborted();
        const metadata = await sharp(source, { limitInputPixels: 100_000_000 }).metadata();
        const pixels = (metadata.width || 0) * (metadata.height || 0);
        const targetPixels = job.tool === "upscale" ? pixels * 16 : job.tool === "pattern" ? Math.max((o.width || 0) * (o.height || 0), pixels * o.tileScale! ** 2) : (o.width || 0) * (o.height || 0);
        checkToolMemory(Math.max(pixels, targetPixels) * (job.tool === "split" && o.splitMode === "alpha" ? 1.5 : 1));
        const disk = await statfs(folder);
        const required = (job.tool === "upscale" ? pixels * 16 * 8 : Math.max(pixels, (o.width || 0) * (o.height || 0)) * 8) + 128 * 1024 * 1024;
        if (disk.bavail * disk.bsize < required) throw new Error("处理磁盘剩余空间不足，请释放空间或更换工具缓存目录");
        const { width, height } = await sharp(source, { limitInputPixels: 100_000_000 }).autoOrient().png().toFile(normalized);
        if (!validImageSize(width, height)) throw new Error("原图超过支持范围");
        signal.throwIfAborted(); progress(5);
        if (job.tool === "split") return await splitImage(normalized, folder, o, signal, progress);
        let pipeline = sharp(normalized);
        if (job.tool === "upscale") {
            const target = { width: width * o.scale!, height: height * o.scale! };
            if (!validImageSize(target.width, target.height)) throw new Error("放大结果超过文档 1 亿像素或 30000 边长限制");
            // x4 models always produce a 4x intermediate, including when the final target is 2x.
            if (!validImageSize(width * 4, height * 4)) throw new Error("本模型的 4 倍中间结果超过内存保护范围，请分区处理");
            const root = await runtimeRoot(dataDir);
            const name = o.model === "illustration" ? "realesrgan-x4plus-anime" : "realesrgan-x4plus";
            await sharp(normalized).removeAlpha().png().toFile(temporary[1]);
            await run(path.join(root, "realesrgan-ncnn-vulkan.exe"), ["-i", temporary[1], "-o", temporary[2], "-m", path.join(root, "models"), "-n", name, "-s", "4", "-t", "128", "-j", "1:1:1"], root, signal, progress);
            const meta = await sharp(temporary[2]).metadata();
            if (meta.width !== width * 4 || meta.height !== height * 4) throw new Error("超分模型输出尺寸异常");
            pipeline = sharp(temporary[2]).resize(target.width, target.height, { fit: "fill" }).removeAlpha();
            if ((await sharp(normalized).metadata()).hasAlpha) {
                const alpha = await sharp(normalized).ensureAlpha().extractChannel("alpha").resize(target.width, target.height).raw().toBuffer();
                const rgb = await pipeline.raw().toBuffer();
                pipeline = sharp(rgb, { raw: { ...target, channels: 3 } }).joinChannel(alpha, { raw: { ...target, channels: 1 } });
            }
        } else if (job.tool === "cutout") {
            const root = path.dirname(await runtimeRoot(dataDir));
            const detail = o.cutoutModel === "detail";
            await run(path.join(root, "segment-python/Scripts/python.exe"), [path.join(root, "segmentation", detail ? "segment-birefnet.py" : "segment.py"), "--model", path.join(root, "segmentation", detail ? "birefnet-general-fp16.onnx" : "isnet-general-use.onnx"), "--input", normalized, "--output", output], root, signal, progress);
            const result = await sharp(output).metadata();
            if (result.width !== width || result.height !== height || !result.hasAlpha) throw new Error("抠图结果尺寸或透明通道异常");
            pipeline = sharp(await readFile(output));
        } else if (job.tool === "relight") pipeline = await lightImage(normalized, o, signal);
        else if (job.tool === "pattern") pipeline = await patternImage(normalized, o, signal);
        else if (["patch", "texture", "extract", "extend"].includes(job.tool)) pipeline = await regionImage(normalized, job.tool, o, path.join(folder, "secondary"), signal);
        else if (job.tool === "resize") pipeline = pipeline.resize(o.width, o.height, { fit: "fill" });
        else if (job.tool === "crop") {
            if (o.left! + o.width! > width || o.top! + o.height! > height) throw new Error("裁切区域超出原图");
            pipeline = pipeline.extract({ left: o.left!, top: o.top!, width: o.width!, height: o.height! });
        } else if (job.tool === "tile") {
            const count = Math.ceil(o.width! / width) * Math.ceil(o.height! / height);
            if (count > 4096) throw new Error("平铺超过 4096 块，请放大图案或减小输出尺寸");
            const input = await sharp(normalized).extract({ left: 0, top: 0, width: Math.min(width, o.width!), height: Math.min(height, o.height!) }).png().toBuffer();
            // libvips tiles and clips at the output bounds without allocating individual tiles.
            pipeline = sharp({ create: { width: o.width!, height: o.height!, channels: 4, background: "#00000000" } }).composite([{ input, tile: true, gravity: "northwest" }]);
        } else if (job.tool === "enhance" && o.intensity! > 0) pipeline = pipeline.modulate({ saturation: 1 + o.intensity! * .15 }).sharpen({ sigma: .3 + o.intensity! * .7 });
        if (job.tool === "lut") {
            const { data, info } = await pipeline.toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            await applyCubeRgba(data, parseCube(o.lut!), o.intensity!, signal);
            pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
        }
        if (job.tool === "mattePair") {
            const black = await sharp(normalized).flatten({ background: "black" }).toColourspace("srgb").raw().toBuffer();
            const white = await sharp(path.join(folder, "secondary"), { limitInputPixels: 100_000_000 }).autoOrient().flatten({ background: "white" }).toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
            if (white.info.width !== width || white.info.height !== height) throw new Error("黑白底图片尺寸必须相同，主体须逐像素对齐");
            const rgba = Buffer.alloc(width * height * 4); let mismatches = 0;
            for (let i = 0; i < width * height; i++) {
                if (i % 262144 === 0) { await yieldToLoop(); signal.throwIfAborted(); }
                const differences = [0, 1, 2].map(c => white.data[i * 3 + c] - black[i * 3 + c]);
                if (Math.max(...differences) - Math.min(...differences) > 16 || Math.min(...differences) < -8) mismatches++;
                const alpha = Math.max(0, Math.min(1, 1 - (differences[0] + differences[1] + differences[2]) / 765));
                for (let c = 0; c < 3; c++) rgba[i * 4 + c] = alpha > 1 / 255 ? Math.round(Math.min(255, black[i * 3 + c] / alpha)) : 0;
                rgba[i * 4 + 3] = Math.round(alpha * 255);
            }
            if (mismatches > width * height * .05) throw new Error("两张图的主体或位置不一致，不能可靠提取透明度；请使用同一图像的黑白底版本");
            pipeline = sharp(rgba, { raw: { width, height, channels: 4 } });
        }
        if (["alpha", "cutout", "mattePair"].includes(job.tool)) pipeline = await refineAlpha(await pipeline.png().toBuffer(), o, signal);
        signal.throwIfAborted(); progress(92);
        const result = await pipeline.png().toFile(output);
        signal.throwIfAborted();
        if (!validImageSize(result.width, result.height)) throw new Error("结果尺寸无效");
        return { width: result.width, height: result.height };
    } finally { await Promise.all(temporary.map(file => unlink(file).catch(() => {}))); }
}
