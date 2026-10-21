"""Feasibility of explicit foreground/background guidance, not product acceptance.

Fixed visible-geometry strokes, identical for all backgrounds. Ground-truth alpha
is read only after inference for scoring; it never supplies the trimap.
"""
import hashlib
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from pymatting import estimate_alpha_cf

fixtures = Path('D:/CanvasStudioBiRefNetFullQA/alpha-benchmark')
output = Path('D:/CanvasStudioMattingQA/results-guided-veil')
output.mkdir(exist_ok=True)
assert not (output / 'results.json').exists(), 'Preserve earlier evidence'
trimap_image = Image.new('L', (768, 768), 128)
draw = ImageDraw.Draw(trimap_image)
draw.rectangle((0, 0, 767, 767), outline=0, width=25)
draw.ellipse((340, 220, 420, 300), fill=255)
draw.rectangle((340, 400, 420, 620), fill=255)
trimap_image.save(output / 'guidance.png')
trimap = np.asarray(trimap_image).astype(np.float64) / 255
report = {
    'limits': 'Analytic 768px veil fixture with fixed geometric guidance; no real-photo, UI, large-image or cancellation acceptance. Guidance is not generated from alpha truth.',
    'criteria': {'MAEMax': .03, 'transitionMAEMax': .12, 'knownSeedsExact': True},
    'samples': [],
}
for background in ('light', 'dark', 'pattern'):
    path = fixtures / f'veil-lines-{background}.png'
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    source = Image.open(path).convert('RGB')
    rgb = np.asarray(source).astype(np.float64) / 255
    started = time.perf_counter()
    try:
        alpha = estimate_alpha_cf(rgb, trimap, cg_kwargs={'maxiter': 500})
        elapsed = time.perf_counter() - started
        assert np.isfinite(alpha).all()
        assert (alpha[trimap == 1] == 1).all() and (alpha[trimap == 0] == 0).all()
        truth = np.asarray(Image.open(fixtures / 'veil-lines-truth.png'))[:, :, 3] / 255
        error = np.abs(alpha - truth)
        transition = (truth > .05) & (truth < .95)
        metrics = dict(MAE=float(error.mean()), transitionMAE=float(error[transition].mean()))
        result = source.convert('RGBA')
        result.putalpha(Image.fromarray(np.rint(np.clip(alpha, 0, 1) * 255).astype(np.uint8)))
        result.save(output / f'{background}.png')
        item = dict(background=background, seconds=round(elapsed, 3), metrics=metrics,
                    knownSeedsExact=True, passed=metrics['MAE'] <= .03 and metrics['transitionMAE'] <= .12)
    except Exception as error:
        item = dict(background=background, error=str(error), passed=False,
                    seconds=round(time.perf_counter() - started, 3))
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
    item['sourceSha256'] = before
    report['samples'].append(item)
    (output / 'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(item), flush=True)
