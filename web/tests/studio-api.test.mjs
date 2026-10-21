import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { blankProject } from "../src/app/studio/model.ts";

const base = process.env.STUDIO_TEST_URL || "http://127.0.0.1:3417";
const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6j8AAAAASUVORK5CYII=";
let provider, port, previous, lastEdit;
const calls = [];
async function request(action, payload = {}, headers = {}) {
    const response = await fetch(`${base}/api/studio`, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Request": "1", ...headers }, body: JSON.stringify({ action, payload }) });
    return { status: response.status, body: await response.json() };
}
before(async () => {
    previous = (await request("config")).body;
    provider = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        calls.push({ url: req.url, authorization: req.headers.authorization, model: req.headers["content-type"]?.includes("application/json") && body.length ? JSON.parse(body).model : undefined });
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/v1/images/generations" && JSON.parse(body).prompt === "qa-error") {
            res.statusCode = 401;
            return res.end(JSON.stringify({ error: { message: "Invalid key qa-fixture-not-a-secret" } }));
        }
        if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "fixture-image" }] }));
        if (req.url === "/v1/images/edits") {
            const form = await new Request("http://fixture", { method: "POST", headers: { "Content-Type": req.headers["content-type"] }, body }).formData();
            lastEdit = { prompt: form.get("prompt"), model: form.get("model"), images: await Promise.all(form.getAll("image[]").map(async (image) => Buffer.from(await image.arrayBuffer()).toString("base64"))) };
        }
        if (req.url === "/v1/chat/completions")
            return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ modules: [{ name: "宠物", kind: "宠物", text: "一只小狗" }], recipes: [{ name: "狗", moduleNames: ["宠物"], output: "全身" }] }) } }] }));
        res.end(JSON.stringify({ data: [{ b64_json: pixel }] }));
    });
    await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
    port = provider.address().port;
    const configured = await request("configure", { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "qa-fixture-not-a-secret", model: "fixture-image", analysisModel: "fixture-vision" });
    assert.equal(configured.status, 200);
});
after(async () => {
    await request("configure", { ...previous, apiKey: "" });
    await new Promise((resolve) => provider.close(resolve));
});
test("跨来源写入被拒绝", async () => {
    const r = await request("configure", {}, { Origin: "https://untrusted.example" });
    assert.equal(r.status, 403);
});
test("配置仅包含模型 API 字段，不泄露密钥", async () => {
    const r = await request("config");
    assert.equal(r.body.hasApiKey, true);
    assert.equal(r.body.apiKey, undefined);
    assert.deepEqual(Object.keys(r.body).sort(), ["baseUrl", "model", "analysisModel", "hasApiKey"].sort());
    assert.ok(!JSON.stringify(r.body).includes("qa-fixture-not-a-secret"));
});
test("API 模型列表、文生图返回与参考图 multipart 可用", async () => {
    const models = await request("models");
    assert.equal(models.body.models[0].model, "fixture-image");
    const generated = await request("generate", { prompt: "测试色块", size: "1024x1024", references: [] });
    assert.equal(generated.status, 200);
    assert.match(generated.body.dataUrl, /^data:image\/png;base64,/);
    const second = Buffer.from("second-reference-order-fixture").toString("base64");
    const edited = await request("generate", { prompt: "保留参考身份", size: "1024x1024", references: [`data:image/png;base64,${pixel}`, `data:image/png;base64,${second}`] });
    assert.equal(edited.status, 200);
    assert.deepEqual(lastEdit, { prompt: "保留参考身份", model: "fixture-image", images: [pixel, second] });
    assert.deepEqual(
        calls.map((c) => c.url),
        ["/v1/models", "/v1/images/generations", "/v1/images/edits"],
    );
    assert.ok(calls.every((c) => c.authorization === "Bearer qa-fixture-not-a-secret"));
});
test("旧 MCP 操作入口不可调用，旧配置不会切换回 MCP", async () => {
    const count = calls.length;
    assert.equal((await request("mcp-tools")).status, 400);
    const r = await request("configure", { mode: "mcp", mcpUrl: "https://untrusted.example/mcp", mcpToken: "ignored" });
    assert.equal(r.status, 200);
    assert.equal(r.body.mode, undefined);
    assert.equal(r.body.mcpUrl, undefined);
    assert.equal(calls.length, count);
});
test("提供商错误不泄露密钥，失败请求不会自动重试", async () => {
    const count = calls.length;
    const r = await request("generate", { prompt: "qa-error" });
    assert.equal(r.status, 400);
    assert.ok(!JSON.stringify(r.body).includes("qa-fixture-not-a-secret"));
    assert.match(r.body.error, /已隐藏/);
    assert.equal(calls.length, count + 1);
});
test("分析接口接受视觉输入并返回动态模块", async () => {
    const r = await request("analyze", { image: `data:image/png;base64,${pixel}` });
    assert.equal(r.status, 200);
    assert.equal(r.body.modules[0].kind, "宠物");
});
test("工程写入与重开完整往返", async () => {
    const p = blankProject();
    p.id = "qa-roundtrip";
    p.name = "QA roundtrip";
    const saved = await request("save", p);
    assert.equal(saved.status, 200);
    const opened = await request("open", { id: p.id });
    assert.deepEqual(opened.body, p);
});
test("非法路径、损坏工程与超大尺寸不写入磁盘", async () => {
    assert.equal((await request("open", { id: "../credentials" })).status, 400);
    assert.equal((await request("save", { ...blankProject(), width: 90000 })).status, 400);
});

