import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { blankProject, createLayer, validateProject, recoverProject } from "../src/app/studio/model.ts";
import { groupLayers, ungroupLayer, worldTransform, reparentLayer, duplicateLayers, moveLayers, alignLayers, normalizeGroupFrames, snapTranslation } from "../src/app/studio/layer-operations.ts";
import { saveStoredProject, readStoredProject, readProjectSummary } from "../src/app/api/studio/project-storage.ts";
import { trimHistory, HISTORY_LIMIT } from "../src/app/studio/editor-history.ts";
import { alphaBounds } from "../src/app/studio/image-bounds.ts";

const close = (a, b) => a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) < 1e-7, `${a} != ${b}`));
const matrix = (p, id) => worldTransform(p.layers.find(l => l.id === id), p.layers).getMatrix();
const image = { id: "asset", name: "样图", dataUrl: "data:image/png;base64," + (await sharp({ create: { width: 1, height: 1, channels: 4, background: "#ff000080" } }).png().toBuffer()).toString("base64"), width: 1, height: 1, hasAlpha: true, createdAt: new Date().toISOString() };
test("合并与透明修边保留仅 1/255 不透明度的边缘",()=>{
    const pixels=new Uint8ClampedArray(4*4*4);
    assert.equal(alphaBounds(pixels,4,4),undefined);
    pixels[(1*4+2)*4+3]=1;
    assert.deepEqual(alphaBounds(pixels,4,4),{x:2,y:1,width:1,height:1});
});
async function directory(t) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "studio-storage-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    return dir;
}
test("V5 调整与特效工程保存后能出现在工程列表并完整重开", async t => {
    const dir = await directory(t), p = { ...blankProject(), version: 5 };
    p.layers = [{ ...createLayer("adjustment", "反相"), adjustment: { kind: "invert", values: {} } }];
    await saveStoredProject(dir, p);
    assert.deepEqual(await readProjectSummary(dir, p.id), { id: p.id, name: p.name, updatedAt: p.updatedAt, layers: 1 });
    assert.deepEqual(recoverProject(await readStoredProject(dir, p.id)), recoverProject(p));
});
test("旧工程迁移、独立资源保存重开与跨工程资源去重", async t => {
    const dir = await directory(t), p = { ...blankProject(), version: 1, assets: [image] };
    await writeFile(path.join(dir, `${p.id}.json`), JSON.stringify(p));
    const recovered = recoverProject(await readStoredProject(dir, p.id));
    assert.equal(recovered.version, 4);
    await saveStoredProject(dir, recovered);
    const manifest = JSON.parse(await readFile(path.join(dir, `${p.id}.json`), "utf8"));
    assert.equal(manifest.storageVersion, 1);
    assert.equal(manifest.assets[0].dataUrl, undefined);
    assert.deepEqual(await readStoredProject(dir, p.id), recovered);
    await saveStoredProject(dir, { ...recovered, id: "another" });
    assert.equal((await readdir(path.join(dir, "resources"))).length, 1);
});
test("绘画副本和像素蒙版独立存储，复制共享内容而不改素材原图", async t => {
    const dir = await directory(t), p = { ...blankProject(), assets: [image] };
    const bitmap = { dataUrl: image.dataUrl, width: 1, height: 1 };
    p.layers = [{ ...createLayer("image", "绘画"), assetId: image.id, bitmap, mask: { x: 0, y: 0, width: 1, height: 1, bitmap } }];
    validateProject(p);
    await saveStoredProject(dir, p);
    const stored = JSON.parse(await readFile(path.join(dir, `${p.id}.json`), "utf8"));
    assert.equal(stored.layers[0].bitmap.dataUrl, undefined);
    assert.equal(stored.layers[0].bitmap.resource, stored.layers[0].mask.bitmap.resource);
    assert.equal((await readdir(path.join(dir, "resources"))).length, 1);
    assert.deepEqual(await readStoredProject(dir, p.id), p);
    assert.throws(() => validateProject({ ...p, version: 3 }), /V4/);
    assert.throws(() => validateProject({ ...p, layers: [{ ...p.layers[0], bitmap: { ...bitmap, width: 30001 } }] }), /像素副本/);
    stored.layers[0].mask.bitmap.resource = "../credentials.enc";
    await writeFile(path.join(dir, `${p.id}.json`), JSON.stringify(stored));
    await assert.rejects(readStoredProject(dir, p.id), /引用路径/);
});
test("绘画历史按不同像素内容计算预算，重用同一内容不重复计费", () => {
    const p = blankProject(), dataUrl = "x".repeat(70_000_000);
    const imageLayer = { ...createLayer("image", "绘画"), bitmap: { width: 1, height: 1, dataUrl } };
    const history = [{ ...p, layers: [{ ...imageLayer, bitmap: { ...imageLayer.bitmap, dataUrl: "y" + dataUrl } }] }, { ...p, layers: [imageLayer] }];
    assert.equal(trimHistory(history, p).length, 1);
    assert.equal(trimHistory([history[1], history[1]], p).length, 2);
});
test("资源失败不覆盖原工程；资源篡改和路径穿越被拒绝", async t => {
    const dir = await directory(t), p = { ...blankProject(), assets: [image] };
    await saveStoredProject(dir, p);
    const original = await readFile(path.join(dir, `${p.id}.json`), "utf8");
    await assert.rejects(saveStoredProject(dir, { ...p, assets: [{ ...image, dataUrl: "not-an-image" }] }));
    assert.equal(await readFile(path.join(dir, `${p.id}.json`), "utf8"), original);
    const manifest = JSON.parse(original);
    await writeFile(path.join(dir, "resources", manifest.assets[0].resource), "corrupt");
    await assert.rejects(readStoredProject(dir, p.id), /校验失败/);
    manifest.assets[0].resource = "../private.png";
    await writeFile(path.join(dir, `${p.id}.json`), JSON.stringify(manifest));
    await assert.rejects(readStoredProject(dir, p.id), /路径无效/);
    await assert.rejects(readStoredProject(dir, "../private"), /ID 无效/);
});
test("并发保存顺序与队列失败恢复", async t => {
    const dir = await directory(t), p = blankProject();
    await assert.rejects(saveStoredProject(dir, { ...p, id: "../bad" }));
    await Promise.all([saveStoredProject(dir, { ...p, name: "旧名称" }), saveStoredProject(dir, { ...p, name: "新名称" })]);
    assert.equal((await readStoredProject(dir, p.id)).name, "新名称");
});
test("连续读取时替换保存仍完整，临时文件不遗留", async t => {
    const dir = await directory(t), p = blankProject();
    await saveStoredProject(dir, p);
    await Promise.all([
        (async () => { for (let i = 0; i < 100; i++) { const read = await readStoredProject(dir, p.id); assert.equal(read.id, p.id); } })(),
        (async () => { for (let i = 0; i < 20; i++) await saveStoredProject(dir, { ...p, name: `revision-${i}` }); })(),
    ]);
    assert.equal((await readStoredProject(dir, p.id)).name, "revision-19");
    assert.equal((await readdir(dir)).filter(name => name.endsWith(".tmp")).length, 0);
});
test("组合与解除旋转缩放翻转后的组保持世界坐标", () => {
    const a = { ...createLayer("text", "A"), text: "A", fontSize: 40, x: 100, y: 60, rotation: 23, scaleX: 1.2, flipX: true };
    const b = { ...createLayer("text", "B"), text: "B", fontSize: 40, x: 430, y: 300 };
    const p = { ...blankProject(), layers: [a, b] }, g = createLayer("group", "组");
    let grouped = groupLayers(p, [a.id, b.id], g);
    close(matrix(grouped, a.id), matrix(p, a.id));
    grouped = { ...grouped, layers: grouped.layers.map(l => l.id === g.id ? { ...l, rotation: 37, scaleX: 1.7, scaleY: .8, flipY: true } : l) };
    const result = ungroupLayer(grouped, g.id);
    close(matrix(result, a.id), matrix(grouped, a.id));
    close(matrix(result, b.id), matrix(grouped, b.id));
    validateProject(result);
});
test("拖动跨组保持几何、拒绝循环及锁定父组", () => {
    const g = { ...createLayer("group", "组"), x: 120, rotation: 30, scaleY: 1.7 };
    const a = { ...createLayer("text", "A"), x: 10, rotation: -15, flipX: true };
    const p = { ...blankProject(), layers: [a, g] };
    const moved = reparentLayer(p, a.id, g.id);
    close(matrix(moved, a.id), matrix(p, a.id));
    close(matrix(reparentLayer(moved, a.id), a.id), matrix(p, a.id));
    assert.throws(() => reparentLayer(moved, g.id, g.id), /子组/);
    assert.throws(() => reparentLayer({ ...moved, layers: moved.layers.map(l => l.id === g.id ? { ...l, locked: true } : l) }, a.id), /锁定/);
});
test("多选父子只移动一次；整组复制保留父子关系且资源共享", () => {
    const g = { ...createLayer("group", "组"), rotation: 30 };
    const a = { ...createLayer("image", "A"), parentId: g.id, assetId: image.id };
    const p = { ...blankProject(), assets: [image], layers: [a, g] };
    const moved = moveLayers(p, [a.id, g.id], 20, 10);
    assert.equal(moved.layers[0].x, a.x);
    assert.equal(moved.layers[1].x, 20);
    const copied = duplicateLayers(p, [g.id, a.id]);
    assert.equal(copied.project.layers.length, 4);
    assert.equal(copied.selected.length, 1);
    assert.equal(copied.project.layers.find(l => l.parentId === copied.selected[0]).assetId, image.id);
    assert.equal(copied.project.assets, p.assets);
});
test("旋转图层对齐与等间距分布", () => {
    const layers = [0, 300, 1000].map((x, i) => ({ ...createLayer("text", `T${i}`), x, width: 100, height: 100 }));
    const p = { ...blankProject(), layers }, ids = layers.map(l => l.id);
    const result = alignLayers(p, ids, "horizontal");
    assert.equal(result.layers[1].x, 500);
    assert.equal(alignLayers(p, [ids[0]], "center").layers[0].x, (p.width - 100) / 2);
});
test("移动选区按边缘和中心吸附到其他图层，不吸附自己的子图层", () => {
    const a={...createLayer("text","A"),width:100,height:100},b={...createLayer("text","B"),x:200,width:100,height:100};
    const p={...blankProject(),layers:[a,b]};
    assert.equal(snapTranslation(p,[a.id],95,0,1).dx,100);
    const group={...createLayer("group","G"),width:100,height:100};
    const grouped={...p,layers:[group,{...a,parentId:group.id},b]};
    assert.equal(snapTranslation(grouped,[group.id],95,0,1).dx,100);
});
test("历史限制与重复资源共享，不复制当前大图", () => {
    const p = { ...blankProject(), assets: [image] };
    const history = Array.from({ length: 80 }, (_, i) => ({ ...p, name: `${i}` }));
    const result = trimHistory(history, p);
    assert.equal(result.length, HISTORY_LIMIT);
    assert.equal(result[0].name, "20");
    assert.equal(result[0].assets[0], image);
});
test("组内图层移出原边界时重算组框，不改变任何世界坐标", () => {
    const g = { ...createLayer("group", "G"), x: 50, y: 80, rotation: 30, scaleX: 1.4, flipY: true };
    const a = { ...createLayer("text", "A"), x: -200, y: -90, rotation: 15, parentId: g.id };
    const p = { ...blankProject(), layers: [a, g] }, result = { ...p, layers: normalizeGroupFrames(p.layers) };
    close(matrix(result, a.id), matrix(p, a.id));
    assert.notEqual(result.layers[1].width, g.width);
    close(matrix({ ...result, layers: normalizeGroupFrames(result.layers) }, a.id), matrix(p, a.id));
});
test("选区蒙版持久化，异常路径/羽化被拒绝，拆组不会丢蒙版", () => {
    const l = { ...createLayer("shape", "shape"), shape: "rect", mask: { x: 0, y: 0, width: 1, height: 1, paths: [{ points: [0, 0, 1, 0, .5, 1], operation: "add" }], feather: 6, inverted: true } };
    const p = { ...blankProject(), layers: [l] };
    validateProject(JSON.parse(JSON.stringify(p)));
    assert.throws(() => validateProject({ ...p, layers: [{ ...l, mask: { ...l.mask, feather: 9999 } }] }), /羽化/);
    assert.throws(() => validateProject({ ...p, layers: [{ ...l, mask: { ...l.mask, paths: [{ points: [NaN, 0, 1, 0, 1, 1], operation: "add" }] } }] }), /路径/);
    const g = { ...createLayer("group", "G"), mask: { x: 0, y: 0, width: .5, height: .5 } };
    assert.throws(() => ungroupLayer({ ...p, layers: [g, { ...l, parentId: g.id }] }, g.id), /蒙版/);
});
test("V1 翻转图层的非对称矩形蒙版迁移后保持原可见区域", () => {
    const l = { ...createLayer("image", "旧图"), assetId: image.id, flipX: true, mask: { x: .1, y: .2, width: .3, height: .5 } };
    const p = { ...blankProject(), version: 1, assets: [image], layers: [l] };
    const recovered = recoverProject(p);
    assert.ok(Math.abs(recovered.layers[0].mask.x - .6) < 1e-9);
    assert.equal(recovered.layers[0].mask.y, .2);
    assert.deepEqual(recoverProject(recovered).layers, recovered.layers);
    validateProject(recovered);
});
