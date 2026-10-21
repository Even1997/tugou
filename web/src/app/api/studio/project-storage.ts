import { mkdir, readFile, writeFile, rename, stat, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import type { StudioProject, RasterBitmap } from "../../studio/model";
import { MAX_PROJECT_BYTES, MAX_IMAGE_DATA_URL } from "../../studio/image-limits.js";
import { storeImageResource, imageDataUrl } from "./image-resources.js";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const projectFile = (dir: string, id: string) => {
    if (!/^[\w-]{1,80}$/.test(id)) throw new Error("工程 ID 无效");
    return path.join(dir, `${id}.json`);
};
let queue = Promise.resolve();
async function publish(temporary: string, target: string) {
    try {
        for (let attempt = 0; ; attempt++) {
            try {
                await rename(temporary, target);
                return;
            } catch (error) {
                if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code || "") || attempt >= 6) throw error;
                await delay(25 * 2 ** attempt);
            }
        }
    } finally {
        // Never remove the destination to work around a Windows sharing violation.
        await unlink(temporary).catch(() => {});
    }
}

/** Resource files are immutable; publish the manifest only after all resources exist. */
export function saveStoredProject(dir: string, project: StudioProject) {
    const task = queue
        .catch(() => {})
        .then(async () => {
            const file = projectFile(dir, project.id);
            const folder = path.join(dir, "resources");
            await mkdir(folder, { recursive: true });
            const storeImage = async <T extends RasterBitmap>({ dataUrl, ...asset }: T) => {
                const resource = await storeImageResource(dir, dataUrl);
                return { ...asset, resource };
            };
            const assets = [];
            for (const asset of project.assets) assets.push(await storeImage(asset));
            const layers = [];
            for (const layer of project.layers) {
                layers.push({
                    ...layer,
                    ...(layer.bitmap && { bitmap: await storeImage(layer.bitmap) }),
                    ...(layer.mask?.bitmap && { mask: { ...layer.mask, bitmap: await storeImage(layer.mask.bitmap) } }),
                });
            }
            const temporary = `${file}.${randomUUID()}.tmp`;
            const selection = project.selection?.bitmap ? { ...project.selection, bitmap: await storeImage(project.selection.bitmap) } : project.selection;
            await writeFile(temporary, JSON.stringify({ ...project, selection, storageVersion: 1, assets, layers }), { flag: "wx" });
            await publish(temporary, file);
        });
    queue = task;
    return task;
}

export async function readStoredProject(dir: string, id: string, lazy = false): Promise<StudioProject> {
    const file = projectFile(dir, id);
    if ((await stat(file)).size > MAX_PROJECT_BYTES) throw new Error("工程超过读取限制");
    const stored = JSON.parse(await readFile(file, "utf8"));
    if (stored.storageVersion === undefined) return stored;
    if (stored.storageVersion !== 1 || !Array.isArray(stored.assets) || stored.assets.length > 500) throw new Error("工程存储格式无效");
    let size = 0;
    const readImage = async ({ resource, ...asset }: Record<string, unknown>) => {
        const match = typeof resource === "string" && /^([a-f0-9]{64})\.(png|jpeg|webp)$/.exec(resource);
        if (!match) throw new Error("素材引用路径无效");
        const source = path.join(dir, "resources", resource);
        const bytes = (await stat(source)).size;
        size += bytes;
        if (bytes > MAX_IMAGE_DATA_URL * .75 || (!lazy && size > MAX_PROJECT_BYTES * .75)) throw new Error("工程素材超过读取限制");
        if (lazy) return { ...asset, dataUrl: `/api/studio/resource/${resource}` };
        const data = await readFile(source);
        if (digest(data) !== match[1]) throw new Error("本地素材校验失败，请从备份恢复");
        return { ...asset, dataUrl: `data:image/${match[2]};base64,${data.toString("base64")}` };
    };
    const assets = [];
    for (const asset of stored.assets) assets.push(await readImage(asset));
    if (!Array.isArray(stored.layers) || stored.layers.length > 500) throw new Error("工程图层格式无效");
    const layers = [];
    for (const layer of stored.layers)
        layers.push({
            ...layer,
            ...(layer.bitmap && { bitmap: await readImage(layer.bitmap) }),
            ...(layer.mask?.bitmap && { mask: { ...layer.mask, bitmap: await readImage(layer.mask.bitmap) } }),
        });
    const { storageVersion: _, ...project } = stored;
    const selection = stored.selection?.bitmap ? { ...stored.selection, bitmap: await readImage(stored.selection.bitmap) } : stored.selection;
    return { ...project, ...(selection && { selection }), assets, layers };
}

/** Portable exports contain actual bytes, never machine-local resource URLs. */
export async function portableProject(dir: string, project: StudioProject): Promise<StudioProject> {
    const image = async <T extends RasterBitmap>(bitmap: T) => ({ ...bitmap, dataUrl: await imageDataUrl(dir, bitmap.dataUrl) });
    const assets = [], layers = [];
    let size = 0;
    const limited = async <T extends RasterBitmap>(bitmap: T) => {
        const result = await image(bitmap); size += result.dataUrl.length;
        if (size > MAX_PROJECT_BYTES) throw new Error("便携工程超过 512 MB，请拆分工程后导出；本地工程仍已保留");
        return result;
    };
    for (const asset of project.assets) assets.push(await limited(asset));
    for (const layer of project.layers) layers.push({ ...layer,
        ...(layer.bitmap && { bitmap: await limited(layer.bitmap) }),
        ...(layer.mask?.bitmap && { mask: { ...layer.mask, bitmap: await limited(layer.mask.bitmap) } }),
    });
    const selection = project.selection?.bitmap ? { ...project.selection, bitmap: await limited(project.selection.bitmap) } : project.selection;
    return { ...project, assets, layers, ...(selection && { selection }) };
}

export async function readProjectSummary(dir: string, id: string) {
    const file = projectFile(dir, id);
    if ((await stat(file)).size > MAX_PROJECT_BYTES) throw new Error("工程超过读取限制");
    const project = JSON.parse(await readFile(file, "utf8"));
    if (project.format !== "canvas-studio" || project.id !== id || ![1, 2, 3, 4, 5].includes(project.version) || typeof project.name !== "string" || project.name.length > 200 || typeof project.updatedAt !== "string" || !Array.isArray(project.layers))
        throw new Error("工程清单无效");
    return { id, name: project.name, updatedAt: project.updatedAt, layers: project.layers.length };
}
