"""Compare exported font raster with the clean input, not with screenshots of the editor."""
import json
import sys
import hashlib
import zipfile
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

evidence = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
root, result, files = Path(evidence['root']), evidence['result'], Path(evidence['filesRoot'])
jobs = root / 'fonts' / result['projectId'] / 'jobs'
plan = json.loads((jobs / result['planJob'] / 'plan.json').read_text(encoding='utf-8'))
processed = json.loads((jobs / result['processJob'] / 'result.json').read_text(encoding='utf-8'))
ttf = files / 'export/font.ttf'
font = TTFont(ttf)
woff = TTFont(files / 'export/font.woff2')
assert set(font.getBestCmap()) == {32, *map(ord, plan['characters'])}
assert font.getBestCmap() == woff.getBestCmap()
for name in font.getGlyphOrder():
    assert font['glyf'][name].getCoordinates(font['glyf']) == woff['glyf'][name].getCoordinates(woff['glyf'])
    assert font['hmtx'][name] == woff['hmtx'][name]
with zipfile.ZipFile(files / 'export/font-source.zip') as archive:
    assert archive.testzip() is None
    provenance = json.loads(archive.read('provenance.json'))
    for original in provenance['originals']:
        assert hashlib.sha256(archive.read(original['file'])).hexdigest() == original['sha256']
    assert 'source.ufo/metainfo.plist' in archive.namelist()
scores = []
for page in plan['pages']:
    clean = Image.open(files / f"clean-{page['page']}.png").convert('L')
    for cell in page['cells']:
        record = next(g for g in processed['report']['glyphs'] if g['character'] == cell['character'])
        reference = np.array(clean.crop(cell['box'])) < 128
        canvas = Image.new('L', reference.shape[::-1], 255)
        face = ImageFont.truetype(str(ttf), round(cell['emPixels']))
        # Undo recorded Latin bearing translation to compare shapes at their original positions.
        origin = cell['originX'] - record['source']['bearingShift'] * round(cell['emPixels'])/1000
        ImageDraw.Draw(canvas).text((origin, cell['baseline']), cell['character'], font=face, anchor='ls', fill=0)
        actual = np.array(canvas) < 128
        iou = float(np.logical_and(reference, actual).sum() / np.logical_or(reference, actual).sum())
        # Two rasterizers plus perspective resampling can differ by one pixel phase.
        # Report the raw score too; tolerance is bounded and cannot hide a displaced glyph.
        nearby = [float(np.logical_and(reference, np.roll(actual, (dy, dx), (0, 1))).sum() /
                        np.logical_or(reference, np.roll(actual, (dy, dx), (0, 1))).sum()) for dy in [-1,0,1] for dx in [-1,0,1]]
        scores.append(dict(character=cell['character'], iou=iou, onePixelIoU=max(nearby)))
report = dict(count=len(scores), minimumIoU=min(v['iou'] for v in scores), medianIoU=float(np.median([v['iou'] for v in scores])),
              minimumOnePixelIoU=min(v['onePixelIoU'] for v in scores), medianOnePixelIoU=float(np.median([v['onePixelIoU'] for v in scores])),
              tolerance='at most 1 input pixel translation; raw scores retained', worst=sorted(scores, key=lambda v:v['onePixelIoU'])[:10], exactCmap=True, allCharactersRenderedWithoutFallback=True,
              woffOutlinesAndMetricsIdentical=True, sourcePackageOriginalHashesVerified=True)
(Path(sys.argv[1]).parent / 'render-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=True))
assert report['minimumOnePixelIoU'] >= .90, 'Font raster changed more than the controlled perturbation budget'
assert report['medianOnePixelIoU'] >= .95
