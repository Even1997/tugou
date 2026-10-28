import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
import sys
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('font_worker', Path(__file__).parents[1] / 'runtime/font-worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class FontImageTests(unittest.TestCase):
    def test_reviewed_ocr_crop_preserves_topology_and_rejects_clipping(self):
        image = np.full((100, 100, 4), 255, dtype='uint8')
        image[20:80, 20:30, :3] = 0
        image[70:80, 20:70, :3] = 0
        mask, geometry = worker.recognized_mask(image, [10, 10, 90, 90], 'light', 128)
        self.assertEqual(mask.shape, (384, 384))
        self.assertEqual(geometry['components'], 1)
        self.assertEqual(geometry['holes'], 0)
        with self.assertRaisesRegex(ValueError, 'CROSS_CELL'):
            worker.recognized_mask(image, [25, 10, 90, 90], 'light', 128)
        with self.assertRaisesRegex(ValueError, 'EMPTY_GLYPH'):
            worker.recognized_mask(image, [0, 0, 10, 10], 'light', 128)

    def test_normalization_controls_and_measurements(self):
        mask = np.zeros((384, 384), dtype='uint8')
        mask[110:285, 70:88] = 1
        mask[110:128, 70:210] = 1
        cell = dict(character='L', baseline=276.48, originX=38.4, emPixels=261.12)
        before = worker.glyph_alignment('L', mask, cell, {})
        result, record = worker.place_glyph(mask, 'L', cell, {})
        after = worker.glyph_alignment('L', result, cell, {})
        self.assertAlmostEqual(after['size'], after['targetSize'], delta=1)
        self.assertLess(abs(after['anchorY']-after['targetY']), 1)
        self.assertLess(abs(after['centerX']-after['targetX']), 1)
        self.assertGreater(abs(before['centerX']-before['targetX']), 10)
        self.assertEqual(worker.topology(mask), worker.topology(result))
        unchanged, _ = worker.place_glyph(mask, 'L', cell, dict(center=False, size=False, baseline=False))
        self.assertTrue(np.array_equal(mask, unchanged))
        self.assertEqual(record['scale'], before['targetSize']/before['size'])

    def test_descender_dot_and_cjk_short_stroke(self):
        cell = dict(baseline=276.48, originX=38.4, emPixels=261.12)
        mask = np.zeros((384, 384), dtype='uint8')
        mask[130:305, 140:155] = 1
        mask[95:109, 140:155] = 1
        result, _ = worker.place_glyph(mask, 'j', cell, {})
        self.assertEqual(worker.topology(result)[0], 2)
        a = worker.glyph_alignment('j', result, cell, {})
        self.assertAlmostEqual(a['anchorY'], cell['baseline']+200*.26112, delta=1)
        mask[:] = 0
        mask[200:216, 90:270] = 1
        result, _ = worker.place_glyph(mask, '一', cell, {})
        self.assertLess(worker.ink_metrics(result)['height'], 25)
        self.assertGreater(worker.ink_metrics(result)['width'], 180)

    def test_weight_preserves_holes_and_small_components(self):
        mask = np.zeros((384, 384), dtype='uint8')
        mask[90:260, 100:240] = 1
        mask[110:240, 120:220] = 0
        mask[60:67, 170:177] = 1
        current = worker.ink_metrics(mask)['strokeWidth']
        for target in (current*.8, current*1.2):
            result, _ = worker.balance_weight(mask, target)
            self.assertEqual(worker.topology(result), worker.topology(mask))
            self.assertLessEqual(abs(worker.ink_metrics(result)['strokeWidth']-target), abs(current-target))

    def test_out_of_range_scale_is_not_silently_stretched(self):
        mask = np.zeros((384, 384), dtype='uint8')
        mask[160:190, 160:190] = 1
        with self.assertRaisesRegex(ValueError, 'NORMALIZATION_SCALE'):
            worker.place_glyph(mask, '日', dict(baseline=276, originX=38, emPixels=261), {})

    def test_small_dot_and_counter_survive(self):
        cell = np.full((256, 256, 4), 255, dtype='uint8')
        cell[60:190, 80:150, :3] = 0
        cell[90:160, 100:130, :3] = 255
        cell[30:32, 110:112, :3] = 0
        mask, report = worker.mask_from_cell(cell, 'light', 128)
        self.assertEqual(report['components'], 2)
        self.assertEqual(report['holes'], 1)
        self.assertEqual(int(mask[30:32, 110:112].sum()), 4)

    def test_alpha_is_explicit_and_required(self):
        cell = np.zeros((256, 256, 4), dtype='uint8')
        cell[40:190, 50:130] = [60, 30, 90, 255]
        self.assertEqual(worker.mask_from_cell(cell, 'alpha', 128)[1]['components'], 1)
        cell[:, :, 3] = 255
        with self.assertRaisesRegex(ValueError, 'ALPHA_REQUIRED'):
            worker.mask_from_cell(cell, 'alpha', 128)

    def test_empty_and_cross_cell_rejected(self):
        cell = np.full((256, 256, 4), 255, dtype='uint8')
        with self.assertRaisesRegex(ValueError, 'EMPTY_GLYPH'):
            worker.mask_from_cell(cell, 'light', 128)
        cell[:80, 40:50, :3] = 0
        with self.assertRaisesRegex(ValueError, 'CROSS_CELL'):
            worker.mask_from_cell(cell, 'light', 128)

    def test_missing_markers_rejected_explicit_corners_work(self):
        image = np.full((500, 500, 4), 255, dtype='uint8')
        page = dict(width=500, height=500)
        with self.assertRaisesRegex(ValueError, 'NEEDS_ALIGNMENT'):
            worker.align(image, page)
        _, report = worker.align(image, page, [[0,0], [499,0], [499,499], [0,499]])
        self.assertEqual(report['method'], 'explicit-corners')
        with self.assertRaisesRegex(ValueError, 'NEEDS_ALIGNMENT'):
            worker.align(image, page, [[0,0], [0,0], [0,0], [0,0]])

    def test_marker_plan_detects_orientation_and_pixel_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            result = worker.make_plan(dict(characters='ABij', cellSize=512), out)
            page = result['plan']['pages'][0]
            image = worker.load_image(out / page['template'])
            rotated = np.rot90(image).copy()
            corrected, report = worker.align(rotated, page)
            self.assertLess(report['maxResidualPixels'], 1)
            self.assertEqual(corrected.shape, image.shape)
            self.assertLessEqual(page['width'] * page['height'], 16_000_000)
            self.assertTrue(np.array_equal(image, corrected))


if __name__ == '__main__':
    unittest.main()
