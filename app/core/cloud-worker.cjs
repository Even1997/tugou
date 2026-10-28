const fs = require("node:fs/promises");
const { prepare, finish } = require("./cloud-pixels.cjs");
(async () => {
  const spec = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
  const source = await fs.readFile(spec.input);
  const editMask = spec.editMask ? await fs.readFile(spec.editMask) : undefined;
  if (spec.mode === "prepare") {
    const r = await prepare(source, spec.settings, editMask);
    await fs.writeFile(spec.output, r.image);
    await fs.writeFile(spec.canonical, r.canonical);
    if (r.mask) await fs.writeFile(spec.mask, r.mask);
    console.log(
      JSON.stringify({
        size: r.size,
        sourceSize: r.sourceSize,
        settings: r.settings,
        mask: Boolean(r.mask),
      }),
    );
  } else if (spec.mode === "finish") {
    await fs.writeFile(
      spec.output,
      await finish(
        source,
        await fs.readFile(spec.generated),
        spec.settings,
        spec.fit,
        editMask,
      ),
    );
    console.log(JSON.stringify({ complete: true }));
  } else throw Error("本地处理方式无效");
})().catch((error) => {
  console.log(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
});
