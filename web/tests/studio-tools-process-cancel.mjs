import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, symlink, link } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { processImageTool } from '../src/app/api/studio/image-tools.ts';

assert.equal(process.platform, 'win32', 'This regression exercises Windows venv processes');
const real = process.env.STUDIO_CANCEL_REAL === '1';
const root = path.resolve('D:/CanvasStudioCancelQA', `run-${Date.now()}`);
const folder = path.join(root, 'job');
await mkdir(folder, { recursive: true });
await mkdir(path.join(root, 'segmentation'));
await mkdir(path.join(root, 'realesrgan-20220424'));
// Retain this QA directory; never recursively clean a junction to the real runtime.
await symlink('D:/CanvasStudioRuntime/segment-python', path.join(root, 'segment-python'), 'junction');
if (real) await link('D:/CanvasStudioBiRefNetFullQA/model_fp16.onnx', path.join(root, 'segmentation/birefnet-general-fp16.onnx'));
await writeFile(path.join(root, 'segmentation', real ? 'segment-birefnet.py' : 'segment.py'), `import argparse, json, os, time, runpy
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--model'); p.add_argument('--input'); p.add_argument('--output')
a=p.parse_args()
ready=Path(a.output).with_name('worker.json')
ready.write_text(json.dumps({'pid':os.getpid(),'parent':os.getppid()}))
${real ? `runpy.run_path(${JSON.stringify(path.resolve('../desktop/tool-runtime/segment-birefnet.py').replaceAll('\\', '/'))}, run_name='__main__')` : `for i in range(150):
    Path(a.output).with_name('heartbeat.txt').write_text(str(i))
    time.sleep(.1)`}
`);
await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ff0000' } }).png().toFile(path.join(folder, 'input'));
process.env.STUDIO_TOOL_RUNTIME = path.join(root, 'realesrgan-20220424');
const controller = new AbortController();
let outcome, worker, abortTime, modelReady = false;
const cancel = () => { abortTime = performance.now(); controller.abort(new Error('qa-user-cancelled')); };
const task = processImageTool(root, { tool: 'cutout', options: { cutoutModel: real ? 'detail' : 'standard' } }, folder, controller.signal, value => {
    if (real && value >= 34 && !controller.signal.aborted) { modelReady = true; cancel(); }
})
    .then(() => { outcome = 'resolved'; }, error => { outcome = error.message; });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
try {
    for (let i = 0; i < 200; i++) {
        try { worker = JSON.parse(await readFile(path.join(folder, 'worker.json'), 'utf8')); break; } catch {}
        await delay(25);
    }
    assert.ok(worker?.pid, 'The real venv interpreter must have started');
    assert.ok(alive(worker.pid));
    if (real) {
        for (let i = 0; i < 600 && !controller.signal.aborted && !outcome; i++) await delay(25);
        assert.equal(modelReady, true, outcome || 'Model did not reach inference');
    } else cancel();
    await Promise.race([task, delay(2000)]);
    const report = { root, workerPid: worker.pid, parentPid: worker.parent,
        cancellationMs: Math.round(performance.now() - abortTime), outcome: outcome || 'still-pending', modelReady,
        workerStillAlive: alive(worker.pid), parentStillAlive: alive(worker.parent),
        limits: real ? 'Real DirectML model loaded; aborted at inference boundary. Not a quality or long-running GPU benchmark.' : 'Actual Windows venv process lifecycle using an isolated waiting worker; no model quality or GPU inference assertion.' };
    await writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    assert.equal(report.workerStillAlive, false, 'Cancel left the actual Python worker running');
    assert.equal(outcome, 'qa-user-cancelled');
    assert.equal(report.parentStillAlive, false);
} finally {
    controller.abort(new Error('qa-cleanup'));
    if (worker?.pid && alive(worker.pid)) process.kill(worker.pid);
    await task;
}
