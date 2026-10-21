import sharp from "sharp";
import path from "node:path";
import { statfs } from "node:fs/promises";
import { setImmediate as yieldToLoop } from "node:timers/promises";

/** Eight-connected visible pixels. Tiny islands go to one remainder, never disappear. */
export async function alphaParts(data, width, height, minArea, signal, progress = () => {}) {
    const labels = new Int32Array(width * height), queue = new Int32Array(width * height), parts = [];
    let remainder = 0, visited = 0, transparent = false;
    for (let y = 0; y < height; y++) {
        if (y % 32 === 0) { await yieldToLoop(); signal.throwIfAborted(); progress(y / height * 40); }
        for (let x = 0; x < width; x++) {
            const start = y * width + x;
            if (!data[start * 4 + 3]) { transparent = true; continue; }
            if (labels[start]) continue;
            const label = parts.length + 1;
            let head = 0, tail = 1, left = x, right = x, top = y, bottom = y;
            queue[0] = start; labels[start] = label;
            while (head < tail) {
                if (++visited % 262144 === 0) { await yieldToLoop(); signal.throwIfAborted(); progress(visited / (width * height) * 40); }
                const pixel = queue[head++], py = Math.floor(pixel / width), px = pixel % width;
                left = Math.min(left, px); right = Math.max(right, px); top = Math.min(top, py); bottom = Math.max(bottom, py);
                for (let ny = Math.max(0, py - 1); ny <= Math.min(height - 1, py + 1); ny++)
                    for (let nx = Math.max(0, px - 1); nx <= Math.min(width - 1, px + 1); nx++) {
                        const next = ny * width + nx;
                        if (!labels[next] && data[next * 4 + 3]) { labels[next] = label; queue[tail++] = next; }
                    }
            }
            if (tail < minArea) {
                remainder += tail;
                for (let i = 0; i < tail; i++) labels[queue[i]] = -1;
            } else {
                parts.push({ label, name: `区域 ${parts.length + 1}`, pixels: tail, bounds: { left, top, width: right - left + 1, height: bottom - top + 1 } });
                if (parts.length > 64) throw new Error("独立区域超过 64 个，请提高最小面积或改用网格拆分");
            }
        }
    }
    if (!transparent) throw new Error("自动拆分需要透明底图片，请先抠图；普通图片可使用网格拆分");
    if (remainder) parts.push({ label: -1, name: "细小区域", pixels: remainder, bounds: { left: 0, top: 0, width, height } });
    if (!parts.length) throw new Error("图片完全透明，没有可拆分内容");
    if (parts.length > 64) throw new Error("含细小区域共超过 64 层，请提高最小面积");
    return { labels, parts };
}

export function gridParts(width, height, columns, rows) {
    if (columns > width || rows > height) throw new Error("行列数量不能超过原图像素尺寸");
    return Array.from({ length: rows * columns }, (_, index) => {
        const row = Math.floor(index / columns), column = index % columns;
        const left = Math.floor(column * width / columns), top = Math.floor(row * height / rows);
        const bounds = { left, top, width: Math.floor((column + 1) * width / columns) - left, height: Math.floor((row + 1) * height / rows) - top };
        return { name: `第 ${row + 1} 行 · 第 ${column + 1} 列`, bounds, pixels: bounds.width * bounds.height };
    });
}

export async function splitImage(input, folder, options, signal, progress) {
    if (options.splitMode === "alpha" && !(await sharp(input).metadata()).hasAlpha) throw new Error("自动拆分需要透明底图片，请先抠图；普通图片可使用网格拆分");
    const { data, info } = await sharp(input).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const { labels, parts } = options.splitMode === "alpha"
        ? await alphaParts(data, width, height, options.minArea, signal, progress)
        : { labels: undefined, parts: gridParts(width, height, options.columns, options.rows) };
    const disk = await statfs(folder);
    // Pixel ownership is disjoint; reserve content plus sparse-frame overhead and recheck each write.
    const reserved = data.length * 2 + parts.length * width * height * .02 + 128 * 1024 * 1024;
    if (disk.bavail * disk.bsize < reserved) throw new Error("拆分输出预留空间不足，请减少行列或区域数量，或更换工具缓存目录");
    const output = Buffer.alloc(data.length), outputs = [];
    for (let index = 0; index < parts.length; index++) {
        await yieldToLoop(); signal.throwIfAborted(); output.fill(0);
        const available = await statfs(folder);
        if (available.bavail * available.bsize < data.length + 32 * 1024 * 1024) throw new Error("拆分期间磁盘空间不足，已停止；原图保留，可释放空间后重试");
        const part = parts[index], b = part.bounds;
        let opaque = b.width === width && b.height === height;
        for (let y = b.top; y < b.top + b.height; y++) {
            if (y % 64 === 0) { await yieldToLoop(); signal.throwIfAborted(); }
            if (!labels) data.copy(output, (y * width + b.left) * 4, (y * width + b.left) * 4, (y * width + b.left + b.width) * 4);
            for (let x = b.left; x < b.left + b.width; x++) {
                const i = y * width + x;
                if (labels) { if (labels[i] === part.label) data.copy(output, i * 4, i * 4, i * 4 + 4); else opaque = false; }
                if (data[i * 4 + 3] !== 255) opaque = false;
            }
        }
        const written = await sharp(output, { raw: { width, height, channels: 4 } }).png().toFile(path.join(folder, index ? `output-${index}.png` : "output.png"));
        signal.throwIfAborted();
        outputs.push({ name: part.name, width, height, bounds: b, pixels: part.pixels, hasAlpha: !opaque, bytes: written.size });
        progress(40 + (index + 1) / parts.length * 55);
    }
    return { width, height, outputs };
}
