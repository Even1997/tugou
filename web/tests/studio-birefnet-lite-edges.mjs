// Evaluate the existing, explicit white-fringe tool on the isolated Lite portraits.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { processImageTool } from '../src/app/api/studio/image-tools.ts';
const root = 'D:/CanvasStudioBiRefNetLiteQA', results = [];
for (const name of ['portrait-a', 'portrait-b']) {
    const folder = `${root}/white-fringe-${name}`;
    await mkdir(folder, { recursive: true });
    const input = await readFile(`${root}/results-physical-guard/${name}.png`);
    await writeFile(folder + '/input', input);
    const started = performance.now();
    await processImageTool(root, { tool: 'alpha', options: { feather: 0, choke: 0, matte: 'white' } }, folder, new AbortController().signal, () => {});
    const elapsedMs = Math.round(performance.now() - started), bytes = await readFile(folder + '/output.png');
    const before = await sharp(input).ensureAlpha().raw().toBuffer(), after = await sharp(bytes).ensureAlpha().raw().toBuffer();
    assert.equal(after.length, before.length);
    let opaque = 0;
    for (let i = 0; i < before.length; i += 4) {
        assert.equal(after[i + 3], before[i + 3]);
        if (before[i + 3] === 255) {
            assert.ok(before.subarray(i, i + 3).equals(after.subarray(i, i + 3)));
            opaque++;
        }
    }
    const previews = await Promise.all(['#ffffff', '#17191f'].map(background => sharp(bytes).flatten({ background }).resize({ height: 500 }).png().toBuffer()));
    const width = (await sharp(previews[0]).metadata()).width;
    await sharp({ create: { width: width * 2, height: 500, channels: 3, background: '#ffffff' } }).composite(previews.map((input, i) => ({ input, left: i * width, top: 0 }))).png().toFile(folder + '/comparison.png');
    results.push({ name, elapsedMs, alphaUnchanged: true, opaqueRGBUnchanged: opaque, limits: 'Explicit white background removal on two light-background portraits; not applicable to unknown coloured backgrounds' });
}
await writeFile(new URL('../../docs/studio-evidence/atelier-birefnet-lite-edges.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
