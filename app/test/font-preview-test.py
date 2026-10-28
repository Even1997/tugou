import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from fontTools.ufoLib import UFOWriter

spec=importlib.util.spec_from_file_location('preview',Path(__file__).parents[1]/'runtime/font-preview.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class PreviewTests(unittest.TestCase):
    def test_actual_outlines_without_font_build_and_tamper_guard(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);writer=UFOWriter(root/'source.ufo',formatVersion=3);glyphs=writer.getGlyphSet()
            def draw(pen):
                pen.beginPath();pen.addPoint((10,20),segmentType='line');pen.addPoint((350,20),segmentType='line');pen.addPoint((350,600),segmentType='line');pen.endPath()
            glyphs.writeGlyph('u0041',SimpleNamespace(width=400,unicodes=[65]),draw);digest=hashlib.sha256(glyphs.getGLIF('u0041')).hexdigest();glyphs.writeContents();writer.writeLayerContents();writer.close()
            report={'report':{'glyphs':[{'character':'A','id':'u0041','sha256':digest,'advance':400}]}}
            (root/'result.json').write_text(json.dumps(report),encoding='utf-8')
            result=module.preview(root,'AB');self.assertEqual(len(result['glyphs']),1);self.assertEqual(result['glyphs'][0]['character'],'A');self.assertEqual(result['glyphs'][0]['advance'],400);self.assertIn('350',result['glyphs'][0]['path']);self.assertFalse((root/'font.ttf').exists())
            glif=next((root/'source.ufo').rglob('*.glif'));glif.write_bytes(glif.read_bytes()+b' ')
            with self.assertRaisesRegex(ValueError,'SOURCE_CHANGED'):module.preview(root,'A')
if __name__=='__main__':unittest.main()
