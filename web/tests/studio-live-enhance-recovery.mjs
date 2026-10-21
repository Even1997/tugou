// Local-only recovery of the already paid enhancement response.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { finishCloudImage } from '../src/app/api/studio/cloud-image-tools.js';
const root = 'D:/CanvasStudioLiveQA';
const report = JSON.parse(await readFile(root + '/live-enhance.json', 'utf8'));
const source = await readFile(root + '/cloud-quality-source.png'), generated = await readFile(root + '/enhance-provider-output.png');
assert.equal(createHash('sha256').update(source).digest('hex'), report.sourceSha256);
const url = buffer => 'data:image/png;base64,' + buffer.toString('base64');
const started = performance.now();
const result = Buffer.from((await finishCloudImage(url(source), url(generated), report.operation, new AbortController().signal, undefined, true)).split(',')[1], 'base64');
const meta = await sharp(result).metadata();
assert.deepEqual([meta.width, meta.height], [1024, 1024]);
const originalAlpha = await sharp(source).ensureAlpha().extractChannel(3).raw().toBuffer();
assert.ok(originalAlpha.equals(await sharp(result).ensureAlpha().extractChannel(3).raw().toBuffer()));
const elapsedMs = Math.round(performance.now() - started);
await writeFile(root + '/enhance-aligned-output.png', result);
// A semitransparent source checks the same alignment branch independently of the opaque photo.
const rgba = await sharp(source).ensureAlpha().raw().toBuffer();
for (let p = 0; p < 1024 * 1024; p++) rgba[p * 4 + 3] = p % 256;
const translucent = await sharp(rgba, { raw: { width: 1024, height: 1024, channels: 4 } }).png().toBuffer();
const withAlpha = Buffer.from((await finishCloudImage(url(translucent), url(generated), report.operation, new AbortController().signal, undefined, true)).split(',')[1], 'base64');
const alpha = await sharp(withAlpha).ensureAlpha().extractChannel(3).raw().toBuffer();
for (let p = 0; p < alpha.length; p++) assert.equal(alpha[p], p % 256);
const evidence = { at: new Date().toISOString(), newRemoteRequests: 0, originalRequestStillFailed: true, explicitLocalRecovery: true, size: [1024, 1024], elapsedMs, alphaPixelsVerified: alpha.length, fullAlphaRangeVerified: true, limits: 'Cached single real enhancement plus synthetic continuous-alpha fixture; no general fidelity claim or passing 2x creative upscale' };
await writeFile(new URL('../../docs/studio-evidence/atelier-live-enhance-recovery.json', import.meta.url), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
