const fs = require("node:fs/promises"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { safePath, atomicWrite } = require("./storage.cjs");
const { runProcess } = require("./local-process.cjs");
function cloudRunner(root) {
  return async (
    mode,
    source,
    generated,
    settings,
    signal,
    fit = false,
    editMask,
  ) => {
    const folder = await safePath(root, "cloud-jobs", randomUUID());
    await fs.mkdir(folder, { recursive: true });
    const spec = {
      mode,
      settings,
      fit,
      ...Object.fromEntries(
        ["input", "generated", "output", "canonical", "mask", "editMask"].map(
          (k) => [k, path.join(folder, k)],
        ),
      ),
    };
    try {
      signal.throwIfAborted();
      await atomicWrite(spec.input, source);
      if (generated) await atomicWrite(spec.generated, generated);
      if (editMask) await atomicWrite(spec.editMask, editMask);
      else spec.editMask = null;
      await atomicWrite(path.join(folder, "job.json"), JSON.stringify(spec));
      let result;
      try {
        const text = await runProcess(
          process.execPath,
          [
            path.join(__dirname, "cloud-worker.cjs"),
            path.join(folder, "job.json"),
          ],
          {
            signal,
            cwd: folder,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          },
        );
        result = JSON.parse(text.trim().split("\n").at(-1));
      } catch (error) {
        if (signal.aborted) throw error;
        for (const line of (error.output || "").split("\n")) {
          let value;
          try {
            value = JSON.parse(line);
          } catch {}
          if (value?.error)
            throw Object.assign(Error(value.error), {
              safeMessage: value.error,
            });
        }
        throw error;
      }
      signal.throwIfAborted();
      return {
        ...result,
        bytes: await fs.readFile(spec.output),
        canonical:
          mode === "prepare" ? await fs.readFile(spec.canonical) : undefined,
        mask: result.mask ? await fs.readFile(spec.mask) : undefined,
      };
    } finally {
      for (const file of [
        "input",
        "generated",
        "output",
        "canonical",
        "mask",
        "editMask",
        "job.json",
      ])
        await fs.rm(path.join(folder, file), { force: true }).catch(() => {});
      await fs.rmdir(folder).catch(() => {});
    }
  };
}
module.exports = { cloudRunner };
