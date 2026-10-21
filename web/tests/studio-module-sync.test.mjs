import test from "node:test";
import assert from "node:assert/strict";
import { moduleReference, moduleNodeText, moduleSyncState, updateModuleNode, updateOutdatedModules } from "../src/app/studio/module-sync.ts";

function fixture(format = "plain") {
    const module = { id: "style", name: "公共画风", kind: "style", text: "画风初版" };
    const project = { id: "p", modules: [module] };
    const ref = moduleReference(project.id, module, format);
    const node = { id: "n", type: "text", title: module.name, position: { x: 20, y: 30 }, width: 320, height: 240, metadata: { content: moduleNodeText(ref), moduleRef: ref, fontSize: 18, groupId: "g" } };
    return { project, module, node };
}
test("全局范围修改不会改写已连接节点或产生伪新版", () => {
    const { project, module, node } = fixture();
    module.global = false;
    assert.equal(moduleSyncState(node, project), "current");
    assert.equal(updateOutdatedModules([node], project)[0], node);
    module.global = true;
    assert.equal(moduleSyncState(node, project), "current");
    module.text = "新的内容";
    assert.equal(moduleSyncState(node, project), "outdated");
});
test("来源按工程和模块 ID 跟踪，改名、改类型、改内容均识别新版", () => {
    for (const [key, value] of [["name", "新画风"], ["kind", "自定义类别"], ["text", "画风新版"]]) {
        const { project, module, node } = fixture();
        assert.equal(moduleSyncState(node, project), "current");
        module[key] = value;
        assert.equal(moduleSyncState(node, project), "outdated");
        const updated = updateModuleNode(node, project);
        assert.equal(moduleSyncState(updated, project), "current");
        assert.deepEqual(updated.position, node.position);
        assert.equal(updated.id, node.id);
        assert.equal(updated.width, node.width);
        assert.equal(updated.metadata.groupId, "g");
        assert.equal(updated.metadata.fontSize, 18);
        assert.equal(node.metadata.content, "画风初版");
    }
});
test("批量更新保护本地改写和自定义名称；显式覆盖可解决冲突", () => {
    const { project, module, node } = fixture();
    const local = { ...node, id: "local", title: "我的版本", metadata: { ...node.metadata, content: "本地改写" } };
    assert.equal(moduleSyncState(local, project), "modified");
    module.text = "画风新版";
    assert.equal(moduleSyncState(local, project), "conflict");
    const batch = updateOutdatedModules([node, local], project);
    assert.equal(batch[0].metadata.content, "画风新版");
    assert.equal(batch[1], local);
    assert.equal(updateModuleNode(local, project), local);
    const resolved = updateModuleNode(local, project, true);
    assert.equal(resolved.title, module.name);
    assert.equal(moduleSyncState(resolved, project), "current");
});
test("删除、清空来源及跨工程均禁止覆盖，同名新模块不能冒充原来源", () => {
    const { project, module, node } = fixture();
    const cases = [
        [{ id: "other", modules: [module] }, "foreign"],
        [{ id: "p", modules: [{ ...module, id: "replacement" }] }, "missing"],
        [{ id: "p", modules: [{ ...module, text: "  " }] }, "empty"],
    ];
    for (const [p, state] of cases) {
        assert.equal(moduleSyncState(node, p), state);
        assert.equal(updateModuleNode(node, p, true), node);
    }
    const plain = { ...node, metadata: { content: "普通文本" } };
    assert.equal(moduleSyncState(plain, project), "unlinked");
    assert.equal(updateModuleNode(plain, project, true), plain);
});
test("配方带标题格式更新保留格式，JSON 重开和再次更新均正常", () => {
    const { project, module, node } = fixture("labeled");
    module.text = "第二版";
    const reopened = JSON.parse(JSON.stringify(node));
    assert.equal(moduleSyncState(reopened, project), "outdated");
    const updated = updateModuleNode(reopened, project);
    assert.equal(updated.metadata.content, "【公共画风】\n第二版");
    module.text = "第三版";
    assert.equal(moduleSyncState(updated, project), "outdated");
    const latest = updateModuleNode(updated, project);
    const nodes = [latest];
    assert.equal(updateOutdatedModules(nodes, project), nodes);
});
test("工作台撤回到引用时内容，不再误报旧版", () => {
    const { project, module, node } = fixture();
    module.text = "新版";
    assert.equal(moduleSyncState(node, project), "outdated");
    module.text = "画风初版";
    assert.equal(moduleSyncState(node, project), "current");
});
