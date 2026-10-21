import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

// Run after the documented isolated UI flow; never calls a real model provider.
const calls = await (await fetch("http://127.0.0.1:3421/qa/requests")).json();
assert.equal(calls.length, 2, "Updating modules alone must not generate images");
assert.equal(calls[0].path, "/v1/images/generations");
assert.equal(calls[1].path, "/v1/images/edits");
for (const phrase of ["画风版本一：清线插画。", "人物版本一：一对成年新人。", "动作版本一：并肩站立。"]) {
    assert.equal(calls[0].prompt.split(phrase).length - 1, 1);
    assert.equal(calls[1].prompt.includes(phrase), false, `Old text leaked: ${phrase}`);
}
for (const phrase of ["画风版本二：柔和水彩。", "人物版本二：戴眼镜的成年新人。", "动作版本二：牵手微笑。"]) {
    assert.equal(calls[1].prompt.split(phrase).length - 1, 1, `New text must occur once: ${phrase}`);
}
assert.ok(calls.every((call) => call.authorized));
await writeFile(new URL("../../docs/studio-evidence/module-update-requests.json", import.meta.url), JSON.stringify(calls, null, 2));
console.log("PASS: UI generation uses updated modules once, no stale text, no extra generation.");
