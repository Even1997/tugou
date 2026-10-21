import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { storeImageResource, readImageResource, imageDataUrl } from "../src/app/api/studio/image-resources.js";
import { saveStoredProject, readStoredProject, portableProject } from "../src/app/api/studio/project-storage.ts";
import { blankProject, createLayer, validateProject } from "../src/app/studio/model.ts";
import { resourceName, thumbnailUrl, validImageSource } from "../src/app/studio/resource-url.js";
import { GET } from "../src/app/api/studio/resource/[name]/route.ts";

const data = async (color = "#cc880080") => "data:image/png;base64," + (await sharp({ create: { width: 768, height: 512, channels: 4, background: color } }).png().toBuffer()).toString("base64");
async function fixture(t) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "studio-resources-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    return dir;
}
test("only exact local immutable image references are valid; thumbnails cannot become originals", () => {
    const url = `/api/studio/resource/${"a".repeat(64)}.png`;
    assert.equal(resourceName(url), "a".repeat(64) + ".png");
    assert.equal(validImageSource(url, true), true);
    assert.equal(thumbnailUrl(url), url + "?thumbnail=1");
    for (const invalid of [url + "?thumbnail=1", url + "/..", url.replace(".png", ".svg"), "https://evil.com" + url, "file:///private.png", "/api/studio/resource/../credentials.enc"]) assert.equal(validImageSource(invalid), false);
});
test("content deduplication, alpha thumbnails, concurrent cache hits and source changes", async t => {
    const dir = await fixture(t), original = await data();
    const names = await Promise.all(Array.from({ length: 8 }, () => storeImageResource(dir, original)));
    assert.equal(new Set(names).size, 1);
    const name = names[0], url = `/api/studio/resource/${name}`;
    assert.equal(await storeImageResource(dir, original), name);
    assert.equal(await storeImageResource(dir, url), name);
    assert.equal(await imageDataUrl(dir, url), original);
    const thumbnails = await Promise.all(Array.from({ length: 8 }, () => readImageResource(dir, name, true)));
    const meta = await sharp(thumbnails[0].bytes).metadata();
    assert.deepEqual([meta.width, meta.height, meta.hasAlpha], [384, 256, true]);
    const alpha = await sharp(thumbnails[0].bytes).ensureAlpha().extractChannel("alpha").raw().toBuffer();
    assert.equal(alpha[0], 128);
    thumbnails.forEach(result => assert.deepEqual(result.bytes, thumbnails[0].bytes));
    assert.equal((await readdir(path.join(dir, "thumbnails-v1"))).length, 1);
    assert.deepEqual((await readImageResource(dir, name)).bytes, Buffer.from(original.split(",")[1], "base64"));
    const changed = await storeImageResource(dir, await data("#0088cc80"));
    assert.notEqual(changed, name);
    assert.notDeepEqual((await readImageResource(dir, changed, true)).bytes, thumbnails[0].bytes);
    assert.equal((await readdir(path.join(dir, "resources"))).length, 2);
});
test("lazy projects round-trip assets, paint, masks and selection; portable exports retain original bytes", async t => {
    const dir = await fixture(t), source = await data(), bitmap = { dataUrl: source, width: 768, height: 512 };
    const project = { ...blankProject(), width: 768, height: 512, assets: [{ ...bitmap, id: "a", name: "原图", hasAlpha: true, createdAt: new Date().toISOString() }], selection: { bitmap } };
    project.layers = [{ ...createLayer("image", "绘画"), assetId: "a", bitmap, mask: { x: 0, y: 0, width: 1, height: 1, bitmap } }];
    await saveStoredProject(dir, project);
    const lazy = await readStoredProject(dir, project.id, true);
    validateProject(lazy);
    assert.ok(resourceName(lazy.assets[0].dataUrl));
    assert.equal(lazy.layers[0].bitmap.dataUrl, lazy.selection.bitmap.dataUrl);
    assert.equal(lazy.layers[0].mask.bitmap.dataUrl, lazy.assets[0].dataUrl);
    assert.ok(JSON.stringify(lazy).length < JSON.stringify(project).length / 2);
    await saveStoredProject(dir, lazy);
    assert.deepEqual(await readStoredProject(dir, project.id), project);
    assert.deepEqual(await portableProject(dir, lazy), project);
});
test("invalid images, missing or changed resources never replace a saved manifest", async t => {
    const dir = await fixture(t), source = await data(), name = await storeImageResource(dir, source);
    const project = { ...blankProject(), assets: [{ id: "a", name: "图", dataUrl: `/api/studio/resource/${name}`, width: 768, height: 512, hasAlpha: true, createdAt: new Date().toISOString() }] };
    await saveStoredProject(dir, project);
    const before = await readFile(path.join(dir, project.id + ".json"));
    await writeFile(path.join(dir, "resources", name), "damaged");
    await assert.rejects(saveStoredProject(dir, project), /校验失败/);
    assert.deepEqual(await readFile(path.join(dir, project.id + ".json")), before);
    await assert.rejects(imageDataUrl(dir, project.assets[0].dataUrl), /校验失败/);
    await assert.rejects(storeImageResource(dir, "data:image/png;base64,aGVsbG8="));
    await assert.rejects(readImageResource(dir, "../credentials.enc"), /路径/);
});
test("resource HTTP responses reject cross-site requests and expose immutable caching", async t => {
    const dir = await fixture(t), previous = process.env.STUDIO_DATA_DIR;
    process.env.STUDIO_DATA_DIR = dir;
    t.after(() => { if (previous === undefined) delete process.env.STUDIO_DATA_DIR; else process.env.STUDIO_DATA_DIR = previous; });
    const source = await data(), name = await storeImageResource(dir, source), context = { params: Promise.resolve({ name }) };
    const request = headers => new Request(`http://127.0.0.1:3437/api/studio/resource/${name}`, { headers: { host: "127.0.0.1:3437", ...headers } });
    for (const headers of [{ origin: "https://evil.com" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { host: "evil.com" }]) assert.equal((await GET(request(headers), context)).status, 403);
    const response = await GET(request({ "sec-fetch-site": "same-origin" }), context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.ok(response.headers.get("cache-control").includes("immutable"));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(source.split(",")[1], "base64"));
    assert.equal((await GET(request({ "if-none-match": response.headers.get("etag") }), context)).status, 304);
});

test("thumbnail eviction removes only disposable previews and preserves originals", async t => {
    const dir = await fixture(t), source = await data(), name = await storeImageResource(dir, source);
    const folder = path.join(dir, "thumbnails-v1"); await mkdir(folder);
    for (let i = 0; i < 1025; i++) await writeFile(path.join(folder, `${i.toString(16).padStart(64, "0")}.png.webp`), "cached preview");
    await readImageResource(dir, name, true);
    assert.equal((await readdir(folder)).length, 1000);
    assert.equal(await imageDataUrl(dir, `/api/studio/resource/${name}`), source);
    assert.equal((await readdir(path.join(dir, "resources"))).length, 1);
});
