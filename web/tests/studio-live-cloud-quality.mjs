// One live request per explicitly selected operation. Existing reports prevent repeats.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { cloudOperation, cloudToolPrompt, generationReviewSize } from '../src/app/studio/cloud-tool-input.js';
import { prepareCloudImage, finishCloudImage } from '../src/app/api/studio/cloud-image-tools.js';

const kind = process.argv[2];
assert.ok(['enhance', 'upscale'].includes(kind));
const root = 'D:/CanvasStudioLiveQA', reportFile = `${root}/live-${kind}.json`;
await mkdir(root, { recursive: true });
assert.equal(await readFile(reportFile).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; }), false, 'Previous request exists; inspect it instead of resending');
const request = async (action, payload) => {
    const response = await fetch('http://127.0.0.1:3418/api/studio', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-request': '1' }, body: JSON.stringify({ action, payload }), signal: AbortSignal.timeout(660000) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
    return result;
};
const config = await request('config', {});
assert.ok(config.hasApiKey && config.model);
const pet = await readFile('D:/CanvasStudioQuality/samples/chelsea.png');
assert.equal(createHash('sha256').update(pet).digest('hex'), '596aa1e7cb875eb79f437e310381d26b338a81c2da23439704a73c4651e8c4bb');
const decoration = Buffer.from('<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" fill="#faf6ef"/><rect x="40" y="40" width="120" height="120" fill="#123456"/><rect x="864" y="864" width="120" height="120" fill="#18aa66"/><text x="512" y="230" text-anchor="middle" font-family="Arial" font-size="48" fill="#123456">ATELIER 2026</text></svg>');
const sourceBytes = await sharp(decoration).composite([{ input: pet, left: 286, top: 362 }]).ensureAlpha().png().toBuffer();
const source = 'data:image/png;base64,' + sourceBytes.toString('base64');
await writeFile(root + '/cloud-quality-source.png', sourceBytes);
const edge = kind === 'upscale' ? 2048 : 1024;
const operation = cloudOperation({ kind, sourceId: 'live-quality', sourceWidth: 1024, sourceHeight: 1024, left: 0, top: 0, width: edge, height: edge });
const signal = new AbortController().signal, prepared = await prepareCloudImage(source, operation, signal);
const report = { status: 'submitted', at: new Date().toISOString(), host: new URL(config.baseUrl).host, model: config.model, source: 'CC0 Chelsea photograph plus local geometric shapes and ATELIER 2026 text; no user photos', sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'), operation, remoteRequests: 1 };
await writeFile(reportFile, JSON.stringify(report, null, 2), { flag: 'wx' });
const started = Date.now();
try {
    const response = await request('generate', { prompt: cloudToolPrompt(operation, `输出完整${edge}×${edge}像素图片。保持猫的姿态、脸部、胡须、照片边界、背景、色块位置，文字必须仍为“ATELIER 2026”。仅改善清晰度和细节，不改变设计。`), size: `${edge}x${edge}`, references: [prepared.image] });
    report.responseMs = Date.now() - started;
    const generated = Buffer.from(response.dataUrl.split(',')[1], 'base64');
    await writeFile(`${root}/${kind}-provider-output.png`, generated);
    const meta = await sharp(generated).metadata();
    report.providerSize = [meta.width, meta.height];
    report.explicitDownsizeAvailable = !!generationReviewSize({ operation, rawResult: { width: meta.width, height: meta.height } });
    const finished = await finishCloudImage(source, response.dataUrl, operation, signal);
    const result = Buffer.from(finished.split(',')[1], 'base64');
    await writeFile(`${root}/${kind}-protected-output.png`, result);
    report.status = 'dimensions-and-processing-passed-visual-review-pending';
} catch (error) {
    report.status = 'failed'; report.error = String(error.message).slice(0, 500); process.exitCode = 1;
} finally {
    report.finishedAt = new Date().toISOString();
    report.limits = 'One actual provider request per operation; requires visual review, no measured detail ground truth or general identity guarantee';
    await writeFile(reportFile, JSON.stringify(report, null, 2));
    await writeFile(new URL(`../../docs/studio-evidence/atelier-live-${kind}.json`, import.meta.url), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
}
