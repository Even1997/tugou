const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http"),
  crypto = require("node:crypto"),
  tar = require("tar");
const {
  verifiedDownload,
  extractArchive,
  hashFile,
} = require("../core/runtime-files.cjs");
async function folder(t) {
  const p = await fs.mkdtemp(path.join(os.tmpdir(), "tugou-install-test-"));
  t.after(() => fs.rm(p, { recursive: true, force: true }));
  return p;
}
function zip(entries) {
  const parts = [],
    central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name),
      data = Buffer.from(e.data || "hello");
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(0x314, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(((e.mode || 0x81a4) * 65536) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    parts.push(header, name, data);
    central.push(c, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
test("downloads resume, handle ignored ranges and reject corrupt bytes", async (t) => {
  const root = await folder(t),
    data = Buffer.from("verified-component-".repeat(2000)),
    digest = crypto.createHash("sha256").update(data).digest("hex"),
    requests = [];
  let mode = "range";
  const server = http.createServer((req, res) => {
    requests.push(req.headers.range);
    const start = Number(req.headers.range?.match(/\d+/)?.[0] || 0);
    if (mode === "bad") {
      res.end(Buffer.alloc(data.length));
      return;
    }
    if (start && mode === "range") {
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${data.length - 1}/${data.length}`,
      });
      res.end(data.subarray(start));
    } else res.end(data);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const item = {
      url: `http://127.0.0.1:${server.address().port}`,
      bytes: data.length,
      sha256: digest,
    },
    signal = new AbortController().signal;
  await fs.writeFile(path.join(root, digest + ".part"), data.subarray(0, 25));
  const file = await verifiedDownload(item, root, signal);
  assert.equal(requests[0], "bytes=25-");
  assert.equal(await hashFile(file), digest);
  await verifiedDownload(item, root, signal);
  assert.equal(requests.length, 1, "verified cache needs no request");
  await fs.unlink(file);
  await fs.writeFile(path.join(root, digest + ".part"), data.subarray(0, 17));
  mode = "ignore";
  await verifiedDownload(item, root, signal);
  assert.equal(await hashFile(file), digest);
  await fs.unlink(file);
  mode = "bad";
  await assert.rejects(verifiedDownload(item, root, signal), /校验失败/);
  await assert.rejects(fs.access(path.join(root, digest + ".part")));
});
test("cancel keeps partial bytes and subsequent request resumes exact offset", async (t) => {
  const root = await folder(t),
    data = Buffer.alloc(128 * 1024, 42),
    digest = crypto.createHash("sha256").update(data).digest("hex");
  let ranges = [];
  const server = http.createServer((req, res) => {
    const start = Number(req.headers.range?.match(/\d+/)?.[0] || 0);
    ranges.push(start);
    if (start)
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${data.length - 1}/${data.length}`,
      });
    let cursor = start;
    const timer = setInterval(() => {
      if (cursor >= data.length) {
        clearInterval(timer);
        res.end();
      } else {
        res.write(data.subarray(cursor, cursor + 4096));
        cursor += 4096;
      }
    }, 3);
    res.on("close", () => clearInterval(timer));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const item = {
      url: `http://127.0.0.1:${server.address().port}`,
      bytes: data.length,
      sha256: digest,
    },
    controller = new AbortController();
  await assert.rejects(
    verifiedDownload(item, root, controller.signal, (done) => {
      if (done > 16000) controller.abort();
    }),
  );
  const partial = await fs.stat(path.join(root, digest + ".part"));
  assert.ok(partial.size > 0 && partial.size < data.length);
  await verifiedDownload(item, root, new AbortController().signal);
  assert.equal(ranges[1], partial.size);
  assert.equal(await hashFile(path.join(root, digest)), digest);
});
test("zip rejects traversal, links, duplicates and preserves unrelated files", async (t) => {
  const root = await folder(t),
    signal = new AbortController().signal,
    archive = path.join(root, "archive.zip");
  for (const entries of [
    [{ name: "../escaped" }],
    [{ name: "link", mode: 0xa1ff }],
    [{ name: "same" }, { name: "SAME" }],
    [{ name: "C:/outside" }],
    [{ name: "CON.txt" }],
    [{ name: "model. " }],
  ]) {
    await fs.writeFile(archive, zip(entries));
    await assert.rejects(
      extractArchive(
        archive,
        path.join(root, "out"),
        { format: "zip" },
        signal,
      ),
    );
  }
  await assert.rejects(fs.access(path.join(root, "escaped")));
  await fs.writeFile(archive, zip([{ name: "nested/model", data: "model" }]));
  await extractArchive(
    archive,
    path.join(root, "valid"),
    { format: "zip" },
    signal,
  );
  assert.equal(
    await fs.readFile(path.join(root, "valid/nested/model"), "utf8"),
    "model",
  );
});
test("tar extracts stripped executable and refuses links", async (t) => {
  const root = await folder(t),
    input = path.join(root, "source");
  await fs.mkdir(path.join(input, "release"), { recursive: true });
  await fs.writeFile(path.join(input, "release/uv"), "executable");
  const archive = path.join(root, "uv.tar.gz");
  // These tiny fixtures use synchronous packing to avoid the packer's async
  // hard-link completion race; the production extraction path is still async.
  tar.c({ sync: true, gzip: true, cwd: input, file: archive }, ["release"]);
  await extractArchive(
    archive,
    path.join(root, "out"),
    { format: "tar.gz", strip: 1, only: "uv" },
    new AbortController().signal,
  );
  assert.equal(
    await fs.readFile(path.join(root, "out/uv"), "utf8"),
    "executable",
  );
  // A hard-link entry is valid tar, but must not be accepted by this installer.
  await fs.link(
    path.join(input, "release/uv"),
    path.join(input, "release/linked"),
  );
  tar.c({ sync: true, gzip: true, cwd: input, file: archive }, ["release"]);
  await assert.rejects(
    extractArchive(
      archive,
      path.join(root, "links"),
      { format: "tar.gz", strip: 1 },
      new AbortController().signal,
    ),
    /链接|特殊/,
  );
});
module.exports = { zip };
test("cancelled extraction releases its output before retry", async (t) => {
  const root = await folder(t),
    archive = path.join(root, "large.zip"),
    out = path.join(root, "out");
  await fs.writeFile(
    archive,
    zip([{ name: "large.bin", data: Buffer.alloc(8 * 1024 ** 2, 7) }]),
  );
  const controller = new AbortController();
  const operation = extractArchive(
    archive,
    out,
    { format: "zip" },
    controller.signal,
  );
  const timer = setInterval(async () => {
    try {
      if ((await fs.stat(path.join(out, "large.bin"))).size > 0) {
        clearInterval(timer);
        controller.abort();
      }
    } catch {}
  }, 2);
  await assert.rejects(operation);
  clearInterval(timer);
  await extractArchive(
    archive,
    out,
    { format: "zip" },
    new AbortController().signal,
  );
  assert.equal(
    (await fs.stat(path.join(out, "large.bin"))).size,
    8 * 1024 ** 2,
  );
});
