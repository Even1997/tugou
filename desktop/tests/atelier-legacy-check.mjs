import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const request = async (port, action, payload) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/studio`, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Request": "1" }, body: JSON.stringify({ action, payload }) });
    if (!response.ok) throw Error(`${response.status}: ${await response.text()}`); return response.json();
};
const credentials = path.join(process.env.APPDATA, "CanvasStudio", "credentials.enc");
const hash = async () => createHash("sha256").update(await readFile(credentials)).digest("hex");
const before = await hash(), results = [];
const source = await request(3418, "list");
const target = await request(3437, "list");
assert.ok(target.location.includes("atelier-qa"));
assert.notEqual(path.resolve(source.location), path.resolve(target.location));
for (const row of source.projects) {
    const project = await request(3418, "open", { id: row.id });
    await request(3437, "save", project);
    const restored = await request(3437, "open", { id: row.id });
    assert.deepEqual(restored, project);
    results.push({ id: row.id, assets: project.assets.length, layers: project.layers.length, roundTripEqual: true });
}
assert.equal(await hash(), before);
await writeFile(new URL("../../docs/studio-evidence/atelier-legacy-results.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), originalDataReadOnly: true, credentialsUnchanged: true, projects: results }, null, 2));
console.log(JSON.stringify({ projects: results.length, credentialsUnchanged: true }));
