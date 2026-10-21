import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { processImageTool } from '../src/app/api/studio/image-tools.ts';

const root = process.env.STUDIO_SUBJECT_QA_DIR || 'D:/CanvasStudioSubjectQA';
assert.ok(path.isAbsolute(root));
const fixtures = 'D:/CanvasStudioBiRefNetFullQA/alpha-benchmark';
const reportPath = path.join(root, 'results.json');
await mkdir(root, { recursive: true });
try { await readFile(reportPath); throw new Error('Evidence exists; do not repeat unchanged inference'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
process.env.STUDIO_TOOL_RUNTIME ||= 'D:/CanvasStudioRuntime/realesrgan-20220424';
const report = { criteria: { foregroundRetainedMin: .97, backgroundClearedMin: .98 },
    limits: 'Default subject core/background screen. Original fractional-alpha effects are excluded from these two metrics, not declared perfect or irrelevant. Manual edge/detail review remains necessary. Six composites of two illustration assets, not broad photo validation.', samples: [] };
const manifest = JSON.parse(await readFile(path.join(fixtures, 'manifest.json'), 'utf8'));
for (const sample of manifest.filter(item => !item.name.startsWith('veil-lines'))) {
    const folder = path.join(root, sample.name);
    await mkdir(folder, { recursive: true });
    const source = await readFile(sample.source);
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash(source), sample.sourceSha256);
    await writeFile(path.join(folder, 'input'), source);
    const started = performance.now();
    const result = await processImageTool(root, { tool: 'cutout', options: { cutoutModel: process.env.STUDIO_CUTOUT_MODE || 'standard' } }, folder, new AbortController().signal, () => {});
    const seconds = (performance.now() - started) / 1000;
    const output = path.join(folder, 'output.png');
    const [actual, original, truth] = await Promise.all([output, sample.source, sample.truth].map(file => sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
    assert.equal(result.width, original.info.width); assert.equal(result.height, original.info.height);
    let fg = 0, retained = 0, bg = 0, cleared = 0;
    for (let i = 0; i < actual.data.length; i += 4) {
        for (let c = 0; c < 3; c++) assert.equal(actual.data[i+c], original.data[i+c], 'Source RGB changed');
        if (truth.data[i+3] > 255 * .95) { fg++; if (actual.data[i+3] > 255 * .9) retained++; }
        if (truth.data[i+3] < 255 * .01) { bg++; if (actual.data[i+3] < 255 * .05) cleared++; }
    }
    assert.ok(fg && bg); assert.equal(hash(await readFile(sample.source)), sample.sourceSha256);
    const foregroundRetained = retained / fg, backgroundCleared = cleared / bg;
    report.samples.push({ name: sample.name, seconds, width: result.width, height: result.height,
        foregroundRetained, backgroundCleared, coreScreenPassed: foregroundRetained >= .97 && backgroundCleared >= .98,
        originalRGBUnchanged: true, sourceSha256: sample.sourceSha256, output });
    const panels = await Promise.all(['#ffffff', '#17191f'].map(background => sharp(output).flatten({ background }).resize({ height: 600 }).png().toBuffer()));
    const width = (await sharp(panels[0]).metadata()).width;
    await sharp({ create: { width: width * 2, height: 600, channels: 3, background: '#ffffff' } }).composite(panels.map((input, i) => ({ input, left: i * width, top: 0 }))).png().toFile(path.join(folder, 'preview.png'));
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.samples.at(-1)));
}
