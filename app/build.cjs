const fs = require('node:fs/promises');
const esbuild = require('esbuild');
const path = require('node:path');
const output = process.env.TUGOU_BUILD_DIR || 'dist';
(async () => {
  const bundledInputs = new Set();
  const bundle = async options => {
    const result = await esbuild.build({...options,metafile:true});
    for(const input of Object.keys(result.metafile.inputs))bundledInputs.add(input.replaceAll('\\','/'));
  };
  await bundle({ entryPoints: ['renderer/index.jsx'], bundle: true, outfile: path.join(output,'ui.js'), platform: 'browser', format: 'iife', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
  await fs.mkdir(path.join(output,'brand'),{recursive:true});
  await fs.copyFile('assets/brand/logo.png',path.join(output,'brand/logo.png'));
  await fs.copyFile('renderer/index.html', path.join(output,'index.html'));
  await fs.copyFile('renderer/tool-host.html', path.join(output,'tool-host.html'));
  await bundle({entryPoints:['renderer/tool-host.js'],bundle:true,outfile:path.join(output,'tool-host.js'),platform:'browser',format:'iife',minify:true});
  for(const name of ['selection','content-fill','image-tools','image-composition','raster-encode'])
    await bundle({entryPoints:[`renderer/${name}-worker.js`],bundle:true,outfile:path.join(output,`${name}-worker.js`),platform:'browser',format:'iife',minify:true});
  await require('./scripts/third-party-notices.cjs')(output,[...bundledInputs]);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
