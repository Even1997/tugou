import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { unlink } from "node:fs/promises";
const base = process.env.STUDIO_TEST_URL;
if (!["http://127.0.0.1:3437", "http://127.0.0.1:3439"].includes(base)) throw Error("Use isolated QA frontend");
const request = async (action, payload, headers = {}) => {
    const response = await fetch(`${base}/api/studio`, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Request": "1", ...headers }, body: JSON.stringify({ action, payload }) });
    return { status: response.status, body: await response.json() };
};
const strip = async (width, height, color) => "data:image/png;base64," + (await sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer()).toString("base64");
test("分块导出拒绝跨来源、超尺寸、无效任务、乱序与未完整提交", async () => {
    assert.equal((await request("export-start", { width: 64, height: 64, format: "png" }, { Origin: "https://untrusted.example" })).status, 403);
    assert.equal((await request("export-start", { width: 10000, height: 10001, format: "png" })).status, 400);
    assert.equal((await request("export-cancel", { id: "../credentials.enc" })).status, 400);
    const started = await request("export-start", { width: 64, height: 64, format: "png", name: "../export" });
    assert.equal(started.status, 200); const { id } = started.body;
    try {
        assert.equal((await request("export-finish", { id })).status, 400);
        assert.equal((await request("export-stripe", { id, y: 1, dataUrl: await strip(64, 32, "#ff0000") })).status, 400);
        assert.equal((await request("export-stripe", { id, y: 0, dataUrl: await strip(63, 32, "#ff0000") })).status, 400);
        assert.equal((await request("export-stripe", { id, y: 0, dataUrl: await strip(64, 32, "#ff0000") })).status, 200);
        assert.equal((await request("export-stripe", { id, y: 0, dataUrl: await strip(64, 32, "#ff0000") })).status, 400);
        assert.equal((await request("export-stripe", { id, y: 32, dataUrl: await strip(64, 32, "#0000ff80") })).status, 200);
        const done = await request("export-finish", { id });
        assert.equal(done.status, 200);
        const { data, info } = await sharp(done.body.path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.equal(info.width, 64); assert.equal(info.height, 64);
        assert.deepEqual([...data.subarray(0, 4)], [255, 0, 0, 255]);
        assert.deepEqual([...data.subarray(-4)], [0, 0, 255, 128]);
        await unlink(done.body.path);
        assert.equal((await request("export-finish", { id })).status, 400);
    } finally { await request("export-cancel", { id }); }
});
test("取消导出释放任务；30,000 长边可接受但总像素仍有边界", async () => {
    const started = await request("export-start", { width: 30000, height: 64, format: "png" });
    assert.equal(started.status, 200);
    assert.equal((await request("export-cancel", { id: started.body.id })).status, 200);
    assert.equal((await request("export-start", { width: 30001, height: 64, format: "png" })).status, 400);
});
