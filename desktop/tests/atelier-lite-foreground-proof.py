"""Offline foreground-colour estimation using an already computed alpha."""
import json
import os
import time
from pathlib import Path
import numpy as np
from PIL import Image
from pymatting import estimate_foreground_ml

full = os.environ.get('STUDIO_BIREFNET_FULL') == '1'
matting16 = os.environ.get('STUDIO_BIREFNET_MATTING_FP16') == '1'
assert not (full and matting16), 'Choose one isolated model'
root = Path('D:/CanvasStudioBiRefNetQA' if matting16 else 'D:/CanvasStudioBiRefNetFullQA' if full else 'D:/CanvasStudioBiRefNetLiteQA')
isnet = os.environ.get('STUDIO_MATTING_ISNET') == '1'
assert not ((full or matting16) and isnet), 'Choose one isolated source'
output = root / ('matting-fp16-foreground-estimate' if matting16 else 'isnet-foreground-estimate' if isnet else 'foreground-estimate')
output.mkdir(exist_ok=True)
results = []
for name in ('portrait-a', 'portrait-b', 'pet'):
    input_path = Path('D:/CanvasStudioQuality') / f'{name}-cutout.png' if isnet else root / ('results-matting-fp16' if matting16 else 'results-physical-guard') / f'{name}.png'
    source = np.array(Image.open(input_path).convert('RGBA'))
    rgb, alpha = source[:, :, :3].astype(np.float64) / 255, source[:, :, 3].astype(np.float64) / 255
    started = time.perf_counter()
    foreground = estimate_foreground_ml(rgb, alpha)
    foreground[alpha == 1] = rgb[alpha == 1]
    assert np.isfinite(foreground).all()
    pixels = np.dstack((np.rint(np.clip(foreground, 0, 1) * 255).astype(np.uint8), source[:, :, 3]))
    assert np.array_equal(pixels[:, :, 3], source[:, :, 3])
    assert np.array_equal(pixels[:, :, :3][alpha == 1], source[:, :, :3][alpha == 1])
    image = Image.fromarray(pixels)
    image.save(output / f'{name}.png')
    width = round(image.width * 500 / image.height)
    preview = Image.new('RGB', (width * 2, 500))
    for index, background in enumerate(('#ffffff', '#17191f')):
        canvas = Image.new('RGBA', image.size, background)
        canvas.alpha_composite(image)
        preview.paste(canvas.convert('RGB').resize((width, 500), Image.Resampling.LANCZOS), (index * width, 0))
    preview.save(output / f'{name}-backgrounds.png')
    results.append(dict(name=name, seconds=round(time.perf_counter() - started, 3), alphaUnchanged=True, opaqueRGBUnchanged=True))
    print(json.dumps(results[-1]), flush=True)
(output / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
