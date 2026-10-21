import { canvasModelRequest } from "../../../gateway";

export const runtime = "nodejs";
export const maxDuration = 600;
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
    const host = request.headers.get("host") || "";
    const origin = request.headers.get("origin");
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || (origin && origin !== `http://${host}`) || request.headers.get("authorization") !== "Bearer studio-managed") {
        return Response.json({ error: { message: "仅允许本机工作台访问" } }, { status: 403 });
    }
    const route = `/${(await context.params).path.join("/")}`;
    const allowed = request.method === "GET" ? ["/models"] : ["/images/generations", "/images/edits", "/chat/completions"];
    if (!allowed.includes(route)) return Response.json({ error: { message: "共用连接支持图片生成、编辑和视觉分析" } }, { status: 400 });
    if (Number(request.headers.get("content-length")) > 160_000_000) return Response.json({ error: { message: "请求超过 160 MB" } }, { status: 413 });
    return canvasModelRequest(request, route);
}
export const GET = handle;
export const POST = handle;
