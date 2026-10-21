import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, rmdir, rename, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { validImageSize } from "../../studio/image-limits.js";

type Job = { folder: string; width: number; height: number; nextY: number; format: "png" | "jpg"; name: string; files: { input: string; top: number; left: number }[]; touched: number; busy: boolean; cancelled?: boolean; publishing?: boolean };
const jobs = new Map<string, Job>();
const initialized = new Map<string, Promise<void>>();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
sharp.cache({ memory: 32, files: 32, items: 64 });
sharp.concurrency(1);
async function discard(id: string, job: Job) {
    for (const file of [...job.files.map((f) => f.input), path.join(job.folder, "output")]) await unlink(file).catch(() => {});
    await rmdir(job.folder).catch(() => {});
    jobs.delete(id);
}
async function initialize(folder: string) {
    if (!initialized.has(folder)) initialized.set(folder, (async () => {
        await mkdir(folder, { recursive: true });
        const root = await realpath(folder);
        for (const entry of await readdir(root, { withFileTypes: true })) {
            const id = entry.name.slice(9);
            if (!entry.name.startsWith(".partial-") || !uuid.test(id) || !entry.isDirectory() || entry.isSymbolicLink() || jobs.has(id)) continue;
            const candidate = path.join(root, entry.name);
            if (await realpath(candidate) !== candidate) continue;
            const files = await readdir(candidate, { withFileTypes: true });
            // Never recursively remove a folder: unknown contents and links belong to the user.
            if (files.some(f => !f.isFile() || f.isSymbolicLink() || !/^(?:\d{1,5}\.png|output)$/.test(f.name))) continue;
            for (const file of files) await unlink(path.join(candidate, file.name));
            await rmdir(candidate);
        }
    })().catch(error => { initialized.delete(folder); throw error; }));
    await initialized.get(folder);
}
const checkCancelled = (job: Job) => { if (job.cancelled) throw new Error("导出已取消"); };
/** Only opaque job IDs and sequential, bounded PNG strips cross the renderer boundary. */
export async function imageExport(dataDir: string, action: string, p: Record<string, unknown>) {
    const exportsFolder = path.resolve(dataDir, "exports");
    if (action === "export-start") {
        await initialize(exportsFolder);
        for (const [id, job] of jobs) if (!job.busy && Date.now() - job.touched > 15 * 60_000) await discard(id, job);
        const width = Number(p.width),
            height = Number(p.height);
        if (!validImageSize(width, height) || !["png", "jpg"].includes(String(p.format))) throw new Error("导出尺寸或格式无效");
        if ([...jobs.values()].filter(job => path.dirname(job.folder) === exportsFolder).length >= 2) throw new Error("请等待当前导出完成");
        const id = randomUUID(),
            folder = path.join(exportsFolder, `.partial-${id}`);
        jobs.set(id, {
            folder,
            width,
            height,
            nextY: 0,
            format: p.format as "png" | "jpg",
            name: String(p.name || "创作")
                .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
                .slice(0, 80),
            files: [],
            touched: Date.now(),
            busy: false,
        });
        try { await mkdir(folder); } catch (error) { jobs.delete(id); throw error; }
        return { id };
    }
    const id = String(p.id),
        job = jobs.get(id);
    if (!uuid.test(id) || (job && path.dirname(job.folder) !== exportsFolder)) throw new Error("导出任务不存在");
    if (action === "export-cancel") {
        if (!job) return { cancelled: false };
        // Publication is the commit point; a completed export is never removed by a late cancel.
        if (job.publishing) return { cancelled: false };
        job.cancelled = true;
        if (!job.busy) { job.busy = true; await discard(id, job); }
        return { cancelled: true };
    }
    if (!job || job.busy || job.cancelled) throw new Error("导出任务不存在或正在处理");
    job.busy = true;
    job.touched = Date.now();
    try {
        if (action === "export-stripe") {
            const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(p.dataUrl || ""));
            if (!match || match[1].length > 24_000_000 || p.y !== job.nextY) throw new Error("导出分块顺序或数据无效");
            const buffer = Buffer.from(match[1], "base64");
            const meta = await sharp(buffer, { limitInputPixels: 4_000_000 }).metadata();
            checkCancelled(job);
            if (meta.format !== "png" || meta.width !== job.width || !meta.height || meta.height > 512 || job.nextY + meta.height > job.height) throw new Error("导出分块尺寸无效");
            const file = path.join(job.folder, `${job.nextY}.png`);
            job.files.push({ input: file, top: job.nextY, left: 0 });
            try { await writeFile(file, buffer, { flag: "wx" }); } catch (error) { job.cancelled = true; throw error; }
            checkCancelled(job);
            job.nextY += meta.height;
            return { rows: job.nextY };
        }
        if (action !== "export-finish" || job.nextY !== job.height) throw new Error("导出分块尚未完整");
        const temporary = path.join(job.folder, "output");
        const result = path.join(path.dirname(job.folder), `${job.name}-${id}.${job.format}`);
        const pipeline = sharp({ create: { width: job.width, height: job.height, channels: job.format === "jpg" ? 3 : 4, background: job.format === "jpg" ? "#ffffff" : "#00000000" } }).composite(job.files);
        try {
            await (job.format === "jpg" ? pipeline.jpeg({ quality: 95 }) : pipeline.png()).toFile(temporary);
            checkCancelled(job);
            job.publishing = true;
            await rename(temporary, result);
        } catch (error) { job.cancelled = true; throw error; }
        await discard(id, job);
        return { path: result };
    } finally {
        if (job.cancelled) await discard(id, job);
        job.busy = false;
    }
}
