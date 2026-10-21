import sharp from "sharp";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { validImageSize } from "../../studio/image-limits.js";

const linear = value => { const n = value / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; };
const srgb = value => Math.round(255 * Math.min(1, Math.max(0, value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055)));

/** A 2D exposure field, with no inferred depth or generated shadows. */
export async function lightImage(input, options, signal) {
    const { data, info } = await sharp(input).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (options.exposure !== 0) {
        const angle = options.angle * Math.PI / 180, dx = Math.cos(angle), dy = Math.sin(angle), norm = Math.abs(dx) + Math.abs(dy);
        const tint = [1, 3, 5].map(i => parseInt(options.color.slice(i, i + 2), 16) / 255);
        const lut = Array.from({ length: 256 }, (_, i) => linear(i));
        const radius = options.lightRadius * Math.min(info.width, info.height);
        for (let y = 0; y < info.height; y++) {
            if (y % 32 === 0) { await yieldToLoop(); signal.throwIfAborted(); }
            for (let x = 0; x < info.width; x++) {
                const i = (y * info.width + x) * 4;
                if (!data[i + 3]) continue;
                const field = options.lightType === "radial"
                    ? Math.max(0, 1 - Math.hypot(x + .5 - options.lightX * info.width, y + .5 - options.lightY * info.height) / radius) ** 2
                    : Math.max(0, Math.min(1, .5 + (((x + .5) / info.width - .5) * dx + ((y + .5) / info.height - .5) * dy) / norm));
                if (field === 0) continue;
                for (let c = 0; c < 3; c++) data[i + c] = srgb(lut[data[i + c]] * 2 ** (options.exposure * field * tint[c]));
            }
        }
    }
    signal.throwIfAborted();
    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
}

/** Pixel sampling avoids thousands of composite objects and preserves transparent gaps. */
export async function patternImage(input, options, signal) {
    const meta = await sharp(input).metadata(), width = Math.round(meta.width * options.tileScale), height = Math.round(meta.height * options.tileScale);
    if (!validImageSize(width, height)) throw new Error("图案单元缩放后的尺寸无效，请调整比例");
    const data = await sharp(input).toColourspace("srgb").ensureAlpha().resize(width, height).raw().toBuffer();
    const output = Buffer.alloc(options.width * options.height * 4), cellWidth = width + options.gap, cellHeight = height + options.gap;
    for (let y = 0; y < options.height; y++) {
        if (y % 32 === 0) { await yieldToLoop(); signal.throwIfAborted(); }
        for (let x = 0; x < options.width; x++) {
            const column = Math.floor(x / cellWidth), offset = options.pattern === "half-drop" && column % 2 ? Math.floor(cellHeight / 2) : 0;
            const shiftedY = y - offset, row = Math.floor(shiftedY / cellHeight);
            let tx = x % cellWidth, ty = ((shiftedY % cellHeight) + cellHeight) % cellHeight;
            if (tx >= width || ty >= height) continue;
            if (options.pattern === "mirror") { if (column % 2) tx = width - 1 - tx; if (row % 2) ty = height - 1 - ty; }
            const source = (ty * width + tx) * 4, target = (y * options.width + x) * 4;
            for (let c = 0; c < 4; c++) output[target + c] = data[source + c];
        }
    }
    signal.throwIfAborted();
    return sharp(output, { raw: { width: options.width, height: options.height, channels: 4 } });
}
