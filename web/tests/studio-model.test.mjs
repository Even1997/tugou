import test from "node:test";
import assert from "node:assert/strict";
import { blankProject, createLayer, buildPrompt, recipeModules, recipeFingerprint, recipeIsStale, validateProject, recoverProject, removeLayers } from "../src/app/studio/model.ts";

function fixture() {
    const p = blankProject();
    p.modules = [
        { id: "style", kind: "style", name: "画风", text: "细暖灰线条" },
        { id: "pet", kind: "宠物", name: "宠物", text: "一只橘猫" },
        { id: "pose", kind: "动作", name: "动作", text: "抱着花束" },
    ];
    p.recipes = [{ id: "r", name: "猫", moduleIds: ["pet"], references: [], size: "1024x1024", output: "全身透明素材" }];
    return p;
}
test("公共画风应用于每个配方，未选中的模块不会混入提示词", () => {
    const p = fixture();
    const prompt = buildPrompt(p, p.recipes[0]);
    assert.match(prompt, /细暖灰线条/);
    assert.match(prompt, /一只橘猫/);
    assert.doesNotMatch(prompt, /抱着花束/);
    assert.ok(prompt.indexOf("细暖灰线条") > prompt.indexOf("一只橘猫"));
});
test("公共画风改变使素材过期，不改变图层或生成快照", () => {
    const p = fixture();
    const r = p.recipes[0];
    const fingerprint = recipeFingerprint(p, r);
    p.assets = [{ id: "a", recipeId: r.id, fingerprint }];
    p.layers = [createLayer("image", "猫")];
    const layers = JSON.stringify(p.layers);
    assert.equal(recipeIsStale(p, r), false);
    p.modules[0].text = "新的画风";
    assert.equal(recipeIsStale(p, r), true);
    assert.equal(JSON.stringify(p.layers), layers);
    assert.equal(p.assets[0].fingerprint, fingerprint);
});
test("无关模块修改不使当前素材过期，引用图顺序变化会过期", () => {
    const p = fixture();
    const r = p.recipes[0];
    const before = recipeFingerprint(p, r);
    p.modules[2].text = "跳跃";
    assert.equal(recipeFingerprint(p, r), before);
    r.references = [
        { assetId: "one", role: "身份" },
        { assetId: "two", role: "画风" },
    ];
    const withRefs = recipeFingerprint(p, r);
    r.references.reverse();
    assert.notEqual(recipeFingerprint(p, r), withRefs);
    assert.match(buildPrompt(p, r), /图片1：画风/);
});
test("工程可往返，任意自定义模块类别保留", () => {
    const p = fixture();
    p.modules.push({ id: "custom", name: "玻璃杯", kind: "用户自定义分类", text: "透明水杯" });
    const copy = JSON.parse(JSON.stringify(p));
    validateProject(copy);
    assert.deepEqual(copy, p);
});
test("工程校验拒绝循环分组、重复 ID、路径穿越、非有限数值", () => {
    const p = fixture();
    const group = { ...createLayer("group", "g"), id: "g", parentId: "g" };
    p.layers = [group];
    assert.throws(() => validateProject(p), /循环/);
    p.layers = [];
    p.id = "../outside";
    assert.throws(() => validateProject(p));
    p.id = "safe";
    p.modules.push(p.modules[0]);
    assert.throws(() => validateProject(p), /重复/);
    p.modules.pop();
    p.width = Infinity;
    assert.throws(() => validateProject(p));
});
test("缺失素材、主动内容、过大画布无法导入", () => {
    const p = fixture();
    p.layers = [{ ...createLayer("image", "missing"), assetId: "no" }];
    assert.throws(() => validateProject(p), /缺失/);
    p.layers = [];
    p.assets = [{ id: "a", name: "x", dataUrl: "data:image/svg+xml;base64,AAA", width: 10, height: 10 }];
    assert.throws(() => validateProject(p), /素材/);
    p.assets = [];
    p.width = 10000;
    p.height = 10000;
    assert.doesNotThrow(() => validateProject(p));
    p.height = 10001;
    assert.throws(() => validateProject(p), /尺寸/);
});
test("删除分组仅删除其子树", () => {
    const group = { ...createLayer("group", "g"), id: "g" };
    const child = { ...createLayer("text", "c"), parentId: "g" };
    const unrelated = createLayer("text", "u");
    assert.deepEqual(removeLayers([group, child, unrelated], ["g"]), [unrelated]);
});
test("重开工程将未完成任务标记为中断，不自动重试计费任务", () => {
    const p = fixture();
    p.jobs = [{ id: "j", status: "running", name: "猫", prompt: "p", fingerprint: "f", model: "x", recipeId: "r", startedAt: new Date().toISOString() }];
    const recovered = recoverProject(p);
    assert.equal(recovered.jobs[0].status, "interrupted");
    assert.equal(p.jobs[0].status, "running");
});
test("公共画风关闭全局后按配方选用，开启任意模块全局不重复拼接", () => {
    const p = fixture();
    const r = p.recipes[0];
    p.modules[0].global = false;
    assert.doesNotMatch(buildPrompt(p, r), /细暖灰线条/);
    r.moduleIds.push("style", "style", "pet");
    p.modules[1].global = true;
    p.modules[2].global = true;
    assert.deepEqual(recipeModules(p, r).map((m) => m.id), ["pet", "pose", "style"]);
    const prompt = buildPrompt(p, r);
    for (const text of ["一只橘猫", "抱着花束", "细暖灰线条"]) assert.equal(prompt.split(text).length - 1, 1);
    const other = { ...r, moduleIds: [] };
    assert.deepEqual(recipeModules(p, other).map((m) => m.id), ["pet", "pose"]);
    p.modules[1].global = false;
    assert.deepEqual(recipeModules(p, r).map((m) => m.id), ["pet", "pose", "style"]);
    assert.deepEqual(recipeModules(p, other).map((m) => m.id), ["pose"]);
    p.modules[2].text = "  ";
    assert.deepEqual(recipeModules(p, other), []);
});
test("旧工程恢复保留生成指纹；全局设置持久化且不随类别改变", () => {
    const p = fixture();
    const before = recipeFingerprint(p, p.recipes[0]);
    const recovered = recoverProject(p);
    assert.deepEqual(recovered.modules.map((m) => m.global), [true, false, false]);
    assert.equal(recipeFingerprint(recovered, recovered.recipes[0]), before);
    recovered.modules[0].global = false;
    recovered.modules[1].global = true;
    const reopened = recoverProject(JSON.parse(JSON.stringify(recovered)));
    assert.deepEqual(reopened.modules.map((m) => m.global), [false, true, false]);
    reopened.modules[0].kind = "背景";
    reopened.modules[1].kind = "style";
    reopened.modules[2].kind = "style";
    assert.deepEqual(recipeModules(reopened, { ...reopened.recipes[0], moduleIds: [] }).map((m) => m.id), ["pet"]);
    for (const invalid of ["false", 0, null, {}]) {
        reopened.modules[0].global = invalid;
        assert.throws(() => validateProject(reopened), /提示词模块/);
    }
});
test("全局开关只使实际提示词变化的素材过期，保留原生成快照", () => {
    const p = fixture();
    const r = p.recipes[0];
    p.assets = [{ id: "a", recipeId: r.id, fingerprint: recipeFingerprint(p, r) }];
    const snapshot = p.assets[0].fingerprint;
    p.modules[0].global = false;
    assert.equal(recipeIsStale(p, r), true);
    r.moduleIds.push("style");
    assert.equal(recipeIsStale(p, r), false);
    p.modules[2].global = true;
    assert.equal(recipeIsStale(p, r), true);
    p.modules[2].global = false;
    assert.equal(recipeIsStale(p, r), false);
    assert.equal(p.assets[0].fingerprint, snapshot);
});
