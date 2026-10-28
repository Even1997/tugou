"""Targeted finishing checks: zero strength, topology guard and input rejection."""
import hashlib
import runpy
import tempfile
import unittest
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

api = runpy.run_path(str(Path(__file__).resolve().parents[1]/'runtime/font-outline.py'))


def fixture(path):
    pen = TTGlyphPen(None)
    for points in [[(80,0),(80,700),(700,700),(700,0)],
                   [(100,20),(680,20),(680,680),(100,680)],
                   [(340,730),(340,760),(370,760),(370,730)]]:
        pen.moveTo(points[0])
        for p in points[1:]:
            pen.lineTo(p)
        pen.closePath()
    fb = FontBuilder(1000,isTTF=True)
    fb.setupGlyphOrder(['.notdef','space','A'])
    fb.setupCharacterMap({32:'space',65:'A'})
    fb.setupGlyf({'.notdef':TTGlyphPen(None).glyph(),'space':TTGlyphPen(None).glyph(),'A':pen.glyph()})
    fb.setupHorizontalMetrics({'.notdef':(800,0),'space':(300,0),'A':(800,80)})
    fb.setupHorizontalHeader(ascent=900,descent=-200)
    fb.setupNameTable({'familyName':'Outline Test','styleName':'Regular'})
    fb.setupOS2(sTypoAscender=900,sTypoDescender=-200,usWinAscent=900,usWinDescent=200)
    fb.setupPost();fb.setupMaxp();fb.save(path)


class OutlineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name)
        self.source = self.out/'input.ttf'
        fixture(self.source)
        self.job = dict(source=str(self.source),sourceSha256=hashlib.sha256(self.source.read_bytes()).hexdigest(),name='Outline Test',characters='A')

    def run_job(self, **options):
        return api['refine']({**self.job,**options},self.out,lambda *a:None,
                             lambda out,name,mime:dict(id=name,mimeType=mime))['report']

    def test_zero_strength_preserves_coordinates_and_metrics(self):
        report = self.run_job(smoothing=0,bold=0)
        before,after = TTFont(self.source),TTFont(self.out/'font.ttf')
        self.assertEqual(before['glyf']['A'].coordinates,after['glyf']['A'].coordinates)
        self.assertEqual(before['hmtx'].metrics,after['hmtx'].metrics)
        self.assertEqual(report['unchangedCount'],1)
        self.assertTrue(report['woff2RoundTrip'])

    def test_strong_settings_keep_hole_and_detached_dot(self):
        report = self.run_job(smoothing=24,bold=12)
        record = report['glyphs'][0]
        self.assertEqual(record['beforeTopology'],[2,1])
        self.assertEqual(record['afterTopology'],[2,1])
        self.assertTrue(record['limited'])
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(),self.job['sourceSha256'])

    def test_validation(self):
        for values,code in [({'bold':float('nan')},'INVALID_ARGUMENT'),({'bold':-1},'INVALID_ARGUMENT'),
                            ({'characters':'B'},'CHARSET_MISMATCH'),({'sourceSha256':'bad'},'SOURCE_CHANGED')]:
            with self.subTest(values=values),self.assertRaisesRegex(ValueError,code):
                self.run_job(**values)


if __name__ == '__main__':
    unittest.main()
