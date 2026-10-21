import sharp from "sharp";
import { freemem } from "node:os";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { cloudOperation, cloudOutputSize } from "../../studio/cloud-tool-input.js";

const bytes = source => {
    const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(source || "");
    if (!match) throw new Error("AI图片格式无效");
    return Buffer.from(match[1], "base64");
};
const dataUrl = buffer => `data:image/png;base64,${buffer.toString("base64")}`;
export async function normalizeImageOrientation(source) {
    const input = bytes(source), meta = await sharp(input, { limitInputPixels: 100_000_000 }).metadata();
    if (!["png", "jpeg", "webp"].includes(meta.format)) throw new Error("图片编码格式不受支持");
    if (meta.orientation && meta.orientation !== 1) return dataUrl(await sharp(input).autoOrient().png().toBuffer());
    return source.startsWith(`data:image/${meta.format};`) ? source : `data:image/${meta.format};base64,${input.toString("base64")}`;
}
export async function validateCloudSource(source, value) {
    const op = cloudOperation(value), size = cloudOutputSize(op);
    const meta = await sharp(bytes(source), { limitInputPixels: 100_000_000 }).metadata();
    if (meta.autoOrient.width !== op.sourceWidth || meta.autoOrient.height !== op.sourceHeight) throw new Error("来源尺寸或方向已变化，请重新导入并选择原图");
    if (freemem() < size.width * size.height * 24 + 256 * 1024 * 1024) throw new Error("可用内存不足以保护原图并处理当前画幅，请先关闭其他大图任务");
    return op;
}
export async function readSelectionCoverage(source, width, height) {
    const input = bytes(source), meta = await sharp(input, { limitInputPixels: 100_000_000 }).metadata();
    if (meta.format !== "png" || meta.width !== width || meta.height !== height || meta.orientation && meta.orientation !== 1) throw new Error("选区蒙版必须为与原图显示尺寸一致的PNG");
    const coverage = await sharp(input).toColourspace("srgb").ensureAlpha().extractChannel(3).raw().toBuffer();
    if (!coverage.some(value => value > 0)) throw new Error("画面选区未覆盖此素材，请重新选择");
    return coverage;
}
export async function prepareCloudImage(source, value, signal, selectionMask) {
    const op = await validateCloudSource(source, value), { width, height } = cloudOutputSize(op);
    signal.throwIfAborted();
    let image = await normalizeImageOrientation(source);
    if (selectionMask && op.kind !== "edit") throw new Error("只有局部修改可使用画面选区");
    if (!["edit", "outpaint"].includes(op.kind)) return { image };
    if (op.kind === "outpaint") image = dataUrl(await sharp(bytes(image)).ensureAlpha().extend({ left: op.left, top: op.top, right: width - op.sourceWidth - op.left, bottom: height - op.sourceHeight - op.top, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
    const coverage = selectionMask ? await readSelectionCoverage(selectionMask, width, height) : undefined;
    const mask = Buffer.alloc(width * height * 4, 255);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const inside = x >= op.left && y >= op.top && x < op.left + (op.kind === "edit" ? op.width : op.sourceWidth) && y < op.top + (op.kind === "edit" ? op.height : op.sourceHeight);
            mask[(y * width + x) * 4 + 3] = coverage ? 255 - coverage[y * width + x] : (op.kind === "edit" ? inside : !inside) ? 0 : 255;
        }
        if (y % 256 === 0) { await yieldToLoop(); signal.throwIfAborted(); }
    }
    return { image, mask: dataUrl(await sharp(mask, { raw: { width, height, channels: 4 } }).png().toBuffer()) };
}
export async function finishCloudImage(source, generated, value, signal, selectionMask, alignSize = false) {
    const op = await validateCloudSource(source, value), { width, height } = cloudOutputSize(op);
    if (selectionMask && op.kind !== "edit") throw new Error("只有局部修改可使用画面选区");
    const input = bytes(source); let output = bytes(generated);
    const meta = await sharp(output, { limitInputPixels: 100_000_000 }).metadata(), actual = meta.autoOrient;
    if (actual.width !== width || actual.height !== height) {
        if (alignSize !== true || actual.width <= width || actual.height <= height || actual.width * height !== actual.height * width) throw new Error(`模型返回${actual.width}×${actual.height}，请求为${width}×${height}；未拉伸或覆盖原图，请选择支持此尺寸的模型`);
        signal.throwIfAborted();
        output = await sharp(output).autoOrient().resize(width, height).png().toBuffer();
    }
    signal.throwIfAborted();
    if (["enhance", "upscale"].includes(op.kind)) {
        const alpha = await sharp(input).autoOrient().ensureAlpha().extractChannel(3).resize(width, height).raw().toBuffer();
        const result = await sharp(output).autoOrient().toColourspace("srgb").ensureAlpha().raw().toBuffer();
        for (let i = 0; i < alpha.length; i++) {
            result[i * 4 + 3] = alpha[i];
            if (i % 65536 === 0) { await yieldToLoop(); signal.throwIfAborted(); }
        }
        signal.throwIfAborted(); return dataUrl(await sharp(result, { raw: { width, height, channels: 4 } }).png().toBuffer());
    }
    const original = await sharp(input).autoOrient().toColourspace("srgb").ensureAlpha().raw().toBuffer();
    const result = await sharp(output).autoOrient().toColourspace("srgb").ensureAlpha().raw().toBuffer();
    if (op.kind === "segment") {
        let minimum = 255, maximum = 0, visible = 0;
        for (let i = 0; i < result.length; i += 4) {
            const r = result[i], g = result[i + 1], b = result[i + 2];
            if (Math.max(r, g, b) - Math.min(r, g, b) > 12 || result[i + 3] < 250) throw new Error("模型未返回不透明黑白蒙版，未提取素材；请更换支持语义蒙版的模型或修改对象描述");
            const coverage = Math.round((r + g + b) / 3);
            minimum = Math.min(minimum, coverage); maximum = Math.max(maximum, coverage);
            original[i + 3] = Math.round(original[i + 3] * coverage / 255);
            if (original[i + 3]) visible++;
            if (i % 262144 === 0) { await yieldToLoop(); signal.throwIfAborted(); }
        }
        if (!visible || maximum < 239 || minimum > 16) throw new Error("模型未区分目标与背景，未提取素材；请检查对象描述和蒙版能力");
        signal.throwIfAborted();
        return dataUrl(await sharp(original, { raw: { width, height, channels: 4 } }).png().toBuffer());
    }
    if (selectionMask) {
        const coverage = await readSelectionCoverage(selectionMask, width, height);
        for (let pixel = 0; pixel < coverage.length; pixel++) {
            const weight = coverage[pixel] / 255, i = pixel * 4;
            if (weight === 1) result.copy(original, i, i, i + 4);
            else if (weight > 0) {
                const a = original[i + 3] * (1 - weight), b = result[i + 3] * weight, alpha = a + b;
                for (let c = 0; c < 3; c++) original[i + c] = alpha ? Math.round((original[i + c] * a + result[i + c] * b) / alpha) : 0;
                original[i + 3] = Math.round(alpha);
            }
            if (pixel % 65536 === 0) { await yieldToLoop(); signal.throwIfAborted(); }
        }
        return dataUrl(await sharp(original, { raw: { width, height, channels: 4 } }).png().toBuffer());
    }
    const target = op.kind === "edit" ? original : result;
    const rows = op.kind === "edit" ? op.height : op.sourceHeight;
    for (let y = 0; y < rows; y++) {
        const start = ((op.top + y) * width + op.left) * 4;
        if (op.kind === "edit") result.copy(target, start, start, start + op.width * 4);
        else original.copy(target, start, y * op.sourceWidth * 4, (y + 1) * op.sourceWidth * 4);
        if (y % 256 === 0) { await yieldToLoop(); signal.throwIfAborted(); }
    }
    signal.throwIfAborted(); return dataUrl(await sharp(target, { raw: { width, height, channels: 4 } }).png().toBuffer());
}
