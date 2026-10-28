const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { safePath } = require("./storage.cjs");
const { saveImage } = require("./generation.cjs");

// Validate a whole drop before publishing resources. A corrupt member never imports half a batch.
async function importImages(root, filenames, inspectImage) {
  if (!Array.isArray(filenames) || !filenames.length || filenames.length > 64)
    throw new Error("每次可导入 1–64 张图片");
  const files = new Set();
  let total = 0;
  for (const filename of filenames) {
    if (
      typeof filename !== "string" ||
      !path.isAbsolute(filename) ||
      !/\.(png|jpe?g|webp)$/i.test(filename)
    )
      throw new Error("请拖入本机 PNG、JPEG 或 WebP 图片文件");
    const file = await safePath(
      path.dirname(filename),
      path.basename(filename),
    );
    if (files.has(file)) continue;
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("请拖入图片文件，不能导入文件夹");
    if (stat.size > 64 * 1024 * 1024)
      throw new Error("单张图片不能超过 64 MiB");
    total += stat.size;
    files.add(file);
  }
  const available = await fs.statfs(root);
  if (available.bavail * available.bsize < total * 2 + 16 * 1024 * 1024)
    throw new Error("素材所在磁盘空间不足，请释放空间后重试");
  const staging = await fs.mkdtemp(
    path.join(await safePath(root, "imports"), "images-"),
  );
  try {
    const assets = [];
    for (const file of files)
      assets.push({
        id: randomUUID(),
        name: path.basename(file, path.extname(file)),
        ...(await saveImage(staging, await fs.readFile(file), inspectImage)),
      });
    for (const resource of new Set(assets.map((a) => a.resource))) {
      const target = await safePath(root, "resources", resource);
      await fs.rename(await safePath(staging, "resources", resource), target);
    }
    return assets;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
module.exports = { importImages };
