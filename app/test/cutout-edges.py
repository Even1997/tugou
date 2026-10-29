import importlib.util
from pathlib import Path
import unittest
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('worker', Path(__file__).resolve().parents[1] / 'runtime/image-worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class EdgeTests(unittest.TestCase):
    def setUp(self):
        self.pixels = np.zeros((21, 21), dtype=np.uint8)
        self.pixels[5:16, 5:16] = 255
        self.matte = Image.fromarray(self.pixels)

    def test_zero_is_exact_identity(self):
        self.assertIs(worker.refine_matte(self.matte), self.matte)

    def test_shrink_matches_source_pixel_radius(self):
        expected = np.zeros_like(self.pixels)
        expected[7:14, 7:14] = 255
        np.testing.assert_array_equal(np.asarray(worker.refine_matte(self.matte, 2)), expected)

    def test_inward_feather_preserves_empty_background_and_core(self):
        result = np.asarray(worker.refine_matte(self.matte, 0, 1))
        self.assertTrue((result <= self.pixels).all())
        self.assertTrue(((result > 0) & (result < 255)).any())
        self.assertEqual(result[10, 10], 255)

    def test_semitransparent_matte_never_gains_opacity(self):
        pixels = np.random.default_rng(42).integers(0, 256, (80, 80), dtype=np.uint8)
        result = np.asarray(worker.refine_matte(Image.fromarray(pixels), 1, 0.5))
        self.assertTrue((result <= pixels).all())

    def test_empty_full_and_tiny_images(self):
        for size in [(1, 1), (2, 3), (20, 20)]:
            for fill in [0, 127, 255]:
                image = Image.new('L', size, fill)
                self.assertEqual(worker.refine_matte(image, 4, 4).tobytes(), image.tobytes())

    def test_invalid_parameters(self):
        for shrink, feather in [(-1, 0), (5, 0), (0.5, 0), (True, 0), (0, -1), (0, 5), (0, float('nan')), (0, float('inf')), (0, '1')]:
            with self.assertRaises(ValueError):
                worker.refine_matte(self.matte, shrink, feather)


if __name__ == '__main__':
    unittest.main()
