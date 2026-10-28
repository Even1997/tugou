import json
from pathlib import Path

import numpy as np
from PIL import Image

out = Path(__file__).resolve().parent.parent / 'test-results'
desktop = json.loads((out / 'ai-batch-desktop.json').read_text(encoding='utf-8'))
resources = Path(desktop['profile']) / 'workspace' / 'resources'
report = {'checks': [], 'metrics': {}}


def check(name, value):
    if not value:
        raise AssertionError(name)
    report['checks'].append(name)


try:
    for label, outputs in [('anime-2x', desktop['firstOutputs']), ('general-4x', desktop['retryOutputs'])]:
        for i, result in enumerate(outputs):
            with Image.open(resources / desktop['sources'][i]['resource']) as raw:
                source = raw.convert('RGBA')
            with Image.open(resources / result['resource']) as raw:
                image = raw.convert('RGBA')
            pixels = np.asarray(image)
            alpha = np.asarray(source.getchannel('A').resize(image.size, Image.Resampling.LANCZOS))
            check(f'{label} input {i} alpha retained exactly', np.array_equal(pixels[:, :, 3], alpha))
            check(f'{label} input {i} output is declared size', image.size == (result['width'], result['height']))
            if i == 0:
                interpolated = np.asarray(source.resize(image.size, Image.Resampling.LANCZOS))
                changed = int((np.any(pixels[:, :, :3] != interpolated[:, :, :3], axis=2) & (pixels[:, :, 3] > 200)).sum())
                report['metrics'][label] = {'changed_opaque_pixels': changed}
                check(f'{label} native output differs from interpolation', changed > 1000)
except Exception as error:
    report['failure'] = str(error)
    raise
finally:
    (out / 'ai-batch-pixels.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
