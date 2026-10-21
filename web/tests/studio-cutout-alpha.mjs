import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { processImageTool } from '../src/app/api/studio/image-tools.ts';
const root = 'D:/CanvasStudioCutoutUpgradeQA/alpha-4k';
await mkdir(root, { recursive: true });
process.env.STUDIO_TOOL_RUNTIME = 'D:/CanvasStudioCutoutUpgradeQA/realesrgan-20220424';
const source = path.resolve('public/studio-demo/04-flowers.png');
await sharp(source).resize({ width: 4096 }).png().toFile(path.join(root, 'input'));
const input = await readFile(path.join(root, 'input'));
const started = performance.now();
const result = await processImageTool(root, { tool: 'cutout', options: { cutoutModel: 'detail' } }, root, new AbortController().signal, () => {});
const [before, after] = await Promise.all([input, path.join(root, 'output.png')].map(file => sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
assert.deepEqual(before.info, after.info);
let protectedPixels = 0, fractionalPixels = 0;
for (let i = 0; i < before.data.length; i += 4) {
    for (let c = 0; c < 3; c++) assert.equal(before.data[i+c], after.data[i+c]);
    assert.ok(after.data[i+3] <= before.data[i+3]);
    if (before.data[i+3] === 0) { protectedPixels++; assert.equal(after.data[i+3], 0); }
    else if (before.data[i+3] < 255) fractionalPixels++;
}
assert.ok(protectedPixels && fractionalPixels);
assert.deepEqual(await readFile(path.join(root, 'input')), input);
const report = { ...result, seconds: (performance.now() - started) / 1000, protectedPixels, fractionalPixels, fullRGBUnchanged: true, originalAlphaUpperBound: true, inputBytesUnchanged: true, limits: '4K RGBA preservation, not 100MP or universal fine-detail quality acceptance' };
await writeFile('../docs/studio-evidence/atelier-subjects-detail-alpha.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
