"""Known character mappings rasterized to the UI's 16x16 grid; no AI quality claim."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

plan_file, font_file, out = map(Path, sys.argv[1:4])
plan = json.loads(plan_file.read_text(encoding='utf-8'))
out.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype(str(font_file), 120)
for page in plan['pages']:
    image = Image.new('RGB', (page['width'], page['height']), 'white')
    for index, cell in enumerate(page['cells']):
        char = cell['character']
        box = font.getbbox(char)
        tile = Image.new('L', (box[2]-box[0]+8, box[3]-box[1]+8))
        ImageDraw.Draw(tile).text((4-box[0], 4-box[1]), char, font=font, fill=255)
        tile = tile.crop(tile.getbbox())
        # Deliberately vary size and placement to exercise correction.
        height = 66 if '\u3400' <= char <= '\u9fff' or char.isupper() else 56 if char in 'bdfhklt' else 60 if char in 'gjpqy' else 46
        scale = min(68/tile.width, height/tile.height) * [1, .93, 1.06][index%3]
        tile = tile.resize((round(tile.width*scale), round(tile.height*scale)), Image.Resampling.LANCZOS)
        x0,y0,x1,y1 = cell['box']
        x = x0+(x1-x0-tile.width)//2+[-3,0,3][index%3]
        y = y0+int(cell['baseline'])-tile.height+[2,-3,4][index%3]
        image.paste('black',(x,y,x+tile.width,y+tile.height),tile)
    image.save(out/f'grid-{page["page"]}.png')
print(json.dumps(dict(pages=len(plan['pages']),characters=len(plan['characters']))))
