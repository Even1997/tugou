const fs = require("node:fs/promises"),
  { createReadStream, createWriteStream } = require("node:fs"),
  path = require("node:path"),
  { createHash } = require("node:crypto");
const { Readable, Transform } = require("node:stream"),
  { pipeline } = require("node:stream/promises");
const yauzl = require("yauzl"),
  tar = require("tar");
const { safePath } = require("./storage.cjs");
async function hashFile(file, signal) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) {
    signal?.throwIfAborted();
    hash.update(bytes);
  }
  return hash.digest("hex");
}
async function verifiedDownload(item, folder, signal, progress = () => {}) {
  if (
    !/^[a-f0-9]{64}$/.test(item.sha256) ||
    !Number.isSafeInteger(item.bytes) ||
    item.bytes <= 0 ||
    item.bytes > 1024 ** 3
  )
    throw Error("组件下载清单无效");
  const file = await safePath(folder, item.sha256),
    partial = await safePath(folder, item.sha256 + ".part");
  await fs.mkdir(folder, { recursive: true });
  try {
    if (
      (await fs.stat(file)).size === item.bytes &&
      (await hashFile(file, signal)) === item.sha256
    ) {
      progress(item.bytes, item.bytes);
      return file;
    }
    await fs.unlink(file);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  let offset = 0;
  try {
    offset = (await fs.stat(partial)).size;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (
    offset === item.bytes &&
    (await hashFile(partial, signal)) === item.sha256
  ) {
    await fs.rename(partial, file);
    return file;
  }
  if (offset >= item.bytes) {
    await fs.unlink(partial);
    offset = 0;
  }
  const combined = AbortSignal.any([signal, AbortSignal.timeout(900000)]);
  let url = new URL(item.url),
    response;
  for (let redirect = 0; redirect < 6; redirect++) {
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw Error("组件下载地址无效");
    response = await fetch(url, {
      signal: combined,
      redirect: "manual",
      headers: offset ? { Range: `bytes=${offset}-` } : undefined,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = new URL(response.headers.get("location"), url);
      response = null;
      continue;
    }
    break;
  }
  if (!response || ![200, 206].includes(response.status)) {
    await response?.body?.cancel();
    throw Error("组件下载失败，请检查网络后重试");
  }
  if (response.status === 206) {
    const range = response.headers
      .get("content-range")
      ?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (
      !range ||
      Number(range[1]) !== offset ||
      Number(range[3]) !== item.bytes ||
      Number(range[2]) !== item.bytes - 1
    ) {
      await response.body.cancel();
      throw Error("组件下载断点无效");
    }
  } else offset = 0;
  const start = offset;
  const check = new Transform({
    transform(chunk, encoding, done) {
      offset += chunk.length;
      if (offset > item.bytes) return done(Error("组件下载大小超出清单"));
      progress(offset, item.bytes);
      done(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    check,
    createWriteStream(partial, { flags: start ? "a" : "w" }),
    { signal: combined },
  );
  if (offset !== item.bytes) throw Error("组件下载不完整，可继续下载");
  if ((await hashFile(partial, signal)) !== item.sha256) {
    await fs.unlink(partial);
    throw Error("组件校验失败，未安装");
  }
  signal.throwIfAborted();
  await fs.rename(partial, file);
  return file;
}
function entryName(name, strip) {
  if (
    typeof name !== "string" ||
    name.includes("\\") ||
    name.includes(":") ||
    name.startsWith("/") ||
    name
      .split("/")
      .some(
        (p) =>
          p === ".." ||
          p === "." ||
          /[\x00-\x1f]/.test(p) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      )
  )
    throw Error("组件压缩包包含不安全路径");
  return name.split("/").filter(Boolean).slice(strip).join("/");
}
async function extractArchive(archive, folder, options, signal) {
  signal.throwIfAborted();
  await safePath(folder);
  await fs.mkdir(folder, { recursive: true });
  const seen = new Set();
  let total = 0,
    count = 0,
    written = 0;
  const validate = (name, size, type) => {
    signal.throwIfAborted();
    const relative = entryName(name, options.strip || 0);
    if (
      ++count > 2000 ||
      size < 0 ||
      size > 512 * 1024 ** 2 ||
      (total += size) > 1024 ** 3
    )
      throw Error("组件压缩包超过大小限制");
    if (type === "directory") return null;
    if (type !== "file") throw Error("组件压缩包不允许链接或特殊文件");
    if (!relative || (options.only && relative !== options.only)) return null;
    if (seen.has(relative.toLowerCase())) throw Error("组件压缩包包含重复路径");
    seen.add(relative.toLowerCase());
    return relative;
  };
  if (options.format === "zip") {
    await new Promise((resolve, reject) =>
      yauzl.open(
        archive,
        { lazyEntries: true, strictFileNames: true },
        (error, zip) => {
          if (error) return reject(error);
          if (signal.aborted) {
            zip.close();
            return reject(signal.reason);
          }
          let reading = false;
          const stop = () => {
            zip.close();
            if (!reading) reject(signal.reason);
          };
          signal.addEventListener("abort", stop, { once: true });
          const fail = (e) => {
            signal.removeEventListener("abort", stop);
            zip.close();
            reject(e);
          };
          zip.on("error", fail);
          zip.on("end", () => {
            signal.removeEventListener("abort", stop);
            resolve();
          });
          zip.on("entry", (entry) => {
            reading = true;
            (async () => {
              const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
              const relative = validate(
                entry.fileName,
                entry.uncompressedSize,
                entry.fileName.endsWith("/")
                  ? "directory"
                  : mode === 0xa000
                    ? "link"
                    : mode && mode !== 0x8000
                      ? "special"
                      : "file",
              );
              if (relative) {
                const target = await safePath(folder, relative);
                await fs.mkdir(path.dirname(target), { recursive: true });
                const stream = await new Promise((resolve, reject) =>
                  zip.openReadStream(entry, (e, s) =>
                    e ? reject(e) : resolve(s),
                  ),
                );
                await pipeline(stream, createWriteStream(target), { signal });
                written++;
              }
              signal.throwIfAborted();
              reading = false;
              zip.readEntry();
            })().catch(fail);
          });
          zip.readEntry();
        },
      ),
    );
  } else if (options.format === "tar.gz") {
    let failure;
    const extractor = tar.x({
      cwd: folder,
      strip: options.strip || 0,
      strict: true,
      preservePaths: false,
      filter: (name, entry) => {
        try {
          if (failure) return false;
          const relative = validate(
            name,
            entry.size,
            entry.type === "Directory"
              ? "directory"
              : entry.type === "File"
                ? "file"
                : "special",
          );
          if (relative) {
            written++;
            return true;
          }
          return false;
        } catch (e) {
          failure = e;
          return false;
        }
      },
    });
    await pipeline(createReadStream(archive), extractor, { signal });
    if (failure) throw failure;
  } else throw Error("组件压缩格式无效");
  if (!written) throw Error("压缩包缺少所需组件");
}
module.exports = { hashFile, verifiedDownload, extractArchive };
