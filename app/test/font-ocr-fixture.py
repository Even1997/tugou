import json
import random
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
library=json.loads((Path(__file__).parents[1]/'core/font-repertoire.json').read_text(encoding='utf8'))['characters']
total=int(sys.argv[2]) if len(sys.argv)>2 else 152
chars=list(library[:total-52]+'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz')
random.Random(137).shuffle(chars)
columns=20 if total>256 else 10
image=Image.new('RGBA',(columns*118+20,((total+columns-1)//columns)*122+20),'white');draw=ImageDraw.Draw(image)
face=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',65)
cells=[]
for i,c in enumerate(chars):
    x,y=20+(i%columns)*118,20+(i//columns)*122
    bounds=draw.textbbox((0,0),c,font=face)
    draw.text((x+20-bounds[0],y+24-bounds[1]),c,font=face,fill='black')
    cells.append(dict(character=c,box=[x,y,x+108,y+112]))
image.save(out/'unordered-152.png')
(out/'expected.json').write_text(json.dumps(cells,ensure_ascii=False),encoding='utf8')
