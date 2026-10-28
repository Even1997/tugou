const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { ProjectStore } = require("../core/storage.cjs"),
  { importImages } = require("../core/import-images.cjs");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==",
  "base64",
);
const inspect = (bytes) => ({
  width: bytes.readUInt32BE(16),
  height: bytes.readUInt32BE(20),
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tugou-import-"));
  await new ProjectStore(root).init();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "照片.png");
  await fs.writeFile(file, png);
  return { root, file };
}
test("file import preserves original bytes, deduplicates repeated paths and reuses content-addressed storage", async (t) => {
  const { root, file } = await fixture(t);
  const assets = await importImages(root, [file, file], inspect);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].name, "照片");
  assert.deepEqual(
    await fs.readFile(path.join(root, "resources", assets[0].resource)),
    png,
  );
  const next = await importImages(root, [file], inspect);
  assert.equal(next[0].resource, assets[0].resource);
  assert.notEqual(next[0].id, assets[0].id);
  assert.equal((await fs.readdir(path.join(root, "resources"))).length, 1);
  assert.deepEqual(await fs.readdir(path.join(root, "imports")), []);
});
test("mixed corrupt batches leave no resources or staging; reject virtual files, directories, wrong formats and oversized input", async (t) => {
  const { root, file } = await fixture(t),
    bad = path.join(root, "corrupt.png");
  await fs.writeFile(bad, "bad image");
  await assert.rejects(importImages(root, [file, bad], inspect), /PNG|图片/);
  assert.deepEqual(await fs.readdir(path.join(root, "resources")), []);
  assert.deepEqual(await fs.readdir(path.join(root, "imports")), []);
  for (const files of [
    [],
    Array(65).fill(file),
    [""],
    ["relative.png"],
    [path.join(root, "notes.txt")],
  ])
    await assert.rejects(importImages(root, files, inspect));
  const dir = path.join(root, "folder.png");
  await fs.mkdir(dir);
  await assert.rejects(importImages(root, [dir], inspect), /文件夹/);
  const large = path.join(root, "large.png");
  const h = await fs.open(large, "w");
  await h.truncate(64 * 1024 * 1024 + 1);
  await h.close();
  await assert.rejects(importImages(root, [large], inspect), /64 MiB/);
});
