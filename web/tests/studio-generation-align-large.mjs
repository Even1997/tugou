// Offline acceptance for the explicit local recovery path; no provider calls.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { freemem } from 'node:os';
import sharp from 'sharp';
import { finishCloudImage } from '../src/app/api/studio/cloud-image-tools.js';

const mode = process.argv[2];
assert.ok(['complete', 'cancel'].includes(mode));
const root = 'D:/CanvasStudioAlignQA';
await mkdir(root, { recursive: true });
const freeBefore = freemem();
assert.ok(freeBefore >= 3 * 1024 ** 3, 'Reserve 3 GiB for isolated 64MP acceptance');
const url = buffer => 'data:image/png;base64,' + buffer.toString('base64');
const source = url(await sharp({ create: { width: 8000, height: 8000, channels: 4, background: '#dc784080' } }).png().toBuffer());
const generated = url(await sharp({ create: { width: 10000, height: 10000, channels: 4, background: '#1267ae' } }).png().toBuffer());
const operation = { kind: 'edit', sourceId: 'large', sourceWidth: 8000, sourceHeight: 8000, left: 2000, top: 2000, width: 4000, height: 4000 };
const controller = new AbortController(), start = performance.now();
let requestedAt, output;
const timer = mode === 'cancel' ? setTimeout(() => { requestedAt = performance.now(); controller.abort(new Error('Explicit local cancellation')); }, 100) : undefined;
try {
    const work = finishCloudImage(source, generated, operation, controller.signal, undefined, true);
    if (mode === 'cancel') await assert.rejects(work, /Explicit local cancellation/);
    else output = Buffer.from((await work).split(',')[1], 'base64');
} finally { clearTimeout(timer); }
const finishedAt = performance.now(), processingPeakMiB = Math.round(process.resourceUsage().maxRSS / 1024);
const result = { at: new Date().toISOString(), mode, fixture: 'Synthetic 100MP return explicitly downsized to 64MP; no real model', newRemoteRequests: 0, freeBeforeMiB: Math.round(freeBefore / 1024 ** 2), elapsedMs: Math.round(finishedAt - start), processingPeakMiB, targetSize: [8000, 8000], providerSize: [10000, 10000] };
if (mode === 'cancel') {
    assert.ok(requestedAt !== undefined);
    Object.assign(result, { rejectedAfterCancelMs: Math.round(finishedAt - requestedAt), resultReturned: false, limit: 'Native Sharp resize finishes before the abort check; not instant native cancellation' });
} else {
    const meta = await sharp(output).metadata();
    assert.deepEqual([meta.width, meta.height], [8000, 8000]);
    const pixels = await sharp(output).ensureAlpha().raw().toBuffer();
    let protectedPixels = 0, editedPixels = 0;
    for (let y = 0; y < 8000; y++) for (let x = 0; x < 8000; x++) {
        const inside = x >= 2000 && x < 6000 && y >= 2000 && y < 6000;
        const expected = inside ? [18, 103, 174, 255] : [220, 120, 64, 128], i = (y * 8000 + x) * 4;
        for (let c = 0; c < 4; c++) if (pixels[i + c] !== expected[c]) throw Error(`Unexpected RGBA at ${x},${y}`);
        if (inside) editedPixels++; else protectedPixels++;
    }
    Object.assign(result, { protectedPixels, editedPixels, allPixelsVerified: true, peakIncludingVerificationMiB: Math.round(process.resourceUsage().maxRSS / 1024) });
    await writeFile(root + '/aligned-64mp.png', output);
}
await writeFile(new URL(`../../docs/studio-evidence/atelier-align-large-${mode}.json`, import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
