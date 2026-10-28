import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / 'test-results' / 'local-ai-fixtures'
root.mkdir(exist_ok=True)
source = Image.open('C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-139ecd3b-c85b-46fe-a373-5473a30fb0be.png').convert('RGBA')
source.thumbnail((512, 768))
source.save(root / 'transparent.png')
small = source.resize((96, 144), Image.Resampling.LANCZOS)
small.save(root / 'small.png')
for name, color in [('white', '#fafafa'), ('gray', '#657387'), ('pattern', '#aaccbb')]:
    background = Image.new('RGBA', source.size, color)
    if name == 'pattern':
        d = ImageDraw.Draw(background)
        for x in range(0, source.width, 40):
            d.rectangle((x, 0, x+10, source.height), fill='#738b92')
    Image.alpha_composite(background, source).convert('RGB').save(root / (name + '.png'))
print(str(root))
