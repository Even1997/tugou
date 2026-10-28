"""Independent checks of emitted TTF/WOFF2 and before/after contour topology."""
import json
import sys
import zipfile
from pathlib import Path
from fontTools.ttLib import TTFont

root = Path(sys.argv[1])
evidence = json.loads((root / 'acceptance.json').read_text(encoding='utf-8'))
assert not evidence.get('failure'), evidence.get('failure')
checks = []
for dataset in evidence['datasets']:
    before, after = [TTFont(Path(dataset['variants'][v]['folder'])/'font.ttf') for v in ('before', 'after')]
    expected = {ord(c) for c in dataset['characters']} | {32}
    assert set(before.getBestCmap()) == expected == set(after.getBestCmap())
    for mode, ttf in zip(('before', 'after'), (before, after)):
        folder = Path(dataset['variants'][mode]['folder'])
        woff = TTFont(folder/'font.woff2')
        assert ttf.getBestCmap() == woff.getBestCmap()
        assert ttf['hmtx'].metrics == woff['hmtx'].metrics
        for codepoint in expected-{32}:
            name = ttf.getBestCmap()[codepoint]
            assert ttf['glyf'][name].getCoordinates(ttf['glyf']) == woff['glyf'][name].getCoordinates(woff['glyf'])
            assert ttf['glyf'][name].numberOfContours > 0
        with zipfile.ZipFile(folder/'font-source.zip') as archive:
            assert archive.testzip() is None
            provenance = json.loads(archive.read('provenance.json'))
            assert bool(provenance['processing']['normalization']) == (mode == 'after')
    for char in dataset['characters']:
        name = after.getBestCmap()[ord(char)]
        assert before['glyf'][name].numberOfContours == after['glyf'][name].numberOfContours, (dataset['name'],char,'contour loss')
    report = json.loads((Path(dataset['variants']['after']['folder'])/'report.json').read_text(encoding='utf-8'))
    assert all(g['normalization'].get('beforeErrorPixels') for g in report['glyphs'])
    assert after['OS/2'].sxHeight == 500 and after['OS/2'].sCapHeight == 720
    if dataset['kind'] == 'controlled':
        for char in 'gjpqy':
            assert after['glyf'][after.getBestCmap()[ord(char)]].yMin < -150, char
        for char in 'ij':
            assert next(g for g in report['glyphs'] if g['character'] == char)['geometry']['components'] >= 2
    checks.append(dict(dataset=dataset['name'],characters=len(expected)-1,exactCmap=True,allContoursPreserved=True,
                       ttfWoffCoordinatesIdentical=True,sourceZipVerified=True,metricsIncludeEveryGlyph=True))
(root/'font-verification.json').write_text(json.dumps(checks, indent=2), encoding='utf-8')
print(json.dumps(checks))
