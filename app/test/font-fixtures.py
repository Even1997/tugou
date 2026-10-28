"""Controlled raster fixtures, never font-engine inputs containing source outlines."""
import json
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

plan_file, reference_font, output = map(Path, sys.argv[1:])
plan = json.loads(plan_file.read_text(encoding='utf-8'))
output.mkdir(parents=True, exist_ok=True)
for page in plan['pages']:
    image = Image.open(plan_file.parent / page['template']).convert('RGB')
    draw = ImageDraw.Draw(image)
    for cell in page['cells']:
        x, y, _, _ = cell['box']
        face = ImageFont.truetype(str(reference_font), round(cell['emPixels']))
        draw.text((x+cell['originX'], y+cell['baseline']), cell['character'], font=face, anchor='ls', fill='black')
    image.save(output / f"clean-{page['page']}.png")
    w, h = image.size
    # Perspective, mild rotation, translation and nonuniform camera scale together.
    original = np.float32([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]])
    moved = np.float32([[39, 21], [w-24, 42], [w-8, h-18], [18, h-39]])
    transform = cv2.getPerspectiveTransform(original, moved)
    warped = cv2.warpPerspective(np.array(image), transform, (w, h), borderValue=(255, 255, 255))
    Image.fromarray(warped).save(output / f"page-{page['page']}.png")
save = dict(characters=plan['characters'], source='Known original prototype glyphs rasterized to controlled input images; no AI style claim',
            fontNotProvidedToWorker=True, perturbations=['perspective', 'rotation', 'translation', 'scale'])
(output / 'fixture-manifest.json').write_text(json.dumps(save, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'pages': len(plan['pages']), 'characters': len(plan['characters'])}))
