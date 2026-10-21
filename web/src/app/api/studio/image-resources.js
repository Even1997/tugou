import { readFile, writeFile, mkdir, stat, rename, unlink, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { resourceName } from "../../studio/resource-url.js";
import { MAX_IMAGE_DATA_URL, validImageSize } from "../../studio/image-limits.js";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const verified = new Map();
const pending = new Map();
const storing = new Map();
let thumbnailQueue = Promise.resolve();
const resourcePath = (dir, name) => {
    if (!/^[a-f0-9]{64}\.(png|jpeg|webp)$/.test(name)) throw new Error("素材引用路径无效");
    return path.join(dir, "resources", name);
};
export async function checkResource(dir, name) {
    const file = resourcePath(dir, name), info = await stat(file);
    if (info.size > MAX_IMAGE_DATA_URL * .75) throw new Error("素材超过读取限制");
    const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`, previous = verified.get(file);
    if (previous !== stamp) {
        if (digest(await readFile(file)) !== name.split(".")[0]) throw new Error("本地素材校验失败，请从备份恢复");
        verified.delete(file); verified.set(file, stamp);
        if (verified.size > 1024) verified.delete(verified.keys().next().value);
    }
    return file;
}
export async function storeImageResource(dir, source) {
    const existing = resourceName(source);
    if (existing) { await checkResource(dir, existing); return existing; }
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(source || "");
    if (!match || source.length > MAX_IMAGE_DATA_URL) throw new Error("素材格式或大小无效");
    const bytes = Buffer.from(match[2], "base64"), name = `${digest(bytes)}.${match[1]}`;
    const target = resourcePath(dir, name);
    if (!storing.has(target)) {
        const task = (async () => {
            await mkdir(path.dirname(target), { recursive: true });
            try { await checkResource(dir, name); }
            catch (error) {
                if (error.code !== "ENOENT") throw error;
                const meta = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata();
                if (!validImageSize(meta.width, meta.height) || meta.format !== match[1]) throw new Error("图片格式或尺寸无效");
                const temp = `${target}.${randomUUID()}.tmp`;
                try { await writeFile(temp, bytes, { flag: "wx" }); await rename(temp, target); }
                finally { await unlink(temp).catch(() => {}); }
            }
        })().finally(() => storing.delete(target));
        storing.set(target, task);
    }
    await storing.get(target);
    return name;
}
export async function imageDataUrl(dir, source) {
    const name = resourceName(source);
    if (!name) return source;
    const bytes = await readFile(await checkResource(dir, name));
    return `data:image/${name.split(".")[1]};base64,${bytes.toString("base64")}`;
}

// A fixed, versioned size keeps the disk cache bounded and avoids arbitrary resize requests.
export async function readImageResource(dir, name, thumbnail = false) {
    const source = resourcePath(dir, name);
    if (!thumbnail) return { bytes: await readFile(await checkResource(dir, name)), mime: `image/${name.split(".")[1]}` };
    await stat(source);
    const folder = path.join(dir, "thumbnails-v1"), file = path.join(folder, `${name}.webp`);
    try { return { bytes: await readFile(file), mime: "image/webp" }; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!pending.has(file)) {
        const task = thumbnailQueue.catch(() => {}).then(async () => {
            await checkResource(dir, name);
            await mkdir(folder, { recursive: true });
            const bytes = await sharp(source, { limitInputPixels: 100_000_000 }).autoOrient().resize(384, 384, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82, alphaQuality: 100 }).toBuffer();
            const temp = `${file}.${randomUUID()}.tmp`;
            try { await writeFile(temp, bytes, { flag: "wx" }); await rename(temp, file); }
            finally { await unlink(temp).catch(() => {}); }
            // Cache files alone are disposable; never prune original resources.
            const entries = await readdir(folder);
            if (entries.length > 1024) {
                const files = await Promise.all(entries.filter(n => /^[a-f0-9]{64}\.(png|jpeg|webp)\.webp$/.test(n)).map(async n => ({ name: n, time: (await stat(path.join(folder, n))).mtimeMs })));
                for (const old of files.sort((a, b) => a.time - b.time).slice(0, Math.max(0, files.length - 1000))) await unlink(path.join(folder, old.name)).catch(() => {});
            }
            return { bytes, mime: "image/webp" };
        }).finally(() => pending.delete(file));
        pending.set(file, task); thumbnailQueue = task;
    }
    return pending.get(file);
}
