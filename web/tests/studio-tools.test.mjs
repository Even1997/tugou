import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { ToolQueue } from "../src/app/api/studio/tool-queue.ts";
import { processImageTool, validateTool } from "../src/app/api/studio/image-tools.ts";

async function folder(t) { const f = await mkdtemp(path.join(os.tmpdir(), "studio-tools-")); t.after(() => rm(f, { recursive: true, force: true })); return f; }
async function settled(queue, id) {
    for (let i = 0; i < 300; i++) { const j = (await queue.list("p")).find(j => j.id === id); if (j && !["queued", "running"].includes(j.status)) { await delay(25); return j; } await delay(10); }
    throw new Error("test task timed out");
}
const submission = (id, dataUrl = "data:image/png;base64,YQ==") => ({ id, projectId: "p", sourceId: "a", name: "样本", tool: "resize", options: { width: 2, height: 2 }, dataUrl });

test("抠图模式校验、任务快照及旧任务兼容", async t => {
    validateTool("cutout", {});
    validateTool("cutout", { cutoutModel: "standard" });
    validateTool("cutout", { cutoutModel: "detail" });
    assert.throws(() => validateTool("cutout", { cutoutModel: "unknown" }), /模式/);
    const root = await folder(t);
    const queue = new ToolQueue(root, async (job, f) => { assert.equal(job.options.cutoutModel, "detail"); await writeFile(path.join(f, "output.png"), "ok"); return { width: 2, height: 2 }; });
    await queue.submit({ ...submission("detail"), tool: "cutout", options: { cutoutModel: "detail" } });
    await settled(queue, "detail");
    const restored = new ToolQueue(root, () => { throw new Error("must not rerun"); });
    assert.equal((await restored.list("p"))[0].options.cutoutModel, "detail");
});

test("轮询不重复传输 LUT 原文，任务快照仍保留以供复现", async t => {
    const root = await folder(t), lut = 'LUT_1D_SIZE 2\n0 0 0\n1 1 1';
    const q = new ToolQueue(root, async (job, f) => { await writeFile(path.join(f, "output.png"), "ok"); return { width: 2, height: 2 }; });
    await q.submit({ ...submission("lut"), tool: "lut", options: { lut, lutName: "identity.cube", intensity: 1 } });
    await settled(q, "lut");
    const listed = (await q.list("p"))[0]; assert.equal(listed.options.lut, undefined); assert.equal(listed.options.lutName, "identity.cube");
    assert.equal(JSON.parse(await readFile(path.join(root, "lut", "job.json"), "utf8")).job.options.lut, lut);
});

test("原图快照独立保存，失败重试沿用快照且重复点击不重复执行", async t => {
    const root = await folder(t); let calls = 0;
    const q = new ToolQueue(root, async (job, f) => { calls++; if (job.id === "first") throw Error("模拟失败"); await writeFile(path.join(f, "output.png"), "ok"); return { width: 2, height: 2 }; });
    await q.submit(submission("first"));
    assert.equal((await settled(q, "first")).status, "failed");
    assert.equal((await q.source("first", "p")).dataUrl, submission("first").dataUrl);
    await assert.rejects(q.source("first", "foreign"), /不存在/);
    await Promise.all([q.retry("first", "p", "retry"), q.retry("first", "p", "retry")]);
    assert.equal((await settled(q, "retry")).status, "completed");
    assert.equal(calls, 2);
    await assert.rejects(q.retry("retry", "p", "again"), /无需重试/);
});

