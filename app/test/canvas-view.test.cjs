const test = require("node:test"),
  assert = require("node:assert/strict");
const { angleRequest, resizeAssetNode } = require("../core/canvas-view.cjs");
const { mergeResults } = require('../core/results.cjs');
test('new outputs clear resized source bounds and each other, without moving existing nodes',()=>{
  const source={id:'source',type:'asset',position:{x:70,y:60},width:460,height:210,data:{assetId:'a',role:'主体'}};
  const doc={assets:[{id:'a'}],tugouCanvas:{nodes:[source],edges:[],viewport:{x:0,y:0,zoom:1},version:1}};
  const next=mergeResults(doc,[{id:'result',nodeId:'source',assets:[{id:'b'},{id:'c'}]}]);
  assert.deepEqual(next.tugouCanvas.nodes[0],source);
  assert.ok(next.tugouCanvas.nodes[1].position.x>=source.position.x+source.width+32);
  assert.ok(next.tugouCanvas.nodes[2].position.y-next.tugouCanvas.nodes[1].position.y>=370);
});
test("display sizing preserves resource references, graph metadata and independent dimensions, rejecting invalid geometry", () => {
  const n = {
    id: "image",
    type: "asset",
    position: { x: 20, y: 40, unknown: 1 },
    data: { assetId: "a", freeResize: true, unknown: 42 },
    style: { color: "red" },
    measured: { width: 230, height: 240 },
    resizing: true,
  };
  const before = structuredClone(n),
    next = resizeAssetNode(n, { width: 800, height: 160, x: -30, y: 50 });
  assert.equal(next.width, 800);
  assert.equal(next.height, 160);
  assert.deepEqual(next.data, n.data);
  assert.equal(next.style.color, "red");
  assert.equal(next.position.unknown, 1);
  assert.equal(next.measured, undefined);
  assert.equal(next.resizing, undefined);
  assert.deepEqual(n, before);
  for (const width of [NaN, Infinity, 0, -1, 10001])
    assert.throws(
      () => resizeAssetNode(n, { width, height: 160, x: 0, y: 0 }),
      /尺寸/,
    );
});
test("viewpoint request binds an exact image and documents camera directions; invalid parameters or replaced source cannot submit", () => {
  const doc = {
    assets: [{ id: "a", name: "主体" }],
    tugouCanvas: {
      nodes: [{ id: "n", type: "asset", data: { assetId: "a" } }],
    },
  };
  const req = angleRequest(doc, "n", "a", {
    horizontalAngle: -30,
    pitchAngle: -20,
    cameraDistance: 2.5,
    wideAngle: true,
  });
  assert.match(req.compiled.prompt, /左侧 30°/);
  assert.match(req.compiled.prompt, /仰视 20°/);
  assert.match(req.compiled.prompt, /广角/);
  assert.equal(req.compiled.references[0].assetId, "a");
  for (const p of [
    { horizontalAngle: 61 },
    { pitchAngle: 45.5 },
    { cameraDistance: Infinity },
    { wideAngle: "false" },
  ])
    assert.throws(() => angleRequest(doc, "n", "a", p), /参数/);
  assert.throws(() => angleRequest(doc, "n", "b", {}), /源图片/);
  assert.throws(() => angleRequest(doc, "missing", "a", {}), /源图片/);
});

test('generation outputs clear the full default desk width inside groups',()=>{
  const group={id:'group',type:'group',position:{x:500,y:200}},source={id:'desk',type:'config',parentId:'group',position:{x:50,y:70},data:{}};
  const doc={assets:[],tugouCanvas:{nodes:[group,source],edges:[],version:1,viewport:{x:0,y:0,zoom:1}}};
  const next=mergeResults(doc,[{id:'r',nodeId:'desk',kind:'workflow',mode:'image',assets:[{id:'output'}]}]);
  assert.equal(next.tugouCanvas.nodes.at(-1).position.x,500+50+400+70);
  assert.equal(next.tugouCanvas.nodes.at(-1).position.y,270);
  assert.deepEqual(doc.tugouCanvas.nodes,[group,source]);
});
