const test = require("node:test"),
  assert = require("node:assert/strict");
const { replaceCanvasAsset } = require("../core/canvas-media.cjs");
const {
  analysisToCanvas,
  applyAnalysis,
} = require("../core/analysis-draft.cjs");
const { compileNode, emptyCanvas, createNode } = require("../core/prompts.cjs");
const source = () => ({
  name: "原工程",
  modules: [],
  recipes: [],
  assets: [
    { id: "a", resource: "a.png" },
    { id: "b", resource: "b.png" },
  ],
  unknown: { keep: true },
  tugouCanvas: {
    ...emptyCanvas(),
    futureGraph: 42,
    nodes: [
      {
        id: "image",
        type: "asset",
        position: { x: 5, y: 0 },
        data: {
          assetId: "a",
          role: "仅身份",
          future: 42,
          legacy: { metadata: { prompt: "原提示词" } },
        },
      },
      {
        id: "duplicate",
        type: "asset",
        position: { x: 300, y: 0 },
        data: { assetId: "a" },
      },
    ],
    edges: [
      { id: "kept-edge", source: "image", target: "duplicate", future: 42 },
    ],
  },
});
test("replacement preserves node identity, role, links, other uses and original assets; undo snapshot stays intact", () => {
  const doc = source(),
    before = structuredClone(doc),
    next = replaceCanvasAsset(doc, "image", "a", doc.assets[1]);
  assert.deepEqual(doc, before);
  assert.equal(next.tugouCanvas.nodes[0].data.assetId, "b");
  assert.deepEqual(
    next.tugouCanvas.nodes[0].position,
    doc.tugouCanvas.nodes[0].position,
  );
  assert.equal(next.tugouCanvas.nodes[0].data.role, "仅身份");
  assert.equal(next.tugouCanvas.nodes[0].data.future, 42);
  assert.equal(next.tugouCanvas.nodes[0].data.legacyPromptAssetId, "a");
  assert.deepEqual(next.tugouCanvas.edges, doc.tugouCanvas.edges);
  assert.equal(next.tugouCanvas.nodes[1], doc.tugouCanvas.nodes[1]);
  assert.equal(next.assets, doc.assets);
  assert.equal(next.unknown, doc.unknown);
  assert.equal(replaceCanvasAsset(next, "image", "b", doc.assets[1]), next);
  assert.equal(
    replaceCanvasAsset(next, "image", "b", doc.assets[0]).tugouCanvas.nodes[0]
      .data.legacyPromptAssetId,
    "a",
  );
});
test("new imports append atomically; stale nodes and duplicate resource identities cannot replace current content", () => {
  const doc = source(),
    added = { id: "c", resource: "c.png" };
  const next = replaceCanvasAsset(doc, "image", "a", added);
  assert.equal(next.assets.at(-1), added);
  assert.equal(next.assets.length, 3);
  assert.throws(
    () => replaceCanvasAsset(next, "image", "a", doc.assets[1]),
    /变化/,
  );
  assert.throws(() => replaceCanvasAsset(doc, "absent", "a", added), /变化/);
  assert.throws(
    () => replaceCanvasAsset(doc, "image", "a", { id: "b", resource: "c.png" }),
    /编号/,
  );
  assert.equal(doc.assets.length, 2);
});
test("reviewed analysis goes to linked canvas modules/recipe once, preserving source and compile order without a reference image by default", () => {
  const doc = source(),
    draft = {
      id: "11111111-1111-4111-8111-111111111111",
      assetId: "a",
      modules: [
        { name: "画风", kind: "style", text: "柔和平涂" },
        { name: "人物", kind: "character", text: "圆脸" },
      ],
    };
  const reviewed = applyAnalysis(doc, draft, {
    modules: draft.modules.map((m) => ({ ...m, enabled: true, global: false })),
    createRecipe: true,
    recipeName: "新配方",
    reference: false,
  });
  const next = analysisToCanvas(reviewed, draft.id, "image");
  assert.equal(next.tugouCanvas.nodes.length, 5);
  assert.equal(next.tugouCanvas.edges.length, 3);
  assert.deepEqual(next.tugouCanvas.nodes.slice(0, 2), doc.tugouCanvas.nodes);
  assert.deepEqual(next.tugouCanvas.edges[0], doc.tugouCanvas.edges[0]);
  assert.deepEqual(next.tugouCanvas.nodes[2].position, { x: 335, y: 0 });
  assert.equal(next.tugouCanvas.futureGraph, 42);
  assert.equal(next.unknown, doc.unknown);
  const compiled = compileNode(next, "analysis-recipe-" + draft.id);
  assert.deepEqual(compiled.references, []);
  assert.match(compiled.prompt, /圆脸[\s\S]*柔和平涂/);
  assert.equal(compiled.prompt.split("圆脸").length, 2);
  assert.equal(analysisToCanvas(next, draft.id, "image"), next);
  const modified = structuredClone(next);
  modified.tugouCanvas.nodes[2].data.binding.overrideText = "本地修改";
  assert.equal(analysisToCanvas(modified, draft.id), modified);
  assert.match(
    compileNode(modified, "analysis-recipe-" + draft.id).prompt,
    /本地修改/,
  );
  const bad = structuredClone(next);
  bad.tugouCanvas.nodes[2].data.binding.moduleId = "different";
  assert.throws(() => analysisToCanvas(bad, draft.id), /冲突/);
  assert.throws(() => analysisToCanvas(doc, draft.id), /审阅/);
});
test("modules-only review creates no implicit recipe and explicit reference retains source", () => {
  const doc = source(),
    draft = {
      id: "22222222-2222-4222-8222-222222222222",
      assetId: "a",
      modules: [{ name: "宠物", kind: "pet", text: "白猫" }],
    },
    review = {
      modules: [{ ...draft.modules[0], enabled: true }],
      createRecipe: false,
      recipeName: "",
      reference: false,
    };
  const next = analysisToCanvas(applyAnalysis(doc, draft, review), draft.id);
  assert.equal(next.recipes.length, 0);
  assert.equal(next.tugouCanvas.nodes.length, 3);
  assert.equal(next.tugouCanvas.edges.length, 1);
  const linked = analysisToCanvas(
    applyAnalysis(doc, draft, {
      ...review,
      createRecipe: true,
      recipeName: "配方",
      reference: true,
    }),
    draft.id,
  );
  assert.deepEqual(
    compileNode(linked, "analysis-recipe-" + draft.id).references,
    [{ assetId: "a", role: "仅画风" }],
  );
});
