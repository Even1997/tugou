"""Render current UFO outlines for the library, without requiring a font build."""
import hashlib
import json
import sys
from pathlib import Path
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ufoLib import UFOReader


def preview(directory, characters):
    root = Path(directory)
    report = json.loads((root / 'result.json').read_text(encoding='utf-8'))['report']
    wanted = set(characters)
    reader = UFOReader(root / 'source.ufo')
    glyphset = reader.getGlyphSet()
    glyphs = []
    try:
        for record in report['glyphs']:
            if record['character'] not in wanted:
                continue
            if hashlib.sha256(glyphset.getGLIF(record['id'])).hexdigest() != record['sha256']:
                raise ValueError('SOURCE_CHANGED: 字形轮廓摘要不一致')
            pen = SVGPathPen(glyphset)
            glyphset[record['id']].draw(pen)
            glyphs.append(dict(character=record['character'], path=pen.getCommands(), advance=record['advance']))
    finally:
        reader.close()
    return dict(glyphs=glyphs)


if __name__ == '__main__':
    try:
        Path(sys.argv[3]).write_text(json.dumps(preview(sys.argv[1], sys.argv[2]), ensure_ascii=False), encoding='utf-8')
    except Exception as error:
        print(json.dumps(dict(error=str(error)[:400]), ensure_ascii=True), flush=True)
        sys.exit(1)