test("队列串行执行、并发重试去重、拒绝同 ID 不同输入、恢复完成结果", async t => {
    const root = await folder(t); let running = 0, peak = 0, calls = 0;
    const q = new ToolQueue(root, async (job, f) => { peak = Math.max(peak, ++running); calls++; await delay(20); await writeFile(path.join(f, "output.png"), job.id); running--; return { width: 2, height: 2 }; });
    await Promise.all([q.submit(submission("one")), q.submit(submission("one")), q.submit(submission("two"))]);
    await assert.rejects(q.submit({ ...submission("one"), sourceId: "b" }), /不同输入/);
    assert.equal((await settled(q, "two")).status, "completed"); assert.equal(peak, 1); assert.equal(calls, 2);
    const restored = new ToolQueue(root, () => { throw new Error("must not re-run"); });
    assert.equal((await restored.result("one", "p")).dataUrl, `data:image/png;base64,${Buffer.from("one").toString("base64")}`);
    await assert.rejects(restored.result("one", "other"), /结果/);
});
test("取消排队与运行任务，即使处理器迟到完成也不发布结果", async t => {
    const root = await folder(t); let calls = 0;
    let begin, release;
    const started = new Promise(resolve => { begin = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const q = new ToolQueue(root, async (job, f) => { calls++; if (job.id === "one") { begin(); await gate; } await writeFile(path.join(f, "output.png"), "late"); return { width: 2, height: 2 }; });
    await q.submit(submission("one")); await started; await q.submit(submission("two"));
    await q.cancel("two", "p"); await q.cancel("one", "p"); release();
    await q.submit(submission("after")); await settled(q, "after");
    assert.equal(calls, 2); assert.ok((await q.list("p")).filter(j => j.id !== "after").every(j => j.status === "cancelled"));
    await assert.rejects(q.result("one", "p"), /结果/);
    await assert.rejects(readFile(path.join(root, "one", "output.png")), /ENOENT/);
});
test("重启将未完成任务标记中断，不自动重复运行；路径穿越被拒绝", async t => {
    const root = await folder(t); await mkdir(path.join(root, "old"));
    await writeFile(path.join(root, "old", "job.json"), JSON.stringify({ job: { ...submission("old"), status: "running" }, hash: "h" }));
    const q = new ToolQueue(root, () => { throw new Error("must not run"); });
    assert.equal((await q.list("p"))[0].status, "interrupted");
    await assert.rejects(q.submit(submission("../escape")), /来源/);
});

test("工具超时中止信号传到处理器，迟到文件清理且后续任务继续", async t => {
    const root = await folder(t), schedule = globalThis.setTimeout;
    let expire, begin, release, receivedSignal;
    const started = new Promise(resolve => { begin = resolve; }), gate = new Promise(resolve => { release = resolve; });
    t.mock.method(globalThis, "setTimeout", (callback, ms, ...args) => {
        if (ms === 30 * 60_000) expire = callback;
        return schedule(callback, ms, ...args);
    });
    const q = new ToolQueue(root, async (job, f, signal) => {
        if (job.id === "slow") { receivedSignal = signal; begin(); await gate; }
        await writeFile(path.join(f, "output.png"), job.id);
        return { width: 2, height: 2 };
    });
    await q.submit(submission("slow")); await started;
    await q.submit(submission("next"));
    assert.equal(typeof expire, "function"); expire();
    assert.equal(receivedSignal.aborted, true); release();
    assert.equal((await settled(q, "next")).status, "completed");
    const failed = (await q.list("p")).find(j => j.id === "slow");
    assert.equal(failed.status, "failed"); assert.match(failed.error, /30 分钟/);
    await assert.rejects(readFile(path.join(root, "slow", "output.png")), /ENOENT/);
    const restored = new ToolQueue(root, () => { throw Error("must not retry automatically"); });
    assert.equal((await restored.list("p")).find(j => j.id === "slow").status, "failed");
    assert.equal((await restored.source("slow", "p")).dataUrl, submission("slow").dataUrl);
});
test("真实图像链：尺寸/透明通道、裁切边界、平铺不缩放原像素", async t => {
    const root = await folder(t);
    const input = Buffer.from([255,0,0,255, 0,255,0,128, 0,0,255,0, 255,255,255,255]);
    const png = await sharp(input, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
    const q = new ToolQueue(root, (j, f, s, p) => processImageTool(root, j, f, s, p));
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    await q.submit({ ...submission("tile", dataUrl), tool: "tile", options: { width: 3, height: 3 } });
    assert.equal((await settled(q, "tile")).status, "completed");
    const { data, info } = await sharp(path.join(root, "tile", "output.png")).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 3); assert.deepEqual([...data.subarray(0, 12)], [255,0,0,255, 0,255,0,128, 255,0,0,255]);
    await q.submit({ ...submission("crop", dataUrl), tool: "crop", options: { left: 1, top: 0, width: 1, height: 1 } });
    assert.equal((await settled(q, "crop")).status, "completed");
    assert.deepEqual([...await sharp(path.join(root, "crop", "output.png")).raw().toBuffer()], [0,255,0,128]);
    await q.submit({ ...submission("bad", dataUrl), tool: "crop", options: { left: 1, top: 0, width: 2, height: 1 } });
    assert.equal((await settled(q, "bad")).status, "failed");
    await q.submit({ ...submission("resize", dataUrl), options: { width: 4, height: 4 } });
    assert.equal((await settled(q, "resize")).status, "completed");
    const metadata = await sharp(path.join(root, "resize", "output.png")).metadata();
    assert.equal(metadata.width, 4); assert.equal(metadata.hasAlpha, true);
});
test("非法尺寸、模型、强度在提交前拒绝", () => {
    for (const [tool, options] of [["resize", {width: 30001,height: 1}], ["resize", {width: 20000,height: 20000}], ["crop", {width: 2,height: 2,left: -1,top: 0}], ["upscale", {scale: 4,model: "command"}], ["enhance", {intensity: NaN}]]) assert.throws(() => validateTool(tool, options));
});

test("透明边缘零参数不改像素、去白底恢复半透明颜色、收缩羽化不改画布尺寸", async t => {
    const root = await folder(t);
    const input = await sharp(Buffer.from([255, 127, 127, 128, 20, 40, 80, 255, 0, 0, 0, 0]), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    const q = new ToolQueue(root, (job, f, signal, progress) => processImageTool(root, job, f, signal, progress));
    const dataUrl = `data:image/png;base64,${input.toString("base64")}`;
    for (const [id, options] of [["identity", { feather: 0, choke: 0, matte: "none" }], ["matte", { matte: "white" }], ["feather", { feather: 1, choke: 1 }]]) {
        await q.submit({ ...submission(id, dataUrl), tool: "alpha", options });
        assert.equal((await settled(q, id)).status, "completed");
        const output = await sharp(path.join(root, id, "output.png")).raw().toBuffer();
        assert.equal(output.length, 12);
        if (id === "identity") assert.deepEqual(output, await sharp(input).raw().toBuffer());
        if (id === "matte") { assert.deepEqual([...output.subarray(0, 4)], [255, 0, 0, 128]); assert.deepEqual([...output.subarray(4, 8)], [20, 40, 80, 255]); }
    }
    const opaque = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
    await q.submit({ ...submission("opaque", `data:image/png;base64,${opaque.toString("base64")}`), tool: "alpha", options: {} });
    assert.equal((await settled(q, "opaque")).status, "failed");
    for (const options of [{ feather: 11 }, { choke: 1.5 }, { matte: "red" }]) assert.throws(() => validateTool("alpha", options));
});

test("透明边缘收缩与扩张遵循灰度最小最大值，孔洞和画幅外透明，不使用位运算形态学", async t => {
    const root = await folder(t), width = 9, height = 7, pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) { pixels[i * 4] = 80; pixels[i * 4 + 1] = 140; pixels[i * 4 + 2] = 200; pixels[i * 4 + 3] = (i * 43 + i % 7 * 19) % 256; }
    const input = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const q = new ToolQueue(root, (job, f, signal, progress) => processImageTool(root, job, f, signal, progress));
    for (const choke of [-2, -1, 1, 2]) {
        const id = 'morph-' + String(choke).replace('-', 'n');
        await q.submit({ ...submission(id, `data:image/png;base64,${input.toString('base64')}`), tool: 'alpha', options: { choke, feather: 0, matte: 'none' } });
        assert.equal((await settled(q, id)).status, 'completed');
        const output = await sharp(path.join(root, id, 'output.png')).ensureAlpha().raw().toBuffer(), radius = Math.abs(choke);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            let expected = choke > 0 ? 255 : 0;
            for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
                const sx = x + dx, sy = y + dy, alpha = sx < 0 || sy < 0 || sx >= width || sy >= height ? 0 : pixels[(sy * width + sx) * 4 + 3];
                expected = choke > 0 ? Math.min(expected, alpha) : Math.max(expected, alpha);
            }
            const i = (y * width + x) * 4; assert.equal(output[i + 3], expected); assert.deepEqual(output.subarray(i, i + 3), pixels.subarray(i, i + 3));
        }
    }
});

