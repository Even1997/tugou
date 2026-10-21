// Local UI acceptance fixture. Returns an existing demo asset; never calls a model.
import http from "node:http";
import { readFile } from "node:fs/promises";

const image = (await readFile(new URL("../public/studio-demo/03-couple.png", import.meta.url))).toString("base64");
const calls = [];
const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/qa/requests") return response.end(JSON.stringify(calls));
    const body = Buffer.concat(chunks);
    const prompt = request.url === "/v1/images/generations" ? JSON.parse(body.toString()).prompt : request.url === "/v1/images/edits" ? (await new Request("http://fixture", { method: "POST", headers: { "Content-Type": request.headers["content-type"] }, body }).formData()).get("prompt") : undefined;
    calls.push({ path: request.url, method: request.method, authorized: request.headers.authorization === "Bearer local-ui-fixture", ...(prompt !== undefined ? { prompt } : {}) });
    if (request.url === "/v1/models") return response.end(JSON.stringify({ data: [{ id: "local-ui-fixture" }] }));
    if (["/v1/images/generations", "/v1/images/edits"].includes(request.url)) return response.end(JSON.stringify({ data: [{ b64_json: image }] }));
    if (request.url === "/v1/chat/completions") return response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ modules: [{ name: "测试画风", kind: "style", text: "清线插画，柔和色彩" }, { name: "测试人物", kind: "人物", text: "一对成年新人" }], recipes: [{ name: "测试人物素材", moduleNames: ["测试人物"], output: "全身、透明背景" }] }) } }] }));
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "Unknown fixture route" } }));
});
server.listen(3421, "127.0.0.1", () => console.log("Local fixture ready on 127.0.0.1:3421; no real model calls"));
