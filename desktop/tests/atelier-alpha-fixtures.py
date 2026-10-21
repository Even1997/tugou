"""Known-alpha stress fixtures, not photographic ground-truth claims."""
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

root = Path('D:/CanvasStudioBiRefNetFullQA/alpha-benchmark')
root.mkdir(exist_ok=True)
workspace = Path(__file__).resolve().parents[2]
sources = {}
for name, file in [('couple', '03-couple.png'), ('flowers', '04-flowers.png')]:
    image = Image.open(workspace / 'web/public/studio-demo' / file).convert('RGBA')
    image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    sources[name] = image
# An explicit transparency/line stress case, separate from semantic objects.
veil = Image.new('RGBA', (768, 768))
draw = ImageDraw.Draw(veil)
draw.polygon([(250, 80), (500, 80), (710, 700), (55, 700)], fill=(246, 241, 232, 80))
draw.ellipse((285, 160, 480, 355), fill=(205, 156, 130, 255))
draw.polygon([(280, 350), (485, 350), (540, 680), (225, 680)], fill=(240, 231, 218, 255))
for n in range(12):
    draw.arc((100 + n * 5, 100 + n * 3, 620 - n * 5, 730), 175, 300, fill=(110, 75, 45, 180), width=1)
sources['veil-lines'] = veil
manifest = []
for name, image in sources.items():
    truth = root / f'{name}-truth.png'
    image.save(truth)
    for background in ('light', 'dark', 'pattern'):
        if background == 'pattern':
            yy, xx = np.indices((image.height, image.width))
            color = np.where(((xx // 40 + yy // 40) % 2)[..., None], [55, 105, 160], [215, 170, 125]).astype(np.uint8)
            canvas = Image.fromarray(color).convert('RGBA')
        else:
            canvas = Image.new('RGBA', image.size, '#f5f0e6' if background == 'light' else '#263649')
        canvas.alpha_composite(image)
        file = root / f'{name}-{background}.png'
        canvas.convert('RGB').save(file)
        manifest.append({'name': f'{name}-{background}', 'source': str(file), 'truth': str(truth), 'sourceSha256': hashlib.sha256(file.read_bytes()).hexdigest()})
(root / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps({'samples': len(manifest), 'path': str(root), 'limits': 'Known alpha from stored illustration assets and one analytic stress case; not real-photo benchmark or universal matting accuracy'}))
