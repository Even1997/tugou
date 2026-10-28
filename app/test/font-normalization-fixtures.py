"""Two separate sources: actual Spring atlas and disclosed perturbed 152-glyph fixtures."""
import json
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

plan_path, source_path, out = map(Path, sys.argv[1:4])
spring = len(sys.argv) > 4 and sys.argv[4] == 'spring'
plan = json.loads(plan_path.read_text(encoding='utf-8'))
source = Image.open(source_path).convert('RGBA') if spring else None
records = []
for page in plan['pages']:
    sheet = Image.open(plan_path.parent / page['template']).convert('RGB')
    for i, cell in enumerate(page['cells']):
        size = cell['box'][2]-cell['box'][0]
        if spring:
            index = '春日来信'.index(cell['character'])
            w, h = source.width//2, source.height//2
            tile = source.crop(((index%2)*w, (index//2)*h, (index%2+1)*w, (index//2+1)*h))
            # Same scale/padding for all four glyphs; no per-glyph pre-normalization.
            tile = tile.resize((round(size*.8), round(size*.8)), Image.Resampling.LANCZOS)
            image = Image.new('RGB', (size, size), 'white')
            image.paste(tile, (round(size*.1), round(size*.1)), tile.getchannel('A'))
            record = dict(character=cell['character'], source='original AI Spring atlas', sharedScale=.8*size/w)
        else:
            image = Image.new('RGB', (size, size), 'white')
            face = ImageFont.truetype(str(source_path), round(cell['emPixels']))
            ImageDraw.Draw(image).text((cell['originX'], cell['baseline']), cell['character'], font=face, fill='black', anchor='ls')
            scale = [.86, .94, 1.02, 1.10][i%4]
            dx, dy = [-14, 10, 16, -8][i%4], [13, -16, 9, -9][i%4]
            matrix = np.float32([[scale, 0, size/2*(1-scale)+dx], [0, scale, size/2*(1-scale)+dy]])
            raster = cv2.warpAffine(np.array(image), matrix, (size, size), borderValue=(255,255,255))
            mask = (raster[:,:,0] < 128).astype('uint8')
            # Deliberate bounded stroke perturbation, retained only if topology is unchanged.
            count = cv2.connectedComponents(mask)[0]
            changed = cv2.dilate(mask, np.ones((3,3), np.uint8)) if i%3 == 0 else cv2.erode(mask, np.ones((3,3), np.uint8)) if i%3 == 1 else mask
            applied = cv2.connectedComponents(changed)[0] == count and bool(changed.any())
            image = Image.fromarray(np.where(changed if applied else mask, 0, 255).astype('uint8')).convert('RGB')
            record = dict(character=cell['character'], scale=scale, dx=dx, dy=dy, weightPerturbationApplied=applied, source='controlled prototype raster')
        records.append(record)
        sheet.paste(image, (cell['box'][0], cell['box'][1]))
    sheet.save(out / f"normalization-input-{page['page']}.png")
(out / 'normalization-input-records.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
