const { packager } = require("@electron/packager");
const fs = require("node:fs/promises");
const path = require("node:path");
async function main() {
  const web = path.resolve(__dirname, "../web");
  const buildDir = process.env.STUDIO_BUILD_DIR || ".next";
  const standalone = path.join(web, buildDir, "standalone");
  await fs.access(path.join(standalone, "server.js"));
  // Cross-drive builds can miss Next's dynamic runtime files and sharp's ESM entry.
  // Package these complete runtimes so an ancestor node_modules cannot hide missing files.
  for (const module of ["next", "sharp", "@img"]) {
    await fs.cp(path.join(web, "node_modules", module), path.join(standalone, "node_modules", module), { recursive: true });
  }
  await fs.cp(
    path.join(web, buildDir, "static"),
    path.join(standalone, buildDir, "static"),
    { recursive: true },
  );
  await fs.cp(path.join(web, "public"), path.join(standalone, "public"), {
    recursive: true,
  });
  const outputs = await packager({
    dir: __dirname,
    out: process.env.STUDIO_PACKAGE_DIR || path.resolve(__dirname, "../release/editor-review"),
    name: "CanvasStudio",
    executableName: "CanvasStudio",
    platform: "win32",
    arch: "x64",
    overwrite: true,
    asar: true,
    electronVersion: require("electron/package.json").version,
    electronZipDir: path.resolve(__dirname, "../.tools/electron"),
    extraResource: [standalone, path.join(__dirname, "bin")],
    ignore: [/node_modules/, /package\.cjs/, /package-lock\.json/, /^\/bin/, /^\/tests/],
    appCopyright:
      "infinite-canvas contributors; Compositor reference: Wonder Assembly LLC",
  });
  for (const output of outputs) {
    await fs.copyFile(path.join(__dirname, "setup-image-tools.ps1"), path.join(output, "setup-image-tools.ps1"));
    await fs.cp(path.join(__dirname, "tool-runtime"), path.join(output, "tool-runtime"), { recursive: true });
    await fs.rename(
      path.join(output, "resources", "standalone"),
      path.join(output, "resources", "web"),
    );
    await fs.copyFile(
      path.resolve(__dirname, "../LICENSE"),
      path.join(output, "LICENSE-AGPL-3.0.txt"),
    );
    await fs.copyFile(
      path.resolve(__dirname, "../THIRD-PARTY-NOTICES.md"),
      path.join(output, "THIRD-PARTY-NOTICES.md"),
    );
    await fs.copyFile(
      path.resolve(__dirname, "../README-STUDIO.md"),
      path.join(output, "README-STUDIO.md"),
    );
  }
  console.log(outputs.join("\n"));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
