import { NextRequest } from "next/server";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { validateProject } from "../../studio/model";
import { gateway, publicConfig, setConfig } from "./gateway";
import { readStoredProject, readProjectSummary, saveStoredProject, portableProject } from "./project-storage";
import { storeImageResource, imageDataUrl } from "./image-resources.js";
import { MAX_PROJECT_BYTES } from "../../studio/image-limits.js";
import { imageExport } from "./image-export";
import { toolRequest } from "./tools";
import { generationRequest } from "./generations";
import { normalizeImageOrientation } from "./cloud-image-tools.js";

export const runtime = "nodejs";
export const maxDuration = 600;
const dataDir = () => process.env.STUDIO_DATA_DIR || path.resolve(process.cwd(), "../data/studio");
const validId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{1,80}$/.test(id);
export async function POST(request: NextRequest) {
    const host = request.headers.get("host") || "";
    const origin = request.headers.get("origin");
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || (origin && origin !== `http://${host}`) || request.headers.get("x-studio-request") !== "1") return Response.json({ error: "仅允许本机工作台访问" }, { status: 403 });
    try {
        if (Number(request.headers.get("content-length")) > MAX_PROJECT_BYTES) throw new Error("工程超过 512 MB 限制");
        const { action, payload: p } = await request.json();
        if (typeof action === "string" && action.startsWith("generation-")) return Response.json(await generationRequest(dataDir(), action, p));
        if (typeof action === "string" && action.startsWith("tool-")) {
            const payload = action === "tool-submit" ? { ...p, dataUrl: await imageDataUrl(dataDir(), p.dataUrl), ...(p.secondaryDataUrl && { secondaryDataUrl: await imageDataUrl(dataDir(), p.secondaryDataUrl) }) } : p;
            return Response.json(await toolRequest(dataDir(), action, payload));
        }
        if (action === "resource-store") return Response.json({ dataUrl: `/api/studio/resource/${await storeImageResource(dataDir(), p.dataUrl)}` });
        if (["export-start", "export-stripe", "export-finish", "export-cancel"].includes(action)) return Response.json(await imageExport(dataDir(), action, p));
        if (action === "save") {
            validateProject(p);
            await saveStoredProject(dataDir(), p);
            return Response.json({ savedAt: p.updatedAt });
        }
        if (action === "open") {
            if (!validId(p.id)) throw new Error("工程 ID 无效");
            const project = await readStoredProject(dataDir(), p.id, p.lazy === true);
            validateProject(project);
            return Response.json(project);
        }
        if (action === "list") {
            await mkdir(dataDir(), { recursive: true });
            const names = (await readdir(/* turbopackIgnore: true */ dataDir())).filter((n) => /^[\w-]+\.json$/.test(n));
            const projects = await Promise.all(
                names.map(async (n) => {
                    try {
                        return await readProjectSummary(dataDir(), n.slice(0, -5));
                    } catch {
                        return null;
                    }
                }),
            );
            return Response.json({ projects: projects.filter(Boolean), location: dataDir() });
        }
        if (action === "config") return Response.json(publicConfig());
        if (action === "export-project") {
            validateProject(p);
            const folder = path.join(dataDir(), "exports");
            await mkdir(folder, { recursive: true });
            const name = p.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80);
            const file = path.join(folder, `${name}-${Date.now()}.studio`);
            const content = JSON.stringify(await portableProject(dataDir(), p));
            if (Buffer.byteLength(content) > MAX_PROJECT_BYTES) throw new Error("便携工程超过 512 MB，请拆分工程后导出；本地工程仍已保留");
            await writeFile(file, content, { encoding: "utf8", flag: "wx" });
            return Response.json({ path: file });
        }
        if (action === "export") {
            const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(await imageDataUrl(dataDir(), p.dataUrl) || "");
            if (!match || match[2].length > 150_000_000) throw new Error("导出图片格式或大小无效");
            const folder = path.join(dataDir(), "exports");
            await mkdir(folder, { recursive: true });
            const name = String(p.name || "创作")
                .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
                .slice(0, 80);
            const file = path.join(folder, `${name}-${Date.now()}.${match[1] === "jpeg" ? "jpg" : match[1]}`);
            await writeFile(file, Buffer.from(match[2], "base64"), { flag: "wx" });
            return Response.json({ path: file });
        }
        if (action === "configure") {
            setConfig(p);
            return Response.json(publicConfig());
        }
        if (action === "split-categories") return Response.json(await gateway(action, { image: await normalizeImageOrientation(await imageDataUrl(dataDir(), p.image)) }, request.signal));
        if (["models", "analyze", "generate"].includes(action)) {
            if (action === "generate" && (!Array.isArray(p.references || []) || (p.references || []).length > 12)) throw new Error("最多支持 12 张参考图");
            const payload = action === "analyze" ? { ...p, image: await imageDataUrl(dataDir(), p.image) } : action === "generate" ? { ...p, references: await Promise.all((p.references || []).map((source: string) => imageDataUrl(dataDir(), source))) } : p;
            return Response.json(await gateway(action, payload));
        }
        return Response.json({ error: "不支持的操作" }, { status: 400 });
    } catch (error) {
        const message = error instanceof Error ? error.message : "操作失败";
        return Response.json({ error: message.slice(0, 600) }, { status: 400 });
    }
}
