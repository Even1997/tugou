import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const evidence = path.resolve('../docs/studio-evidence');
const fixture = JSON.parse(await fs.readFile(path.join(evidence, 'atelier-large-library.json'), 'utf8'));
const root = path.resolve('../.tools/atelier-qa');
const project = JSON.parse(await fs.readFile(path.join(root, fixture.projectId + '.json'), 'utf8'));
const sources = project.assets.slice(0, 20).map(asset => path.join(root, 'resources', asset.resource));
sources.push('D:/CanvasStudioQuality/portrait-a-cutout.png', 'D:/CanvasStudioQuality/samples/chelsea.png');
const results = [];
for (const source of sources) {
    const entry = { source: path.basename(source), variants: [] }, decoded = [];
    for (const effort of [4, 0]) {
        const start = performance.now();
        const bytes = await sharp(source).autoOrient().resize(384, 384, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, alphaQuality: 100, effort }).toBuffer();
        entry.variants.push({ effort, ms: performance.now() - start, bytes: bytes.length });
        decoded.push(await sharp(bytes).ensureAlpha().raw().toBuffer());
    }
    let rgbError = 0, alphaError = 0;
    for (let i = 0; i < decoded[0].length; i++) {
        const difference = Math.abs(decoded[0][i] - decoded[1][i]);
        if (i % 4 === 3) alphaError += difference; else rgbError += difference;
    }
    entry.rgbMeanDifference = rgbError / (decoded[0].length / 4 * 3);
    entry.alphaDifferenceSum = alphaError;
    results.push(entry);
}
const totals = [0, 1].map(index => ({ effort: results[0].variants[index].effort, ms: results.reduce((n, r) => n + r.variants[index].ms, 0), bytes: results.reduce((n, r) => n + r.variants[index].bytes, 0) }));
await fs.writeFile(path.join(evidence, 'atelier-thumbnail-encoding.json'), JSON.stringify({ at: new Date().toISOString(), results, totals, limits: 'Sequential effort 4 then 0 may benefit from warm OS cache; decoded RGB comparison is not visual quality acceptance.' }, null, 2));
console.log(JSON.stringify({ totals, maxRgbDifference: Math.max(...results.map(r => r.rgbMeanDifference)), alphaDifferenceSum: results.reduce((n, r) => n + r.alphaDifferenceSum, 0) }));
