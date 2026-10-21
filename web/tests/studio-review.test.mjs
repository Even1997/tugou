import test from "node:test";
import assert from "node:assert/strict";
import { blankProject, createLayer } from "../src/app/studio/model.ts";
import { ungroupLayer } from "../src/app/studio/layer-operations.ts";
import { defaultEffect, defaultAdjustment } from "../src/app/studio/tone-schema.js";

test("解除分组不能丢弃组特效或把组内调整泄漏到组外", () => {
    const group = createLayer("group", "组"), child = { ...createLayer("shape", "内容"), shape: "rect", parentId: group.id };
    for (const enabled of [true, false]) {
        const p = { ...blankProject(), version: 5, layers: [{ ...group, effects: [{ ...defaultEffect("shadow"), enabled }] }, child] };
        assert.throws(() => ungroupLayer(p, group.id), /组/);
        assert.equal(p.layers[0].effects[0].enabled, enabled);
    }
    const p = { ...blankProject(), version: 5, layers: [group, child, { ...createLayer("adjustment", "反相"), parentId: group.id, adjustment: defaultAdjustment("invert") }] };
    assert.throws(() => ungroupLayer(p, group.id), /组/);
});
