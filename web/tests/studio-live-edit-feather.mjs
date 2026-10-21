// Local compositor experiment using the cached paid return; no model requests.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { finishCloudImage } from '../src/app/api/studio/cloud-image-tools.js';

const root = 'D:/CanvasStudioLiveQA', report = JSON.parse(await readFile(root + '/live-edit.json', 'utf8'));
const source = await readFile(root + '/source.png'), generated = await readFile(root + '/provider-output.png');
assert.equal(createHash('sha256').update(source).digest('hex'), report.sourceSha256);
const url = b => 'data:image/png;base64,' + b.toString('base64');
const alpha = Buffer.alloc(1024 * 1024);
for (let y = 280; y < 744; y++) alpha.fill(255, y * 1024 + 280, y * 1024 + 744);
const softAlpha = await sharp(alpha, { raw: { width: 1024, height: 1024, channels: 1 } }).blur(8).extractChannel(0).raw().toBuffer();
assert.equal(softAlpha.length, 1024 * 1024);
const mask = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#ffffff' } }).joinChannel(softAlpha, { raw: { width: 1024, height: 1024, channels: 1 } }).png().toBuffer();
const hard = Buffer.from((await finishCloudImage(url(source), url(generated), report.operation, new AbortController().signal, undefined, true)).split(',')[1], 'base64');
const soft = Buffer.from((await finishCloudImage(url(source), url(generated), report.operation, new AbortController().signal, url(mask), true)).split(',')[1], 'base64');
const before = await sharp(source).ensureAlpha().raw().toBuffer(), hardPixels = await sharp(hard).ensureAlpha().raw().toBuffer(), softPixels = await sharp(soft).ensureAlpha().raw().toBuffer();
assert.equal(softAlpha[512 * 1024 + 512], 255);
assert.ok(softPixels[(512 * 1024 + 512) * 4 + 2] > softPixels[(512 * 1024 + 512) * 4] + 50);
let protectedPixels = 0, featherPixels = 0;
for (let p = 0; p < softAlpha.length; p++) {
    if (softAlpha[p] === 0) {
        assert.ok(before.subarray(p * 4, p * 4 + 4).equals(softPixels.subarray(p * 4, p * 4 + 4)));
        protectedPixels++;
    } else if (softAlpha[p] < 255) featherPixels++;
}
// Sample a background-only strip at the left rectangular edge, away from the circle.
const jump = pixels => {
    let maximum = 0;
    for (let y = 288; y < 304; y++) for (let x = 250; x < 310; x++) for (let c = 0; c < 3; c++) {
        const i = (y * 1024 + x) * 4 + c;
        maximum = Math.max(maximum, Math.abs(pixels[i] - pixels[i - 4]));
    }
    return maximum;
};
const hardJump = jump(hardPixels), softJump = jump(softPixels);
assert.ok(softJump < hardJump, 'Feather should reduce the sampled abrupt background seam');
await writeFile(root + '/feather-output.png', soft);
const crop = { left: 230, top: 230, width: 564, height: 564 };
await sharp({ create: { width: 1128, height: 564, channels: 3, background: '#ffffff' } }).composite([
    { input: await sharp(hard).extract(crop).png().toBuffer(), left: 0, top: 0 },
    { input: await sharp(soft).extract(crop).png().toBuffer(), left: 564, top: 0 },
]).png().toFile(root + '/feather-comparison.png');
const result = { at: new Date().toISOString(), newRemoteRequests: 0, mask: 'Synthetic rectangle with Sharp sigma 8 blur; exercises existing coverage compositor, not browser blur equivalence or a new model response', protectedPixels, featherPixels, sampledHardEdgeJump: hardJump, sampledSoftEdgeJump: softJump, limit: 'Single geometric cached image; feather spreads coverage beyond the rectangle and does not correct colour mismatch or content movement' };
await writeFile(new URL('../../docs/studio-evidence/atelier-live-edit-feather.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