test("黑白底配对恢复透明度，拒绝不同尺寸/错位输入，第二来源参与去重", async t => {
    const root = await folder(t);
    const rgba = Buffer.from([200, 80, 40, 128, 10, 20, 30, 255, 0, 0, 0, 0, 50, 90, 160, 64]);
    const composite = async background => {
        const rgb = Buffer.alloc(12);
        for (let i = 0; i < 4; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round(rgba[i * 4 + c] * rgba[i * 4 + 3] / 255 + background * (1 - rgba[i * 4 + 3] / 255));
        return `data:image/png;base64,${(await sharp(rgb, { raw: { width: 4, height: 1, channels: 3 } }).png().toBuffer()).toString("base64")}`;
    };
    const q = new ToolQueue(root, (job, f, signal, progress) => processImageTool(root, job, f, signal, progress));
    const input = { ...submission("pair", await composite(0)), tool: "mattePair", options: {}, secondarySourceId: "white", secondaryDataUrl: await composite(255) };
    await q.submit(input); assert.equal((await settled(q, "pair")).status, "completed");
    const actual = await sharp(path.join(root, "pair", "output.png")).raw().toBuffer();
    for (let i = 0; i < rgba.length; i++) assert.ok(Math.abs(actual[i] - rgba[i]) <= 3, `channel ${i}: ${actual[i]} / ${rgba[i]}`);
    await assert.rejects(q.submit({ ...input, secondarySourceId: "different" }), /不同输入/);
    const bad = await sharp({ create: { width: 4, height: 1, channels: 3, background: "green" } }).png().toBuffer();
    await q.submit({ ...input, id: "wrong", secondaryDataUrl: `data:image/png;base64,${bad.toString("base64")}` });
    assert.equal((await settled(q, "wrong")).status, "failed");
    const small = await sharp(bad).resize(1, 1).png().toBuffer();
    await q.submit({ ...input, id: "size", secondaryDataUrl: `data:image/png;base64,${small.toString("base64")}` });
    assert.equal((await settled(q, "size")).status, "failed");
    await assert.rejects(q.submit({ ...input, id: "same", secondarySourceId: "a" }), /另选/);
});
