"""Offline quality experiment; not a shipped tool. Uses PyMatting's documented API.
https://pymatting.github.io/examples.html
"""
import json
import time
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import binary_erosion
from pymatting import estimate_alpha_cf, estimate_foreground_ml

root = Path('D:/CanvasStudioQuality')
output = Path('D:/CanvasStudioMattingQA/results-boundary')
output.mkdir(parents=True, exist_ok=True)
results = []
for name in ('portrait-a', 'portrait-b', 'pet'):
    source = np.array(Image.open(root / f'{name}-cutout.png').convert('RGBA'))
    rgb = source[:, :, :3].astype(np.float64) / 255
    coverage = source[:, :, 3].astype(np.float64) / 255
    foreground = binary_erosion(coverage > .5, structure=np.ones((11, 11)))
    background = binary_erosion(coverage <= .5, structure=np.ones((11, 11)), border_value=1)
    assert foreground.any() and background.any(), 'Need foreground and background seeds'
    trimap = np.full(coverage.shape, .5)
    trimap[foreground] = 1
    trimap[background] = 0
    start = time.perf_counter()
    alpha = estimate_alpha_cf(rgb, trimap, cg_kwargs={'maxiter': 2000})
    alpha_seconds = time.perf_counter() - start
    color = estimate_foreground_ml(rgb, alpha)
    # Keep certain foreground colors exact; decontamination is only for unknown edges.
    color[foreground] = rgb[foreground]
    assert np.isfinite(alpha).all() and np.isfinite(color).all()
    assert np.all(alpha[foreground] == 1) and np.all(alpha[background] == 0)
    for mode, pixels in [('alpha', rgb), ('color', color)]:
        rgba = np.dstack((np.clip(pixels, 0, 1), np.clip(alpha, 0, 1)))
        image = Image.fromarray(np.rint(rgba * 255).astype(np.uint8))
        if mode == 'color':
            assert np.array_equal(np.array(image)[:, :, :3][foreground], source[:, :, :3][foreground])
        image.save(output / f'{name}-{mode}.png')
        scale = 500 / image.height
        preview = Image.new('RGB', (round(image.width * scale) * 2, 500))
        for index, bg in enumerate(('#ffffff', '#17191f')):
            backdrop = Image.new('RGBA', image.size, bg)
            backdrop.alpha_composite(image)
            preview.paste(backdrop.convert('RGB').resize((preview.width // 2, 500), Image.Resampling.LANCZOS), (index * preview.width // 2, 0))
        preview.save(output / f'{name}-{mode}-backgrounds.png')
    results.append({'name': name, 'width': source.shape[1], 'height': source.shape[0], 'unknownPixels': int(np.count_nonzero(trimap == .5)), 'alphaSeconds': round(alpha_seconds, 3), 'totalSeconds': round(time.perf_counter() - start, 3), 'knownForegroundRGBUnchanged': True})
    print(json.dumps(results[-1]), flush=True)
    (output / 'results.json').write_text(json.dumps({'samples': results, 'limits': 'Auto trimap derived from IS-Net. No ground truth real mattes. Not integrated; no 100MP or cancellation acceptance.'}, indent=2), encoding='utf-8')
