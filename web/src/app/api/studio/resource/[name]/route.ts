import { readImageResource } from "../../image-resources.js";
import path from "node:path";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ name: string }> }) {
    const host = request.headers.get("host") || "", origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || (origin && origin !== `http://${host}`) || (site && !["same-origin", "none"].includes(site))) return new Response(null, { status: 403 });
    try {
        const { name } = await context.params, thumbnail = new URL(request.url).searchParams.get("thumbnail") === "1";
        const result = await readImageResource(process.env.STUDIO_DATA_DIR || path.resolve(process.cwd(), "../data/studio"), name, thumbnail);
        const etag = `"${name}${thumbnail ? ":thumb-v1" : ""}"`;
        const headers = { "Content-Type": result.mime, "Cache-Control": "private, max-age=31536000, immutable", "ETag": etag, "Cross-Origin-Resource-Policy": "same-origin", "X-Content-Type-Options": "nosniff" };
        if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
        return new Response(new Uint8Array(result.bytes), { headers });
    } catch { return new Response("素材无法读取，请检查本地资源或恢复备份", { status: 404 }); }
}
