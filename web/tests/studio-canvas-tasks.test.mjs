import test from "node:test";
import assert from "node:assert/strict";
import { isCanvasTask } from "../src/app/studio/canvas-tasks.ts";

test("imported references and idle generation templates are not task history", () => {
    assert.equal(isCanvasTask({}), false);
    assert.equal(isCanvasTask({ metadata: { status: "success", content: "import.png", prompt: "reference description" } }), false);
    assert.equal(isCanvasTask({ metadata: { status: "idle", startedAt: 123 } }), false);
});

test("active tasks and completed, failed or stopped generations remain visible", () => {
    for (const status of ["loading", "stopping"]) assert.equal(isCanvasTask({ metadata: { status } }), true);
    for (const status of ["success", "error", "stopped"]) {
        for (const marker of ["startedAt", "clientTaskId", "imageTaskId", "videoTaskId", "audioTaskId", "generationPrompt"]) {
            assert.equal(isCanvasTask({ metadata: { status, [marker]: marker === "startedAt" ? 123 : "generation" } }), true);
        }
    }
});
