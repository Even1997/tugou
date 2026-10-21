import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

const src = fileURLToPath(new URL("../src/", import.meta.url));
registerHooks({
    resolve(specifier, context, next) {
        if (specifier.startsWith("@/") || (specifier.startsWith(".") && context.parentURL?.startsWith(pathToFileURL(src).href))) {
            const base = specifier.startsWith("@/") ? path.join(src, specifier.slice(2)) : fileURLToPath(new URL(specifier, context.parentURL));
            const found = [base, `${base}.ts`, `${base}.js`].find(existsSync);
            if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
        }
        return next(specifier, context);
    },
    load(url, context, next) {
        if (url.endsWith(".ts")) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true };
        return next(url, context);
    },
});
const { buildNodeGenerationContext, buildNodeChatMessages } = await import("../src/app/(user)/canvas/components/canvas-node-generation.ts");
const { buildPrompt, blankProject, recipeFingerprint } = await import("../src/app/studio/model.ts");
const { uniqueReferences } = await import("../src/app/studio/reference-roles.js");
const nodes = [
    { id: "a", type: "image", title: "人物", metadata: { content: "data:image/png;base64,YQ==" } },
    { id: "b", type: "image", title: "风格", metadata: { content: "data:image/png;base64,Yg==" } },
    { id: "text", type: "text", title: "动作", metadata: { content: "牵手" } },
    { id: "out", type: "image", metadata: {} },
];
const connections = [
    { id: "t", fromNodeId: "text", toNodeId: "out" },
    { id: "a", fromNodeId: "a", toNodeId: "out", referenceRole: "只参考身份" },
    { id: "b", fromNodeId: "b", toNodeId: "out", referenceRole: "只参考画风" },
];
test("工作台去重合并职责，编号和实际上传序列一致，重排使结果过期", () => {
    const recipe = { moduleIds: [], references: [{ assetId: "a", role: "人物" }, { assetId: "b", role: "画风" }, { assetId: "a", role: "服饰" }], output: "全身", size: "1024x1536" };
    assert.deepEqual(uniqueReferences(recipe.references), [{ assetId: "a", role: "人物；服饰" }, { assetId: "b", role: "画风" }]);
    const project = blankProject(); const fingerprint = recipeFingerprint(project, recipe);
    assert.match(buildPrompt(project, recipe), /图片1：人物；服饰\n图片2：画风/);
    recipe.references = [recipe.references[1], recipe.references[0]];
    assert.notEqual(recipeFingerprint(project, recipe), fingerprint);
});
test("画布连接重排、删除、重复后，图片职责与请求图片顺序保持一致", () => {
    for (const links of [connections, [...connections].reverse(), connections.filter(c => c.id !== "a"), [...connections, connections[1]]]) {
        const context = buildNodeGenerationContext("out", nodes, links, "全身");
        assert.equal(new Set(context.referenceImages.map(i => i.id)).size, context.referenceImages.length);
        for (const [i, image] of context.referenceImages.entries()) assert.ok(context.prompt.includes(`图片${i + 1}：${image.id === "a" ? "只参考身份" : "只参考画风"}`));
        const messages = buildNodeChatMessages(context);
        const content = messages.at(-1).content;
        assert.deepEqual(content.filter(x => x.type === "image_url").map(x => x.image_url.url), context.referenceImages.map(i => i.dataUrl));
    }
});
test("配置节点引用按照 mention 顺序，职责跟随图片且不会污染其他目标", () => {
    const config = { id: "config", type: "config", metadata: { composerContent: "有内容" } };
    const links = connections.map(c => ({ ...c, toNodeId: "config" }));
    const context = buildNodeGenerationContext("config", [...nodes, config], links, "@[node:b] 的画风绘制 @[node:a]");
    assert.deepEqual(context.referenceImages.map(i => i.id), ["b", "a"]);
    assert.match(context.prompt, /图片1：只参考画风\n图片2：只参考身份/);
    const plain = buildNodeGenerationContext("out", nodes, connections.map(c => ({ ...c, referenceRole: undefined })), "原提示");
    assert.ok(!plain.prompt.includes("参考图职责"));
});
