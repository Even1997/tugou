import sharp from "sharp";
import { setImmediate as yieldToLoop } from "node:timers/promises";

/** Blend only inside the requested rectangle; never round-trip untouched pixels. */
export async function regionImage(input, tool, o, secondary, signal) {
    const { data, info } = await sharp(input).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { left, top, width, height } = o;
    if (tool === "extend") {
        if (left + info.width > width || top + info.height > height) throw new Error("扩边后的尺寸无法容纳原图，请调整原图偏移");
        const output = Buffer.alloc(width * height * 4);
        for (let y = 0; y < info.height; y++) {
            if (y % 128 === 0) { await yieldToLoop(); signal.throwIfAborted(); }
            data.copy(output, ((y + top) * width + left) * 4, y * info.width * 4, (y + 1) * info.width * 4);
        }
        return sharp(output, { raw: { width, height, channels: 4 } });
    }
    if (left + width > info.width || top + height > info.height) throw new Error("选区超出原图");
    let replacement;
    if (tool === "patch" || tool === "texture") {
        let image = sharp(secondary, { limitInputPixels: 100_000_000 }).autoOrient().toColourspace("srgb").ensureAlpha();
        if (tool === "texture") {
            const normalized = await image.png().toBuffer({ resolveWithObject: true });
            if (Math.ceil(width / normalized.info.width) * Math.ceil(height / normalized.info.height) > 4096) throw new Error("材质平铺超过 4096 块，请缩小选区或放大材质");
            const tile = await sharp(normalized.data).extract({ left: 0, top: 0, width: Math.min(width, normalized.info.width), height: Math.min(height, normalized.info.height) }).png().toBuffer();
            image = sharp({ create: { width, height, channels: 4, background: "#00000000" } }).composite([{ input: tile, tile: true, gravity: "northwest" }]);
        } else image = image.resize(width, height, { fit: "fill" });
        replacement = await image.raw().toBuffer();
    }
    const output = tool === "extract" ? Buffer.alloc(data.length) : data;
    for (let y = 0; y < height; y++) {
        if (y % 64 === 0) { await yieldToLoop(); signal.throwIfAborted(); }
        for (let x = 0; x < width; x++) {
            const i = ((top + y) * info.width + left + x) * 4, r = (y * width + x) * 4;
            const weight = o.feather ? Math.min(1, Math.min(x + .5, y + .5, width - x - .5, height - y - .5) / o.feather) : 1;
            if (tool === "extract") {
                data.copy(output, i, i, i + 3); output[i + 3] = Math.round(data[i + 3] * weight);
            } else {
                const alpha = replacement[r + 3] / 255 * weight, originalAlpha = data[i + 3] / 255;
                const resultAlpha = tool === "texture" ? originalAlpha : alpha + originalAlpha * (1 - alpha);
                for (let c = 0; c < 3; c++) output[i + c] = tool === "texture"
                    ? Math.round(replacement[r + c] * alpha + data[i + c] * (1 - alpha))
                    : resultAlpha ? Math.round((replacement[r + c] * alpha + data[i + c] * originalAlpha * (1 - alpha)) / resultAlpha) : 0;
                output[i + 3] = Math.round(resultAlpha * 255);
            }
        }
    }
    return sharp(output, { raw: { width: info.width, height: info.height, channels: 4 } });
}
