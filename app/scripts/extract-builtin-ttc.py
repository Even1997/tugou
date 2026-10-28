"""Extract one licensed TTC face for Chromium; preserve outlines and attribution."""
import argparse
from pathlib import Path
from fontTools.ttLib import TTFont

parser = argparse.ArgumentParser()
parser.add_argument('source')
parser.add_argument('output')
parser.add_argument('--index', type=int, default=0)
parser.add_argument('--normalize-cmap', action='store_true')
args = parser.parse_args()
font = TTFont(args.source, fontNumber=args.index, recalcTimestamp=False)
notice = 'Tugou, 2026-10-28: extracted TTC face %d to standalone TTF for Chromium compatibility. Glyph outlines, character mapping and metrics unchanged. Original license applies.' % args.index
if args.normalize_cmap:
    for subtable in font['cmap'].tables:
        _ = subtable.cmap
    notice = 'Tugou, 2026-10-28: reserialized malformed cmap ranges for Chromium compatibility. Character mapping, glyph outlines and metrics unchanged. Original license applies.'
for record in font['name'].names:
    if record.nameID == 10:
        record.string = (record.toUnicode() + '\n' + notice).encode(record.getEncoding(), errors='replace')
font['name'].setName(notice, 10, 3, 1, 0x409)
font.save(Path(args.output))