test("两个工作区共用密钥与模型，保存一次立即同时生效", async () => {
    const canvas = async (route, body, extra = {}) => {
        const response = await fetch(`${base}/api/studio/model/v1${route}`, {
            method: body ? "POST" : "GET",
            headers: { Authorization: "Bearer studio-managed", ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...extra },
            ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
        });
        return { status: response.status, body: await response.json() };
    };
    await request("configure", { model: "shared-image-v2", analysisModel: "shared-vision-v2" });
    assert.equal((await request("generate", { prompt: "prompt-workspace" })).status, 200);
    const image = await canvas("/images/generations", { model: "stale-client-model", prompt: "canvas-workspace" });
    assert.equal(image.status, 200);
    assert.equal(image.body.data[0].b64_json, pixel);
    assert.deepEqual(calls.slice(-2).map((c) => c.model), ["shared-image-v2", "shared-image-v2"]);
    assert.ok(calls.slice(-2).every((c) => c.authorization === "Bearer qa-fixture-not-a-secret"));
    assert.equal((await canvas("/chat/completions", { model: "stale-model", messages: [{ role: "user", content: "describe" }], stream: true })).status, 200);
    assert.equal(calls.at(-1).model, "shared-vision-v2");
    const form = new FormData();
    form.set("model", "stale-model"); form.set("prompt", "edit from canvas");
    form.append("image[]", new Blob([Buffer.from(pixel, "base64")], { type: "image/png" }), "reference.png");
    assert.equal((await canvas("/images/edits", form)).status, 200);
    assert.equal(lastEdit.model, "shared-image-v2");
    assert.deepEqual(lastEdit.images, [pixel]);
    const count = calls.length;
    assert.equal((await canvas("/images/generations", { prompt: "blocked" }, { Origin: "https://untrusted.example" })).status, 403);
    assert.equal((await canvas("/images/generations", { prompt: "blocked" }, { Authorization: "Bearer wrong" })).status, 403);
    assert.equal((await canvas("/unsupported", {})).status, 400);
    assert.equal(calls.length, count);
    const error = await canvas("/images/generations", { prompt: "qa-error" });
    assert.equal(error.status, 400);
    assert.ok(!JSON.stringify(error.body).includes("qa-fixture-not-a-secret"));
    assert.equal(calls.length, count + 1);
});
